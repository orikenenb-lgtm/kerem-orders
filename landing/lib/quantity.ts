// Wave 3: single source of truth for order quantities.
//
// A product can be sold by unit, by display pack (מארז/מגש of display_qty
// units), or by carton. The SAME function normalizes a requested quantity
// everywhere it matters — product card, cart, checkout reconcile — so the
// three can never disagree. (A DB-side guard re-checks on insert when
// enforcement is enabled; the client is convenience, the server is truth.)

export type QuantityProduct = {
  price: number;
  display_qty?: number | null;
  display_name?: string | null;
  carton_qty?: number | null;
  min_order_qty?: number | null;
  order_step?: number | null;
  sell_by?: string | null;
  unit_name?: string | null;
};

export type ResolvedQuantity = {
  /** Final unit count after normalization (0 when the request clears the line). */
  units: number;
  /** How many whole display packs `units` makes (0 when not display-sold). */
  displays: number;
  /** Whole cartons, when carton_qty is known; null otherwise. */
  cartons: number | null;
  /** True when the request was rounded/raised. */
  wasAdjusted: boolean;
  /** Total price for `units` at the given per-unit price. */
  priceTotal: number;
  /** The step one +/- press moves by. */
  step: number;
};

const intOr = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
};

/** The quantity a single +/- press adds: a whole display for display-sold
 *  products, otherwise the product's order_step (default 1). */
export function stepOf(p: QuantityProduct): number {
  const displayQty = intOr(p.display_qty, 1);
  if ((p.sell_by === "display" || p.sell_by === "carton") && displayQty > 1) return displayQty;
  return intOr(p.order_step, 1);
}

export function resolveQuantity(p: QuantityProduct, requestedQty: unknown): ResolvedQuantity {
  const step = stepOf(p);
  const displayQty = intOr(p.display_qty, 1);
  const cartonQty = intOr(p.carton_qty, 0) || null;
  const minQty = Math.max(intOr(p.min_order_qty, 1), step);
  const price = Number(p.price) || 0;

  // Anything non-numeric, negative or zero clears the line (qty 0) — the UI
  // treats 0 as "remove", so garbage input can never create a broken order.
  const reqNum = Number(requestedQty);
  const requested = Number.isFinite(reqNum) ? Math.floor(reqNum) : 0;
  if (requested <= 0) {
    return { units: 0, displays: 0, cartons: cartonQty ? 0 : null, wasAdjusted: false, priceTotal: 0, step };
  }

  // Cap absurd input FIRST (so the cap can't break step alignment), then
  // always round UP to the step, never below the minimum.
  let units = Math.max(Math.min(requested, 999000), minQty);
  units = Math.ceil(units / step) * step;

  const displays = displayQty > 1 ? Math.floor(units / displayQty) : 0;
  const cartons = cartonQty ? Math.floor(units / cartonQty) : null;
  const priceTotal = Math.round(units * price * 100) / 100;

  return { units, displays, cartons, wasAdjusted: units !== requested, priceTotal, step };
}

/** "2 מארזים (24 יח׳)" / "24 יח׳" — the human description used in cards,
 *  cart lines and order summaries. */
export function describeQuantity(p: QuantityProduct, units: number): string {
  const displayQty = intOr(p.display_qty, 1);
  const name = (p.display_name || "מארז").trim() || "מארז";
  const unitWord = "יח׳";
  if (displayQty > 1 && units > 0 && units % displayQty === 0) {
    const packs = units / displayQty;
    const packWord = packs === 1 ? name : name + "ים";
    return `${packs.toLocaleString("he-IL")} ${packWord} (${units.toLocaleString("he-IL")} ${unitWord})`;
  }
  return `${units.toLocaleString("he-IL")} ${unitWord}`;
}
