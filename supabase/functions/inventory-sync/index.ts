// inventory-sync — writes a manager's approved stock count (ספירת מלאי) and
// item-detail edits to Rivhit. NOT DEPLOYED. Spec: docs/inventory/CONTRACT.md.
// Runbook (env, modes, first live test, rollback): ./README.md.
//
// Who may call it: a logged-in MANAGER only. The JWT proves who; the role is
// then read server-side from profiles with the service client (as
// create-agent does). Anyone else gets 401/403 before any work.
//
// Mode (decided here, per request, never by the client):
//   live        only if env INVENTORY_RIVHIT_MODE=live AND
//               inventory_settings.rivhit_writes_enabled AND
//               inventory_settings.rivhit_customer_id is set;
//   simulation  otherwise — an in-memory fake Rivhit (no external call at
//               all), no write to products, document numbers SIM-…, the count
//               is marked mode='simulation'.
//
// Actions (POST JSON {action, ...}):
//   status                                   → {mode, writes_enabled, configured, storages}
//   sync_count {count_id, include_unknown?, retry_failed?, max_lines?, check_only?}
//   apply_item_edit {request_id}
//   capture_baseline {line_id, expected_version}  → {ok, rivhit_baseline_qty, rivhit_baseline_at}
//
// Errors: {ok:false, error:<CODE>, message:<Hebrew>} with a 4xx/5xx status.
// Logs: one JSON line per request — action, mode, outcome, timings, counts.
// Never the token, never the JWT, never a product name or a request body.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { type Mode, type Rivhit, applyItemEdit, captureBaseline, checkCount, syncCount } from './engine.ts'
import { fetchRivhitToken, liveRivhit, simulatedRivhit } from './rivhit.ts'
import { loadSimItem, loadSimSeedForCount, supabaseDb } from './db.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const MESSAGES: Record<string, [number, string]> = {
  INV_NOT_FOUND: [404, 'הרשומה לא נמצאה'],
  INV_BAD_STATUS: [409, 'המצב הנוכחי אינו מאפשר את הפעולה'],
  INV_MODE_MISMATCH: [409, 'הספירה הזאת עודכנה במצב סימולציה ואי אפשר להמשיך אותה במצב אמיתי (או להפך). יש לפתוח ספירה חדשה.'],
  INV_NOT_CONFIGURED: [400, 'העדכון לרווחית לא הוגדר (הרשאה או כרטיס לקוח חסרים)'],
  INV_CONFLICT: [409, 'תהליך אחר מעדכן את הרשומה הזאת כרגע — נסו שוב בעוד רגע'],
  INV_BAD_REQUEST: [400, 'בקשה לא תקינה'],
  INV_NO_TOKEN: [500, 'חסר מפתח API של רווחית בשרת'],
  INV_STORAGE_REQUIRED: [409, 'ברווחית יש יותר ממחסן אחד — יש לפתוח ספירה עם מחסן מוגדר. לא נשלח דבר.'],
  INV_RIVHIT_UNAVAILABLE: [502, 'אין תקשורת עם רווחית כרגע — נסו שוב בעוד דקה. לא נשלח דבר.'],
  INV_BAD_QUANTITY: [409, 'הכמות ברווחית אינה מספר שלם — יש לטפל בפריט ידנית'],
}
function errorResponse(code: string, extra: Record<string, unknown> = {}) {
  const key = code.split(':')[0]
  const [status, message] = MESSAGES[key] ?? [500, 'שגיאה פנימית — נסו שוב']
  return json({ ok: false, error: code, message, ...extra }, status)
}

function log(fields: Record<string, unknown>) {
  console.log(JSON.stringify({ evt: 'inventory-sync', ...fields }))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ ok: false, error: 'METHOD', message: 'method not allowed' }, 405)
  const started = Date.now()

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // ---- who is calling
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return json({ ok: false, error: 'AUTH', message: 'לא מחוברים למערכת' }, 401)
  const { data: who } = await admin.auth.getUser(jwt)
  const callerId = who?.user?.id
  if (!callerId) return json({ ok: false, error: 'AUTH', message: 'לא מחוברים למערכת' }, 401)
  const { data: caller } = await admin.from('profiles').select('role').eq('id', callerId).maybeSingle()
  if (caller?.role !== 'manager') return json({ ok: false, error: 'FORBIDDEN', message: 'להנהלה בלבד' }, 403)

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { return errorResponse('INV_BAD_REQUEST') }
  const action = String(body.action ?? '')

  const db = supabaseDb(admin, callerId)
  let mode: Mode = 'simulation'
  try {
    const settings = await db.getSettings()
    const envLive = Deno.env.get('INVENTORY_RIVHIT_MODE') === 'live'
    const configured = !!settings.rivhit_customer_id
    mode = envLive && settings.rivhit_writes_enabled && configured ? 'live' : 'simulation'

    let token = ''
    if (mode === 'live') {
      token = await fetchRivhitToken(admin)
      if (!token) return errorResponse('INV_NO_TOKEN')
    }
    const live = (): Rivhit => liveRivhit({ token })

    // ---------------- status
    if (action === 'status') {
      let storages: { storage_id: number | null; storage_name: string }[] = [{ storage_id: null, storage_name: 'מחסן ראשי (סימולציה)' }]
      let storages_error: string | undefined
      if (mode === 'live') {
        const r = await live().storageList()
        if (r.kind === 'ok') storages = r.data
        else { storages = []; storages_error = r.kind }
      }
      log({ action, mode, outcome: 'ok', ms: Date.now() - started })
      return json({ ok: true, mode, writes_enabled: settings.rivhit_writes_enabled, configured, storages, storages_error })
    }

    // ---------------- sync_count
    if (action === 'sync_count') {
      const countId = String(body.count_id ?? '')
      if (!UUID.test(countId)) return errorResponse('INV_BAD_REQUEST')
      const maxLinesRaw = body.max_lines == null ? undefined : Number(body.max_lines)
      if (maxLinesRaw !== undefined && !(Number.isInteger(maxLinesRaw) && maxLinesRaw >= 1 && maxLinesRaw <= 5000)) {
        return errorResponse('INV_BAD_REQUEST')
      }
      let rivhit: Rivhit
      if (mode === 'live') rivhit = live()
      else {
        const seedLines = await db.listLines(countId)
        rivhit = simulatedRivhit({
          quantities: await loadSimSeedForCount(admin, seedLines),
          docTypeIn: settings.doc_type_in, docTypeOut: settings.doc_type_out,
        })
      }
      const deps = { db, rivhit }

      if (body.check_only === true) {
        const r = await checkCount(deps, countId, { mode, maxLines: maxLinesRaw ?? 1 })
        log({ action, mode, check_only: true, outcome: r.ok ? 'ok' : r.error, n: r.results.length, ms: Date.now() - started })
        if (!r.ok) return errorResponse(r.error!)
        return json({ ok: true, mode, check_only: true, results: r.results })
      }

      const budget = Number(Deno.env.get('INVENTORY_SYNC_BUDGET_MS')) || 110_000
      const r = await syncCount(deps, countId, {
        mode,
        includeUnknown: body.include_unknown === true,
        retryFailed: body.retry_failed === true,
        maxLines: maxLinesRaw,
        deadline: started + budget,
      })
      log({
        action, mode, count: countId, outcome: r.ok ? 'ok' : r.error, stopped: r.stopped, processed: r.processed,
        recovered: r.recovered, lost: r.lost_claims, by_status: r.by_status, count_status: r.count_status, ms: Date.now() - started,
      })
      if (!r.ok) return errorResponse(r.error!)
      return json(r)
    }

    // ---------------- apply_item_edit
    if (action === 'apply_item_edit') {
      const requestId = String(body.request_id ?? '')
      if (!UUID.test(requestId)) return errorResponse('INV_BAD_REQUEST')
      let rivhit: Rivhit
      if (mode === 'live') rivhit = live()
      else {
        const reqRow = await db.getEdit(requestId)
        const item = reqRow ? await loadSimItem(admin, reqRow.product_id) : null
        rivhit = simulatedRivhit({ items: item ? [item] : [] })
      }
      const r = await applyItemEdit({ db, rivhit }, requestId, { mode })
      log({ action, mode, outcome: r.ok ? r.status : r.error, ms: Date.now() - started })
      if (!r.ok) return errorResponse(r.error!)
      return json({ ...r, mode })
    }

    // ---------------- capture_baseline (Addendum R3)
    if (action === 'capture_baseline') {
      const lineId = String(body.line_id ?? '')
      const expected = Number(body.expected_version)
      if (!UUID.test(lineId) || !Number.isInteger(expected) || expected < 1) return errorResponse('INV_BAD_REQUEST')
      // Simulation reads products.stock_quantity through the Db; no Rivhit.
      const rivhit = mode === 'live' ? live() : simulatedRivhit({})
      const r = await captureBaseline({ db, rivhit }, lineId, expected, { mode })
      log({ action, mode, outcome: r.ok ? 'ok' : r.error, ms: Date.now() - started })
      if (!r.ok) return errorResponse(r.error!, r.message ? { detail: r.message } : {})
      return json({ ok: true, mode, rivhit_baseline_qty: r.rivhit_baseline_qty, rivhit_baseline_at: r.rivhit_baseline_at })
    }

    return errorResponse('INV_BAD_REQUEST')
  } catch (e) {
    // Only the error class name is logged: DB/HTTP messages may hold values.
    log({ action, mode, outcome: 'exception', kind: (e as Error)?.name ?? 'Error', ms: Date.now() - started })
    return errorResponse('INTERNAL')
  }
})
