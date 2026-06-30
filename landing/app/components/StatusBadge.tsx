"use client";

import { tokens } from "../../lib/ui";

const STATUS_HE: Record<string, string> = {
  new: "התקבלה",
  processing: "בטיפול",
  done: "הושלמה",
  cancelled: "בוטלה",
};

export function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    new: "#2E7DFF",
    processing: "#FF8A00",
    done: "#25C77E",
    cancelled: "#8B8898",
  };
  const c = colors[status] ?? tokens.dim;
  return (
    <span
      style={{
        fontFamily: tokens.rubik,
        fontWeight: 700,
        fontSize: "0.75rem",
        color: c,
        background: `${c}18`,
        padding: "0.3rem 0.8rem",
        borderRadius: 999,
      }}
    >
      {STATUS_HE[status] ?? status}
    </span>
  );
}
