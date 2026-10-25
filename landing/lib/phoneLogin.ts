// Phone sign-in. Accounts opened through "לקוח קיים" (supabase/functions/
// rivhit-express) have no real email — most Rivhit customers have none — so
// each one signs in through a fixed, never-deliverable address made from the
// phone. Typing the phone on the login form is just this mapping.
//
// KEEP IN STEP with supabase/functions/rivhit-express/lib.ts (canonPhone,
// loginEmailForPhone): tests/rivhitExpress.test.mjs checks the two agree.

export const LOGIN_EMAIL_DOMAIN = "phone.kerem-toys.invalid";

/** 050-123-4567 / 0501234567 / +972 50 123 4567 → "501234567"; "" if not a phone. */
export function canonPhone(raw: unknown): string {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.startsWith("972")) d = d.slice(3);
  d = d.replace(/^0+/, "");
  return d.length === 8 || d.length === 9 ? d : "";
}

export function loginEmailForPhone(raw: unknown): string {
  const c = canonPhone(raw);
  return c ? `t${c}@${LOGIN_EMAIL_DOMAIN}` : "";
}

/** What the login form sends to Supabase: an email as typed (lowercased), or
 *  the phone account's address when the field holds a phone and no "@". */
export function loginIdentifier(raw: string): string {
  const s = raw.trim();
  if (s.includes("@")) return s.toLowerCase();
  return loginEmailForPhone(s) || s.toLowerCase();
}

/** True for a phone account's internal address — never shown to anyone. */
export function isPhoneLoginEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(`@${LOGIN_EMAIL_DOMAIN}`);
}
