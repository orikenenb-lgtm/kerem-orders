"use client";

// Segment error boundary for the root. When a page under app/ throws during
// render, this replaces just that page's content while the root layout (skip
// link, providers, fonts, dir="rtl") stays mounted around it — so a crash in
// one screen is a recoverable card, not the blank white page it was before.
// Self-contained on purpose: the fallback must not itself depend on live data
// (SiteHeader/SiteFooter fetch site settings and could crash in turn), so it
// uses only the static tokens and the shop phone.
import { useEffect } from "react";
import { tokens, primaryBtn } from "../lib/ui";
import { PHONE_DISPLAY } from "../lib/config";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Never sent to an external service — dev-only console output.
    if (process.env.NODE_ENV === "development") {
      console.error(error);
    }
  }, [error]);

  return (
    <main
      id="main-content"
      tabIndex={-1}
      style={{
        minHeight: "70vh",
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
  );
}
