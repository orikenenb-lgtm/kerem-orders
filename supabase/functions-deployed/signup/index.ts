import { createClient } from 'jsr:@supabase/supabase-js@2'

// The owner's email is auto-promoted to manager on signup.
const MANAGER_EMAIL = 'orikenen.b@gmail.com'

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  try {
    const {
      email, password, full_name, business_name, phone, vat_number,
      city, street, house_number, zip_code, delivery_notes,
    } = await req.json()
    if (!email || !password) return json({ error: 'חסר אימייל או סיסמה' }, 400)
    if (String(password).length < 6) return json({ error: 'הסיסמה חייבת להכיל לפחות 6 תווים' }, 400)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const cleanEmail = String(email).trim().toLowerCase()
    const cleanVat = String(vat_number ?? '').replace(/\D/g, '')
    const role = cleanEmail === MANAGER_EMAIL ? 'manager' : 'customer'
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
