"use client";

// Global error boundary. This is the LAST line of defense: it replaces the
// root layout entirely when the layout itself (or something above every
// segment boundary) throws, so it must render its own <html>/<body> — nothing
// from app/layout.tsx wraps it. With `output: 'export'` Next still emits this
// as a static client boundary; it hydrates in the browser and never runs on a
// server. Kept deliberately self-contained: no data fetch, no shared header
// (SiteFooter/SiteHeader read live settings and could crash the fallback
// itself), only static literal styles + the shop phone.
import { useEffect } from "react";
import { PHONE_DISPLAY } from "../lib/config";

// Literal premium palette (same values as html.kt-premium in app/tokens.css):
// this boundary replaces the root layout, so neither the theme class nor the
// font variables can be relied on to exist here. Contrast: ink on white
// 15.9:1, body 9.5:1, dim 5.5:1, white on purple 7.1:1.
const P = {
  bg: "#FBFAFF",
  lav: "#EEE5FF",
  sky: "#DBEEFF",
  ink: "#27163F",
  body: "#4A3D63",
  dim: "#6B6185",
  purple: "#6D28D9",
};
const HEAD_FONT = "var(--font-rubik, system-ui), system-ui, sans-serif";
const BODY_FONT = "var(--font-assistant, system-ui), system-ui, sans-serif";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Never sent to an external service. Visible in dev only, so a broken
    // render is debuggable locally without leaking anything in production.
    if (process.env.NODE_ENV === "development") {
      console.error(error);
    }
  }, [error]);

  return (
    <html lang="he" dir="rtl">
      <body style={{ margin: 0, background: P.bg }}>
        <main
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "2rem 1rem",
            boxSizing: "border-box",
            textAlign: "center",
            background: `radial-gradient(900px 480px at 100% 0%, ${P.lav} 0%, transparent 60%), radial-gradient(700px 420px at 0% 100%, ${P.sky} 0%, transparent 60%), ${P.bg}`,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 540,
              boxSizing: "border-box",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "1rem",
              background: "#FFFFFF",
              border: "1px solid rgba(39,22,63,0.1)",
              borderRadius: 28,
              boxShadow: "0 2px 6px rgba(39,22,63,0.06), 0 18px 48px rgba(76,29,149,0.18)",
              padding: "clamp(1.8rem, 6vw, 3rem) clamp(1.2rem, 5vw, 2.75rem)",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                display: "grid",
                placeItems: "center",
                width: 84,
                height: 84,
                borderRadius: "50%",
                background: P.lav,
                fontSize: "2.6rem",
                lineHeight: 1,
              }}
            >
              🧸
            </span>
            <h1
              style={{
                fontFamily: HEAD_FONT,
                fontWeight: 800,
                fontSize: "clamp(1.6rem, 5vw, 2.3rem)",
                lineHeight: 1.2,
                color: P.ink,
                margin: 0,
              }}
            >
              משהו השתבש
            </h1>
            <p
              style={{
                fontFamily: BODY_FONT,
                fontSize: "1.05rem",
                lineHeight: 1.65,
                color: P.body,
                margin: 0,
                maxWidth: 420,
              }}
            >
              נתקלנו בתקלה זמנית בטעינת העמוד. אפשר לנסות שוב, ואם התקלה חוזרת אתם
              מוזמנים להתקשר אלינו ונשמח לעזור.
            </p>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                minHeight: 52,
                fontFamily: HEAD_FONT,
                fontWeight: 700,
                fontSize: "1rem",
                color: "#FFFFFF",
                background: P.purple,
                border: "1.5px solid transparent",
                borderRadius: 999,
                padding: "0.8rem 1.7rem",
                cursor: "pointer",
                marginTop: "0.4rem",
              }}
            >
              נסו שוב
            </button>
            <p
              style={{
                fontFamily: BODY_FONT,
                fontSize: "0.95rem",
                color: P.dim,
                margin: "0.6rem 0 0",
              }}
            >
              טלפון:{" "}
              <a href={`tel:${PHONE_DISPLAY}`} dir="ltr" style={{ color: P.purple, fontWeight: 700 }}>
                {PHONE_DISPLAY}
              </a>
            </p>
          </div>
        </main>
      </body>
    </html>
  );
}
