"use client";

// Kept as its own URL so links already sent out keep working — it opens the
// one customer screen with the "הרשמה" tab selected.
import AuthShell from "../components/auth/AuthShell";

export default function RegisterPage() {
  return <AuthShell initial="register" />;
}
