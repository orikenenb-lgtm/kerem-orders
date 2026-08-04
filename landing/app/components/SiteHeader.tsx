"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth";
import { tokens } from "../../lib/ui";
import { supabase } from "../../lib/supabaseClient";
import { MIN_ORDER_FALLBACK, PHONE_DISPLAY } from "../../lib/config";

// פרטי קשר של כרם טויס. הטלפון מגיע מ-lib/config (מקור אמת אחד).
// וואטסאפ/אימייל — מלאו כאן וברגע שמזינים הכפתורים מופיעים לבד.
export const CONTACT = {
  phone: PHONE_DISPLAY, // 050-852-4448 (מתוך lib/config)
  whatsapp: "",         // מספר בינ״ל ללא +/רווחים, לדוגמה: "972508524448"
  email: "",            // לדוגמה: "info@keremtoys.co.il"
};

const base = process.env.NEXT_PUBLIC_BASE_PATH || "";

// לוגו: הטקסט הצבעוני מוצג מיד; אם קיים /public/logo.png הוא מחליף אותו רק
// אחרי שנטען בהצלחה. הסדר הזה (טקסט קודם, תמונה אחר-כך) הוא מה שמונע את
// אייקון "תמונה שבורה" שהבהב כשה-<img> רונדר ראשון וה-onError הגיע באיחור.
// אין קפיצת פריסה: שני המצבים חיים באותו קונטיינר בגובה 40px.
function Logo() {
  const [imgReady, setImgReady] = useState(false);
  return (
    <span style={{ display: "flex", alignItems: "center", height: 40 }}>
      {!imgReady && (
        <span
          style={{
            fontFamily: tokens.rubik,
            fontWeight: 900,
            fontSize: "1.35rem",
            backgroundImage: tokens.rainbow,
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            WebkitTextFillColor: "transparent",
            whiteSpace: "nowrap",
          }}
        >
          כרם טויס
        </span>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`${base}/logo.png`}
        alt={imgReady ? "כרם טויס" : ""}
        aria-hidden={!imgReady}
        onLoad={() => setImgReady(true)}
        style={{
          height: 40,
          width: "auto",
          objectFit: "contain",
          // Hidden (not unmounted) until it loads, so a missing file shows
          // nothing at all and a real file appears without re-requesting.
          display: imgReady ? "block" : "none",
        }}
      />
    </span>
  );
}

export default function SiteHeader() {
  const { session, isManager, signOut, loading } = useAuth();
  const router = useRouter();

  // The minimum shown in the top strip must be the SAME number the cart
  // enforces. It lived here as a hardcoded ₪500 and went stale the moment the
  // owner raised it to ₪3,500 — read it from the DB instead, exactly like the
  // landing screen does, so the two can never disagree again. Anon RLS exposes
  // this one key; on any failure fall back to the config constant.
  const [minOrder, setMinOrder] = useState(MIN_ORDER_FALLBACK);

  useEffect(() => {
    supabase
      .from("site_settings")
      .select("value")
      .eq("key", "min_order_total")
      .maybeSingle()
      .then(({ data }) => {
        const n = Number((data as { value: string } | null)?.value);
        if (Number.isFinite(n) && n > 0) setMinOrder(n);
      });
  }, []);

  const navLink = {
    fontFamily: tokens.assistant,
    fontWeight: 600,
    fontSize: "0.95rem",
    color: tokens.text,
    textDecoration: "none",
  } as const;

  return (
    <header style={{ position: "sticky", top: 0, zIndex: 50 }}>
      {/* רצועת אמון עליונה — מסר שירות + פרטי קשר (אם הוזנו) */}
      <div
        style={{
          background: tokens.text,
          color: "#fff",
          fontFamily: tokens.assistant,
          fontSize: "0.8rem",
        }}
      >
        <div
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            padding: "0.4rem clamp(1rem, 4vw, 2.5rem)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.8rem",
            flexWrap: "wrap",
          }}
        >
          <span style={{ opacity: 0.92 }}>
            🚚 משלוח לכל הארץ · מינימום הזמנה ₪{minOrder.toLocaleString("he-IL")} · המחירים כוללים מע״מ
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            {CONTACT.whatsapp && (
              <a href={`https://wa.me/${CONTACT.whatsapp}`} target="_blank" rel="noreferrer"
                style={{ color: "#fff", textDecoration: "none", fontWeight: 700 }}>
                💬 וואטסאפ
              </a>
            )}
            {CONTACT.phone && (
              <a href={`tel:${CONTACT.phone}`} dir="ltr" style={{ color: "#fff", textDecoration: "none", fontWeight: 700 }}>
                📞 {CONTACT.phone}
              </a>
            )}
          </span>
        </div>
      </div>

      {/* כותרת ראשית */}
      <div
        style={{
          background: "rgba(255,255,255,0.92)",
          backdropFilter: "blur(10px)",
          borderBottom: `1px solid ${tokens.border}`,
        }}
      >
        <div
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            padding: "0.7rem clamp(1rem, 4vw, 2.5rem)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "1rem",
          }}
        >
          <Link href="/" style={{ display: "flex", alignItems: "center", textDecoration: "none" }}>
            <Logo />
          </Link>

          <nav style={{ display: "flex", alignItems: "center", gap: "clamp(0.8rem, 2.5vw, 1.6rem)", flexWrap: "wrap" }}>
            {session && <Link href="/catalog" style={navLink}>קטלוג</Link>}
            {session && <Link href="/account" style={navLink}>ההזמנות שלי</Link>}
            {session && isManager && <Link href="/admin" style={{ ...navLink, color: tokens.accent }}>ניהול</Link>}

            {loading ? null : session ? (
              <button
                onClick={async () => {
                  await signOut();
                  router.push("/");
                }}
                style={{
                  fontFamily: tokens.rubik,
                  fontWeight: 600,
                  fontSize: "0.85rem",
                  color: tokens.body,
                  background: "none",
                  border: `1px solid ${tokens.border}`,
                  padding: "0.5rem 1.1rem",
                  borderRadius: 999,
                  cursor: "pointer",
                }}
              >
                התנתקות
              </button>
            ) : (
              <>
                <Link href="/login" style={navLink}>התחברות</Link>
                <Link
                  href="/register"
                  style={{
                    fontFamily: tokens.rubik,
                    fontWeight: 600,
                    fontSize: "0.85rem",
                    color: "#fff",
                    background: tokens.rainbow,
                    padding: "0.55rem 1.4rem",
                    borderRadius: 999,
                    textDecoration: "none",
                  }}
                >
                  פתיחת חשבון
                </Link>
              </>
            )}
          </nav>
        </div>
      </div>
    </header>
  );
}
