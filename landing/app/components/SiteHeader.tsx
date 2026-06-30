"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth";
import { tokens } from "../../lib/ui";

export default function SiteHeader() {
  const { session, profile, isManager, signOut, loading } = useAuth();
  const router = useRouter();

  const navLink = {
    fontFamily: tokens.assistant,
    fontWeight: 600,
    fontSize: "0.95rem",
    color: tokens.text,
    textDecoration: "none",
  } as const;

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: "rgba(255,255,255,0.9)",
        backdropFilter: "blur(10px)",
        borderBottom: `1px solid ${tokens.border}`,
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "0.9rem clamp(1rem, 4vw, 2.5rem)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
        }}
      >
        <Link
          href="/"
          style={{
            fontFamily: tokens.rubik,
            fontWeight: 900,
            fontSize: "1.3rem",
            textDecoration: "none",
            backgroundImage: tokens.rainbow,
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          כרם טויס
        </Link>

        <nav style={{ display: "flex", alignItems: "center", gap: "clamp(0.8rem, 2.5vw, 1.6rem)", flexWrap: "wrap" }}>
          {session && (
            <Link href="/catalog" style={navLink}>
              קטלוג
            </Link>
          )}
          {session && (
            <Link href="/account" style={navLink}>
              ההזמנות שלי
            </Link>
          )}
          {session && isManager && (
            <Link href="/admin" style={{ ...navLink, color: tokens.accent }}>
              ניהול
            </Link>
          )}

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
              <Link href="/login" style={navLink}>
                התחברות
              </Link>
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
    </header>
  );
}
