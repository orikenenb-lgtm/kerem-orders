"use client";

// Self-made accessibility widget (in the spirit of Israeli Standard 5568 /
// WCAG 2.1 AA) — no external libraries. A floating button opens a small
// dialog with display adjustments; the choices persist in localStorage and
// are re-applied on every page load.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { tokens } from "../../lib/ui";

const STORAGE_KEY = "kt_a11y";
// High-contrast blue: #005A9C on white is ~7.6:1 (passes WCAG AA/AAA).
const BLUE = "#005A9C";

type A11yState = {
  fontStep: 0 | 1 | 2; // 0 = רגיל, 1 = 110%, 2 = 125%
  contrast: boolean;
  links: boolean;
  noMotion: boolean;
};

const DEFAULT_STATE: A11yState = {
  fontStep: 0,
  contrast: false,
  links: false,
  noMotion: false,
};

const FONT_STEPS = ["", "110%", "125%"] as const;
const FONT_LABELS = ["רגיל", "110%", "125%"] as const;

// CSS for the toggle classes + focus-visible outlines. Injected once from the
// component (no globals.css edit needed). The contrast filter sits on <html>
// deliberately: a filter on the ROOT element does not create a containing
// block for position:fixed descendants, so the cart button and this widget
// stay pinned to the viewport.
const WIDGET_CSS = `
html.kt-a11y-contrast { filter: contrast(1.2); }
html.kt-a11y-contrast body { color: #000; }
html.kt-a11y-contrast a { text-decoration: underline !important; text-decoration-thickness: 2px !important; }
html.kt-a11y-links a { text-decoration: underline !important; font-weight: 700 !important; }
html.kt-a11y-nomotion *,
html.kt-a11y-nomotion *::before,
html.kt-a11y-nomotion *::after {
  animation: none !important;
  transition: none !important;
  scroll-behavior: auto !important;
}
.kt-a11y-btn:focus-visible,
.kt-a11y-panel button:focus-visible,
.kt-a11y-panel a:focus-visible {
  outline: 3px solid ${BLUE};
  outline-offset: 2px;
}
`;

// Apply the saved preferences to the live document. Called only from effects
// and event handlers — never during render — so SSR/prerender never touches
// `document`.
function applyToDocument(s: A11yState) {
  const root = document.documentElement;
  if (s.fontStep > 0) root.style.fontSize = FONT_STEPS[s.fontStep];
  else root.style.removeProperty("font-size");
  root.classList.toggle("kt-a11y-contrast", s.contrast);
  root.classList.toggle("kt-a11y-links", s.links);
  root.classList.toggle("kt-a11y-nomotion", s.noMotion);
}

function sanitize(raw: unknown): A11yState {
  if (!raw || typeof raw !== "object") return DEFAULT_STATE;
  const p = raw as Record<string, unknown>;
  return {
    fontStep: p.fontStep === 1 || p.fontStep === 2 ? p.fontStep : 0,
    contrast: p.contrast === true,
    links: p.links === true,
    noMotion: p.noMotion === true,
  };
}

export default function A11yWidget() {
  const [state, setState] = useState<A11yState>(DEFAULT_STATE);
  const [open, setOpen] = useState(false);

  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const firstControlRef = useRef<HTMLButtonElement>(null);

  // Restore persisted preferences on mount (client only).
  useEffect(() => {
    let saved = DEFAULT_STATE;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) saved = sanitize(JSON.parse(raw));
    } catch {
      // Corrupt JSON / storage blocked — fall back to defaults.
    }
    setState(saved);
    applyToDocument(saved);
  }, []);

  // While open: focus moves into the panel, Esc closes and returns focus to
  // the launcher button, clicking outside closes, and Tab cycles WITHIN the
  // panel (a dialog that lets Tab wander into the page behind it strands
  // keyboard users — WCAG 2.1 §2.4.3).
  useEffect(() => {
    if (!open) return;
    firstControlRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
        return;
      }
      if (e.key === "Tab" && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href]'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        } else if (!panelRef.current.contains(active)) {
          // Focus somehow left the dialog (e.g. it was on the launcher) —
          // pull it back to the first control instead of the page behind.
          e.preventDefault();
          first.focus();
        }
      }
    };
    const onPointerDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  const update = (next: A11yState) => {
    setState(next);
    applyToDocument(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable — the setting still applies for this page view.
    }
  };

  const reset = () => {
    setState(DEFAULT_STATE);
    applyToDocument(DEFAULT_STATE);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  };

  const closePanel = () => {
    setOpen(false);
    btnRef.current?.focus();
  };

  const anyActive =
    state.fontStep > 0 || state.contrast || state.links || state.noMotion;

  const toggleStyle = (pressed: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.6rem",
    width: "100%",
    padding: "0.6rem 0.8rem",
    borderRadius: 10,
    border: `2px solid ${pressed ? BLUE : tokens.border}`,
    background: pressed ? BLUE : "#fff",
    color: pressed ? "#fff" : tokens.text,
    fontFamily: tokens.assistant,
    fontWeight: 600,
    fontSize: "0.95rem",
    textAlign: "start",
    cursor: "pointer",
  });

  const stateTagStyle = (pressed: boolean): React.CSSProperties => ({
    fontSize: "0.8rem",
    fontWeight: 700,
    color: pressed ? "#fff" : tokens.dim,
    whiteSpace: "nowrap",
  });

  return (
    <>
      <style>{WIDGET_CSS}</style>

      {/* Floating launcher — bottom ~90px so it never collides with the cart
          button pinned at insetInlineStart 20 / bottom 20 on the catalog. */}
      <button
        ref={btnRef}
        type="button"
        className="kt-a11y-btn"
        aria-label="תפריט נגישות"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          position: "fixed",
          insetInlineStart: 20,
          bottom: 90,
          zIndex: 80,
          width: 52,
          height: 52,
          borderRadius: "50%",
          background: BLUE,
          border: "2px solid #fff",
          boxShadow: "0 10px 26px rgba(0,90,156,0.4)",
          display: "grid",
          placeItems: "center",
          cursor: "pointer",
          padding: 0,
        }}
      >
        {/* Standard accessibility person icon */}
        <svg viewBox="0 0 24 24" width="30" height="30" fill="#fff" aria-hidden="true" focusable="false">
          <circle cx="12" cy="4.5" r="2.4" />
          <path d="M20.6 7.1c.53-.13 1.07.2 1.2.73.13.53-.2 1.07-.73 1.2 0 0-3.2.84-6.17 1.03v2.3l2.35 7.06c.17.52-.11 1.09-.63 1.26-.52.17-1.09-.1-1.26-.63L12.9 14h-1.8l-2.46 6.05c-.17.53-.74.8-1.26.63-.52-.17-.8-.74-.63-1.26l2.35-7.06v-2.3C6.13 9.87 2.93 9.03 2.93 9.03c-.53-.13-.86-.67-.73-1.2.13-.53.67-.86 1.2-.73 0 0 4.05 1 8.6 1s8.6-1 8.6-1z" />
        </svg>
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="תפריט נגישות"
          className="kt-a11y-panel"
          dir="rtl"
          style={{
            position: "fixed",
            insetInlineStart: 20,
            bottom: 150,
            zIndex: 80,
            width: "min(300px, calc(100vw - 40px))",
            background: "#fff",
            border: `1px solid ${tokens.border}`,
            borderRadius: 16,
            boxShadow: "0 18px 50px rgba(26,23,48,0.25)",
            padding: "1rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.55rem",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "0.2rem",
            }}
          >
            <h2
              style={{
                fontFamily: tokens.rubik,
                fontWeight: 800,
                fontSize: "1.05rem",
                color: tokens.text,
                margin: 0,
              }}
            >
              תפריט נגישות
            </h2>
            <button
              type="button"
              onClick={closePanel}
              aria-label="סגירת תפריט נגישות"
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                border: `1px solid ${tokens.border}`,
                background: "#fff",
                color: tokens.text,
                fontSize: "1rem",
                fontWeight: 700,
                cursor: "pointer",
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>

          <button
            ref={firstControlRef}
            type="button"
            aria-pressed={state.fontStep > 0}
            onClick={() =>
              update({
                ...state,
                fontStep: ((state.fontStep + 1) % 3) as A11yState["fontStep"],
              })
            }
            style={toggleStyle(state.fontStep > 0)}
          >
            <span>הגדלת טקסט</span>
            <span style={stateTagStyle(state.fontStep > 0)}>
              {FONT_LABELS[state.fontStep]}
            </span>
          </button>

          <button
            type="button"
            aria-pressed={state.contrast}
            onClick={() => update({ ...state, contrast: !state.contrast })}
            style={toggleStyle(state.contrast)}
          >
            <span>ניגודיות גבוהה</span>
            <span style={stateTagStyle(state.contrast)}>
              {state.contrast ? "פעיל" : "כבוי"}
            </span>
          </button>

          <button
            type="button"
            aria-pressed={state.links}
            onClick={() => update({ ...state, links: !state.links })}
            style={toggleStyle(state.links)}
          >
            <span>הדגשת קישורים</span>
            <span style={stateTagStyle(state.links)}>
              {state.links ? "פעיל" : "כבוי"}
            </span>
          </button>

          <button
            type="button"
            aria-pressed={state.noMotion}
            onClick={() => update({ ...state, noMotion: !state.noMotion })}
            style={toggleStyle(state.noMotion)}
          >
            <span>עצירת אנימציות</span>
            <span style={stateTagStyle(state.noMotion)}>
              {state.noMotion ? "פעיל" : "כבוי"}
            </span>
          </button>

          <button
            type="button"
            onClick={reset}
            disabled={!anyActive}
            style={{
              width: "100%",
              padding: "0.55rem 0.8rem",
              borderRadius: 10,
              border: `2px solid ${anyActive ? BLUE : tokens.border}`,
              background: "#fff",
              color: anyActive ? BLUE : tokens.dim,
              fontFamily: tokens.assistant,
              fontWeight: 700,
              fontSize: "0.95rem",
              cursor: anyActive ? "pointer" : "default",
            }}
          >
            איפוס הגדרות נגישות
          </button>

          <Link
            href="/accessibility"
            style={{
              marginTop: "0.2rem",
              fontFamily: tokens.assistant,
              fontWeight: 600,
              fontSize: "0.9rem",
              color: BLUE,
              textDecoration: "underline",
              textAlign: "center",
            }}
          >
            הצהרת נגישות
          </Link>
        </div>
      )}
    </>
  );
}
