import type { Metadata } from "next";
import type { ReactNode } from "react";

// The page itself is a client component and cannot export metadata — this
// pass-through server layout carries the route title (root template appends
// the brand).
export const metadata: Metadata = {
  title: "קטלוג המוצרים",
  description: "קטלוג הצעצועים המלא של כרם טויס — לצפייה חופשית, בלי צורך בחשבון.",
};

export default function ViewLayout({ children }: { children: ReactNode }) {
  return children;
}
