// Shared design tokens for the Kerem Toys app pages (RTL, rainbow system).
import type { CSSProperties } from "react";

export const tokens = {
  bg: "#FFFFFF",
  surface: "#F7F7FB",
  text: "#1A1730",
  body: "#4B4860",
  dim: "#8B8898",
  border: "rgba(26,23,48,0.08)",
  accent: "#8A3FFC",
  rainbow:
    "linear-gradient(90deg, #FF2E93, #FF8A00, #FFC400, #25C77E, #2E7DFF, #8A3FFC)",
  rainbowColors: ["#FF2E93", "#FF8A00", "#FFC400", "#25C77E", "#2E7DFF", "#8A3FFC"],
  rubik: "var(--font-rubik)",
  assistant: "var(--font-assistant)",
};

export const ils = (n: number) =>
  "₪" + Number(n || 0).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
