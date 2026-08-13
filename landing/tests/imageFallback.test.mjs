// Unit tests for lib/imageFallback.ts (+ the lib/images.ts URL builder it
// wraps) — run with `npm test` (plain node, no deps). Same on-the-fly TS
// transpile as tests/quantity.test.mjs; imageFallback imports images, so both
// are transpiled into one temp dir and the relative import keeps working.
import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "../node_modules/typescript/lib/typescript.js";

const here = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "imgfb-"));
const transpile = (name) => {
  const src = readFileSync(join(here, "..", "lib", `${name}.ts`), "utf8");
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText.replace(/from "\.\/images"/g, 'from "./images.mjs"');
  writeFileSync(join(tmp, `${name}.mjs`), js);
};
transpile("images");
transpile("imageFallback");
const { rivhitImg } = await import(pathToFileURL(join(tmp, "images.mjs")).href);
const {
  ATTEMPT_PROXY, ATTEMPT_PROXY_RETRY, ATTEMPT_DIRECT, ATTEMPT_EXHAUSTED,
  isDirectFallbackAllowed, srcForAttempt, nextAttempt, stageOf,
} = await import(pathToFileURL(join(tmp, "imageFallback.mjs")).href);

const LINK = "https://api.rivhit.co.il/externals/FileService.svc/x/photo.jpg";
const PROXY_PREFIX = "/functions/v1/rivhit-img?u=";

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("✓", name); };

// ---- rivhitImg URL builder ----
t("proxy URL carries the encoded source, width and v=2 cache-buster", () => {
  const u = rivhitImg(LINK, 480, 0);
  assert.ok(u.includes(PROXY_PREFIX + encodeURIComponent(LINK)));
  assert.ok(u.includes("&w=480&v=2"));
  assert.ok(!u.includes("&rot="), "rot=0 must be omitted so the plain cached variant is reused");
});
t("empty picture link builds no URL at all", () => {
  assert.equal(rivhitImg(""), "");
});
t("rotation is normalized into 0-359 and joins the cache key", () => {
  assert.ok(rivhitImg(LINK, 480, 90).includes("&rot=90"));
  assert.ok(rivhitImg(LINK, 480, 450).includes("&rot=90"));
  assert.ok(rivhitImg(LINK, 480, -90).includes("&rot=270"));
  assert.ok(!rivhitImg(LINK, 480, 360).includes("&rot="));
  assert.ok(!rivhitImg(LINK, 480, NaN).includes("&rot="));
});

// ---- which URL each attempt loads ----
t("attempts 0 and 1 hit the proxy with the SAME URL (a pure retry)", () => {
  const a0 = srcForAttempt(LINK, ATTEMPT_PROXY, 480, 0);
  const a1 = srcForAttempt(LINK, ATTEMPT_PROXY_RETRY, 480, 0);
  assert.ok(a0.includes(PROXY_PREFIX));
  assert.equal(a0, a1);
});
t("attempt 2 falls back to the direct HTTPS source", () => {
  assert.equal(srcForAttempt(LINK, ATTEMPT_DIRECT, 480, 0), LINK);
});
t("direct fallback refuses non-HTTPS sources", () => {
  assert.equal(srcForAttempt("http://insecure/img.jpg", ATTEMPT_DIRECT), "");
  assert.equal(srcForAttempt("javascript:alert(1)", ATTEMPT_DIRECT), "");
  assert.equal(srcForAttempt("data:image/png;base64,xxxx", ATTEMPT_DIRECT), "");
});
t("empty / invalid URL renders the placeholder from the very first attempt", () => {
  assert.equal(srcForAttempt("", ATTEMPT_PROXY), "");
  assert.equal(srcForAttempt("", ATTEMPT_DIRECT), "");
  // Non-HTTPS junk never reaches the proxy either — zero network attempts.
  assert.equal(srcForAttempt("http://insecure/img.jpg", ATTEMPT_PROXY), "");
  assert.equal(srcForAttempt("not a url", ATTEMPT_PROXY), "");
});
t("invalid links report the no-url stage at every attempt", () => {
  assert.equal(stageOf(ATTEMPT_PROXY, "http://x/img.jpg"), "no-url");
  assert.equal(stageOf(ATTEMPT_PROXY, "not a url"), "no-url");
});
t("exhausted attempt renders the placeholder", () => {
  assert.equal(srcForAttempt(LINK, ATTEMPT_EXHAUSTED), "");
});

// ---- isDirectFallbackAllowed ----
t("only real HTTPS links are eligible for the direct fallback", () => {
  assert.equal(isDirectFallbackAllowed(LINK), true);
  assert.equal(isDirectFallbackAllowed("HTTPS://UPPER.example/img.png"), true);
  assert.equal(isDirectFallbackAllowed("http://x/img.png"), false);
  assert.equal(isDirectFallbackAllowed(""), false);
  assert.equal(isDirectFallbackAllowed("ftp://x/img.png"), false);
});

// ---- the chain itself ----
t("proxy failure schedules ONE delayed retry (no immediate hammering)", () => {
  const next = nextAttempt(ATTEMPT_PROXY, LINK);
  assert.equal(next.attempt, ATTEMPT_PROXY_RETRY);
  assert.ok(next.delayMs >= 1000, "retry must wait for the worker to warm up");
});
t("after the retry, an HTTPS source falls back to direct", () => {
  const next = nextAttempt(ATTEMPT_PROXY_RETRY, LINK);
  assert.equal(next.attempt, ATTEMPT_DIRECT);
});
t("after the retry, a non-HTTPS source goes straight to the placeholder", () => {
  const next = nextAttempt(ATTEMPT_PROXY_RETRY, "http://x/img.jpg");
  assert.equal(next.attempt, ATTEMPT_EXHAUSTED);
});
t("after the direct attempt the chain ends at the placeholder", () => {
  const next = nextAttempt(ATTEMPT_DIRECT, LINK);
  assert.equal(next.attempt, ATTEMPT_EXHAUSTED);
});
t("the exhausted state never retries — no infinite loop", () => {
  assert.equal(nextAttempt(ATTEMPT_EXHAUSTED, LINK), null);
  assert.equal(nextAttempt(ATTEMPT_EXHAUSTED + 5, LINK), null);
});
t("a full walk of the chain makes at most 3 network attempts", () => {
  let attempt = ATTEMPT_PROXY;
  let requests = 0;
  for (let guard = 0; guard < 10; guard++) {
    const src = srcForAttempt(LINK, attempt, 480, 0);
    if (!src) break;           // placeholder — no request
    requests++;
    const next = nextAttempt(attempt, LINK);
    if (!next) break;
    attempt = next.attempt;
  }
  assert.equal(requests, 3, "proxy + retry + direct, nothing more");
});
t("a full walk with an empty or non-HTTPS link makes ZERO network attempts", () => {
  for (const link of ["", "http://x/img.jpg", "data:image/png;base64,x"]) {
    let attempt = ATTEMPT_PROXY;
    let requests = 0;
    for (let guard = 0; guard < 10; guard++) {
      const src = srcForAttempt(link, attempt, 480, 0);
      if (!src) break;
      requests++;
      const next = nextAttempt(attempt, link);
      if (!next) break;
      attempt = next.attempt;
    }
    assert.equal(requests, 0, `link "${link}" must never be requested`);
  }
});

// ---- stage names (manager-facing diagnostics) ----
t("stageOf reports the failure stage for the admin screens", () => {
  assert.equal(stageOf(ATTEMPT_PROXY, LINK), "proxy");
  assert.equal(stageOf(ATTEMPT_PROXY_RETRY, LINK), "proxy-retry");
  assert.equal(stageOf(ATTEMPT_DIRECT, LINK), "direct");
  assert.equal(stageOf(ATTEMPT_EXHAUSTED, LINK), "exhausted");
  assert.equal(stageOf(ATTEMPT_PROXY, ""), "no-url");
});

console.log(`\n${n} imageFallback tests passed`);
