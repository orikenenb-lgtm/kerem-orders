import type { Metadata } from "next";
import type { ReactNode } from "react";

// Pass-through server layout for /admin and everything under it (the
// images-review screen included).
export const metadata: Metadata = {
  // default covers /admin itself; the template brands nested screens'
  // titles (e.g. images-review) — the root template does not reach past
  // this layout once it declares a title of its own.
  title: {
    default: "ניהול",
    template: "%s — כרם טויס",
  },
  // Management screens have no business in a search index. Access itself is
  // enforced by RLS + the client-side manager guard; this only keeps the
  // route out of crawlers.
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return children;
}
