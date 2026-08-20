"use client";

// The registration form — the "הרשמה" tab of the single customer entry
// screen (see AuthShell). It renders only the card's contents; the page
// chrome (header, card, tab bar, footer) belongs to the shell.

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import PasswordInput from "../PasswordInput";
import Turnstile from "../Turnstile";
import { supabase } from "../../../lib/supabaseClient";
import { useAuth } from "../../../lib/auth";
import { featureFlags } from "../../../lib/featureFlags";
import { tokens, primaryBtn, linkBtn } from "../../../lib/ui";
import type { AuthTab } from "./AuthShell";
import { isTurnstileConfigured, canSubmitSignup } from "../../../lib/turnstile";

// Wave 4: address fields in the registration form. With the flag OFF the page
// renders and behaves exactly as before — none of the new code paths run.
const ADDR = featureFlags.ff_register_address;

// Draft persistence (flag-on): everything the customer typed (except the
// password) is kept here so leaving the page mid-registration loses nothing.
const DRAFT_KEY = "kt_reg_draft";

// Top Israeli cities/towns for the city autocomplete. A native <datalist> —
// simple, accessible, and the browser handles filtering as you type.
const CITY_LIST = [
  "ירושלים",
  "תל אביב-יפו",
  "חיפה",
  "ראשון לציון",
  "פתח תקווה",
  "אשדוד",
  "נתניה",
  "באר שבע",
  "בני ברק",
  "חולון",
  "רמת גן",
  "אשקלון",
  "רחובות",
  "בת ים",
  "בית שמש",
  "כפר סבא",
  "הרצליה",
  "חדרה",
  "מודיעין-מכבים-רעות",
  "נצרת",
  "לוד",
  "רמלה",
  "רעננה",
  "רהט",
  "הוד השרון",
  "גבעתיים",
  "קריית אתא",
  "נהריה",
  "אום אל-פחם",
  "קריית גת",
  "אילת",
  "ראש העין",
  "עכו",
  "אלעד",
  "כרמיאל",
  "עפולה",
  "נס ציונה",
  "טבריה",
  "יבנה",
  "מודיעין עילית",
  "ביתר עילית",
  "קריית מוצקין",
  "קריית ים",
  "קריית ביאליק",
  "קריית אונו",
  "שפרעם",
  "דימונה",
  "טייבה",
  "נתיבות",
  "אופקים",
  "טירה",
  "סח'נין",
  "יהוד-מונוסון",
  "באקה אל-גרביה",
  "צפת",
  "גבעת שמואל",
  "קריית שמונה",
  "טמרה",
  "מגדל העמק",
  "ערד",
  "טירת כרמל",
  "נשר",
  "קלנסווה",
  "מעלה אדומים",
  "גני תקווה",
  "אור יהודה",
  "שדרות",
  "יקנעם עילית",
  "כפר יונה",
  "גדרה",
  "זכרון יעקב",
  "אריאל",
  "בית שאן",
  "מבשרת ציון",
  "אור עקיבא",
  "נוף הגליל",
  "כפר קאסם",
  "קריית מלאכי",
  "מעלות-תרשיחא",
  "פרדס חנה-כרכור",
];

const PHONE_ERROR = "מספר טלפון לא תקין — צריך 10 ספרות";
const HOUSE_ERROR = "צריך למלא מספר בית";
const PASSWORD_MATCH_ERROR = "הסיסמאות אינן תואמות — בדקו את שני השדות";

// 10 digits starting with 0; spaces and dashes are fine ("050-123 4567").
const isValidPhone = (v: string) => /^0\d{9}$/.test(v.replace(/[\s-]/g, ""));

export default function RegisterForm({ onSwitch }: { onSwitch: (t: AuthTab) => void }) {
  const router = useRouter();
  const { session } = useAuth();
  const [form, setForm] = useState({
    business_name: "",
    full_name: "",
    vat_number: "",
    phone: "",
    email: "",
    password: "",
    // Wave 4 address fields — rendered and sent only when the flag is on.
    city: "",
    street: "",
    house_number: "",
    zip_code: "",
    delivery_notes: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // After a successful signup we show an email-verification screen instead of
  // logging the user in (the account is unconfirmed until they click the link).
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  // Turnstile: the fresh single-use token + widget state. `turnstileResetKey`
  // remounts the widget (via React key) to get a NEW token after a failed
  // submit, since a Turnstile token can be used only once.
  const turnstileConfigured = isTurnstileConfigured();
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  // Move focus to the success screen when it appears, so keyboard users don't
  // lose their place when the form (and the focused submit button) unmounts.
  const successRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (submittedEmail) successRef.current?.focus();
  }, [submittedEmail]);
  // Single source of truth for whether the form may submit (mirrors the pure
  // canSubmitSignup rule: configured + solved non-empty token + not busy).
  const submitAllowed = canSubmitSignup({
    configured: turnstileConfigured,
    formValid: true, // required-field validity is enforced natively by the inputs
    busy,
    state: { status: turnstileToken ? "solved" : "ready", token: turnstileToken },
  });
  // Confirm-password lives outside `form`: it is never sent anywhere, never
  // drafted to localStorage — it exists only to catch typos before submit.
  const [password2, setPassword2] = useState("");
  // Per-field messages shown under the phone / house-number inputs (flag-on).
  const [fieldErrors, setFieldErrors] = useState<{
    phone?: string;
    house_number?: string;
    password2?: string;
  }>({});

  // Already signed in → go to catalog.
  useEffect(() => {
    if (session) router.replace("/catalog");
  }, [session, router]);

  // Restore a saved draft on first load (flag-on only; password never saved).
  useEffect(() => {
    if (!ADDR) return;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as Record<string, unknown>;
      setForm((f) => {
        const next = { ...f };
        (Object.keys(next) as (keyof typeof next)[]).forEach((k) => {
          if (k !== "password" && typeof draft[k] === "string") {
            next[k] = draft[k] as string;
          }
        });
        return next;
      });
    } catch {
      /* corrupt draft or blocked storage — just start clean */
    }
  }, []);

  // Save a draft ~400ms after the customer stops typing (flag-on only).
  useEffect(() => {
    if (!ADDR) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({
            business_name: form.business_name,
            full_name: form.full_name,
            vat_number: form.vat_number,
            phone: form.phone,
            email: form.email,
            city: form.city,
            street: form.street,
            house_number: form.house_number,
            zip_code: form.zip_code,
            delivery_notes: form.delivery_notes,
          })
        );
      } catch {
        /* storage unavailable — drafts are best-effort */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [form]);

  const set =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  // Checks run when leaving a field (blur) — not on every keystroke.
  const onPhoneBlur = () =>
    setFieldErrors((p) => ({
      ...p,
      phone:
        form.phone.trim() !== "" && !isValidPhone(form.phone)
          ? PHONE_ERROR
          : undefined,
    }));
  const onHouseBlur = () =>
    setFieldErrors((p) => ({
      ...p,
      house_number: form.house_number.trim() === "" ? HOUSE_ERROR : undefined,
    }));

  // What gets sent to the signup function. Flag off: exactly the same six
  // keys as before. Flag on: the address fields ride along in the same object
  // (the function stores the columns it knows and ignores anything else). The
  // Turnstile token is always attached — the hardened signup requires it.
  const signupBody = () => ({
    ...(ADDR
      ? { ...form }
      : {
          business_name: form.business_name,
          full_name: form.full_name,
          vat_number: form.vat_number,
          phone: form.phone,
          email: form.email,
          password: form.password,
        }),
    turnstileToken,
  });

  // The signup function replies with { ok, message }: ok:true is the generic
  // "check your email" success (shown identically for new vs existing accounts
  // — no enumeration); ok:false carries a user-facing rejection message
  // (captcha/rate-limit/invalid). Normalize BOTH shapes to { ok?, error? } so a
  // non-2xx rejection is never mistaken for success on the SDK path.
  const normalizeSignupResult = (raw: unknown): { ok?: boolean; error?: string } => {
    if (!raw || typeof raw !== "object") return {};
    const r = raw as { ok?: boolean; error?: string; message?: string };
    if (typeof r.error === "string") return { error: r.error };
    if (r.ok === false) {
      return { error: (typeof r.message === "string" && r.message) || "ההרשמה נכשלה. נסו שוב בעוד רגע." };
    }
    if (r.ok === true) return { ok: true };
    return {};
  };

  // Call the signup function; if the SDK path fails for any reason, fall back
  // to a plain fetch so a client-side SDK hiccup can never block registration.
  const callSignup = async (): Promise<{ ok?: boolean; error?: string }> => {
    const body = signupBody();
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("signup", {
        body,
      });
      if (!fnErr) return normalizeSignupResult(data);
      const ctx = (fnErr as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") {
        try {
          // A non-2xx rejection ({ ok:false, message }) is surfaced as an error,
          // not silently treated as success.
          return normalizeSignupResult(await ctx.json());
        } catch {
          /* fall through to direct fetch */
        }
      }
    } catch {
      /* fall through to direct fetch */
    }
    const base =
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      "https://mcdchalyzeqjkkgfeznd.supabase.co";
    // The functions gateway requires the (public) anon key — same one the SDK
    // sends. Without it the fallback would always be rejected with a 401.
    const anonKey =
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      "sb_publishable_ie1SyncNyRabOTCWTxt8pw_AsESY6F9";
    const res = await fetch(`${base}/functions/v1/signup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify(body),
    });
    let resBody: { ok?: boolean; error?: string } = {};
    try {
      resBody = normalizeSignupResult(await res.json());
    } catch {
      /* non-JSON response */
    }
    // Never treat a failed HTTP response without an explicit error as success.
    if (!res.ok && !resBody?.error) {
      return { error: "ההרשמה נכשלה. נסו שוב בעוד רגע." };
    }
    return resBody;
  };

  // Force a NEW captcha token: clear the used one and remount the widget.
  // Called after any failed submit — a Turnstile token is single-use.
  const resetTurnstile = () => {
    setTurnstileToken(null);
    setTurnstileResetKey((k) => k + 1);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    // The two passwords must match before anything is sent — checked in every
    // flag state (the confirm field renders in both branches of the form).
    if (form.password !== password2) {
      setFieldErrors((p) => ({ ...p, password2: PASSWORD_MATCH_ERROR }));
      return;
    }
    setFieldErrors((p) => ({ ...p, password2: undefined }));
    if (ADDR) {
      // Same rules as the on-blur checks — one last look before sending.
      const errs = {
        phone: !isValidPhone(form.phone) ? PHONE_ERROR : undefined,
        house_number:
          form.house_number.trim() === "" ? HOUSE_ERROR : undefined,
      };
      if (errs.phone || errs.house_number) {
        setFieldErrors((p) => ({ ...p, ...errs }));
        return;
      }
    }
    // Fail closed: never send without a fresh captcha token.
    if (!turnstileConfigured || !turnstileToken) {
      setError(
        turnstileConfigured
          ? "אנא השלימו את אימות האבטחה כדי להמשיך."
          : "אימות האבטחה אינו זמין כרגע. לא ניתן להשלים הרשמה — נסו שוב מאוחר יותר."
      );
      return;
    }
    setBusy(true);
    try {
      const result = await callSignup();
      if (result?.error) {
        setError(result.error);
        setBusy(false);
        resetTurnstile(); // token is spent — a retry needs a new one
        return;
      }
      if (ADDR) {
        // Signup succeeded — the draft is no longer needed.
        try {
          localStorage.removeItem(DRAFT_KEY);
        } catch {
          /* ignore */
        }
      }
      // Account is created UNCONFIRMED. Do NOT auto-login — show the
      // email-verification screen. The same generic success is shown whether
      // the address is new or already registered (no account enumeration).
      const email = form.email.trim().toLowerCase();
      try {
        localStorage.setItem("kt_last_email", email); // prefill login only
      } catch {
        /* ignore */
      }
      setBusy(false);
      setSubmittedEmail(email);
    } catch {
      setError("שגיאת רשת. בדקו את החיבור ונסו שוב.");
      setBusy(false);
      resetTurnstile();
    }
  };

  const phoneHint = (
    // tokens.body, not dim: axe measured dim at 3.45:1 on white for this
    // 12.8px text — below the 4.5:1 minimum.
    <p style={{ fontFamily: tokens.assistant, fontSize: "0.8rem", color: tokens.body, marginTop: "-0.4rem" }}>
      💡 כבר לקוחות של כרם טויס? הזינו את הטלפון המעודכן אצלנו — והמערכת תזהה אתכם אוטומטית.
    </p>
  );

  return (
    <>
          {submittedEmail ? (
            <div ref={successRef} tabIndex={-1} role="status" aria-live="polite" style={{ display: "grid", gap: "1rem", fontFamily: tokens.assistant, color: tokens.body, outline: "none" }}>
              <p style={{ fontSize: "1.05rem", lineHeight: 1.6 }}>
                החשבון נפתח עבור{" "}
                <span dir="ltr" style={{ fontWeight: 700, color: tokens.text }}>{submittedEmail}</span>
                {" "}— אפשר להתחבר עכשיו.
              </p>
              <p style={{ fontSize: "0.95rem", color: tokens.body }}>
                שמרו את כתובת המייל והסיסמה — איתן מתחברים בכל פעם.
              </p>
              <button type="button" onClick={() => onSwitch("login")} style={primaryBtn(false)}>
                מעבר להתחברות
              </button>
            </div>
          ) : (
          <>
          <p
            style={{
              fontFamily: tokens.assistant,
              color: tokens.body,
              marginBottom: "1.6rem",
            }}
          >
            כמה פרטים וסיימתם — לאחר ההרשמה נשלח קישור לאימות כתובת המייל.
          </p>

          <form onSubmit={onSubmit} style={{ display: "grid", gap: "0.9rem" }}>
            {ADDR ? (
              <>
                <Field label="שם העסק / החנות" mark="req" value={form.business_name} onChange={set("business_name")} autoComplete="organization" required />
                <Field label="שם איש קשר" mark="req" value={form.full_name} onChange={set("full_name")} autoComplete="name" required />
                <Field
                  label="טלפון"
                  mark="req"
                  value={form.phone}
                  onChange={set("phone")}
                  onBlur={onPhoneBlur}
                  error={fieldErrors.phone}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  required
                />
                {phoneHint}
                <Field label="אימייל" mark="req" value={form.email} onChange={set("email")} type="email" inputMode="email" autoComplete="email" required />
                {/* No autocomplete token exists for a VAT number — leave it off
                    rather than teach the browser a wrong mapping. */}
                <Field label="עוסק מורשה / ח.פ" mark="req" value={form.vat_number} onChange={set("vat_number")} inputMode="numeric" autoComplete="off" required />
                <Field label="עיר" mark="req" value={form.city} onChange={set("city")} list="kt-city-list" autoComplete="address-level2" required />
                <datalist id="kt-city-list">
                  {CITY_LIST.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
                <Field label="רחוב" mark="req" value={form.street} onChange={set("street")} autoComplete="address-line1" required />
                <Field
                  label="מספר בית"
                  mark="req"
                  value={form.house_number}
                  onChange={set("house_number")}
                  onBlur={onHouseBlur}
                  error={fieldErrors.house_number}
                  autoComplete="address-line2"
                  required
                />
                <Field label="מיקוד" mark="opt" value={form.zip_code} onChange={set("zip_code")} inputMode="numeric" autoComplete="postal-code" />
                <AreaField
                  label="הערות למשלוח"
                  mark="opt"
                  value={form.delivery_notes}
                  onChange={set("delivery_notes")}
                  placeholder="לדוגמה: להשאיר במחסן, לתאם טלפונית לפני הגעה…"
                />
                <PasswordField label="סיסמה (לפחות 6 תווים)" mark="req" value={form.password} onChange={set("password")} autoComplete="new-password" minLength={6} required />
                <PasswordField
                  label="אימות סיסמה"
                  mark="req"
                  value={password2}
                  onChange={(e) => setPassword2(e.target.value)}
                  error={fieldErrors.password2}
                  autoComplete="new-password"
                  required
                />
              </>
            ) : (
              <>
                <Field label="שם העסק / החנות" value={form.business_name} onChange={set("business_name")} autoComplete="organization" required />
                <Field label="שם איש קשר" value={form.full_name} onChange={set("full_name")} autoComplete="name" required />
                <Field label="עוסק מורשה / ח.פ" value={form.vat_number} onChange={set("vat_number")} inputMode="numeric" autoComplete="off" required />
                <Field label="טלפון" value={form.phone} onChange={set("phone")} type="tel" inputMode="tel" autoComplete="tel" />
                {phoneHint}
                <Field label="אימייל" value={form.email} onChange={set("email")} type="email" inputMode="email" autoComplete="email" required />
                <PasswordField label="סיסמה (לפחות 6 תווים)" value={form.password} onChange={set("password")} autoComplete="new-password" minLength={6} required />
                <PasswordField
                  label="אימות סיסמה"
                  value={password2}
                  onChange={(e) => setPassword2(e.target.value)}
                  error={fieldErrors.password2}
                  autoComplete="new-password"
                  required
                />
              </>
            )}

            {error && (
              <div
                role="alert"
                style={{
                  fontFamily: tokens.assistant,
                  color: "#C0143C",
                  background: "rgba(255,46,147,0.08)",
                  border: "1px solid rgba(255,46,147,0.25)",
                  borderRadius: 12,
                  padding: "0.7rem 0.9rem",
                  fontSize: "0.92rem",
                }}
              >
                {error}
              </div>
            )}

            {/* Cloudflare Turnstile — remounted via key to force a fresh
                single-use token after a failed submit. Fails closed when the
                site key is not configured. */}
            <Turnstile key={turnstileResetKey} onToken={setTurnstileToken} action="signup" />

            <button
              type="submit"
              disabled={!submitAllowed}
              style={primaryBtn(busy || !turnstileToken)}
            >
              {busy ? (ADDR ? "שולח..." : "רגע…") : "פתחו חשבון"}
            </button>
          </form>

          <p style={{ fontFamily: tokens.assistant, color: tokens.body, marginTop: "1.3rem", textAlign: "center" }}>
            כבר יש לכם חשבון?{" "}
            <button type="button" onClick={() => onSwitch("login")} style={linkBtn}>
              להתחברות
            </button>
          </p>
          </>
          )}
    </>
  );
}

// The small "required / optional" tag beside a label. Only used when the
// address flag is on (fields without a `mark` render exactly as before).
function LabelMark({ mark }: { mark?: "req" | "opt" }) {
  if (mark === "req") {
    return (
      <>
        {" "}
        <span aria-hidden="true" style={{ color: "#C0143C" }}>
          *
        </span>{" "}
        <span style={{ fontWeight: 400, fontSize: "0.75rem", color: tokens.dim }}>חובה</span>
      </>
    );
  }
  if (mark === "opt") {
    return <span style={{ fontWeight: 400, fontSize: "0.75rem", color: tokens.dim }}> (לא חובה)</span>;
  }
  return null;
}

function Field({
  label,
  mark,
  error,
  ...props
}: {
  label: string;
  mark?: "req" | "opt";
  error?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label style={{ display: "grid", gap: "0.35rem" }}>
      <span style={{ fontFamily: tokens.rubik, fontWeight: 600, fontSize: "0.85rem", color: tokens.text }}>
        {label}
        <LabelMark mark={mark} />
      </span>
      <input
        {...props}
        aria-invalid={error ? true : undefined}
        style={{
          fontFamily: tokens.assistant,
          fontSize: "1rem",
          padding: "0.75rem 0.9rem",
          borderRadius: 12,
          border: `1px solid ${tokens.border}`,
          background: tokens.surface,
          color: tokens.text,
          outlineColor: tokens.accent,
        }}
      />
      {error && (
        <span style={{ fontFamily: tokens.assistant, fontSize: "0.82rem", color: "#C0143C" }}>
          {error}
        </span>
      )}
    </label>
  );
}

// Same look as Field, with the shared show/hide password input inside.
function PasswordField({
  label,
  mark,
  error,
  ...props
}: {
  label: string;
  mark?: "req" | "opt";
  error?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  // Explicit htmlFor label: PasswordInput also renders the show/hide button,
  // and an implicit label must not wrap that second control.
  const id = useId();
  return (
    <div style={{ display: "grid", gap: "0.35rem" }}>
      <label htmlFor={id} style={{ fontFamily: tokens.rubik, fontWeight: 600, fontSize: "0.85rem", color: tokens.text }}>
        {label}
        <LabelMark mark={mark} />
      </label>
      <PasswordInput
        {...props}
        id={id}
        aria-invalid={error ? true : undefined}
        style={{
          fontFamily: tokens.assistant,
          fontSize: "1rem",
          padding: "0.75rem 0.9rem",
          borderRadius: 12,
          border: `1px solid ${tokens.border}`,
          background: tokens.surface,
          color: tokens.text,
          outlineColor: tokens.accent,
        }}
      />
      {error && (
        <span role="alert" style={{ fontFamily: tokens.assistant, fontSize: "0.82rem", color: "#C0143C" }}>
          {error}
        </span>
      )}
    </div>
  );
}

// Same look as Field, for multi-line text (delivery notes).
function AreaField({
  label,
  mark,
  ...props
}: {
  label: string;
  mark?: "req" | "opt";
} & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label style={{ display: "grid", gap: "0.35rem" }}>
      <span style={{ fontFamily: tokens.rubik, fontWeight: 600, fontSize: "0.85rem", color: tokens.text }}>
        {label}
        <LabelMark mark={mark} />
      </span>
      <textarea
        {...props}
        rows={3}
        style={{
          fontFamily: tokens.assistant,
          fontSize: "1rem",
          padding: "0.75rem 0.9rem",
          borderRadius: 12,
          border: `1px solid ${tokens.border}`,
          background: tokens.surface,
          color: tokens.text,
          outlineColor: tokens.accent,
          resize: "vertical",
        }}
      />
    </label>
  );
}
