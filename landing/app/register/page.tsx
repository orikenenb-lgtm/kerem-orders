"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SiteHeader from "../components/SiteHeader";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../lib/auth";
import { featureFlags } from "../../lib/featureFlags";
import { tokens, primaryBtn } from "../../lib/ui";

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

// 10 digits starting with 0; spaces and dashes are fine ("050-123 4567").
const isValidPhone = (v: string) => /^0\d{9}$/.test(v.replace(/[\s-]/g, ""));

export default function RegisterPage() {
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
  // Per-field messages shown under the phone / house-number inputs (flag-on).
  const [fieldErrors, setFieldErrors] = useState<{
    phone?: string;
    house_number?: string;
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
  // (the function stores the columns it knows and ignores anything else).
  const signupBody = () =>
    ADDR
      ? { ...form }
      : {
          business_name: form.business_name,
          full_name: form.full_name,
          vat_number: form.vat_number,
          phone: form.phone,
          email: form.email,
          password: form.password,
        };

  // Call the signup function; if the SDK path fails for any reason, fall back
  // to a plain fetch so a client-side SDK hiccup can never block registration.
  const callSignup = async (): Promise<{ ok?: boolean; error?: string }> => {
    const body = signupBody();
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("signup", {
        body,
      });
      if (!fnErr) return (data as { ok?: boolean; error?: string }) ?? {};
      const ctx = (fnErr as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") {
        try {
          return await ctx.json();
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
      resBody = await res.json();
    } catch {
      /* non-JSON response */
    }
    // Never treat a failed HTTP response without an explicit error as success.
    if (!res.ok && !resBody?.error) {
      return { error: "ההרשמה נכשלה. נסו שוב בעוד רגע." };
    }
    return resBody;
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (ADDR) {
      // Same rules as the on-blur checks — one last look before sending.
      const errs = {
        phone: !isValidPhone(form.phone) ? PHONE_ERROR : undefined,
        house_number:
          form.house_number.trim() === "" ? HOUSE_ERROR : undefined,
      };
      if (errs.phone || errs.house_number) {
        setFieldErrors(errs);
        return;
      }
    }
    setBusy(true);
    try {
      const result = await callSignup();
      if (result?.error) {
        setError(result.error);
        setBusy(false);
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
      // Instant login (user is pre-confirmed by the signup function).
      const email = form.email.trim().toLowerCase();
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email,
        password: form.password,
      });
      if (signInErr) {
        // Account exists — hand off to the login page with the email prefilled.
        try {
          localStorage.setItem("kt_last_email", email);
        } catch {
          /* ignore */
        }
        router.replace("/login");
        return;
      }
      router.replace("/catalog");
    } catch {
      setError("שגיאת רשת. בדקו את החיבור ונסו שוב.");
      setBusy(false);
    }
  };

  const phoneHint = (
    <p style={{ fontFamily: tokens.assistant, fontSize: "0.8rem", color: tokens.dim, marginTop: "-0.4rem" }}>
      💡 כבר לקוחות של כרם טויס? הזינו את הטלפון המעודכן אצלנו — והמערכת תזהה אתכם אוטומטית.
    </p>
  );

  return (
    <>
      <SiteHeader />
      <main id="main-content"
        style={{
          minHeight: "calc(100vh - 64px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2.5rem 1.25rem",
          background: tokens.surface,
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 440,
            background: "#fff",
            borderRadius: 24,
            border: `1px solid ${tokens.border}`,
            boxShadow: "0 20px 60px rgba(26,23,48,0.08)",
            padding: "clamp(1.75rem, 5vw, 2.75rem)",
          }}
        >
          <h1
            style={{
              fontFamily: tokens.rubik,
              fontWeight: 800,
              fontSize: "1.9rem",
              color: tokens.text,
              marginBottom: "0.4rem",
            }}
          >
            פתיחת חשבון לקוח
          </h1>
          <p
            style={{
              fontFamily: tokens.assistant,
              color: tokens.body,
              marginBottom: "1.6rem",
            }}
          >
            כמה פרטים ואתם בפנים — מתחברים מיד, בלי אימות במייל.
          </p>

          <form onSubmit={onSubmit} style={{ display: "grid", gap: "0.9rem" }}>
            {ADDR ? (
              <>
                <Field label="שם העסק / החנות" mark="req" value={form.business_name} onChange={set("business_name")} required />
                <Field label="שם איש קשר" mark="req" value={form.full_name} onChange={set("full_name")} required />
                <Field
                  label="טלפון"
                  mark="req"
                  value={form.phone}
                  onChange={set("phone")}
                  onBlur={onPhoneBlur}
                  error={fieldErrors.phone}
                  type="tel"
                  inputMode="tel"
                  required
                />
                {phoneHint}
                <Field label="אימייל" mark="req" value={form.email} onChange={set("email")} type="email" required />
                <Field label="עוסק מורשה / ח.פ" mark="req" value={form.vat_number} onChange={set("vat_number")} inputMode="numeric" required />
                <Field label="עיר" mark="req" value={form.city} onChange={set("city")} list="kt-city-list" required />
                <datalist id="kt-city-list">
                  {CITY_LIST.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
                <Field label="רחוב" mark="req" value={form.street} onChange={set("street")} required />
                <Field
                  label="מספר בית"
                  mark="req"
                  value={form.house_number}
                  onChange={set("house_number")}
                  onBlur={onHouseBlur}
                  error={fieldErrors.house_number}
                  required
                />
                <Field label="מיקוד" mark="opt" value={form.zip_code} onChange={set("zip_code")} inputMode="numeric" />
                <AreaField
                  label="הערות למשלוח"
                  mark="opt"
                  value={form.delivery_notes}
                  onChange={set("delivery_notes")}
                  placeholder="לדוגמה: להשאיר במחסן, לתאם טלפונית לפני הגעה…"
                />
                <Field label="סיסמה (לפחות 6 תווים)" mark="req" value={form.password} onChange={set("password")} type="password" required />
              </>
            ) : (
              <>
                <Field label="שם העסק / החנות" value={form.business_name} onChange={set("business_name")} required />
                <Field label="שם איש קשר" value={form.full_name} onChange={set("full_name")} required />
                <Field label="עוסק מורשה / ח.פ" value={form.vat_number} onChange={set("vat_number")} inputMode="numeric" required />
                <Field label="טלפון" value={form.phone} onChange={set("phone")} type="tel" inputMode="tel" />
                {phoneHint}
                <Field label="אימייל" value={form.email} onChange={set("email")} type="email" required />
                <Field label="סיסמה (לפחות 6 תווים)" value={form.password} onChange={set("password")} type="password" required />
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

            <button type="submit" disabled={busy} style={primaryBtn(busy)}>
              {busy ? (ADDR ? "שולח..." : "רגע…") : "פתחו חשבון והתחילו"}
            </button>
          </form>

          <p style={{ fontFamily: tokens.assistant, color: tokens.body, marginTop: "1.3rem", textAlign: "center" }}>
            כבר יש לכם חשבון?{" "}
            <Link href="/login" style={{ color: tokens.accent, fontWeight: 600 }}>
              להתחברות
            </Link>
          </p>
        </div>
      </main>
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
