import type { Metadata } from "next";
import type { ReactNode } from "react";

// Pass-through server layout: route title for the client page (root template
// appends the brand). The page is one static export shared by every ?id=, so
// a generic title is the honest one — the product name is only known at
// runtime.
// noindex: this route is behind the customer sign-in and redirects to /login
// without a session, so the only thing a crawler can index is an empty shell
// with a redirect. Same treatment as /admin.
export const metadata: Metadata = {
  title: "פרטי מוצר",
  robots: { index: false, follow: false },
};

export default function ProductLayout({ children }: { children: ReactNode }) {
  return children;
}
