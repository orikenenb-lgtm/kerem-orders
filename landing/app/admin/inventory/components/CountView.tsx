"use client";

// The counting loop: סרוק → הזן כמות → שמור והמשך.
//
// Server first: success is shown only after inv_save_line answers. Before the
// call the value is written to localStorage (a "pending entry") and removed
// only once the server confirmed it, so a dropped connection, a refresh or a
// closed tab never loses a typed number.

import { useEffect, useMemo, useRef, useState } from "react";
import { tokens } from "../../../../lib/ui";
import {
  IMPLAUSIBLE_CONFIRM, isImplausibleCount, loadPending, normalizeCode, NOT_VERIFIED_TEXT, nowMs, VERIFIED_TEXT, parseCount, putPending, removePending, resolveTotal, rpcErrorText,
  type PendingEntry,
} from "../../../../lib/inventory";
import { captureBaseline, fetchLines, fetchProduct, lookup, saveLine, search, type Count, type Line, type Product } from "./api";
import ItemCard, { type SaveMode } from "./ItemCard";
import ItemEdit from "./ItemEdit";
import Scanner from "./Scanner";
import WedgeInput, { type WedgeHandle } from "./WedgeInput";
import { bigBtn, card, field, labelStyle, msgStyle, note, secondaryBtn, WARN } from "./styles";

type Msg = { ok: boolean; text: string; retry?: () => void; retryLabel?: string; lineId?: string } | null;
type Verify = { lineId: string; state: "pending" | "ok" | "no" } | null;
type Conflict = { entry: PendingEntry; theirs: number | null; version: number | null; entered: number; addMode: boolean };

const store = (): Storage | null => {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
};

export default function CountView({ count, lines, simulation, onLinesChanged, initialProductId }: {
  count: Count;
  lines: Line[];
  simulation: boolean;
  /** The parent refetches lines (and keeps them) — returns the fresh list. */
  onLinesChanged: (fresh?: Line[]) => Promise<Line[] | null>;
  initialProductId: string | null;
}) {
  const countId = count.id;
  const draft = count.status === "draft";
  const recountOpen = count.status === "needs_attention";
  const canCount = draft || recountOpen;

  const [msg, setMsg] = useState<Msg>(null);
  const [verify, setVerify] = useState<Verify>(null);
  const [busy, setBusy] = useState(false);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [choices, setChoices] = useState<{ code: string; items: Product[] } | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Product[] | null>(null);
  const [item, setItem] = useState<{ product: Product; code: string | null } | null>(null);
  const [qty, setQty] = useState("");
  const [mode, setMode] = useState<SaveMode | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [editing, setEditing] = useState(false);
  const [camera, setCamera] = useState(false);
  const [pending, setPending] = useState<PendingEntry[]>(() => loadPending(store(), countId));

  const wedgeRef = useRef<WedgeHandle | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const byProduct = useMemo(() => new Map(lines.map((l) => [l.product_id, l])), [lines]);
  const existing = item ? byProduct.get(item.product.product_id) ?? null : null;
  const isRecount = !!existing && recountOpen && existing.sync_status === "changed";

  const refreshPending = () => setPending(loadPending(store(), countId));
  const focusScan = () => { setTimeout(() => wedgeRef.current?.focus(), 0); };

  const closeItem = () => {
    setItem(null); setQty(""); setMode(null); setEditing(false); setConflict(null);
  };

  const openItem = (product: Product, code: string | null) => {
    const line = byProduct.get(product.product_id) ?? null;
    if (!draft) {
      if (!(recountOpen && line && line.sync_status === "changed")) {
        setMsg({ ok: false, text: "הספירה כבר אושרה. אפשר לספור מחדש רק פריטים שמסומנים ״ספור מחדש״ בסיכום." });
        return;
      }
    }
    setChoices(null); setNotFound(null); setResults(null); setConflict(null); setEditing(false);
    setItem({ product, code });
    setQty("");
    setMode(line && !(recountOpen && line.sync_status === "changed") ? null : "replace");
  };

  // Recount opened from the review screen ("ספור מחדש").
  useEffect(() => {
    if (!initialProductId) return;
    let live = true;
    void fetchProduct(initialProductId).then((p) => {
      if (!live) return;
      if (p) openItem(p, null);
      else setMsg({ ok: false, text: "לא הצלחנו לטעון את הפריט. סרקו אותו." });
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialProductId]);

  /** `typed` overrides the quantity state when the caller knows it better
   *  (a scanner burst just removed itself from the quantity field). */
  const handleCode = async (raw: string, typed: string = qty) => {
    if (saving || busy) return;
    if (item && typed.trim()) {
      setMsg({ ok: false, text: `יש כמות שלא נשמרה ל״${item.product.name}״. שמרו אותה או לחצו ״ביטול״, ואז סרקו שוב.` });
      return;
    }
    const norm = normalizeCode(raw);
    if (!norm.ok) { setMsg({ ok: false, text: norm.error }); return; }
    const code = norm.code;
    setBusy(true);
    setMsg(null); setNotFound(null); setChoices(null); setResults(null);
    const r = await lookup(code);
    if (!mountedRef.current) return;
    setBusy(false);
    if (!r.ok) {
      setMsg({ ok: false, text: rpcErrorText(r.err), retry: () => void handleCode(code), retryLabel: "נסו שוב" });
      return;
    }
    if (r.data.length === 0) {
      closeItem();
      setNotFound(code);
      setTimeout(() => searchRef.current?.focus(), 0);
      return;
    }
    if (r.data.length > 1) {
      closeItem();
      setChoices({ code, items: r.data });
      return;
    }
    openItem(r.data[0], code);
  };

  const runSearch = async () => {
    const term = q.trim();
    if (term.length < 2) { setMsg({ ok: false, text: "הקלידו לפחות 2 תווים לחיפוש." }); return; }
    setBusy(true); setMsg(null);
    const r = await search(term);
    if (!mountedRef.current) return;
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, text: rpcErrorText(r.err), retry: () => void runSearch(), retryLabel: "נסו שוב" }); return; }
    setResults(r.data);
  };

  /** One save attempt for an entry already written to localStorage. */
  const attemptSave = async (entry: PendingEntry, ctx: { entered: number; addMode: boolean }) => {
    setSaving(true);
    setMsg(null);
    const r = await saveLine(entry.countId, entry.productId, entry.qty, entry.expectedVersion, entry.code);
    if (!mountedRef.current) return;
    if (r.ok) {
      removePending(store(), entry.countId, entry.productId);
      refreshPending();
      const fresh = await onLinesChanged();
      if (!mountedRef.current) return;
      setSaving(false);
      setConflict(null);
      if (item && item.product.product_id === entry.productId) closeItem();
      const n = (fresh ?? lines).length;
      const lineId = r.data.line_id;
      setMsg({ ok: true, lineId, text: `נשמר: ${entry.name} — ${r.data.counted_qty.toLocaleString("he-IL")} יח׳. נספרו ${n.toLocaleString("he-IL")} פריטים.` });
      focusScan();
      // R3: read Rivhit's own quantity for this line. Non-blocking: the save
      // above is already confirmed; a failure here only means the approval
      // will check it (and ask for a recount if needed).
      setVerify({ lineId, state: "pending" });
      void captureBaseline(lineId, r.data.version).then((b) => {
        if (!mountedRef.current) return;
        const ok = b.ok && b.data?.rivhit_baseline_qty !== null && b.data?.rivhit_baseline_qty !== undefined;
        setVerify((v) => (v && v.lineId === lineId ? { lineId, state: ok ? "ok" : "no" } : v));
        if (b.ok) void onLinesChanged();
      });
      return;
    }
    const err = r.err;
    if (err.kind === "network") {
      setSaving(false);
      refreshPending();
      setMsg({ ok: false, text: "השמירה נכשלה — הערך נשמר במכשיר.", retry: () => void attemptSave(entry, ctx), retryLabel: "נסו שוב" });
      return;
    }
    if (err.kind === "conflict") {
      let theirs = err.qty;
      let version = err.version;
      if (theirs === null) {
        const fl = await fetchLines(entry.countId);
        if (!mountedRef.current) return;
        const l = fl.ok ? fl.data.find((x) => x.product_id === entry.productId) : undefined;
        if (l) { theirs = l.counted_qty; version = l.version; }
        if (fl.ok) void onLinesChanged(fl.data);
      } else {
        void onLinesChanged();
      }
      setSaving(false);
      refreshPending();
      setConflict({ entry, theirs, version, entered: ctx.entered, addMode: ctx.addMode });
      return;
    }
    // A definite refusal: nothing was saved, and retrying would be refused again.
    removePending(store(), entry.countId, entry.productId);
    refreshPending();
    setSaving(false);
    setMsg({ ok: false, text: `לא נשמר: ${rpcErrorText(err)}` });
  };

  const save = () => {
    if (!item || saving) return;
    if (existing && !isRecount && mode === null) {
      setMsg({ ok: false, text: "בחרו קודם: ״החלפת הכמות״ או ״הוספה לכמות״." });
      return;
    }
    const p = parseCount(qty);
    if (!p.ok) { setMsg({ ok: false, text: p.error }); return; }
    const effMode: SaveMode = isRecount || !existing ? "replace" : (mode ?? "replace");
    const t = resolveTotal(effMode, existing?.counted_qty, p.value);
    if (!t.ok) { setMsg({ ok: false, text: t.error }); return; }
    // R8: an implausible total is never saved without an explicit yes.
    const rec = Number(item.product.stock_quantity ?? 0);
    if (isImplausibleCount(t.value, rec)
      && !window.confirm(`${IMPLAUSIBLE_CONFIRM}\n${t.value.toLocaleString("he-IL")} יח׳ — ברווחית רשומות ${rec.toLocaleString("he-IL")}.`)) {
      setMsg({ ok: false, text: `לא נשמר. בדקו את הכמות (${t.value.toLocaleString("he-IL")}) ושמרו שוב.` });
      return;
    }
    const entry: PendingEntry = {
      countId, productId: item.product.product_id, name: item.product.name, qty: t.value,
      expectedVersion: existing ? existing.version : null, code: item.code, at: nowMs(),
    };
    putPending(store(), entry);
    void attemptSave(entry, { entered: p.value, addMode: effMode === "add" });
  };

  const resolveConflict = (choice: "theirs" | "mine" | "add") => {
    if (!conflict) return;
    const { entry, theirs, version, entered } = conflict;
    if (choice === "theirs") {
      removePending(store(), entry.countId, entry.productId);
      refreshPending();
      setConflict(null);
      if (item && item.product.product_id === entry.productId) closeItem();
      setMsg({ ok: true, text: `נשארה הכמות ${theirs?.toLocaleString("he-IL") ?? "השמורה"} ל״${entry.name}״.` });
      focusScan();
      return;
    }
    const qtyNext = choice === "add" && theirs !== null ? theirs + entered : entry.qty;
    const t = resolveTotal("replace", 0, qtyNext);
    if (!t.ok) { setMsg({ ok: false, text: t.error }); return; }
    const next: PendingEntry = { ...entry, qty: t.value, expectedVersion: version, at: nowMs() };
    putPending(store(), next);
    setConflict(null);
    void attemptSave(next, { entered, addMode: false });
  };

  const discardPending = (e: PendingEntry) => {
    removePending(store(), e.countId, e.productId);
    refreshPending();
  };

  const visiblePending = pending.filter((p) => !(item && p.productId === item.product.product_id) && !(conflict && conflict.entry.productId === p.productId));

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      {!canCount && (
        <p role="note" style={{ ...msgStyle(true), color: tokens.body }}>
          הספירה הזאת כבר לא בטיוטה — אי אפשר להוסיף או לשנות כמויות. ההפרשים והמצב — במסך ״סיכום ואישור״.
        </p>
      )}
      {recountOpen && (
        <p role="note" style={{ ...note, color: WARN, fontSize: "0.92rem" }}>
          ספירה חוזרת: אפשר לספור שוב רק פריטים שהמלאי שלהם ברווחית השתנה מאז הספירה (״ספור מחדש״ בסיכום).
        </p>
      )}

      {visiblePending.length > 0 && (
        <section aria-label="ערכים שלא נשמרו בשרת" role="alert" style={{ ...card, borderColor: "rgba(180,83,9,0.45)", background: "rgba(180,83,9,0.05)", display: "grid", gap: "0.5rem" }}>
          <div style={{ fontFamily: tokens.rubik, fontWeight: 800, color: WARN }}>
            {visiblePending.length === 1 ? "ערך אחד" : `${visiblePending.length} ערכים`} שמורים במכשיר ועוד לא נשמרו בשרת
          </div>
          {visiblePending.map((e) => (
            <div key={e.productId} style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ flex: 1, minWidth: 160, fontFamily: tokens.assistant, color: tokens.text }}>
                {e.name} — <strong>{e.qty.toLocaleString("he-IL")}</strong> יח׳
              </span>
              <button type="button" disabled={saving} onClick={() => void attemptSave(e, { entered: e.qty, addMode: false })} style={{ ...secondaryBtn, minHeight: 44 }}>נסו שוב</button>
              <button type="button" disabled={saving} onClick={() => discardPending(e)} style={{ ...secondaryBtn, minHeight: 44, color: tokens.body }}>ביטול</button>
            </div>
          ))}
        </section>
      )}

      {msg && (
        <div role={msg.ok ? "status" : "alert"} style={{ ...msgStyle(msg.ok), display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ flex: 1, minWidth: 180 }}>{msg.text}</span>
          {msg.lineId && verify && verify.lineId === msg.lineId && (
            <span data-testid="inv-verify" style={{ fontSize: "0.85rem", color: verify.state === "ok" ? "#1A7A4D" : tokens.dim, whiteSpace: "nowrap" }}>
              {verify.state === "pending" ? "בודק מול רווחית…" : verify.state === "ok" ? VERIFIED_TEXT : NOT_VERIFIED_TEXT}
            </span>
          )}
          {msg.retry && (
            <button type="button" onClick={msg.retry} disabled={saving || busy} style={{ ...secondaryBtn, minHeight: 44 }}>{msg.retryLabel ?? "נסו שוב"}</button>
          )}
        </div>
      )}

      {conflict && (
        <section role="alert" aria-label="התנגשות" style={{ ...card, borderColor: "rgba(192,20,60,0.45)", display: "grid", gap: "0.6rem" }}>
          <div style={{ fontFamily: tokens.rubik, fontWeight: 800, color: "#C0143C" }}>מנהל אחר עדכן את הפריט הזה בינתיים</div>
          <p style={{ ...note, color: tokens.text, fontSize: "0.95rem" }}>
            ״{conflict.entry.name}״: הכמות השמורה עכשיו בשרת היא{" "}
            <strong data-testid="inv-conflict-theirs">{conflict.theirs !== null ? conflict.theirs.toLocaleString("he-IL") : "לא ידועה"}</strong>.
            {" "}אתם רציתם לשמור <strong>{conflict.entry.qty.toLocaleString("he-IL")}</strong>. מה לעשות?
          </p>
          <div style={{ display: "grid", gap: "0.5rem" }}>
            <button type="button" disabled={saving} onClick={() => resolveConflict("theirs")} style={{ ...secondaryBtn, borderRadius: 12 }}>
              להשאיר {conflict.theirs !== null ? conflict.theirs.toLocaleString("he-IL") : "את הכמות השמורה"}
            </button>
            <button type="button" disabled={saving} onClick={() => resolveConflict("mine")} style={{ ...secondaryBtn, borderRadius: 12 }}>
              להחליף ל-{conflict.entry.qty.toLocaleString("he-IL")} (הכמות שלי)
            </button>
            {conflict.addMode && conflict.theirs !== null && (
              <button type="button" disabled={saving} onClick={() => resolveConflict("add")} style={{ ...secondaryBtn, borderRadius: 12 }}>
                להוסיף {conflict.entered.toLocaleString("he-IL")} ל-{conflict.theirs.toLocaleString("he-IL")} = {(conflict.theirs + conflict.entered).toLocaleString("he-IL")}
              </button>
            )}
          </div>
        </section>
      )}

      {item && !conflict && (
        <ItemCard
          product={item.product}
          existing={existing}
          recount={isRecount}
          qty={qty}
          setQty={setQty}
          mode={isRecount ? "replace" : mode}
          setMode={setMode}
          saving={saving}
          onSave={save}
          onCancel={() => { closeItem(); setMsg(null); focusScan(); }}
          onEdit={() => setEditing(true)}
          onBurst={(code, rest) => { void handleCode(code, rest); }}
        />
      )}
      {item && editing && (
        <ItemEdit product={item.product} simulation={simulation} onClose={() => setEditing(false)} />
      )}

      {canCount && (
        <section aria-label="סריקה" style={{ ...card, display: "grid", gap: "0.9rem" }}>
          <button type="button" onClick={() => { setMsg(null); setCamera(true); }} disabled={saving} style={bigBtn(saving)}>
            <span aria-hidden="true">📷 </span>סריקת ברקוד
          </button>
          <WedgeInput ref={wedgeRef} onScan={(c) => void handleCode(c)} disabled={saving} listenGlobally={!camera && !editing} />
          {busy && <p role="status" style={note}>מחפש…</p>}

          {notFound && (
            <p role="alert" style={msgStyle(false)}>
              ברקוד לא נמצא: <span dir="ltr">{notFound}</span>. חפשו את הפריט לפי שם למטה.
            </p>
          )}

          {choices && (
            <div role="group" aria-label="בחירת פריט" style={{ display: "grid", gap: "0.45rem" }}>
              <div style={{ fontFamily: tokens.rubik, fontWeight: 800, color: WARN }}>
                לקוד <span dir="ltr">{choices.code}</span> יש {choices.items.length} פריטים — בחרו את הנכון:
              </div>
              {choices.items.map((p) => (
                <ProductRow key={p.product_id} p={p} onPick={() => openItem(p, choices.code)} />
              ))}
            </div>
          )}

          <div style={{ display: "grid", gap: "0.35rem" }}>
            <label style={labelStyle} htmlFor="inv-search">חיפוש ידני — שם או מק״ט</label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input id="inv-search" ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} type="search" maxLength={64} autoComplete="off" enterKeyHint="search"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void runSearch(); } }}
                style={{ ...field, flex: 1, minWidth: 0 }} />
              <button type="button" onClick={() => void runSearch()} disabled={busy} style={{ ...secondaryBtn, whiteSpace: "nowrap" }}>חיפוש</button>
            </div>
          </div>
          {results && (
            <div role="group" aria-label="תוצאות חיפוש" style={{ display: "grid", gap: "0.45rem" }}>
              {results.length === 0 ? <p style={note}>לא נמצאו פריטים.</p> : results.map((p) => (
                <ProductRow key={p.product_id} p={p} onPick={() => openItem(p, null)} />
              ))}
            </div>
          )}
        </section>
      )}

      {camera && (
        <Scanner
          onDetected={(code) => { setCamera(false); void handleCode(code); }}
          onClose={(error) => { setCamera(false); if (error) setMsg({ ok: false, text: error }); focusScan(); }}
        />
      )}
    </div>
  );
}

function ProductRow({ p, onPick }: { p: Product; onPick: () => void }) {
  return (
    <button type="button" onClick={onPick}
      style={{ display: "flex", flexDirection: "column", alignItems: "stretch", textAlign: "right", gap: "0.15rem", minHeight: 56, padding: "0.6rem 0.8rem", borderRadius: 12, border: `1px solid ${tokens.border}`, background: "#fff", cursor: "pointer", fontFamily: tokens.assistant, color: tokens.text }}>
      <strong style={{ fontFamily: tokens.rubik, fontSize: "1rem", overflowWrap: "anywhere" }}>{p.name}</strong>
      <span style={{ fontSize: "0.82rem", color: tokens.dim }}>
        מק״ט <span dir="ltr">{p.sku || "—"}</span>{p.barcode ? <> · ברקוד <span dir="ltr">{p.barcode}</span></> : null}
        {" · "}ברווחית: {Number(p.stock_quantity ?? 0).toLocaleString("he-IL")}
      </span>
    </button>
  );
}
