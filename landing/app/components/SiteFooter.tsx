"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { tokens } from "../../lib/ui";
import { getMinOrderTotal } from "../../lib/siteSettings";
import { MIN_ORDER_FALLBACK } from "../../lib/config";
import { CONTACT } from "./SiteHeader";

// פוטר מקצועי משותף לעמודי החנות — מותג, קישורים מהירים ופרטי קשר.
export default function SiteFooter() {
  // Same rule as the header strip: never hardcode the minimum — read the one
  // value the cart actually enforces.
  const [minOrder, setMinOrder] = useState(MIN_ORDER_FALLBACK);

  useEffect(() => {
    getMinOrderTotal().then(setMinOrder);
  }, []);

  const col: React.CSSProperties = { display: "flex", flexDirection: "column", gap: "0.55rem" };
  // Same reason as the header nav: measured 91x17, under the WCAG 2.2 AA 24x24
  // minimum. The footer phone number is how a wholesale buyer actually calls.
  const link: React.CSSProperties = {
    fontFamily: tokens.assistant,
    fontSize: "0.9rem",
    color: tokens.body,
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
    minHeight: 24,
    padding: "0.2rem 0",
  };
  const head: React.CSSProperties = {
    fontFamily: tokens.rubik,
    fontWeight: 800,
    fontSize: "0.95rem",
    color: tokens.text,
    marginBottom: "0.2rem",
  };

  return (
    <footer style={{ background: tokens.surface, borderTop: `1px solid ${tokens.border}`, marginTop: "4rem" }}>
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "3rem clamp(1rem, 4vw, 2.5rem) 2rem",
          display: "grid",
          gap: "2rem",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
        }}
      >
        <div style={col}>
          <span
            style={{
              fontFamily: tokens.rubik,
              fontWeight: 900,
              fontSize: "1.3rem",
              backgroundImage: tokens.rainbow,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            כרם טויס
          </span>
          <p style={{ fontFamily: tokens.assistant, fontSize: "0.88rem", color: tokens.body, lineHeight: 1.6, maxWidth: 280 }}>
            סיטונאות צעצועים — קטלוג מלא מעודכן ישירות מהמלאי, הזמנה אונליין ומחירים אישיים ללקוחות קבועים.
          </p>
        </div>

        <div style={col}>
          <span style={head}>ניווט מהיר</span>
          <Link href="/catalog" style={link}>הקטלוג</Link>
          <Link href="/account" style={link}>ההזמנות שלי</Link>
          <Link href="/register" style={link}>פתיחת חשבון סיטונאי</Link>
          <Link href="/login" style={link}>התחברות</Link>
        </div>

        <div style={col}>
          <span style={head}>מידע</span>
          <span style={{ ...link, color: tokens.dim }}>🚚 משלוח לכל הארץ</span>
          <span style={{ ...link, color: tokens.dim }}>
            🧾 מינימום הזמנה ₪{minOrder.toLocaleString("he-IL")}
          </span>
          <span style={{ ...link, color: tokens.dim }}>💯 המחירים כוללים מע״מ</span>
          <Link href="/accessibility" style={link}>הצהרת נגישות</Link>
        </div>

        <div style={col}>
          <span style={head}>יצירת קשר</span>
          {CONTACT.whatsapp ? (
            <a href={`https://wa.me/${CONTACT.whatsapp}`} target="_blank" rel="noreferrer" style={link}>💬 וואטסאפ</a>
          ) : null}
          {CONTACT.phone ? (
            <a href={`tel:${CONTACT.phone}`} dir="ltr" style={{ ...link, textAlign: "right" }}>📞 {CONTACT.phone}</a>
          ) : null}
          {CONTACT.email ? (
            <a href={`mailto:${CONTACT.email}`} dir="ltr" style={{ ...link, textAlign: "right" }}>✉️ {CONTACT.email}</a>
          ) : null}
        </div>
      </div>

      <div style={{ borderTop: `1px solid ${tokens.border}` }}>
        <div
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            padding: "1.1rem clamp(1rem, 4vw, 2.5rem)",
            fontFamily: tokens.assistant,
            fontSize: "0.8rem",
            color: tokens.dim,
            textAlign: "center",
          }}
        >
          © {new Date().getFullYear()} כרם טויס · כל הזכויות שמורות
        </div>
      </div>
    </footer>
  );
}
