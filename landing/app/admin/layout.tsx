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

// 2026-11 premium redesign: the management screens keep their previous look.
// kt-scope-classic (tokens.css) re-declares the design variables with the
// pre-redesign values for everything inside it, so the new skin cannot leak
// into admin tables, forms and buttons. With ff_premium_theme off the class
// matches nothing new and this wrapper is visually inert.
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <div className="kt-scope-classic">{children}</div>;
}
