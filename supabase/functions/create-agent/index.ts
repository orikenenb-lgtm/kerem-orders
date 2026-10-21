// create-agent — the manager opens an agent account directly (no customer
// signup first). Mirror of the deployed function (mcdchalyzeqjkkgfeznd).
//
// Who may call it: a logged-in MANAGER only. verify_jwt is ON (the gateway
// rejects calls without a valid JWT) and the function then checks the
// caller's profile role itself — the JWT proves who, the role proves may.
//
// What it does:
//   1. creates an already-confirmed auth user (email + the initial password
//      the manager chose), exactly like public signup does, so the agent can
//      log in immediately with no email step;
//   2. writes the profile with role 'agent' and the manager's discount cap.
// If step 2 fails, the auth user created in step 1 — and only that one — is
// removed again, so a half-made account never lingers.
//
// The Rivhit agent number is NOT set here. The page calls
// set_agent_rivhit_number() right after, as the manager, so the mapping and
// the automatic customer assignment go through the one audited RPC that
// already enforces "one number, one account".
//
// Response: { ok: true, id } or { error: "<Hebrew message>" }.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const clean = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max)
const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // ---- who is calling
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return json({ error: 'לא מחוברים למערכת' }, 401)
  const { data: who } = await admin.auth.getUser(jwt)
  const callerId = who?.user?.id
  if (!callerId) return json({ error: 'לא מחוברים למערכת' }, 401)
  const { data: caller } = await admin.from('profiles').select('role').eq('id', callerId).maybeSingle()
  if (caller?.role !== 'manager') return json({ error: 'להנהלה בלבד' }, 403)

  // ---- what to create
  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { return json({ error: 'בקשה לא תקינה' }, 400) }
  const fullName = clean(body.full_name, 120)
  const phone = clean(body.phone, 30)
  const email = clean(body.email, 200).toLowerCase()
  const password = String(body.password ?? '')
  const cap = Number(body.max_discount_percent)

  if (!fullName) return json({ error: 'חסר שם הסוכן' }, 400)
  if (!isEmail(email)) return json({ error: 'כתובת האימייל אינה תקינה' }, 400)
  if (password.length < 6) return json({ error: 'הסיסמה חייבת להכיל לפחות 6 תווים' }, 400)
  if (!Number.isFinite(cap) || cap < 0 || cap > 100) return json({ error: 'תקרת ההנחה חייבת להיות בין 0 ל-100' }, 400)

  // ---- 1. the login
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, phone, created_as: 'agent', created_by: callerId },
  })
  if (cErr || !created?.user) {
    const msg = /already.*registered|exist/i.test(cErr?.message || '')
      ? 'האימייל הזה כבר רשום באתר. אם זה הסוכן — פתחו את הכרטיס שלו ב״לקוחות״ ולחצו ״הפיכה לסוכן״.'
      : 'יצירת החשבון נכשלה — לא נוצר כלום.'
    return json({ error: msg }, 400)
  }
  const id = created.user.id

  // ---- 2. the profile, as an agent
  const { error: pErr } = await admin.from('profiles').upsert({
    id,
    email,
    full_name: fullName,
    business_name: '',
    phone,
    role: 'agent',
    max_discount_percent: Math.round(cap * 100) / 100,
  })
  if (pErr) {
    // Undo step 1 — this exact user, created a moment ago in this request.
    await admin.auth.admin.deleteUser(id)
    return json({ error: 'יצירת הסוכן נכשלה — לא נוצר כלום.' }, 400)
  }

  console.log(JSON.stringify({ evt: 'create-agent', by: callerId, id }))
  return json({ ok: true, id })
})
