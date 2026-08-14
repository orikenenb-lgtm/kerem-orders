// PURE, unit-tested decision helpers for the PROPOSED secure signup function.
// No Deno APIs, no network — exercised from landing/tests/signup.test.mjs so
// the security rules run in CI.
//
// ⚠️ PROVENANCE: this is a PROPOSED REPLACEMENT for the deployed `signup`
// function, written from its contract to FIX known weaknesses. It is NOT the
// deployed source. Deploy only via docs/edge-functions-runbook.md, owner-gated.
//
// Security invariants encoded here (see the tests):
//  1. A user can NEVER become manager by submitting a particular email — role
//     is decided server-side, later, after ownership is verified; public
//     signup always yields "customer".
//  2. A client-supplied role/ is_manager/ admin field in the body is ignored.
//  3. Email is normalized (trim + lowercase) so casing/spacing cannot bypass
//     any later uniqueness or allow-list check.
//  4. Public signup must NOT pre-confirm the address — email ownership is
//     proven through Supabase Auth's confirmation email.
//  5. Errors are generic and never reveal whether an account already exists.

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

/** Public signup never pre-confirms — the confirmation email proves the
 *  address belongs to the registrant. */
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
