import type { Metadata } from "next";
import type { ReactNode } from "react";

// Pass-through server layout: route title for the client page (root template
// appends the brand).
// noindex: this route is behind the customer sign-in and redirects to /login
// without a session, so the only thing a crawler can index is an empty shell
// with a redirect. Same treatment as /admin.
export const metadata: Metadata = {
  title: "ההזמנות שלי",
  robots: { index: false, follow: false },
};

export default function AccountLayout({ children }: { children: ReactNode }) {
  return children;
}
