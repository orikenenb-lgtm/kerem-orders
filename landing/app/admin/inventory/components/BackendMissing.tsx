"use client";

import { tokens } from "../../../../lib/ui";
import { BACKEND_MISSING_TEXT } from "../../../../lib/inventory";

/** Calm, not an error: the migration / edge function is simply not installed yet. */
export default function BackendMissing() {
  return (
    <div role="status" data-testid="inv-backend-missing" style={{ border: `1px solid ${tokens.border}`, borderRadius: 16, background: tokens.surface, padding: "1rem 1.1rem", display: "grid", gap: "0.35rem" }}>
      <strong style={{ fontFamily: tokens.rubik, fontSize: "1.05rem", color: tokens.text }}>{BACKEND_MISSING_TEXT}</strong>
      <span style={{ fontFamily: tokens.assistant, fontSize: "0.9rem", color: tokens.body }}>
        המסך מוכן; ברגע שהעדכון יותקן בשרת אפשר יהיה להתחיל לספור. שום דבר לא נשמר ושום דבר לא נשלח לרווחית.
      </span>
    </div>
  );
}
