import type { Metadata } from "next";
import type { ReactNode } from "react";

// Pass-through server layout: distinguishes this screen from /admin in the
// tab title (both otherwise share "ניהול"). noindex is inherited from the
// admin layout above.
export const metadata: Metadata = {
  title: "יישור תמונות",
};

export default function ImagesReviewLayout({ children }: { children: ReactNode }) {
  return children;
}
