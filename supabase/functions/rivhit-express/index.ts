// rivhit-express — "לקוח קיים": an existing Rivhit customer opens his site
// account with his ח״פ or phone, his name and a password, instead of the full
// registration form. Mirror of the deployed function. Public endpoint
// (verify_jwt off, like signup); the captcha is the gate.
//
// Two calls:
//   { action: "lookup", ident, turnstileToken }
//     → { status: "found", options: [{ ticket, label, city }] }
//     | { status: "not_found" } | { status: "already_linked" }
//     The card is looked up in the nightly copy (public.customers); if it is
//     not there — opened in Rivhit today — Rivhit's Customer.List is read
//     live (READ-ONLY) and the matched card alone is written to the copy.
//     A label is the card name MASKED ("צע••• ר••"): enough for the owner to
//     recognise his card, not a way to read the customer list.
//   { action: "create", ticket, first_name, last_name, phone, password }
//     → { ok: true, login_email } | { error }
//     The ticket (HMAC-signed rivhit_id + 20-minute expiry) proves the card
//     came from a lookup that passed the captcha.
//
// What create does: an already-confirmed auth user whose email is the fixed
// phone address (lib.ts loginEmailForPhone — so the customer signs in later
// with phone + password), a 'customer' profile marked signup_source =
// 'rivhit_express', then the link to the Rivhit card — written as its own
// UPDATE so the existing triggers run exactly as when the manager links by
// hand: the card's discount is copied (trg_pull_discount_on_link) and the
// card's agent assigned (trg_zz_assign_agent_on_link). If any step fails, the
// auth user made in this request — and only it — is removed again.
//
// Guards: captcha fails CLOSED (anything but "ok" is refused); one site
// account per card (a card that already has one is refused, re-checked after
// the link against a race); at most 30 express accounts per hour; every
// account is listed for the manager on the dashboard (ניהול ← לקוחות).
// Read-only toward Rivhit, always.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  canonPhone, canonVat, cleanName, digitsOnly, formatPhone, isAcceptablePassword,
  isTurnstileVerifyAcceptable, loginEmailForPhone, maskName, matchCards,
  signTicket, verifyTicket, type Card,
} from './lib.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const RIVHIT = 'https://api.rivhit.co.il/online/RivhitOnlineAPI.svc'
const TICKET_MS = 20 * 60 * 1000
const MAX_PER_HOUR = 30

async function captchaOk(token: unknown, remoteIp: string | null): Promise<{ ok: boolean; why: string }> {
  const secret = Deno.env.get('TURNSTILE_SECRET')
  if (!secret) return { ok: false, why: 'unconfigured' }
  if (typeof token !== 'string' || token === '') return { ok: false, why: 'no_token' }
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
    const ok = isTurnstileVerifyAcceptable(data, { allowTest: Deno.env.get('TURNSTILE_ENV') === 'test', expectedAction: 'express' })
    return { ok, why: ok ? 'ok' : `rejected:${(Array.isArray(data?.['error-codes']) ? data['error-codes'] : []).join(',')}` }
  } catch {
    return { ok: false, why: 'unreachable' }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey)
  // The ticket key never leaves the server and needs no new secret.
  const ticketKey = `${serviceKey}:rivhit-express:v1`

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { return json({ error: 'בקשה לא תקינה' }, 400) }

  // ------------------------------------------------------------ lookup
  if (body.action === 'lookup') {
    const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null
    const cap = await captchaOk(body.turnstileToken, ip)
    if (!cap.ok) {
      console.log(JSON.stringify({ evt: 'express-lookup', captcha: cap.why }))
      return json({ error: 'אימות האבטחה לא עבר. נסו שוב.' }, 400)
    }
    const ident = String(body.ident ?? '').slice(0, 40)
    if (!canonVat(ident) && !canonPhone(ident)) return json({ error: 'הקלידו ח״פ או מספר טלפון.' }, 400)

    const { data: copy, error: cErr } = await admin.from('customers')
      .select('rivhit_id,name,city,phone,vat_number').eq('is_active', true).limit(5000)
    if (cErr) return json({ error: 'החיפוש נכשל. נסו שוב בעוד רגע.' }, 500)
    let hits: Card[] = matchCards((copy ?? []) as Card[], ident)
    let source = 'copy'

    if (hits.length === 0) {
      // Not in the nightly copy — maybe opened in Rivhit today. Read live.
      try {
        const { data: tok } = await admin.rpc('_get_rivhit_token')
        if (tok) {
          const r = await fetch(`${RIVHIT}/Customer.List`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ api_token: tok }),
            signal: AbortSignal.timeout(15000),
          })
          const j = await r.json()
          if (j?.error_code === 0) {
            const now = new Date().toISOString()
            // deno-lint-ignore no-explicit-any
            const live = ((j.data && j.data.customer_list) || []).filter((c: any) => c.customer_id > 0 && [c.first_name, c.last_name].filter(Boolean).join(' ').trim())
              // deno-lint-ignore no-explicit-any
              .map((c: any) => ({
                // The exact row the nightly rivhit-sync writes (v22 mapping).
                rivhit_id: c.customer_id,
                name: [c.first_name, c.last_name].filter(Boolean).join(' ').trim(),
                city: (c.city || '').trim(), phone: String(c.phone || '').trim(),
                email: String(c.email || '').toLowerCase().trim(),
                vat_number: String(c.vat_number ?? '').replace(/\D/g, ''),
                price_list_id: c.price_list_id ?? null, discount_percent: Number(c.discount_percent) || 0,
                agent_id: Number(c.agent_id) > 0 ? Number(c.agent_id) : null,
                is_active: true, updated_at: now,
              }))
            hits = matchCards(live, ident)
            if (hits.length > 0) {
              const { error: uErr } = await admin.from('customers').upsert(hits, { onConflict: 'rivhit_id' })
              if (uErr) hits = []
              else source = 'live'
            }
          }
        }
      } catch { /* Rivhit unreachable — answer from the copy alone */ }
    }

    console.log(JSON.stringify({ evt: 'express-lookup', captcha: 'ok', hits: hits.length, source }))
    if (hits.length === 0) return json({ status: 'not_found' })

    const ids = hits.map((h) => h.rivhit_id)
    const { data: linked } = await admin.from('profiles').select('rivhit_customer_id').in('rivhit_customer_id', ids)
    const taken = new Set((linked ?? []).map((l: { rivhit_customer_id: number }) => l.rivhit_customer_id))
    const free = hits.filter((h) => !taken.has(h.rivhit_id)).slice(0, 5)
    if (free.length === 0) return json({ status: 'already_linked' })

    const e = Date.now() + TICKET_MS
    const options = await Promise.all(free.map(async (h) => ({
      ticket: await signTicket(ticketKey, { r: h.rivhit_id, e }),
      label: maskName(h.name),
      city: String(h.city || '').trim().slice(0, 40),
    })))
    return json({ status: 'found', options })
  }

  // ------------------------------------------------------------ create
  if (body.action === 'create') {
    const t = await verifyTicket(ticketKey, body.ticket, Date.now())
    if (!t) return json({ error: 'עבר יותר מדי זמן מהחיפוש. חפשו שוב.' }, 400)
    const first = cleanName(body.first_name)
    const last = cleanName(body.last_name)
    const loginEmail = loginEmailForPhone(body.phone)
    const password = body.password
    if (!first || !last) return json({ error: 'חסר שם פרטי או שם משפחה.' }, 400)
    if (!loginEmail) return json({ error: 'מספר הטלפון לא תקין.' }, 400)
    if (!isAcceptablePassword(password)) return json({ error: 'הסיסמה צריכה להיות באורך 6 תווים לפחות.' }, 400)

    const since = new Date(Date.now() - 3600_000).toISOString()
    const { count: recent } = await admin.from('profiles').select('id', { count: 'exact', head: true })
      .eq('signup_source', 'rivhit_express').gte('created_at', since)
    if ((recent ?? 0) >= MAX_PER_HOUR) return json({ error: 'יותר מדי הרשמות בשעה האחרונה. נסו שוב מאוחר יותר או התקשרו אלינו.' }, 429)

    const { data: card } = await admin.from('customers')
      .select('rivhit_id,name,city,phone,vat_number').eq('rivhit_id', t.r).eq('is_active', true).maybeSingle()
    if (!card) return json({ error: 'הכרטיס לא נמצא ברווחית. חפשו שוב.' }, 400)
    const { count: already } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('rivhit_customer_id', t.r)
    if ((already ?? 0) > 0) return json({ error: 'לכרטיס הזה כבר יש חשבון באתר. התחברו עם הטלפון והסיסמה, או התקשרו אלינו.', status: 'already_linked' }, 409)

    const phone = formatPhone(body.phone)
    const { data: created, error: aErr } = await admin.auth.admin.createUser({
      email: loginEmail,
      password: password as string,
      email_confirm: true,
      user_metadata: { full_name: `${first} ${last}`, phone, created_as: 'rivhit_express', rivhit_id: t.r },
    })
    if (aErr || !created?.user) {
      const dup = /already.*registered|exist/i.test(aErr?.message || '')
      console.log(JSON.stringify({ evt: 'express-create', ok: false, why: dup ? 'phone_taken' : 'auth_error' }))
      return json({ error: dup ? 'מספר הטלפון הזה כבר רשום באתר. התחברו עם הטלפון והסיסמה.' : 'פתיחת החשבון נכשלה. לא נוצר כלום.' }, 400)
    }
    const id = created.user.id
    const undo = async (msg: string, status = 400, extra: Record<string, unknown> = {}) => {
      await admin.auth.admin.deleteUser(id)
      return json({ error: msg, ...extra }, status)
    }

    const vat = canonVat(card.vat_number) ? digitsOnly(card.vat_number) : ''
    const { error: pErr } = await admin.from('profiles').upsert({
      id,
      email: null,
      full_name: `${first} ${last}`,
      business_name: String(card.name || '').trim(),
      phone,
      vat_number: vat,
      city: String(card.city || '').trim() || null,
      role: 'customer',
      signup_source: 'rivhit_express',
    })
    if (pErr) return undo('פתיחת החשבון נכשלה. לא נוצר כלום.')

    // The link, as its own UPDATE — the same path as the manager's link button.
    const { error: lErr } = await admin.from('profiles').update({ rivhit_customer_id: t.r }).eq('id', id)
    if (lErr) return undo('פתיחת החשבון נכשלה. לא נוצר כלום.')

    // Two people racing for one card: the later one gives way.
    const { data: owners } = await admin.from('profiles').select('id,created_at').eq('rivhit_customer_id', t.r).order('created_at', { ascending: true })
    if ((owners ?? []).length > 1 && owners![0].id !== id) {
      return undo('לכרטיס הזה כבר יש חשבון באתר. התחברו עם הטלפון והסיסמה, או התקשרו אלינו.', 409, { status: 'already_linked' })
    }

    console.log(JSON.stringify({ evt: 'express-create', ok: true, id, rivhit_id: t.r }))
    return json({ ok: true, login_email: loginEmail })
  }

  return json({ error: 'בקשה לא תקינה' }, 400)
})
