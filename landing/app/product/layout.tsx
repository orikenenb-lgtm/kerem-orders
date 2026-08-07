import type { Metadata } from "next";
import type { ReactNode } from "react";

// Pass-through server layout: route title for the client page (root template
// appends the brand). The page is one static export shared by every ?id=, so
// a generic title is the honest one — the product name is only known at
// runtime.
export const metadata: Metadata = {
  title: "פרטי מוצר",
};

export default function ProductLayout({ children }: { children: ReactNode }) {
  return children;
}
