import type { CSSProperties } from "react";
import { tokens } from "../../../../lib/ui";

// The admin screens style inline. ghostBtn/selStyle are copied from
// app/admin/page.tsx so this screen matches the rest of ניהול; the rest are the
// stock-count screen's own phone-first sizes (main actions ≥ 48px tall).

export const OK = "#1A7A4D";
export const ERR = "#C0143C";
export const WARN = "#B45309";

export const ghostBtn: CSSProperties = {
  fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.9rem", color: tokens.accent,
  background: "#fff", border: `1px solid ${tokens.border}`, padding: "0.6rem 1.2rem", borderRadius: 999, cursor: "pointer",
};

export const selStyle: CSSProperties = {
  fontFamily: tokens.assistant, fontSize: "0.9rem", padding: "0.5rem 0.8rem", borderRadius: 10,
  border: `1px solid ${tokens.border}`, background: "#fff", color: tokens.text,
};

export const bigBtn = (disabled = false): CSSProperties => ({
  fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.1rem", minHeight: 56, padding: "0.7rem 1.4rem",
  borderRadius: 14, border: "none", cursor: disabled ? "not-allowed" : "pointer",
  background: disabled ? tokens.surface : tokens.accent, color: disabled ? tokens.dim : "#fff",
  width: "100%", boxShadow: disabled ? "none" : "0 4px 14px rgba(138,63,252,0.25)",
});

export const secondaryBtn: CSSProperties = {
  ...ghostBtn, minHeight: 48, fontSize: "1rem", padding: "0.6rem 1.1rem",
};

export const field: CSSProperties = {
  width: "100%", minHeight: 48, fontFamily: tokens.assistant, fontSize: "1.05rem", padding: "0.55rem 0.8rem",
  borderRadius: 12, border: `1px solid ${tokens.border}`, background: "#fff", color: tokens.text, boxSizing: "border-box",
};

export const labelStyle: CSSProperties = {
  display: "grid", gap: "0.3rem", fontFamily: tokens.assistant, fontSize: "0.92rem", color: tokens.body, fontWeight: 600,
};

export const card: CSSProperties = {
  border: `1px solid ${tokens.border}`, borderRadius: 16, background: "#fff", padding: "1rem",
};

export const note: CSSProperties = {
  fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.dim, margin: 0, lineHeight: 1.55,
};

export const msgStyle = (ok: boolean): CSSProperties => ({
  fontFamily: tokens.assistant, fontSize: "0.95rem", color: ok ? OK : ERR, margin: 0,
  background: ok ? "rgba(26,122,77,0.07)" : "rgba(192,20,60,0.06)",
  border: `1px solid ${ok ? "rgba(26,122,77,0.3)" : "rgba(192,20,60,0.3)"}`, borderRadius: 12, padding: "0.6rem 0.8rem",
});

export const h2: CSSProperties = {
  fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.15rem", color: tokens.text, margin: 0,
};

/** Colours per user label (טיוטה / ממתין לעדכון / מתעדכן / הושלם / דורש טיפול). */
export const labelColor: Record<string, { fg: string; bg: string }> = {
  "טיוטה": { fg: "#4B4860", bg: "rgba(75,72,96,0.08)" },
  "ממתין לעדכון": { fg: "#1D4ED8", bg: "rgba(29,78,216,0.08)" },
  "מתעדכן": { fg: "#7C3AED", bg: "rgba(124,58,237,0.08)" },
  "הושלם": { fg: OK, bg: "rgba(26,122,77,0.09)" },
  "דורש טיפול": { fg: ERR, bg: "rgba(192,20,60,0.08)" },
  "בוטלה": { fg: "#8B8898", bg: "rgba(139,136,152,0.1)" },
  "דולג": { fg: WARN, bg: "rgba(180,83,9,0.09)" },
  "הושלם (עם פריטים שדולגו)": { fg: OK, bg: "rgba(26,122,77,0.09)" },
};

export const pill = (label: string): CSSProperties => {
  const c = labelColor[label] ?? labelColor["טיוטה"];
  return {
    display: "inline-block", fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.8rem", color: c.fg, background: c.bg,
    borderRadius: 999, padding: "0.2rem 0.65rem", whiteSpace: "nowrap",
  };
};
