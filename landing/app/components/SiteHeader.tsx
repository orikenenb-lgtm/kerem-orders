"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth";
import { featureFlags } from "../../lib/featureFlags";
import { tokens } from "../../lib/ui";
import { getMinOrderTotal } from "../../lib/siteSettings";
import { BUSINESS_TAGLINE, MIN_ORDER_FALLBACK, PHONE_DISPLAY } from "../../lib/config";
import styles from "./SiteHeader.module.css";

// פרטי קשר של כרם טויס. הטלפון מגיע מ-lib/config (מקור אמת אחד).
// וואטסאפ/אימייל — מלאו כאן וברגע שמזינים הכפתורים מופיעים לבד.
export const CONTACT = {
  phone: PHONE_DISPLAY, // 050-852-4448 (מתוך lib/config)
  whatsapp: "",         // מספר בינ״ל ללא +/רווחים, לדוגמה: "972508524448"
  email: "",            // לדוגמה: "info@keremtoys.co.il"
};

const base = process.env.NEXT_PUBLIC_BASE_PATH || "";

// לוגו. אין כרגע קובץ לוגו בפרויקט (landing/public/logo.png לא קיים), ולכן
// לא מנסים לטעון אותו בכלל — כל בקשה כזו היא 404 מיותר בכל טעינת עמוד.
// כשיהיה קובץ אמיתי: מעלים אותו ל-landing/public/logo.png והופכים את
// HAS_LOGO_FILE ל-true — ורק אז ה-<img> חוזר. עד אז: לוגו-טקסט בלבד,
// באותו קונטיינר בגובה 40px (בלי שינוי פריסה בין המצבים).
const HAS_LOGO_FILE = false;

function Logo() {
  return (
    <span className={styles.logo}>
      {HAS_LOGO_FILE ? (
        <img
          src={`${base}/logo.png`}
          alt="כרם טויס"
          style={{ height: 40, width: "auto", objectFit: "contain", display: "block" }}
        />
      ) : (
        <span className={styles.wordmarkWrap}>
          <span
            className={styles.wordmark}
            style={{ fontFamily: tokens.rubik, backgroundImage: tokens.rainbow }}
          >
            כרם טויס
          </span>
          {/* Decorative sub-line on wide screens only: the business tagline
              from lib/config — it never changes the bar's height. */}
          <span className={styles.tagline} aria-hidden="true">{BUSINESS_TAGLINE}</span>
        </span>
      )}
    </span>
  );
}

// Small line icons (decorative — the text next to each one carries the meaning).
function TruckIcon() {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3 6.5h11v9H3zM14 9.5h3.6l3.4 3.4v2.6h-7z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <circle cx="7" cy="17" r="1.9" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="17" cy="17" r="1.9" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}
function PhoneIcon() {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6.6 3.5h3l1.5 4-2 1.3a11 11 0 0 0 6.1 6.1l1.3-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}
function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg className={styles.menuIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {open ? (
        <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      ) : (
        <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      )}
    </svg>
  );
}

// trailingSlash: true → usePathname() may return "/catalog/"; compare without it.
const norm = (p: string | null) => (p && p.length > 1 ? p.replace(/\/+$/, "") : p || "/");

export default function SiteHeader() {
  const { session, isManager, signOut, loading, isAgent } = useAuth();
  const router = useRouter();
  const pathname = norm(usePathname());

  // The minimum shown in the top strip must be the SAME number the cart
  // enforces. It lived here as a hardcoded ₪500 and went stale the moment the
  // owner raised it to ₪3,500 — read it from the DB instead, exactly like the
  // landing screen does, so the two can never disagree again. Anon RLS exposes
  // this one key; on any failure fall back to the config constant.
  const [minOrder, setMinOrder] = useState(MIN_ORDER_FALLBACK);

  // The header is sticky, and so are the catalogue filter bars underneath it.
  // Those bars used to hard-code `top: 64`, but this header is never 64px tall:
  // it measures 93px on a desktop and 123-167px on a phone (the trust strip and
  // the nav both wrap), and it wins on z-index — so on a phone the search field
  // was painted over completely and the catalogue could not be searched once
  // you had scrolled into the grid. Publish the real height instead and let
  // every sticky bar sit on top of it.
  const headerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const publish = () => {
      const h = Math.round(el.getBoundingClientRect().height);
      if (h > 0) document.documentElement.style.setProperty("--kt-header-h", `${h}px`);
    };
    publish();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", publish);
      return () => window.removeEventListener("resize", publish);
    }
    const obs = new ResizeObserver(publish);
    obs.observe(el);
    return () => obs.disconnect();
  });

  useEffect(() => {
    getMinOrderTotal().then(setMinOrder);
  }, []);

  // Phone-width menu (a disclosure, not a modal). Below 760px the nav links
  // live in a panel that drops down OVER the page (position: absolute), so
  // opening it never changes the header's own height — --kt-header-h stays put.
  // On wider screens the same list is shown inline and the toggle is hidden.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const navRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        toggleRef.current?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    // Growing past the breakpoint shows the list inline — drop the open state
    // so it does not reappear as a dropdown on the way back down.
    const mq = window.matchMedia("(min-width: 760px)");
    const onMq = () => { if (mq.matches) setMenuOpen(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    mq.addEventListener?.("change", onMq);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      mq.removeEventListener?.("change", onMq);
    };
  }, [menuOpen]);

  // Following a link inside the panel closes it (the route changes underneath).
  const closeOnLink = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("a")) setMenuOpen(false);
  };

  // Active-page indication. Exact match → aria-current="page"; a page inside
  // the same section (a product under the catalogue, a screen under /admin)
  // only gets the visual state.
  const navItem = (href: string, label: string, opts: { accent?: boolean; also?: string[] } = {}) => {
    const roots = [href, ...(opts.also || [])];
    const exact = pathname === href;
    const inSection = exact || roots.some((r) => pathname === r || pathname.startsWith(r + "/"));
    const cls = [styles.navLink, opts.accent ? styles.navLinkAccent : "", inSection ? styles.navLinkActive : ""]
      .filter(Boolean)
      .join(" ");
    return (
      <li className={styles.navItem}>
        <Link href={href} className={cls} aria-current={exact ? "page" : undefined}>
          {label}
        </Link>
      </li>
    );
  };

  return (
    <header ref={headerRef} className={styles.header}>
      {/* רצועת אמון עליונה — מסר שירות + פרטי קשר (אם הוזנו) */}
      <div className={styles.strip}>
        <div className={styles.stripInner}>
          <p className={styles.stripMsg}>
            <span className={styles.stripPart}>
              <TruckIcon />
              משלוח לכל הארץ
            </span>
            <span className={styles.stripSep} aria-hidden="true">·</span>
            <span className={styles.stripPart}>
              מינימום הזמנה <bdi className={styles.num}>₪{minOrder.toLocaleString("he-IL")}</bdi>
            </span>
            <span className={styles.stripSep} aria-hidden="true">·</span>
            <span className={styles.stripPart}>המחירים כוללים מע״מ</span>
          </p>
          <span className={styles.stripContact}>
            {CONTACT.whatsapp && (
              <a href={`https://wa.me/${CONTACT.whatsapp}`} target="_blank" rel="noreferrer" className={styles.stripLink}>
                💬 וואטסאפ
              </a>
            )}
            {/* 91x17 measured — under the 24x24 minimum, on the one link in the
                trust strip that a buyer taps to place an order by phone. */}
            {CONTACT.phone && (
              <a href={`tel:${CONTACT.phone}`} dir="ltr" className={styles.stripLink}>
                <PhoneIcon />
                {CONTACT.phone}
              </a>
            )}
          </span>
        </div>
      </div>

      {/* כותרת ראשית */}
      <div className={styles.bar}>
        <div className={styles.barInner}>
          <Link href="/" className={styles.logoLink}>
            <Logo />
          </Link>

          <nav ref={navRef} className={styles.nav} aria-label="ניווט ראשי">
            <button
              ref={toggleRef}
              type="button"
              className={styles.menuToggle}
              aria-expanded={menuOpen}
              aria-controls={menuId}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <MenuIcon open={menuOpen} />
              <span>תפריט</span>
            </button>

            <ul id={menuId} className={styles.navList} data-open={menuOpen ? "true" : "false"} onClick={closeOnLink}>
              {/* Logged-in customers go to the orderable catalog; logged-out
                  visitors still get a link to the public (browse-only) catalog
                  so it isn't a dead end from every inner page. */}
              {session
                ? navItem("/catalog", "קטלוג", { also: ["/product", "/collection"] })
                : navItem("/view", "קטלוג", { also: ["/p", "/product", "/collection"] })}
              {session && navItem("/account", "ההזמנות שלי")}
              {session && isManager && navItem("/admin", "ניהול", { accent: true })}
              {/* An agent gets ONE link, straight to the only screen they may use.
                  They are not shown /admin at all — it is manager-only and would
                  just bounce them back to the catalogue. */}
              {session && !isManager && isAgent && featureFlags.ff_agent_discounts && (
                navItem("/admin/customers", "לקוחות", { accent: true })
              )}

              {loading ? null : session ? (
                <li className={`${styles.navItem} ${styles.navItemAction}`}>
                  <button
                    type="button"
                    className={styles.signOut}
                    onClick={async () => {
                      await signOut();
                      router.push("/");
                    }}
                  >
                    התנתקות
                  </button>
                </li>
              ) : (
                navItem("/login", "התחברות")
              )}
            </ul>
          </nav>

          {/* The guest's primary action stays in the bar at every width. */}
          {!loading && !session && (
            <Link href="/register" className={styles.cta}>
              פתיחת חשבון
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
