"use client";

// Cloudflare Turnstile widget for the signup form. Thin wrapper: all the
// "can we submit / is the token fresh" logic lives in lib/turnstile.ts (pure,
// unit-tested). This component only loads the script, renders the widget
// explicitly, and forwards the widget callbacks into that reducer.
//
// Fails CLOSED: if NEXT_PUBLIC_TURNSTILE_SITE_KEY was not baked into the build,
// no widget renders, no token is produced, and the parent's submit stays
// disabled. The token is single-use — the parent calls reset() after a send.

import { useEffect, useRef, useState } from "react";
import {
  getTurnstileSiteKey,
  isTurnstileConfigured,
  initialTurnstileState,
  reduceTurnstile,
  turnstileStatusMessage,
  type TurnstileState,
  type TurnstileEvent,
} from "../../lib/turnstile";
import { tokens } from "../../lib/ui";

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileAPI = {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      action?: string;
      callback: (token: string) => void;
      "error-callback"?: () => void;
      "expired-callback"?: () => void;
      "timeout-callback"?: () => void;
      "response-field"?: boolean;
      retry?: "auto" | "never";
    },
  ) => string;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileAPI;
    // Named onload callback the API calls once it is ready (explicit mode).
    __ktTurnstileReady?: () => void;
  }
}

let scriptPromise: Promise<void> | null = null;

/** Load the Turnstile script exactly once per page (idempotent across mounts
 *  and Strict Mode's double-invoke). Resolves when window.turnstile exists. */
function loadScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (existing) {
      if (window.turnstile) return resolve();
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("turnstile script failed")));
      return;
    }
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.addEventListener("load", () => resolve());
    s.addEventListener("error", () => reject(new Error("turnstile script failed")));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export default function Turnstile({
  onToken,
  action = "signup",
}: {
  /** Called with the fresh token on success, or null on error/expiry/reset. */
  onToken: (token: string | null) => void;
  action?: string;
}) {
  const siteKey = getTurnstileSiteKey();
  const configured = isTurnstileConfigured(siteKey);
  const [state, setState] = useState<TurnstileState>(() => initialTurnstileState(siteKey));
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  // Strict Mode invokes effects twice in dev; this guard makes the render
  // idempotent so we never create two widgets in one container.
  const renderedRef = useRef(false);

  // Keep the latest onToken without making it an effect dependency (a new
  // closure each render must not re-run the widget setup).
  const onTokenRef = useRef(onToken);
  useEffect(() => { onTokenRef.current = onToken; });

  const dispatch = (ev: TurnstileEvent) => {
    setState((s) => reduceTurnstile(s, ev));
  };

  // Re-run the challenge in place after an error/expiry/timeout so the user can
  // recover without reloading the page (Cloudflare's recommended response).
  const reissueChallenge = () => {
    try {
      if (widgetIdRef.current && window.turnstile) window.turnstile.reset(widgetIdRef.current);
    } catch {
      /* widget not ready — the status message already prompts a retry */
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    if (!configured) {
      onTokenRef.current(null);
      return () => { mountedRef.current = false; };
    }
    // Initial state is already "loading" when configured (see
    // initialTurnstileState), so we don't dispatch here — that would be a
    // synchronous setState in effect setup.
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !mountedRef.current) return;
        const el = containerRef.current;
        if (!el || !window.turnstile || renderedRef.current) return;
        renderedRef.current = true;
        widgetIdRef.current = window.turnstile.render(el, {
          sitekey: siteKey,
          action,
          retry: "never",
          "response-field": false,
          callback: (token: string) => {
            if (!mountedRef.current) return;
            dispatch({ type: "success", token });
            onTokenRef.current(token); // token used by the parent; never logged
          },
          "error-callback": () => {
            if (!mountedRef.current) return;
            dispatch({ type: "error" });
            onTokenRef.current(null);
            reissueChallenge(); // let the user recover without reloading
          },
          "expired-callback": () => {
            if (!mountedRef.current) return;
            dispatch({ type: "expired" });
            onTokenRef.current(null);
            reissueChallenge(); // Cloudflare's recommended response to expiry
          },
          "timeout-callback": () => {
            if (!mountedRef.current) return;
            dispatch({ type: "timeout" });
            onTokenRef.current(null);
            reissueChallenge();
          },
        });
        dispatch({ type: "rendered" });
      })
      .catch(() => {
        if (mountedRef.current) { dispatch({ type: "error" }); onTokenRef.current(null); }
      });

    return () => {
      cancelled = true;
      mountedRef.current = false;
      // Remove the widget and its listeners so navigating away leaves nothing
      // behind (and a remount re-renders cleanly).
      try {
        if (widgetIdRef.current && window.turnstile) window.turnstile.remove(widgetIdRef.current);
      } catch {
        /* widget already gone */
      }
      widgetIdRef.current = null;
      renderedRef.current = false;
    };
  }, [configured, siteKey, action]);

  return (
    <div style={{ display: "grid", gap: "0.4rem" }}>
      {/* Reserve the widget's height so the async iframe injection doesn't
          shift the submit button (minimal CLS). */}
      <div ref={containerRef} aria-hidden={!configured} style={{ minHeight: configured ? 65 : 0 }} />
      <p
        role="status"
        aria-live="polite"
        style={{
          fontFamily: tokens.assistant,
          fontSize: "0.85rem",
          color: state.status === "error" || state.status === "unconfigured" ? "#C0143C" : tokens.body,
          margin: 0,
        }}
      >
        {turnstileStatusMessage(state.status)}
      </p>
    </div>
  );
}
