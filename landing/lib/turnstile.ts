// Pure, unit-tested logic for the Cloudflare Turnstile signup gate — no React,
// no DOM, no network — so the token lifecycle and the "can this form submit"
// decision run in plain-node tests (tests/turnstile.test.mjs), exactly like
// lib/imageFallback.ts. The thin React wrapper (app/components/Turnstile.tsx)
// only renders the widget and feeds its callbacks into these functions.
//
// SECURITY POSTURE: the site key is PUBLIC (it ships to the browser by design).
// The real gate is the SECRET-side siteverify in supabase/functions/signup.
// This module's job is UX correctness: fail closed when unconfigured, allow a
// submit only with a fresh unsolved-once token, and force a new token on retry.

/** The public site key, read from the build-time env. Empty string when the
 *  deployment was built without NEXT_PUBLIC_TURNSTILE_SITE_KEY — in which case
 *  the widget fails CLOSED (no token can be produced, so no submit). We never
 *  fall back to a hardcoded key: an unconfigured build must not pretend to be
 *  protected. */
export function getTurnstileSiteKey(): string {
  return (typeof process !== "undefined" && process.env && process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) || "";
}

export function isTurnstileConfigured(siteKey: string = getTurnstileSiteKey()): boolean {
  return typeof siteKey === "string" && siteKey.length > 0;
}

/** Widget status as this app tracks it. `unconfigured` is distinct from
 *  `error`: it means the site key is missing, which is an operator/config
 *  problem, not a user-recoverable one. */
export type TurnstileStatus =
  | "unconfigured"
  | "loading"
  | "ready"
  | "solved"
  | "error"
  | "expired";

export type TurnstileState = { status: TurnstileStatus; token: string | null };

/** Events the widget (or the host) can raise. `consumed` is raised by the host
 *  AFTER a submit sends the token, since a Turnstile token is single-use. */
export type TurnstileEvent =
  | { type: "script-loading" }
  | { type: "rendered" }
  | { type: "success"; token: string }
  | { type: "error" }
  | { type: "expired" }
  | { type: "timeout" }
  | { type: "consumed" }
  | { type: "reset" };

export function initialTurnstileState(siteKey: string = getTurnstileSiteKey()): TurnstileState {
  return isTurnstileConfigured(siteKey)
    ? { status: "loading", token: null }
    : { status: "unconfigured", token: null };
}

/** Pure reducer for the token lifecycle. A solved token is held until it is
 *  consumed/expired/errored; consuming or expiring it clears the token and
 *  returns the widget to `ready` so a NEW token must be solved before the next
 *  submit (single-use enforcement). Never mutates; never logs. */
export function reduceTurnstile(state: TurnstileState, ev: TurnstileEvent): TurnstileState {
  if (state.status === "unconfigured") return state; // no key → stays closed
  switch (ev.type) {
    case "script-loading":
      return { status: "loading", token: null };
    case "rendered":
      return { status: state.status === "solved" ? "solved" : "ready", token: state.token };
    case "success":
      return ev.token ? { status: "solved", token: ev.token } : { status: "error", token: null };
    case "error":
    case "timeout":
      return { status: "error", token: null };
    case "expired":
      return { status: "expired", token: null };
    case "consumed":
    case "reset":
      return { status: "ready", token: null };
    default:
      return state;
  }
}

/** The ONLY place that decides whether the register form may submit: the
 *  captcha must be configured AND solved with a non-empty token AND the rest of
 *  the form must be valid AND no request already in flight. */
export function canSubmitSignup(args: {
  configured: boolean;
  formValid: boolean;
  busy: boolean;
  state: TurnstileState;
}): boolean {
  return (
    args.configured &&
    args.formValid &&
    !args.busy &&
    args.state.status === "solved" &&
    typeof args.state.token === "string" &&
    args.state.token.length > 0
  );
}

/** Accessible, user-facing Hebrew status line for the current widget state.
 *  Never contains a token or any internal detail. */
export function turnstileStatusMessage(status: TurnstileStatus): string {
  switch (status) {
    case "unconfigured":
      return "אימות האבטחה אינו זמין כרגע. לא ניתן להשלים הרשמה — נסו שוב מאוחר יותר.";
    case "loading":
      return "טוען אימות אבטחה…";
    case "ready":
      return "אנא השלימו את אימות האבטחה כדי להמשיך.";
    case "solved":
      return "אימות האבטחה הושלם.";
    case "expired":
      return "אימות האבטחה פג תוקף — אנא אמתו שוב.";
    case "error":
      return "אימות האבטחה נכשל — אנא נסו שוב.";
  }
}
