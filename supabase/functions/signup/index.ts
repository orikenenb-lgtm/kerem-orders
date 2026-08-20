// signup — the LIVE public-registration endpoint.
//
// PROVENANCE: this file is the deployed source. It started as the original
// hand-written function in the Supabase dashboard; this version keeps that
// function's contract byte-for-byte where the site depends on it and changes
// only the two things that were actually unsafe. Everything the registration
// form relies on — the `{ ok, role }` / `{ error }` response shape, the
// 6-character password floor, the profiles row with the address columns, and
// the already-confirmed account so "אפשר להתחבר עכשיו" stays true — is
// deliberately unchanged.
//
// What changed, and why only this much:
//
//  1. NO manager promotion by email. The old function granted `manager` to
//     anyone who typed the owner's address into the signup form. There is no
//     ownership check behind that string, so it was a full admin takeover for
//     the price of knowing one email. Public signup now always produces
//     `customer`; the owner's account already holds manager, so nothing is
//     lost. Any client-supplied role/is_manager/admin field is ignored.
//
//  2. The captcha is actually verified. The form has been solving a Cloudflare
//     Turnstile challenge and sending the token for a while; the function threw
//     it away, so the gate was decoration. The token is now checked against
//     Cloudflare's siteverify.
//
// What was deliberately NOT changed, even though a stricter version exists:
//
//  * `email_confirm: true` stays. Switching to Auth's confirmation-email flow
//    would silently break every registration until SMTP is configured, and
//    would make the success copy the site ships today ("החשבון נפתח — אפשר
//    להתחבר עכשיו") a lie. Confirmed accounts are the owner's chosen tradeoff
//    for a B2B shop whose customers he already knows.
//
//  * The friendly "this address is already registered" message stays. It is an
//    account-enumeration signal, and on a public consumer site it would be
//    worth removing; here the alternative is telling a wholesale buyer his
//    signup worked when it did not, and then watching him fail to log in.
//
//  * Turnstile fails CLOSED only on positive evidence that the TOKEN is bad —
//    missing, invalid, replayed, or solved for another action or hostname. An
//    unset secret, a secret not paired with the site key this build uses, a
//    malformed request and a Cloudflare outage all fail OPEN. An operator
//    mistake must not be able to take registration offline for every real
//    customer. Cloudflare's error codes are logged; the token never is.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { classifySiteverify, normalizeEmail, isValidEmail } from './lib.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

// Nullable-text helper: trims, caps length, empty -> null (address fields
// are nullable in profiles — Wave 4).
const opt = (v: unknown, max = 200): string | null => {
  const s = String(v ?? '').trim().slice(0, max)
  return s === '' ? null : s
}

type CaptchaOutcome =
  | { verdict: 'ok' | 'bad_token' | 'unconfigured' | 'unreachable' | 'misconfigured'; codes?: string[] }

/** Check the Turnstile token with Cloudflare and report WHY, not just yes/no.
 *  A signup is refused ONLY on positive evidence that the token is bad; a
 *  missing secret, a secret that is not paired with the site key the site was
 *  built with, a malformed request or a Cloudflare outage all let the
 *  registration through, because an operator mistake must not be able to take
 *  registration offline. Cloudflare's error codes are logged (they name the
 *  problem and are not sensitive); the secret and the token never are. */
async function checkTurnstile(token: unknown, remoteIp: string | null): Promise<CaptchaOutcome> {
  const secret = Deno.env.get('TURNSTILE_SECRET')
  if (!secret) return { verdict: 'unconfigured' }
  if (typeof token !== 'string' || token === '') return { verdict: 'bad_token' }
  const allowTest = Deno.env.get('TURNSTILE_ENV') === 'test'
  try {
    const params = new URLSearchParams({ secret, response: token })
    if (remoteIp) params.set('remoteip', remoteIp)
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
      signal: AbortSignal.timeout(5000),
    })
    const data = await r.json()
    const verdict = classifySiteverify(data, { allowTest, expectedAction: 'signup' })
    const codes = Array.isArray(data?.['error-codes']) ? data['error-codes'].map(String) : []
    return { verdict, codes }
  } catch {
    // Network error, timeout, or a non-JSON body: the gate is down, not the
    // caller's fault. Let the registration through and record it.
    return { verdict: 'unreachable' }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  try {
    const body = await req.json()
    const {
      email, password, full_name, business_name, phone, vat_number,
      city, street, house_number, zip_code, delivery_notes,
    } = body
    if (!email || !password) return json({ error: 'חסר אימייל או סיסמה' }, 400)
    if (String(password).length < 6) return json({ error: 'הסיסמה חייבת להכיל לפחות 6 תווים' }, 400)

    const cleanEmail = normalizeEmail(email)
    if (!isValidEmail(cleanEmail)) return json({ error: 'כתובת האימייל אינה תקינה' }, 400)

    const remoteIp = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for')
    const captcha = await checkTurnstile(body?.turnstileToken, remoteIp)
    console.log(JSON.stringify({ evt: 'signup', captcha: captcha.verdict, codes: captcha.codes ?? [] }))
    if (captcha.verdict === 'bad_token') {
      return json({ error: 'אימות האבטחה נכשל, נסו שוב.' }, 400)
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const cleanVat = String(vat_number ?? '').replace(/\D/g, '')
    // Always customer. No email string and no field in the request body can
    // produce any other role here.
    const role = 'customer'
    const address = {
      city: opt(city, 80),
      street: opt(street, 120),
      house_number: opt(house_number, 20),
      zip_code: opt(zip_code, 12),
      delivery_notes: opt(delivery_notes, 500),
    }

    // Create an already-confirmed user so login works instantly (no email step).
    const { data, error } = await admin.auth.admin.createUser({
      email: cleanEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name, business_name, phone, vat_number: cleanVat, ...address },
    })

    if (error) {
      const msg = /already.*registered|exist/i.test(error.message)
        ? 'האימייל הזה כבר רשום — אפשר להתחבר ישירות.'
        : error.message
      return json({ error: msg }, 400)
    }

    const uid = data.user!.id
    const { error: pErr } = await admin.from('profiles').upsert({
      id: uid,
      email: cleanEmail,
      full_name: full_name ?? '',
      business_name: business_name ?? '',
      phone: phone ?? '',
      vat_number: cleanVat,
      role,
      ...address,
    })
    if (pErr) return json({ error: pErr.message }, 400)

    return json({ ok: true, role })
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 400)
  }
})
