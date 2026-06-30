import type { Metadata } from "next";
import { Rubik, Assistant } from "next/font/google";
import "./globals.css";
import Providers from "./providers";

const rubik = Rubik({
  subsets: ["hebrew", "latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  variable: "--font-rubik",
  display: "swap",
});

const assistant = Assistant({
  subsets: ["hebrew", "latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-assistant",
  display: "swap",
});

export const metadata: Metadata = {
  title: "כרם טויס — יבוא ושיווק צעצועים",
  description:
    "אלפי צעצועים צבעוניים, מותגים מובילים ומחירי סיטונאות — הכול במקום אחד.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="he" dir="rtl" className={`${rubik.variable} ${assistant.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
