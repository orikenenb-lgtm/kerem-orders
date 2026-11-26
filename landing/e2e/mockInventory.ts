import type { BrowserContext, Route } from "@playwright/test";
import { mockSupabase, seedSession, PROFILE, USER } from "./mockSupabase";

// Offline stand-in for the stock-count backend (docs/inventory/CONTRACT.md,
// supabase/2026-11-inventory-count.sql, supabase/functions/inventory-sync).
//
// Builds on mockSupabase(): that installs the shop mocks; the routes here are
// registered AFTER it, so Playwright tries them first (last registered wins)
// and anything they do not handle falls back to the shop mocks.
//
// State lives in this Node process, so a spec can read it (how many approve
// calls?) and change it mid-test (another manager saved meanwhile; the next
// save drops on the network). Nothing reaches a real Supabase or Rivhit.

export const MANAGER_PROFILE = { ...PROFILE, role: "manager", full_name: "מנהלת בדיקה" };

export type InvProduct = {
  id: string; rivhit_id: number; name: string; sku: string; barcode: string;
  picture_link: string; rotation_override: number | null; stock_quantity: number;
  unit_name: string; display_qty: number; display_name: string; is_active: boolean; updated_at: string;
};

const uuid = (n: number, prefix = "0000aaaa") => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;

const P = (n: number, name: string, sku: string, stock: number, display_qty = 1): InvProduct => ({
  id: uuid(n, "11111111"), rivhit_id: 5000 + n, name, sku, barcode: "",
  picture_link: `https://api.rivhit.co.il/pic/inv${n}`, rotation_override: null,
  stock_quantity: stock, unit_name: "יח'", display_qty, display_name: "מארז",
  is_active: true, updated_at: "2026-11-24T08:00:00Z",
});

/** Codes are TEXT: one has leading zeros, two products share one sku. */
export const INV_PRODUCTS: InvProduct[] = [
  P(1, "רובוט מכונית צהוב בקופסה 72 יח", "6928810168960", 40),
  P(2, "פרוזן בדיספלאי 1/12 ק 288", "6928817371677", 120, 12),
  P(3, "כדור גומי סטיץ איכותי", "0071234567892", 30),
  P(4, "סליים לוחמים ורוד 1/12", "7290000000017", 24, 12),
  P(5, "סליים לוחמים כחול 1/12", "7290000000017", 36, 12),
  P(6, "מסוק מכבי אש אורות ומוזיקה 48 יח", "6924050751115", 10),
];
export const BY_SKU = (sku: string) => INV_PRODUCTS.find((p) => p.sku === sku)!;

type Count = {
  id: string; storage_id: number | null; storage_name: string | null; status: string; note: string | null;
  created_by: string; created_at: string; approved_by: string | null; approved_at: string | null;
  finished_at: string | null; version: number; mode: string | null;
};
type Line = {
  id: string; count_id: string; product_id: string; rivhit_id: number; product_name: string; code_scanned: string | null;
  counted_qty: number; baseline_qty: number; baseline_at: string | null; counted_by: string; counted_at: string; version: number;
  sync_status: string; sync_ref: string | null; rivhit_before_qty: number | null; delta: number | null; rivhit_doc_type: number | null;
  rivhit_doc_number: string | null; rivhit_after_qty: number | null; attempts: number; last_error: string | null; synced_at: string | null;
  rivhit_baseline_qty: number | null; rivhit_baseline_at: string | null;
};
type Ev = { id: number; at: string; actor: string | null; count_id: string | null; product_id: string | null; kind: string; detail: unknown };
type EditReq = { id: string; product_id: string; status: string; last_error: string | null; finished_at: string | null; new_name: string | null; new_barcode: string | null; new_sku: string | null; new_price?: number | null; new_description?: string | null };

export type InvState = {
  counts: Count[];
  lines: Line[];
  events: Ev[];
  edits: EditReq[];
  settings: { id: 1; highlight_abs_diff: number; rivhit_writes_enabled: boolean };
  /** inventory-sync answers at all? false = network failure (route.abort). */
  syncReachable: boolean;
  storages: { storage_id: number | null; storage_name: string }[];
  /** Abort this many upcoming inv_save_line requests (a dropped connection). */
  failSaves: number;
  /** Products whose Rivhit stock "moved" before the sync → sync_status 'changed'. */
  changedOnSync: Set<string>;
  /** Products whose Rivhit document is refused on sync → sync_status 'failed'. */
  failOnSync: Set<string>;
  /** capture_baseline answers 500 (the save itself must still stand). */
  captureFails: boolean;
  /** Neither the migration nor the edge function is installed (404s). */
  backendMissing: boolean;
  /** Rivhit's own quantity per product when it differs from the site copy. */
  rivhitQty: Map<string, number>;
  /** Every RPC / function call, in order: { name, args }. */
  calls: { name: string; args: Record<string, unknown> }[];
  /** Price + description per product id (inv_item_details). Unset = the v2
   *  migration is "not installed": the RPC answers 404 like PostgREST. */
  itemDetails?: Record<string, { price: number; description: string }>;
};

export function newInvState(over: Partial<InvState> = {}): InvState {
  return {
    counts: [], lines: [], events: [], edits: [],
    settings: { id: 1, highlight_abs_diff: 20, rivhit_writes_enabled: false },
    syncReachable: true,
    storages: [{ storage_id: null, storage_name: "מחסן ראשי (סימולציה)" }],
    failSaves: 0,
    changedOnSync: new Set(),
    failOnSync: new Set(),
    captureFails: false,
    backendMissing: false,
    rivhitQty: new Map(),
    calls: [],
    ...over,
  };
}

export const callsOf = (s: InvState, name: string) => s.calls.filter((c) => c.name === name);

let clock = Date.parse("2026-11-24T09:00:00Z");
const now = () => new Date((clock += 1000)).toISOString();
let seq = 1;

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
const raise = (route: Route, message: string) =>
  json(route, { code: "P0001", message, details: null, hint: null }, 400);

const pickCols = <T extends Record<string, unknown>>(rows: T[], select: string | null) => {
  if (!select || select === "*") return rows;
  const cols = select.split(",").map((c) => c.trim());
  return rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));
};

/** Minimal PostgREST filters: col=eq.x, col=in.(a,b). */
function filterRows<T extends Record<string, unknown>>(rows: T[], params: URLSearchParams): T[] {
  let out = rows;
  for (const [k, v] of params.entries()) {
    if (["select", "order", "limit", "offset"].includes(k)) continue;
    if (v.startsWith("eq.")) out = out.filter((r) => String(r[k]) === v.slice(3));
    else if (v.startsWith("in.(")) {
      const set = v.slice(4, -1).split(",").map((x) => x.replace(/^"|"$/g, ""));
      out = out.filter((r) => set.includes(String(r[k])));
    }
  }
  return out;
}

const productRow = (p: InvProduct) => {
  const { id, ...rest } = p;
  return { product_id: id, ...rest };
};

const ACTIVE = ["draft", "approved", "syncing", "needs_attention"];

function log(s: InvState, count_id: string | null, product_id: string | null, kind: string, detail: unknown) {
  s.events.push({ id: seq++, at: now(), actor: USER.id, count_id, product_id, kind, detail });
}

function rollup(s: InvState, c: Count) {
  const ls = s.lines.filter((l) => l.count_id === c.id);
  if (ls.every((l) => ["done", "no_change", "skipped"].includes(l.sync_status))) { c.status = "done"; c.finished_at = now(); }
  else if (ls.some((l) => ["unknown", "failed", "changed"].includes(l.sync_status))) c.status = "needs_attention";
  else c.status = "syncing";
}

function rpc(s: InvState, route: Route, name: string, a: Record<string, unknown>) {
  const codeRe = /^[0-9A-Za-z-]{1,32}$/;
  switch (name) {
    case "inv_lookup": {
      const code = String(a.p_code ?? "").trim();
      if (!codeRe.test(code)) return raise(route, "INV_BAD_CODE");
      const codes = [code];
      if (/^[0-9]{12}$/.test(code)) codes.push("0" + code);
      else if (/^0[0-9]{12}$/.test(code)) codes.push(code.slice(1));
      const rows = INV_PRODUCTS.filter((p) => p.is_active && (codes.includes(p.sku) || (p.barcode && codes.includes(p.barcode))))
        .sort((x, y) => x.name.localeCompare(y.name, "he"));
      return json(route, rows.map(productRow));
    }
    case "inv_search": {
      const q = String(a.p_q ?? "").replace(/[,()%_\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 64);
      if (!q) return json(route, []);
      const rows = INV_PRODUCTS.filter((p) => p.name.includes(q) || p.sku.includes(q));
      return json(route, rows.slice(0, 30).map(productRow));
    }
    case "inv_open_count": {
      const sid = (a.p_storage_id as number | null) ?? null;
      const note = (a.p_note as string | null) ?? null;
      if (note && note.length > 500) return raise(route, "INV_BAD_INPUT:note");
      const ex = s.counts.find((c) => (c.storage_id ?? 0) === (sid ?? 0) && ACTIVE.includes(c.status));
      if (ex) return raise(route, `INV_ACTIVE_EXISTS:${ex.id}`);
      const c: Count = {
        id: uuid(seq++, "2222cccc"), storage_id: sid, storage_name: (a.p_storage_name as string | null) ?? null, status: "draft",
        note, created_by: USER.id, created_at: now(), approved_by: null, approved_at: null, finished_at: null, version: 1, mode: null,
      };
      s.counts.push(c);
      log(s, c.id, null, "count_opened", { storage_id: sid, storage_name: c.storage_name, note });
      return json(route, c.id);
    }
    case "inv_save_line": {
      const qty = a.p_counted as number;
      if (qty == null || !Number.isInteger(qty) || qty < 0 || qty > 10_000_000) return raise(route, "INV_BAD_QTY");
      const code = a.p_code == null ? null : String(a.p_code).trim() || null;
      if (code && !codeRe.test(code)) return raise(route, "INV_BAD_CODE");
      const c = s.counts.find((x) => x.id === a.p_count_id);
      if (!c) return raise(route, "INV_NOT_FOUND");
      const line = s.lines.find((l) => l.count_id === c.id && l.product_id === a.p_product_id);
      let recount = false;
      if (c.status === "draft") { /* ok */ }
      else if (c.status === "needs_attention" && line && line.sync_status === "changed") recount = true;
      else return raise(route, `INV_NOT_DRAFT:${c.status}`);
      const p = INV_PRODUCTS.find((x) => x.id === a.p_product_id);
      if (!p) return raise(route, "INV_NOT_FOUND");
      if (!p.is_active) return raise(route, "INV_PRODUCT_UNAVAILABLE");
      const ev = a.p_expected_version as number | null;
      let out: Line;
      if (!line) {
        if (ev !== null && ev !== undefined) return raise(route, "INV_CONFLICT");
        out = {
          id: uuid(seq++, "3333dddd"), count_id: c.id, product_id: p.id, rivhit_id: p.rivhit_id, product_name: p.name, code_scanned: code,
          counted_qty: qty, baseline_qty: p.stock_quantity, baseline_at: p.updated_at, counted_by: USER.id, counted_at: now(), version: 1,
          sync_status: "pending", sync_ref: null, rivhit_before_qty: null, delta: null, rivhit_doc_type: null, rivhit_doc_number: null,
          rivhit_after_qty: null, attempts: 0, last_error: null, synced_at: null, rivhit_baseline_qty: null, rivhit_baseline_at: null,
        };
        s.lines.push(out);
        log(s, c.id, p.id, "line_saved", { before: null, after: { counted_qty: qty, version: 1 } });
      } else {
        if (ev !== line.version) return raise(route, `INV_CONFLICT:${line.counted_qty}:${line.version}`);
        const before = { counted_qty: line.counted_qty, version: line.version };
        Object.assign(line, {
          counted_qty: qty, baseline_qty: p.stock_quantity, counted_at: now(), version: line.version + 1,
          code_scanned: code ?? line.code_scanned, rivhit_baseline_qty: null, rivhit_baseline_at: null,
          ...(recount ? { sync_status: "pending", sync_ref: null, last_error: null } : {}),
        });
        out = line;
        log(s, c.id, p.id, "line_saved", { recount, before, after: { counted_qty: qty, version: line.version } });
      }
      c.version++; // R4: every line change bumps the COUNT version (the RPC still returns the line version)
      return json(route, [{ line_id: out.id, version: out.version, counted_qty: out.counted_qty, baseline_qty: out.baseline_qty, counted_at: out.counted_at }]);
    }
    case "inv_delete_line": {
      const c = s.counts.find((x) => x.id === a.p_count_id);
      if (!c) return raise(route, "INV_NOT_FOUND");
      if (c.status !== "draft") return raise(route, `INV_NOT_DRAFT:${c.status}`);
      const i = s.lines.findIndex((l) => l.count_id === c.id && l.product_id === a.p_product_id);
      if (i < 0) return raise(route, "INV_CONFLICT");
      if (s.lines[i].version !== a.p_expected_version) return raise(route, `INV_CONFLICT:${s.lines[i].counted_qty}:${s.lines[i].version}`);
      s.lines.splice(i, 1);
      c.version++;
      log(s, c.id, a.p_product_id as string, "line_deleted", {});
      return json(route, null);
    }
    case "inv_approve": {
      const c = s.counts.find((x) => x.id === a.p_count_id);
      if (!c) return raise(route, "INV_NOT_FOUND");
      if (c.status !== "draft" || c.version !== a.p_expected_version) return raise(route, `INV_CONFLICT:${c.status}:${c.version}`);
      const n = s.lines.filter((l) => l.count_id === c.id).length;
      if (n < 1) return raise(route, "INV_EMPTY");
      Object.assign(c, { status: "approved", approved_by: USER.id, approved_at: now(), version: c.version + 1 });
      log(s, c.id, null, "count_approved", { lines: n });
      return json(route, "approved");
    }
    case "inv_cancel": {
      const c = s.counts.find((x) => x.id === a.p_count_id);
      if (!c) return raise(route, "INV_NOT_FOUND");
      if (c.status !== "draft" || c.version !== a.p_expected_version) return raise(route, `INV_CONFLICT:${c.status}:${c.version}`);
      Object.assign(c, { status: "cancelled", version: c.version + 1 });
      log(s, c.id, null, "count_cancelled", {});
      return json(route, null);
    }
    case "inv_resolve_line": {
      const note = String(a.p_note ?? "").trim();
      if (note.length < 3 || note.length > 500) return raise(route, "INV_BAD_INPUT:note");
      const l = s.lines.find((x) => x.id === a.p_line_id);
      if (!l) return raise(route, "INV_NOT_FOUND");
      const c = s.counts.find((x) => x.id === l.count_id)!;
      if (c.status !== "needs_attention" || !["failed", "unknown", "changed"].includes(l.sync_status)) {
        return raise(route, `INV_NOT_RESOLVABLE:${c.status}:${l.sync_status}`);
      }
      const before = l.sync_status;
      l.sync_status = "skipped";
      rollup(s, c);
      c.version++;
      log(s, c.id, l.product_id, "line_skipped", { before_status: before, note, sync_ref: l.sync_ref, rivhit_doc_number: l.rivhit_doc_number, count_status: c.status });
      return json(route, c.status);
    }
    case "inv_close_item_edit": {
      const note = String(a.p_note ?? "").trim();
      if (note.length < 3 || note.length > 500) return raise(route, "INV_BAD_INPUT:note");
      const r = s.edits.find((e) => e.id === a.p_request_id);
      if (!r) return raise(route, "INV_NOT_FOUND");
      if (!["pending", "unknown", "failed"].includes(r.status)) return raise(route, `INV_NOT_RESOLVABLE:${r.status}`);
      const before = r.status;
      r.status = "cancelled";
      r.finished_at = now();
      log(s, null, r.product_id, "item_edit_cancelled", { request_id: r.id, before_status: before, note });
      return json(route, null);
    }
    case "inv_item_details": {
      const d = s.itemDetails?.[String(a.p_product_id)];
      if (!s.itemDetails) return json(route, { code: "PGRST202", message: "Could not find the function public.inv_item_details in the schema cache", details: null, hint: null }, 404);
      return json(route, d ? [{ product_id: a.p_product_id, price: d.price, description: d.description }] : []);
    }
    case "inv_request_item_edit_v2": {
      const p = INV_PRODUCTS.find((x) => x.id === a.p_product_id);
      if (!p) return raise(route, "INV_NOT_FOUND");
      const cur = s.itemDetails?.[p.id] ?? { price: 0, description: "" };
      const price = a.p_new_price == null ? cur.price : Number(a.p_new_price);
      if (a.p_new_price != null && !(price > 0 && price <= 100000 && Math.round(price * 100) === price * 100)) return raise(route, "INV_BAD_INPUT:price");
      const desc = a.p_new_description == null ? cur.description : String(a.p_new_description).trim();
      if (a.p_new_description != null && (desc.length < 1 || desc.length > 500)) return raise(route, "INV_BAD_INPUT:description");
      const name = a.p_new_name == null ? p.name : String(a.p_new_name).trim();
      const bc = a.p_new_barcode == null ? p.barcode : String(a.p_new_barcode).trim();
      const sku = a.p_new_sku == null ? p.sku : String(a.p_new_sku).trim();
      if (name === p.name && bc === p.barcode && sku === p.sku && price === cur.price && desc === cur.description) return raise(route, "INV_NO_CHANGE");
      const open = s.edits.find((e) => e.product_id === p.id && ["pending", "in_progress", "unknown"].includes(e.status));
      if (open) return raise(route, `INV_EDIT_PENDING:${open.id}`);
      const r: EditReq = { id: uuid(seq++, "4444eeee"), product_id: p.id, status: "pending", last_error: null, finished_at: null, new_name: name, new_barcode: bc, new_sku: sku, new_price: price, new_description: desc };
      s.edits.push(r);
      log(s, null, p.id, "item_edit_requested", {});
      return json(route, r.id);
    }
    case "inv_request_item_edit": {
      const p = INV_PRODUCTS.find((x) => x.id === a.p_product_id);
      if (!p) return raise(route, "INV_NOT_FOUND");
      const name = a.p_new_name == null ? p.name : String(a.p_new_name).trim();
      if (name.length < 1 || name.length > 100) return raise(route, "INV_BAD_INPUT:name");
      const bc = a.p_new_barcode == null ? p.barcode : String(a.p_new_barcode).trim();
      const sku = a.p_new_sku == null ? p.sku : String(a.p_new_sku).trim();
      if (a.p_new_sku != null && sku === "") return raise(route, "INV_BAD_INPUT:sku");
      if (name === p.name && bc === p.barcode && sku === p.sku) return raise(route, "INV_NO_CHANGE");
      for (const [nv, ov] of [[bc, p.barcode], [sku, p.sku]]) {
        if (nv && nv !== ov) {
          const dup = INV_PRODUCTS.find((o) => o.id !== p.id && (o.sku === nv || o.barcode === nv));
          if (dup) return raise(route, `INV_DUPLICATE_CODE:${dup.name}`);
        }
      }
      const open = s.edits.find((e) => e.product_id === p.id && ["pending", "in_progress", "unknown"].includes(e.status));
      if (open) return raise(route, `INV_EDIT_PENDING:${open.id}`);
      const r: EditReq = { id: uuid(seq++, "4444eeee"), product_id: p.id, status: "pending", last_error: null, finished_at: null, new_name: name, new_barcode: bc, new_sku: sku };
      s.edits.push(r);
      log(s, null, p.id, "item_edit_requested", {});
      return json(route, r.id);
    }
  }
  return null;
}

function syncFn(s: InvState, route: Route, body: Record<string, unknown>) {
  if (body.action === "status") {
    return json(route, { ok: true, mode: "simulation", writes_enabled: false, configured: false, storages: s.storages });
  }
  if (body.action === "sync_count") {
    const c = s.counts.find((x) => x.id === body.count_id);
    if (!c) return json(route, { ok: false, error: "INV_NOT_FOUND", message: "הרשומה לא נמצאה" }, 404);
    if (!["approved", "syncing", "needs_attention"].includes(c.status)) {
      return json(route, { ok: false, error: "INV_BAD_STATUS", message: "המצב הנוכחי אינו מאפשר את הפעולה" }, 409);
    }
    c.mode = "simulation";
    let processed = 0;
    for (const l of s.lines.filter((x) => x.count_id === c.id)) {
      const claimable = l.sync_status === "pending" || l.sync_status === "sent"
        || (body.include_unknown === true && l.sync_status === "unknown")
        || (body.retry_failed === true && l.sync_status === "failed");
      if (!claimable) continue;
      processed++;
      l.attempts++;
      if (s.failOnSync.has(l.product_id)) {
        s.failOnSync.delete(l.product_id);
        l.sync_status = "failed";
        l.last_error = "פריט לא קיים ברווחית";
        log(s, c.id, l.product_id, "line_failed", { mode: "simulation", reason: "פריט לא קיים ברווחית" });
        continue;
      }
      if (s.changedOnSync.has(l.product_id)) {
        s.changedOnSync.delete(l.product_id);
        l.sync_status = "changed";
        log(s, c.id, l.product_id, "line_changed", { baseline: l.baseline_qty, current: l.baseline_qty + 3 });
        continue;
      }
      // R3: compare with Rivhit's quantity captured at the count, never the site copy.
      if (l.rivhit_baseline_qty === null) {
        l.sync_status = "changed";
        l.last_error = "לא נקלטה כמות רווחית בזמן הספירה — ספרו מחדש";
        log(s, c.id, l.product_id, "line_changed", { mode: "simulation", reason: "no_rivhit_baseline" });
        continue;
      }
      const delta = l.counted_qty - l.rivhit_baseline_qty;
      l.rivhit_before_qty = l.rivhit_baseline_qty;
      l.delta = delta;
      if (delta === 0) { l.sync_status = "no_change"; continue; }
      l.rivhit_doc_type = delta > 0 ? 11 : 10;
      l.rivhit_doc_number = `SIM-${seq++}`;
      l.rivhit_after_qty = l.counted_qty;
      l.sync_status = "done";
      l.synced_at = now();
      log(s, c.id, l.product_id, "line_done", { mode: "simulation", delta, doc_number: l.rivhit_doc_number });
    }
    rollup(s, c);
    return json(route, { ok: true, mode: "simulation", processed, stopped: null, count_status: c.status });
  }
  if (body.action === "capture_baseline") {
    if (s.captureFails) return json(route, { ok: false, error: "INTERNAL", message: "שגיאה פנימית — נסו שוב" }, 500);
    const l = s.lines.find((x) => x.id === body.line_id);
    if (!l) return json(route, { ok: false, error: "INV_NOT_FOUND", message: "הרשומה לא נמצאה" }, 404);
    const c = s.counts.find((x) => x.id === l.count_id)!;
    const okStatus = c.status === "draft" || (c.status === "needs_attention" && l.sync_status === "pending");
    if (l.version !== body.expected_version || !okStatus) {
      return json(route, { ok: false, error: "INV_CONFLICT", message: "תהליך אחר מעדכן את הרשומה הזאת כרגע — נסו שוב בעוד רגע" }, 409);
    }
    l.rivhit_baseline_qty = s.rivhitQty.get(l.product_id) ?? INV_PRODUCTS.find((p) => p.id === l.product_id)!.stock_quantity;
    l.rivhit_baseline_at = now();
    return json(route, { ok: true, rivhit_baseline_qty: l.rivhit_baseline_qty, rivhit_baseline_at: l.rivhit_baseline_at });
  }
  if (body.action === "apply_item_edit") {
    const r = s.edits.find((e) => e.id === body.request_id);
    if (!r) return json(route, { ok: false, error: "INV_NOT_FOUND", message: "הרשומה לא נמצאה" }, 404);
    r.status = "done";
    r.finished_at = now();
    return json(route, { ok: true, status: "done", mode: "simulation" });
  }
  return json(route, { ok: false, error: "INV_BAD_REQUEST", message: "בקשה לא תקינה" }, 400);
}

/**
 * Install the shop mocks + the inventory backend. role decides who is signed
 * in: "manager" (profile role manager), "customer" (the shop's default
 * profile) or "guest" (no session at all).
 */
export async function mockInventory(context: BrowserContext, s: InvState, role: "manager" | "customer" | "guest" = "manager") {
  await mockSupabase(context);
  if (role !== "guest") await seedSession(context, {});

  await context.route(/\/functions\/v1\/inventory-sync/, async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: { ...CORS, "access-control-allow-methods": "POST, OPTIONS" } });
    let body: Record<string, unknown> = {};
    try { body = route.request().postDataJSON() ?? {}; } catch { /* empty */ }
    s.calls.push({ name: `sync:${String(body.action)}`, args: body });
    if (s.backendMissing) return json(route, { code: "NOT_FOUND", message: "Requested function was not found" }, 404);
    if (!s.syncReachable) return route.abort("failed");
    return syncFn(s, route, body);
  });

  await context.route(/\/rest\/v1\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const p = url.searchParams;

    const m = path.match(/\/rpc\/(inv_[a-z0-9_]+)$/);
    if (m) {
      let args: Record<string, unknown> = {};
      try { args = req.postDataJSON() ?? {}; } catch { /* none */ }
      s.calls.push({ name: m[1], args });
      if (s.backendMissing) {
        return json(route, { code: "PGRST202", message: `Could not find the function public.${m[1]} in the schema cache`, details: null, hint: null }, 404);
      }
      if (m[1] === "inv_save_line" && s.failSaves > 0) {
        s.failSaves--;
        return route.abort("failed");
      }
      const done = rpc(s, route, m[1], args);
      if (done) return done;
      return raise(route, "unknown rpc");
    }

    if (path.endsWith("/profiles")) {
      if (role === "manager") {
        // The auth provider asks for its own row; the history asks for actors.
        return json(route, [MANAGER_PROFILE]);
      }
      return route.fallback();
    }
    if (role !== "manager" && /inventory_|product_edit_requests/.test(path)) return json(route, []); // RLS: nothing for non-managers
    if (s.backendMissing && /inventory_|product_edit_requests/.test(path)) {
      const table = path.split("/").pop();
      return json(route, { code: "PGRST205", message: `Could not find the table 'public.${table}' in the schema cache`, details: null, hint: null }, 404);
    }

    if (path.endsWith("/inventory_settings")) return json(route, pickCols([s.settings], p.get("select")));
    if (path.endsWith("/inventory_counts")) {
      const rows = filterRows(s.counts, p).slice().sort((x, y) => y.created_at.localeCompare(x.created_at));
      return json(route, pickCols(rows, p.get("select")));
    }
    if (path.endsWith("/inventory_count_lines")) {
      const rows = filterRows(s.lines, p).slice().sort((x, y) => y.counted_at.localeCompare(x.counted_at));
      return json(route, pickCols(rows, p.get("select")));
    }
    if (path.endsWith("/inventory_events")) {
      const rows = filterRows(s.events, p).slice().sort((x, y) => y.id - x.id);
      return json(route, pickCols(rows, p.get("select")));
    }
    if (path.endsWith("/product_edit_requests")) {
      return json(route, pickCols(filterRows(s.edits, p), p.get("select")));
    }
    if (path.endsWith("/products") && p.get("id")?.startsWith("eq.")) {
      return json(route, pickCols(filterRows(INV_PRODUCTS, p), p.get("select")));
    }
    return route.fallback();
  });
}

/** Put a draft count with already-saved lines straight into the state. */
export function seedDraftCount(s: InvState, entries: [sku: string, qty: number, rivhit?: number | null][]): string {
  const c: Count = {
    id: uuid(seq++, "2222cccc"), storage_id: null, storage_name: null, status: "draft", note: null,
    created_by: USER.id, created_at: now(), approved_by: null, approved_at: null, finished_at: null, version: 1, mode: null,
  };
  s.counts.push(c);
  for (const [sku, qty, rivhit] of entries) {
    const p = BY_SKU(sku);
    const rb = rivhit === undefined ? p.stock_quantity : rivhit;
    s.lines.push({
      id: uuid(seq++, "3333dddd"), count_id: c.id, product_id: p.id, rivhit_id: p.rivhit_id, product_name: p.name, code_scanned: sku,
      counted_qty: qty, baseline_qty: p.stock_quantity, baseline_at: p.updated_at, counted_by: USER.id, counted_at: now(), version: 1,
      sync_status: "pending", sync_ref: null, rivhit_before_qty: null, delta: null, rivhit_doc_type: null, rivhit_doc_number: null,
      rivhit_after_qty: null, attempts: 0, last_error: null, synced_at: null, rivhit_baseline_qty: rb, rivhit_baseline_at: rb === null ? null : now(),
    });
  }
  return c.id;
}

/** An item-edit request already in the given status (e.g. stuck in 'unknown'). */
export function seedEditRequest(s: InvState, sku: string, status: string): string {
  const p = BY_SKU(sku);
  const id = uuid(seq++, "4444eeee");
  s.edits.push({ id, product_id: p.id, status, last_error: status === "failed" ? "שגיאה ברווחית" : null, finished_at: null, new_name: p.name + " חדש", new_barcode: p.barcode, new_sku: p.sku });
  return id;
}
