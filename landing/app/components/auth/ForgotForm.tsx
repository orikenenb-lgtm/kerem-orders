"use client";

// "שכחתי סיסמה" — the third tab of the single customer entry screen. Sends
// the reset email; the link inside it opens /reset/, which stays a page of
// its own because it is reached from the email, never handed out by hand.

import { useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { authErrorHe } from "../../../lib/authErrors";
import { tokens, primaryBtn, linkBtn } from "../../../lib/ui";
import type { AuthTab } from "./AuthShell";

export default function ForgotForm({ onSwitch }: { onSwitch: (t: AuthTab) => void }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      // Absolute URL back to /reset, honoring the GitHub Pages basePath.
      const base = process.env.NEXT_PUBLIC_BASE_PATH || "";
      const redirectTo = `${window.location.origin}${base}/reset/`;
      const { error: err } = await supabase.auth.resetPasswordForEmail(
        email.trim().toLowerCase(),
        { redirectTo }
      );
      if (err) {
        setError(authErrorHe(err.message));
        setBusy(false);
        return;
      }
      // Always report success — never reveal whether an address is registered.
      setSent(true);
    } catch {
      setError("שגיאת רשת. בדקו את החיבור ונסו שוב.");
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <>
        <p role="status" aria-live="polite" style={{ fontFamily: tokens.assistant, color: tokens.body, lineHeight: 1.7, marginBottom: "1.4rem" }}>
          ✉️ אם קיים חשבון עם הכתובת הזו — נשלח אליה מייל עם קישור לאיפוס הסיסמה.
          בדקו גם בתיקיית הספאם. הקישור תקף לזמן מוגבל.
        </p>
        <button type="button" onClick={() => onSwitch("login")} style={{ ...linkBtn, fontFamily: tokens.rubik, fontWeight: 700 }}>
          ← חזרה להתחברות
        </button>
      </>
    );
  }

  return (
    <>
      <p style={{ fontFamily: tokens.assistant, color: tokens.body, marginBottom: "1.5rem", lineHeight: 1.6 }}>
        הזינו את האימייל שאיתו נרשמתם, ונשלח אליכם קישור לבחירת סיסמה חדשה.
      </p>
      <form onSubmit={onSubmit} style={{ display: "grid", gap: "0.9rem" }}>
        <label style={{ display: "grid", gap: "0.35rem" }}>
          <span style={lbl}>אימייל</span>
          <input type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} style={inp} />
        </label>

        {error && (
          <div role="alert" style={{ fontFamily: tokens.assistant, color: "#C0143C", background: "rgba(255,46,147,0.08)", border: "1px solid rgba(255,46,147,0.25)", borderRadius: 12, padding: "0.7rem 0.9rem", fontSize: "0.92rem" }}>
            {error}
          </div>
        )}

        <button type="submit" disabled={busy} style={primaryBtn(busy)}>
          {busy ? "שולח…" : "שליחת קישור לאיפוס"}
        </button>
      </form>
      <p style={{ fontFamily: tokens.assistant, color: tokens.body, marginTop: "1.3rem", textAlign: "center" }}>
        נזכרתם?{" "}
        <button type="button" onClick={() => onSwitch("login")} style={linkBtn}>להתחברות</button>
      </p>
    </>
  );
}

const lbl: React.CSSProperties = { fontFamily: tokens.rubik, fontWeight: 600, fontSize: "0.85rem", color: tokens.text };
const inp: React.CSSProperties = {
  fontFamily: tokens.assistant, fontSize: "1rem", padding: "0.75rem 0.9rem", borderRadius: 12,
  border: `1px solid ${tokens.border}`, background: tokens.surface, color: tokens.text, outlineColor: tokens.accent,
};
