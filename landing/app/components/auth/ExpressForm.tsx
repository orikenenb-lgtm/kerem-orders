"use client";

// "לקוח קיים" — the fourth tab of the customer entry screen (ff_rivhit_express).
//
// The owner's existing customers kept getting lost in the full registration
// form. Someone who is already a customer in Rivhit types his ח״פ or phone and
// his name; if the site finds his card he picks a password and is in — his
// account is opened already linked to his Rivhit card, with his prices. If the
// card is not found he is told "לא קיים ברווחית" and sent to the normal
// registration. From then on the phone keeps him signed in; on a new phone he
// signs in with phone + password (lib/phoneLogin.ts).
//
// All matching, the captcha and the account itself are server-side in
// supabase/functions/rivhit-express; this form only collects and shows.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import PasswordInput from "../PasswordInput";
import Turnstile from "../Turnstile";
import { supabase } from "../../../lib/supabaseClient";
import { useAuth } from "../../../lib/auth";
import { isTurnstileConfigured } from "../../../lib/turnstile";
import { canonPhone } from "../../../lib/phoneLogin";
import s from "./auth.module.css";
import { CONTACT } from "../SiteHeader";
import type { AuthTab } from "./AuthShell";

type Option = { ticket: string; label: string; city: string };
type Step =
  | { kind: "search" }
  | { kind: "not_found" }
  | { kind: "already_linked" }
  | { kind: "blocked" }
  | { kind: "created" }
  | { kind: "found"; options: Option[] };

async function callExpress(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke("rivhit-express", { body });
  if (!error) return (data as Record<string, unknown>) ?? {};
  // A non-2xx answer carries its Hebrew message in the body.
  try {
    const j = await (error as { context?: Response }).context?.json();
    if (j && typeof j === "object") return j as Record<string, unknown>;
  } catch { /* fall through */ }
  return { error: "שגיאת רשת. בדקו את החיבור ונסו שוב." };
}

export default function ExpressForm({ onSwitch }: { onSwitch: (t: AuthTab) => void }) {
  const router = useRouter();
  const { session } = useAuth();
  useEffect(() => {
    if (session) router.replace("/catalog");
  }, [session, router]);

  const [ident, setIdent] = useState("");
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [step, setStep] = useState<Step>({ kind: "search" });
  const [choice, setChoice] = useState(0);
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const turnstileConfigured = isTurnstileConfigured();
  const [token, setToken] = useState<string | null>(null);
  const [tsKey, setTsKey] = useState(0);
  const resetTurnstile = () => { setToken(null); setTsKey((k) => k + 1); };

  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { if (step.kind !== "search") panelRef.current?.focus(); }, [step.kind]);

  const searchReady = ident.trim() !== "" && first.trim() !== "" && last.trim() !== "" && !!token && !busy;

  const onSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!turnstileConfigured || !token) {
      setError(turnstileConfigured ? "אנא השלימו את אימות האבטחה כדי להמשיך." : "אימות האבטחה אינו זמין כרגע. נסו שוב מאוחר יותר או הירשמו רגיל.");
      return;
    }
    setBusy(true);
    const r = await callExpress({ action: "lookup", ident: ident.trim(), turnstileToken: token });
    setBusy(false);
    resetTurnstile(); // the token is spent either way
    if (typeof r.error === "string") { setError(r.error); return; }
    if (r.status === "not_found") { setStep({ kind: "not_found" }); return; }
    if (r.status === "already_linked") { setStep({ kind: "already_linked" }); return; }
    if (r.status === "blocked") { setStep({ kind: "blocked" }); return; }
    if (r.status === "found" && Array.isArray(r.options) && r.options.length > 0) {
      setChoice(0);
      // The phone he typed is the obvious one to sign in with; a ח״פ is not.
      setPhone(/^\s*(\+|0|972)/.test(ident) && canonPhone(ident) ? ident.trim() : "");
      setStep({ kind: "found", options: r.options as Option[] });
      return;
    }
    setError("החיפוש נכשל. נסו שוב בעוד רגע.");
  };

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step.kind !== "found") return;
    setError("");
    if (!canonPhone(phone)) { setError("הקלידו מספר טלפון תקין — איתו תתחברו."); return; }
    if (password.length < 6) { setError("הסיסמה צריכה להיות באורך 6 תווים לפחות."); return; }
    setBusy(true);
    const r = await callExpress({
      action: "create",
      ticket: step.options[choice]?.ticket,
      first_name: first.trim(),
      last_name: last.trim(),
      phone: phone.trim(),
      password,
    });
    if (typeof r.error === "string") {
      setBusy(false);
      if (r.status === "already_linked") { setStep({ kind: "already_linked" }); return; }
      if (r.status === "blocked") { setStep({ kind: "blocked" }); return; }
      setError(r.error);
      return;
    }
    if (r.ok === true && typeof r.login_email === "string") {
      const { error: sErr } = await supabase.auth.signInWithPassword({ email: r.login_email, password });
      if (!sErr) { router.replace("/catalog"); return; }
      // The account exists; only the automatic sign-in failed. Say so here —
      // and hand the phone to the login tab, which pre-fills it.
      setBusy(false);
      try { localStorage.setItem("kt_last_email", phone.trim()); } catch { /* ignore */ }
      setStep({ kind: "created" });
      return;
    }
    setBusy(false);
    setError("פתיחת החשבון נכשלה. נסו שוב בעוד רגע.");
  };

  const errorBox = error && (
    <div role="alert" className={s.alert}>
      {error}
    </div>
  );
  const callUs = (
    <a href={`tel:${CONTACT.phone.replace(/\D/g, "")}`} dir="ltr" className={s.inlineLink}>{CONTACT.phone}</a>
  );
  const again = () => { setStep({ kind: "search" }); setError(""); };

  if (step.kind === "not_found") {
    return (
      <div ref={panelRef} tabIndex={-1} role="status" className={s.statusPanel}>
        <p className={`${s.statusTitle} ${s.statusBad}`}>לא קיים ברווחית</p>
        <p className={s.body}>
          לא מצאנו כרטיס לקוח עם הח״פ או הטלפון <span dir="ltr" className={s.strong}>{ident.trim()}</span>. אפשר לפתוח חשבון רגיל — זה לוקח דקה.
        </p>
        <button type="button" onClick={() => onSwitch("register")} className={s.primary}>להרשמה</button>
        <p className={s.center} style={{ margin: 0 }}>
          <button type="button" onClick={again} className={s.linkBtn}>לנסות מספר אחר</button>
        </p>
      </div>
    );
  }

  if (step.kind === "created") {
    return (
      <div ref={panelRef} tabIndex={-1} role="status" className={s.statusPanel}>
        <p className={`${s.statusTitle} ${s.statusOk}`}>✓ החשבון נפתח</p>
        <p className={s.body}>
          התחברו עכשיו עם מספר הטלפון <span dir="ltr" className={s.strong}>{phone.trim()}</span> והסיסמה שבחרתם.
        </p>
        <button type="button" onClick={() => onSwitch("login")} className={s.primary}>להתחברות</button>
      </div>
    );
  }

  if (step.kind === "blocked") {
    return (
      <div ref={panelRef} tabIndex={-1} role="status" className={s.statusPanel}>
        <p className={s.statusTitle}>צריך לדבר איתנו</p>
        <p className={s.body}>
          לכרטיס הזה לא ניתן להיכנס בדרך המהירה. התקשרו אלינו ונסדר לכם חשבון: {callUs}
        </p>
        <button type="button" onClick={() => onSwitch("register")} className={s.primary}>להרשמה רגילה</button>
      </div>
    );
  }

  if (step.kind === "already_linked") {
    return (
      <div ref={panelRef} tabIndex={-1} role="status" className={s.statusPanel}>
        <p className={s.statusTitle}>כבר יש לכם חשבון באתר</p>
        <p className={s.body}>
          התחברו עם האימייל או הטלפון שאיתו נרשמתם. שכחתם את הסיסמה? התקשרו אלינו: {callUs}
        </p>
        <button type="button" onClick={() => onSwitch("login")} className={s.primary}>להתחברות</button>
        <p className={s.center} style={{ margin: 0 }}>
          <button type="button" onClick={again} className={s.linkBtn}>לנסות מספר אחר</button>
        </p>
      </div>
    );
  }

  if (step.kind === "found") {
    const many = step.options.length > 1;
    return (
      <div ref={panelRef} tabIndex={-1} className={s.statusPanel} style={{ gap: 0 }}>
        <p role="status" className={`${s.statusTitle} ${s.statusOk}`} style={{ marginBottom: "0.6rem" }}>
          ✓ מצאנו אתכם ברווחית
        </p>
        <p className={s.body} style={{ marginBottom: "1.2rem" }}>
          עוד צעד אחד: מספר טלפון וסיסמה. מעכשיו האתר יזכור אתכם בטלפון הזה.
        </p>
        <form onSubmit={onCreate} className={s.form}>
          {many && (
            <fieldset className={s.fieldset}>
              <legend className={s.label}>איזה מהעסקים שלכם?</legend>
              {step.options.map((o, i) => (
                <label key={o.ticket} className={s.radioRow}>
                  <input type="radio" name="express-card" checked={choice === i} onChange={() => setChoice(i)} />
                  <span>{o.label}{o.city ? ` · ${o.city}` : ""}</span>
                </label>
              ))}
            </fieldset>
          )}
          <label className={s.field}>
            <span className={s.label}>מספר טלפון (איתו תתחברו)</span>
            <input type="tel" inputMode="tel" autoComplete="tel" dir="ltr" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="מספר הנייד שלכם" className={s.input} />
          </label>
          <div className={s.field}>
            <label htmlFor="express-password" className={s.label}>בחרו סיסמה (לפחות 6 תווים)</label>
            <PasswordInput id="express-password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={s.input} />
          </div>
          {errorBox}
          <button type="submit" disabled={busy} className={s.primary}>{busy ? "רגע…" : "כניסה לאתר"}</button>
        </form>
        <p className={s.center}>
          <button type="button" onClick={again} className={s.linkBtn}>זה לא העסק שלי</button>
        </p>
      </div>
    );
  }

  return (
    <>
      <p className={s.intro}>
        כבר קונים אצלנו? אין צורך בהרשמה מלאה — הקלידו ח״פ או טלפון ושם, ונמצא אתכם ברווחית.
      </p>
      <form onSubmit={onSearch} className={s.form}>
        <label className={s.field}>
          <span className={s.label}>ח״פ או מספר טלפון</span>
          <input inputMode="numeric" autoComplete="off" dir="ltr" required value={ident} onChange={(e) => setIdent(e.target.value)} className={s.input} />
        </label>
        <div className={s.twoCol}>
          <label className={s.field}>
            <span className={s.label}>שם פרטי</span>
            <input autoComplete="given-name" required value={first} onChange={(e) => setFirst(e.target.value)} className={s.input} />
          </label>
          <label className={s.field}>
            <span className={s.label}>שם משפחה</span>
            <input autoComplete="family-name" required value={last} onChange={(e) => setLast(e.target.value)} className={s.input} />
          </label>
        </div>
        <Turnstile key={tsKey} onToken={setToken} action="express" />
        {errorBox}
        <button type="submit" disabled={!searchReady} className={s.primary}>{busy ? "מחפש…" : "חיפוש ברווחית"}</button>
      </form>
      <p className={s.center}>
        לקוחות חדשים?{" "}
        <button type="button" onClick={() => onSwitch("register")} className={s.linkBtn}>פתיחת חשבון לקוח</button>
      </p>
    </>
  );
}

