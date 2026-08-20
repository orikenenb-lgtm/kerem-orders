import type { Metadata } from "next";
import type { ReactNode } from "react";

// Pass-through server layout: route title for the client page (root template
// appends the brand).
//
// noindex, and deliberately not in the sitemap. This page renders the wholesale
// price list to anyone with the link — which is what the owner wants, he sends
// it to buyers himself. Being *indexed* is a different thing: it would put the
// whole price list one search away from any competitor, permanently, with no
// way to take it back. /view/ (the same catalogue without prices) stays
// indexable, so the site is still findable.
//
// A robots.txt cannot do this job here: on a GitHub Pages project site the file
// would land at /kerem-orders/robots.txt, and crawlers only read the one at the
// domain root — which lives in a different repository. The per-page meta tag is
// the only control that actually applies.
export const metadata: Metadata = {
  title: "קטלוג ומחירון",
  description: "קטלוג הצעצועים של כרם טויס עם מחירים — לצפייה בלבד.",
  robots: { index: false, follow: false },
};

export default function PricesLayout({ children }: { children: ReactNode }) {
  return children;
}
