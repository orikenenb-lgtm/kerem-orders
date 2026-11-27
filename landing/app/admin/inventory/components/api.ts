// Every network call of the stock-count screen, in one place. Names and
// shapes follow docs/inventory/CONTRACT.md. Writes go ONLY through the inv_*
// RPCs and the inventory-sync edge function; tables are read-only here.

import { supabase } from "../../../../lib/supabaseClient";
import { parseRpcError, type ItemEditParams, type RpcError } from "../../../../lib/inventory";

export type Product = {
  product_id: string;
  rivhit_id: number;
  name: string;
  sku: string | null;
  barcode: string | null;
  picture_link: string | null;
  rotation_override: number | null;
  stock_quantity: number | null;
  unit_name: string | null;
  display_qty: number | null;
  display_name: string | null;
  is_active: boolean;
  updated_at: string | null;
};

export type Count = {
  id: string;
  storage_id: number | null;
  storage_name: string | null;
  status: string;
  note: string | null;
  created_by: string;
  created_at: string;
  approved_by: string | null;
  approved_at: string | null;
  finished_at: string | null;
  version: number;
  mode: string | null;
};

export type Line = {
  id: string;
  count_id: string;
  product_id: string;
  rivhit_id: number;
  product_name: string;
  code_scanned: string | null;
  counted_qty: number;
  baseline_qty: number;
  baseline_at: string | null;
  counted_by: string;
  counted_at: string;
  version: number;
  sync_status: string;
  rivhit_before_qty: number | null;
  delta: number | null;
  rivhit_doc_type: number | null;
  rivhit_doc_number: string | null;
  rivhit_after_qty: number | null;
  attempts: number;
  last_error: string | null;
  synced_at: string | null;
  /** R3: Rivhit's own quantity read right after the save (null = not verified). */
  rivhit_baseline_qty?: number | null;
  rivhit_baseline_at?: string | null;
};

export type Settings = { highlight_abs_diff: number; rivhit_writes_enabled: boolean };

export type SyncInfo = {
  mode: "live" | "simulation" | string;
  writes_enabled: boolean;
  configured: boolean;
  /** In simulation: one storage with storage_id null. */
  storages: { storage_id: number | null; storage_name: string }[];
  storages_error?: string;
};

/** What sync_count answers (only the fields the screen reads). */
export type SyncResult = { ok: boolean; stopped?: string | null; processed?: number; count_status?: string; mode?: string };

export type EventRow = {
  id: number;
  at: string;
  actor: string | null;
  count_id: string | null;
  product_id: string | null;
  kind: string;
  detail: Record<string, unknown> | null;
};

export type EditRequest = { id: string; status: string; last_error: string | null; finished_at: string | null };

export type Result<T> = { ok: true; data: T } | { ok: false; err: RpcError };

const COUNT_COLS = "id,storage_id,storage_name,status,note,created_by,created_at,approved_by,approved_at,finished_at,version,mode";
// "*" so the screen keeps working across additive column changes (R3 added
// rivhit_baseline_qty / rivhit_baseline_at). The table is manager-only anyway.
const LINE_COLS = "*";

type PgErr = { message?: string; code?: string } | null;
const fail = (error: PgErr, status?: number): { ok: false; err: RpcError } =>
  ({ ok: false, err: parseRpcError({ message: error?.message, code: error?.code, status }) });

// ----------------------------------------------------------------- reads ---

export async function fetchCounts(): Promise<Result<Count[]>> {
  const { data, error, status } = await supabase.from("inventory_counts").select(COUNT_COLS).order("created_at", { ascending: false }).limit(40);
  if (error) return fail(error, status);
  return { ok: true, data: (data ?? []) as Count[] };
}

export async function fetchCount(id: string): Promise<Result<Count | null>> {
  const { data, error, status } = await supabase.from("inventory_counts").select(COUNT_COLS).eq("id", id).maybeSingle();
  if (error) return fail(error, status);
  return { ok: true, data: (data as Count | null) ?? null };
}

export async function fetchLines(countId: string): Promise<Result<Line[]>> {
  const { data, error, status } = await supabase.from("inventory_count_lines").select(LINE_COLS).eq("count_id", countId).order("counted_at", { ascending: false });
  if (error) return fail(error, status);
  return { ok: true, data: (data ?? []) as Line[] };
}

export async function fetchSettings(): Promise<Settings> {
  const { data } = await supabase.from("inventory_settings").select("highlight_abs_diff,rivhit_writes_enabled").eq("id", 1).maybeSingle();
  const d = data as Partial<Settings> | null;
  return { highlight_abs_diff: Number(d?.highlight_abs_diff) > 0 ? Number(d?.highlight_abs_diff) : 20, rivhit_writes_enabled: !!d?.rivhit_writes_enabled };
}

export async function fetchEvents(countId: string): Promise<Result<EventRow[]>> {
  const { data, error, status } = await supabase.from("inventory_events").select("id,at,actor,count_id,product_id,kind,detail").eq("count_id", countId).order("at", { ascending: false }).limit(300);
  if (error) return fail(error, status);
  return { ok: true, data: (data ?? []) as EventRow[] };
}

export async function fetchPeople(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = Array.from(new Set(ids.filter(Boolean)));
  if (uniq.length === 0) return out;
  const { data } = await supabase.from("profiles").select("id,full_name,email").in("id", uniq);
  for (const p of (data ?? []) as { id: string; full_name: string | null; email: string | null }[]) out.set(p.id, p.full_name || p.email || "מנהל");
  return out;
}

/** One product by id, in the inv_lookup shape (used to reopen a line for a recount). */
export async function fetchProduct(productId: string): Promise<Product | null> {
  const { data } = await supabase.from("products")
    .select("id,rivhit_id,name,sku,barcode,picture_link,rotation_override,stock_quantity,unit_name,display_qty,display_name,is_active,updated_at")
    .eq("id", productId).maybeSingle();
  if (!data) return null;
  const { id, ...rest } = data as { id: string } & Omit<Product, "product_id">;
  return { product_id: id, ...rest };
}

export async function fetchEditRequest(id: string): Promise<EditRequest | null> {
  const { data } = await supabase.from("product_edit_requests").select("id,status,last_error,finished_at").eq("id", id).maybeSingle();
  return (data as EditRequest | null) ?? null;
}

export async function fetchOpenEditRequest(productId: string): Promise<EditRequest | null> {
  const { data } = await supabase.from("product_edit_requests").select("id,status,last_error,finished_at")
    .eq("product_id", productId).in("status", ["pending", "in_progress", "unknown"]).limit(1);
  return ((data ?? []) as EditRequest[])[0] ?? null;
}

// ------------------------------------------------------------------ RPCs ---

export async function lookup(code: string): Promise<Result<Product[]>> {
  const { data, error, status } = await supabase.rpc("inv_lookup", { p_code: code });
  if (error) return fail(error, status);
  return { ok: true, data: (data ?? []) as Product[] };
}

export async function search(q: string): Promise<Result<Product[]>> {
  // The server trims to 64 chars and returns nothing for an empty query.
  const { data, error, status } = await supabase.rpc("inv_search", { p_q: q.trim().slice(0, 64) });
  if (error) return fail(error, status);
  return { ok: true, data: (data ?? []) as Product[] };
}

export async function openCount(storageId: number | null, storageName: string | null, note: string | null): Promise<Result<string>> {
  const { data, error, status } = await supabase.rpc("inv_open_count", { p_storage_id: storageId, p_storage_name: storageName, p_note: note });
  if (error) return fail(error, status);
  return { ok: true, data: String(data) };
}

export type SavedLine = { line_id: string; version: number; counted_qty: number; baseline_qty: number; counted_at: string };

export async function saveLine(countId: string, productId: string, counted: number, expectedVersion: number | null, code: string | null): Promise<Result<SavedLine>> {
  const { data, error, status } = await supabase.rpc("inv_save_line", {
    p_count_id: countId, p_product_id: productId, p_counted: counted, p_expected_version: expectedVersion, p_code: code,
  });
  if (error) return fail(error, status);
  const row = (Array.isArray(data) ? data[0] : data) as SavedLine | undefined;
  // Never claim a save the server did not confirm.
  if (!row || typeof row.version !== "number") return { ok: false, err: { kind: "other", message: "השרת לא אישר את השמירה" } };
  return { ok: true, data: row };
}

export async function deleteLine(countId: string, productId: string, expectedVersion: number): Promise<Result<null>> {
  const { error, status } = await supabase.rpc("inv_delete_line", { p_count_id: countId, p_product_id: productId, p_expected_version: expectedVersion });
  if (error) return fail(error, status);
  return { ok: true, data: null };
}

export async function approveCount(countId: string, expectedVersion: number): Promise<Result<string>> {
  const { data, error, status } = await supabase.rpc("inv_approve", { p_count_id: countId, p_expected_version: expectedVersion });
  if (error) return fail(error, status);
  return { ok: true, data: String(data) };
}

export async function cancelCount(countId: string, expectedVersion: number): Promise<Result<null>> {
  const { error, status } = await supabase.rpc("inv_cancel", { p_count_id: countId, p_expected_version: expectedVersion });
  if (error) return fail(error, status);
  return { ok: true, data: null };
}

/** R2: skip a failed / unknown / changed line of a needs_attention count. Returns the new count status. */
export async function resolveLine(lineId: string, note: string): Promise<Result<string>> {
  const { data, error, status } = await supabase.rpc("inv_resolve_line", { p_line_id: lineId, p_note: note });
  if (error) return fail(error, status);
  return { ok: true, data: String(data) };
}

/** Close a stuck item-edit request (pending / unknown / failed → cancelled). Nothing is written to Rivhit. */
export async function closeItemEdit(requestId: string, note: string): Promise<Result<null>> {
  const { error, status } = await supabase.rpc("inv_close_item_edit", { p_request_id: requestId, p_note: note });
  if (error) return fail(error, status);
  return { ok: true, data: null };
}

export type Baseline = { ok?: boolean; rivhit_baseline_qty: number | null; rivhit_baseline_at: string | null };

/** R3: read Rivhit's quantity for a just-saved line. Never blocks the save. */
export async function captureBaseline(lineId: string, expectedVersion: number): Promise<Result<Baseline>> {
  return invokeSync<Baseline>({ action: "capture_baseline", line_id: lineId, expected_version: expectedVersion });
}

export async function requestItemEdit(productId: string, p: ItemEditParams): Promise<Result<string>> {
  // Price / description go through v2; a name/barcode/sku-only edit keeps
  // using v1, so the screen works the same before the v2 migration exists.
  const v2 = p.p_new_price !== undefined || p.p_new_description !== undefined;
  const { data, error, status } = await supabase.rpc(v2 ? "inv_request_item_edit_v2" : "inv_request_item_edit", { p_product_id: productId, ...p });
  if (error) return fail(error, status);
  return { ok: true, data: String(data) };
}

export type ItemDetails = { price: number | null; description: string };

/** Current price + description (manager-only RPC). null = not available
 *  (e.g. the v2 migration is not applied) — the screen then hides the fields. */
export async function fetchItemDetails(productId: string): Promise<ItemDetails | null> {
  const { data, error } = await supabase.rpc("inv_item_details", { p_product_id: productId });
  if (error || !Array.isArray(data) || !data.length) return null;
  const row = data[0] as { price: number | string | null; description: string | null };
  return { price: row.price == null ? null : Number(row.price), description: row.description ?? "" };
}

export type ItemPhotoState = {
  url: string | null;
  replace_rivhit: boolean;
  rivhit_picture_link: string | null;
  shown_picture_link: string | null;
};

/** Photo state for the item screen. null = not available (migration missing). */
export async function fetchItemPhoto(productId: string): Promise<ItemPhotoState | null> {
  const { data, error } = await supabase.rpc("inv_item_photo", { p_product_id: productId });
  if (error || !Array.isArray(data) || !data.length) return null;
  const r = data[0] as ItemPhotoState;
  return { url: r.url ?? null, replace_rivhit: !!r.replace_rivhit, rivhit_picture_link: r.rivhit_picture_link || null, shown_picture_link: r.shown_picture_link || null };
}

/** Upload the prepared JPEG to the product-photos bucket; returns its public URL. */
export async function uploadProductPhoto(productId: string, blob: Blob): Promise<Result<string>> {
  const path = `${productId}/${Date.now()}.jpg`;
  const { error } = await supabase.storage.from("product-photos").upload(path, blob, { contentType: "image/jpeg", upsert: false, cacheControl: "31536000" });
  if (error) return { ok: false, err: { kind: "other", message: error.message } as RpcError };
  const { data } = supabase.storage.from("product-photos").getPublicUrl(path);
  return { ok: true, data: data.publicUrl };
}

export async function setProductPhoto(productId: string, url: string, replace: boolean): Promise<Result<string>> {
  const { data, error, status } = await supabase.rpc("inv_set_product_photo", { p_product_id: productId, p_url: url, p_replace: replace });
  if (error) return fail(error, status);
  return { ok: true, data: String(data ?? "") };
}

export async function removeProductPhoto(productId: string): Promise<Result<string>> {
  const { data, error, status } = await supabase.rpc("inv_remove_product_photo", { p_product_id: productId });
  if (error) return fail(error, status);
  return { ok: true, data: String(data ?? "") };
}

// ---------------------------------------------------------- edge function --

/** POST to inventory-sync with the user's JWT (supabase-js adds it). */
export async function invokeSync<T>(body: Record<string, unknown>): Promise<Result<T>> {
  try {
    const { data, error } = await supabase.functions.invoke("inventory-sync", { body });
    if (error) {
      const name = (error as { name?: string }).name ?? "";
      if (name === "FunctionsFetchError" || name === "FunctionsRelayError") return { ok: false, err: { kind: "network" } };
      let text = "";
      let code = "";
      const ctx = (error as { context?: Response }).context;
      // inventory-sync answers {ok:false, error:<code>, message:<Hebrew>}.
      try {
        const b = await ctx?.json();
        text = b?.message || b?.error || "";
        code = String(b?.error ?? "");
      } catch { /* body not JSON */ }
      // A 404 that is not one of the function's own INV_* answers = the
      // function is not deployed yet.
      if (ctx?.status === 404 && !code.startsWith("INV_")) return { ok: false, err: { kind: "missing_backend" } };
      return { ok: false, err: { kind: "other", message: text || (error as Error).message || "" } };
    }
    const d = data as { ok?: boolean; error?: string; message?: string } | null;
    if (d && (d.ok === false || d.error)) return { ok: false, err: { kind: "other", message: d.message || d.error || "" } };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, err: { kind: "network" } };
  }
}
