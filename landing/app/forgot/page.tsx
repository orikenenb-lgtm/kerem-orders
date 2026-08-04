"use client";

// "שכחתי סיסמה" — שולח מייל איפוס. הקישור במייל מוביל ל-/reset, ושם
// נקבעת הסיסמה החדשה.
import { useState } from "react";
import Link from "next/link";
import SiteHeader from "../components/SiteHeader";
import SiteFooter from "../components/SiteFooter";
import { supabase } from "../../lib/supabaseClient";
import { tokens, primaryBtn } from "../../lib/ui";

export default function ForgotPage() {
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
        setError("שליחת המייל נכשלה: " + err.message);
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

  return (
    <>
      <SiteHeader />
      <main id="main-content" style={{ minHeight: "calc(100vh - 64px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "2.5rem 1.25rem", background: tokens.surface }}>
        <div style={{ width: "100%", maxWidth: 420, background: "#fff", borderRadius: 24, border: `1px solid ${tokens.border}`, boxShadow: "0 20px 60px rgba(26,23,48,0.08)", padding: "clamp(1.75rem, 5vw, 2.75rem)" }}>
          <h1 style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.7rem", color: tokens.text, marginBottom: "0.4rem" }}>
            איפוס סיסמה
          </h1>

          {sent ? (
            <>
              <p style={{ fontFamily: tokens.assistant, color: tokens.body, lineHeight: 1.7, marginBottom: "1.4rem" }}>
                ✉️ אם קיים חשבון עם הכתובת הזו — נשלח אליה מייל עם קישור לאיפוס הסיסמה.
                בדקו גם בתיקיית הספאם. הקישור תקף לזמן מוגבל.
              </p>
              <Link href="/login" style={{ fontFamily: tokens.rubik, fontWeight: 700, color: tokens.accent }}>
                ← חזרה להתחברות
              </Link>
            </>
          ) : (
            <>
              <p style={{ fontFamily: tokens.assistant, color: tokens.body, marginBottom: "1.6rem", lineHeight: 1.6 }}>
                הזינו את האימייל שאיתו נרשמתם, ונשלח אליכם קישור לבחירת סיסמה חדשה.
              </p>
              <form onSubmit={onSubmit} style={{ display: "grid", gap: "0.9rem" }}>
                <label style={{ display: "grid", gap: "0.35rem" }}>
                  <span style={lbl}>אימייל</span>
                  <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} style={inp} />
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
                <Link href="/login" style={{ color: tokens.accent, fontWeight: 600 }}>להתחברות</Link>
              </p>
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

const lbl: React.CSSProperties = { fontFamily: tokens.rubik, fontWeight: 600, fontSize: "0.85rem", color: tokens.text };
const inp: React.CSSProperties = {
  fontFamily: tokens.assistant, fontSize: "1rem", padding: "0.75rem 0.9rem", borderRadius: 12,
  border: `1px solid ${tokens.border}`, background: tokens.surface, color: tokens.text, outlineColor: tokens.accent,
};
