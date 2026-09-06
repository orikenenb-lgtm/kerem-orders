// Feature flags for the 2026 upgrade waves.
//
// The site is a static export — flags are build-time constants. Turning one
// on is a one-line diff (false → true) + deploy; turning it off is the
// reverse. With every flag false the site must behave EXACTLY as before the
// upgrade — that invariant was checked at every wave's quality gate.
//
// Do not read these from env vars or the DB: a static page can't re-evaluate
// them per-request, and hidden runtime state would make "what is live right
// now?" unanswerable from the code alone.
//
// 2026-07-23: ALL flags turned ON with the owner's explicit approval
// ("תדליק את כל הדגלים"). Rollback per flag: docs/ROLLBACK.md.

export const featureFlags = {
  /** Wave 1: new clean login/landing screen (replaces the frame-scrub hero). */
  ff_new_landing: true,
  /** Wave 2: EXIF-orientation fix + WebP in the rivhit-img proxy pipeline. */
  ff_image_pipeline_v2: true,
  /** Wave 3: display/carton quantity model (display_qty, order_step, …). */
  ff_display_quantities: true,
  /** Wave 4: address fields (city/street/…) in the registration form. */
  ff_register_address: true,
  /** Wave 5: minimum-order progress bar + VAT breakdown in cart/checkout. */
  ff_min_order_vat_ui: true,
  /** Wave 6: accessibility widget + statement page.
   *  OFF per the owner's explicit request to remove the floating button.
   *  The statement page (/accessibility) is written to match this state —
   *  if this flag is ever turned back on, re-add the widget bullet there. */
  ff_a11y_widget: false,
  /** Wave 7: new visual theme (tokens.css). */
  ff_new_theme: true,
  /** 3B wave 1: the redesigned product card — a calm neutral frame (colour
   *  reserved for meaning, not a per-index rainbow border), barcode||sku on the
   *  code line (matching the Excel export), and a 2-line name clamp (the longest
   *  live product name is 54 chars). The headline price stays PER UNIT — the
   *  owner's standing decision; no whole-pack total is shown.
   *  DEFAULT OFF: with it off the card renders byte-identical to before, so
   *  merging this changes nothing in production until the owner flips it on
   *  after reviewing the staging screenshots. Rollback = set back to false. */
  ff_card_v2: true,
  /** 3B wave 2: at-a-glance in-cart state on the /catalog card — a corner
   *  "בעגלה · N" badge and a green ring on any product already in the cart, so
   *  the buyer sees what they added without opening the drawer. Pure
   *  presentation over the existing cart state; no change to the cart, the
   *  quantity model, or checkout. DEFAULT OFF; rollback = set back to false. */
  ff_card_incart: true,
  /** 3B wave 3: a price-bucket filter row on /catalog (עד ₪5 · ₪5–10 · … · ₪100+),
   *  buckets taken straight from the live price histogram. Browse mode only — it
   *  filters the existing PostgREST products query with gte/lt on price, adds no
   *  RPC argument and no DB change, and is hidden during a text search exactly
   *  like the category chips. DEFAULT OFF; rollback = set back to false. */
  ff_filters_v2: true,
  /** 3B wave 4: clearer cart lines — a per-line total (unit price × quantity)
   *  and an explicit × remove button (which just calls the existing
   *  remove-at-zero path). Presentation only inside the drawer; the submit /
   *  reconcile / checkout logic is untouched. DEFAULT OFF; rollback = false. */
  ff_cart_v2: true,
  /** 3B wave 5: mobile polish on /catalog — the floating cart button clears the
   *  iPhone home indicator (safe-area inset), the search field gets a real
   *  search keyboard that closes on Enter, and the first load shows skeleton
   *  cards instead of a bare "טוען מוצרים…" line. DEFAULT OFF; rollback = false. */
  ff_mobile_polish: true,
  /** 3B wave 5: micro-motion — a 120ms press/hover on the product card, CSS only
   *  (no framer-motion in the catalogue), and nothing animates on a price.
   *  globals.css already neutralises all motion under prefers-reduced-motion, so
   *  this inherits that automatically. DEFAULT OFF; rollback = false. */
  ff_micro_motion: true,
  /** 3B wave 6: 24 category chips do not fit a 390px phone, so the row collapses
   *  to the 6 largest plus an "עוד (N)" toggle that expands the rest in place.
   *  The selected category stays visible even while collapsed. An in-page expand,
   *  not a modal — no focus trap, no scroll lock, nothing to get stuck behind.
   *  DEFAULT OFF; rollback = set back to false. */
  ff_category_sheet: true,
  /** 3B wave 6: "הזמן שוב" on /account — loads a past order's lines back into
   *  the cart. Prices are RE-RESOLVED at today's prices through resolvePrice()
   *  and never taken from the stored order line, quantities are re-normalised to
   *  whole packs, and products that are no longer active are skipped and named.
   *  It only fills the cart — checkout still re-fetches and revalidates every
   *  line, so a stale price cannot survive to an order. DEFAULT OFF. */
  ff_reorder: true,
  /** Manager screen: on /admin/customers, opening a customer now also lists
   *  THEIR orders and what was in each one — date, status, per-line product,
   *  quantity, unit price and line total — plus a roll-up of the products that
   *  customer buys most. The owner could see "5 הזמנות · ₪18,300" but not what
   *  was in them without opening Supabase.
   *  Read-only, and it adds NO access: the existing RLS policies on orders and
   *  order_items already grant a manager SELECT over every row via is_manager().
   *  No database change. Loaded lazily per customer, so the list stays fast as
   *  order volume grows. DEFAULT ON at the owner's request; rollback = false. */
  ff_admin_customer_orders: true,
  /** A real delete control on each cart line: a 44px, red-tinted trash button
   *  instead of the 32px grey "×" glyph ff_cart_v2 shipped, which was easy to
   *  miss and easy to mis-tap. Because deleting a 120-unit line by accident is
   *  destructive and the old control offered no way back, the removal is now
   *  UNDOABLE — the removed line is held and one tap on "ביטול" restores it
   *  exactly, same product, same quantity, same price.
   *  It calls the SAME remove path the stepper already uses (quantity 0), so
   *  nothing new writes to the cart. DEFAULT ON at the owner's request;
   *  rollback = false, which returns the small "×". */
  ff_cart_delete_v2: true,
  /** Sales agents. The owner can mark a person as an agent and give them a
   *  personal ceiling (default 15%); that agent then gets ONE screen where they
   *  can set a customer's fixed discount, never above their own ceiling.
   *  The ceiling is enforced in the DATABASE (set_customer_discount + the
   *  protect_privileged_profile_cols trigger), so turning this flag off hides
   *  the screens but does not weaken the rule. Every change is written to
   *  discount_changes with who did it. DEFAULT ON at the owner's request. */
  ff_agent_discounts: true,
} as const;

export type FeatureFlag = keyof typeof featureFlags;
