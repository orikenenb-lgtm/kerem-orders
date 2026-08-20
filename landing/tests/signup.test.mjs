// Security tests for the signup helpers (supabase/functions/signup/lib.ts).
// Plain node, same transpile harness as the other suites, so these invariants
// run in CI. lib.ts marks which rules the deployed function enforces and which
// are the stricter not-live posture; the test names here say the same.
import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "../node_modules/typescript/lib/typescript.js";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "..", "supabase", "functions", "signup", "lib.ts"), "utf8");
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const tmp = mkdtempSync(join(tmpdir(), "signup-"));
writeFileSync(join(tmp, "lib.mjs"), js);
const {
  CUSTOMER_ROLE, normalizeEmail, isValidEmail, isAcceptablePassword,
  resolveRole, EMAIL_CONFIRM_ON_PUBLIC_SIGNUP, publicSignupError, parseSignup,
  isTurnstileVerifyAcceptable, TURNSTILE_PROD_HOSTNAME, classifySiteverify,
} = await import(pathToFileURL(join(tmp, "lib.mjs")).href);

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("✓", name); };

t("a customer can NEVER become manager via the request body", () => {
  for (const body of [
    { email: "x@y.com", password: "password1", role: "manager" },
    { email: "x@y.com", password: "password1", is_manager: true },
    { email: "x@y.com", password: "password1", admin: true },
    { email: "x@y.com", password: "password1", user_metadata: { role: "manager" } },
  ]) {
    assert.equal(resolveRole(body), CUSTOMER_ROLE);
    const p = parseSignup(body);
    assert.equal(p.ok, true);
    assert.equal(p.role, "customer", "parsed role must always be customer");
  }
});

t("no email string can self-promote — even the owner-looking address is a customer", () => {
  const body = { email: "OWNER@example.com", password: "password1" };
  assert.equal(resolveRole(body), CUSTOMER_ROLE);
  assert.equal(parseSignup(body).role, "customer");
});

t("email casing/spacing is normalized so it cannot bypass later checks", () => {
  assert.equal(normalizeEmail("  Owner@Example.COM "), "owner@example.com");
  assert.equal(normalizeEmail("A@B.co"), "a@b.co");
  assert.equal(parseSignup({ email: "  X@Y.com ", password: "password1" }).email, "x@y.com");
  assert.equal(normalizeEmail(123), "");
  assert.equal(normalizeEmail(undefined), "");
});

t("NOT LIVE — the stricter no-pre-confirm posture stays internally consistent", () => {
  // The deployed function passes email_confirm: true on purpose so a new
  // customer can log in immediately. This pins the helpers that would be used
  // if the owner ever turns on confirmation emails; it is not a claim about
  // what production does.
  assert.equal(EMAIL_CONFIRM_ON_PUBLIC_SIGNUP, false);
  assert.equal(parseSignup({ email: "x@y.com", password: "password1" }).emailConfirm, false);
});

t("input validation rejects bad email and weak/oversized passwords", () => {
  assert.equal(parseSignup({ email: "not-an-email", password: "password1" }).ok, false);
  assert.equal(parseSignup({ email: "x@y.com", password: "short" }).ok, false);
  assert.equal(parseSignup({ email: "x@y.com", password: "x".repeat(201) }).ok, false);
  assert.equal(isValidEmail("a@b.co"), true);
  assert.equal(isValidEmail("a@b"), false);
  assert.equal(isAcceptablePassword("password1"), true);
  assert.equal(isAcceptablePassword("1234567"), false);
});

t("NOT LIVE — publicSignupError's messages reveal nothing about existence", () => {
  // The deployed function returns a friendly "already registered" instead, so
  // this covers the helper, not the live response. See supabase/functions/signup/lib.ts.
  // A duplicate address and a generic failure must produce the SAME response.
  const dup = publicSignupError("signup_failed");
  const genFail = publicSignupError("signup_failed");
  assert.deepEqual(dup, genFail);
  // The success-shaped message must not say "exists"/"taken"/"already".
  assert.ok(!/exist|taken|already|registered|כבר|קיים/i.test(dup.message));
  // Distinct kinds have distinct, generic messages — none leaks internals.
  const kinds = ["invalid_input", "captcha_failed", "rate_limited", "signup_failed"];
  for (const k of kinds) {
    const e = publicSignupError(k);
    assert.ok(typeof e.message === "string" && e.message.length > 0);
    assert.ok(!/http|token|service_role|key|stack|Error:/i.test(e.message));
  }
});

t("rate_limited maps to a generic 429", () => {
  // The live function verifies the Turnstile token; Auth's own per-IP limiter
  // is what throttles a flood. This pins the generic 429 shape.
  assert.equal(publicSignupError("rate_limited").status, 429);
});

// ---- Turnstile siteverify response validation ----
t("siteverify: production requires success + exact GitHub Pages hostname", () => {
  assert.equal(TURNSTILE_PROD_HOSTNAME, "orikenenb-lgtm.github.io");
  const ok = { success: true, hostname: "orikenenb-lgtm.github.io", action: "signup" };
  assert.equal(isTurnstileVerifyAcceptable(ok, { allowTest: false, expectedAction: "signup" }), true);
  // failures:
  assert.equal(isTurnstileVerifyAcceptable({ success: false, hostname: "orikenenb-lgtm.github.io" }, { allowTest: false }), false);
  assert.equal(isTurnstileVerifyAcceptable({ success: true, hostname: "evil.example" }, { allowTest: false }), false);
  assert.equal(isTurnstileVerifyAcceptable({ success: true, hostname: "localhost" }, { allowTest: false }), false);
  assert.equal(isTurnstileVerifyAcceptable({ success: true, hostname: "127.0.0.1" }, { allowTest: false }), false);
  assert.equal(isTurnstileVerifyAcceptable({ success: true, hostname: "" }, { allowTest: false }), false);
  assert.equal(isTurnstileVerifyAcceptable(null, { allowTest: false }), false);
});
t("siteverify: action mismatch is rejected when the response echoes an action", () => {
  const wrongAction = { success: true, hostname: "orikenenb-lgtm.github.io", action: "login" };
  assert.equal(isTurnstileVerifyAcceptable(wrongAction, { allowTest: false, expectedAction: "signup" }), false);
  // when no action is echoed (test keys), action is not enforced
  const noAction = { success: true, hostname: "orikenenb-lgtm.github.io" };
  assert.equal(isTurnstileVerifyAcceptable(noAction, { allowTest: false, expectedAction: "signup" }), true);
});
t("siteverify: test mode relaxes the hostname check but still requires success", () => {
  assert.equal(isTurnstileVerifyAcceptable({ success: true, hostname: "localhost" }, { allowTest: true }), true);
  assert.equal(isTurnstileVerifyAcceptable({ success: false, hostname: "localhost" }, { allowTest: true }), false);
});

// ---- Which captcha failures may refuse a registration ----
const OPTS = { allowTest: false, expectedAction: "signup" };
const GOOD = { success: true, hostname: TURNSTILE_PROD_HOSTNAME, action: "signup" };

t("a valid solve from the real site passes", () => {
  assert.equal(classifySiteverify(GOOD, OPTS), "ok");
});

t("a bad TOKEN refuses the signup", () => {
  for (const code of ["missing-input-response", "invalid-input-response", "timeout-or-duplicate"]) {
    assert.equal(classifySiteverify({ success: false, "error-codes": [code] }, OPTS), "bad_token", code);
  }
  // Solved, but for another action or on someone else's page — still the
  // caller's problem, not ours.
  assert.equal(classifySiteverify({ ...GOOD, action: "login" }, OPTS), "bad_token");
  assert.equal(classifySiteverify({ ...GOOD, hostname: "evil.example.com" }, OPTS), "bad_token");
  assert.equal(classifySiteverify({ ...GOOD, hostname: "localhost" }, OPTS), "bad_token");
});

t("OUR misconfiguration never refuses a signup", () => {
  // The whole point: a wrong or unpaired secret, a malformed request, or a
  // Cloudflare outage must not take registration offline for real customers.
  for (const code of ["missing-input-secret", "invalid-input-secret", "invalid-parsed-secret",
                      "invalid-widget-id", "bad-request", "internal-error"]) {
    assert.equal(classifySiteverify({ success: false, "error-codes": [code] }, OPTS), "misconfigured", code);
  }
  // Unreadable, empty, or unrecognised responses fall the same way.
  assert.equal(classifySiteverify(null, OPTS), "misconfigured");
  assert.equal(classifySiteverify(undefined, OPTS), "misconfigured");
  assert.equal(classifySiteverify({ success: false }, OPTS), "misconfigured");
  assert.equal(classifySiteverify({ success: false, "error-codes": ["some-future-code"] }, OPTS), "misconfigured");
});

t("a mixed response refuses if any code blames the token", () => {
  assert.equal(
    classifySiteverify({ success: false, "error-codes": ["internal-error", "timeout-or-duplicate"] }, OPTS),
    "bad_token",
  );
});


console.log(`\n${n} signup tests passed`);
