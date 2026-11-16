"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { tokens } from "../../lib/ui";
import { getMinOrderTotal } from "../../lib/siteSettings";
import { BUSINESS_TAGLINE, MIN_ORDER_FALLBACK } from "../../lib/config";
import { CONTACT } from "./SiteHeader";
import { featureFlags } from "../../lib/featureFlags";
import styles from "./SiteFooter.module.css";

// Decorative line icons inside a pastel chip — the text beside each carries
// the meaning, so every icon is aria-hidden.
const ICONS: Record<string, ReactNode> = {
  truck: (
    <>
      <path d="M3 6.5h11v9H3zM14 9.5h3.6l3.4 3.4v2.6h-7z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <circle cx="7" cy="17" r="1.9" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="17" cy="17" r="1.9" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </>
  ),
  receipt: (
    <path d="M6 3.5h12v17l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3zM9 8h6M9 11.5h6M9 15h3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" />
  ),
  check: (
    <>
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8.3 12.2l2.5 2.5 4.9-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  phone: (
    <path d="M6.6 3.5h3l1.5 4-2 1.3a11 11 0 0 0 6.1 6.1l1.3-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
  ),
};

function Chip({ icon, tone }: { icon: keyof typeof ICONS; tone: "mint" | "peach" | "sky" | "lav" }) {
  return (
    <span className={`${styles.chip} ${styles[tone]}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">{ICONS[icon]}</svg>
    </span>
  );
}

// פוטר מקצועי משותף לעמודי החנות — מותג, קישורים מהירים ופרטי קשר.
export default function SiteFooter() {
  // Same rule as the header strip: never hardcode the minimum — read the one
  // value the cart actually enforces.
  const [minOrder, setMinOrder] = useState(MIN_ORDER_FALLBACK);

  useEffect(() => {
    getMinOrderTotal().then(setMinOrder);
  }, []);

  // Link hit areas stay ≥24px tall (measured 91x17 before — under the WCAG 2.2
  // AA 24x24 minimum). The footer phone number is how a wholesale buyer
  // actually calls.
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.brand}>
          <span
            className={styles.wordmark}
            style={{ fontFamily: tokens.rubik, backgroundImage: tokens.rainbow }}
          >
            כרם טויס
          </span>
          <span className={styles.tagline}>{BUSINESS_TAGLINE}</span>
          <p className={styles.about}>
            סיטונאות צעצועים — קטלוג מלא מעודכן ישירות מהמלאי, הזמנה אונליין ומחירים אישיים ללקוחות קבועים.
          </p>
        </div>

        <nav className={styles.col} aria-labelledby="kt-footer-nav">
          <h2 id="kt-footer-nav" className={styles.head}>ניווט מהיר</h2>
          <ul className={styles.list}>
            <li><Link href="/catalog" className={styles.link}>הקטלוג</Link></li>
            {/* A plain link to the public product index — how a crawler that
                lands anywhere on the site reaches every product page. */}
            {featureFlags.ff_public_product_pages && (
              <li><Link href="/p/" className={styles.link}>כל המוצרים</Link></li>
            )}
            <li><Link href="/account" className={styles.link}>ההזמנות שלי</Link></li>
            <li><Link href="/register" className={styles.link}>פתיחת חשבון סיטונאי</Link></li>
            <li><Link href="/login" className={styles.link}>התחברות</Link></li>
          </ul>
        </nav>

        <div className={styles.col}>
          <h2 className={styles.head}>מידע</h2>
          <ul className={styles.list}>
            <li className={styles.fact}><Chip icon="truck" tone="mint" />משלוח לכל הארץ</li>
            <li className={styles.fact}>
              <Chip icon="receipt" tone="peach" />
              <span>מינימום הזמנה <bdi className={styles.num}>₪{minOrder.toLocaleString("he-IL")}</bdi></span>
            </li>
            <li className={styles.fact}><Chip icon="check" tone="sky" />המחירים כוללים מע״מ</li>
            <li><Link href="/accessibility" className={styles.link}>הצהרת נגישות</Link></li>
          </ul>
        </div>

        <div className={styles.col}>
          <h2 className={styles.head}>יצירת קשר</h2>
          <ul className={styles.list}>
            {CONTACT.whatsapp ? (
              <li><a href={`https://wa.me/${CONTACT.whatsapp}`} target="_blank" rel="noreferrer" className={styles.link}>💬 וואטסאפ</a></li>
            ) : null}
            {CONTACT.phone ? (
              <li>
                <a href={`tel:${CONTACT.phone}`} className={styles.phone}>
                  <Chip icon="phone" tone="lav" />
                  <span dir="ltr" className={styles.num}>{CONTACT.phone}</span>
                </a>
              </li>
            ) : null}
            {CONTACT.email ? (
              <li><a href={`mailto:${CONTACT.email}`} dir="ltr" className={styles.link} style={{ textAlign: "right" }}>✉️ {CONTACT.email}</a></li>
            ) : null}
          </ul>
        </div>
      </div>

      <div className={styles.bottom}>
        <div className={styles.bottomInner}>
          © <span suppressHydrationWarning>{new Date().getFullYear()}</span> כרם טויס · כל הזכויות שמורות
        </div>
      </div>
    </footer>
  );
}
