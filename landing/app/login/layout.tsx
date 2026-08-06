import type { Metadata } from "next";
import type { ReactNode } from "react";

// Pass-through server layout: route title for the client page (root template
// appends the brand).
export const metadata: Metadata = {
  title: "התחברות",
};

export default function LoginLayout({ children }: { children: ReactNode }) {
  return children;
}
