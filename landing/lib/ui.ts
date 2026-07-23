// Shared design tokens for the Kerem Toys app pages (RTL, rainbow system).
import type { CSSProperties } from "react";

// Wave 7 (ff_new_theme): color/shape tokens resolve through CSS variables
// declared in app/tokens.css. Each var's fallback AND its :root value are the
// historical literal, so with the flag off every computed style is exactly
// what it was before — the html.kt-theme-new class (layout.tsx) is the only
// thing that changes the resolved values.
export const tokens = {
  bg: "var(--kt-bg, #FFFFFF)",
  surface: "var(--kt-surface, #F7F7FB)",
  text: "var(--kt-text, #1A1730)",
  body: "var(--kt-body, #4B4860)",
  dim: "var(--kt-dim, #8B8898)",
  border: "var(--kt-border, rgba(26,23,48,0.08))",
  // NOTE: token values are var() strings — never build colors by string
  // concatenation (e.g. `${tokens.accent}14`); use rgba() literals for tints.
  accent: "var(--kt-accent, #8A3FFC)",
  radiusCard: "var(--kt-radius-card, 16px)",
  shadowCard: "var(--kt-shadow-card, 0 8px 24px rgba(26,23,48,0.05))",
  rainbow:
    "linear-gradient(90deg, #FF2E93, #FF8A00, #FFC400, #25C77E, #2E7DFF, #8A3FFC)",
  rainbowColors: ["#FF2E93", "#FF8A00", "#FFC400", "#25C77E", "#2E7DFF", "#8A3FFC"],
  rubik: "var(--font-rubik)",
  assistant: "var(--font-assistant)",
};

export const ils = (n: number) =>
  "₪" + Number(n || 0).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---- הנחה קבועה ללקוח (per-customer fixed discount) ----
// Single source of truth for discount math: the SAME functions are used when a
// price is shown, when it is stored into the cart, and when the checkout
// reconciles the cart against the DB — so the three can never disagree.

// Sanitize a raw discount value (from profiles.discount_percent): only a finite
// 0–99 number counts; anything else (missing column, null, garbage) means 0.
export const discountPct = (raw: unknown): number => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, 99);
};

// Apply a discount and round to whole agorot (2 decimals). With d=0 this is an
// identity for DB prices (which are already 2-decimal), so customers without a
// discount see byte-identical prices. A positive price never rounds below
// ₪0.01 — a discount must not turn a real product into a free line.
export const applyDiscount = (price: number, d: number): number => {
  const p = Number(price) || 0;
  const agorot = Math.round(p * (100 - discountPct(d)));
  return Math.max(p > 0 ? 1 : 0, agorot) / 100;
};

export function primaryBtn(busy: boolean): CSSProperties {
  return {
    fontFamily: tokens.rubik,
    fontWeight: 700,
    fontSize: "0.95rem",
    letterSpacing: "0.04em",
    color: "#fff",
    background: tokens.rainbow,
    border: "none",
    padding: "0.95rem 1.5rem",
    borderRadius: 999,
    cursor: busy ? "default" : "pointer",
    opacity: busy ? 0.7 : 1,
    marginTop: "0.4rem",
  };
}
