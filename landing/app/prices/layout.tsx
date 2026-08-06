import type { Metadata } from "next";
import type { ReactNode } from "react";

// Pass-through server layout: route title for the client page (root template
// appends the brand).
export const metadata: Metadata = {
  title: "קטלוג ומחירון",
  description: "קטלוג הצעצועים של כרם טויס עם מחירים — לצפייה בלבד.",
};

export default function PricesLayout({ children }: { children: ReactNode }) {
  return children;
}
