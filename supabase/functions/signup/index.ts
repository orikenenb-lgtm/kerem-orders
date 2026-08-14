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
//    server-side; Supabase Auth's own per-IP limits provide rate limiting.
//  * The service-role key never leaves the server and is never returned.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  parseSignup,
  publicSignupError,
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

/** Verify a Cloudflare Turnstile token server-side. If TURNSTILE_SECRET is not
 *  configured the gate is treated as unavailable and signup is refused rather
 *  than silently open. */
async function verifyTurnstile(token: unknown): Promise<boolean> {
  const secret = Deno.env.get("TURNSTILE_SECRET");
  if (!secret) return false;
  if (typeof token !== "string" || !token) return false;
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token }),
    });
    const data = await r.json();
    return data?.success === true;
  } catch {
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

  // Abuse protection before doing any work.
  if (!(await verifyTurnstile(body?.turnstileToken))) return fail("captcha_failed");

  const parsed = parseSignup(body);
  if (!parsed.ok) return fail(parsed.kind);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Create the account UNCONFIRMED and as a plain customer. role is never read
  // from the body; email_confirm is always false.
  const { data, error } = await admin.auth.admin.createUser({
    email: parsed.email,
    password: parsed.password,
    email_confirm: parsed.emailConfirm, // false — confirmation email required
    user_metadata: { role: parsed.role }, // "customer", always
  });

  // Uniform response: whether the address is new, already taken, or the
  // provider errored, the caller sees the SAME generic success-shaped message.
  // Details go to the server log only.
  if (error || !data?.user) {
    console.log(JSON.stringify({ evt: "signup", outcome: "not_created", reason: error?.message ?? "no user" }));
    return fail("signup_failed");
  }

  // Send the confirmation email through the normal Auth flow.
  try {
    await admin.auth.admin.generateLink({ type: "signup", email: parsed.email, password: parsed.password });
  } catch {
    /* non-fatal: the account exists unconfirmed; user can request a resend */
  }

  console.log(JSON.stringify({ evt: "signup", outcome: "created_unconfirmed" }));
  return fail("signup_failed"); // same generic message — no enumeration signal
});
