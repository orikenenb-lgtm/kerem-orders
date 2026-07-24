// Unit tests for lib/quantity.ts — run with `npm test` (plain node, no deps).
// The TS source is transpiled on the fly via a tiny strip (the file uses only
// erasable type syntax), so tests always run against the real implementation.
import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "../node_modules/typescript/lib/typescript.js";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "lib", "quantity.ts"), "utf8");
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const tmp = mkdtempSync(join(tmpdir(), "qty-"));
const mod = join(tmp, "quantity.mjs");
writeFileSync(mod, js);
const { resolveQuantity, describeQuantity, stepOf } = await import(pathToFileURL(mod).href);

const tray12 = { price: 12, display_qty: 12, display_name: "מגש", carton_qty: 144, min_order_qty: 1, order_step: 1, sell_by: "display" };
const unit = { price: 5, display_qty: 1, carton_qty: null, min_order_qty: 1, order_step: 1, sell_by: "unit" };

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("✓", name); };

t("0 clears the line", () => {
  const r = resolveQuantity(tray12, 0);
  assert.equal(r.units, 0);
  assert.equal(r.wasAdjusted, false);
  assert.equal(r.priceTotal, 0);
});

t("1 unit of a 12-tray rounds UP to one tray", () => {
  const r = resolveQuantity(tray12, 1);
  assert.equal(r.units, 12);
  assert.equal(r.displays, 1);
  assert.equal(r.wasAdjusted, true);
  assert.equal(r.priceTotal, 144);
});

t("7 units → 12 (below one step)", () => {
  assert.equal(resolveQuantity(tray12, 7).units, 12);
});

t("exactly on the boundary is untouched", () => {
  const r = resolveQuantity(tray12, 24);
  assert.equal(r.units, 24);
  assert.equal(r.displays, 2);
  assert.equal(r.wasAdjusted, false);
  assert.equal(r.priceTotal, 288);
});

t("13 → 24 (one over the boundary rounds up)", () => {
  assert.equal(resolveQuantity(tray12, 13).units, 24);
});

t("huge number is capped and still a step multiple", () => {
  const r = resolveQuantity(tray12, 10_000_000);
  assert.ok(r.units <= 999000 + 12);
  assert.equal(r.units % 12, 0);
});

t("negative clears", () => {
  assert.equal(resolveQuantity(tray12, -5).units, 0);
});

t("non-numeric clears", () => {
  assert.equal(resolveQuantity(tray12, "abc").units, 0);
  assert.equal(resolveQuantity(tray12, NaN).units, 0);
  assert.equal(resolveQuantity(tray12, undefined).units, 0);
});

t("fractional rounds down to int first, then up to step", () => {
  assert.equal(resolveQuantity(tray12, 12.9).units, 12);
});

t("min_order_qty is honored and step-aligned", () => {
  const p = { ...tray12, min_order_qty: 20 };
  const r = resolveQuantity(p, 1);
  assert.equal(r.units, 24); // max(1,20)→20, ceil to step 12 → 24
});

t("plain unit product is a no-op passthrough", () => {
  const r = resolveQuantity(unit, 7);
  assert.equal(r.units, 7);
  assert.equal(r.wasAdjusted, false);
  assert.equal(r.displays, 0);
  assert.equal(r.priceTotal, 35);
});

t("unit product with order_step 6 steps by 6", () => {
  const p = { ...unit, order_step: 6 };
  assert.equal(stepOf(p), 6);
  assert.equal(resolveQuantity(p, 7).units, 12);
});

t("cartons computed when carton_qty known", () => {
  const r = resolveQuantity(tray12, 144);
  assert.equal(r.cartons, 1);
});

t("garbage product fields fall back safely", () => {
  const p = { price: "8", display_qty: "x", order_step: null, sell_by: "display" };
  const r = resolveQuantity(p, 3);
  assert.equal(r.units, 3); // display_qty invalid → step 1
  assert.equal(r.priceTotal, 24);
});

t("describeQuantity dual display", () => {
  assert.equal(describeQuantity(tray12, 24), "2 מגשים (24 יח׳)");
  assert.equal(describeQuantity(tray12, 12), "1 מגש (12 יח׳)");
  assert.equal(describeQuantity(unit, 7), "7 יח׳");
});

t("agorot rounding is exact", () => {
  const p = { ...unit, price: 3.33 };
  assert.equal(resolveQuantity(p, 3).priceTotal, 9.99);
});

console.log(`\n${n} tests passed`);
