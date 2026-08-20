// PURE, unit-tested decision helpers for the signup function. No Deno APIs, no
// network — exercised from landing/tests/signup.test.mjs so the security rules
// run in CI.
//
// Read the split carefully, because not every rule in this file is live.
//
// ENFORCED BY THE DEPLOYED FUNCTION (index.ts):
//  1. A user can NEVER become manager by submitting a particular email — public
//     signup always yields "customer". (resolveRole)
//  2. A client-supplied role / is_manager / admin field in the body is ignored.
//  3. Email is normalized (trim + lowercase) so casing/spacing cannot bypass
//     any later uniqueness or allow-list check. (normalizeEmail, isValidEmail)
//  4. The Cloudflare Turnstile token is verified server-side, with the action
//     and production-hostname checks. (isTurnstileVerifyAcceptable)
//
// NOT LIVE — a stricter posture kept here, and tested, for the day the owner
// turns on confirmation emails. index.ts deliberately does neither:
//  5. EMAIL_CONFIRM_ON_PUBLIC_SIGNUP / parseSignup say public signup must not
//     pre-confirm the address. The live function DOES pre-confirm
//     (email_confirm: true) so a new customer can log in immediately, and the
//     registration screen's success copy says exactly that. Switching this on
//     requires SMTP to be configured and that copy to be rewritten first.
//  6. publicSignupError's uniform messages hide whether an account exists. The
//     live function instead tells a returning buyer his address is already
//     registered, which is an enumeration signal traded for not stranding him.
//
// parseSignup also applies an 8-character password floor; the live function and
// the registration form both use 6. Raising the floor is a product decision,
// not a code change to make quietly.

export const CUSTOMER_ROLE = "customer" as const;

/** Trim + lowercase. Two strings that differ only by casing/whitespace
 *  normalize to the same value, so `Owner@x.com ` cannot masquerade as a
 *  different identity from `owner@x.com`. */
export function normalizeEmail(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

/** RFC-lite: exactly one @, non-empty local part, a dot in the domain, no
 *  spaces. Deliberately strict-but-simple; Supabase Auth re-validates too. */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Minimum password policy enforced before hitting Auth. */
export function isAcceptablePassword(pw: unknown): boolean {
  return typeof pw === "string" && pw.length >= 8 && pw.length <= 200;
}

/** The role a PUBLIC signup may ever produce. Always customer — the body is
 *  ignored on purpose: no email string, no `role`/`is_manager`/`admin` field
 *  a caller sends can elevate privileges. Manager promotion is a separate,
 *  trusted, server-side step performed only after identity ownership is
 *  verified. */
export function resolveRole(_body: Record<string, unknown>): typeof CUSTOMER_ROLE {
  return CUSTOMER_ROLE;
}

/** The stricter posture: public signup would not pre-confirm, and the
 *  confirmation email would prove the address belongs to the registrant.
 *  NOT WIRED UP — index.ts passes email_confirm: true. See the header. */
export const EMAIL_CONFIRM_ON_PUBLIC_SIGNUP = false;

export type SignupErrorKind =
  | "invalid_input"
  | "rate_limited"
  | "captcha_failed"
  | "signup_failed";

/** Generic, uniform messages. Crucially, a duplicate address and a genuine
 *  failure both map to the SAME `signup_failed` message so the response never
 *  reveals whether an account exists (account-enumeration defense). */
export function publicSignupError(kind: SignupErrorKind): { status: number; message: string } {
  switch (kind) {
    case "invalid_input":
      return { status: 400, message: "פרטי ההרשמה אינם תקינים." };
    case "captcha_failed":
      return { status: 400, message: "אימות האבטחה נכשל, נסו שוב." };
    case "rate_limited":
      return { status: 429, message: "יותר מדי ניסיונות, נסו שוב מאוחר יותר." };
    case "signup_failed":
      // Same message for "already exists" and for any provider error.
      return { status: 200, message: "אם הכתובת תקינה, יישלח אליכם דוא\"ל לאישור ההרשמה." };
  }
}

/** Validate the request body into a normalized, safe shape or an error kind.
 *  Never trusts role/confirm fields from the client. */
// ---------------------------------------------------------------------------
// Turnstile siteverify response validation (pure, unit-tested)
// ---------------------------------------------------------------------------

/** The only hostname a PRODUCTION Turnstile solve may come from. */
export const TURNSTILE_PROD_HOSTNAME = "orikenenb-lgtm.github.io";

export type SiteverifyResponse = {
  success?: boolean;
  hostname?: string;
  action?: string;
  "error-codes"?: string[];
};

/** Decide whether a Cloudflare siteverify response is acceptable. Enforces:
 *  - success === true;
 *  - the widget action (when the response echoes one) matches expectedAction;
 *  - in PRODUCTION, the solving hostname is exactly the GitHub Pages host and
 *    never localhost/127.0.0.1.
 *  In test mode (Cloudflare's official test keys, which don't echo a real
 *  hostname) the hostname check is skipped but success is still required. */
export function isTurnstileVerifyAcceptable(
  data: SiteverifyResponse | null | undefined,
  opts: { allowTest: boolean; expectedAction?: string },
): boolean {
  if (!data || data.success !== true) return false;
  // Only enforce action when the response actually carries one (test keys omit it).
  if (opts.expectedAction && typeof data.action === "string" && data.action.length > 0) {
    if (data.action !== opts.expectedAction) return false;
  }
  if (opts.allowTest) return true;
  const host = (data.hostname || "").toLowerCase();
  if (!host || host === "localhost" || host === "127.0.0.1" || host === "[::1]") return false;
  return host === TURNSTILE_PROD_HOSTNAME;
}

export type ParsedSignup =
  | { ok: true; email: string; password: string; role: typeof CUSTOMER_ROLE; emailConfirm: false }
  | { ok: false; kind: SignupErrorKind };

export function parseSignup(body: Record<string, unknown>): ParsedSignup {
  const email = normalizeEmail(body?.email);
  if (!isValidEmail(email) || !isAcceptablePassword(body?.password)) {
    return { ok: false, kind: "invalid_input" };
  }
  return {
    ok: true,
    email,
    password: body.password as string,
    role: resolveRole(body),                 // always customer; body.role ignored
    emailConfirm: EMAIL_CONFIRM_ON_PUBLIC_SIGNUP, // always false
  };
}
