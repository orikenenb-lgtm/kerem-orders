import type { Metadata } from "next";
import type { ReactNode } from "react";

// Pass-through server layout: route title for the client page (root template
// appends the brand).
export const metadata: Metadata = {
  title: "פתיחת חשבון לקוח",
};

export default function RegisterLayout({ children }: { children: ReactNode }) {
  return children;
}
