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
import { authErrorHe } from "../../lib/authErrors";
import { BUSINESS_NAME } from "../../lib/config";
import s from "../components/auth/auth.module.css";

type Phase = "checking" | "ready" | "invalid" | "done";

export default function ResetPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const establish = useCallback(async () => {
    try {
      const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
      const hp = new URLSearchParams(hash);
      const qp = new URLSearchParams(window.location.search);

      // Supabase reports expired/used links via error params.
      const errDesc = hp.get("error_description") || qp.get("error_description");
      if (errDesc) {
        setPhase("invalid");
        return;
      }

      const access_token = hp.get("access_token");
      const refresh_token = hp.get("refresh_token");
      const code = qp.get("code");

      if (access_token && refresh_token) {
        const { error: e } = await supabase.auth.setSession({ access_token, refresh_token });
        if (e) { setPhase("invalid"); return; }
        // Strip the tokens from the address bar.
        window.history.replaceState({}, "", window.location.pathname);
        setPhase("ready");
        return;
      }

      if (code) {
        const { error: e } = await supabase.auth.exchangeCodeForSession(code);
        if (e) { setPhase("invalid"); return; }
        window.history.replaceState({}, "", window.location.pathname);
        setPhase("ready");
        return;
      }

      // No token in the URL — allow it only if a session already exists
      // (e.g. the user is signed in and wants to change their password).
      const { data } = await supabase.auth.getSession();
      setPhase(data.session ? "ready" : "invalid");
    } catch {
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
        setError(authErrorHe(err.message));
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
      <main id="main-content" tabIndex={-1} className={s.main} style={{ alignItems: "center" }}>
        <div className={`${s.card} ${s.cardNarrow}`}>
          <span className={s.brandChip}>{BUSINESS_NAME}</span>
          <h1 className={s.title}>
            בחירת סיסמה חדשה
          </h1>

          {phase === "checking" && (
            <p className={s.muted}>בודק את הקישור…</p>
          )}

          {phase === "invalid" && (
            <>
              <p className={s.alert} style={{ margin: "0.4rem 0 1.1rem" }}>
                הקישור אינו תקף או שפג תוקפו. בקשו קישור חדש.
              </p>
              <Link href="/forgot" className={`${s.linkBtn} ${s.backLink}`}>
                ← שליחת קישור חדש
              </Link>
            </>
          )}

          {phase === "ready" && (
            <>
              <p className={s.intro}>
                בחרו סיסמה חדשה (לפחות 6 תווים).
              </p>
              <form onSubmit={onSubmit} className={s.form}>
                {/* Explicit htmlFor labels: PasswordInput also renders the
                    show/hide button, and an implicit label must not wrap it. */}
                <div className={s.field}>
                  <label htmlFor="reset-password" className={s.label}>סיסמה חדשה</label>
                  <PasswordInput id="reset-password" required minLength={6} value={pw} onChange={(e) => setPw(e.target.value)} className={s.input} autoComplete="new-password" />
                </div>
                <div className={s.field}>
                  <label htmlFor="reset-password-confirm" className={s.label}>אימות סיסמה</label>
                  <PasswordInput id="reset-password-confirm" required value={pw2} onChange={(e) => setPw2(e.target.value)} className={s.input} autoComplete="new-password" />
                </div>

                {error && (
                  <div role="alert" className={s.alert}>
                    {error}
                  </div>
                )}

                <button type="submit" disabled={busy} className={s.primary}>
                  {busy ? "שומר…" : "שמירת הסיסמה"}
                </button>
              </form>
            </>
          )}

          {phase === "done" && (
            <>
              <div className={s.statusPanel}>
                <p className={`${s.statusTitle} ${s.statusOk}`}>
                  ✓ הסיסמה עודכנה בהצלחה.
                </p>
                <button onClick={() => router.replace("/catalog")} className={s.primary}>
                  לקטלוג ←
                </button>
              </div>
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

