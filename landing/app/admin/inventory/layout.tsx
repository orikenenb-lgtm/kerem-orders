import type { Metadata } from "next";
import type { ReactNode } from "react";

// Pass-through server layout: gives the stock-count screen its own tab title
// (otherwise it shares "ניהול"). noindex is inherited from the admin layout.
export const metadata: Metadata = {
  title: "ספירת מלאי",
};

export default function InventoryLayout({ children }: { children: ReactNode }) {
  return children;
}
