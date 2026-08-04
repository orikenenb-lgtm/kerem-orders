"use client";

// יעד הקישור מהמייל: מאמת את הטוקן וקובע סיסמה חדשה.
//
// הערה טכנית: lib/supabaseClient מוגדר עם detectSessionInUrl:false, כלומר
// ה-SDK לא יקלוט לבד את הטוקן מהכתובת — ולכן אנחנו מטפלים בו כאן ידנית,
// גם בפורמט ה-hash (implicit) וגם ב-code (PKCE), כדי שהקישור יעבוד בכל מקרה.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SiteHeader from "../components/SiteHeader";
import SiteFooter from "../components/SiteFooter";
import PasswordInput from "../components/PasswordInput";
import { supabase } from "../../lib/supabaseClient";
import { tokens, primaryBtn } from "../../lib/ui";

type Phase = "checking" | "ready" | "invalid" | "done";

export default function ResetPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [linkError, setLinkError] = useState("");

  const establish = useCallback(async () => {
    try {
      const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
      const hp = new URLSearchParams(hash);
      const qp = new URLSearchParams(window.location.search);

      // Supabase reports expired/used links via error params.
      const errDesc = hp.get("error_description") || qp.get("error_description");
      if (errDesc) {
        setLinkError(decodeURIComponent(errDesc));
        setPhase("invalid");
        return;
      }

      const access_token = hp.get("access_token");
      const refresh_token = hp.get("refresh_token");
      const code = qp.get("code");

      if (access_token && refresh_token) {
        const { error: e } = await supabase.auth.setSession({ access_token, refresh_token });
        if (e) { setLinkError(e.message); setPhase("invalid"); return; }
        // Strip the tokens from the address bar.
        window.history.replaceState({}, "", window.location.pathname);
        setPhase("ready");
        return;
      }

      if (code) {
        const { error: e } = await supabase.auth.exchangeCodeForSession(code);
        if (e) { setLinkError(e.message); setPhase("invalid"); return; }
        window.history.replaceState({}, "", window.location.pathname);
        setPhase("ready");
        return;
      }

      // No token in the URL — allow it only if a session already exists
      // (e.g. the user is signed in and wants to change their password).
      const { data } = await supabase.auth.getSession();
      setPhase(data.session ? "ready" : "invalid");
    } catch (e) {
      setLinkError(String((e as Error)?.message ?? e));
      setPhase("invalid");
    }
  }, []);

  useEffect(() => { establish(); }, [establish]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (pw.length < 6) { setError("הסיסמה חייבת להכיל לפחות 6 תווים."); return; }
    if (pw !== pw2) { setError("הסיסמאות אינן תואמות."); return; }
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password: pw });
      if (err) {
        setError("עדכון הסיסמה נכשל: " + err.message);
        setBusy(false);
        return;
      }
      setPhase("done");
    } catch {
      setError("שגיאת רשת. נסו שוב.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SiteHeader />
      <main id="main-content" style={{ minHeight: "calc(100vh - 64px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "2.5rem 1.25rem", background: tokens.surface }}>
        <div style={{ width: "100%", maxWidth: 420, background: "#fff", borderRadius: 24, border: `1px solid ${tokens.border}`, boxShadow: "0 20px 60px rgba(26,23,48,0.08)", padding: "clamp(1.75rem, 5vw, 2.75rem)" }}>
          <h1 style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.7rem", color: tokens.text, marginBottom: "0.6rem" }}>
            בחירת סיסמה חדשה
          </h1>

          {phase === "checking" && (
            <p style={{ fontFamily: tokens.assistant, color: tokens.dim }}>בודק את הקישור…</p>
          )}

          {phase === "invalid" && (
            <>
              <p style={{ fontFamily: tokens.assistant, color: "#C0143C", lineHeight: 1.7, marginBottom: "1rem" }}>
                הקישור אינו תקף או שפג תוקפו{linkError ? ` (${linkError})` : ""}. בקשו קישור חדש.
              </p>
              <Link href="/forgot" style={{ fontFamily: tokens.rubik, fontWeight: 700, color: tokens.accent }}>
                ← שליחת קישור חדש
              </Link>
            </>
          )}

          {phase === "ready" && (
            <>
              <p style={{ fontFamily: tokens.assistant, color: tokens.body, marginBottom: "1.5rem", lineHeight: 1.6 }}>
                בחרו סיסמה חדשה (לפחות 6 תווים).
              </p>
              <form onSubmit={onSubmit} style={{ display: "grid", gap: "0.9rem" }}>
                <label style={{ display: "grid", gap: "0.35rem" }}>
                  <span style={lbl}>סיסמה חדשה</span>
                  <PasswordInput required minLength={6} value={pw} onChange={(e) => setPw(e.target.value)} style={inp} autoComplete="new-password" />
                </label>
                <label style={{ display: "grid", gap: "0.35rem" }}>
                  <span style={lbl}>אימות סיסמה</span>
                  <PasswordInput required value={pw2} onChange={(e) => setPw2(e.target.value)} style={inp} autoComplete="new-password" />
                </label>

                {error && (
                  <div role="alert" style={{ fontFamily: tokens.assistant, color: "#C0143C", background: "rgba(255,46,147,0.08)", border: "1px solid rgba(255,46,147,0.25)", borderRadius: 12, padding: "0.7rem 0.9rem", fontSize: "0.92rem" }}>
                    {error}
                  </div>
                )}

                <button type="submit" disabled={busy} style={primaryBtn(busy)}>
                  {busy ? "שומר…" : "שמירת הסיסמה"}
                </button>
              </form>
            </>
          )}

          {phase === "done" && (
            <>
              <p style={{ fontFamily: tokens.assistant, color: "#1A7A4D", lineHeight: 1.7, marginBottom: "1.2rem" }}>
                ✓ הסיסמה עודכנה בהצלחה.
              </p>
              <button onClick={() => router.replace("/catalog")} style={primaryBtn(false)}>
                לקטלוג ←
              </button>
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
