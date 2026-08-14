import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const BASE = 'https://api.rivhit.co.il/online/RivhitOnlineAPI.svc'
const EXCLUDE_NAME = /נ[י]?גמר/
const EXCLUDE_IDS = new Set<number>([999])

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* */ }
  const mode = (body.mode as string) || 'dryrun'
  const what = (body.what as string) || 'both'

  // v8 auth gate: the function used to be callable by anyone. Now a call must
  // carry either the scheduler's shared secret (vault: sync_trigger_secret,
  // sent by the pg_cron jobs) or a logged-in MANAGER's JWT (the admin
  // "עדכן עכשיו" button).
  let allowed = false
  const { data: secret } = await admin.rpc('_get_sync_secret')
  if (secret && typeof body.key === 'string' && body.key === secret) allowed = true
  if (!allowed) {
    const auth = req.headers.get('authorization') || ''
    const jwt = auth.replace(/^Bearer\s+/i, '')
    if (jwt) {
      const { data: u } = await admin.auth.getUser(jwt)
      const uid = u?.user?.id
      if (uid) {
        const { data: prof } = await admin.from('profiles').select('role').eq('id', uid).maybeSingle()
        if (prof?.role === 'manager') allowed = true
      }
    }
  }
  if (!allowed) return json({ error: 'unauthorized' }, 401)

  const { data: tok, error: tokErr } = await admin.rpc('_get_rivhit_token')
  if (tokErr || !tok) return json({ error: 'no Rivhit token in vault' }, 400)
  const { data: run, error: runErr } = await admin.from('rivhit_sync_runs').insert({ mode, what, status: 'running' }).select('id').single()
  if (runErr) return json({ error: runErr.message }, 400)
  const runId = run!.id as string

  async function rivhit(path: string) {
    const r = await fetch(`${BASE}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify({ api_token: tok }) })
    const txt = await r.text()
    try { return JSON.parse(txt) } catch { throw new Error(`${path}: HTTP ${r.status}: ${txt.slice(0,150)}`) }
  }
  async function upsertAll(table: string, rows: any[], conflict: string) {
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await admin.from(table).upsert(rows.slice(i, i + 500), { onConflict: conflict })
      if (error) throw new Error(`${table} upsert @${i}: ${error.message}`)
    }
  }

  const work = (async () => {
    const summary: any = {}
    try {
      const nowIso = new Date().toISOString()

      if (what === 'products' || what === 'both') {
        const groupName = new Map<number, string>()
        const excluded = new Set<number>(EXCLUDE_IDS)
        try {
          const g = await rivhit('Item.Groups')
          const gl: any[] = (g?.data && g.data.item_group_list) || []
          for (const x of gl) {
            const nm = String(x.item_group_name || '').trim()
            groupName.set(x.item_group_id, nm)
            if (EXCLUDE_NAME.test(nm)) excluded.add(x.item_group_id)
          }
        } catch (_) { /* fall back to EXCLUDE_IDS */ }
        summary.excluded_groups = [...excluded]

        const j = await rivhit('Item.List')
        if (j?.error_code !== 0) throw new Error(`Item.List error_code ${j?.error_code}: ${j?.client_message}`)
        const items: any[] = (j.data && j.data.item_list) || []
        const rows = items
          .filter((it) => it.item_id > 0 && (it.item_name || '').trim() && Number(it.sale_nis) > 0 && !excluded.has(it.item_group_id))
          .map((it) => ({
            rivhit_id: it.item_id,
            name: String(it.item_name).trim(),
            description: (it.item_extended_description || '').trim(),
            price: Number(it.sale_nis) || 0,
            sku: (String(it.item_part_num || '').trim() || String(it.barcode || '').trim()) || null,
            barcode: String(it.barcode || '').trim(),
            group_id: it.item_group_id ?? null,
            category: groupName.get(it.item_group_id) || '',
            stock_quantity: Number(it.quantity) || 0,
            picture_link: (it.picture_link || '').trim(),
            emoji: '🧸', in_stock: true, is_active: true, updated_at: nowIso,
          }))
        const { count: existing } = await admin.from('products').select('rivhit_id', { count: 'exact', head: true }).not('rivhit_id', 'is', null)
        if (rows.length === 0 && (existing || 0) > 0) throw new Error('Item.List returned 0 sellable while DB has products — aborting to avoid wipe')
        if (mode === 'sync') {
          await upsertAll('products', rows, 'rivhit_id')
          await admin.from('products').update({ is_active: false }).lt('updated_at', nowIso).not('rivhit_id', 'is', null)
        }
        summary.products = { from_rivhit: items.length, synced: rows.length, hidden_groups: [...excluded], mode }
      }

      if (what === 'customers' || what === 'both') {
        const j = await rivhit('Customer.List')
        if (j?.error_code !== 0) throw new Error(`Customer.List error_code ${j?.error_code}: ${j?.client_message}`)
        const cs: any[] = (j.data && j.data.customer_list) || []
        const rows = cs
          .filter((c) => c.customer_id > 0 && [c.first_name, c.last_name].filter(Boolean).join(' ').trim())
          .map((c) => ({
            rivhit_id: c.customer_id,
            name: [c.first_name, c.last_name].filter(Boolean).join(' ').trim(),
            city: (c.city || '').trim(), phone: String(c.phone || '').trim(),
            email: String(c.email || '').toLowerCase().trim(),
            vat_number: String(c.vat_number ?? '').replace(/\D/g, ''),
            price_list_id: c.price_list_id ?? null, discount_percent: Number(c.discount_percent) || 0,
            is_active: true, updated_at: nowIso,
          }))
        if (mode === 'sync' && rows.length > 0) {
          await upsertAll('customers', rows, 'rivhit_id')
          await admin.from('customers').update({ is_active: false }).lt('updated_at', nowIso).not('rivhit_id', 'is', null)
        }
        summary.customers = { from_rivhit: cs.length, synced: rows.length, mode }
      }

      await admin.from('rivhit_sync_runs').update({ status: 'done', summary, finished_at: new Date().toISOString() }).eq('id', runId)
    } catch (e) {
      await admin.from('rivhit_sync_runs').update({ status: 'error', error: String((e as Error)?.message ?? e), summary, finished_at: new Date().toISOString() }).eq('id', runId)
    }
  })()
  // @ts-ignore
  EdgeRuntime.waitUntil(work)
  return json({ run_id: runId })
})
