"use client";

// "שכחתי סיסמה" — the third tab of the single customer entry screen. Sends
// the reset email; the link inside it opens /reset/, which stays a page of
// its own because it is reached from the email, never handed out by hand.

import { useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { authErrorHe } from "../../../lib/authErrors";
import s from "./auth.module.css";
import { featureFlags } from "../../../lib/featureFlags";
import { canonPhone } from "../../../lib/phoneLogin";
import { CONTACT } from "../SiteHeader";
import type { AuthTab } from "./AuthShell";

// A phone account (ff_rivhit_express) has no mailbox to send a reset link to.
const PHONE_LOGIN = featureFlags.ff_rivhit_express;

export default function ForgotForm({ onSwitch }: { onSwitch: (t: AuthTab) => void }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (PHONE_LOGIN && !email.includes("@") && canonPhone(email)) {
      setError(`לחשבון שנפתח עם מספר טלפון אין קישור באימייל. התקשרו אלינו ונאפס לכם את הסיסמה: ${CONTACT.phone}`);
      return;
    }
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
        <p role="status" aria-live="polite" className={s.intro}>
          ✉️ אם קיים חשבון עם הכתובת הזו — נשלח אליה מייל עם קישור לאיפוס הסיסמה.
          בדקו גם בתיקיית הספאם. הקישור תקף לזמן מוגבל.
        </p>
        <button type="button" onClick={() => onSwitch("login")} className={`${s.linkBtn} ${s.backLink}`}>
          ← חזרה להתחברות
        </button>
      </>
    );
  }

  return (
    <>
      <p className={s.intro}>
        הזינו את האימייל שאיתו נרשמתם, ונשלח אליכם קישור לבחירת סיסמה חדשה.
      </p>
      <form onSubmit={onSubmit} className={s.form}>
        <label className={s.field}>
          <span className={s.label}>{PHONE_LOGIN ? "אימייל או טלפון" : "אימייל"}</span>
          <input type={PHONE_LOGIN ? "text" : "email"} autoComplete="email" inputMode={PHONE_LOGIN ? "text" : "email"} dir={PHONE_LOGIN ? "ltr" : undefined} required value={email} onChange={(e) => setEmail(e.target.value)} className={s.input} />
        </label>

        {error && (
          <div role="alert" className={s.alert}>
            {error}
          </div>
        )}

        <button type="submit" disabled={busy} className={s.primary}>
          {busy ? "שולח…" : "שליחת קישור לאיפוס"}
        </button>
      </form>
      <p className={s.center}>
        נזכרתם?{" "}
        <button type="button" onClick={() => onSwitch("login")} className={s.linkBtn}>להתחברות</button>
      </p>
    </>
  );
}

