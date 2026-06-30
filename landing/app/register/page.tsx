"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SiteHeader from "../components/SiteHeader";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../lib/auth";
import { tokens, primaryBtn } from "../../lib/ui";

export default function RegisterPage() {
  const router = useRouter();
  const { session } = useAuth();
  const [form, setForm] = useState({
    business_name: "",
    full_name: "",
    phone: "",
    email: "",
    password: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Already signed in → go to catalog.
  useEffect(() => {
    if (session) router.replace("/catalog");
  }, [session, router]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("signup", {
        body: form,
      });
      if (fnErr) {
        // Edge function returns a JSON error body on 400 — surface it.
        let msg = "ההרשמה נכשלה, נסו שוב.";
        try {
          const ctx = (fnErr as { context?: Response }).context;
          if (ctx && typeof ctx.json === "function") {
            const body = await ctx.json();
            if (body?.error) msg = body.error;
          }
        } catch {
          /* ignore */
        }
        setError(msg);
        setBusy(false);
        return;
      }
      if (data?.error) {
        setError(data.error);
        setBusy(false);
        return;
      }
      // Instant login (user is pre-confirmed by the signup function).
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: form.email.trim().toLowerCase(),
        password: form.password,
      });
      if (signInErr) {
        setError("נרשמת! אבל ההתחברות נכשלה — נסו להתחבר ידנית.");
        setBusy(false);
        return;
      }
      router.replace("/catalog");
    } catch {
      setError("שגיאת רשת. בדקו את החיבור ונסו שוב.");
      setBusy(false);
    }
  };

  return (
    <>
      <SiteHeader />
      <main
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
            פתיחת חשבון סיטונאי
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
            <Field label="שם העסק / החנות" value={form.business_name} onChange={set("business_name")} required />
            <Field label="שם איש קשר" value={form.full_name} onChange={set("full_name")} required />
            <Field label="טלפון" value={form.phone} onChange={set("phone")} type="tel" inputMode="tel" />
            <Field label="אימייל" value={form.email} onChange={set("email")} type="email" required />
            <Field label="סיסמה (לפחות 6 תווים)" value={form.password} onChange={set("password")} type="password" required />

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
              {busy ? "רגע…" : "פתחו חשבון והתחילו"}
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

function Field({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label style={{ display: "grid", gap: "0.35rem" }}>
      <span style={{ fontFamily: tokens.rubik, fontWeight: 600, fontSize: "0.85rem", color: tokens.text }}>
        {label}
      </span>
      <input
        {...props}
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
    </label>
  );
}
