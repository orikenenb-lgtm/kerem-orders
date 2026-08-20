import type { Metadata } from "next";
import type { ReactNode } from "react";

// noindex: manager-only, behind the sign-in, and it lists real people's
// contact details. Same treatment as the rest of /admin.
export const metadata: Metadata = {
  title: "לקוחות",
  robots: { index: false, follow: false },
};

export default function CustomersLayout({ children }: { children: ReactNode }) {
  return children;
}
