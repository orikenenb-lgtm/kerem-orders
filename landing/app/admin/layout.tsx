import type { Metadata } from "next";
import type { ReactNode } from "react";

// Pass-through server layout for /admin and everything under it (the
// images-review screen included).
export const metadata: Metadata = {
  title: "ניהול",
  // Management screens have no business in a search index. Access itself is
  // enforced by RLS + the client-side manager guard; this only keeps the
  // route out of crawlers.
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return children;
}
