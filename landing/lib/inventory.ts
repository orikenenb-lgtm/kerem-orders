// Stock count (ספירת מלאי) — PURE helpers for /admin/inventory.
//
// Nothing here touches the network, React or the DOM (storage is passed in),
// so tests/inventory.test.mjs can transpile this file and assert on it
// directly. The binding names and error shapes come from
// docs/inventory/CONTRACT.md.

// ---------------------------------------------------------------- codes ----

/** The charset the server accepts in inv_lookup (CONTRACT: 1–32 of [0-9A-Za-z-]). */
export const CODE_RE = /^[0-9A-Za-z-]{1,32}$/;

export type CodeResult = { ok: true; code: string } | { ok: false; error: string };

/**
 * Clean a scanned or typed code. Codes are TEXT: leading zeros are kept and
 * nothing is ever converted to a number. Scanners may add a trailing CR/LF or
 * a stray space; those are removed. Anything outside the server's charset is
 * refused here with a Hebrew message instead of a round trip.
 */
export function normalizeCode(raw: string | null | undefined): CodeResult {
  const s = String(raw ?? "").replace(/[\u0000-\u001F\u007F‎‏‪-‮]/g, "").trim();
  if (!s) return { ok: false, error: "לא התקבל ברקוד. סרקו או הקלידו שוב." };
  if (s.length > 32) return { ok: false, error: "הברקוד ארוך מדי (עד 32 תווים)." };
  if (!CODE_RE.test(s)) return { ok: false, error: "הברקוד מכיל תווים לא חוקיים. מותר: ספרות, אותיות באנגלית ומקף." };
  return { ok: true, code: s };
}

/** Max average gap between keystrokes (ms) for input to count as a scanner. */
export const WEDGE_MAX_AVG_MS = 35;
/** Max single gap (ms) inside a scanner burst. */
export const WEDGE_MAX_GAP_MS = 80;
/** Shortest burst treated as a scan. Shorter = a person typing a quantity. */
export const WEDGE_MIN_LEN = 6;

/**
 * Was this text typed by a keyboard-wedge scanner (a fast burst) rather than
 * a person? `timestamps` are the keydown times (ms) of each character in
 * `text`. People type at ~100–300 ms per key; scanners at ≤ 30 ms. A burst
 * needs ≥ minLen characters, an average gap ≤ 35 ms and no gap above 80 ms —
 * so a person typing "120" in the quantity field is never a scan.
 */
export function isWedgeBurst(timestamps: readonly number[], text: string, minLen = WEDGE_MIN_LEN): boolean {
  if (!text || text.length < minLen) return false;
  if (timestamps.length < minLen || timestamps.length !== text.length) return false;
  let max = 0;
  for (let i = 1; i < timestamps.length; i++) {
    const gap = timestamps[i] - timestamps[i - 1];
    if (gap < 0) return false;
    if (gap > max) max = gap;
  }
  const avg = (timestamps[timestamps.length - 1] - timestamps[0]) / (timestamps.length - 1);
  return avg <= WEDGE_MAX_AVG_MS && max <= WEDGE_MAX_GAP_MS;
}

// ------------------------------------------------------------- quantity ----

export const MAX_COUNT = 10_000_000;

export type CountResult = { ok: true; value: number } | { ok: false; error: string };

/**
 * Parse a counted quantity: an integer, 0 ≤ n ≤ 10,000,000 (the DB CHECK).
 * Spaces and thousands separators ("1,200") are accepted; decimals, signs and
 * letters are refused with a Hebrew message.
 */
export function parseCount(raw: string | number | null | undefined): CountResult {
  const s = String(raw ?? "").replace(/[\s,‎‏]/g, "");
  if (!s) return { ok: false, error: "הזינו כמות." };
  if (/^-/.test(s) || /^[−–]/.test(s)) return { ok: false, error: "כמות לא יכולה להיות שלילית." };
  if (/^\d+[.]\d*$/.test(s)) {
    if (/^\d+\.0*$/.test(s)) return parseCount(s.split(".")[0]);
    return { ok: false, error: "כמות חייבת להיות מספר שלם (בלי נקודה עשרונית)." };
  }
  if (!/^\d+$/.test(s)) return { ok: false, error: "הזינו ספרות בלבד." };
  if (s.length > 9) return { ok: false, error: `כמות גדולה מדי (עד ${MAX_COUNT.toLocaleString("he-IL")}).` };
  const n = Number(s);
  if (!Number.isSafeInteger(n)) return { ok: false, error: "הזינו ספרות בלבד." };
  if (n > MAX_COUNT) return { ok: false, error: `כמות גדולה מדי (עד ${MAX_COUNT.toLocaleString("he-IL")}).` };
  return { ok: true, value: n };
}

/**
 * The total to save for a re-scanned item. "replace" saves what was typed;
 * "add" saves saved + typed. Refuses a total above the DB limit.
 */
export function resolveTotal(mode: "replace" | "add", saved: number | null | undefined, entered: number): CountResult {
  const base = mode === "add" ? Number(saved) || 0 : 0;
  const total = base + entered;
  if (total > MAX_COUNT) return { ok: false, error: `הסכום (${total.toLocaleString("he-IL")}) גדול מהמותר (${MAX_COUNT.toLocaleString("he-IL")}).` };
  return { ok: true, value: total };
}

// ----------------------------------------------------------------- diff ----

/** counted − recorded. Positive = more on the shelf than in Rivhit. */
export function diffOf(counted: number, recorded: number): number {
  return (Number(counted) || 0) - (Number(recorded) || 0);
}

/** Highlight when |diff| ≥ the manager's threshold (inventory_settings). Zero never highlights. */
export function isHighlighted(diff: number, threshold: number | null | undefined): boolean {
  if (!diff) return false;
  const t = Number(threshold);
  const thr = Number.isFinite(t) && t > 0 ? t : 1;
  return Math.abs(diff) >= thr;
}

export type DiffTone = "pos" | "neg" | "zero";
export function diffTone(diff: number): DiffTone {
  return diff > 0 ? "pos" : diff < 0 ? "neg" : "zero";
}

/** "+5", "-3", "0" — always shown inside dir="ltr" so the sign stays left. */
export function formatSigned(diff: number): string {
  if (!diff) return "0";
  const abs = Math.abs(diff).toLocaleString("he-IL");
  return diff > 0 ? `+${abs}` : `-${abs}`;
}

/**
 * The difference the approval will actually send: counted − Rivhit's own
 * quantity captured right after the count (rivhit_baseline_qty, CONTRACT
 * Addendum 1 R3). NOT the site copy (baseline_qty). null = never verified
 * against Rivhit: the sync will stop that line for a recount, so it has no
 * difference to show.
 */
export function rivhitDiff(l: { counted_qty: number; rivhit_baseline_qty?: number | null }): number | null {
  if (l.rivhit_baseline_qty === null || l.rivhit_baseline_qty === undefined) return null;
  return diffOf(l.counted_qty, l.rivhit_baseline_qty);
}

/** Totals over VERIFIED lines only; `unverified` counts the rest (no diff, not in totals). */
export type DiffSummary = { lines: number; up: number; down: number; same: number; highlighted: number; netUnits: number; unverified: number };
export function summarizeDiffs(
  lines: readonly { counted_qty: number; rivhit_baseline_qty?: number | null }[],
  threshold: number | null | undefined,
): DiffSummary {
  const s: DiffSummary = { lines: lines.length, up: 0, down: 0, same: 0, highlighted: 0, netUnits: 0, unverified: 0 };
  for (const l of lines) {
    const d = rivhitDiff(l);
    if (d === null) { s.unverified++; continue; }
    if (d > 0) s.up++;
    else if (d < 0) s.down++;
    else s.same++;
    if (isHighlighted(d, threshold)) s.highlighted++;
    s.netUnits += d;
  }
  return s;
}

// -------------------------------------------------------------- statuses ---

/** The five words a manager sees. Internal statuses never reach the screen. */
export const LABELS = {
  draft: "טיוטה",
  waiting: "ממתין לעדכון",
  syncing: "מתעדכן",
  done: "הושלם",
  attention: "דורש טיפול",
} as const;
export type UserLabel = (typeof LABELS)[keyof typeof LABELS];
export type LabelKey = keyof typeof LABELS;

export const ACTIVE_COUNT_STATUSES = ["draft", "approved", "syncing", "needs_attention"] as const;

export function isActiveCount(status: string | null | undefined): boolean {
  return (ACTIVE_COUNT_STATUSES as readonly string[]).includes(String(status));
}

/** inventory_counts.status → label key. 'cancelled' is shown as its own word. */
export function countStatusKey(status: string | null | undefined): LabelKey | "cancelled" {
  switch (status) {
    case "draft": return "draft";
    case "approved": return "waiting";
    case "syncing": return "syncing";
    case "done": return "done";
    case "needs_attention": return "attention";
    case "cancelled": return "cancelled";
    default: return "attention";
  }
}

/** A finished count where the manager skipped lines (Addendum 1, R2). */
export const DONE_WITH_SKIPS = "הושלם (עם פריטים שדולגו)";

export function countStatusLabel(status: string | null | undefined, hasSkipped = false): string {
  const k = countStatusKey(status);
  if (k === "done" && hasSkipped) return DONE_WITH_SKIPS;
  return k === "cancelled" ? "בוטלה" : LABELS[k];
}

/** inventory_count_lines.sync_status (+ its count's status) → label key. */
export function lineStatusKey(syncStatus: string | null | undefined, countStatus?: string | null): LabelKey {
  if (countStatus === "draft" || countStatus === "cancelled") return "draft";
  switch (syncStatus) {
    case "pending": return "waiting";
    case "in_progress":
    case "sent": return "syncing";
    case "done":
    case "no_change": return "done";
    case "unknown":
    case "failed":
    case "changed": return "attention";
    default: return "attention";
  }
}

/** A line the manager decided not to sync (inv_resolve_line). */
export const SKIPPED_LABEL = "דולג";

export function lineStatusLabel(syncStatus: string | null | undefined, countStatus?: string | null): UserLabel | typeof SKIPPED_LABEL {
  if (syncStatus === "skipped" && countStatus !== "draft") return SKIPPED_LABEL;
  return LABELS[lineStatusKey(syncStatus, countStatus)];
}

/** Statuses a manager may skip in a needs_attention count. */
export function canSkipLine(syncStatus: string | null | undefined, countStatus: string | null | undefined): boolean {
  return countStatus === "needs_attention" && ["failed", "unknown", "changed"].includes(String(syncStatus));
}

/** Edit requests a manager may close (inv_close_item_edit). */
export function canCloseEdit(status: string | null | undefined): boolean {
  return ["pending", "unknown", "failed"].includes(String(status));
}
export const CLOSE_EDIT_WARNING = "סגירת הבקשה לא משנה דבר באתר או ברווחית. אם הסטטוס היה 'דורש בדיקה' — ייתכן שהשינוי כבר קיים ברווחית; בדקו שם ידנית.";

/** Shown instead of a difference for a line never verified against Rivhit. */
export const UNVERIFIED_REVIEW_TEXT = "לא אומת מול רווחית — יסומן 'ספור מחדש' ולא יעודכן";

/** The binding warning shown before skipping a line (CONTRACT Addendum 1, R2). */
export const SKIP_WARNING = "הפריט לא יעודכן בספירה הזו. אם הסטטוס היה 'דורש בדיקה' — ייתכן שתעודה כבר נוצרה ברווחית; בדקו ברווחית ידנית";

/** The skip note: required, 3–500 characters after trimming. */
export function validateSkipNote(note: string): { ok: true; note: string } | { ok: false; error: string } {
  const n = String(note ?? "").trim();
  if (n.length < 3) return { ok: false, error: "כתבו סיבה קצרה (3 תווים לפחות)." };
  if (n.length > 500) return { ok: false, error: "הסיבה ארוכה מדי (עד 500 תווים)." };
  return { ok: true, note: n };
}

/**
 * Plausibility (R8): a count above max(1000, 10 × the record shown) needs an
 * explicit confirmation — "5" + a 5-digit code + Enter must not become 500,777.
 */
export function isImplausibleCount(qty: number, recorded: number | null | undefined): boolean {
  const r = Math.max(0, Number(recorded) || 0);
  return qty > Math.max(1000, 10 * r);
}
export const IMPLAUSIBLE_CONFIRM = "הכמות גבוהה מאוד — לאשר?";

/** R3 indicator after a save. */
export const VERIFIED_TEXT = "✓ אומת מול רווחית";
export const NOT_VERIFIED_TEXT = "לא אומת — ייבדק באישור";

/** product_edit_requests.status → label. */
export function editStatusLabel(status: string | null | undefined): UserLabel | "בוטלה" {
  switch (status) {
    case "cancelled": return "בוטלה";
    case "pending": return LABELS.waiting;
    case "in_progress": return LABELS.syncing;
    case "done": return LABELS.done;
    default: return LABELS.attention;
  }
}

export type Attention =
  | { action: "recount"; reason: string; actionLabel: "ספור מחדש" }
  | { action: "recheck"; reason: string; actionLabel: "בדיקה חוזרת" }
  | { action: "none"; reason: string };

/** Why a line says "דורש טיפול", and what the manager can do about it. */
export function lineAttention(syncStatus: string | null | undefined, lastError?: string | null): Attention | null {
  switch (syncStatus) {
    case "changed":
      return { action: "recount", actionLabel: "ספור מחדש", reason: lastError ? `${lastError}.` : "המלאי ברווחית השתנה מאז הספירה (מכירה או קליטה בינתיים). כדי לא לטעות — סופרים את הפריט שוב." };
    case "unknown":
      return { action: "recheck", actionLabel: "בדיקה חוזרת", reason: "לא ידוע אם רווחית קלטה את העדכון (החיבור נקטע או שהבדיקה לא התאימה)." };
    case "failed":
      return { action: "none", reason: `רווחית דחתה את העדכון${lastError ? `: ${lastError}` : "."} שום מסמך לא נוצר.` };
    default:
      return null;
  }
}

// ------------------------------------------------------------ RPC errors ---

export type RpcError =
  | { kind: "conflict"; qty: number | null; status: string | null; version: number | null }
  | { kind: "active_exists"; countId: string }
  | { kind: "duplicate_code"; productName: string }
  | { kind: "forbidden" }
  | { kind: "bad_code" }
  | { kind: "bad_qty" }
  | { kind: "bad_input"; field: string }
  | { kind: "not_found" }
  | { kind: "product_unavailable" }
  | { kind: "not_draft"; status: string }
  /** inv_resolve_line: INV_NOT_RESOLVABLE:<count status>:<line status>;
   *  inv_close_item_edit: INV_NOT_RESOLVABLE:<request status> (lineStatus null). */
  | { kind: "not_resolvable"; countStatus: string; lineStatus: string | null }
  | { kind: "empty" }
  | { kind: "no_change" }
  | { kind: "edit_pending"; requestId: string }
  | { kind: "unique" }
  | { kind: "missing_backend" }
  | { kind: "network" }
  | { kind: "other"; message: string };

type ErrLike = { message?: string | null; code?: string | null; status?: number | null } | null | undefined;

/** The sentence shown while the migration / edge function is not installed. */
export const BACKEND_MISSING_TEXT = "ספירת המלאי עדיין לא הופעלה בשרת";

/** PostgREST "function / table not found" — the backend is not installed yet. */
export function isMissingBackend(err: ErrLike): boolean {
  if (!err) return false;
  const code = String(err.code ?? "");
  if (["PGRST202", "PGRST205", "42P01", "42883"].includes(code)) return true;
  const msg = String(err.message ?? "");
  if (/INV_|להנהלה בלבד/.test(msg)) return false;
  if (/could not find the (function|table)|relation .* does not exist|function .* does not exist|requested function was not found/i.test(msg)) return true;
  return err.status === 404;
}

/** A request that never reached the server (offline, DNS, aborted). */
export function isNetworkError(err: ErrLike): boolean {
  if (!err) return false;
  if (err.code) return false;
  if (err.status === 0) return true;
  return /failed to fetch|fetcherror|networkerror|network request failed|load failed|typeerror|aborterror|failed to send a request|ERR_/i.test(String(err.message ?? ""));
}

/** Map a PostgREST/RPC error to one of the contract's shapes. */
export function parseRpcError(err: ErrLike): RpcError {
  if (isNetworkError(err)) return { kind: "network" };
  if (isMissingBackend(err)) return { kind: "missing_backend" };
  const msg = String(err?.message ?? "");
  const conflict = msg.match(/INV_CONFLICT(?::([^:\s]*):(\d+))?/);
  if (conflict) {
    const first = conflict[1] ?? null;
    const isNum = first !== null && /^\d+$/.test(first);
    return {
      kind: "conflict",
      qty: isNum ? Number(first) : null,
      status: first !== null && !isNum ? first : null,
      version: conflict[2] != null ? Number(conflict[2]) : null,
    };
  }
  const active = msg.match(/INV_ACTIVE_EXISTS:([0-9a-fA-F-]{8,})/);
  if (active) return { kind: "active_exists", countId: active[1] };
  const dup = msg.match(/INV_DUPLICATE_CODE:([\s\S]*)$/);
  if (dup) return { kind: "duplicate_code", productName: dup[1].trim() };
  const pend = msg.match(/INV_EDIT_PENDING:([0-9a-fA-F-]{8,})/);
  if (pend) return { kind: "edit_pending", requestId: pend[1] };
  const notRes = msg.match(/INV_NOT_RESOLVABLE:([a-z_]+)(?::([a-z_]+))?/);
  if (notRes) return { kind: "not_resolvable", countStatus: notRes[1], lineStatus: notRes[2] ?? null };
  const notDraft = msg.match(/INV_NOT_DRAFT:([a-z_]+)/);
  if (notDraft) return { kind: "not_draft", status: notDraft[1] };
  const badInput = msg.match(/INV_BAD_INPUT:([a-z_]+)/);
  if (badInput) return { kind: "bad_input", field: badInput[1] };
  if (/INV_BAD_CODE\b/.test(msg)) return { kind: "bad_code" };
  if (/INV_BAD_QTY\b/.test(msg)) return { kind: "bad_qty" };
  if (/INV_PRODUCT_UNAVAILABLE\b/.test(msg)) return { kind: "product_unavailable" };
  if (/INV_NOT_FOUND\b/.test(msg)) return { kind: "not_found" };
  if (/INV_EMPTY\b/.test(msg)) return { kind: "empty" };
  if (/INV_NO_CHANGE\b/.test(msg)) return { kind: "no_change" };
  if (msg.includes("להנהלה בלבד")) return { kind: "forbidden" };
  if (err?.code === "23505") return { kind: "unique" };
  return { kind: "other", message: msg };
}

/** A Hebrew sentence for an RPC error (screens add their own context). */
export function rpcErrorText(e: RpcError): string {
  switch (e.kind) {
    case "network": return "אין חיבור לשרת. בדקו את האינטרנט ונסו שוב.";
    case "missing_backend": return `${BACKEND_MISSING_TEXT}.`;
    case "conflict":
      return e.qty !== null
        ? `מנהל אחר שמר בינתיים כמות ${e.qty.toLocaleString("he-IL")} לפריט הזה.`
        : e.status
          ? `הספירה כבר במצב "${countStatusLabel(e.status)}" — מישהו עדכן אותה בינתיים.`
          : "מישהו עדכן את הנתון הזה בינתיים.";
    case "active_exists": return "כבר יש ספירה פתוחה למחסן הזה.";
    case "duplicate_code": return `הקוד כבר שייך למוצר אחר: ${e.productName}.`;
    case "forbidden": return "להנהלה בלבד.";
    case "bad_code": return "קוד לא חוקי. מותר: ספרות, אותיות באנגלית ומקף.";
    case "bad_qty": return `כמות לא חוקית (מספר שלם בין 0 ל-${MAX_COUNT.toLocaleString("he-IL")}).`;
    case "bad_input": {
      const f: Record<string, string> = { note: "ההערה ארוכה מדי (עד 500 תווים).", storage_name: "שם המחסן ארוך מדי.", name: "שם הפריט חייב להיות באורך 1 עד 100 תווים.", sku: "אי אפשר למחוק את המק\"ט." };
      return f[e.field] ?? "ערך לא חוקי.";
    }
    case "not_found": return "לא נמצא (אולי נמחק בינתיים). רעננו את המסך.";
    case "product_unavailable": return "הפריט לא פעיל או לא מקושר לרווחית — אי אפשר לספור או לערוך אותו כאן.";
    case "not_draft": return `הספירה כבר במצב "${countStatusLabel(e.status)}" — אי אפשר לשנות בה כמויות.`;
    case "not_resolvable":
      return e.lineStatus === null
        ? `אי אפשר לסגור את הבקשה: היא כבר במצב "${editStatusLabel(e.countStatus)}".`
        : `אי אפשר לדלג על הפריט: הוא כבר במצב "${lineStatusLabel(e.lineStatus, e.countStatus)}" והספירה במצב "${countStatusLabel(e.countStatus)}". המסך רוענן.`;
    case "empty": return "אין בספירה אף פריט — אין מה לאשר.";
    case "no_change": return "לא שיניתם כלום.";
    case "edit_pending": return "כבר יש בקשת עריכה פתוחה לפריט הזה.";
    case "unique": return "כבר יש בקשה פתוחה לנתון הזה.";
    default: return e.message ? `השרת דחה את הפעולה: ${e.message}` : "הפעולה נכשלה.";
  }
}

// -------------------------------------------------- pending local entries --

/** A typed value that the server has not confirmed yet. */
export type PendingEntry = {
  countId: string;
  productId: string;
  name: string;
  /** The TOTAL to save (already resolved from replace/add). */
  qty: number;
  /** The line version the save expects (null = new line). */
  expectedVersion: number | null;
  code: string | null;
  /** ms epoch when it was typed. */
  at: number;
};

export const PENDING_KEY = "kt_inv_pending_v1";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function readAll(storage: StorageLike | null | undefined): PendingEntry[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(PENDING_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter((e): e is PendingEntry =>
      !!e && typeof e === "object"
      && typeof (e as PendingEntry).countId === "string"
      && typeof (e as PendingEntry).productId === "string"
      && Number.isInteger((e as PendingEntry).qty)
      && (e as PendingEntry).qty >= 0 && (e as PendingEntry).qty <= MAX_COUNT);
  } catch {
    return [];
  }
}

function writeAll(storage: StorageLike | null | undefined, all: PendingEntry[]): boolean {
  if (!storage) return false;
  try {
    if (all.length === 0) storage.removeItem(PENDING_KEY);
    else storage.setItem(PENDING_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

/** Unsaved entries for one count, oldest first. */
export function loadPending(storage: StorageLike | null | undefined, countId: string): PendingEntry[] {
  return readAll(storage).filter((e) => e.countId === countId).sort((a, b) => a.at - b.at);
}

/** Keep (or replace) the unsaved value for one product. Returns false if storage is unavailable. */
export function putPending(storage: StorageLike | null | undefined, entry: PendingEntry): boolean {
  const all = readAll(storage).filter((e) => !(e.countId === entry.countId && e.productId === entry.productId));
  all.push(entry);
  return writeAll(storage, all);
}

/** Forget a value once the server confirmed it (or the manager discarded it). */
export function removePending(storage: StorageLike | null | undefined, countId: string, productId: string): boolean {
  const all = readAll(storage);
  const next = all.filter((e) => !(e.countId === countId && e.productId === productId));
  if (next.length === all.length) return true;
  return writeAll(storage, next);
}

// ---------------------------------------------------------------- misc ----

/** ms epoch — a named helper so event handlers can stamp entries. */
export function nowMs(): number {
  return Date.now();
}

/** "24.11.2026, 14:05" in Israel time; "—" for nothing. */
export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** First 8 hex chars of a uuid — how a count is named in Rivhit comments. */
export function shortId(id: string | null | undefined): string {
  return String(id ?? "").replace(/-/g, "").slice(0, 8);
}

/** inventory_events.kind → Hebrew. Unknown kinds fall back to the raw kind. */
export function eventLabel(kind: string): string {
  const map: Record<string, string> = {
    count_opened: "הספירה נפתחה",
    line_saved: "כמות נשמרה",
    line_deleted: "שורה נמחקה",
    count_approved: "הספירה אושרה",
    count_cancelled: "הספירה בוטלה",
    item_edit_requested: "בקשת עריכת פריט",
    item_edit_applied: "עריכת פריט עודכנה",
    item_edit_done: "עריכת הפריט עודכנה ברווחית ובאתר",
    item_edit_failed: "עריכת הפריט נדחתה ברווחית",
    item_edit_unknown: "עריכת הפריט — דורש בדיקה",
    item_edit_pending: "עריכת הפריט ממתינה לעדכון",
    doc_sent: "נשלח מסמך מלאי לרווחית",
    doc_already_processed: "רווחית: המסמך כבר נקלט קודם (ללא כפילות)",
    line_done: "השורה עודכנה ואומתה",
    local_update_failed: "רווחית עודכנה, עדכון האתר ייעשה בבדיקה הבאה",
    verify_failed: "לא ניתן היה לאמת מול רווחית",
    verify_mismatch: "הכמות ברווחית לא תאמה לצפוי — דורש בדיקה",
    check_only: "בדיקה מקדימה מול רווחית (ללא שינוי)",
    sync_started: "העדכון לרווחית התחיל",
    sync_finished: "העדכון לרווחית הסתיים",
    line_changed: "המלאי ברווחית השתנה מאז הספירה",
    line_unknown: "לא ידוע אם העדכון נקלט",
    line_failed: "העדכון נדחה ברווחית",
    line_no_change: "אין הפרש — לא נדרש עדכון",
    line_recovered: "שורה שוחררה לניסיון חוזר",
    line_released: "שורה הוחזרה להמתנה",
    line_error: "שגיאה בעדכון שורה",
    line_lost: "שורה נתפסה ע״י תהליך אחר",
    sync_stopped: "העדכון לרווחית נעצר",
    line_skipped: "פריט דולג (החלטת מנהל)",
    item_edit_cancelled: "בקשת עריכה נסגרה (החלטת מנהל)",
    baseline_captured: "כמות רווחית נקלטה בזמן הספירה",
  };
  return map[kind] ?? kind;
}

/** eventLabel + " (סימולציה)" when the event says it was simulated. */
export function eventLabelFor(kind: string, detail: unknown): string {
  const sim = !!detail && typeof detail === "object" && (detail as { mode?: unknown }).mode === "simulation";
  if (!sim) return eventLabel(kind);
  // A simulated item edit changed nothing — never claim "ברווחית ובאתר".
  if (kind === "item_edit_done") return "עריכת הפריט הושלמה (סימולציה — לא שונה דבר ברווחית או באתר)";
  return `${eventLabel(kind)} (סימולציה)`;
}

/**
 * Item-edit request fields (inv_request_item_edit): every field null =
 * unchanged; barcode '' = clear; sku cannot be cleared; codes are 1–15 of
 * [0-9A-Za-z-]; name is trimmed, 1–100 chars. Returns the RPC params (only
 * the fields that really change are sent) or a Hebrew error.
 */
export function buildItemEdit(
  current: { name: string; barcode: string | null; sku: string | null },
  next: { name: string; barcode: string; sku: string },
): { ok: true; params: { p_new_name: string | null; p_new_barcode: string | null; p_new_sku: string | null }; changed: ("name" | "barcode" | "sku")[] } | { ok: false; error: string } {
  const name = next.name.trim();
  if (name.length < 1 || name.length > 100) return { ok: false, error: "שם הפריט חייב להיות באורך 1 עד 100 תווים." };
  const bc = next.barcode.trim();
  const sku = next.sku.trim();
  const re = /^[0-9A-Za-z-]{1,15}$/;
  if (bc !== "" && !re.test(bc)) return { ok: false, error: "ברקוד: עד 15 תווים — ספרות, אותיות באנגלית ומקף." };
  if (sku === "") return { ok: false, error: "אי אפשר למחוק את המק\"ט." };
  if (!re.test(sku)) return { ok: false, error: "מק\"ט: עד 15 תווים — ספרות, אותיות באנגלית ומקף." };
  const changed: ("name" | "barcode" | "sku")[] = [];
  if (name !== current.name.trim()) changed.push("name");
  const bcChanged = bc !== (current.barcode ?? "").trim();
  if (bcChanged) changed.push("barcode");
  const skuChanged = sku !== (current.sku ?? "").trim();
  if (skuChanged) changed.push("sku");
  if (changed.length === 0) return { ok: false, error: "לא שיניתם כלום." };
  return {
    ok: true,
    changed,
    params: { p_new_name: changed.includes("name") ? name : null, p_new_barcode: bcChanged ? bc : null, p_new_sku: skuChanged ? sku : null },
  };
}
