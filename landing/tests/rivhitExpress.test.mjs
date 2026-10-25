// Tests for "לקוח קיים" (supabase/functions/rivhit-express/lib.ts) and the
// phone sign-in mapping (lib/phoneLogin.ts). Plain node, same transpile
// harness as signup.test.mjs.
import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "../node_modules/typescript/lib/typescript.js";

const here = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "express-"));
async function load(rel, name) {
  const src = readFileSync(join(here, "..", rel), "utf8");
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  writeFileSync(join(tmp, name), js);
  return import(pathToFileURL(join(tmp, name)).href);
}
const X = await load("../supabase/functions/rivhit-express/lib.ts", "express.mjs");
const S = await load("../supabase/functions/signup/lib.ts", "signup.mjs");
const P = await load("lib/phoneLogin.ts", "phone.mjs");

let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log("✓", name); };

await t("canonPhone: one form however the phone is typed", () => {
  for (const s of ["050-123-4567", "0501234567", "+972 50 123 4567", "972501234567", "050 1234567", "(050)1234567"]) {
    assert.equal(X.canonPhone(s), "501234567", s);
  }
  assert.equal(X.canonPhone("04-812-3456"), "48123456");
  for (const s of ["", "0", "123", "05012345678901", "abc", null, undefined]) assert.equal(X.canonPhone(s), "", String(s));
});

await t("canonVat: leading zeros ignored, the single-digit '0' Rivhit stores is not an id", () => {
  assert.equal(X.canonVat("012345678"), "12345678");
  assert.equal(X.canonVat("12345678"), "12345678");
  assert.equal(X.canonVat("51-123456-7"), "511234567");
  for (const s of ["0", "", "0000", "123"]) assert.equal(X.canonVat(s), "", s);
});

await t("login address: fixed, undeliverable, identical in the function and on the site", () => {
  assert.equal(X.loginEmailForPhone("050-1234567"), "t501234567@phone.kerem-toys.invalid");
  assert.equal(X.loginEmailForPhone("nope"), "");
  assert.equal(X.LOGIN_EMAIL_DOMAIN, P.LOGIN_EMAIL_DOMAIN);
  for (const s of ["050-123-4567", "+972501234567", "04-8123456", "0", "x", "972-4-8123456", "0000501234567"]) {
    assert.equal(P.loginEmailForPhone(s), X.loginEmailForPhone(s), s);
    assert.equal(P.canonPhone(s), X.canonPhone(s), s);
  }
});

await t("login form: email stays an email, a phone becomes the phone address", () => {
  assert.equal(P.loginIdentifier("  Dani@Shop.co.il "), "dani@shop.co.il");
  assert.equal(P.loginIdentifier("050-1234567"), "t501234567@phone.kerem-toys.invalid");
  assert.equal(P.loginIdentifier("hello"), "hello");
  assert.ok(P.isPhoneLoginEmail("t501234567@phone.kerem-toys.invalid"));
  assert.ok(!P.isPhoneLoginEmail("dani@shop.co.il"));
});

await t("formatPhone: mobile and landline", () => {
  assert.equal(X.formatPhone("0501234567"), "050-1234567");
  assert.equal(X.formatPhone("+972 4 812 3456"), "04-8123456");
  assert.equal(X.formatPhone("12"), "");
});

const CARDS = [
  { rivhit_id: 1, name: "צעצועי רון", city: "חיפה", phone: "050-1234567", vat_number: "012345678" },
  { rivhit_id: 2, name: "מתנות טל", city: "", phone: "", vat_number: "511234567" },
  { rivhit_id: 3, name: "ללא מזהה", city: "", phone: "", vat_number: "0" },
  { rivhit_id: 4, name: "סניף שני", city: "עכו", phone: "0521112222", vat_number: "511234567" },
  { rivhit_id: 1, name: "צעצועי רון", city: "חיפה", phone: "050-1234567", vat_number: "012345678" },
];

await t("matchCards: by ח״פ (with or without the leading zero) or by phone; once per card", () => {
  assert.deepEqual(X.matchCards(CARDS, "12345678").map((c) => c.rivhit_id), [1]);
  assert.deepEqual(X.matchCards(CARDS, "012345678").map((c) => c.rivhit_id), [1]);
  assert.deepEqual(X.matchCards(CARDS, "+972-50-123-4567").map((c) => c.rivhit_id), [1]);
  assert.deepEqual(X.matchCards(CARDS, "51-123456-7").map((c) => c.rivhit_id), [2, 4]);
  assert.deepEqual(X.matchCards(CARDS, "052-111-2222").map((c) => c.rivhit_id), [4]);
});

await t("matchCards: nothing for junk, for '0', or for a number nobody has", () => {
  for (const s of ["", "0", "abc", "000", "053-9999999", "999999999"]) assert.deepEqual(X.matchCards(CARDS, s), [], s);
});

await t("maskName: recognisable, not readable", () => {
  assert.equal(X.maskName("צעצועי רון"), "צע••• ר••");
  assert.equal(X.maskName("א"), "א•");
  assert.equal(X.maskName(""), "");
  assert.ok(!X.maskName("מתנות טל").includes("מתנות"));
});

await t("names and password rules", () => {
  assert.equal(X.cleanName("  רון   כהן "), "רון כהן");
  assert.equal(X.cleanName("א".repeat(60)).length, 40);
  assert.ok(X.isAcceptablePassword("123456"));
  assert.ok(!X.isAcceptablePassword("12345"));
  assert.ok(!X.isAcceptablePassword("x".repeat(73)));
  assert.ok(!X.isAcceptablePassword(123456));
});

await t("ticket: valid round-trip; tampered, expired, re-signed with another key or junk → refused", async () => {
  const now = 1_800_000_000_000;
  const tk = await X.signTicket("k1", { r: 42, e: now + 60_000 });
  assert.deepEqual(await X.verifyTicket("k1", tk, now), { r: 42, e: now + 60_000 });
  assert.equal(await X.verifyTicket("k1", tk, now + 60_001), null, "expired");
  assert.equal(await X.verifyTicket("k2", tk, now), null, "other key");
  const [body, sig] = tk.split(".");
  const other = Buffer.from(JSON.stringify({ r: 43, e: now + 60_000 })).toString("base64url");
  assert.equal(await X.verifyTicket("k1", `${other}.${sig}`, now), null, "card swapped");
  assert.equal(await X.verifyTicket("k1", `${body}.${sig.slice(0, -1)}A`, now), null, "signature edited");
  for (const junk of [null, "", "a.b.c", "abc", 5, "x".repeat(500)]) assert.equal(await X.verifyTicket("k1", junk, now), null, String(junk));
});

await t("captcha acceptance is the same rule as public signup", () => {
  const cases = [
    null, {}, { success: false }, { success: true, hostname: "orikenenb-lgtm.github.io" },
    { success: true, hostname: "evil.com" }, { success: true, hostname: "localhost" },
    { success: true, hostname: "orikenenb-lgtm.github.io", action: "express" },
    { success: true, hostname: "orikenenb-lgtm.github.io", action: "signup" },
  ];
  for (const allowTest of [false, true]) for (const c of cases) {
    const o = { allowTest, expectedAction: "express" };
    assert.equal(X.isTurnstileVerifyAcceptable(c, o), S.isTurnstileVerifyAcceptable(c, o), JSON.stringify([c, allowTest]));
  }
  assert.equal(X.isTurnstileVerifyAcceptable({ success: true, hostname: "orikenenb-lgtm.github.io", action: "signup" }, { allowTest: false, expectedAction: "express" }), false, "a signup token cannot open the express door");
});

console.log(`\n${n} rivhit-express tests passed`);
