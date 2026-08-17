// Price resolution — THE single place that decides what a customer pays.
//
// A manager can set a price either for everyone or for specific customers
// (admin → מחירים ללקוחות). Those live in the price_overrides table rather
// than products.price, because the Rivhit sync rewrites products.price every
// 15 minutes and would silently undo a manual edit.
//
// Order of precedence for customer C on product P:
//   1. override(P, C)     → THE final price. The customer's fixed discount is
//                           NOT applied on top: a price negotiated for this
//                           customer already is their price.
//   2. override(P, null)  → replaces the list price for everyone; the fixed
//                           discount still applies on top.
//   3. products.price     → discount applies (behaviour before this feature).
//
// The identical rule is implemented server-side in validate_order_item(), so
// an order line computed here always passes the integrity trigger. Change one
// and you MUST change the other.

import { applyDiscount } from "./ui";

export type PriceOverrideRow = {
  product_id: string;
  /** null = applies to every customer */
  user_id: string | null;
  price: number | string;
};

/** product_id → { mine?: number; all?: number } */
export type PriceMap = Map<string, { mine?: number; all?: number }>;

/**
 * Index override rows for lookup. `userId` identifies the current customer;
 * rows belonging to anyone else are ignored (RLS should never return them,
 * but the client must not depend on that for correctness).
 */
export function buildPriceMap(rows: PriceOverrideRow[], userId: string | null): PriceMap {
  const map: PriceMap = new Map();
  for (const r of rows ?? []) {
    const price = Number(r.price);
    if (!Number.isFinite(price) || price < 0) continue;
    const entry = map.get(r.product_id) ?? {};
    if (r.user_id === null) entry.all = price;
    else if (userId && r.user_id === userId) entry.mine = price;
    else continue;
    map.set(r.product_id, entry);
  }
  return map;
}

/**
 * Round to whole agorot, mirroring the SQL
 *   greatest(case when price > 0 then 0.01 else 0 end, round(price * 100) / 100)
 * exactly. The floor is decided by the ORIGINAL value, not the rounded one:
 * a price of ₪0.004 must become ₪0.01 (as the trigger computes), not ₪0 —
 * otherwise the line is rejected at checkout as a price mismatch.
 */
function money(n: number): number {
  const v = Number(n) || 0;
  return Math.max(v > 0 ? 1 : 0, Math.round(v * 100)) / 100;
}

/**
 * The price a given customer pays for one unit.
 * `discount` is the customer's fixed discount percent (0 when none).
 */
export function resolvePrice(
  productId: string,
  listPrice: number,
  map: PriceMap | null | undefined,
  discount: number
): number {
  const entry = map?.get(productId);
  // 1. set for this customer → final, no discount on top.
  if (entry?.mine !== undefined) return money(entry.mine);
  // 2. set for everyone → new list price, discount still applies.
  // 3. otherwise the synced Rivhit price.
  const base = entry?.all !== undefined ? entry.all : Number(listPrice) || 0;
  return applyDiscount(base, discount);
}

/**
 * True when this customer's price came from an override — the UI uses it to
 * label the line ("מחיר מיוחד") instead of showing a discount badge that
 * would be wrong.
 */
export function hasSpecialPrice(productId: string, map: PriceMap | null | undefined): boolean {
  return map?.get(productId)?.mine !== undefined;
}
