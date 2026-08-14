// signup — PROPOSED SECURE REPLACEMENT for the deployed public-signup function.
//
// ⚠️ PROVENANCE: written from the deployed function's contract to FIX known
// security weaknesses (auto email-confirm, email-based manager promotion). It
// is NOT the deployed source. Deploy only via docs/edge-functions-runbook.md,
// owner-gated, after local + verification testing. Nothing here runs in CI or
// on merge.
//
// What changed vs. the deployed behavior:
//  * NO manager promotion by email — every public signup is a customer. Manager
//    role is granted only by a separate, trusted, server-side process after
//    identity ownership is verified (never in this endpoint).
//  * email_confirm is FALSE — the address is proven via Supabase Auth's
//    confirmation email, not asserted by the caller.
//  * The request body's role / is_manager / admin fields are ignored entirely.
//  * Errors are generic and identical for "already exists" vs. any failure, so
//    the endpoint cannot be used to enumerate accounts.
//  * Abuse protection: a Cloudflare Turnstile token is required and verified
//    server-side; signup then goes through the ANON `auth.signUp()` flow,
//    which BOTH sends Supabase's built-in confirmation email AND applies
//    Auth's per-IP signup rate limits (surfaced here as a 429). No
//    service-role key is used by this function at all.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  parseSignup,
  publicSignupError,
  isTurnstileVerifyAcceptable,
  type SignupErrorKind,
} from "./lib.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function fail(kind: SignupErrorKind): Response {
  const e = publicSignupError(kind);
  return json({ ok: kind === "signup_failed", message: e.message }, e.status);
}

/** Verify a Cloudflare Turnstile token server-side, with a bounded timeout and
 *  success + action + (production) hostname checks. If TURNSTILE_SECRET is not
 *  configured the gate is treated as unavailable and signup is REFUSED rather
 *  than silently open. TURNSTILE_ENV=test relaxes the hostname check for local/
 *  CI runs that use Cloudflare's official test keys. The token/secret are never
 *  logged. */
async function verifyTurnstile(token: unknown, remoteIp: string | null): Promise<boolean> {
  const secret = Deno.env.get("TURNSTILE_SECRET");
  if (!secret) return false;
  if (typeof token !== "string" || !token) return false;
  const allowTest = Deno.env.get("TURNSTILE_ENV") === "test";
  try {
    const params = new URLSearchParams({ secret, response: token });
    if (remoteIp) params.set("remoteip", remoteIp);
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
      signal: AbortSignal.timeout(5000),
    });
    const data = await r.json();
    return isTurnstileVerifyAcceptable(data, { allowTest, expectedAction: "signup" });
  } catch {
    // Network error / timeout / non-JSON → fail closed.
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("invalid_input");

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("invalid_input");
  }

  // Abuse protection before doing any work. Pass the caller IP (if the edge
  // provides it) to Cloudflare for an extra signal; never logged.
  const remoteIp = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for");
  if (!(await verifyTurnstile(body?.turnstileToken, remoteIp))) return fail("captcha_failed");

  const parsed = parseSignup(body);
  if (!parsed.ok) return fail(parsed.kind);

  // Public signup goes through the ANON auth.signUp() flow — NOT the
  // service-role admin API. That is what actually sends the confirmation email
  // (email_confirm stays under Auth's control, unconfirmed until the user
  // clicks the link) and applies Auth's per-IP signup rate limits. The role is
  // set to "customer" in user_metadata for reference only; NOTHING here grants
  // manager, and no service-role key is used.
  const anon = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
  );

  const { error } = await anon.auth.signUp({
    email: parsed.email,
    password: parsed.password,
    options: { data: { role: parsed.role } }, // "customer", always
  });

  // Auth's own per-IP limiter surfaces as a 429 — map it to the generic
  // rate-limited response so a flood is throttled with a truthful status.
  if (error && (error.status === 429 || /rate limit/i.test(error.message))) {
    console.log(JSON.stringify({ evt: "signup", outcome: "rate_limited" }));
    return fail("rate_limited");
  }

  // Uniform response for everything else: whether the address is new, already
  // registered, or the provider errored, the caller sees the SAME generic
  // success-shaped message (Supabase's signUp is itself enumeration-safe for a
  // duplicate). Details go to the server log only, never the body.
  if (error) {
    console.log(JSON.stringify({ evt: "signup", outcome: "not_created", reason: error.message }));
  } else {
    console.log(JSON.stringify({ evt: "signup", outcome: "created_or_pending" }));
  }
  return fail("signup_failed"); // generic "check your email" message — no enumeration signal
});
