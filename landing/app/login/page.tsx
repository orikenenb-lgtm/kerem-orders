"use client";

// The single entry link for customers. Sign-in, registration and password
// reset are tabs of one screen (AuthShell) — so there is one link to hand
// out, not three.
import AuthShell from "../components/auth/AuthShell";

export default function LoginPage() {
  return <AuthShell initial="login" />;
}
