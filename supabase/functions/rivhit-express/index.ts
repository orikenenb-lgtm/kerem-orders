// rivhit-express — "לקוח קיים": an existing Rivhit customer opens his site
// account with his ח״פ or phone, his name and a password, instead of the full
// registration form. Mirror of the deployed function. Public endpoint
// (verify_jwt off, like signup); the captcha is the gate for the public
// actions, a manager's JWT for the admin ones.
//
// Public:
//   { action: "lookup", ident, turnstileToken }
//     → { status: "found", options: [{ ticket, label, city }] }
//     | { status: "not_found" | "already_linked" | "blocked" }
//     The card is looked up in the nightly copy (public.customers); if it is
//     not there — opened in Rivhit today — Rivhit's Customer.List is read
//     live (READ-ONLY, cached 5 minutes, at most 20 reads an hour per worker)
//     and the matched card alone is written to the copy. A label is the card
//     name MASKED ("צע••• ר••"); the city is shown only to tell two or more
//     of the same person's cards apart.
//   { action: "create", ticket, first_name, last_name, phone, password }
//     → { ok: true, login_email } | { error }
//     The ticket (HMAC-signed rivhit_id + 20-minute expiry) proves the card
//     came from a lookup that passed the captcha.
// Manager only (JWT + role checked here):
//   { action: "admin_list" }      → every account opened this way
//   { action: "admin_revoke", user_id }
//     → takes the card away from that account: link, discount, agent and the
//       copied business name cleared, and the card refused by this door from
//       now on (it can still be linked by hand).
//   { action: "admin_set_password", user_id, password }
//     → a new password for a phone account (they have no mailbox for a reset
//       link); the owner tells the customer by phone. Phone accounts only.
//
// The record of who came in this way lives in the auth user's app_metadata
// ({ express: { rivhit_id, at, revoked? } }) — writable by the service role
// only, so a customer cannot hide himself from the owner's list or from the
// hourly limit by editing his own profile.
//
// What create does: an already-confirmed auth user whose email is the fixed
// phone address (lib.ts loginEmailForPhone — so the customer signs in later
// with phone + password), a 'customer' profile, then the link to the Rivhit
// card — written as its own UPDATE so the existing triggers run exactly as
// when the manager links by hand: the card's discount is copied
// (trg_pull_discount_on_link) and the card's agent assigned
// (trg_zz_assign_agent_on_link). If any step fails, the auth user made in
// this request — and only it — is removed (profiles and their logs cascade);
// should that removal itself fail, the account is stripped of the card and
// banned instead, never left holding it.
//
// Guards: captcha fails CLOSED; a matched id must pass the Israeli check
// digit and a matched phone must not be a guessable one; one site account
// per card (re-checked after the link against a race); revoked cards
// refused; at most 30 express accounts per hour; every check that cannot be
// made fails closed. Read-only toward Rivhit, always.

import { createClient, type SupabaseClient, type User } from 'jsr:@supabase/supabase-js@2'
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
const LIVE_TTL_MS = 5 * 60 * 1000
const LIVE_MAX_PER_HOUR = 20
const TRY_AGAIN = 'משהו השתבש. נסו שוב בעוד רגע.'
const ALREADY = 'לכרטיס הזה כבר יש חשבון באתר. התחברו עם האימייל או הטלפון שאיתו נרשמתם, או התקשרו אלינו.'

type Express = { rivhit_id: number; at: string; revoked?: boolean; revoked_at?: string; revoked_by?: string }

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

/** Every auth user opened through this door (app_metadata.express). Throws
 *  if the list cannot be read — callers fail closed. */
async function expressUsers(admin: SupabaseClient): Promise<(User & { express: Express })[]> {
  const out: (User & { express: Express })[] = []
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    for (const u of data.users) {
      const e = (u.app_metadata as { express?: Express } | undefined)?.express
      if (e && Number.isInteger(e.rivhit_id)) out.push({ ...u, express: e })
    }
    if (data.users.length < 1000) break
  }
  return out
}

async function managerId(req: Request, admin: SupabaseClient): Promise<string | null> {
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const { data: who } = await admin.auth.getUser(jwt)
  const id = who?.user?.id
  if (!id) return null
  const { data: me } = await admin.from('profiles').select('role').eq('id', id).maybeSingle()
  return me?.role === 'manager' ? id : null
}

// Live Rivhit reads, per worker: a short cache and an hourly cap, so a burst
// of failed lookups cannot turn into a burst of full Customer.List downloads
// on the shop's one Rivhit token.
let liveCache: { at: number; rows: Record<string, unknown>[] } | null = null
const liveReads: number[] = []

async function liveCustomers(admin: SupabaseClient): Promise<Record<string, unknown>[] | null> {
  if (liveCache && Date.now() - liveCache.at < LIVE_TTL_MS) return liveCache.rows
  const hourAgo = Date.now() - 3600_000
  while (liveReads.length && liveReads[0] < hourAgo) liveReads.shift()
  if (liveReads.length >= LIVE_MAX_PER_HOUR) return null
  liveReads.push(Date.now())
  const { data: tok } = await admin.rpc('_get_rivhit_token')
  if (!tok) return null
  const r = await fetch(`${RIVHIT}/Customer.List`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ api_token: tok }),
    signal: AbortSignal.timeout(15000),
  })
  const j = await r.json()
  if (j?.error_code !== 0) return null
  const now = new Date().toISOString()
  // deno-lint-ignore no-explicit-any
  const rows = ((j.data && j.data.customer_list) || []).filter((c: any) => c.customer_id > 0 && [c.first_name, c.last_name].filter(Boolean).join(' ').trim())
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
  liveCache = { at: Date.now(), rows }
  return rows
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!serviceKey) return json({ error: TRY_AGAIN }, 500)
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey)
  // The ticket key never leaves the server and needs no new secret.
  const ticketKey = `${serviceKey}:rivhit-express:v1`

  let body: Record<string, unknown> = {}
  try {
    const parsed = await req.json()
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed as Record<string, unknown>
  } catch { /* falls through to "בקשה לא תקינה" */ }

  try {
    // ---------------------------------------------------------- lookup
    if (body.action === 'lookup') {
      const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null
      const cap = await captchaOk(body.turnstileToken, ip)
      if (!cap.ok) {
        console.log(JSON.stringify({ evt: 'express-lookup', captcha: cap.why }))
        return json({ error: 'אימות האבטחה לא עבר. נסו שוב.' }, 400)
      }
      const ident = String(body.ident ?? '').slice(0, 40)
      if (!canonVat(ident) && !canonPhone(ident)) return json({ error: 'הקלידו ח״פ תקין או מספר טלפון.' }, 400)

      const { data: copy, error: cErr } = await admin.from('customers')
        .select('rivhit_id,name,city,phone,vat_number').eq('is_active', true).limit(5000)
      if (cErr) return json({ error: TRY_AGAIN }, 500)
      let hits: Card[] = matchCards((copy ?? []) as Card[], ident)
      let source = 'copy'

      if (hits.length === 0) {
        try {
          const live = await liveCustomers(admin)
          if (live) {
            const found = matchCards(live as unknown as Card[], ident)
            if (found.length > 0) {
              const { error: uErr } = await admin.from('customers').upsert(found, { onConflict: 'rivhit_id' })
              if (!uErr) { hits = found; source = 'live' }
            }
          }
        } catch { /* Rivhit unreachable — answer from the copy alone */ }
      }

      console.log(JSON.stringify({ evt: 'express-lookup', captcha: 'ok', hits: hits.length, source }))
      if (hits.length === 0) return json({ status: 'not_found' })

      const ids = hits.map((h) => h.rivhit_id)
      const { data: linked, error: lErr } = await admin.from('profiles').select('rivhit_customer_id').in('rivhit_customer_id', ids)
      if (lErr) return json({ error: TRY_AGAIN }, 500)
      const taken = new Set((linked ?? []).map((l: { rivhit_customer_id: number }) => l.rivhit_customer_id))
      const revoked = new Set((await expressUsers(admin)).filter((u) => u.express.revoked).map((u) => u.express.rivhit_id))
      const free = hits.filter((h) => !taken.has(h.rivhit_id) && !revoked.has(h.rivhit_id)).slice(0, 5)
      if (free.length === 0) return json({ status: hits.some((h) => taken.has(h.rivhit_id)) ? 'already_linked' : 'blocked' })

      const e = Date.now() + TICKET_MS
      const options = await Promise.all(free.map(async (h) => ({
        ticket: await signTicket(ticketKey, { r: h.rivhit_id, e }),
        label: maskName(h.name),
        city: free.length > 1 ? String(h.city || '').trim().slice(0, 40) : '',
      })))
      return json({ status: 'found', options })
    }

    // ---------------------------------------------------------- create
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

      const all = await expressUsers(admin)
      const hourAgo = Date.now() - 3600_000
      if (all.filter((u) => Date.parse(u.express.at) >= hourAgo).length >= MAX_PER_HOUR) {
        return json({ error: 'יותר מדי הרשמות בשעה האחרונה. נסו שוב מאוחר יותר או התקשרו אלינו.' }, 429)
      }
      if (all.some((u) => u.express.revoked && u.express.rivhit_id === t.r)) {
        return json({ error: 'לכרטיס הזה לא ניתן להיכנס בדרך הזו. התקשרו אלינו.', status: 'blocked' }, 409)
      }

      const { data: card, error: cardErr } = await admin.from('customers')
        .select('rivhit_id,name,city,phone,vat_number').eq('rivhit_id', t.r).eq('is_active', true).maybeSingle()
      if (cardErr) return json({ error: TRY_AGAIN }, 500)
      if (!card) return json({ error: 'הכרטיס לא נמצא ברווחית. חפשו שוב.' }, 400)
      const { count: already, error: aCountErr } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('rivhit_customer_id', t.r)
      if (aCountErr) return json({ error: TRY_AGAIN }, 500)
      if ((already ?? 0) > 0) return json({ error: ALREADY, status: 'already_linked' }, 409)

      const phone = formatPhone(body.phone)
      const { data: created, error: aErr } = await admin.auth.admin.createUser({
        email: loginEmail,
        password: password as string,
        email_confirm: true,
        user_metadata: { full_name: `${first} ${last}`, phone },
        app_metadata: { express: { rivhit_id: t.r, at: new Date().toISOString() } },
      })
      if (aErr || !created?.user) {
        const dup = /already.*registered|exist/i.test(aErr?.message || '')
        console.log(JSON.stringify({ evt: 'express-create', ok: false, why: dup ? 'phone_taken' : 'auth_error' }))
        return json({ error: dup ? 'מספר הטלפון הזה כבר רשום באתר. התחברו עם הטלפון והסיסמה.' : 'פתיחת החשבון נכשלה. לא נוצר כלום.' }, 400)
      }
      const id = created.user.id
      const undo = async (msg: string, status = 400, extra: Record<string, unknown> = {}) => {
        const { error: dErr } = await admin.auth.admin.deleteUser(id)
        if (dErr) {
          // Could not remove it: make sure it holds nothing of the card.
          await admin.from('profiles').update({ rivhit_customer_id: null, discount_percent: 0, agent_user_id: null, agent_source: null, agent_assigned_at: null, business_name: '' }).eq('id', id)
          await admin.auth.admin.updateUserById(id, { ban_duration: '876000h' })
          console.log(JSON.stringify({ evt: 'express-undo-failed', id }))
        }
        return json({ error: msg, ...extra }, status)
      }

      const vatDigits = digitsOnly(card.vat_number)
      const { error: pErr } = await admin.from('profiles').upsert({
        id,
        email: null,
        full_name: `${first} ${last}`,
        business_name: String(card.name || '').trim(),
        phone,
        vat_number: vatDigits.replace(/^0+/, '').length >= 5 ? vatDigits : '',
        city: String(card.city || '').trim() || null,
        role: 'customer',
      })
      if (pErr) return undo('פתיחת החשבון נכשלה. לא נוצר כלום.')

      // The link, as its own UPDATE — the same path as the manager's link button.
      const { error: linkErr } = await admin.from('profiles').update({ rivhit_customer_id: t.r }).eq('id', id)
      if (linkErr) return undo('פתיחת החשבון נכשלה. לא נוצר כלום.')

      // Two people racing for one card: the later one gives way.
      const { data: owners, error: oErr } = await admin.from('profiles').select('id,created_at').eq('rivhit_customer_id', t.r).order('created_at', { ascending: true }).order('id', { ascending: true })
      if (oErr) return undo('פתיחת החשבון נכשלה. לא נוצר כלום.', 500)
      if ((owners ?? []).length > 1 && owners![0].id !== id) return undo(ALREADY, 409, { status: 'already_linked' })

      console.log(JSON.stringify({ evt: 'express-create', ok: true, id, rivhit_id: t.r }))
      return json({ ok: true, login_email: loginEmail })
    }

    // ---------------------------------------------------------- admin
    if (body.action === 'admin_list' || body.action === 'admin_revoke' || body.action === 'admin_set_password') {
      const mgr = await managerId(req, admin)
      if (!mgr) return json({ error: 'להנהלה בלבד' }, 403)
      const all = await expressUsers(admin)

      if (body.action === 'admin_list') {
        const ids = all.map((u) => u.id)
        const cards = [...new Set(all.map((u) => u.express.rivhit_id))]
        const [{ data: profs, error: pe }, { data: cs, error: ce }] = await Promise.all([
          ids.length ? admin.from('profiles').select('id,full_name,business_name,phone,rivhit_customer_id').in('id', ids) : Promise.resolve({ data: [], error: null }),
          cards.length ? admin.from('customers').select('rivhit_id,name').in('rivhit_id', cards) : Promise.resolve({ data: [], error: null }),
        ])
        if (pe || ce) return json({ error: TRY_AGAIN }, 500)
        const pById = new Map((profs ?? []).map((p: Record<string, unknown>) => [p.id as string, p]))
        const cName = new Map((cs ?? []).map((c: Record<string, unknown>) => [c.rivhit_id as number, c.name as string]))
        const rows = all.map((u) => {
          const p = pById.get(u.id) as Record<string, unknown> | undefined
          return {
            id: u.id,
            full_name: (p?.full_name as string) || '',
            business_name: (p?.business_name as string) || '',
            phone: (p?.phone as string) || '',
            linked_to: (p?.rivhit_customer_id as number | null) ?? null,
            card: u.express.rivhit_id,
            card_name: cName.get(u.express.rivhit_id) || '',
            at: u.express.at,
            revoked: !!u.express.revoked,
          }
        }).sort((a, b) => b.at.localeCompare(a.at))
        return json({ rows })
      }

      const target = all.find((u) => u.id === body.user_id)
      if (!target) return json({ error: 'החשבון לא נמצא ברשימה.' }, 404)

      if (body.action === 'admin_set_password') {
        if (!isAcceptablePassword(body.password)) return json({ error: 'הסיסמה צריכה להיות באורך 6 תווים לפחות.' }, 400)
        const { error: sErr } = await admin.auth.admin.updateUserById(target.id, { password: body.password as string })
        if (sErr) return json({ error: TRY_AGAIN }, 500)
        console.log(JSON.stringify({ evt: 'express-set-password', id: target.id, by: mgr }))
        return json({ ok: true })
      }

      const { error: rErr } = await admin.from('profiles')
        .update({ rivhit_customer_id: null, discount_percent: 0, agent_user_id: null, agent_source: null, agent_assigned_at: null, business_name: '' })
        .eq('id', target.id)
      if (rErr) return json({ error: TRY_AGAIN }, 500)
      const { error: mErr } = await admin.auth.admin.updateUserById(target.id, {
        app_metadata: { ...(target.app_metadata || {}), express: { ...target.express, revoked: true, revoked_at: new Date().toISOString(), revoked_by: mgr } },
      })
      if (mErr) return json({ error: TRY_AGAIN }, 500)
      console.log(JSON.stringify({ evt: 'express-revoke', id: target.id, card: target.express.rivhit_id, by: mgr }))
      return json({ ok: true })
    }

    return json({ error: 'בקשה לא תקינה' }, 400)
  } catch (e) {
    console.log(JSON.stringify({ evt: 'express-error', msg: String((e as Error)?.message ?? e).slice(0, 160) }))
    return json({ error: TRY_AGAIN }, 500)
  }
})
