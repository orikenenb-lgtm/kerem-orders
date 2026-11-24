// inventory-sync/rivhit.ts — the Rivhit adapters.
//
//   liveRivhit(...)      the real API (POST {BASE}/{Method}, JSON body with
//                        api_token), 20 s AbortController timeout, every answer
//                        classified into ok / rivhit_error / already_processed
//                        (-107) / rate_limited / timeout / network.
//   simulatedRivhit(...) an in-memory fake for simulation mode: NO network.
//
// No Deno APIs here either: fetch, AbortController and TextEncoder are
// standard, so landing/tests/inventorySync.test.mjs runs this file in node
// with an injected fake fetch. Only documented methods and fields are used:
// Item.Quantity, Document.New, Item.List (filter_fields), Item.Update,
// Storage.List.
//
// The token is passed in by index.ts (service-client rpc _get_rivhit_token).
// It is never logged, never echoed back, never placed in an error message.

import {
  type DocPayload,
  type DocResult,
  type Rivhit,
  type RivhitItem,
  type RivhitResult,
  ITEM_UPDATE_FIELDS,
  MAX_PAYLOAD_BYTES,
  byteLength,
  classifyRivhitResponse,
} from './engine.ts'

export const RIVHIT_BASE = 'https://api.rivhit.co.il/online/RivhitOnlineAPI.svc'

export interface LiveOpts {
  token: string
  fetchImpl?: typeof fetch
  /** Per-call timeout. A Document.New that times out becomes `unknown`. */
  timeoutMs?: number
  /** Spacing between calls. 320 ms ≈ 187/min, under the documented
   *  200 requests/minute limit even when one run makes every call. */
  minIntervalMs?: number
  sleep?: (ms: number) => Promise<void>
  nowMs?: () => number
}

export function liveRivhit(opts: LiveOpts): Rivhit {
  const doFetch = opts.fetchImpl ?? fetch
  const timeoutMs = opts.timeoutMs ?? 20_000
  const minInterval = opts.minIntervalMs ?? 320
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const nowMs = opts.nowMs ?? (() => Date.now())
  let nextAt = 0

  async function call<T>(method: string, body: Record<string, unknown>): Promise<RivhitResult<T>> {
    if (!opts.token) return { kind: 'rivhit_error', code: 0, message: 'חסר מפתח API של רווחית' }
    const text = JSON.stringify({ api_token: opts.token, ...body })
    if (byteLength(text) >= MAX_PAYLOAD_BYTES) {
      return { kind: 'rivhit_error', code: 413, message: 'הבקשה גדולה מדי (64KB)' }
    }
    const wait = nextAt - nowMs()
    if (wait > 0) await sleep(wait)
    nextAt = nowMs() + minInterval

    const ac = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; ac.abort() }, timeoutMs)
    try {
      const res = await doFetch(`${RIVHIT_BASE}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: text,
        signal: ac.signal,
      })
      const answer = await res.text()
      return classifyRivhitResponse<T>(res.status, answer)
    } catch (e) {
      const name = (e as { name?: string })?.name
      if (timedOut || name === 'AbortError' || name === 'TimeoutError') {
        return { kind: 'timeout', message: `${method}: timeout after ${timeoutMs} ms` }
      }
      // Never include the error text verbatim: some runtimes echo the request.
      return { kind: 'network', message: `${method}: ${name || 'fetch failed'}` }
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    itemQuantity(itemId, storageId) {
      const b: Record<string, unknown> = { item_id: itemId }
      if (storageId != null) b.storage_id = storageId
      return call<{ quantity: number }>('Item.Quantity', b)
    },
    documentNew(payload: DocPayload) {
      return call<DocResult>('Document.New', payload as unknown as Record<string, unknown>)
    },
    async itemGet(itemId) {
      const r = await call<{ item_list?: RivhitItem[] }>('Item.List', {
        filter_fields: [{ filter_field: 'item_id', filter_Value: String(itemId) }],
      })
      if (r.kind !== 'ok') return r
      // Pick the exact id even if the filter were ignored and all items came back.
      const list = Array.isArray(r.data?.item_list) ? r.data!.item_list! : []
      const hit = list.find((x) => Number(x?.item_id) === Number(itemId)) ?? null
      return { kind: 'ok', data: hit }
    },
    itemUpdate(payload) {
      return call<{ update_success?: boolean }>('Item.Update', payload)
    },
    async storageList() {
      const r = await call<{ storage_list?: unknown[]; project_list?: unknown[] }>('Storage.List', {})
      if (r.kind !== 'ok') return r
      // The documented schema names the array project_list; the documented
      // example names it storage_list. Accept either.
      const raw = (r.data?.storage_list ?? r.data?.project_list ?? []) as { storage_id?: unknown; storage_name?: unknown }[]
      return {
        kind: 'ok',
        data: raw
          .filter((s) => Number.isInteger(Number(s?.storage_id)))
          .map((s) => ({ storage_id: Number(s.storage_id), storage_name: String(s.storage_name ?? '') })),
      }
    },
  }
}

/** Reads the Rivhit token through the service client. Returns '' when none. */
export async function fetchRivhitToken(admin: { rpc: (fn: string) => PromiseLike<{ data: unknown; error: unknown }> }): Promise<string> {
  const { data, error } = await admin.rpc('_get_rivhit_token')
  if (error || typeof data !== 'string') return ''
  return data
}

// ---------------------------------------------------------------------------
// The simulated Rivhit (simulation mode + tests). In memory, no network.
// Document numbers look like SIM-11-0001. prevent_duplicates is honoured
// (a repeated request_reference answers -107), so simulation exercises the
// same paths as live.
// ---------------------------------------------------------------------------

export interface SimSeed {
  /** rivhit item_id → current quantity */
  quantities?: Record<number, number> | Map<number, number>
  items?: RivhitItem[]
  storages?: { storage_id: number; storage_name: string }[]
  /** Which document types add / remove stock (settings.doc_type_in/out). */
  docTypeIn?: number
  docTypeOut?: number
}

export interface SimulatedRivhit extends Rivhit {
  documents: DocPayload[]
  updates: Record<string, unknown>[]
  calls: string[]
}

export function simulatedRivhit(seed: SimSeed = {}): SimulatedRivhit {
  const qty = new Map<number, number>()
  const src = seed.quantities
  if (src instanceof Map) for (const [k, v] of src) qty.set(Number(k), Number(v))
  else if (src) for (const k of Object.keys(src)) qty.set(Number(k), Number((src as any)[k]))
  const items = new Map<number, RivhitItem>()
  for (const it of seed.items || []) items.set(it.item_id, { ...it })
  const refs = new Map<string, string>()
  let docNo = 0
  const sim: SimulatedRivhit = {
    documents: [], updates: [], calls: [],
    async itemQuantity(itemId) {
      sim.calls.push('Item.Quantity')
      if (!qty.has(itemId) && !items.has(itemId)) return { kind: 'rivhit_error', code: -24, message: 'הפריט אינו קיים' }
      return { kind: 'ok', data: { quantity: qty.get(itemId) ?? Number(items.get(itemId)?.quantity ?? 0) } }
    },
    async documentNew(p) {
      sim.calls.push('Document.New')
      if (p.prevent_duplicates && refs.has(p.request_reference)) {
        return { kind: 'already_processed', code: -107, message: 'כבר בוצעה בקשה עם אותו מזהה בקשה' }
      }
      if (p.check_only) return { kind: 'ok', data: {} }
      for (const it of p.items) {
        const sign = p.document_type === (seed.docTypeIn ?? 11) ? 1 : p.document_type === (seed.docTypeOut ?? 10) ? -1 : 0
        qty.set(it.item_id, (qty.get(it.item_id) ?? 0) + sign * it.quantity)
      }
      docNo++
      const number = `SIM-${p.document_type}-${String(docNo).padStart(4, '0')}`
      refs.set(p.request_reference, number)
      sim.documents.push(p)
      return { kind: 'ok', data: { document_type: p.document_type, document_number: number } }
    },
    async itemGet(itemId) {
      sim.calls.push('Item.List')
      const it = items.get(itemId)
      return { kind: 'ok', data: it ? { ...it, quantity: qty.get(itemId) ?? it.quantity } : null }
    },
    async itemUpdate(p) {
      sim.calls.push('Item.Update')
      const id = Number(p.item_id)
      const it = items.get(id)
      if (!it) return { kind: 'rivhit_error', code: -24, message: 'הפריט אינו קיים' }
      for (const [upd, lst] of ITEM_UPDATE_FIELDS) if (upd in p) (it as any)[lst] = p[upd]
      sim.updates.push(p)
      return { kind: 'ok', data: { update_success: true } }
    },
    async storageList() {
      sim.calls.push('Storage.List')
      return { kind: 'ok', data: seed.storages ?? [{ storage_id: 1, storage_name: 'מחסן ראשי (סימולציה)' }] }
    },
  }
  return sim
}
