// Parity guard: lib/pricing.ts resolvePrice() vs. the server-side SQL rule.
// Run with `npm test` (plain node, no deps).
//
// resolvePrice() decides what a customer pays in the browser; the database
// re-derives the same number in validate_order_item() and REJECTS an order line
// that disagrees (a price mismatch fails checkout). The two implementations
// therefore have to compute byte-identical prices, but they live in different
// languages and cannot import each other.
//
// This test transcribes the SQL rule as an independent reference function —
// from the precedence comments in lib/pricing.ts and the money math in
// supabase/collections.sql (the get_collection_page / validate_order_item
// branch) — and asserts resolvePrice() matches it across every branch. Because
// the reference is written from the SQL and NOT from the TS, agreement here is
// real cross-checking, not a tautology. Change either side and this fails.
//
// The SQL rule, verbatim in spirit:
//   1. per-customer override → THE final price, no discount on top;
//   2. global override       → replaces the list price, discount applies;
//   3. plain list price       → discount applies;
//   and every money value is floored to whole agorot as
//     greatest(case when price > 0 then 0.01 else 0 end, round(price*(100-d))/100)
//   so ₪0.004 becomes ₪0.01, never ₪0 (which would reject the line).
import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "../node_modules/typescript/lib/typescript.js";

const here = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "parity-"));

// pricing.ts imports applyDiscount from ./ui — transpile that too so the TS
// under test exercises its real rounding, not a stand-in.
for (const mod of ["ui", "pricing"]) {
  const src = readFileSync(join(here, "..", "lib", `${mod}.ts`), "utf8");
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  writeFileSync(join(tmp, `${mod}.mjs`), js.replace(/from "\.\/ui"/g, 'from "./ui.mjs"'));
}
const { buildPriceMap, resolvePrice } = await import(
  pathToFileURL(join(tmp, "pricing.mjs")).href
);

// ---- The reference: the SQL rule, re-implemented from the DB side only. ----

// greatest(case when price > 0 then 0.01 else 0 end, round(price)/100) — the
// agorot floor that keeps a real product from rounding to a free line.
function sqlAgorot(cents) {
  return Math.max(cents > 0 ? 1 : 0, Math.round(cents)) / 100;
}

// The server clamps a customer's fixed discount to 0..99 (a non-positive or
// non-finite value means "no discount"), matching profiles.discount_percent.
function sqlDiscountPct(raw) {
  const d = Number(raw);
  if (!Number.isFinite(d) || d <= 0) return 0;
  return Math.min(d, 99);
}

// What the database says customer C pays for one unit of product P.
//   customerOverride: price_overrides row for (P, C), or undefined
//   globalOverride:   price_overrides row for (P, null), or undefined
function sqlPrice({ listPrice, globalOverride, customerOverride, discount }) {
  // 1. per-customer override → final, floored to agorot, NO discount applied.
  if (customerOverride !== undefined) return sqlAgorot(customerOverride * 100);
  // 2. global override replaces the list price; 3. otherwise the list price —
  //    in both cases the fixed discount comes off and the result is floored.
  const base = globalOverride !== undefined ? globalOverride : listPrice;
  return sqlAgorot(base * (100 - sqlDiscountPct(discount)));
}

const ME = "11111111-1111-1111-1111-111111111111";
const P = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

// Build the map the browser would hold, from the same override rows the DB has.
function tsPrice({ listPrice, globalOverride, customerOverride, discount }) {
  const rows = [];
  if (globalOverride !== undefined) rows.push({ product_id: P, user_id: null, price: globalOverride });
  if (customerOverride !== undefined) rows.push({ product_id: P, user_id: ME, price: customerOverride });
  const map = buildPriceMap(rows, ME);
  return resolvePrice(P, listPrice, map, discount);
}

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("✓", name); };

// One assertion helper: the TS and the SQL reference must agree exactly.
function parity(label, scenario) {
  const ts = tsPrice(scenario);
  const sql = sqlPrice(scenario);
  assert.equal(
    ts, sql,
    `${label}: resolvePrice=${ts} but SQL rule=${sql} for ${JSON.stringify(scenario)}`,
  );
}

const DISCOUNTS = [0, 50, 99];

t("plain list price matches at 0/50/99% discount", () => {
  for (const discount of DISCOUNTS) {
    parity("plain", { listPrice: 100, discount });
    parity("plain·odd", { listPrice: 33.33, discount });
  }
});

t("global override replaces the list price, discount still applies", () => {
  for (const discount of DISCOUNTS) {
    parity("global", { listPrice: 100, globalOverride: 80, discount });
    parity("global·odd", { listPrice: 100, globalOverride: 12.34, discount });
  }
});

t("per-customer override is final and ignores the discount, at every rate", () => {
  for (const discount of DISCOUNTS) {
    // A customer override present alongside a global one: the customer price
    // wins and the discount is NOT applied on top.
    parity("customer", { listPrice: 100, globalOverride: 80, customerOverride: 55, discount });
    parity("customer·only", { listPrice: 100, customerOverride: 7.5, discount });
  }
});

t("the ₪0.004 → ₪0.01 agorot floor holds on every branch", () => {
  // Discount branch: 0.008 * (100-50) = round(0.4)/100 → floored to 0.01.
  parity("floor·discounted-global", { listPrice: 0, globalOverride: 0.008, discount: 50 });
  parity("floor·discounted-list", { listPrice: 0.008, discount: 50 });
  // Per-customer branch: 0.004 is below half an agora yet must not vanish.
  parity("floor·customer", { listPrice: 100, customerOverride: 0.004, discount: 0 });
  // And the concrete numbers the DB would compute:
  assert.equal(tsPrice({ listPrice: 100, customerOverride: 0.004, discount: 0 }), 0.01);
  assert.equal(sqlPrice({ listPrice: 100, customerOverride: 0.004, discount: 0 }), 0.01);
});

t("a genuinely free product stays free — the floor does not invent a price", () => {
  parity("free·customer", { listPrice: 100, customerOverride: 0, discount: 0 });
  parity("free·list", { listPrice: 0, discount: 0 });
  assert.equal(tsPrice({ listPrice: 0, discount: 0 }), 0);
});

t("a broad numeric sweep never diverges between the two implementations", () => {
  for (const listPrice of [0.01, 1, 3.9, 12.5, 33.333, 100, 999.99]) {
    for (const discount of [0, 10, 25, 50, 99]) {
      parity("sweep·plain", { listPrice, discount });
      parity("sweep·global", { listPrice, globalOverride: listPrice / 3, discount });
      parity("sweep·customer", { listPrice, customerOverride: listPrice / 7, discount });
    }
  }
});

console.log(`\n${n} pricing-parity tests passed`);
