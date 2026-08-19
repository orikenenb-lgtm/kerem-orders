"use client";

// Kept as its own URL so links already sent out keep working — it opens the
// one customer screen with the "שכחתי סיסמה" tab selected.
import AuthShell from "../components/auth/AuthShell";

export default function ForgotPage() {
  return <AuthShell initial="forgot" />;
}
