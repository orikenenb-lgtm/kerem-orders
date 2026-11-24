// Unit tests for lib/inventory.ts (stock count helpers) — plain node, no deps.
// The TS source is transpiled on the fly so the tests always run against the
// real implementation. Also checks that the self-hosted scanner wasm in
// public/zxing/ is byte-for-byte the one the installed zxing-wasm expects.
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "../node_modules/typescript/lib/typescript.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const src = readFileSync(join(root, "lib", "inventory.ts"), "utf8");
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const tmp = mkdtempSync(join(tmpdir(), "inv-"));
const mod = join(tmp, "inventory.mjs");
writeFileSync(mod, js);
const inv = await import(pathToFileURL(mod).href);

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("✓", name); };

// ---- normalizeCode
t("normalizeCode keeps leading zeros and returns text", () => {
  const r = inv.normalizeCode("0071234567892");
  assert.deepEqual(r, { ok: true, code: "0071234567892" });
  assert.equal(typeof r.code, "string");
});
t("normalizeCode trims scanner CR/LF and spaces", () => {
  assert.deepEqual(inv.normalizeCode("  7290000000017\r\n"), { ok: true, code: "7290000000017" });
  assert.deepEqual(inv.normalizeCode("‎123-AB\t"), { ok: true, code: "123-AB" });
});
t("normalizeCode refuses empty, too long and bad charset (Hebrew errors)", () => {
  for (const bad of ["", "   ", null, undefined]) {
    const r = inv.normalizeCode(bad);
    assert.equal(r.ok, false);
    assert.match(r.error, /ברקוד/);
  }
  assert.equal(inv.normalizeCode("1".repeat(33)).ok, false);
  assert.equal(inv.normalizeCode("1".repeat(32)).ok, true);
  assert.equal(inv.normalizeCode("12 34").ok, false);
  assert.equal(inv.normalizeCode("12%34").ok, false);
  assert.equal(inv.normalizeCode("קוד").ok, false);
});

// ---- isWedgeBurst
const times = (n, gap, start = 1000) => Array.from({ length: n }, (_, i) => start + i * gap);
t("isWedgeBurst: a scanner (13 chars, 10 ms apart) is a burst", () => {
  assert.equal(inv.isWedgeBurst(times(13, 10), "7290000000017"), true);
});
t("isWedgeBurst: a person typing (150 ms) is not", () => {
  assert.equal(inv.isWedgeBurst(times(13, 150), "7290000000017"), false);
});
t("isWedgeBurst: short quantity typed fast is not a scan", () => {
  assert.equal(inv.isWedgeBurst(times(3, 5), "120"), false);
  assert.equal(inv.isWedgeBurst(times(7, 5), "1234567", 8), false);
});
t("isWedgeBurst: one long pause inside breaks the burst", () => {
  const ts = times(10, 10);
  ts[5] += 300; for (let i = 6; i < 10; i++) ts[i] += 300;
  assert.equal(inv.isWedgeBurst(ts, "1234567890"), false);
});
t("isWedgeBurst: mismatched lengths / time going back are refused", () => {
  assert.equal(inv.isWedgeBurst(times(5, 10), "1234567890"), false);
  assert.equal(inv.isWedgeBurst([10, 5, 20, 30, 40, 50], "123456"), false);
});

// ---- parseCount / resolveTotal
t("parseCount accepts 0..10,000,000 integers", () => {
  assert.deepEqual(inv.parseCount("0"), { ok: true, value: 0 });
  assert.deepEqual(inv.parseCount(" 120 "), { ok: true, value: 120 });
  assert.deepEqual(inv.parseCount("1,200"), { ok: true, value: 1200 });
  assert.deepEqual(inv.parseCount("10000000"), { ok: true, value: 10000000 });
  assert.deepEqual(inv.parseCount("007"), { ok: true, value: 7 });
  assert.deepEqual(inv.parseCount("12.0"), { ok: true, value: 12 });
});
t("parseCount refuses with Hebrew errors", () => {
  const cases = { "": /הזינו כמות/, "-3": /שלילית/, "1.5": /שלם/, "abc": /ספרות/, "10000001": /גדולה מדי/, "7290000000017": /גדולה מדי/, "1e3": /ספרות/ };
  for (const [raw, re] of Object.entries(cases)) {
    const r = inv.parseCount(raw);
    assert.equal(r.ok, false, raw);
    assert.match(r.error, re, raw);
  }
});
t("resolveTotal: replace vs add, never silently doubled", () => {
  assert.deepEqual(inv.resolveTotal("replace", 40, 12), { ok: true, value: 12 });
  assert.deepEqual(inv.resolveTotal("add", 40, 12), { ok: true, value: 52 });
  assert.deepEqual(inv.resolveTotal("add", null, 12), { ok: true, value: 12 });
  assert.equal(inv.resolveTotal("add", 9_999_999, 2).ok, false);
});

// ---- diffs
t("diff helpers", () => {
  assert.equal(inv.diffOf(8, 10), -2);
  assert.equal(inv.diffTone(-2), "neg");
  assert.equal(inv.diffTone(3), "pos");
  assert.equal(inv.diffTone(0), "zero");
  assert.equal(inv.formatSigned(5), "+5");
  assert.equal(inv.formatSigned(-1200), `-${(1200).toLocaleString("he-IL")}`);
  assert.equal(inv.formatSigned(0), "0");
});
t("isHighlighted uses |diff| >= threshold and never highlights 0", () => {
  assert.equal(inv.isHighlighted(20, 20), true);
  assert.equal(inv.isHighlighted(-20, 20), true);
  assert.equal(inv.isHighlighted(19, 20), false);
  assert.equal(inv.isHighlighted(0, 0), false);
  assert.equal(inv.isHighlighted(1, null), true);
});
t("summarizeDiffs uses Rivhit's captured quantity; unverified lines are left out", () => {
  const s = inv.summarizeDiffs([
    { counted_qty: 10, baseline_qty: 99, rivhit_baseline_qty: 10 },
    { counted_qty: 50, baseline_qty: 10, rivhit_baseline_qty: 10 },
    { counted_qty: 5, baseline_qty: 10, rivhit_baseline_qty: 10 },
    { counted_qty: 7, baseline_qty: 1, rivhit_baseline_qty: null },
    { counted_qty: 7, baseline_qty: 1 },
  ], 20);
  assert.deepEqual(s, { lines: 5, up: 1, down: 1, same: 1, highlighted: 1, netUnits: 35, unverified: 2 });
});
t("the reviewer's example: site 8, Rivhit 10, counted 8 → -2, not 'no difference'", () => {
  const line = { counted_qty: 8, baseline_qty: 8, rivhit_baseline_qty: 10 };
  assert.equal(inv.rivhitDiff(line), -2);
  const s = inv.summarizeDiffs([line], 20);
  assert.equal(s.down, 1);
  assert.equal(s.same, 0);
  assert.equal(inv.rivhitDiff({ counted_qty: 8, rivhit_baseline_qty: null }), null);
  assert.equal(inv.UNVERIFIED_REVIEW_TEXT, "לא אומת מול רווחית — יסומן 'ספור מחדש' ולא יעודכן");
});

// ---- status labels
t("count statuses map to the 5 user labels", () => {
  assert.equal(inv.countStatusLabel("draft"), "טיוטה");
  assert.equal(inv.countStatusLabel("approved"), "ממתין לעדכון");
  assert.equal(inv.countStatusLabel("syncing"), "מתעדכן");
  assert.equal(inv.countStatusLabel("done"), "הושלם");
  assert.equal(inv.countStatusLabel("needs_attention"), "דורש טיפול");
  assert.equal(inv.countStatusLabel("cancelled"), "בוטלה");
});
t("line sync statuses map to the 5 user labels", () => {
  const L = (s, c = "syncing") => inv.lineStatusLabel(s, c);
  assert.equal(L("pending", "draft"), "טיוטה");
  assert.equal(L("pending"), "ממתין לעדכון");
  assert.equal(L("in_progress"), "מתעדכן");
  assert.equal(L("sent"), "מתעדכן");
  assert.equal(L("done"), "הושלם");
  assert.equal(L("no_change"), "הושלם");
  for (const s of ["unknown", "failed", "changed"]) assert.equal(L(s), "דורש טיפול");
  const all = new Set(Object.values(inv.LABELS));
  assert.equal(all.size, 5);
});
t("lineAttention gives reason + action", () => {
  assert.equal(inv.lineAttention("changed").action, "recount");
  assert.equal(inv.lineAttention("changed").actionLabel, "ספור מחדש");
  assert.equal(inv.lineAttention("unknown").action, "recheck");
  assert.equal(inv.lineAttention("unknown").actionLabel, "בדיקה חוזרת");
  const f = inv.lineAttention("failed", "פריט לא קיים");
  assert.equal(f.action, "none");
  assert.match(f.reason, /פריט לא קיים/);
  assert.equal(inv.lineAttention("done"), null);
});
t("editStatusLabel", () => {
  assert.equal(inv.editStatusLabel("pending"), "ממתין לעדכון");
  assert.equal(inv.editStatusLabel("in_progress"), "מתעדכן");
  assert.equal(inv.editStatusLabel("done"), "הושלם");
  assert.equal(inv.editStatusLabel("unknown"), "דורש טיפול");
  assert.equal(inv.editStatusLabel("failed"), "דורש טיפול");
});

// ---- RPC errors
const E = (message, code = "P0001") => inv.parseRpcError({ message, code });
t("parseRpcError: INV_CONFLICT shapes", () => {
  assert.deepEqual(E("INV_CONFLICT:37:4"), { kind: "conflict", qty: 37, status: null, version: 4 });
  assert.deepEqual(E("INV_CONFLICT:approved:2"), { kind: "conflict", qty: null, status: "approved", version: 2 });
  assert.deepEqual(E("INV_CONFLICT"), { kind: "conflict", qty: null, status: null, version: null });
  assert.match(inv.rpcErrorText(E("INV_CONFLICT:37:4")), /37/);
});
t("parseRpcError: the other contract codes", () => {
  const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
  assert.deepEqual(E(`INV_ACTIVE_EXISTS:${id}`), { kind: "active_exists", countId: id });
  assert.deepEqual(E("INV_DUPLICATE_CODE:רובוט צהוב 72 יח"), { kind: "duplicate_code", productName: "רובוט צהוב 72 יח" });
  assert.deepEqual(E("להנהלה בלבד"), { kind: "forbidden" });
  assert.deepEqual(E(`INV_EDIT_PENDING:${id}`), { kind: "edit_pending", requestId: id });
  assert.deepEqual(E("INV_NOT_DRAFT:approved"), { kind: "not_draft", status: "approved" });
  assert.deepEqual(E("INV_BAD_INPUT:note"), { kind: "bad_input", field: "note" });
  assert.deepEqual(E("INV_BAD_CODE"), { kind: "bad_code" });
  assert.deepEqual(E("INV_BAD_QTY"), { kind: "bad_qty" });
  assert.deepEqual(E("INV_NOT_FOUND"), { kind: "not_found" });
  assert.deepEqual(E("INV_PRODUCT_UNAVAILABLE"), { kind: "product_unavailable" });
  assert.deepEqual(E("INV_EMPTY"), { kind: "empty" });
  assert.deepEqual(E("INV_NO_CHANGE"), { kind: "no_change" });
  for (const k of ["INV_EMPTY", "INV_NO_CHANGE", "INV_BAD_QTY", "INV_NOT_DRAFT:done", "להנהלה בלבד"]) {
    assert.match(inv.rpcErrorText(E(k)), /[֐-׿]/, k);
  }
});
t("parseRpcError: network vs server", () => {
  assert.deepEqual(inv.parseRpcError({ message: "TypeError: Failed to fetch", code: "" }), { kind: "network" });
  assert.deepEqual(inv.parseRpcError({ message: "x", code: "", status: 0 }), { kind: "network" });
  assert.equal(inv.isNetworkError({ message: "INV_CONFLICT", code: "P0001" }), false);
  assert.equal(E("something odd").kind, "other");
});

// ---- pending entries
function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}
t("pending entries: put / load / replace / remove", () => {
  const s = memStorage();
  const e = { countId: "c1", productId: "p1", name: "א", qty: 5, expectedVersion: null, code: "007", at: 2 };
  assert.equal(inv.putPending(s, e), true);
  inv.putPending(s, { ...e, productId: "p2", at: 1 });
  inv.putPending(s, { ...e, countId: "c2" });
  assert.deepEqual(inv.loadPending(s, "c1").map((x) => x.productId), ["p2", "p1"]);
  inv.putPending(s, { ...e, qty: 9 });
  assert.equal(inv.loadPending(s, "c1").find((x) => x.productId === "p1").qty, 9);
  assert.equal(inv.loadPending(s, "c1").find((x) => x.productId === "p1").code, "007");
  inv.removePending(s, "c1", "p1");
  assert.deepEqual(inv.loadPending(s, "c1").map((x) => x.productId), ["p2"]);
  inv.removePending(s, "c1", "p2");
  inv.removePending(s, "c2", "p1");
  assert.equal(s.getItem(inv.PENDING_KEY), null);
});
t("pending entries survive garbage and missing/throwing storage", () => {
  const s = memStorage();
  s.setItem(inv.PENDING_KEY, "{not json");
  assert.deepEqual(inv.loadPending(s, "c1"), []);
  s.setItem(inv.PENDING_KEY, JSON.stringify([{ countId: "c1", productId: "p", qty: -1 }, { countId: "c1", productId: "q", qty: 3, at: 1 }]));
  assert.deepEqual(inv.loadPending(s, "c1").map((x) => x.productId), ["q"]);
  assert.deepEqual(inv.loadPending(null, "c1"), []);
  const throwing = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); }, removeItem() { throw new Error("denied"); } };
  assert.deepEqual(inv.loadPending(throwing, "c1"), []);
  assert.equal(inv.putPending(throwing, { countId: "c", productId: "p", name: "", qty: 1, expectedVersion: null, code: null, at: 1 }), false);
});

// ---- item edit
t("buildItemEdit: only changed fields are sent; sku cannot be cleared", () => {
  const cur = { name: "רובוט", barcode: "", sku: "0071234567892" };
  const r = inv.buildItemEdit(cur, { name: "רובוט ", barcode: "123", sku: "0071234567892" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.params, { p_new_name: null, p_new_barcode: "123", p_new_sku: null });
  assert.deepEqual(r.changed, ["barcode"]);
  const clear = inv.buildItemEdit({ ...cur, barcode: "555" }, { name: "רובוט", barcode: "", sku: cur.sku });
  assert.deepEqual(clear.params, { p_new_name: null, p_new_barcode: "", p_new_sku: null });
  assert.equal(inv.buildItemEdit(cur, { name: "רובוט", barcode: "", sku: "" }).ok, false);
  assert.equal(inv.buildItemEdit(cur, { name: "רובוט", barcode: "", sku: cur.sku }).ok, false);
  assert.equal(inv.buildItemEdit(cur, { name: "", barcode: "", sku: cur.sku }).ok, false);
  assert.equal(inv.buildItemEdit(cur, { name: "x", barcode: "1".repeat(16), sku: cur.sku }).ok, false);
  const nm = inv.buildItemEdit(cur, { name: "רובוט חדש", barcode: "", sku: cur.sku });
  assert.deepEqual(nm.params, { p_new_name: "רובוט חדש", p_new_barcode: null, p_new_sku: null });
});

t("closing a stuck item-edit request", () => {
  for (const st of ["pending", "unknown", "failed"]) assert.equal(inv.canCloseEdit(st), true, st);
  for (const st of ["in_progress", "done", "cancelled"]) assert.equal(inv.canCloseEdit(st), false, st);
  assert.equal(inv.editStatusLabel("cancelled"), "בוטלה");
  assert.match(inv.CLOSE_EDIT_WARNING, /ייתכן שהשינוי כבר קיים ברווחית/);
  assert.deepEqual(E("INV_NOT_RESOLVABLE:done"), { kind: "not_resolvable", countStatus: "done", lineStatus: null });
  assert.match(inv.rpcErrorText(E("INV_NOT_RESOLVABLE:done")), /הבקשה/);
  assert.equal(inv.eventLabel("item_edit_cancelled"), "בקשת עריכה נסגרה (החלטת מנהל)");
});

t("misc: shortId, formatWhen, eventLabel", () => {
  assert.equal(inv.shortId("0f8fad5b-d9cb-469f-a165-70867728950e"), "0f8fad5b");
  assert.equal(inv.formatWhen(null), "—");
  assert.match(inv.formatWhen("2026-11-24T10:05:00Z"), /24/);
  assert.equal(inv.eventLabel("line_saved"), "כמות נשמרה");
  assert.equal(inv.eventLabel("weird_kind"), "weird_kind");
});

// ---- Addendum 1
t("R2: skipped lines, done-with-skips label, skip rules and note", () => {
  assert.equal(inv.lineStatusLabel("skipped", "done"), "דולג");
  assert.equal(inv.lineStatusLabel("skipped", "needs_attention"), "דולג");
  assert.equal(inv.countStatusLabel("done", true), "הושלם (עם פריטים שדולגו)");
  assert.equal(inv.countStatusLabel("done", false), "הושלם");
  assert.equal(inv.countStatusLabel("needs_attention", true), "דורש טיפול");
  for (const st of ["failed", "unknown", "changed"]) assert.equal(inv.canSkipLine(st, "needs_attention"), true, st);
  assert.equal(inv.canSkipLine("pending", "needs_attention"), false);
  assert.equal(inv.canSkipLine("failed", "syncing"), false);
  assert.equal(inv.SKIP_WARNING, "הפריט לא יעודכן בספירה הזו. אם הסטטוס היה 'דורש בדיקה' — ייתכן שתעודה כבר נוצרה ברווחית; בדקו ברווחית ידנית");
  assert.equal(inv.validateSkipNote(" ab ").ok, false);
  assert.deepEqual(inv.validateSkipNote(" abc "), { ok: true, note: "abc" });
  assert.equal(inv.validateSkipNote("x".repeat(501)).ok, false);
  assert.deepEqual(E("INV_NOT_RESOLVABLE:done:skipped"), { kind: "not_resolvable", countStatus: "done", lineStatus: "skipped" });
  assert.match(inv.rpcErrorText(E("INV_NOT_RESOLVABLE:done:skipped")), /דולג/);
});
t("R8: plausibility limit is max(1000, 10 × record)", () => {
  assert.equal(inv.isImplausibleCount(1000, 0), false);
  assert.equal(inv.isImplausibleCount(1001, 0), true);
  assert.equal(inv.isImplausibleCount(500777, 40), true);
  assert.equal(inv.isImplausibleCount(400, 40), false);
  assert.equal(inv.isImplausibleCount(5000, 500), false);
  assert.equal(inv.isImplausibleCount(5001, 500), true);
  assert.equal(inv.isImplausibleCount(1001, -30), true);
  assert.equal(inv.IMPLAUSIBLE_CONFIRM, "הכמות גבוהה מאוד — לאשר?");
});
t("backend not installed is recognised, and is not a network error", () => {
  const miss = (e) => inv.parseRpcError(e).kind;
  assert.equal(miss({ code: "PGRST202", message: "Could not find the function public.inv_lookup", status: 404 }), "missing_backend");
  assert.equal(miss({ code: "PGRST205", message: "Could not find the table 'public.inventory_counts'", status: 404 }), "missing_backend");
  assert.equal(miss({ code: "42P01", message: "relation \"inventory_counts\" does not exist" }), "missing_backend");
  assert.equal(miss({ code: "P0001", message: "INV_NOT_FOUND", status: 400 }), "not_found");
  assert.equal(inv.rpcErrorText({ kind: "missing_backend" }), "ספירת המלאי עדיין לא הופעלה בשרת.");
});
t("history: simulation suffix, never 'ברווחית ובאתר' for a simulated edit", () => {
  assert.equal(inv.eventLabelFor("line_skipped", {}), "פריט דולג (החלטת מנהל)");
  assert.equal(inv.eventLabelFor("line_failed", { mode: "simulation" }), "העדכון נדחה ברווחית (סימולציה)");
  const sim = inv.eventLabelFor("item_edit_done", { mode: "simulation" });
  assert.ok(!sim.includes("ברווחית ובאתר"), sim);
  assert.match(sim, /סימולציה/);
  assert.equal(inv.eventLabelFor("count_opened", null), "הספירה נפתחה");
});

// ---- self-hosted scanner wasm
t("public/zxing wasm matches the installed zxing-wasm (sha256)", () => {
  const wasm = join(root, "public", "zxing", "zxing_reader.wasm");
  assert.ok(existsSync(wasm), "public/zxing/zxing_reader.wasm is missing");
  const actual = createHash("sha256").update(readFileSync(wasm)).digest("hex");
  const pkgJs = readFileSync(join(root, "node_modules", "zxing-wasm", "dist", "es", "reader", "index.js"), "utf8");
  // ZXING_WASM_SHA256 is exported by zxing-wasm/reader; read it from the bundle
  // without importing (the module needs a browser-ish runtime).
  const exportName = pkgJs.match(/(\w+) as ZXING_WASM_SHA256/)?.[1];
  assert.ok(exportName, "zxing-wasm no longer exports ZXING_WASM_SHA256");
  const expected = pkgJs.match(new RegExp(`\\b${exportName}\\s*=\\s*"([0-9a-f]{64})"`))?.[1];
  assert.ok(expected, "could not read ZXING_WASM_SHA256");
  assert.equal(actual, expected, "public/zxing wasm is stale: copy node_modules/zxing-wasm/dist/reader/zxing_reader.wasm");
  const shipped = readFileSync(join(root, "node_modules", "zxing-wasm", "dist", "reader", "zxing_reader.wasm"));
  assert.equal(createHash("sha256").update(shipped).digest("hex"), expected);
});

console.log(`\n${n} inventory tests passed`);
