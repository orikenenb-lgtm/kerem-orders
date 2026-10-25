// PURE helpers for rivhit-express — no Deno APIs, no network. Unit-tested from
// landing/tests/rivhitExpress.test.mjs so the matching and ticket rules run in
// CI. index.ts does the I/O.

/** Digits only. */
export function digitsOnly(raw: unknown): string {
  return String(raw ?? "").replace(/\D/g, "");
}

/** One canonical form for an Israeli phone however it was typed:
 *  050-123-4567, 0501234567, +972 50 123 4567, 972501234567 → "501234567";
 *  04-812-3456 → "48123456". "" when it cannot be a phone (8 or 9 digits
 *  after dropping 972 and the leading 0). */
export function canonPhone(raw: unknown): string {
  let d = digitsOnly(raw);
  if (d.startsWith("972")) d = d.slice(3);
  d = d.replace(/^0+/, "");
  return d.length === 8 || d.length === 9 ? d : "";
}

/** ח״פ / ע״מ / ת״ז as digits without leading zeros (Rivhit stores 012345678
 *  as 12345678). "" for anything too short to identify a business — 203
 *  Rivhit cards carry a single "0" in this field. */
export function canonVat(raw: unknown): string {
  const d = digitsOnly(raw).replace(/^0+/, "");
  return d.length >= 5 && d.length <= 10 ? d : "";
}

/** Supabase Auth needs an email; most Rivhit customers have none (38 of 554).
 *  A phone account signs in through a fixed, never-deliverable address made
 *  from the phone, so "טלפון + סיסמה" on the login form is just this mapping.
 *  The SAME function lives in landing/lib/phoneLogin.ts — a unit test keeps
 *  the two identical. */
export const LOGIN_EMAIL_DOMAIN = "phone.kerem-toys.invalid";
export function loginEmailForPhone(raw: unknown): string {
  const c = canonPhone(raw);
  return c ? `t${c}@${LOGIN_EMAIL_DOMAIN}` : "";
}

/** 501234567 → 050-1234567, 48123456 → 04-8123456 (for display on the profile). */
export function formatPhone(raw: unknown): string {
  const c = canonPhone(raw);
  if (!c) return "";
  return c.length === 9 ? `0${c.slice(0, 2)}-${c.slice(2)}` : `0${c.slice(0, 1)}-${c.slice(1)}`;
}

export type Card = {
  rivhit_id: number;
  name: string;
  city?: string | null;
  phone?: string | null;
  vat_number?: string | null;
};

/** The Rivhit cards a typed ח״פ-or-phone points at: the ח״פ field equal to it
 *  (leading zeros ignored), or the phone field equal to it as a phone. */
export function matchCards<T extends Card>(cards: T[], ident: unknown): T[] {
  const v = canonVat(ident);
  const p = canonPhone(ident);
  if (!v && !p) return [];
  const seen = new Set<number>();
  return cards.filter((c) => {
    if (seen.has(c.rivhit_id)) return false;
    const hit = (v !== "" && canonVat(c.vat_number) === v) || (p !== "" && canonPhone(c.phone) === p);
    if (hit) seen.add(c.rivhit_id);
    return hit;
  });
}

/** "צעצועי רון" → "צע••• ר••". Enough for the owner of the card to recognise
 *  it among two or three of his own; not a way to read the customer list. */
export function maskName(name: unknown): string {
  return String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      const chars = [...w];
      const keep = chars.length <= 3 ? 1 : 2;
      return chars.slice(0, keep).join("") + "•".repeat(Math.min(Math.max(chars.length - keep, 1), 3));
    })
    .join(" ");
}

/** First/last name: trimmed, inner spaces collapsed, at most 40 characters. */
export function cleanName(raw: unknown): string {
  return String(raw ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
}

/** Same floor as public signup (6); 72 is bcrypt's ceiling. */
export function isAcceptablePassword(pw: unknown): boolean {
  return typeof pw === "string" && pw.length >= 6 && pw.length <= 72;
}

// ---------------------------------------------------------------------------
// The ticket between "found" and "create". The lookup is the step that costs
// a captcha; the create step proves it came from a lookup by presenting this
// HMAC-signed { rivhit_id, expiry } — no second captcha, no way to name a
// card the lookup did not return.
// ---------------------------------------------------------------------------

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data))));
}

export type TicketPayload = { r: number; e: number };

export async function signTicket(secret: string, p: TicketPayload): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify({ r: p.r, e: p.e })));
  return `${body}.${await hmac(secret, body)}`;
}

export async function verifyTicket(secret: string, ticket: unknown, nowMs: number): Promise<TicketPayload | null> {
  if (typeof ticket !== "string" || ticket.length > 400) return null;
  const [body, sig, extra] = ticket.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const want = await hmac(secret, body);
  if (want.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const json = atob(body.replace(/-/g, "+").replace(/_/g, "/"));
    const p = JSON.parse(json) as TicketPayload;
    if (!Number.isInteger(p.r) || p.r <= 0 || typeof p.e !== "number" || p.e <= nowMs) return null;
    return { r: p.r, e: p.e };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Turnstile — the same acceptance rules as supabase/functions/signup/lib.ts
// (a parity test runs both on the same inputs). The difference is in index.ts:
// this endpoint FAILS CLOSED on every verdict but "ok", because it leads to an
// existing customer's card, not to a fresh empty account.
// ---------------------------------------------------------------------------

export const TURNSTILE_PROD_HOSTNAME = "orikenenb-lgtm.github.io";

export type SiteverifyResponse = {
  success?: boolean;
  hostname?: string;
  action?: string;
  "error-codes"?: string[];
};

export function isTurnstileVerifyAcceptable(
  data: SiteverifyResponse | null | undefined,
  opts: { allowTest: boolean; expectedAction?: string },
): boolean {
  if (!data || data.success !== true) return false;
  if (opts.expectedAction && typeof data.action === "string" && data.action.length > 0) {
    if (data.action !== opts.expectedAction) return false;
  }
  if (opts.allowTest) return true;
  const host = (data.hostname || "").toLowerCase();
  if (!host || host === "localhost" || host === "127.0.0.1" || host === "[::1]") return false;
  return host === TURNSTILE_PROD_HOSTNAME;
}
