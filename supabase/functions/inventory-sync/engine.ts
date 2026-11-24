// inventory-sync/engine.ts — the PURE sync logic for the manager-only stock
// count (ספירת מלאי). No Deno APIs, no network, no Supabase: everything the
// engine touches comes in through the two injected interfaces below (`Db`,
// `Rivhit`), so landing/tests/inventorySync.test.mjs runs it in plain node with
// an in-memory Db and a scriptable fake Rivhit.
//
// Binding spec: docs/inventory/CONTRACT.md ("Edge function inventory-sync").
//
// The invariants this file exists to keep (each one has a test):
//   * sync_ref (Rivhit request_reference) is persisted BEFORE any Document.New,
//     and so are the before-quantity, delta and doc type the document will use.
//   * A line in `sent` (or one that has a doc number) never gets a second
//     Document.New — it is only re-verified and updated locally.
//   * Timeout / network on Document.New → `unknown`, never retried in the same
//     run. A resend happens only on an explicit include_unknown run, with the
//     SAME sync_ref, the SAME payload and prevent_duplicates:true, so Rivhit
//     answers -107 instead of making a second document.
//   * sync_ref is cleared only when it is CERTAIN no document exists for it
//     (`failed`, `changed`, `no_change`).
//   * One item per document. A count of 300 differences makes 300 small
//     documents — each line succeeds or fails on its own, a resend can never
//     duplicate a neighbour, and the payload is far below 64 KB.
//   * Simulation mode never writes `products` (the engine never calls
//     updateProductStock / updateProductFields unless mode === 'live'); the
//     caller hands in a fake Rivhit so nothing leaves the server.

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export type Mode = 'live' | 'simulation'
export type CountStatus = 'draft' | 'approved' | 'syncing' | 'done' | 'needs_attention' | 'cancelled'
export type SyncStatus =
  | 'pending' | 'in_progress' | 'sent' | 'done' | 'no_change' | 'unknown' | 'failed' | 'changed' | 'skipped'
export type EditStatus = 'pending' | 'in_progress' | 'done' | 'failed' | 'unknown'

export interface CountRow {
  id: string
  status: CountStatus
  storage_id: number | null
  storage_name?: string | null
  mode: Mode | null
  version?: number
}

export interface LineRow {
  id: string
  count_id: string
  product_id: string
  rivhit_id: number
  product_name: string
  counted_qty: number
  /** The site copy at save time — display only, never compared (Addendum R3). */
  baseline_qty: number
  /** Rivhit's own quantity, captured by capture_baseline right after the
   *  save. THE comparison baseline. null = never captured → `changed`. */
  rivhit_baseline_qty: number | null
  rivhit_baseline_at?: string | null
  version?: number
  sync_status: SyncStatus
  sync_ref: string | null
  rivhit_before_qty: number | null
  delta: number | null
  rivhit_doc_type: number | null
  rivhit_doc_number: string | null
  rivhit_after_qty: number | null
  attempts: number
  last_error: string | null
  /** Last sync activity on the line. The claim sets it, so for an
   *  `in_progress` line it is the claim time (used by stale recovery). */
  synced_at: string | null
}

export interface Settings {
  rivhit_writes_enabled: boolean
  rivhit_customer_id: number | null
  rivhit_last_name: string
  doc_type_in: number
  doc_type_out: number
}

export interface EditRow {
  id: string
  product_id: string
  rivhit_id: number
  old_name: string | null
  new_name: string | null
  old_barcode: string | null
  new_barcode: string | null
  old_sku: string | null
  new_sku: string | null
  status: EditStatus
  attempts: number
  last_error: string | null
  /** The COMPLETE Item.List record read before the first Item.Update (R6). */
  rivhit_before: RivhitItem | null
}

export interface EventIn {
  kind: string
  count_id?: string | null
  product_id?: string | null
  detail?: Record<string, unknown>
}

export type LinePatch = Partial<Omit<LineRow, 'id' | 'count_id' | 'product_id'>>
export type EditPatch = Partial<Pick<EditRow, 'status' | 'attempts' | 'last_error' | 'rivhit_before'>> & { finished_at?: string | null }

/** Everything the engine needs from the database. All writes that change a
 *  status are CONDITIONAL: they return false / null when the row was not in
 *  the expected state (someone else owns it), and the engine then backs off. */
export interface Db {
  getCount(countId: string): Promise<CountRow | null>
  /** Conditional: only when the current status is in `from`. */
  setCountStatus(
    countId: string,
    to: CountStatus,
    from: CountStatus[],
    extra?: { finished_at?: string | null },
  ): Promise<boolean>
  /** Conditional: sets mode only while it is still null. */
  setCountMode(countId: string, mode: Mode): Promise<boolean>
  getLine(lineId: string): Promise<LineRow | null>
  /** Conditional on the line's version (capture_baseline). */
  setLineBaseline(lineId: string, expectedVersion: number, patch: { rivhit_baseline_qty: number; rivhit_baseline_at: string }): Promise<boolean>
  /** products.stock_quantity (simulation baseline only). */
  getProductStock(productId: string): Promise<number | null>
  /** Another ACTIVE product whose sku or barcode equals `code`, or another
   *  OPEN edit request (pending/in_progress/unknown) whose new_sku or
   *  new_barcode equals it. Returns a display name / marker, or null. */
  findDuplicateCode(productId: string, requestId: string, code: string): Promise<string | null>
  getSettings(): Promise<Settings>
  listLines(countId: string): Promise<LineRow[]>
  /** Atomic claim: status `from` → `in_progress` and sync_ref still equal to
   *  `expectedRef` (null = still empty). Writes `patch` in the same update.
   *  Returns the updated row, or null when the claim was lost. */
  claimLine(lineId: string, from: SyncStatus, expectedRef: string | null, patch: LinePatch): Promise<LineRow | null>
  /** Conditional update on the current sync_status. */
  setLine(lineId: string, expected: SyncStatus, patch: LinePatch): Promise<boolean>
  logEvent(ev: EventIn): Promise<void>
  updateProductStock(productId: string, qty: number): Promise<void>
  getEdit(requestId: string): Promise<EditRow | null>
  claimEdit(requestId: string, from: EditStatus, patch: EditPatch): Promise<EditRow | null>
  setEdit(requestId: string, expected: EditStatus, patch: EditPatch): Promise<boolean>
  updateProductFields(productId: string, fields: { name?: string; barcode?: string | null; sku?: string | null }): Promise<void>
}

// ---- Rivhit adapter results ----

export type RivhitResult<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'rivhit_error'; code: number; message: string }
  | { kind: 'already_processed'; code: -107; message: string; data?: unknown }
  | { kind: 'rate_limited'; message: string }
  | { kind: 'timeout'; message: string }
  | { kind: 'network'; message: string }

export interface DocItem { item_id: number; quantity: number; storage_id?: number }
export interface DocPayload {
  document_type: number
  customer_id: number
  last_name: string
  comments: string
  items: DocItem[]
  send_mail: false
  prevent_duplicates: true
  request_reference: string
  check_only?: boolean
}
export interface DocResult { document_type?: number; document_number?: number | string | null }

/** An item as Item.List returns it (only the documented fields we use). */
export interface RivhitItem {
  item_id: number
  item_name: string
  item_part_num?: string | null
  barcode?: string | null
  item_extended_description?: string | null
  item_group_id?: number | null
  storage_id?: number | null
  quantity?: number | null
  cost_nis?: number | null
  sale_nis?: number | null
  currency_id?: number | null
  cost_mtc?: number | null
  sale_mtc?: number | null
  exempt_vat?: boolean | null
  location?: string | null
  sapak?: number | null
  item_name_en?: string | null
  [k: string]: unknown
}

export interface Rivhit {
  itemQuantity(itemId: number, storageId?: number | null): Promise<RivhitResult<{ quantity: number }>>
  documentNew(payload: DocPayload): Promise<RivhitResult<DocResult>>
  /** Full current record via Item.List; data null = no such item. */
  itemGet(itemId: number): Promise<RivhitResult<RivhitItem | null>>
  itemUpdate(payload: Record<string, unknown>): Promise<RivhitResult<{ update_success?: boolean }>>
  storageList(): Promise<RivhitResult<{ storage_id: number; storage_name: string }[]>>
}

export interface EngineDeps {
  db: Db
  rivhit: Rivhit
  now?: () => Date
  newId?: () => string
}

export interface SyncOpts {
  mode: Mode
  /** Also claim `unknown` lines and resend with the SAME sync_ref. */
  includeUnknown?: boolean
  /** Also claim `failed` lines (no document exists for them; fresh ref). */
  retryFailed?: boolean
  /** Process at most this many lines (the first live test uses 1). */
  maxLines?: number
  /** Absolute epoch ms. No new line is claimed after it; the rest stay
   *  `pending` and the next call resumes. */
  deadline?: number
  /** An `in_progress` line whose claim is older than this is recovered. */
  staleMinutes?: number
}

export const DEFAULT_STALE_MINUTES = 10
export const MAX_PAYLOAD_BYTES = 65_536
export const RIVHIT_ALREADY_PROCESSED = -107

// ---------------------------------------------------------------------------
// Response classification (pure; rivhit.ts calls it on every HTTP answer)
// ---------------------------------------------------------------------------

/** Rivhit sometimes puts the specific code only in debug_message
 *  ("-24 : ITEM_NOT_EXISTS" with error_code 500), so read both. */
export function specificCode(body: { error_code?: unknown; debug_message?: unknown }): number | null {
  const dm = typeof body.debug_message === 'string' ? body.debug_message.match(/^\s*(-?\d+)\s*:/) : null
  if (dm) return Number(dm[1])
  const ec = Number(String(body.error_code ?? '').replace(/[^\d-]/g, ''))
  return Number.isFinite(ec) && String(body.error_code ?? '').trim() !== '' ? ec : null
}

export function classifyRivhitResponse<T = unknown>(httpStatus: number, text: string): RivhitResult<T> {
  if (httpStatus === 429) return { kind: 'rate_limited', message: 'HTTP 429' }
  let body: any = null
  try { body = JSON.parse(text) } catch { /* not JSON */ }
  if (!body || typeof body !== 'object') {
    // 400 / 413: the request was rejected before processing (unparseable or
    // too large) — certain that nothing was made. Anything else (a 502/504
    // from a gateway, a 200 with garbage) is NOT certain.
    if (httpStatus === 400 || httpStatus === 413) {
      return { kind: 'rivhit_error', code: httpStatus, message: `HTTP ${httpStatus}` }
    }
    return { kind: 'network', message: `HTTP ${httpStatus}: non-JSON response` }
  }
  const ec = String(body.error_code ?? '').replace(/[^\d-]/g, '')
  const code = specificCode(body)
  const dbg = typeof body.debug_message === 'string' ? body.debug_message : ''
  if (code === RIVHIT_ALREADY_PROCESSED || /REQUEST_ALREADY_PROCESSED/i.test(dbg)) {
    return {
      kind: 'already_processed', code: -107,
      message: String(body.client_message || 'כבר בוצעה בקשה עם אותו מזהה בקשה'), data: body.data,
    }
  }
  if (/RATE.?LIMIT|TOO.?MANY.?REQUESTS/i.test(dbg)) {
    return { kind: 'rate_limited', message: String(body.client_message || dbg) }
  }
  if (ec === '0' && httpStatus < 400) return { kind: 'ok', data: (body.data ?? null) as T }
  if (ec === '' && httpStatus >= 500) return { kind: 'network', message: `HTTP ${httpStatus}` }
  return {
    kind: 'rivhit_error',
    code: code ?? httpStatus,
    message: String(body.client_message || dbg || `HTTP ${httpStatus}`).slice(0, 300),
  }
}

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

export function byteLength(s: string): number {
  return new TextEncoder().encode(s).length
}

export function shortId(id: string): string {
  return String(id).replace(/-/g, '').slice(0, 8)
}

export function buildDocPayload(args: {
  countId: string
  rivhitId: number
  delta: number
  storageId: number | null
  syncRef: string
  settings: Settings
  checkOnly?: boolean
}): DocPayload {
  const { delta, settings } = args
  if (!Number.isInteger(delta) || delta === 0) throw new Error('delta must be a non-zero integer')
  const item: DocItem = { item_id: args.rivhitId, quantity: Math.abs(delta) }
  if (args.storageId != null) item.storage_id = args.storageId
  const p: DocPayload = {
    document_type: delta > 0 ? settings.doc_type_in : settings.doc_type_out,
    customer_id: settings.rivhit_customer_id ?? 0,
    last_name: (settings.rivhit_last_name || 'ספירת מלאי').slice(0, 30),
    comments: `ספירת מלאי ${shortId(args.countId)}`,
    items: [item],
    send_mail: false,
    prevent_duplicates: true,
    request_reference: args.syncRef,
  }
  if (args.checkOnly) p.check_only = true
  return p
}

/** Roll-up per contract: all done/no_change/skipped → done; any unknown/failed/
 *  changed → needs_attention; otherwise syncing. */
export function rollupStatus(lines: Pick<LineRow, 'sync_status'>[]): CountStatus {
  const finished = (s: SyncStatus) => s === 'done' || s === 'no_change' || s === 'skipped'
  if (lines.length > 0 && lines.every((l) => finished(l.sync_status))) return 'done'
  if (lines.some((l) => l.sync_status === 'unknown' || l.sync_status === 'failed' || l.sync_status === 'changed')) {
    return 'needs_attention'
  }
  return 'syncing'
}

function errText(r: { kind: string; message?: string; code?: number }): string {
  const m = (r.message || '').slice(0, 300)
  switch (r.kind) {
    case 'timeout': return 'פג הזמן בתקשורת עם רווחית — לא ידוע אם המסמך נוצר'
    case 'network': return `תקלת תקשורת עם רווחית — לא ידוע אם המסמך נוצר (${m})`
    case 'rate_limited': return 'רווחית הגבילה את קצב הבקשות — יש להמשיך בעוד דקה'
    default: return m || `שגיאת רווחית ${r.code ?? ''}`.trim()
  }
}

function defaultUuid(): string {
  const c = (globalThis as any).crypto
  if (c?.randomUUID) return c.randomUUID()
  throw new Error('no crypto.randomUUID available')
}

// ---------------------------------------------------------------------------
// sync_count
// ---------------------------------------------------------------------------

export type StopReason = 'rate_limited' | 'network' | 'time_budget' | 'max_lines' | null

export interface SyncSummary {
  ok: boolean
  error?: string
  count_id: string
  mode: Mode
  count_status?: CountStatus
  stopped?: StopReason
  processed: number
  recovered: number
  lost_claims: number
  by_status: Record<string, number>
  remaining: number
}

type LineOutcome = { stop?: 'rate_limited' | 'network' }

/** Live only: a count without a warehouse is allowed only when Rivhit has
 *  at most one storage (otherwise Rivhit's default storage would silently
 *  receive the documents). Returns an error code, or null when fine. */
async function storageGuard(rivhit: Rivhit, count: CountRow): Promise<string | null> {
  if (count.storage_id != null) return null
  const r = await rivhit.storageList()
  if (r.kind !== 'ok') return `INV_RIVHIT_UNAVAILABLE:${r.kind}`
  return r.data.length > 1 ? 'INV_STORAGE_REQUIRED' : null
}

export async function syncCount(deps: EngineDeps, countId: string, opts: SyncOpts): Promise<SyncSummary> {
  const { db, rivhit } = deps
  const now = deps.now ?? (() => new Date())
  const newId = deps.newId ?? defaultUuid
  const mode = opts.mode
  const base: SyncSummary = {
    ok: false, count_id: countId, mode, processed: 0, recovered: 0, lost_claims: 0, by_status: {}, remaining: 0,
  }
  const log = async (ev: EventIn) => {
    try { await db.logEvent({ count_id: countId, ...ev, detail: { mode, ...(ev.detail || {}) } }) } catch { /* history is best-effort; never changes a sync outcome */ }
  }

  const count = await db.getCount(countId)
  if (!count) return { ...base, error: 'INV_NOT_FOUND' }
  if (!['approved', 'syncing', 'needs_attention'].includes(count.status)) {
    return { ...base, error: `INV_BAD_STATUS:${count.status}` }
  }
  // A count is synced in ONE mode for its whole life: lines finished in a
  // simulation are skipped by later runs, so letting a simulated count go
  // live would silently leave Rivhit unchanged for them.
  if (count.mode && count.mode !== mode) return { ...base, error: `INV_MODE_MISMATCH:${count.mode}` }

  const settings = await db.getSettings()
  if (mode === 'live' && (!settings.rivhit_writes_enabled || !settings.rivhit_customer_id)) {
    return { ...base, error: 'INV_NOT_CONFIGURED' }
  }

  if (mode === 'live') {
    const st = await storageGuard(rivhit, count)
    if (st) return { ...base, error: st }
  }
  // mode is written once, only while still null; a lost race re-reads it.
  if (!count.mode && !(await db.setCountMode(countId, mode))) {
    const again = await db.getCount(countId)
    if (!again || again.mode !== mode) return { ...base, error: `INV_MODE_MISMATCH:${again?.mode ?? ''}` }
  }
  const moved = await db.setCountStatus(countId, 'syncing', ['approved', 'syncing', 'needs_attention'])
  if (!moved) return { ...base, error: 'INV_CONFLICT' }
  await log({ kind: 'sync_started', detail: { include_unknown: !!opts.includeUnknown, retry_failed: !!opts.retryFailed } })

  const storageId = count.storage_id ?? null
  let lines = await db.listLines(countId)

  // ---- recovery of lines left in_progress by a run that died ----
  // An edge-function run cannot live longer than a few minutes, so a claim
  // older than staleMinutes belongs to a dead run. Such a line is NEVER sent
  // again blindly: with a doc number it goes back to `sent` (verify only);
  // without one it becomes `unknown` (only an explicit include_unknown run
  // touches it, and that resend reuses the same sync_ref with
  // prevent_duplicates, so Rivhit refuses a second document with -107).
  const staleMs = (opts.staleMinutes ?? DEFAULT_STALE_MINUTES) * 60_000
  let recovered = 0
  for (const l of lines) {
    if (l.sync_status !== 'in_progress') continue
    const claimedAt = l.synced_at ? Date.parse(l.synced_at) : NaN
    if (Number.isFinite(claimedAt) && now().getTime() - claimedAt < staleMs) continue
    const to: SyncStatus = l.rivhit_doc_number ? 'sent' : 'unknown'
    const ok = await db.setLine(l.id, 'in_progress', {
      sync_status: to,
      last_error: 'התהליך נקטע באמצע — השורה תיבדק מול רווחית ולא תישלח שוב בלי בדיקה',
    })
    if (ok) {
      recovered++
      await log({ kind: 'line_recovered', product_id: l.product_id, detail: { line_id: l.id, to } })
    }
  }
  if (recovered) lines = await db.listLines(countId)

  const claimable = (s: SyncStatus): boolean =>
    s === 'pending' || s === 'sent' || (s === 'unknown' && !!opts.includeUnknown) || (s === 'failed' && !!opts.retryFailed)

  let processed = 0
  let lost = 0
  let stopped: StopReason = null

  for (const pre of lines) {
    if (!claimable(pre.sync_status)) continue
    if (opts.maxLines != null && processed >= opts.maxLines) { stopped = 'max_lines'; break }
    if (opts.deadline != null && now().getTime() >= opts.deadline) { stopped = 'time_budget'; break }

    // A failed line is certain to have no document, so it starts over with a
    // fresh reference; every other state keeps the reference it has.
    const fresh = pre.sync_status === 'failed' || !pre.sync_ref
    const claimed = await db.claimLine(pre.id, pre.sync_status, pre.sync_ref, {
      sync_status: 'in_progress',
      sync_ref: fresh ? newId() : pre.sync_ref,
      attempts: (pre.attempts || 0) + 1,
      synced_at: now().toISOString(),
      ...(pre.sync_status === 'failed' ? { delta: null, rivhit_before_qty: null, rivhit_doc_type: null } : {}),
    })
    if (!claimed) { lost++; continue }
    processed++
    let outcome: LineOutcome = {}
    try {
      outcome = await processLine({ db, rivhit, now, log, mode, settings, storageId, countId }, pre, claimed)
    } catch (e) {
      // A bug or a DB failure mid-line. Leave the line in_progress: the stale
      // recovery above turns it into `unknown`/`sent` later — never resent.
      await log({ kind: 'line_error', product_id: pre.product_id, detail: { line_id: pre.id, error: String(e).slice(0, 200) } })
      outcome = { stop: 'network' }
    }
    if (outcome.stop) { stopped = outcome.stop; break }
  }

  const final = await rollup(db, countId, now)
  const byStatus: Record<string, number> = {}
  for (const l of final.lines) byStatus[l.sync_status] = (byStatus[l.sync_status] || 0) + 1
  const remaining = final.lines.filter((l) => claimable(l.sync_status) || l.sync_status === 'in_progress').length
  await log({ kind: stopped && stopped !== 'max_lines' ? 'sync_stopped' : 'sync_finished', detail: { stopped, processed, by_status: byStatus, count_status: final.status } })
  return {
    ok: true, count_id: countId, mode, count_status: final.status, stopped, processed,
    recovered, lost_claims: lost, by_status: byStatus, remaining,
  }
}

async function rollup(db: Db, countId: string, now: () => Date): Promise<{ status: CountStatus; lines: LineRow[] }> {
  // Two runs can finish together; re-read after writing so the last writer
  // always leaves the status its own final read justifies.
  let lines = await db.listLines(countId)
  let status = rollupStatus(lines)
  for (let i = 0; i < 3; i++) {
    await db.setCountStatus(countId, status, ['approved', 'syncing', 'needs_attention'], {
      finished_at: status === 'done' ? now().toISOString() : null,
    })
    lines = await db.listLines(countId)
    const again = rollupStatus(lines)
    if (again === status) break
    status = again
  }
  return { status, lines }
}

interface LineCtx {
  db: Db
  rivhit: Rivhit
  now: () => Date
  log: (ev: EventIn) => Promise<void>
  mode: Mode
  settings: Settings
  storageId: number | null
  countId: string
}

async function processLine(ctx: LineCtx, pre: LineRow, line: LineRow): Promise<LineOutcome> {
  const { db, rivhit, log } = ctx
  const ev = (kind: string, detail: Record<string, unknown> = {}) =>
    log({ kind, product_id: line.product_id, detail: { line_id: line.id, rivhit_id: line.rivhit_id, ...detail } })
  const set = (patch: LinePatch) => db.setLine(line.id, 'in_progress', { synced_at: ctx.now().toISOString(), ...patch })

  // ---- (3) A sent line: verify + local update only. Never a new document.
  if (pre.sync_status === 'sent' || line.rivhit_doc_number) {
    if (line.rivhit_before_qty == null || line.delta == null) {
      await set({ sync_status: 'unknown', last_error: 'חסרים נתוני המסמך לבדיקה — יש לבדוק ידנית ברווחית' })
      await ev('line_unknown', { reason: 'sent_without_delta' })
      return {}
    }
    return verifyAndFinish(ctx, line, line.rivhit_before_qty + line.delta, ev, set)
  }

  // A Document.New may already exist for this line's reference when an
  // earlier attempt persisted its before/delta/type and then lost the answer.
  // (Every fresh attempt writes those three BEFORE it calls Document.New.)
  const docMayExist = pre.sync_status !== 'failed' && !!pre.sync_ref && pre.delta != null && pre.delta !== 0 &&
    pre.rivhit_before_qty != null && pre.rivhit_doc_type != null
  const restore = (r: { kind: string; message?: string }) =>
    set({ sync_status: pre.sync_status === 'failed' ? 'pending' : pre.sync_status, last_error: errText(r) })

  if (!Number.isInteger(line.rivhit_id) || line.rivhit_id <= 0) {
    await set({ sync_status: 'failed', sync_ref: docMayExist ? line.sync_ref : null, last_error: 'מזהה פריט ברווחית אינו תקין' })
    await ev('line_failed', { reason: 'bad_rivhit_id' })
    return {}
  }

  // ---- (4) current quantity
  const q = await rivhit.itemQuantity(line.rivhit_id, ctx.storageId)
  if (q.kind === 'rate_limited' || q.kind === 'timeout' || q.kind === 'network') {
    // Only a read failed: nothing was written in this attempt. Put the line
    // back where it was and stop — the next call resumes from here.
    await restore(q)
    await ev('line_released', { reason: q.kind })
    return { stop: q.kind === 'rate_limited' ? 'rate_limited' : 'network' }
  }
  if (q.kind !== 'ok') {
    const msg = errText(q)
    if (docMayExist) {
      await set({ sync_status: 'unknown', last_error: msg })
      await ev('line_unknown', { reason: 'read_error', code: (q as any).code })
    } else {
      await set({ sync_status: 'failed', sync_ref: null, last_error: msg })
      await ev('line_failed', { reason: 'read_error', code: (q as any).code })
    }
    return {}
  }
  const current = Number(q.data?.quantity)
  if (!Number.isInteger(current)) {
    const msg = `הכמות ברווחית אינה מספר שלם (${q.data?.quantity}) — יש לטפל ידנית`
    await set(docMayExist ? { sync_status: 'unknown', last_error: msg } : { sync_status: 'failed', sync_ref: null, last_error: msg })
    await ev(docMayExist ? 'line_unknown' : 'line_failed', { reason: 'non_integer_quantity' })
    return {}
  }

  let before: number
  let delta: number
  if (docMayExist) {
    // Resend path (include_unknown, or a line released by a rate limit after
    // its before/delta were persisted). Rivhit may already hold the document:
    // current must be either the old before (no doc) or before+delta (doc).
    before = pre.rivhit_before_qty as number
    delta = pre.delta as number
    // R1: Rivhit already shows the result → NEVER send again (Rivhit may not
    // remember the reference); verify and finish. Resend (same ref) only
    // when Rivhit still shows the quantity from before the attempt.
    if (current === before + delta) {
      await ev('resend_skipped_already_applied', { current, before, delta })
      return verifyAndFinish(ctx, { ...line, rivhit_before_qty: before, delta }, before + delta, ev, set)
    }
    if (current !== before) {
      await set({
        sync_status: 'unknown',
        last_error: `המלאי ברווחית זז (${current}; לפני ${before}, צפוי אחרי ${before + delta}) — לא נשלח מסמך. יש לבדוק ברווחית אם קיים מסמך עם מזהה הבקשה`,
      })
      await ev('line_unknown', { reason: 'moved_since_attempt', current, before, delta })
      return {}
    }
  } else {
    // ---- (5) stock moved since the count → recount needed, no write.
    // The baseline is Rivhit's own quantity captured at save time (R3); the
    // site copy (baseline_qty) is never compared.
    if (line.rivhit_baseline_qty == null) {
      await set({ sync_status: 'changed', sync_ref: null, rivhit_before_qty: current, delta: null, rivhit_doc_type: null,
        last_error: 'לא נקלטה כמות רווחית בזמן הספירה — ספרו מחדש' })
      await ev('line_changed', { reason: 'no_rivhit_baseline', current })
      return {}
    }
    if (current !== line.rivhit_baseline_qty) {
      await set({ sync_status: 'changed', sync_ref: null, rivhit_before_qty: current, delta: null, rivhit_doc_type: null,
        last_error: `המלאי ברווחית השתנה מאז הספירה (${line.rivhit_baseline_qty} → ${current}) — יש לספור שוב` })
      await ev('line_changed', { baseline: line.rivhit_baseline_qty, current })
      return {}
    }
    before = current
    delta = line.counted_qty - current
    // ---- (6) delta 0 → no_change
    if (delta === 0) {
      if (ctx.mode === 'live') {
        try { await db.updateProductStock(line.product_id, current) } catch { /* rivhit-sync rewrites it within 15 min */ }
      }
      await set({ sync_status: 'no_change', sync_ref: null, rivhit_before_qty: current, delta: 0, rivhit_doc_type: null,
        rivhit_after_qty: current, last_error: null })
      await ev('line_no_change', { current })
      return {}
    }
    // Persist what the document WILL be before calling Rivhit. If the run
    // dies after this point the line is recoverable without a blind resend.
    const docType = delta > 0 ? ctx.settings.doc_type_in : ctx.settings.doc_type_out
    const ok = await set({ rivhit_before_qty: current, delta, rivhit_doc_type: docType, last_error: null })
    if (!ok) { await ev('line_lost', { stage: 'persist' }); return {} }
  }

  // ---- (6) Document.New — one item per document
  const payload = buildDocPayload({
    countId: ctx.countId, rivhitId: line.rivhit_id, delta, storageId: ctx.storageId,
    syncRef: line.sync_ref as string, settings: ctx.settings,
  })
  const q1 = payload.items[0].quantity
  if (!Number.isInteger(q1) || q1 <= 0 || byteLength(JSON.stringify(payload)) >= MAX_PAYLOAD_BYTES) {
    const msg = 'המסמך אינו תקין (כמות או גודל) — לא נשלח'
    await set(docMayExist ? { sync_status: 'unknown', last_error: msg } : { sync_status: 'failed', sync_ref: null, last_error: msg })
    await ev(docMayExist ? 'line_unknown' : 'line_failed', { reason: 'payload_invalid' })
    return {}
  }

  const r = await rivhit.documentNew(payload)
  // ---- (7) interpret
  if (r.kind === 'ok') {
    const num = r.data?.document_number
    const docNumber = num == null || num === '' ? null : String(num)
    await set({ sync_status: 'sent', rivhit_doc_number: docNumber, rivhit_doc_type: payload.document_type, last_error: null })
    await ev('doc_sent', { doc_type: payload.document_type, doc_number: docNumber, quantity: q1, delta, resend: docMayExist })
    // The document is durable in `sent` now. Take the line back for the
    // verify step; if another run grabbed it in between, that run verifies.
    const again = await db.claimLine(line.id, 'sent', line.sync_ref, { sync_status: 'in_progress', synced_at: ctx.now().toISOString() })
    if (!again) { await ev('line_lost', { stage: 'verify' }); return {} }
    return verifyAndFinish(ctx, { ...again, rivhit_doc_number: docNumber, rivhit_before_qty: before, delta }, before + delta, ev, set)
  }
  if (r.kind === 'already_processed') {
    const num = (r.data as any)?.document_number
    const docNumber = num == null || num === '' ? null : String(num)
    await ev('doc_already_processed', { doc_number: docNumber })
    if (docNumber) await set({ rivhit_doc_number: docNumber })
    const seen = { ...line, rivhit_doc_number: docNumber ?? line.rivhit_doc_number, rivhit_before_qty: before, delta }
    return verifyAndFinish(ctx, seen, before + delta, ev, set)
  }
  if (r.kind === 'timeout' || r.kind === 'network') {
    await set({ sync_status: 'unknown', last_error: errText(r) })
    await ev('line_unknown', { reason: r.kind })
    return { stop: 'network' }
  }
  if (r.kind === 'rate_limited') {
    // Refused before processing. Keep ref + before/delta: the next run takes
    // the resend path, which is safe whatever Rivhit actually did.
    await set({ sync_status: pre.sync_status === 'failed' ? 'pending' : pre.sync_status, last_error: errText(r) })
    await ev('line_released', { reason: 'rate_limited' })
    return { stop: 'rate_limited' }
  }
  // any other Rivhit error: no document was made by THIS call
  if (docMayExist) {
    await set({ sync_status: 'unknown', last_error: errText(r) })
    await ev('line_unknown', { reason: 'rivhit_error_on_resend', code: r.code })
  } else {
    await set({ sync_status: 'failed', sync_ref: null, last_error: errText(r) })
    await ev('line_failed', { code: r.code, message: r.message })
  }
  return {}
}

async function verifyAndFinish(
  ctx: LineCtx,
  line: LineRow,
  expectedAfter: number,
  ev: (kind: string, detail?: Record<string, unknown>) => Promise<void>,
  set: (patch: LinePatch) => Promise<boolean>,
): Promise<LineOutcome> {
  const { db, rivhit } = ctx
  // On a failed read the line waits in `sent` when we hold its doc number,
  // else in `unknown` (a later include_unknown run resends the same ref and
  // gets -107, then verifies again).
  const parkStatus: SyncStatus = line.rivhit_doc_number ? 'sent' : 'unknown'
  const q = await rivhit.itemQuantity(line.rivhit_id, ctx.storageId)
  if (q.kind !== 'ok') {
    await set({ sync_status: parkStatus, last_error: `המסמך נשלח; הבדיקה נכשלה: ${errText(q)}` })
    await ev('verify_failed', { reason: q.kind })
    if (q.kind === 'rate_limited') return { stop: 'rate_limited' }
    if (q.kind === 'timeout' || q.kind === 'network') return { stop: 'network' }
    return {}
  }
  const after = Number(q.data?.quantity)
  if (after !== expectedAfter) {
    await set({ sync_status: 'unknown', rivhit_after_qty: Number.isFinite(after) ? after : null,
      last_error: `אחרי המסמך צפוי ${expectedAfter} ברווחית אך נמצא ${q.data?.quantity} — יש לבדוק ידנית` })
    await ev('verify_mismatch', { expected: expectedAfter, found: q.data?.quantity })
    return {}
  }
  if (ctx.mode === 'live') {
    try {
      await db.updateProductStock(line.product_id, after)
    } catch (e) {
      // Rivhit is right; only the site copy lags. Stay `sent`: the next run
      // re-verifies and retries the local update — never a new document.
      await set({ sync_status: 'sent', rivhit_after_qty: after, last_error: 'עודכן ברווחית; עדכון המלאי באתר נכשל וינוסה שוב' })
      await ev('local_update_failed', { error: String(e).slice(0, 200) })
      return {}
    }
  }
  await set({ sync_status: 'done', rivhit_after_qty: after, last_error: null })
  await ev('line_done', { after, doc_number: line.rivhit_doc_number })
  return {}
}

// ---------------------------------------------------------------------------
// check_only preview (first live test) — never changes a line
// ---------------------------------------------------------------------------

export interface CheckResult {
  line_id: string
  rivhit_id: number
  current?: number
  delta?: number
  doc_type?: number
  outcome: string
  message?: string
}

/** Reads the current quantity and asks Rivhit to VALIDATE (check_only:true)
 *  the document each pending line would make. No line status, no sync_ref,
 *  no product is written; only an event is logged. */
export async function checkCount(
  deps: EngineDeps,
  countId: string,
  opts: { mode: Mode; maxLines?: number },
): Promise<{ ok: boolean; error?: string; results: CheckResult[] }> {
  const { db, rivhit } = deps
  const newId = deps.newId ?? defaultUuid
  const count = await db.getCount(countId)
  if (!count) return { ok: false, error: 'INV_NOT_FOUND', results: [] }
  if (!['approved', 'syncing', 'needs_attention'].includes(count.status)) {
    return { ok: false, error: `INV_BAD_STATUS:${count.status}`, results: [] }
  }
  if (count.mode && count.mode !== opts.mode) return { ok: false, error: `INV_MODE_MISMATCH:${count.mode}`, results: [] }
  const settings = await db.getSettings()
  if (opts.mode === 'live') {
    if (!settings.rivhit_writes_enabled || !settings.rivhit_customer_id) return { ok: false, error: 'INV_NOT_CONFIGURED', results: [] }
    const st = await storageGuard(rivhit, count)
    if (st) return { ok: false, error: st, results: [] }
  }
  const lines = (await db.listLines(countId)).filter((l) => l.sync_status === 'pending')
  const results: CheckResult[] = []
  for (const l of lines.slice(0, Math.max(0, opts.maxLines ?? 1))) {
    const q = await rivhit.itemQuantity(l.rivhit_id, count.storage_id)
    if (q.kind !== 'ok') { results.push({ line_id: l.id, rivhit_id: l.rivhit_id, outcome: q.kind, message: errText(q) }); continue }
    const current = Number(q.data?.quantity)
    if (l.rivhit_baseline_qty == null || current !== l.rivhit_baseline_qty) {
      results.push({ line_id: l.id, rivhit_id: l.rivhit_id, current, outcome: 'changed' }); continue
    }
    const delta = l.counted_qty - current
    if (delta === 0) { results.push({ line_id: l.id, rivhit_id: l.rivhit_id, current, delta, outcome: 'no_change' }); continue }
    const payload = buildDocPayload({
      countId, rivhitId: l.rivhit_id, delta, storageId: count.storage_id, syncRef: newId(), settings, checkOnly: true,
    })
    const r = await rivhit.documentNew(payload)
    results.push({
      line_id: l.id, rivhit_id: l.rivhit_id, current, delta, doc_type: payload.document_type,
      outcome: r.kind === 'ok' ? 'check_ok' : r.kind, message: r.kind === 'ok' ? undefined : errText(r),
    })
  }
  try { await db.logEvent({ kind: 'check_only', count_id: countId, detail: { mode: opts.mode, results } }) } catch { /* */ }
  return { ok: true, results }
}

// ---------------------------------------------------------------------------
// apply_item_edit
// ---------------------------------------------------------------------------

/** Item.Update field ← Item.List field. Same-named fields are documented on
 *  both methods; the three renamed ones are matched by their documented
 *  descriptions (location = "Item Storage Location", sapak = "Supplier
 *  Identifier of the Item", item_name_en = "Item Description (Foreign
 *  Language)"). */
export const ITEM_UPDATE_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ['item_name', 'item_name'],
  ['item_part_num', 'item_part_num'],
  ['barcode', 'barcode'],
  ['item_extended_description', 'item_extended_description'],
  ['item_group_id', 'item_group_id'],
  ['storage_id', 'storage_id'],
  ['cost_nis', 'cost_nis'],
  ['sale_nis', 'sale_nis'],
  ['currency_id', 'currency_id'],
  ['cost_mtc', 'cost_mtc'],
  ['sale_mtc', 'sale_mtc'],
  ['exempt_vat', 'exempt_vat'],
  ['item_name_english', 'item_name_en'],
  ['storage_location', 'location'],
  ['supplier_id', 'sapak'],
]

const normStr = (v: unknown): string => (v == null ? '' : String(v).trim())
export function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' || typeof b === 'number') {
    if ((a == null || a === '') && (b == null || b === '')) return true
    const x = Number(a), y = Number(b)
    return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) < 1e-9
  }
  if (typeof a === 'boolean' || typeof b === 'boolean') return Boolean(a) === Boolean(b)
  return normStr(a) === normStr(b)
}

export interface Intended { item_name: string; barcode: string | null; item_part_num: string | null }

/** The site's sku is `item_part_num || barcode` (rivhit-sync), so a request's
 *  old_sku is compared with this effective value (R7). */
export function effectiveSku(it: { item_part_num?: unknown; barcode?: unknown }): string {
  return normStr(it.item_part_num) || normStr(it.barcode)
}

/** product_edit_requests.new_* hold the FINAL intended values (a field the
 *  manager did not touch is copied from old_*, a cleared barcode is ''). A
 *  field counts as "changed by this request" only when new_* differs from
 *  old_*. */
export function requestedChanges(req: EditRow): { item_name: boolean; barcode: boolean; item_part_num: boolean } {
  return {
    item_name: req.new_name != null && !sameValue(req.new_name, req.old_name),
    barcode: req.new_barcode != null && !sameValue(req.new_barcode, req.old_barcode),
    item_part_num: req.new_sku != null && !sameValue(req.new_sku, req.old_sku),
  }
}

/** Target values relative to the snapshot: a changed field gets new_*, every
 *  other field keeps the snapshot's value. A sku edit always targets
 *  item_part_num — also when it was empty and the effective sku came from the
 *  barcode (R7). */
export function intendedValues(req: EditRow, snap: RivhitItem): Intended {
  const ch = requestedChanges(req)
  return {
    item_name: ch.item_name ? (req.new_name as string) : snap.item_name,
    barcode: ch.barcode ? (req.new_barcode as string) : (snap.barcode ?? null),
    item_part_num: ch.item_part_num ? (req.new_sku as string) : (snap.item_part_num ?? null),
  }
}

/** The full snapshot record with ONLY name / barcode / item_part_num replaced. */
export function buildItemUpdatePayload(snap: RivhitItem, intended: Intended, requestRef?: string): Record<string, unknown> {
  const p: Record<string, unknown> = { item_id: snap.item_id }
  for (const [upd, lst] of ITEM_UPDATE_FIELDS) {
    const v = snap[lst]
    if (v !== undefined && v !== null) p[upd] = v
  }
  p.item_name = intended.item_name
  if (intended.barcode != null) p.barcode = intended.barcode
  else delete p.barcode
  if (intended.item_part_num != null) p.item_part_num = intended.item_part_num
  else delete p.item_part_num
  if (requestRef) p.request_reference = requestRef
  return p
}

const TARGET_KEYS = ['item_name', 'barcode', 'item_part_num'] as const
/** Stock moves through documents, not Item.Update, and can change between
 *  the snapshot and the read-back (a sale) — the only field not compared. */
export const VOLATILE_ITEM_FIELDS: readonly string[] = ['quantity']

/** R6: every field of the snapshot must read back unchanged, except the
 *  three target fields, which must equal their targets. Returns the Item.List
 *  names of the fields that differ. */
export function diffAgainstSnapshot(snap: RivhitItem, targets: Intended, back: RivhitItem): string[] {
  const bad: string[] = []
  for (const k of Object.keys(snap)) {
    if (VOLATILE_ITEM_FIELDS.includes(k)) continue
    const expected = (TARGET_KEYS as readonly string[]).includes(k) ? (targets as any)[k] : snap[k]
    if (!sameValue(expected, back[k])) bad.push(k)
  }
  for (const k of TARGET_KEYS) if (!(k in snap) && !sameValue(targets[k], back[k])) bad.push(k)
  return bad
}

export interface EditSummary { ok: boolean; error?: string; request_id: string; status?: EditStatus; message?: string; mismatched?: string[] }

export async function applyItemEdit(deps: EngineDeps, requestId: string, opts: { mode: Mode }): Promise<EditSummary> {
  const { db, rivhit } = deps
  const now = deps.now ?? (() => new Date())
  const mode = opts.mode
  const req = await db.getEdit(requestId)
  if (!req) return { ok: false, error: 'INV_NOT_FOUND', request_id: requestId }
  if (req.status !== 'pending' && req.status !== 'unknown') {
    return { ok: false, error: `INV_BAD_STATUS:${req.status}`, request_id: requestId, status: req.status }
  }
  const log = async (kind: string, detail: Record<string, unknown> = {}) => {
    try { await db.logEvent({ kind, product_id: req.product_id, detail: { mode, request_id: requestId, ...detail } }) } catch { /* */ }
  }
  const claimed = await db.claimEdit(requestId, req.status, { status: 'in_progress', attempts: (req.attempts || 0) + 1 })
  if (!claimed) return { ok: false, error: 'INV_CONFLICT', request_id: requestId }
  const finish = async (status: EditStatus, last_error: string | null, extra: Partial<EditSummary> = {}): Promise<EditSummary> => {
    await db.setEdit(requestId, 'in_progress', {
      status, last_error, finished_at: status === 'done' || status === 'failed' ? now().toISOString() : null,
    })
    await log(`item_edit_${status}`, { last_error, ...(extra.mismatched ? { mismatched: extra.mismatched } : {}) })
    return { ok: true, request_id: requestId, status, message: last_error ?? undefined, ...extra }
  }
  const transient = (k: string) => k === 'rate_limited' || k === 'timeout' || k === 'network'
  const ch = requestedChanges(req)
  if (!ch.item_name && !ch.barcode && !ch.item_part_num) return finish('failed', 'הבקשה אינה משנה אף שדה')

  // (2) the full current record
  const g = await rivhit.itemGet(req.rivhit_id)
  if (transient(g.kind)) return finish(req.status, errText(g as any)) // nothing written; back where it was
  if (g.kind !== 'ok') return finish('failed', errText(g as any))
  const cur = g.data
  if (!cur) return finish('failed', 'הפריט לא נמצא ברווחית')

  // (R6) The snapshot is taken ONCE, before the first Item.Update, and every
  // later check (read-back, recheck of an `unknown`) compares against it.
  let snap = claimed.rivhit_before ?? req.rivhit_before ?? null
  if (!snap) {
    // First attempt. Someone changed a field in Rivhit after the request:
    // do not overwrite their change.
    const conflicts: string[] = []
    if (ch.item_name && !sameValue(cur.item_name, req.old_name) && !sameValue(cur.item_name, req.new_name)) conflicts.push('item_name')
    if (ch.barcode && !sameValue(cur.barcode, req.old_barcode) && !sameValue(cur.barcode, req.new_barcode)) conflicts.push('barcode')
    if (ch.item_part_num && !sameValue(effectiveSku(cur), req.old_sku) && !sameValue(effectiveSku(cur), req.new_sku)) conflicts.push('sku')
    if (conflicts.length) return finish('failed', `הפריט שונה ברווחית מאז הבקשה (${conflicts.join(', ')}) — לא עודכן`)
    snap = { ...cur }
    const saved = await db.setEdit(requestId, 'in_progress', { rivhit_before: snap })
    if (!saved) return { ok: false, error: 'INV_CONFLICT', request_id: requestId }
  }
  const targets = intendedValues(req, snap)

  // Where does Rivhit stand relative to snapshot + targets?
  const others = diffAgainstSnapshot(snap, targets, cur).filter((k) => !(TARGET_KEYS as readonly string[]).includes(k))
  if (others.length) {
    return finish('unknown', `שדות אחרים בפריט שונו ברווחית מאז הצילום (${others.join(', ')}) — לא נשלח עדכון`, { mismatched: others })
  }
  const stray = TARGET_KEYS.filter((k) => !sameValue(cur[k], targets[k]) && !sameValue(cur[k], snap![k]))
  if (stray.length) {
    return finish('unknown', `ערך לא צפוי ברווחית (${stray.join(', ')}) — לא נשלח עדכון`, { mismatched: [...stray] })
  }

  const localFields = {
    name: targets.item_name,
    barcode: normStr(targets.barcode),
    sku: effectiveSku(targets) || null,
  }
  const applyLocal = async () => {
    if (mode !== 'live') return null
    try { await db.updateProductFields(req.product_id, localFields); return null } catch {
      // Rivhit is the source of truth and rivhit-sync copies these fields
      // every 15 min, so a failed local copy heals itself.
      return 'עודכן ברווחית; העדכון באתר ייכנס בסנכרון הבא'
    }
  }

  if (TARGET_KEYS.every((k) => sameValue(cur[k], targets[k]))) return finish('done', await applyLocal())

  // (R5) duplicates, re-checked in the DB right before the write
  const codes: string[] = []
  if (ch.barcode && normStr(targets.barcode)) codes.push(normStr(targets.barcode))
  if (ch.item_part_num && normStr(targets.item_part_num)) codes.push(normStr(targets.item_part_num))
  for (const code of codes) {
    const dup = await db.findDuplicateCode(req.product_id, requestId, code)
    if (dup != null) return finish('failed', `INV_DUPLICATE_CODE:${dup}`)
  }

  // (3) Item.Update with the full snapshot record
  const payload = buildItemUpdatePayload(snap, targets, requestId)
  const u = await rivhit.itemUpdate(payload)
  if (u.kind === 'rate_limited') return finish(req.status, errText(u))
  if (u.kind === 'timeout' || u.kind === 'network') return finish('unknown', errText(u))
  if (u.kind !== 'ok') return finish('failed', errText(u as any))

  // (4) read back and compare EVERY snapshot field
  const b = await rivhit.itemGet(req.rivhit_id)
  if (b.kind !== 'ok' || !b.data) return finish('unknown', 'העדכון נשלח אך לא ניתן היה לקרוא את הפריט בחזרה')
  const mismatched = diffAgainstSnapshot(snap, targets, b.data)
  if (mismatched.length) {
    return finish('unknown', `הקריאה החוזרת מרווחית אינה תואמת (${mismatched.join(', ')})`, { mismatched })
  }
  return finish('done', await applyLocal())
}

// ---------------------------------------------------------------------------
// capture_baseline (R3): Rivhit's own quantity at the moment of the count
// ---------------------------------------------------------------------------

export interface BaselineResult {
  ok: boolean
  error?: string
  message?: string
  rivhit_baseline_qty?: number
  rivhit_baseline_at?: string
}

export async function captureBaseline(
  deps: EngineDeps,
  lineId: string,
  expectedVersion: number,
  opts: { mode: Mode },
): Promise<BaselineResult> {
  const { db, rivhit } = deps
  const now = deps.now ?? (() => new Date())
  const line = await db.getLine(lineId)
  if (!line) return { ok: false, error: 'INV_NOT_FOUND' }
  if (line.version !== expectedVersion) return { ok: false, error: `INV_CONFLICT:${line.version ?? ''}` }
  const count = await db.getCount(line.count_id)
  if (!count) return { ok: false, error: 'INV_NOT_FOUND' }
  const allowed = count.status === 'draft' || (count.status === 'needs_attention' && line.sync_status === 'pending')
  if (!allowed) return { ok: false, error: `INV_BAD_STATUS:${count.status}` }
  if (count.mode && count.mode !== opts.mode) return { ok: false, error: `INV_MODE_MISMATCH:${count.mode}` }

  let qty: number | null
  if (opts.mode === 'live') {
    const q = await rivhit.itemQuantity(line.rivhit_id, count.storage_id)
    if (q.kind !== 'ok') return { ok: false, error: `INV_RIVHIT_UNAVAILABLE:${q.kind}`, message: errText(q) }
    qty = Number(q.data?.quantity)
  } else {
    qty = await db.getProductStock(line.product_id)
  }
  if (qty == null || !Number.isInteger(qty)) {
    return { ok: false, error: 'INV_BAD_QUANTITY', message: `הכמות ברווחית אינה מספר שלם (${qty})` }
  }
  // Lock the count to this mode (only while null), so baselines captured in
  // one mode can never be synced in the other: the sync refuses a mismatch.
  if (!count.mode && !(await db.setCountMode(count.id, opts.mode))) {
    const again = await db.getCount(line.count_id)
    if (!again || again.mode !== opts.mode) return { ok: false, error: `INV_MODE_MISMATCH:${again?.mode ?? ''}` }
  }
  const at = now().toISOString()
  const ok = await db.setLineBaseline(lineId, expectedVersion, { rivhit_baseline_qty: qty, rivhit_baseline_at: at })
  if (!ok) return { ok: false, error: 'INV_CONFLICT' }
  try {
    await db.logEvent({ kind: 'baseline_captured', count_id: line.count_id, product_id: line.product_id,
      detail: { mode: opts.mode, line_id: lineId, version: expectedVersion, rivhit_baseline_qty: qty } })
  } catch { /* */ }
  return { ok: true, rivhit_baseline_qty: qty, rivhit_baseline_at: at }
}
