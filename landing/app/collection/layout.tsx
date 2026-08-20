import type { Metadata } from "next";

// A collection link is a bearer token: the 12-char slug is the only thing
// protecting a per-customer, discounted price list. Keeping it out of the
// sitemap is not enough — without this, one forward into an indexable surface
// makes that price list permanently searchable. Same treatment as /admin.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function CollectionLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
