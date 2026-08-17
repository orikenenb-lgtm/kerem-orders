// Unit tests for lib/pricing.ts — run with `npm test` (plain node, no deps).
// These encode the SAME rules validate_order_item() enforces in the database;
// if one side changes, these tests must fail.
import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "../node_modules/typescript/lib/typescript.js";

const here = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "pricing-"));

// pricing.ts imports applyDiscount from ./ui — transpile that too so the test
// exercises the real rounding rules rather than a stand-in.
for (const mod of ["ui", "pricing"]) {
  const src = readFileSync(join(here, "..", "lib", `${mod}.ts`), "utf8");
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  writeFileSync(join(tmp, `${mod}.mjs`), js.replace(/from "\.\/ui"/g, 'from "./ui.mjs"'));
}
const { buildPriceMap, resolvePrice, hasSpecialPrice } = await import(
  pathToFileURL(join(tmp, "pricing.mjs")).href
);

const ME = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const P = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("✓", name); };

t("no overrides → list price with discount", () => {
  const map = buildPriceMap([], ME);
  assert.equal(resolvePrice(P, 100, map, 0), 100);
  assert.equal(resolvePrice(P, 100, map, 10), 90);
});

t("null map behaves like no overrides", () => {
  assert.equal(resolvePrice(P, 50, null, 0), 50);
  assert.equal(resolvePrice(P, 50, undefined, 20), 40);
});

t("global override replaces the list price and discount still applies", () => {
  const map = buildPriceMap([{ product_id: P, user_id: null, price: 80 }], ME);
  assert.equal(resolvePrice(P, 100, map, 0), 80);
  assert.equal(resolvePrice(P, 100, map, 25), 60);
});

t("customer price wins over global AND ignores the discount", () => {
  const map = buildPriceMap([
    { product_id: P, user_id: null, price: 80 },
    { product_id: P, user_id: ME, price: 55 },
  ], ME);
  assert.equal(resolvePrice(P, 100, map, 50), 55);
  assert.equal(hasSpecialPrice(P, map), true);
});

t("another customer's price is never applied to me", () => {
  const map = buildPriceMap([{ product_id: P, user_id: OTHER, price: 1 }], ME);
  assert.equal(resolvePrice(P, 100, map, 0), 100);
  assert.equal(hasSpecialPrice(P, map), false);
});

t("anonymous viewer (no userId) only sees global rows", () => {
  const map = buildPriceMap([
    { product_id: P, user_id: null, price: 70 },
    { product_id: P, user_id: ME, price: 5 },
  ], null);
  assert.equal(resolvePrice(P, 100, map, 0), 70);
});

t("garbage rows are ignored, not crashed on", () => {
  const map = buildPriceMap([
    { product_id: P, user_id: null, price: "not a number" },
    { product_id: P, user_id: null, price: -5 },
  ], ME);
  assert.equal(resolvePrice(P, 100, map, 0), 100);
});

t("numeric strings from postgres are accepted", () => {
  const map = buildPriceMap([{ product_id: P, user_id: ME, price: "12.50" }], ME);
  assert.equal(resolvePrice(P, 100, map, 0), 12.5);
});

t("a free product stays free; a paid one never rounds to zero", () => {
  const zero = buildPriceMap([{ product_id: P, user_id: ME, price: 0 }], ME);
  assert.equal(resolvePrice(P, 100, zero, 0), 0);
  const tiny = buildPriceMap([{ product_id: P, user_id: ME, price: 0.004 }], ME);
  assert.equal(resolvePrice(P, 100, tiny, 0), 0.01);
});

t("rounding matches the DB rule (round to agorot)", () => {
  const map = buildPriceMap([{ product_id: P, user_id: null, price: 33.333 }], ME);
  // round(33.333 * (100-10)) / 100 = round(2999.97)/100 = 30.00
  assert.equal(resolvePrice(P, 0, map, 10), 30);
});

console.log(`\n${n} pricing tests passed`);
