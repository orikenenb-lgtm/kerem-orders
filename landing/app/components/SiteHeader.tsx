"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth";
import { tokens } from "../../lib/ui";

// ── מלאו כאן את פרטי הקשר של כרם טויס — ברגע שמזינים, הכפתורים מופיעים לבד ──
export const CONTACT = {
  phone: "",     // לדוגמה: "03-1234567"
  whatsapp: "",  // מספר בינ״ל ללא +/רווחים, לדוגמה: "972501234567"
  email: "",     // לדוגמה: "info@keremtoys.co.il"
};

const base = process.env.NEXT_PUBLIC_BASE_PATH || "";

// לוגו: מציג את הקובץ /public/logo.png ; עד שמעלים אותו — נופל חזרה
// אוטומטית ללוגו-טקסט הצבעוני, בלי תמונה שבורה.
function Logo() {
  const [err, setErr] = useState(false);
  if (!err) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`${base}/logo.png`}
        alt="כרם טויס"
        onError={() => setErr(true)}
        style={{ height: 40, width: "auto", display: "block", objectFit: "contain" }}
      />
    );
  }
  return (
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
  );
}

export default function SiteHeader() {
  const { session, isManager, signOut, loading } = useAuth();
  const router = useRouter();

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
          <span style={{ opacity: 0.92 }}>🚚 משלוח לכל הארץ · מינימום הזמנה ₪500 · המחירים כוללים מע״מ</span>
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
