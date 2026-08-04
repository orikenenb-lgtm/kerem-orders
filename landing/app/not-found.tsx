import Link from "next/link";
import { tokens } from "../lib/ui";
import { BUSINESS_NAME } from "../lib/config";

// Hebrew 404. Next exports this as out/404.html, which GitHub Pages serves
// for every unknown path — before this file existed visitors got the default
// English "This page could not be found".
//
// Server component on purpose: no hooks, no data fetch — a 404 must render
// even when everything else is broken.
export default function NotFound() {
  const btnBase = {
    minHeight: 52,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    fontFamily: tokens.rubik,
    fontWeight: 700,
    fontSize: "1rem",
    textDecoration: "none",
    padding: "0.75rem 1.6rem",
  } as const;

  return (
    <main
      id="main-content"
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1.1rem",
        padding: "2rem 1.25rem",
        textAlign: "center",
        background: "linear-gradient(160deg, #FFF8F0 0%, #FDF3F8 55%, #F0F7FF 100%)",
      }}
    >
      <span aria-hidden="true" style={{ fontSize: "3.2rem" }}>
        🧸
      </span>
      <p
        style={{
          fontFamily: tokens.rubik,
          fontWeight: 900,
          fontSize: "1.1rem",
          letterSpacing: "0.2em",
          color: tokens.dim,
          margin: 0,
        }}
      >
        404
      </p>
      <h1
        style={{
          fontFamily: tokens.rubik,
          fontWeight: 800,
          fontSize: "clamp(1.6rem, 5vw, 2.4rem)",
          color: tokens.text,
          margin: 0,
        }}
      >
        העמוד שחיפשתם לא נמצא
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
        יכול להיות שהקישור השתנה או שנפלה טעות הקלדה. אפשר לחזור לדף הבית או
        להמשיך ישר לקטלוג.
      </p>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.8rem",
          justifyContent: "center",
          marginTop: "0.6rem",
        }}
      >
        <Link
          href="/"
          style={{
            ...btnBase,
            color: "#fff",
            background: "linear-gradient(105deg, #CC4A00, #C81E56)",
          }}
        >
          לדף הבית
        </Link>
        <Link
          href="/view"
          style={{
            ...btnBase,
            color: "#B22355",
            background: "rgba(255,255,255,0.9)",
            border: "2px solid #E8336D",
          }}
        >
          לקטלוג הציבורי
        </Link>
      </div>
      <p
        style={{
          fontFamily: tokens.assistant,
          fontSize: "0.85rem",
          color: tokens.dim,
          marginTop: "1.4rem",
        }}
      >
        {BUSINESS_NAME}
      </p>
    </main>
  );
}
