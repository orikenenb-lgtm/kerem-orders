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

const SITE_DESCRIPTION =
  "אלפי צעצועים צבעוניים, מותגים מובילים ומחירי סיטונאות — הכול במקום אחד.";

export const metadata: Metadata = {
  // Absolute base for canonical/OG URL resolution on GitHub Pages.
  metadataBase: new URL("https://orikenenb-lgtm.github.io/kerem-orders/"),
  // Route layouts set a short page name; the template appends the brand —
  // so every tab/bookmark/share reads "X — כרם טויס" instead of one generic
  // title everywhere.
  title: {
    default: "כרם טויס — יבוא ושיווק צעצועים",
    template: "%s — כרם טויס",
  },
  description: SITE_DESCRIPTION,
  manifest: `${base}/manifest.json`,
  icons: {
    icon: `${base}/icons/icon-192.png`,
    apple: `${base}/icons/apple-touch-icon.png`,
  },
  // Open Graph without an image on purpose: there is no real logo/brand
  // asset in the project yet, and a made-up one is worse than none.
  openGraph: {
    type: "website",
    siteName: "כרם טויס",
    title: "כרם טויס — יבוא ושיווק צעצועים",
    description: SITE_DESCRIPTION,
    locale: "he_IL",
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
