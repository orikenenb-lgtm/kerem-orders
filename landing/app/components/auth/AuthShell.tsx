"use client";

// One screen for everything a customer needs before they are logged in.
//
// Until now התחברות / הרשמה / שכחתי-סיסמה were three separate URLs, which
// meant handing a customer three links. They are now three tabs of a single
// screen, so there is exactly ONE link to give out: /login/.
//
// The old URLs still work — /register/ and /forgot/ render this same shell
// with their tab preselected — so bookmarks and anything already sent out
// keeps working. /reset/ stays a page of its own on purpose: it is opened
// from the link inside the password-reset email, never handed out by hand.

import { useCallback, useEffect, useState } from "react";
import SiteHeader from "../SiteHeader";
import SiteFooter from "../SiteFooter";
import LoginForm from "./LoginForm";
import RegisterForm from "./RegisterForm";
import ForgotForm from "./ForgotForm";
import ExpressForm from "./ExpressForm";
import { featureFlags } from "../../../lib/featureFlags";
import { getMinOrderTotal } from "../../../lib/siteSettings";
import { BUSINESS_NAME, BUSINESS_TAGLINE, MIN_ORDER_FALLBACK, PHONE_DISPLAY, PHONE_TEL } from "../../../lib/config";
import s from "./auth.module.css";

export type AuthTab = "login" | "express" | "register" | "forgot";

// Each form owns its own intro text, because that text changes with the
// form's state (e.g. after a registration is submitted) — only the heading
// belongs to the shell.
// "לקוח קיים" (ff_rivhit_express) sits right after התחברות: it is the door
// for the owner's existing customers, who are most of the people arriving.
const TABS: { id: AuthTab; label: string; title: string }[] = [
  { id: "login", label: "התחברות", title: "התחברות" },
  ...(featureFlags.ff_rivhit_express ? [{ id: "express" as const, label: "לקוח קיים", title: "כניסה ללקוחות קיימים" }] : []),
  { id: "register", label: "הרשמה", title: "פתיחת חשבון לקוח" },
  { id: "forgot", label: "שכחתי סיסמה", title: "איפוס סיסמה" },
];

export default function AuthShell({ initial = "login" }: { initial?: AuthTab }) {
  const [tab, setTab] = useState<AuthTab>(initial);
  // Brand panel fact: the real minimum from site_settings (shared, memoized
  // read — the header already asks for it), never a hard-coded number.
  const [minOrder, setMinOrder] = useState(MIN_ORDER_FALLBACK);
  useEffect(() => {
    getMinOrderTotal().then(setMinOrder);
  }, []);

  // ?tab=register on the single link, so one URL can still open on any tab.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && TABS.some((x) => x.id === t)) setTab(t as AuthTab);
  }, []);

  // Switching tabs is not navigation — but the address bar should still show
  // where you are, so a refresh or a shared URL lands on the same tab.
  const onSwitch = useCallback((next: AuthTab) => {
    setTab(next);
    try {
      const url = new URL(window.location.href);
      // Always write the tab explicitly. Deleting the param is only correct when
      // the path is /login/ — on /register/ or /forgot/ it left the URL pointing
      // at the old tab, so a refresh threw the customer back and discarded what
      // they had typed.
      url.searchParams.set("tab", next);
      window.history.replaceState(null, "", url.toString());
    } catch {
      /* ignore — the tab still switched */
    }
  }, []);

  const active = TABS.find((t) => t.id === tab) ?? TABS[0];

  return (
    <>
      <SiteHeader />
      <main id="main-content" tabIndex={-1} className={s.main}>
        <div className={s.layout}>
          {/* Brand panel: the wordmark and three verified facts only. A compact
              strip on phones, a full side panel from 900px. */}
          <aside className={s.panel} aria-label={BUSINESS_NAME}>
            <div className={s.panelInner}>
              <p className={s.wordmark}>{BUSINESS_NAME}</p>
              <p className={s.tagline}>{BUSINESS_TAGLINE}</p>
              <ul className={s.facts}>
                <li className={s.fact}>
                  <span className={s.factDot} aria-hidden="true" />
                  <span>
                    מינימום הזמנה <span className={s.num}>₪{minOrder.toLocaleString("he-IL")}</span>
                  </span>
                </li>
                <li className={s.fact}>
                  <span className={s.factDot} aria-hidden="true" />
                  <span>המחירים כוללים מע״מ</span>
                </li>
                <li className={s.fact}>
                  <span className={s.factDot} aria-hidden="true" />
                  <span>
                    טלפון{" "}
                    <a href={`tel:${PHONE_TEL}`} dir="ltr" className={s.panelLink}>
                      {PHONE_DISPLAY}
                    </a>
                  </span>
                </li>
              </ul>
            </div>
          </aside>

          <div className={s.card}>
            <div
              role="tablist"
              aria-label="כניסה לחשבון"
              className={`${s.tabs}${TABS.length > 3 ? ` ${s.tabsDense}` : ""}`}
              style={{ gridTemplateColumns: `repeat(${TABS.length}, 1fr)` }}
            >
              {TABS.map((t) => {
                const on = t.id === tab;
                return (
                  <button
                    key={t.id}
                    role="tab"
                    id={`auth-tab-${t.id}`}
                    aria-selected={on}
                    aria-controls="auth-panel"
                    tabIndex={on ? 0 : -1}
                    onClick={() => onSwitch(t.id)}
                    onKeyDown={(e) => {
                      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                      e.preventDefault();
                      // RTL: ArrowLeft moves forward through the tabs.
                      const step = e.key === "ArrowLeft" ? 1 : -1;
                      const i = TABS.findIndex((x) => x.id === tab);
                      const next = TABS[(i + step + TABS.length) % TABS.length];
                      onSwitch(next.id);
                      document.getElementById(`auth-tab-${next.id}`)?.focus();
                    }}
                    className={s.tab}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>

            <div id="auth-panel" role="tabpanel" aria-labelledby={`auth-tab-${tab}`}>
              <h1 className={s.title}>{active.title}</h1>

              {tab === "login" && <LoginForm onSwitch={onSwitch} />}
              {tab === "express" && <ExpressForm onSwitch={onSwitch} />}
              {tab === "register" && <RegisterForm onSwitch={onSwitch} />}
              {tab === "forgot" && <ForgotForm onSwitch={onSwitch} />}
            </div>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
