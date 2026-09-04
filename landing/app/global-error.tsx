"use client";

// Global error boundary. This is the LAST line of defense: it replaces the
// root layout entirely when the layout itself (or something above every
// segment boundary) throws, so it must render its own <html>/<body> — nothing
// from app/layout.tsx wraps it. With `output: 'export'` Next still emits this
// as a static client boundary; it hydrates in the browser and never runs on a
// server. Kept deliberately self-contained: no data fetch, no shared header
// (SiteFooter/SiteHeader read live settings and could crash the fallback
// itself), only static tokens + the shop phone.
import { useEffect } from "react";
import { tokens, primaryBtn } from "../lib/ui";
import { PHONE_DISPLAY } from "../lib/config";

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
      <body style={{ margin: 0 }}>
        <main
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "1.1rem",
            padding: "2rem 1.25rem",
            textAlign: "center",
            background:
              "linear-gradient(160deg, #FFF8F0 0%, #FDF3F8 55%, #F0F7FF 100%)",
          }}
        >
          <span aria-hidden="true" style={{ fontSize: "3.2rem" }}>
            🧸
          </span>
          <h1
            style={{
              fontFamily: tokens.rubik,
              fontWeight: 800,
              fontSize: "clamp(1.6rem, 5vw, 2.4rem)",
              color: tokens.text,
              margin: 0,
            }}
          >
            משהו השתבש
          </h1>
          <p
            style={{
              fontFamily: tokens.assistant,
              fontSize: "1.05rem",
              color: tokens.body,
              margin: 0,
              maxWidth: 420,
            }}
          >
            נתקלנו בתקלה זמנית בטעינת העמוד. אפשר לנסות שוב, ואם התקלה חוזרת אתם
            מוזמנים להתקשר אלינו ונשמח לעזור.
          </p>
          <button type="button" onClick={() => reset()} style={primaryBtn(false)}>
            נסו שוב
          </button>
          <p
            style={{
              fontFamily: tokens.assistant,
              fontSize: "0.95rem",
              color: tokens.dim,
              marginTop: "1rem",
            }}
          >
            טלפון:{" "}
            <a href={`tel:${PHONE_DISPLAY}`} dir="ltr" style={{ color: tokens.body }}>
              {PHONE_DISPLAY}
            </a>
          </p>
        </main>
      </body>
    </html>
  );
}
