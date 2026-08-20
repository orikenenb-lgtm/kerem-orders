"use client";

import { tokens } from "../../lib/ui";

const STATUS_HE: Record<string, string> = {
  new: "התקבלה",
  processing: "בטיפול",
  done: "הושלמה",
  cancelled: "בוטלה",
};

// Two colours per status, not one.
//
// The badge used to draw its text in the same hue as its background tint
// (`${c}18`), which measured 2.04:1 to 3.42:1 — every state failed the 4.5:1
// minimum at 12px/700. Order status is the single most-scanned thing on both
// the admin list and "ההזמנות שלי", so it was the least readable element on the
// screen it matters most. `tint` keeps the original look; `ink` is a darkened
// version of the same hue, measured against that exact tint.
const STYLES: Record<string, { ink: string; tint: string }> = {
  new: { ink: "#1B4FA8", tint: "#EBF3FF" }, // 6.88:1
  processing: { ink: "#8A4A00", tint: "#FFF4E7" }, // 6.32:1
  done: { ink: "#0F7A4C", tint: "#EAFAF3" }, // 4.98:1
  cancelled: { ink: "#5C5A66", tint: "#F4F4F5" }, // 6.14:1
};

export function StatusBadge({ status }: { status: string }) {
  // The fallback is a literal pair, never a string-concatenated `var(--…)18`
  // — that produced an invalid declaration and a transparent badge.
  const { ink, tint } = STYLES[status] ?? { ink: tokens.body, tint: "#F4F4F5" };
  return (
    <span
      style={{
        fontFamily: tokens.rubik,
        fontWeight: 700,
        fontSize: "0.75rem",
        color: ink,
        background: tint,
        padding: "0.3rem 0.8rem",
        borderRadius: 999,
      }}
    >
      {STATUS_HE[status] ?? status}
    </span>
  );
}
