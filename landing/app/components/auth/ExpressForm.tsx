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
import { tokens, primaryBtn, linkBtn } from "../../../lib/ui";
import { CONTACT } from "../SiteHeader";
import type { AuthTab } from "./AuthShell";

type Option = { ticket: string; label: string; city: string };
type Step =
  | { kind: "search" }
  | { kind: "not_found" }
  | { kind: "already_linked" }
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
      setError(r.error);
      return;
    }
    if (r.ok === true && typeof r.login_email === "string") {
      const { error: sErr } = await supabase.auth.signInWithPassword({ email: r.login_email, password });
      if (!sErr) { router.replace("/catalog"); return; }
      setBusy(false);
      setError("החשבון נפתח. התחברו עכשיו עם מספר הטלפון והסיסמה שבחרתם.");
      onSwitch("login");
      return;
    }
    setBusy(false);
    setError("פתיחת החשבון נכשלה. נסו שוב בעוד רגע.");
  };

  const errorBox = error && (
    <div role="alert" style={{ fontFamily: tokens.assistant, color: "#C0143C", background: "rgba(255,46,147,0.08)", border: "1px solid rgba(255,46,147,0.25)", borderRadius: 12, padding: "0.7rem 0.9rem", fontSize: "0.92rem" }}>
      {error}
    </div>
  );
  const callUs = (
    <a href={`tel:${CONTACT.phone.replace(/\D/g, "")}`} dir="ltr" style={{ color: tokens.accent, fontWeight: 700 }}>{CONTACT.phone}</a>
  );
  const again = () => { setStep({ kind: "search" }); setError(""); };

  if (step.kind === "not_found") {
    return (
      <div ref={panelRef} tabIndex={-1} role="status" style={{ display: "grid", gap: "0.9rem", outline: "none" }}>
        <p style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.15rem", color: "#C0143C", margin: 0 }}>לא קיים ברווחית</p>
        <p style={{ fontFamily: tokens.assistant, color: tokens.body, lineHeight: 1.6, margin: 0 }}>
          לא מצאנו כרטיס לקוח עם הח״פ או הטלפון <span dir="ltr" style={{ fontWeight: 700 }}>{ident.trim()}</span>. אפשר לפתוח חשבון רגיל — זה לוקח דקה.
        </p>
        <button type="button" onClick={() => onSwitch("register")} style={primaryBtn(false)}>להרשמה</button>
        <p style={{ fontFamily: tokens.assistant, color: tokens.body, textAlign: "center", margin: 0 }}>
          <button type="button" onClick={again} style={linkBtn}>לנסות מספר אחר</button>
        </p>
      </div>
    );
  }

  if (step.kind === "already_linked") {
    return (
      <div ref={panelRef} tabIndex={-1} role="status" style={{ display: "grid", gap: "0.9rem", outline: "none" }}>
        <p style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.15rem", color: tokens.text, margin: 0 }}>כבר יש לכם חשבון באתר</p>
        <p style={{ fontFamily: tokens.assistant, color: tokens.body, lineHeight: 1.6, margin: 0 }}>
          התחברו עם מספר הטלפון והסיסמה. שכחתם את הסיסמה? התקשרו אלינו: {callUs}
        </p>
        <button type="button" onClick={() => onSwitch("login")} style={primaryBtn(false)}>להתחברות</button>
        <p style={{ fontFamily: tokens.assistant, color: tokens.body, textAlign: "center", margin: 0 }}>
          <button type="button" onClick={again} style={linkBtn}>לנסות מספר אחר</button>
        </p>
      </div>
    );
  }

  if (step.kind === "found") {
    const many = step.options.length > 1;
    return (
      <div ref={panelRef} tabIndex={-1} style={{ outline: "none" }}>
        <p role="status" style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.1rem", color: "#1A7A4D", margin: "0 0 0.4rem" }}>
          ✓ מצאנו אתכם ברווחית
        </p>
        <p style={{ fontFamily: tokens.assistant, color: tokens.body, lineHeight: 1.6, margin: "0 0 1.1rem" }}>
          עוד צעד אחד: מספר טלפון וסיסמה. מעכשיו האתר יזכור אתכם בטלפון הזה.
        </p>
        <form onSubmit={onCreate} style={{ display: "grid", gap: "0.9rem" }}>
          {many && (
            <fieldset style={{ border: `1px solid ${tokens.border}`, borderRadius: 12, padding: "0.6rem 0.8rem", margin: 0 }}>
              <legend style={lbl}>איזה מהעסקים שלכם?</legend>
              {step.options.map((o, i) => (
                <label key={o.ticket} style={{ display: "flex", alignItems: "center", gap: "0.5rem", minHeight: 40, fontFamily: tokens.assistant, color: tokens.text }}>
                  <input type="radio" name="express-card" checked={choice === i} onChange={() => setChoice(i)} />
                  <span>{o.label}{o.city ? ` · ${o.city}` : ""}</span>
                </label>
              ))}
            </fieldset>
          )}
          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span style={lbl}>מספר טלפון (איתו תתחברו)</span>
            <input type="tel" inputMode="tel" autoComplete="tel" dir="ltr" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="050-0000000" style={inp} />
          </label>
          <div style={{ display: "grid", gap: "0.35rem" }}>
            <label htmlFor="express-password" style={lbl}>בחרו סיסמה (לפחות 6 תווים)</label>
            <PasswordInput id="express-password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} style={inp} />
          </div>
          {errorBox}
          <button type="submit" disabled={busy} style={primaryBtn(busy)}>{busy ? "רגע…" : "כניסה לאתר"}</button>
        </form>
        <p style={{ fontFamily: tokens.assistant, color: tokens.body, marginTop: "1rem", textAlign: "center" }}>
          <button type="button" onClick={again} style={linkBtn}>זה לא העסק שלי</button>
        </p>
      </div>
    );
  }

  return (
    <>
      <p style={{ fontFamily: tokens.assistant, color: tokens.body, marginBottom: "1.5rem", lineHeight: 1.6 }}>
        כבר קונים אצלנו? אין צורך בהרשמה מלאה — הקלידו ח״פ או טלפון ושם, ונמצא אתכם ברווחית.
      </p>
      <form onSubmit={onSearch} style={{ display: "grid", gap: "0.9rem" }}>
        <label style={{ display: "grid", gap: "0.35rem" }}>
          <span style={lbl}>ח״פ או מספר טלפון</span>
          <input inputMode="numeric" autoComplete="off" dir="ltr" required value={ident} onChange={(e) => setIdent(e.target.value)} style={inp} />
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.7rem" }}>
          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span style={lbl}>שם פרטי</span>
            <input autoComplete="given-name" required value={first} onChange={(e) => setFirst(e.target.value)} style={inp} />
          </label>
          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span style={lbl}>שם משפחה</span>
            <input autoComplete="family-name" required value={last} onChange={(e) => setLast(e.target.value)} style={inp} />
          </label>
        </div>
        <Turnstile key={tsKey} onToken={setToken} action="express" />
        {errorBox}
        <button type="submit" disabled={!searchReady} style={primaryBtn(!searchReady)}>{busy ? "מחפש…" : "חיפוש ברווחית"}</button>
      </form>
      <p style={{ fontFamily: tokens.assistant, color: tokens.body, marginTop: "1.2rem", textAlign: "center" }}>
        לקוחות חדשים?{" "}
        <button type="button" onClick={() => onSwitch("register")} style={linkBtn}>פתיחת חשבון לקוח</button>
      </p>
    </>
  );
}

const lbl: React.CSSProperties = { fontFamily: tokens.rubik, fontWeight: 600, fontSize: "0.85rem", color: tokens.text };
const inp: React.CSSProperties = {
  fontFamily: tokens.assistant, fontSize: "1rem", padding: "0.75rem 0.9rem", borderRadius: 12, width: "100%", boxSizing: "border-box",
  border: `1px solid ${tokens.border}`, background: tokens.surface, color: tokens.text, outlineColor: tokens.accent,
};
