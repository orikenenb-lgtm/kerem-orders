"use client";

// Segment error boundary for the root. When a page under app/ throws during
// render, this replaces just that page's content while the root layout (skip
// link, providers, fonts, dir="rtl") stays mounted around it — so a crash in
// one screen is a recoverable card, not the blank white page it was before.
// Self-contained on purpose: the fallback must not itself depend on live data
// (SiteHeader/SiteFooter fetch site settings and could crash in turn), so it
// uses only a static CSS module and the shop phone.
import { useEffect } from "react";
import s from "./status-page.module.css";
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
    <main id="main-content" tabIndex={-1} className={s.main}>
      <div className={s.card}>
        <span aria-hidden="true" className={s.icon}>
          🧸
        </span>
        <h1 className={s.title}>משהו השתבש</h1>
        <p className={s.text}>
          נתקלנו בתקלה זמנית בטעינת העמוד. אפשר לנסות שוב, ואם התקלה חוזרת אתם
          מוזמנים להתקשר אלינו ונשמח לעזור.
        </p>
        <div className={s.actions}>
          <button type="button" onClick={() => reset()} className={s.primary}>
            נסו שוב
          </button>
        </div>
        <p className={s.foot}>
          טלפון:{" "}
          <a href={`tel:${PHONE_DISPLAY}`} dir="ltr" className={s.phone}>
            {PHONE_DISPLAY}
          </a>
        </p>
      </div>
    </main>
  );
}
