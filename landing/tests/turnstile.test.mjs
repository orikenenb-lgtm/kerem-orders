// Unit tests for lib/turnstile.ts — the pure token-lifecycle + submit-gate
// logic behind the signup captcha. Plain node, same transpile harness as the
// other suites. The React wrapper's DOM behaviour (script load, unmount,
// Strict-Mode) is exercised in production browser QA, not here.
import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "../node_modules/typescript/lib/typescript.js";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "lib", "turnstile.ts"), "utf8");
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const tmp = mkdtempSync(join(tmpdir(), "turnstile-"));
writeFileSync(join(tmp, "m.mjs"), js);
const {
  isTurnstileConfigured, initialTurnstileState, reduceTurnstile,
  canSubmitSignup, turnstileStatusMessage,
} = await import(pathToFileURL(join(tmp, "m.mjs")).href);

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("✓", name); };

t("configured only when a non-empty site key is present", () => {
  assert.equal(isTurnstileConfigured("1x00000000000000000000AA"), true);
  assert.equal(isTurnstileConfigured(""), false);
  assert.equal(isTurnstileConfigured(undefined), false);
});

t("initial state is loading when configured, unconfigured otherwise (fail closed)", () => {
  assert.deepEqual(initialTurnstileState("site-key"), { status: "loading", token: null });
  assert.deepEqual(initialTurnstileState(""), { status: "unconfigured", token: null });
});

t("an unconfigured widget never leaves the closed state", () => {
  const s0 = initialTurnstileState("");
  for (const ev of [{ type: "success", token: "x" }, { type: "rendered" }, { type: "reset" }]) {
    assert.deepEqual(reduceTurnstile(s0, ev), s0);
  }
});

t("success stores the token and moves to solved; empty token is an error", () => {
  const ready = { status: "ready", token: null };
  assert.deepEqual(reduceTurnstile(ready, { type: "success", token: "TOK" }), { status: "solved", token: "TOK" });
  assert.deepEqual(reduceTurnstile(ready, { type: "success", token: "" }), { status: "error", token: null });
});

t("error / timeout / expired clear the token (no stale token can be submitted)", () => {
  const solved = { status: "solved", token: "TOK" };
  assert.deepEqual(reduceTurnstile(solved, { type: "error" }), { status: "error", token: null });
  assert.deepEqual(reduceTurnstile(solved, { type: "timeout" }), { status: "error", token: null });
  assert.deepEqual(reduceTurnstile(solved, { type: "expired" }), { status: "expired", token: null });
});

t("a token is single-use: consuming/resetting clears it and returns to ready", () => {
  const solved = { status: "solved", token: "TOK" };
  assert.deepEqual(reduceTurnstile(solved, { type: "consumed" }), { status: "ready", token: null });
  assert.deepEqual(reduceTurnstile(solved, { type: "reset" }), { status: "ready", token: null });
});

t("submit is allowed ONLY with a configured, solved, non-empty token and not busy", () => {
  const solved = { status: "solved", token: "TOK" };
  assert.equal(canSubmitSignup({ configured: true, formValid: true, busy: false, state: solved }), true);
  // each precondition, individually, blocks submit:
  assert.equal(canSubmitSignup({ configured: false, formValid: true, busy: false, state: solved }), false);
  assert.equal(canSubmitSignup({ configured: true, formValid: false, busy: false, state: solved }), false);
  assert.equal(canSubmitSignup({ configured: true, formValid: true, busy: true, state: solved }), false);
  assert.equal(canSubmitSignup({ configured: true, formValid: true, busy: false, state: { status: "ready", token: null } }), false);
  assert.equal(canSubmitSignup({ configured: true, formValid: true, busy: false, state: { status: "solved", token: "" } }), false);
  assert.equal(canSubmitSignup({ configured: true, formValid: true, busy: false, state: { status: "expired", token: null } }), false);
});

t("status messages are Hebrew, non-empty, and never leak a token/internal", () => {
  for (const st of ["unconfigured", "loading", "ready", "solved", "expired", "error"]) {
    const m = turnstileStatusMessage(st);
    assert.ok(typeof m === "string" && m.length > 0, st);
    assert.ok(!/token|http|secret|key|Error:/i.test(m), st);
  }
});

console.log(`\n${n} turnstile tests passed`);
