// Rivhit write path + order notifications.
// Rivhit writes (create-only, never update/delete): Customer.New, Document.New
// (הצעת מחיר, type 6, non-accounting), Document.Send (best-effort).
// Customer matching priority: VAT number → phone → email → normalized name;
// only when nothing matches is a new customer card created.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const BASE = 'https://api.rivhit.co.il/online/RivhitOnlineAPI.svc'
const ORDER_DOC_TYPE = 6 // הצעת מחיר
const MANAGER_EMAIL = 'orikenen.b@gmail.com'
const digits = (s: string) => (s || '').replace(/\D/g, '')
const validVat = (s: string) => { const d = digits(s); return d.length >= 8 && d.length <= 9 && d !== '0'.repeat(d.length) ? d : '' }
const normName = (s: string) =>
  (s || '')
    .replace(/["'׳״`‘’“”.,()\-_/\\\[\]]/g, ' ')
    .replace(/\b(בעמ|בע מ|חבעמ|עוסק מורשה|ltd|inc)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  let body: any = {}
  try { body = await req.json() } catch { /* */ }
  const action = body.action as string

  const { data: tok, error: tokErr } = await admin.rpc('_get_rivhit_token')
  if (tokErr || !tok) return json({ error: 'no Rivhit token' }, 400)

  async function rivhit(path: string, payload: any) {
    const r = await fetch(`${BASE}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ api_token: tok, ...payload }),
    })
    const t = await r.text()
    try { return JSON.parse(t) } catch {
      throw new Error(`${path}: HTTP ${r.status}: ${t.replace(/</g, '[').slice(0, 200)}`)
    }
  }

  async function notifyManager(subject: string, message: string) {
    try {
      await fetch(`https://formsubmit.co/ajax/${MANAGER_EMAIL}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ _subject: subject, הודעה: message, _template: 'box' }),
      })
    } catch (_) { /* never blocks an order */ }
  }

  async function callerId(): Promise<{ uid: string | null; isManager: boolean }> {
    const auth = req.headers.get('authorization') || ''
    const jwt = auth.replace(/^Bearer\s+/i, '')
    if (!jwt) return { uid: null, isManager: false }
    const { data } = await admin.auth.getUser(jwt)
    const uid = data?.user?.id ?? null
    if (!uid) return { uid: null, isManager: false }
    const { data: p } = await admin.from('profiles').select('role').eq('id', uid).maybeSingle()
    return { uid, isManager: p?.role === 'manager' }
  }

  async function resolveRivhitCustomer(userId: string, dryRun = false): Promise<{ id: number | null; how: string }> {
    const { data: prof } = await admin.from('profiles')
      .select('rivhit_customer_id,business_name,full_name,phone,email,vat_number').eq('id', userId).maybeSingle()
    if (!prof) throw new Error('profile missing')
    if (prof.rivhit_customer_id) return { id: prof.rivhit_customer_id, how: 'linked' }

    const { data: cands } = await admin.from('customers')
      .select('rivhit_id,name,phone,email,vat_number').eq('is_active', true).limit(5000)
    const list = cands ?? []
    let match: number | null = null
    let how = ''
    // 1) VAT number — the strongest identifier
    const vat = validVat(prof.vat_number || '')
    if (vat) {
      const hit = list.find((c: any) => validVat(c.vat_number || '') === vat)
      if (hit) { match = hit.rivhit_id; how = 'vat' }
    }
    // 2) phone
    if (!match) {
      const ph = digits(prof.phone || '')
      if (ph.length >= 9) {
        const hit = list.find((c: any) => digits(c.phone).endsWith(ph.slice(-9)))
        if (hit) { match = hit.rivhit_id; how = 'phone' }
      }
    }
    // 3) email
    if (!match && (prof.email || '').trim()) {
      const em = prof.email.toLowerCase().trim()
      const hit = list.find((c: any) => (c.email || '').toLowerCase().trim() === em)
      if (hit) { match = hit.rivhit_id; how = 'email' }
    }
    // 4) normalized business/full name
    if (!match) {
      for (const source of [prof.business_name, prof.full_name]) {
        const n = normName(source || '')
        if (n.length < 4) continue
        const hit = list.find((c: any) => normName(c.name) === n)
        if (hit) { match = hit.rivhit_id; how = 'name'; break }
      }
    }
    if (match) {
      if (!dryRun) await admin.from('profiles').update({ rivhit_customer_id: match }).eq('id', userId)
      return { id: match, how }
    }
    if (dryRun) return { id: null, how: 'would_create' }

    const bizName = (prof.business_name || '').trim()
    const fullName = (prof.full_name || '').trim()
    const j = await rivhit('Customer.New', {
      last_name: bizName || fullName || (prof.email || 'לקוח אתר'),
      first_name: bizName && fullName ? fullName : '',
      address: '', city: '',
      phone: prof.phone || '', email: prof.email || '',
      vat_number: vat ? Number(vat) : undefined,
      comments: 'נוצר אוטומטית מאתר כרם טויס',
    })
    if (j?.error_code !== 0) throw new Error(`Customer.New: ${j?.client_message || j?.error_code}`)
    const newId = Number(j?.data?.customer_id)
    if (!newId) throw new Error('Customer.New returned no id')
    await admin.from('customers').upsert({
      rivhit_id: newId, name: bizName || fullName, phone: prof.phone || '',
      email: (prof.email || '').toLowerCase(), vat_number: vat, is_active: true,
    }, { onConflict: 'rivhit_id' })
    await admin.from('profiles').update({ rivhit_customer_id: newId }).eq('id', userId)
    return { id: newId, how: 'created' }
  }

  try {
    if (action === 'create_customer') {
      const { isManager } = await callerId()
      if (!isManager) return json({ error: 'manager only' }, 403)
      const c = body.customer || {}
      const j = await rivhit('Customer.New', {
        last_name: c.last_name || '', first_name: c.first_name || '',
        address: c.address || '', city: c.city || '',
        phone: c.phone || '', email: c.email || '',
        vat_number: c.vat_number ?? undefined,
        comments: c.comments || 'לקוח אתר כרם טויס',
      })
      if (j?.error_code !== 0) return json({ error: `Rivhit: ${j?.client_message || j?.error_code}` }, 400)
      return json({ ok: true, customer_id: j?.data?.customer_id ?? null, raw: j?.data })
    }

    if (action === 'resolve_test') {
      const { isManager } = await callerId()
      if (!isManager) return json({ error: 'manager only' }, 403)
      const res = await resolveRivhitCustomer(body.user_id as string, true)
      return json({ ok: true, ...res })
    }

    if (action === 'notify_test') {
      const { isManager } = await callerId()
      if (!isManager) return json({ error: 'manager only' }, 403)
      await notifyManager('בדיקת התראות — כרם טויס', 'זוהי הודעת בדיקה. אם קיבלת — ההתראות עובדות!')
      return json({ ok: true })
    }

    if (action === 'send_doc') {
      const { isManager } = await callerId()
      if (!isManager) return json({ error: 'manager only' }, 403)
      const j = await rivhit('Document.Send', {
        document_type: Number(body.document_type) || ORDER_DOC_TYPE,
        document_number: Number(body.document_number),
        email: (body.email as string) || MANAGER_EMAIL,
      })
      if (j?.error_code !== 0) return json({ error: `Rivhit: ${j?.client_message || j?.error_code}` }, 400)
      return json({ ok: true })
    }

    if (action === 'push_order') {
      const orderId = body.order_id as string
      if (!orderId) return json({ error: 'missing order_id' }, 400)
      const { uid, isManager } = await callerId()
      if (!uid) return json({ error: 'not signed in' }, 401)

      const { data: order } = await admin.from('orders')
        .select('id,user_id,total,note,business_name,contact_name,contact_phone,contact_email,rivhit_doc_id')
        .eq('id', orderId).maybeSingle()
      if (!order) return json({ error: 'order not found' }, 404)
      if (order.user_id !== uid && !isManager) return json({ error: 'forbidden' }, 403)
      if (order.rivhit_doc_id) return json({ ok: true, already: true, doc_id: order.rivhit_doc_id })

      const { data: items } = await admin.from('order_items')
        .select('product_name,unit_price,quantity,product_id,products(rivhit_id)')
        .eq('order_id', orderId)
      if (!items || items.length === 0) return json({ error: 'order has no items' }, 400)

      const itemsText = items.map((it: any) => `• ${it.product_name} × ${it.quantity} — ₪${(Number(it.unit_price) * Number(it.quantity)).toFixed(2)}`).join('\n')

      let resolved: { id: number | null; how: string } | null = null
      let pushError = ''
      let docId: number | null = null
      try {
        resolved = await resolveRivhitCustomer(order.user_id)
      } catch (e) {
        pushError = String((e as Error)?.message ?? e)
      }

      if (resolved?.id) {
        const docItems = items.map((it: any) => ({
          item_id: Number(it.products?.rivhit_id) || 0,
          quantity: Number(it.quantity) || 1,
          price_nis: Number(it.unit_price) || 0,
          description: String(it.product_name || '').slice(0, 100),
        }))
        try {
          const j = await rivhit('Document.New', {
            document_type: ORDER_DOC_TYPE,
            customer_id: resolved.id,
            comments: ('הזמנה מאתר כרם טויס' + (order.note ? ' — ' + order.note : '')).slice(0, 200),
            items: docItems,
          })
          if (j?.error_code !== 0) {
            pushError = String(j?.client_message || j?.error_code)
          } else {
            docId = Number(j?.data?.document_number ?? j?.data?.document_id) || null
            await admin.from('orders').update({
              rivhit_doc_id: docId,
              rivhit_doc_link: j?.data?.document_link ?? '',
              rivhit_pushed_at: new Date().toISOString(),
              rivhit_error: null,
            }).eq('id', orderId)
          }
        } catch (e) {
          pushError = String((e as Error)?.message ?? e)
        }
      }
      if (pushError) {
        await admin.from('orders').update({ rivhit_error: pushError }).eq('id', orderId)
      }

      const subject = `🧸 הזמנה חדשה — ${order.business_name || order.contact_name || 'לקוח'} — ₪${Number(order.total).toFixed(2)}`
      const msg = [
        `עסק: ${order.business_name || '—'}`,
        `איש קשר: ${order.contact_name || '—'} | טלפון: ${order.contact_phone || '—'} | אימייל: ${order.contact_email || '—'}`,
        '',
        itemsText,
        '',
        `סה״כ: ₪${Number(order.total).toFixed(2)}`,
        order.note ? `הערה: ${order.note}` : '',
        docId ? `✅ נקלט ברווחית — הצעת מחיר #${docId}` : `⚠️ לא נקלט ברווחית: ${pushError || 'לקוח לא מקושר'}`,
        '',
        'לניהול: https://orikenenb-lgtm.github.io/kerem-orders/admin',
      ].filter(Boolean).join('\n')
      await notifyManager(subject, msg)

      if (docId) return json({ ok: true, doc_id: docId, customer_id: resolved!.id, matched_by: resolved!.how })
      return json({ error: pushError || 'push failed', notified: true }, 400)
    }

    return json({ error: 'unknown action' }, 400)
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500)
  }
})
