import type { Metadata } from "next";
import { Rubik, Assistant } from "next/font/google";
import "./globals.css";
import "./tokens.css";
import Providers from "./providers";
import A11yWidget from "./components/A11yWidget";
import { featureFlags } from "../lib/featureFlags";

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

const base = process.env.NEXT_PUBLIC_BASE_PATH || "";

export const metadata: Metadata = {
  title: "כרם טויס — יבוא ושיווק צעצועים",
  description:
    "אלפי צעצועים צבעוניים, מותגים מובילים ומחירי סיטונאות — הכול במקום אחד.",
  manifest: `${base}/manifest.json`,
  icons: {
    icon: `${base}/icons/icon-192.png`,
    apple: `${base}/icons/apple-touch-icon.png`,
  },
  appleWebApp: {
    capable: true,
    title: "כרם טויס",
    statusBarStyle: "default",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="he"
      dir="rtl"
      // Wave 7 (ff_new_theme): the kt-theme-new class switches the CSS
      // variables in tokens.css to the warm skin. Flag off → class absent →
      // :root values (identical to the old literals) apply everywhere.
      className={`${rubik.variable} ${assistant.variable}${featureFlags.ff_new_theme ? " kt-theme-new" : ""}`}
    >
      <head>
        {/* Every page talks to Supabase (data + product images) — open the
            connection during HTML parse instead of on first fetch. */}
        <link rel="preconnect" href="https://mcdchalyzeqjkkgfeznd.supabase.co" />
      </head>
      <body>
        {/* Keyboard users can jump past the header straight to the content.
            Visually hidden until focused (styles in globals.css). */}
        <a href="#main-content" className="skip-link">
          דלגו לתוכן הראשי
        </a>
        <Providers>{children}</Providers>
        {featureFlags.ff_a11y_widget && <A11yWidget />}
      </body>
    </html>
  );
}
