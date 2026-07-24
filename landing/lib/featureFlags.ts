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
  /** Wave 6: accessibility widget + statement page. */
  ff_a11y_widget: false,
  /** Wave 7: new visual theme (tokens.css). */
  ff_new_theme: true,
} as const;

export type FeatureFlag = keyof typeof featureFlags;
