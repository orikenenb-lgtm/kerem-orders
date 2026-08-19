"use client";

// The sign-in form — the "התחברות" tab of the single customer entry screen
// (see AuthShell). Renders the card's contents only; the page chrome belongs
// to the shell.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PasswordInput from "../PasswordInput";
import { supabase } from "../../../lib/supabaseClient";
import { useAuth } from "../../../lib/auth";
import { authErrorHe } from "../../../lib/authErrors";
import { tokens, primaryBtn, linkBtn } from "../../../lib/ui";
import type { AuthTab } from "./AuthShell";

export default function LoginForm({ onSwitch }: { onSwitch: (t: AuthTab) => void }) {
  const router = useRouter();
  const { session } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session) router.replace("/catalog");
  }, [session, router]);

  // Email handed off from the register tab (account already existed etc.)
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
      <p style={{ fontFamily: tokens.assistant, color: tokens.body, marginBottom: "1.5rem" }}>
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
        <button type="button" onClick={() => onSwitch("forgot")} style={{ ...linkBtn, fontSize: "0.92rem" }}>
          שכחתם סיסמה?
        </button>
      </p>

      <p style={{ fontFamily: tokens.assistant, color: tokens.body, marginTop: "0.6rem", textAlign: "center" }}>
        עוד אין לכם חשבון?{" "}
        <button type="button" onClick={() => onSwitch("register")} style={linkBtn}>
          פתיחת חשבון לקוח
        </button>
      </p>
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
