// Business configuration constants (Wave 1).
//
// The minimum-order SOURCE OF TRUTH is the DB (site_settings.min_order_total,
// manager-editable, enforced in the cart). MIN_ORDER_FALLBACK is only what a
// public page shows if that read fails — keep it matching the DB value.

export const MIN_ORDER_FALLBACK = 3500;

/** Israeli VAT rate — prices on the site already INCLUDE VAT. */
export const VAT_RATE = 0.18;

/** Business phone, displayed on the site; PHONE_TEL is the tel: href form. */
export const PHONE_DISPLAY = "050-852-4448";
export const PHONE_TEL = "0508524448";

export const BUSINESS_NAME = "כרם טויס";
export const BUSINESS_TAGLINE = "סיטונאות צעצועים ומתנות";
