"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SiteHeader from "../components/SiteHeader";
import SiteFooter from "../components/SiteFooter";
import PasswordInput from "../components/PasswordInput";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../lib/auth";
import { authErrorHe } from "../../lib/authErrors";
import { tokens, primaryBtn } from "../../lib/ui";

export default function LoginPage() {
  const router = useRouter();
  const { session } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session) router.replace("/catalog");
  }, [session, router]);

  // Email handed off from the register page (account already existed etc.)
  useEffect(() => {
    try {
      const last = localStorage.getItem("kt_last_email");
      if (last) {
        setEmail(last);
        localStorage.removeItem("kt_last_email");
      }
    } catch {
      /* ignore */
    }
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (err) {
        setError(authErrorHe(err.message));
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
            maxWidth: 420,
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
            התחברות
          </h1>
          <p style={{ fontFamily: tokens.assistant, color: tokens.body, marginBottom: "1.6rem" }}>
            ברוכים השבים לכרם טויס.
          </p>

          <form onSubmit={onSubmit} style={{ display: "grid", gap: "0.9rem" }}>
            <label style={{ display: "grid", gap: "0.35rem" }}>
              <span style={lbl}>אימייל</span>
              <input
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={inp}
              />
            </label>
            {/* Explicit htmlFor label: PasswordInput also renders the show/hide
                button, and an implicit label must not wrap that second control. */}
            <div style={{ display: "grid", gap: "0.35rem" }}>
              <label htmlFor="login-password" style={lbl}>סיסמה</label>
              <PasswordInput
                id="login-password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={inp}
              />
            </div>

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
              {busy ? "רגע…" : "התחברות"}
            </button>
          </form>

          <p style={{ fontFamily: tokens.assistant, marginTop: "1rem", textAlign: "center" }}>
            <Link href="/forgot" style={{ color: tokens.accent, fontWeight: 600, fontSize: "0.92rem" }}>
              שכחתם סיסמה?
            </Link>
          </p>

          <p style={{ fontFamily: tokens.assistant, color: tokens.body, marginTop: "0.6rem", textAlign: "center" }}>
            עוד אין לכם חשבון?{" "}
            <Link href="/register" style={{ color: tokens.accent, fontWeight: 600 }}>
              פתיחת חשבון לקוח
            </Link>
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

const lbl: React.CSSProperties = {
  fontFamily: tokens.rubik,
  fontWeight: 600,
  fontSize: "0.85rem",
  color: tokens.text,
};
const inp: React.CSSProperties = {
  fontFamily: tokens.assistant,
  fontSize: "1rem",
  padding: "0.75rem 0.9rem",
  borderRadius: 12,
  border: `1px solid ${tokens.border}`,
  background: tokens.surface,
  color: tokens.text,
  outlineColor: tokens.accent,
};
