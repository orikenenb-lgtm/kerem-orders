"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getMinOrderTotal } from "../../lib/siteSettings";
import { tokens } from "../../lib/ui";
import {
  MIN_ORDER_FALLBACK,
  PHONE_DISPLAY,
  PHONE_TEL,
  BUSINESS_NAME,
  BUSINESS_TAGLINE,
} from "../../lib/config";

// Wave 1 landing screen (behind ff_new_landing): one clean, centered screen —
// name, two big buttons, the two facts a customer must know (minimum order +
// VAT), and a tappable phone number. No animations, no hero assets.
export default function LandingV2() {
  // Display-only: the enforced value lives in the DB and is read again in the
  // cart. Anon RLS exposes exactly this key; on any failure show the fallback.
  const [minOrder, setMinOrder] = useState(MIN_ORDER_FALLBACK);

  useEffect(() => {
    getMinOrderTotal().then(setMinOrder);
  }, []);

  return (
    <main id="main-content" tabIndex={-1} className="lv2-main">
      {/* soft decorative blobs — static, aria-hidden, low intensity */}
      <div aria-hidden="true" className="lv2-blob lv2-blob-a" />
      <div aria-hidden="true" className="lv2-blob lv2-blob-b" />

      <div className="lv2-card">
        <h1 className="lv2-title">{BUSINESS_NAME}</h1>
        <p className="lv2-tagline">{BUSINESS_TAGLINE}</p>

        <div className="lv2-actions">
          <Link href="/login" className="lv2-btn lv2-btn-primary">
            כניסה לחשבון
          </Link>
          <Link href="/register" className="lv2-btn lv2-btn-secondary">
            פתיחת חשבון לקוח
          </Link>
        </div>

        <Link href="/view" className="lv2-browse">
          לצפייה בקטלוג — בלי צורך בחשבון ←
        </Link>

        <div className="lv2-facts">
          <p className="lv2-fact">
            <span aria-hidden="true">🛒</span>
            מינימום הזמנה: {minOrder.toLocaleString("he-IL")} ₪
          </p>
          <hr className="lv2-fact-divider" />
          <p className="lv2-fact">
            <span aria-hidden="true">🧾</span>
            כל המחירים כוללים מע״מ
          </p>
        </div>
      </div>

      <footer className="lv2-footer">
        <a href={`tel:${PHONE_TEL}`} className="lv2-phone">
          <span aria-hidden="true">📞</span>
          <span>להזמנות ושאלות:</span>
          <span dir="ltr">{PHONE_DISPLAY}</span>
        </a>
        <p className="lv2-copy" suppressHydrationWarning>
          {BUSINESS_NAME} · {new Date().getFullYear()} ·{" "}
          {/* The statement page must stay reachable (IS 5568) even though the
              floating widget was removed — a quiet text link, not a button. */}
          <Link href="/accessibility" className="lv2-a11y">
            הצהרת נגישות
          </Link>
        </p>
      </footer>

      <style>{`
        .lv2-main {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 2.5rem;
          padding: 2rem 1.25rem;
          position: relative;
          overflow: hidden;
          background: linear-gradient(160deg, #FFF8F0 0%, #FDF3F8 55%, #F0F7FF 100%);
        }
        .lv2-blob {
          position: absolute;
          border-radius: 50%;
          filter: blur(70px);
          opacity: 0.35;
          pointer-events: none;
        }
        .lv2-blob-a { width: 340px; height: 340px; background: #FFD9A8; top: -90px; inset-inline-start: -70px; }
        .lv2-blob-b { width: 300px; height: 300px; background: #C9E4FF; bottom: -80px; inset-inline-end: -60px; }
        .lv2-card {
          position: relative;
          width: 100%;
          max-width: 480px;
          text-align: center;
          display: grid;
          gap: 1.1rem;
        }
        .lv2-title {
          font-family: ${tokens.rubik};
          font-weight: 800;
          font-size: clamp(2.5rem, 8vw, 4.5rem);
          line-height: 1.1;
          color: #F25C05; /* fallback for browsers without background-clip:text */
          background: linear-gradient(105deg, #F25C05, #E8336D, #8A3FFC);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          margin: 0;
        }
        .lv2-tagline {
          font-family: ${tokens.assistant};
          font-size: 1.1rem;
          color: #6B6357;
          margin: 0;
        }
        .lv2-actions {
          display: grid;
          gap: 0.8rem;
          margin-top: 0.6rem;
        }
        @media (min-width: 560px) {
          .lv2-actions { grid-template-columns: 1fr 1fr; }
        }
        .lv2-btn {
          min-height: 56px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 16px;
          font-family: ${tokens.rubik};
          font-size: 18px;
          font-weight: 600;
          text-decoration: none;
          padding: 0.8rem 1.4rem;
        }
        .lv2-btn-primary {
          color: #fff;
          /* darkened from #F25C05/#E8336D so white 18px text passes 4.5:1 */
          background: linear-gradient(105deg, #CC4A00, #C81E56);
          box-shadow: 0 10px 24px rgba(200, 30, 86, 0.28);
        }
        .lv2-btn-secondary {
          color: #B22355;
          background: rgba(255, 255, 255, 0.85);
          border: 2px solid #E8336D;
        }
        .lv2-btn:focus-visible, .lv2-phone:focus-visible {
          outline: 3px solid #1A1730;
          outline-offset: 3px;
        }
        .lv2-facts {
          background: rgba(242, 92, 5, 0.07);
          border: 1px solid rgba(242, 92, 5, 0.18);
          border-radius: 16px;
          padding: 0.9rem 1.1rem;
          display: grid;
          gap: 0.55rem;
          margin-top: 0.4rem;
        }
        .lv2-fact {
          font-family: ${tokens.assistant};
          font-size: 16px;
          font-weight: 600;
          color: #4A3728;
          margin: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
        }
        .lv2-fact-divider {
          border: none;
          border-top: 1px solid rgba(242, 92, 5, 0.18);
          margin: 0;
        }
        .lv2-footer {
          position: relative;
          text-align: center;
          display: grid;
          gap: 0.4rem;
        }
        .lv2-phone {
          font-family: ${tokens.rubik};
          font-size: 18px;
          font-weight: 700;
          color: #1A1730;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          padding: 0.4rem 0.8rem;
          border-radius: 10px;
        }
        .lv2-a11y {
          color: #6B6357;
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .lv2-a11y:focus-visible {
          outline: 3px solid #1A1730;
          outline-offset: 2px;
        }
        .lv2-copy {
          font-family: ${tokens.assistant};
          font-size: 0.85rem;
          color: #6B6357;
          margin: 0;
        }
        .lv2-browse {
          font-family: ${tokens.assistant};
          font-size: 16px;
          font-weight: 600;
          color: #B22355;
          text-decoration: underline;
          text-underline-offset: 3px;
          justify-self: center;
          padding: 0.3rem 0.5rem;
          border-radius: 8px;
        }
        .lv2-browse:focus-visible {
          outline: 3px solid #1A1730;
          outline-offset: 3px;
        }
      `}</style>
    </main>
  );
}
