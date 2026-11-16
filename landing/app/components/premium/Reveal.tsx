"use client";

// Fade-and-rise as a section scrolls into view (CSS in globals.css). Content is
// visible by default; the hidden start state is armed only after this effect
// has run (html.kp-js) and IntersectionObserver exists — so if JS fails, nothing
// stays transparent. One shared observer for every Reveal on the page; each
// element is revealed once and then unobserved (no work while scrolling after).

import { useEffect, useRef, type ElementType, type ReactNode, type CSSProperties } from "react";

let shared: IntersectionObserver | null = null;
function observer(): IntersectionObserver | null {
  if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") return null;
  if (!shared) {
    shared = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("kp-in");
            shared?.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );
  }
  return shared;
}

export default function Reveal({
  as: Tag = "div",
  children,
  className = "",
  style,
  delayMs = 0,
}: {
  as?: ElementType;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Small stagger for siblings (keep ≤ 240ms — never make people wait). */
  delayMs?: number;
}) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    const io = observer();
    if (!el || !io) return;
    document.documentElement.classList.add("kp-js");
    // Already on screen at mount → show at once (no flash of hidden content).
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight && r.bottom > 0) {
      el.classList.add("kp-in");
      return;
    }
    io.observe(el);
    return () => io.unobserve(el);
  }, []);
  return (
    <Tag ref={ref} className={`kp-reveal ${className}`.trim()} style={delayMs ? { ...style, transitionDelay: `${delayMs}ms` } : style}>
      {children}
    </Tag>
  );
}
