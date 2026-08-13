// PURE helpers for the rivhit-img edge function — no Deno APIs, no network.
// Everything here is unit-tested from landing/tests/rivhitImgProxy.test.mjs
// (plain node, same transpile harness as the other suites), so the security
// and resource rules of the proxy are enforced by tests that run in CI.
//
// PROVENANCE: this is part of the PROPOSED replacement implementation — the
// currently deployed function's source was never committed to Git and could
// not be exported without an owner `supabase login`. See README.md.

// ---------------------------------------------------------------------------
// Limits (single source of truth; index.ts imports these)
// ---------------------------------------------------------------------------

export const LIMITS = {
  /** Only these upstream hosts may be fetched — everything else is rejected
   *  before any network I/O (SSRF guard). Extend via env if Rivhit adds a CDN
   *  host, never with a wildcard. */
  allowedHosts: ["api.rivhit.co.il"],
  /** The upstream path must start with one of these — the deployed function
   *  enforces the same shape (probed live: host-only and non-getItemPic paths
   *  are rejected with 400 "bad url"). */
  allowedPathPrefixes: ["/online/FileService.svc/getItemPic/"],
  /** meta=1 probe mode reads at most this many bytes (EXIF lives at the
   *  front of the file) — matches the deployed behavior (~256 KB). */
  metaReadBytes: 262_400,
  /** Upstream fetch timeout. */
  upstreamTimeoutMs: 15_000,
  /** Redirect hops followed manually; every hop is re-validated. */
  maxRedirects: 3,
  /** Largest compressed upstream body we are willing to buffer. */
  maxSourceBytes: 8 * 1024 * 1024,
  /** Largest decoded image we are willing to process (width × height). */
  maxSourcePixels: 40_000_000,
  /** Resize width bounds; w=0 means "serve the original untouched". */
  minWidth: 16,
  maxWidth: 1600,
  /** Concurrent decodes per worker; queue beyond this fails fast instead of
   *  exhausting the worker (the measured 546 failure mode). */
  maxConcurrentDecodes: 2,
  /** Cache lifetimes (seconds). */
  successMaxAge: 2_592_000, // 30 days — matches the long-lived CDN cache the site relies on
  errorMaxAge: 60, // short negative cache so a broken product cannot hammer the worker
} as const;

// ---------------------------------------------------------------------------
// Structured error taxonomy — the ONLY error shapes the function returns
// ---------------------------------------------------------------------------

export type ProxyErrorCode =
  | "invalid_request"
  | "unsupported_source"
  | "upstream_timeout"
  | "upstream_status"
  | "upstream_not_image"
  | "source_too_large"
  | "invalid_dimensions"
  | "decode_failure"
  | "resource_limit"
  | "internal_error";

/** HTTP status for each error category. Sanitized: no stack traces, no
 *  upstream URLs, no internals ever leave the function. */
export function statusForError(code: ProxyErrorCode): number {
  switch (code) {
    case "invalid_request":
    case "unsupported_source":
      return 400;
    case "upstream_timeout":
      return 504;
    case "upstream_status":
    case "upstream_not_image":
      return 502;
    case "source_too_large":
    case "invalid_dimensions":
      return 413;
    case "decode_failure":
      return 422;
    case "resource_limit":
      return 429;
    case "internal_error":
      return 500;
  }
}

// ---------------------------------------------------------------------------
// Request parsing / validation
// ---------------------------------------------------------------------------

export type ProxyRequest = {
  /** Validated upstream URL (https, allow-listed host+path, no credentials). */
  url: string;
  /** Resize width, or 0 for the untouched original. */
  width: number;
  /** Extra clockwise rotation AFTER the EXIF fix, normalized to 0-359. */
  rotation: number;
  /** meta=1: EXIF-probe mode — return {size, orientation} JSON, no decode. */
  meta: boolean;
};

export type ParseResult =
  | { ok: true; value: ProxyRequest }
  | { ok: false; code: ProxyErrorCode; reason: string };

export function normalizeRotation(raw: string | null): number {
  if (raw === null || raw === "") return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return NaN;
  return ((Math.round(n) % 360) + 360) % 360;
}

/** True only for an exact allow-listed hostname (case-insensitive). IP
 *  literals, private ranges, localhost and metadata services can never match
 *  because only DNS names on the list are accepted. */
export function isAllowedHost(hostname: string, allowed: readonly string[] = LIMITS.allowedHosts): boolean {
  const h = hostname.toLowerCase();
  return allowed.some((a) => h === a.toLowerCase());
}

/** Validate a candidate upstream URL (also used for every redirect hop). */
export function validateUpstreamUrl(
  raw: string,
  allowed: readonly string[] = LIMITS.allowedHosts
): { ok: true; url: URL } | { ok: false; code: ProxyErrorCode; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, code: "invalid_request", reason: "u is not a valid URL" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, code: "unsupported_source", reason: "only https sources are allowed" };
  }
  if (url.username || url.password) {
    return { ok: false, code: "unsupported_source", reason: "credentials in URL are not allowed" };
  }
  if (url.port && url.port !== "443") {
    return { ok: false, code: "unsupported_source", reason: "non-standard port" };
  }
  if (!isAllowedHost(url.hostname, allowed)) {
    return { ok: false, code: "unsupported_source", reason: "host is not on the allowlist" };
  }
  if (!LIMITS.allowedPathPrefixes.some((p) => url.pathname.startsWith(p))) {
    return { ok: false, code: "unsupported_source", reason: "path is not an allowed Rivhit image path" };
  }
  return { ok: true, url };
}

/** Parse + validate the query string. Unknown parameters are ignored (the
 *  client sends v= as a cache-buster; it participates in the CDN cache key
 *  automatically because the full URL is the key). */
export function parseRequest(params: URLSearchParams): ParseResult {
  const u = params.get("u");
  if (!u) return { ok: false, code: "invalid_request", reason: "missing u" };

  const urlCheck = validateUpstreamUrl(u);
  if (!urlCheck.ok) return urlCheck;

  const wRaw = params.get("w");
  let width = 0;
  if (wRaw !== null && wRaw !== "") {
    const n = Number(wRaw);
    if (!Number.isInteger(n) || n < 0) {
      return { ok: false, code: "invalid_request", reason: "w must be a non-negative integer" };
    }
    if (n !== 0 && (n < LIMITS.minWidth || n > LIMITS.maxWidth)) {
      return { ok: false, code: "invalid_dimensions", reason: `w must be 0 or ${LIMITS.minWidth}-${LIMITS.maxWidth}` };
    }
    width = n;
  }

  const rotation = normalizeRotation(params.get("rot"));
  if (Number.isNaN(rotation)) {
    return { ok: false, code: "invalid_request", reason: "rot must be a number" };
  }

  return {
    ok: true,
    value: { url: urlCheck.url.toString(), width, rotation, meta: params.get("meta") === "1" },
  };
}

// ---------------------------------------------------------------------------
// Upstream response classification (before any decoding)
// ---------------------------------------------------------------------------

export function classifyUpstream(status: number, contentType: string | null, contentLength: number | null):
  | { ok: true }
  | { ok: false; code: ProxyErrorCode; reason: string } {
  if (status < 200 || status >= 300) {
    return { ok: false, code: "upstream_status", reason: `upstream returned ${status}` };
  }
  const ct = (contentType || "").toLowerCase();
  // Rivhit serves images with a proper image/* type; HTML/JSON error pages
  // must never reach the decoder.
  if (ct && !ct.startsWith("image/") && !ct.startsWith("application/octet-stream")) {
    return { ok: false, code: "upstream_not_image", reason: `content-type ${ct}` };
  }
  if (contentLength !== null && contentLength > LIMITS.maxSourceBytes) {
    return { ok: false, code: "source_too_large", reason: `content-length ${contentLength}` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Image header sniffing — magic bytes + dimensions WITHOUT a full decode
// ---------------------------------------------------------------------------

export type SniffedImage = { format: "jpeg" | "png" | "gif" | "webp"; width: number; height: number };

/** Read the pixel dimensions from the container header so oversized images
 *  are rejected BEFORE the expensive decode (the measured 546 failure mode
 *  was the decoder dying on ~3MB+ sources). Returns null when the bytes are
 *  not a recognizable image. */
export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  if (bytes.length < 12) return null;
  // PNG: 8-byte signature, then IHDR at offset 16
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    if (bytes.length < 24) return null;
    const width = readU32BE(bytes, 16);
    const height = readU32BE(bytes, 20);
    return width && height ? { format: "png", width, height } : null;
  }
  // GIF: "GIF8", little-endian 16-bit dims at 6/8
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    const width = bytes[6] | (bytes[7] << 8);
    const height = bytes[8] | (bytes[9] << 8);
    return width && height ? { format: "gif", width, height } : null;
  }
  // WebP: RIFF....WEBP + VP8/VP8L/VP8X chunk
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    const dims = sniffWebpDims(bytes);
    return dims ? { format: "webp", ...dims } : null;
  }
  // JPEG: walk the segment chain to the first SOF marker
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    const dims = sniffJpegDims(bytes);
    return dims ? { format: "jpeg", ...dims } : null;
  }
  return null;
}

function readU32BE(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

function sniffJpegDims(b: Uint8Array): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    // standalone markers without a length field
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9) || marker === 0x01 || marker === 0xff) { i += 2; continue; }
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2) return null;
    // SOF0-SOF15 except DHT(C4)/JPG(C8)/DAC(CC) carry the frame dimensions
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = (b[i + 5] << 8) | b[i + 6];
      const width = (b[i + 7] << 8) | b[i + 8];
      return width && height ? { width, height } : null;
    }
    i += 2 + len;
  }
  return null;
}

function sniffWebpDims(b: Uint8Array): { width: number; height: number } | null {
  const fourcc = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (fourcc === "VP8X" && b.length >= 30) {
    const width = 1 + ((b[24] | (b[25] << 8) | (b[26] << 16)) & 0xffffff);
    const height = 1 + ((b[27] | (b[28] << 8) | (b[29] << 16)) & 0xffffff);
    return { width, height };
  }
  if (fourcc === "VP8 " && b.length >= 30) {
    const width = (b[26] | (b[27] << 8)) & 0x3fff;
    const height = (b[28] | (b[29] << 8)) & 0x3fff;
    return width && height ? { width, height } : null;
  }
  if (fourcc === "VP8L" && b.length >= 25) {
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    return { width, height };
  }
  return null;
}

// ---------------------------------------------------------------------------
// EXIF orientation (JPEG APP1) — about half the Rivhit photos carry
// Orientation=6; stripping it without rotating is what served photos sideways
// ---------------------------------------------------------------------------

/** Returns the EXIF Orientation value (1-8) or 1 when absent/unreadable. */
export function parseExifOrientation(b: Uint8Array): number {
  if (!(b[0] === 0xff && b[1] === 0xd8)) return 1;
  let i = 2;
  while (i + 4 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    if (marker === 0xda || marker === 0xd9) break; // image data / EOI — no EXIF past here
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2) break;
    if (marker === 0xe1 && i + 4 + 6 <= b.length &&
        b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66 && b[i + 8] === 0x00) {
      const tiff = i + 10; // after "Exif\0\0"
      if (tiff + 8 > b.length) return 1;
      const little = b[tiff] === 0x49 && b[tiff + 1] === 0x49;
      const big = b[tiff] === 0x4d && b[tiff + 1] === 0x4d;
      if (!little && !big) return 1;
      const u16 = (o: number) => (little ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
      const u32 = (o: number) =>
        little
          ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
          : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
      const ifdOffset = u32(tiff + 4);
      const ifd = tiff + ifdOffset;
      if (ifd + 2 > b.length) return 1;
      const entries = u16(ifd);
      for (let e = 0; e < entries; e++) {
        const entry = ifd + 2 + e * 12;
        if (entry + 12 > b.length) return 1;
        if (u16(entry) === 0x0112) {
          const v = u16(entry + 8);
          return v >= 1 && v <= 8 ? v : 1;
        }
      }
      return 1;
    }
    i += 2 + len;
  }
  return 1;
}

/** Extra clockwise degrees needed to upright a photo with this EXIF
 *  orientation (mirrored variants 2/4/5/7 are approximated by their rotation
 *  component — Rivhit product photos are not mirrored in practice). */
export function exifOrientationToDegrees(orientation: number): number {
  switch (orientation) {
    case 3: case 4: return 180;
    case 5: case 6: return 90;
    case 7: case 8: return 270;
    default: return 0;
  }
}

// ---------------------------------------------------------------------------
// Caching
// ---------------------------------------------------------------------------

/** Deterministic cache key: normalized source + normalized transforms. The
 *  CDN keys on the full request URL; this normalized form is used for the
 *  in-flight decode dedup so `rot=90&w=480` and `w=480&rot=090` share work. */
export function cacheKeyFor(req: ProxyRequest): string {
  return `${req.url}|w=${req.width}|rot=${req.rotation}`;
}

export function successHeaders(contentType: string): Record<string, string> {
  return {
    "Content-Type": contentType,
    "Cache-Control": `public, max-age=${LIMITS.successMaxAge}, immutable`,
    "Access-Control-Allow-Origin": "*",
    "X-Content-Type-Options": "nosniff",
  };
}

/** Errors carry a SHORT cache so a dead link cannot re-hammer the worker on
 *  every page view, while a transient failure recovers within a minute. */
export function errorHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": `public, max-age=${LIMITS.errorMaxAge}`,
    "Access-Control-Allow-Origin": "*",
    "X-Content-Type-Options": "nosniff",
  };
}

export function errorBody(code: ProxyErrorCode, reason: string): string {
  // Sanitized on purpose: category + short reason only. No URLs, no stacks.
  return JSON.stringify({ error: code, reason });
}
