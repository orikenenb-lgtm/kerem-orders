// rivhit-img — hardened product-image proxy for Supabase Edge Functions.
//
// ⚠️ PROVENANCE: this is a PROPOSED REPLACEMENT, written to the live
// function's observable contract (probed 2026-08-13, see README.md). It is
// NOT the currently deployed source — that was never committed to Git and
// exporting it requires an owner `supabase login`. DO NOT deploy without the
// runbook in docs/edge-functions-runbook.md and owner approval.
//
// Contract kept (verified against production):
//   GET ?u=<https Rivhit getItemPic URL>[&w=N&v=2][&rot=0-359][&meta=1]
//   * success        → image/jpeg, Cache-Control: public, max-age=2592000, immutable
//   * meta=1         → application/json {"size":n,"orientation":n}, no-store
//   * invalid input  → 400 (deployed returns text "bad url"; this version
//                      returns structured JSON — clients only check status)
//   * CORS           → Access-Control-Allow-Origin: * on every response
//   * rot            → EXTRA clockwise degrees applied AFTER the EXIF fix
//
// Hardening added on top of the observed behavior:
//   * strict scheme/host/path allowlist + credential/port checks (lib.ts)
//   * manual redirect handling, each hop re-validated, max 3
//   * upstream timeout, status/Content-Type checks before any decode
//   * streamed byte cap + header-sniffed pixel cap BEFORE the full decode
//     (the measured WORKER_RESOURCE_LIMIT killer was decoding 3MB+ originals)
//   * bounded concurrent decodes + in-flight dedup per variant
//   * short negative cache on errors so a dead link cannot re-hammer the worker
//   * structured, sanitized JSON errors; privacy-safe structured logs

import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
import {
  LIMITS,
  type ProxyErrorCode,
  type ProxyRequest,
  cacheKeyFor,
  classifyUpstream,
  errorBody,
  errorHeaders,
  exceedsPixelCap,
  exifOrientationToDegrees,
  parseExifOrientation,
  parseRequest,
  sniffImage,
  statusForError,
  successHeaders,
  validateUpstreamUrl,
} from "./lib.ts";

// ---------------------------------------------------------------------------
// Privacy-safe structured logging: never the full URL — host + a stable hash
// ---------------------------------------------------------------------------

function pathHash(url: string): string {
  let h = 5381;
  for (let i = 0; i < url.length; i++) h = ((h * 33) ^ url.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function logEvent(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ evt: "rivhit-img", ...fields }));
}

// ---------------------------------------------------------------------------
// Bounded concurrency + in-flight dedup
// ---------------------------------------------------------------------------

let activeDecodes = 0;
type Baked = { status: number; headers: Record<string, string>; body: Uint8Array };
const inflight = new Map<string, Promise<Baked>>();

function errorBaked(code: ProxyErrorCode, reason: string): Baked {
  return {
    status: statusForError(code),
    headers: errorHeaders(),
    body: new TextEncoder().encode(errorBody(code, reason)),
  };
}

// ---------------------------------------------------------------------------
// Upstream fetch: manual redirects (each hop re-validated), timeout, byte cap
// ---------------------------------------------------------------------------

async function fetchUpstream(
  url: string,
  maxBytes: number,
  /** true = a body larger than maxBytes is TRUNCATED and returned as success
   *  (meta mode reads only the EXIF-bearing head); false = it is an error. */
  truncateAtCap = false
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; code: ProxyErrorCode; reason: string }> {
  let current = url;
  for (let hop = 0; hop <= LIMITS.maxRedirects; hop++) {
    let res: Response;
    try {
      res = await fetch(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(LIMITS.upstreamTimeoutMs),
      });
    } catch (e) {
      const timedOut = e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError");
      return { ok: false, code: timedOut ? "upstream_timeout" : "upstream_status", reason: timedOut ? "upstream timeout" : "upstream fetch failed" };
    }

    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel();
      const loc = res.headers.get("location");
      if (!loc) return { ok: false, code: "upstream_status", reason: "redirect without location" };
      const resolved = new URL(loc, current).toString();
      const check = validateUpstreamUrl(resolved);
      if (!check.ok) return { ok: false, code: "unsupported_source", reason: "redirect left the allowlist" };
      current = resolved;
      continue;
    }

    const cls = classifyUpstream(res.status, res.headers.get("content-type"), Number(res.headers.get("content-length")) || null);
    // In truncate mode a large Content-Length is fine — only the head is read.
    if (!cls.ok && !(truncateAtCap && cls.code === "source_too_large")) {
      await res.body?.cancel();
      return cls;
    }

    // Stream with a hard byte cap — never buffer more than maxBytes even
    // when Content-Length lies or is missing. The read loop is inside its
    // own try/catch: a connection dropped MID-BODY (the heavy-original
    // failure population) must surface as a structured upstream error, never
    // as an unhandled rejection that would bypass the CORS/error contract.
    const reader = res.body?.getReader();
    if (!reader) return { ok: false, code: "upstream_status", reason: "empty upstream body" };
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          if (!truncateAtCap) {
            return { ok: false, code: "source_too_large", reason: `body exceeds ${maxBytes} bytes` };
          }
          chunks.push(value);
          total = maxBytes; // keep exactly the head; drop the overflow below
          break;
        }
        chunks.push(value);
      }
    } catch (e) {
      const timedOut = e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError");
      return { ok: false, code: timedOut ? "upstream_timeout" : "upstream_status", reason: "upstream body read failed" };
    }
    const bytes = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      const take = Math.min(c.byteLength, total - off);
      if (take <= 0) break;
      bytes.set(take === c.byteLength ? c : c.subarray(0, take), off);
      off += take;
    }
    return { ok: true, bytes };
  }
  return { ok: false, code: "upstream_status", reason: "too many redirects" };
}

// ---------------------------------------------------------------------------
// The actual image work for one validated request
// ---------------------------------------------------------------------------

async function process(req: ProxyRequest): Promise<Baked> {
  const started = Date.now();
  const log = (outcome: string, stage: string, extra: Record<string, unknown> = {}) =>
    logEvent({ outcome, stage, ms: Date.now() - started, w: req.width, rot: req.rotation, src: pathHash(req.url), ...extra });

  // meta probe: EXIF orientation from the first ~256KB, no decode at all.
  // The capped read is EXPECTED here — a larger body is truncated, not an
  // error (matches the deployed size=262400 behavior on big originals).
  if (req.meta) {
    const fetched = await fetchUpstream(req.url, LIMITS.metaReadBytes, true);
    if (!fetched.ok) {
      log("error", "meta-fetch", { code: fetched.code });
      return errorBaked(fetched.code, fetched.reason);
    }
    const head = fetched.bytes;
    const body = JSON.stringify({ size: head.byteLength, orientation: parseExifOrientation(head) });
    log("ok", "meta");
    return {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", "X-Content-Type-Options": "nosniff" },
      body: new TextEncoder().encode(body),
    };
  }

  const fetched = await fetchUpstream(req.url, LIMITS.maxSourceBytes);
  if (!fetched.ok) {
    log("error", "fetch", { code: fetched.code });
    return errorBaked(fetched.code, fetched.reason);
  }

  const sniffed = sniffImage(fetched.bytes);
  if (!sniffed) {
    log("error", "sniff", { code: "upstream_not_image" });
    return errorBaked("upstream_not_image", "body is not a recognizable image");
  }
  if (exceedsPixelCap(sniffed.width, sniffed.height)) {
    log("error", "sniff", { code: "invalid_dimensions", px: sniffed.width * sniffed.height });
    return errorBaked("invalid_dimensions", "source image has too many pixels");
  }

  const exifDeg = sniffed.format === "jpeg" ? exifOrientationToDegrees(parseExifOrientation(fetched.bytes)) : 0;
  const totalRotation = (exifDeg + req.rotation) % 360;

  // Untouched-original passthrough (w=0, nothing to straighten) — matches
  // the deployed behavior for w=0 and costs no decode.
  if (req.width === 0 && totalRotation === 0) {
    log("ok", "passthrough", { bytes: fetched.bytes.byteLength });
    return { status: 200, headers: successHeaders(`image/${sniffed.format}`), body: fetched.bytes };
  }

  // Bounded decode: fail FAST when the worker is saturated instead of dying
  // with WORKER_RESOURCE_LIMIT mid-decode; the client's delayed retry (and
  // the short error cache) absorb the miss.
  if (activeDecodes >= LIMITS.maxConcurrentDecodes) {
    log("error", "queue", { code: "resource_limit", active: activeDecodes });
    return errorBaked("resource_limit", "too many concurrent decodes");
  }

  activeDecodes++;
  try {
    let img: Image;
    try {
      const decoded = await Image.decode(fetched.bytes);
      if (!(decoded instanceof Image)) throw new Error("animated or unsupported container");
      img = decoded;
    } catch {
      log("error", "decode", { code: "decode_failure" });
      return errorBaked("decode_failure", "could not decode source image");
    }

    // ⚠️ Rotation direction MUST be validated against the deployed output
    // before cut-over (runbook step 4): the contract is "rot = extra
    // CLOCKWISE degrees", and ImageScript's rotate() direction has to be
    // confirmed to match on a rot=90 sample.
    if (totalRotation !== 0) img.rotate(totalRotation);
    if (req.width > 0 && img.width > req.width) {
      img.resize(req.width, Image.RESIZE_AUTO);
    }

    const out = await img.encodeJPEG(78);
    log("ok", "encode", { bytes: out.byteLength, exif: exifDeg });
    return { status: 200, headers: successHeaders("image/jpeg"), body: out };
  } catch (e) {
    const oom = String(e).toLowerCase().includes("memory");
    log("error", "process", { code: oom ? "resource_limit" : "internal_error" });
    return errorBaked(oom ? "resource_limit" : "internal_error", "image processing failed");
  } finally {
    activeDecodes--;
  }
}

// ---------------------------------------------------------------------------
// HTTP entry
// ---------------------------------------------------------------------------

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" } });
  }
  if (request.method !== "GET") {
    const b = errorBaked("invalid_request", "only GET is supported");
    return new Response(b.body, { status: 405, headers: b.headers });
  }

  const parsed = parseRequest(new URL(request.url).searchParams);
  if (!parsed.ok) {
    logEvent({ outcome: "error", stage: "validate", code: parsed.code });
    const b = errorBaked(parsed.code, parsed.reason);
    return new Response(b.body, { status: b.status, headers: b.headers });
  }

  // In-flight dedup: concurrent requests for the SAME variant share one
  // fetch+decode instead of multiplying the load that used to kill the worker.
  // The belt-and-braces catch keeps the error contract (CORS + sanitized
  // JSON) even for a defect process() itself failed to classify.
  try {
    const key = cacheKeyFor(parsed.value) + (parsed.value.meta ? "|meta" : "");
    let pending = inflight.get(key);
    if (!pending) {
      pending = process(parsed.value).finally(() => inflight.delete(key));
      inflight.set(key, pending);
    }
    const baked = await pending;
    return new Response(baked.body.slice(), { status: baked.status, headers: baked.headers });
  } catch {
    logEvent({ outcome: "error", stage: "handler", code: "internal_error" });
    const b = errorBaked("internal_error", "unexpected failure");
    return new Response(b.body, { status: b.status, headers: b.headers });
  }
});
