// inventory-sync/db.ts — the Supabase-backed `Db` for engine.ts.
//
// Runs with the SERVICE ROLE client (RLS gives authenticated users SELECT
// only; the sync writes as the service role, exactly as the contract says).
// Every status change is a CONDITIONAL update:
//
//   .update(patch).eq('id', id).eq('sync_status', expected).select('id')
//
// and 0 rows back means "someone else changed it first" — the engine then
// backs off. That is what makes a double approve / double click / two tabs
// safe: two runs can never both own one line, so never both send its document.
//
// Columns and CHECK values follow supabase/2026-11-inventory-count.sql and
// CONTRACT.md Addendum 1 (rivhit_baseline_qty / rivhit_baseline_at on lines,
// product_edit_requests.rivhit_before, sync_status 'skipped'). The sync never
// touches inventory_counts.version, counted_qty or baseline_qty; mode is
// written only while it is still null.
//
// No Deno APIs; the client is duck-typed so this file has no import.

import type {
  CountRow, CountStatus, Db, EditPatch, EditRow, EditStatus, EventIn, LinePatch, LineRow, Mode, Settings, SyncStatus,
} from './engine.ts'

// deno-lint-ignore no-explicit-any
type Sb = any

const LINE_COLS =
  'id,count_id,product_id,rivhit_id,product_name,counted_qty,baseline_qty,sync_status,sync_ref,rivhit_before_qty,' +
  'delta,rivhit_doc_type,rivhit_doc_number,rivhit_after_qty,attempts,last_error,synced_at,' +
  'rivhit_baseline_qty,rivhit_baseline_at,version'
const EDIT_COLS =
  'id,product_id,rivhit_id,old_name,new_name,old_barcode,new_barcode,old_sku,new_sku,status,attempts,last_error,rivhit_before'

const DEFAULT_SETTINGS: Settings = {
  rivhit_writes_enabled: false,
  rivhit_customer_id: null,
  rivhit_last_name: 'ספירת מלאי',
  doc_type_in: 11,
  doc_type_out: 10,
}

function fail(where: string, error: { message?: string; code?: string } | null): never {
  // PostgREST messages carry table/column names only — no row data.
  throw new Error(`${where}: ${error?.code ?? ''} ${error?.message ?? 'unknown db error'}`.slice(0, 300))
}

/** `triggeredBy` = the manager whose request started this run. Events are
 *  written as the system (actor null, per the migration) with
 *  detail.triggered_by = that manager. */
export function supabaseDb(admin: Sb, triggeredBy: string | null): Db {
  return {
    async getCount(countId) {
      const { data, error } = await admin.from('inventory_counts')
        .select('id,status,storage_id,storage_name,mode,version').eq('id', countId).maybeSingle()
      if (error) fail('getCount', error)
      return (data as CountRow | null) ?? null
    },

    async setCountMode(countId: string, mode: Mode) {
      const { data, error } = await admin.from('inventory_counts')
        .update({ mode }).eq('id', countId).is('mode', null).select('id')
      if (error) fail('setCountMode', error)
      return Array.isArray(data) && data.length > 0
    },

    async getLine(lineId: string) {
      const { data, error } = await admin.from('inventory_count_lines').select(LINE_COLS).eq('id', lineId).maybeSingle()
      if (error) fail('getLine', error)
      return (data as LineRow | null) ?? null
    },

    async setLineBaseline(lineId: string, expectedVersion: number, patch: { rivhit_baseline_qty: number; rivhit_baseline_at: string }) {
      const { data, error } = await admin.from('inventory_count_lines')
        .update(patch).eq('id', lineId).eq('version', expectedVersion).select('id')
      if (error) fail('setLineBaseline', error)
      return Array.isArray(data) && data.length > 0
    },

    async getProductStock(productId: string) {
      const { data, error } = await admin.from('products').select('stock_quantity').eq('id', productId).maybeSingle()
      if (error) fail('getProductStock', error)
      const n = data?.stock_quantity
      return n == null ? null : Number(n)
    },

    async findDuplicateCode(productId: string, requestId: string, code: string) {
      // Codes are validated by inv_request_item_edit; re-check before the
      // value goes into a PostgREST filter.
      if (!/^[0-9A-Za-z-]{1,15}$/.test(code)) return 'INVALID_CODE'
      const { data: prods, error: e1 } = await admin.from('products').select('name')
        .neq('id', productId).eq('is_active', true).or(`sku.eq.${code},barcode.eq.${code}`).limit(1)
      if (e1) fail('findDuplicateCode.products', e1)
      if (Array.isArray(prods) && prods.length) return String(prods[0].name ?? '')
      const { data: reqs, error: e2 } = await admin.from('product_edit_requests').select('id,new_name')
        .neq('id', requestId).in('status', ['pending', 'in_progress', 'unknown'])
        .or(`new_sku.eq.${code},new_barcode.eq.${code}`).limit(1)
      if (e2) fail('findDuplicateCode.requests', e2)
      if (Array.isArray(reqs) && reqs.length) return String(reqs[0].new_name ?? 'בקשה פתוחה')
      return null
    },

    async setCountStatus(countId: string, to: CountStatus, from: CountStatus[], extra?: { finished_at?: string | null }) {
      const patch: Record<string, unknown> = { status: to }
      if (extra && 'finished_at' in extra) patch.finished_at = extra.finished_at ?? null
      const { data, error } = await admin.from('inventory_counts')
        .update(patch).eq('id', countId).in('status', from).select('id')
      if (error) fail('setCountStatus', error)
      return Array.isArray(data) && data.length > 0
    },

    async getSettings() {
      const { data, error } = await admin.from('inventory_settings')
        .select('rivhit_writes_enabled,rivhit_customer_id,rivhit_last_name,doc_type_in,doc_type_out').eq('id', 1).maybeSingle()
      if (error) fail('getSettings', error)
      return { ...DEFAULT_SETTINGS, ...(data || {}) } as Settings
    },

    async listLines(countId) {
      const { data, error } = await admin.from('inventory_count_lines')
        .select(LINE_COLS).eq('count_id', countId).order('product_name').order('id')
      if (error) fail('listLines', error)
      return (data as LineRow[]) || []
    },

    async claimLine(lineId: string, from: SyncStatus, expectedRef: string | null, patch: LinePatch) {
      let q = admin.from('inventory_count_lines').update(patch).eq('id', lineId).eq('sync_status', from)
      q = expectedRef == null ? q.is('sync_ref', null) : q.eq('sync_ref', expectedRef)
      const { data, error } = await q.select(LINE_COLS)
      if (error) fail('claimLine', error)
      return Array.isArray(data) && data.length ? (data[0] as LineRow) : null
    },

    async setLine(lineId: string, expected: SyncStatus, patch: LinePatch) {
      const { data, error } = await admin.from('inventory_count_lines')
        .update(patch).eq('id', lineId).eq('sync_status', expected).select('id')
      if (error) fail('setLine', error)
      return Array.isArray(data) && data.length > 0
    },

    async logEvent(ev: EventIn) {
      const { error } = await admin.from('inventory_events').insert({
        actor: null, count_id: ev.count_id ?? null, product_id: ev.product_id ?? null, kind: ev.kind,
        detail: { ...(ev.detail ?? {}), triggered_by: triggeredBy },
      })
      if (error) fail('logEvent', error)
    },

    async updateProductStock(productId: string, qty: number) {
      const { data, error } = await admin.from('products')
        .update({ stock_quantity: qty }).eq('id', productId).select('id')
      if (error) fail('updateProductStock', error)
      if (!Array.isArray(data) || !data.length) throw new Error('updateProductStock: product not found')
    },

    async getEdit(requestId) {
      const { data, error } = await admin.from('product_edit_requests').select(EDIT_COLS).eq('id', requestId).maybeSingle()
      if (error) fail('getEdit', error)
      return (data as EditRow | null) ?? null
    },

    async claimEdit(requestId: string, from: EditStatus, patch: EditPatch) {
      const { data, error } = await admin.from('product_edit_requests')
        .update(patch).eq('id', requestId).eq('status', from).select(EDIT_COLS)
      if (error) fail('claimEdit', error)
      return Array.isArray(data) && data.length ? (data[0] as EditRow) : null
    },

    async setEdit(requestId: string, expected: EditStatus, patch: EditPatch) {
      const { data, error } = await admin.from('product_edit_requests')
        .update(patch).eq('id', requestId).eq('status', expected).select('id')
      if (error) fail('setEdit', error)
      return Array.isArray(data) && data.length > 0
    },

    async updateProductFields(productId: string, fields: { name?: string; barcode?: string | null; sku?: string | null }) {
      const patch: Record<string, unknown> = {}
      if (fields.name != null) patch.name = fields.name
      if (fields.barcode !== undefined) patch.barcode = fields.barcode ?? ''
      if (fields.sku != null) patch.sku = fields.sku
      const { data, error } = await admin.from('products').update(patch).eq('id', productId).select('id')
      if (error) fail('updateProductFields', error)
      if (!Array.isArray(data) || !data.length) throw new Error('updateProductFields: product not found')
    },
  }
}

/** Simulation seed: Rivhit's "current" quantity for each line = the site's
 *  products.stock_quantity now (what rivhit-sync last copied), so simulation
 *  shows real differences and real `changed` lines. Read-only. */
export async function loadSimSeedForCount(admin: Sb, lines: LineRow[]): Promise<Map<number, number>> {
  const ids = [...new Set(lines.map((l) => l.product_id))]
  const out = new Map<number, number>()
  for (const l of lines) out.set(l.rivhit_id, l.baseline_qty)
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await admin.from('products').select('id,rivhit_id,stock_quantity').in('id', ids.slice(i, i + 150))
    if (error) fail('loadSimSeed', error)
    for (const p of data || []) {
      if (p.rivhit_id != null && Number.isFinite(Number(p.stock_quantity))) out.set(Number(p.rivhit_id), Number(p.stock_quantity))
    }
  }
  return out
}

/** Simulation seed for an item edit: the site's own copy of the item. */
export async function loadSimItem(admin: Sb, productId: string) {
  const { data, error } = await admin.from('products').select('rivhit_id,name,sku,barcode,stock_quantity').eq('id', productId).maybeSingle()
  if (error) fail('loadSimItem', error)
  if (!data || data.rivhit_id == null) return null
  return {
    item_id: Number(data.rivhit_id),
    item_name: String(data.name ?? ''),
    item_part_num: data.sku ?? null,
    barcode: data.barcode ?? null,
    quantity: Number(data.stock_quantity ?? 0),
  }
}
