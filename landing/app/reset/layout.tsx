import type { Metadata } from "next";
import type { ReactNode } from "react";

// Pass-through server layout: route title for the client page (root template
// appends the brand).
// noindex: reached only from the one-time recovery link Supabase mails out.
// It is useless in a search result and the URL carries a recovery token.
export const metadata: Metadata = {
  title: "בחירת סיסמה חדשה",
  robots: { index: false, follow: false },
};

export default function ResetLayout({ children }: { children: ReactNode }) {
  return children;
}
