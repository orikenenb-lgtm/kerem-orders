import Link from "next/link";
import SiteFooter from "./components/SiteFooter";
import { BUSINESS_NAME } from "../lib/config";
import s from "./status-page.module.css";

// Hebrew 404. Next exports this as out/404.html, which GitHub Pages serves
// for every unknown path — before this file existed visitors got the default
// English "This page could not be found".
//
// Server component on purpose: no hooks, no data fetch — a 404 must render
// even when everything else is broken. Styling is a static CSS module.
export default function NotFound() {
  return (
    <>
      <main id="main-content" tabIndex={-1} className={`${s.main} ${s.full}`}>
        <div className={s.card}>
          <span aria-hidden="true" className={s.icon}>
            🧸
          </span>
          <p className={s.code}>404</p>
          <h1 className={s.title}>העמוד שחיפשתם לא נמצא</h1>
          <p className={s.text}>
            יכול להיות שהקישור השתנה או שנפלה טעות הקלדה. אפשר לחזור לדף הבית או
            להמשיך ישר לקטלוג.
          </p>
          <div className={s.actions}>
            <Link href="/" className={s.primary}>
              לדף הבית
            </Link>
            <Link href="/view" className={s.secondary}>
              לקטלוג הציבורי
            </Link>
          </div>
          <p className={s.foot}>{BUSINESS_NAME}</p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
