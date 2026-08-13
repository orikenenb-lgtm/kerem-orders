// Unit tests for supabase/functions/rivhit-img/lib.ts — the pure security
// and resource rules of the PROPOSED hardened image proxy. Run with
// `npm test` (plain node, no deps, same transpile harness as the others).
import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "../node_modules/typescript/lib/typescript.js";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "..", "supabase", "functions", "rivhit-img", "lib.ts"), "utf8");
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const tmp = mkdtempSync(join(tmpdir(), "rimg-"));
writeFileSync(join(tmp, "lib.mjs"), js);
const {
  LIMITS, parseRequest, validateUpstreamUrl, classifyUpstream, sniffImage,
  parseExifOrientation, exifOrientationToDegrees, normalizeRotation,
  statusForError, cacheKeyFor, successHeaders, errorHeaders, errorBody,
} = await import(pathToFileURL(join(tmp, "lib.mjs")).href);

const GOOD = "https://api.rivhit.co.il/online/FileService.svc/getItemPic/512481045/abc123";
const qs = (s) => new URLSearchParams(s);

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("✓", name); };

// ---------------- request validation ----------------
t("a real Rivhit variant request parses to url+width+rotation", () => {
  const r = parseRequest(qs(`u=${encodeURIComponent(GOOD)}&w=480&v=2&rot=90`));
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { url: GOOD, width: 480, rotation: 90, meta: false });
});
t("missing u is rejected", () => {
  assert.deepEqual(parseRequest(qs("w=480")).code, "invalid_request");
});
t("junk u is rejected", () => {
  assert.equal(parseRequest(qs("u=not a url")).code, "invalid_request");
});
t("http (not https) is rejected", () => {
  assert.equal(parseRequest(qs(`u=${encodeURIComponent(GOOD.replace("https", "http"))}`)).code, "unsupported_source");
});
t("foreign hosts are rejected", () => {
  assert.equal(parseRequest(qs(`u=${encodeURIComponent("https://example.com/img.jpg")}`)).code, "unsupported_source");
});
t("host-suffix spoofing is rejected (api.rivhit.co.il.evil.com)", () => {
  assert.equal(parseRequest(qs(`u=${encodeURIComponent("https://api.rivhit.co.il.evil.com/online/FileService.svc/getItemPic/1/x")}`)).code, "unsupported_source");
});
t("localhost / IP / metadata targets are rejected", () => {
  for (const u of ["https://localhost/x", "https://127.0.0.1/x", "https://169.254.169.254/latest/meta-data", "https://[::1]/x", "https://10.0.0.5/x"]) {
    assert.equal(parseRequest(qs(`u=${encodeURIComponent(u)}`)).ok, false, u);
  }
});
t("correct host but wrong path is rejected (matches deployed 'bad url')", () => {
  assert.equal(parseRequest(qs(`u=${encodeURIComponent("https://api.rivhit.co.il/")}`)).code, "unsupported_source");
  assert.equal(parseRequest(qs(`u=${encodeURIComponent("https://api.rivhit.co.il/anything/else")}`)).code, "unsupported_source");
});
t("credentials and odd ports in u are rejected", () => {
  assert.equal(parseRequest(qs(`u=${encodeURIComponent("https://user:pw@api.rivhit.co.il/online/FileService.svc/getItemPic/1/x")}`)).code, "unsupported_source");
  assert.equal(parseRequest(qs(`u=${encodeURIComponent("https://api.rivhit.co.il:8443/online/FileService.svc/getItemPic/1/x")}`)).code, "unsupported_source");
});
t("w=0 (original) and absent w are accepted; out-of-range w is not", () => {
  assert.equal(parseRequest(qs(`u=${encodeURIComponent(GOOD)}&w=0`)).value.width, 0);
  assert.equal(parseRequest(qs(`u=${encodeURIComponent(GOOD)}`)).value.width, 0);
  assert.equal(parseRequest(qs(`u=${encodeURIComponent(GOOD)}&w=8`)).code, "invalid_dimensions");
  assert.equal(parseRequest(qs(`u=${encodeURIComponent(GOOD)}&w=99999`)).code, "invalid_dimensions");
  assert.equal(parseRequest(qs(`u=${encodeURIComponent(GOOD)}&w=-5`)).code, "invalid_request");
  assert.equal(parseRequest(qs(`u=${encodeURIComponent(GOOD)}&w=1.5`)).code, "invalid_request");
});
t("rot is normalized exactly like the client normalizes it", () => {
  assert.equal(parseRequest(qs(`u=${encodeURIComponent(GOOD)}&rot=450`)).value.rotation, 90);
  assert.equal(parseRequest(qs(`u=${encodeURIComponent(GOOD)}&rot=-90`)).value.rotation, 270);
  assert.equal(parseRequest(qs(`u=${encodeURIComponent(GOOD)}&rot=abc`)).code, "invalid_request");
  assert.equal(normalizeRotation(null), 0);
});
t("meta=1 is recognized", () => {
  assert.equal(parseRequest(qs(`u=${encodeURIComponent(GOOD)}&meta=1`)).value.meta, true);
});

// ---------------- redirect-hop validation ----------------
t("a redirect that leaves the allowlist is rejected", () => {
  assert.equal(validateUpstreamUrl("https://evil.example/img.jpg").ok, false);
  assert.equal(validateUpstreamUrl(GOOD).ok, true);
});

// ---------------- upstream classification (pre-decode) ----------------
t("upstream errors, HTML bodies and oversized bodies never reach the decoder", () => {
  assert.equal(classifyUpstream(546, "image/jpeg", 100).code, "upstream_status");
  assert.equal(classifyUpstream(404, "image/jpeg", 100).code, "upstream_status");
  assert.equal(classifyUpstream(200, "text/html", 100).code, "upstream_not_image");
  assert.equal(classifyUpstream(200, "application/json", 100).code, "upstream_not_image");
  assert.equal(classifyUpstream(200, "image/jpeg", LIMITS.maxSourceBytes + 1).code, "source_too_large");
  assert.equal(classifyUpstream(200, "image/jpeg", 1000).ok, true);
  assert.equal(classifyUpstream(200, "application/octet-stream", 1000).ok, true);
  assert.equal(classifyUpstream(200, null, null).ok, true); // sniffing decides later
});

// ---------------- header sniffing: dims without a decode ----------------
function minimalJpeg({ width, height, exifOrientation } = {}) {
  const parts = [[0xff, 0xd8]]; // SOI
  if (exifOrientation) {
    // APP1 "Exif\0\0" + little-endian TIFF with one IFD entry (0x0112)
    const tiff = [
      0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, // II, 42, IFD @8
      0x01, 0x00, // 1 entry
      0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, exifOrientation, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, // next IFD = none
    ];
    const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
    const len = payload.length + 2;
    parts.push([0xff, 0xe1, (len >> 8) & 0xff, len & 0xff, ...payload]);
  }
  if (width && height) {
    // SOF0: len 17, precision 8, H, W, 3 components
    parts.push([
      0xff, 0xc0, 0x00, 0x11, 0x08,
      (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff,
      0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    ]);
  }
  parts.push([0xff, 0xd9]); // EOI
  return new Uint8Array(parts.flat());
}

t("JPEG dimensions are read from the SOF header before any decode", () => {
  const s = sniffImage(minimalJpeg({ width: 3024, height: 4032 }));
  assert.deepEqual(s, { format: "jpeg", width: 3024, height: 4032 });
});
t("PNG dimensions are read from IHDR", () => {
  const png = new Uint8Array(32);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  png.set([0x00, 0x00, 0x01, 0xe0, 0x00, 0x00, 0x01, 0x0e], 16); // 480 × 270
  const s = sniffImage(png);
  assert.deepEqual(s, { format: "png", width: 480, height: 270 });
});
t("GIF dimensions are read from the header", () => {
  const gif = new Uint8Array(32);
  gif.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0xe0, 0x01, 0x0e, 0x01]); // 480 × 270 LE
  const s = sniffImage(gif);
  assert.deepEqual(s, { format: "gif", width: 480, height: 270 });
});
t("junk bytes are not an image", () => {
  assert.equal(sniffImage(new TextEncoder().encode("<html>oops, an error page</html>....................")), null);
});

// ---------------- EXIF orientation ----------------
t("EXIF Orientation=6 is parsed from a real APP1 segment", () => {
  assert.equal(parseExifOrientation(minimalJpeg({ width: 100, height: 100, exifOrientation: 6 })), 6);
});
t("a JPEG without EXIF reports orientation 1", () => {
  assert.equal(parseExifOrientation(minimalJpeg({ width: 100, height: 100 })), 1);
});
t("orientation degrees match the sideways-photo fix (6→90, 3→180, 8→270)", () => {
  assert.equal(exifOrientationToDegrees(1), 0);
  assert.equal(exifOrientationToDegrees(6), 90);
  assert.equal(exifOrientationToDegrees(3), 180);
  assert.equal(exifOrientationToDegrees(8), 270);
});

// ---------------- errors, caching, keys ----------------
t("every error code maps to a sane HTTP status", () => {
  assert.equal(statusForError("invalid_request"), 400);
  assert.equal(statusForError("unsupported_source"), 400);
  assert.equal(statusForError("upstream_timeout"), 504);
  assert.equal(statusForError("source_too_large"), 413);
  assert.equal(statusForError("resource_limit"), 429);
  assert.equal(statusForError("internal_error"), 500);
});
t("success keeps the 30-day immutable cache the CDN relies on", () => {
  const h = successHeaders("image/jpeg");
  assert.equal(h["Cache-Control"], `public, max-age=${LIMITS.successMaxAge}, immutable`);
  assert.equal(h["Access-Control-Allow-Origin"], "*");
});
t("errors carry a SHORT cache — negative caching without poisoning", () => {
  const h = errorHeaders();
  assert.ok(h["Cache-Control"].includes(`max-age=${LIMITS.errorMaxAge}`));
  assert.ok(LIMITS.errorMaxAge <= 300, "negative cache must stay short");
});
t("error bodies are sanitized JSON — category + short reason only", () => {
  const b = JSON.parse(errorBody("decode_failure", "could not decode source image"));
  assert.deepEqual(Object.keys(b).sort(), ["error", "reason"]);
  assert.ok(!JSON.stringify(b).includes("https://"), "no URLs in error bodies");
});
t("cache keys are deterministic per normalized variant", () => {
  const req = { url: GOOD, width: 480, rotation: 90, meta: false };
  assert.equal(cacheKeyFor(req), cacheKeyFor({ ...req }));
  assert.notEqual(cacheKeyFor(req), cacheKeyFor({ ...req, rotation: 180 }));
  assert.notEqual(cacheKeyFor(req), cacheKeyFor({ ...req, width: 900 }));
});

console.log(`\n${n} rivhit-img proxy tests passed`);
