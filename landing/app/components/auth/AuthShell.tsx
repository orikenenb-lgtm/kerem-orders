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
import { tokens } from "../../../lib/ui";

export type AuthTab = "login" | "register" | "forgot";

// Each form owns its own intro text, because that text changes with the
// form's state (e.g. after a registration is submitted) — only the heading
// belongs to the shell.
const TABS: { id: AuthTab; label: string; title: string }[] = [
  { id: "login", label: "התחברות", title: "התחברות" },
  { id: "register", label: "הרשמה", title: "פתיחת חשבון לקוח" },
  { id: "forgot", label: "שכחתי סיסמה", title: "איפוס סיסמה" },
];

export default function AuthShell({ initial = "login" }: { initial?: AuthTab }) {
  const [tab, setTab] = useState<AuthTab>(initial);

  // ?tab=register on the single link, so one URL can still open on any tab.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t === "login" || t === "register" || t === "forgot") setTab(t);
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
      <main
        id="main-content" tabIndex={-1}
        style={{
          minHeight: "calc(100vh - 64px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2.5rem 1.25rem",
          background: tokens.surface,
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 460,
            background: "#fff",
            borderRadius: 24,
            border: `1px solid ${tokens.border}`,
            boxShadow: "0 20px 60px rgba(26,23,48,0.08)",
            padding: "clamp(1.5rem, 5vw, 2.5rem)",
          }}
        >
          <div
            role="tablist"
            aria-label="כניסה לחשבון"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: "0.3rem",
              background: tokens.surface,
              border: `1px solid ${tokens.border}`,
              borderRadius: 999,
              padding: "0.3rem",
              marginBottom: "1.5rem",
            }}
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
                  style={{
                    fontFamily: tokens.rubik,
                    fontWeight: 700,
                    fontSize: "0.85rem",
                    padding: "0.6rem 0.4rem",
                    borderRadius: 999,
                    border: "none",
                    cursor: "pointer",
                    background: on ? tokens.rainbow : "transparent",
                    color: on ? "#fff" : tokens.body,
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          <div id="auth-panel" role="tabpanel" aria-labelledby={`auth-tab-${tab}`}>
            <h1
              style={{
                fontFamily: tokens.rubik,
                fontWeight: 800,
                fontSize: "1.75rem",
                color: tokens.text,
                marginBottom: "0.5rem",
              }}
            >
              {active.title}
            </h1>

            {tab === "login" && <LoginForm onSwitch={onSwitch} />}
            {tab === "register" && <RegisterForm onSwitch={onSwitch} />}
            {tab === "forgot" && <ForgotForm onSwitch={onSwitch} />}
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
