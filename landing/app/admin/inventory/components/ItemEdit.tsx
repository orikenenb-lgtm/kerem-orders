"use client";

// "עריכת פריט": name / barcode / sku. Rivhit is the source of truth and the
// 15-minute sync overwrites these fields, so the site NEVER edits them locally:
// a request is recorded (inv_request_item_edit), then inventory-sync writes it
// to Rivhit, reads it back, and only then updates the site.

import { useEffect, useRef, useState } from "react";
import { tokens } from "../../../../lib/ui";
import { buildItemEdit, canCloseEdit, CLOSE_EDIT_WARNING, editStatusLabel, rpcErrorText, validateSkipNote } from "../../../../lib/inventory";
import { closeItemEdit, fetchEditRequest, fetchOpenEditRequest, invokeSync, requestItemEdit, type EditRequest, type Product } from "./api";
import { card, ERR, field, h2, labelStyle, msgStyle, note, pill, secondaryBtn, bigBtn, WARN } from "./styles";

const FIELD_HE = { name: "שם", barcode: "ברקוד", sku: "מק״ט" } as const;

export default function ItemEdit({ product, simulation, onClose }: {
  product: Product;
  simulation: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState(product.name);
  const [barcode, setBarcode] = useState(product.barcode ?? "");
  const [sku, setSku] = useState(product.sku ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [req, setReq] = useState<EditRequest | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // A request already open for this product (e.g. stuck in "דורש בדיקה") is
  // shown first, so it can be retried or closed.
  useEffect(() => {
    let live = true;
    void fetchOpenEditRequest(product.product_id).then((r) => { if (live && r) setReq((cur) => cur ?? r); });
    return () => { live = false; };
  }, [product.product_id]);

  /** Close a stuck request (pending / unknown / failed → cancelled). Writes nothing to Rivhit. */
  const closeReq = async () => {
    if (!req || busy || closing === null) return;
    const v = validateSkipNote(closing);
    if (!v.ok) { setMsg({ ok: false, text: v.error }); return; }
    setBusy(true);
    setMsg(null);
    const r = await closeItemEdit(req.id, v.note);
    const row = await fetchEditRequest(req.id);
    if (!mountedRef.current) return;
    setBusy(false);
    if (row) setReq(row);
    if (!r.ok) { setMsg({ ok: false, text: rpcErrorText(r.err) }); return; }
    setClosing(null);
    setMsg({ ok: true, text: "הבקשה נסגרה. שום דבר לא שונה ברווחית או באתר בעקבות הסגירה." });
  };

  const built = buildItemEdit({ name: product.name, barcode: product.barcode, sku: product.sku }, { name, barcode, sku });
  const current = { name: product.name, barcode: product.barcode ?? "", sku: product.sku ?? "" };
  const next = { name: name.trim(), barcode: barcode.trim(), sku: sku.trim() };

  const apply = async (requestId: string) => {
    const r = await invokeSync<unknown>({ action: "apply_item_edit", request_id: requestId });
    const row = await fetchEditRequest(requestId);
    if (!mountedRef.current) return;
    setBusy(false);
    if (row) setReq(row);
    if (!r.ok) {
      setMsg({ ok: false, text: r.err.kind === "network"
        ? "הבקשה נשמרה, אבל העדכון ברווחית לא התחיל (אין חיבור). לחצו ״נסו שוב״."
        : `הבקשה נשמרה, אבל העדכון ברווחית נכשל: ${rpcErrorText(r.err)}` });
      return;
    }
    const st = row?.status;
    if (st === "done") setMsg({ ok: true, text: simulation ? "הושלם (סימולציה — שום דבר לא השתנה ברווחית או באתר)." : "הושלם: הפריט עודכן ברווחית ואחר כך באתר." });
    else if (st === "unknown") setMsg({ ok: false, text: "לא ידוע אם רווחית קלטה את השינוי. לחצו ״בדיקה חוזרת״ — זה בטוח, השינוי לא ייכתב פעמיים." });
    else if (st === "failed") setMsg({ ok: false, text: `רווחית דחתה את השינוי${row?.last_error ? `: ${row.last_error}` : ""}. שום דבר לא השתנה.` });
    else setMsg({ ok: true, text: "הבקשה נשלחה ומתעדכנת." });
  };

  const submit = async () => {
    if (!built.ok || busy) return;
    setBusy(true);
    setMsg(null);
    const r = await requestItemEdit(product.product_id, built.params);
    if (!mountedRef.current) return;
    if (!r.ok) {
      if (r.err.kind === "edit_pending" || r.err.kind === "unique") {
        const pendingId = r.err.kind === "edit_pending" ? r.err.requestId : null;
        const open = pendingId ? await fetchEditRequest(pendingId) : await fetchOpenEditRequest(product.product_id);
        if (!mountedRef.current) return;
        setBusy(false);
        if (open) setReq(open);
        setMsg({ ok: false, text: "כבר יש בקשת עריכה פתוחה לפריט הזה. אפשר להמשיך אותה (״נסו שוב״) לפני שמבקשים שינוי חדש." });
        return;
      }
      setBusy(false);
      setMsg({ ok: false, text: rpcErrorText(r.err) });
      return;
    }
    setReq({ id: r.data, status: "pending", last_error: null, finished_at: null });
    await apply(r.data);
  };

  const retry = async () => {
    if (!req || busy) return;
    setBusy(true);
    setMsg(null);
    await apply(req.id);
  };

  const label = req ? editStatusLabel(req.status) : null;
  const open = req && (req.status === "pending" || req.status === "unknown");

  return (
    <section aria-label="עריכת פריט" style={{ ...card, display: "grid", gap: "0.8rem" }}>
      <h2 style={h2}>עריכת פריט</h2>
      <p style={note}>
        השינוי נעשה קודם ברווחית — ורק אחרי שרווחית מאשרת, הוא מופיע באתר. עד אז שום דבר לא משתנה.
        {simulation ? " כרגע מצב סימולציה: שום דבר לא נכתב ברווחית." : ""}
      </p>
      <label style={labelStyle}>שם
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoComplete="off" style={field} disabled={busy || !!req} />
      </label>
      <label style={labelStyle}>ברקוד (ריק = למחוק)
        <input value={barcode} onChange={(e) => setBarcode(e.target.value)} maxLength={15} dir="ltr" autoComplete="off" spellCheck={false} style={{ ...field, textAlign: "left" }} disabled={busy || !!req} />
      </label>
      <label style={labelStyle}>מק״ט
        <input value={sku} onChange={(e) => setSku(e.target.value)} maxLength={15} dir="ltr" autoComplete="off" spellCheck={false} style={{ ...field, textAlign: "left" }} disabled={busy || !!req} />
      </label>

      {built.ok ? (
        <div role="table" aria-label="לפני ואחרי" style={{ display: "grid", gap: "0.3rem", fontFamily: tokens.assistant, fontSize: "0.9rem" }}>
          {built.changed.map((k) => (
            <div role="row" key={k} style={{ display: "grid", gridTemplateColumns: "4.5rem 1fr", gap: "0.4rem", alignItems: "baseline" }}>
              <span role="rowheader" style={{ color: tokens.dim }}>{FIELD_HE[k]}</span>
              <span role="cell" style={{ overflowWrap: "anywhere" }}>
                <span dir={k === "name" ? "rtl" : "ltr"} style={{ textDecoration: "line-through", color: tokens.dim }}>{current[k] || "(ריק)"}</span>
                {" ← "}
                <strong dir={k === "name" ? "rtl" : "ltr"}>{next[k] || "(ריק)"}</strong>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p style={note}>{built.error}</p>
      )}

      {label && (
        <div role="status" style={{ fontFamily: tokens.assistant, fontSize: "0.92rem", color: tokens.text }}>
          מצב הבקשה: <span style={pill(label)}>{label}</span>
        </div>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} style={msgStyle(msg.ok)}>{msg.text}</p>}

      {!req ? (
        <button type="button" onClick={() => void submit()} disabled={!built.ok || busy} style={bigBtn(!built.ok || busy)}>
          {busy ? "שולח…" : "שליחת השינוי לרווחית"}
        </button>
      ) : open ? (
        <button type="button" onClick={() => void retry()} disabled={busy} style={bigBtn(busy)}>
          {busy ? "בודק…" : req.status === "unknown" ? "בדיקה חוזרת" : "נסו שוב"}
        </button>
      ) : req.status === "cancelled" ? (
        <button type="button" onClick={() => { setReq(null); setMsg(null); }} disabled={busy} style={secondaryBtn}>בקשה חדשה</button>
      ) : null}
      {req && canCloseEdit(req.status) && closing === null && (
        <button type="button" onClick={() => { setClosing(""); setMsg(null); }} disabled={busy} style={{ ...secondaryBtn, color: ERR }}>סגירת הבקשה</button>
      )}
      {req && closing !== null && (
        <div role="group" aria-label="סגירת בקשת העריכה" style={{ display: "grid", gap: "0.45rem", border: "1px solid rgba(180,83,9,0.4)", background: "rgba(180,83,9,0.06)", borderRadius: 12, padding: "0.7rem" }}>
          <p role="note" style={{ ...note, color: WARN, fontSize: "0.9rem" }}>{CLOSE_EDIT_WARNING}</p>
          <label style={labelStyle}>סיבה (חובה, 3–500 תווים)
            <textarea value={closing} onChange={(e) => setClosing(e.target.value)} maxLength={500} rows={2} style={{ ...field, minHeight: 64, resize: "vertical" }} />
          </label>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button type="button" onClick={() => void closeReq()} disabled={busy || !validateSkipNote(closing).ok}
              style={{ ...secondaryBtn, color: ERR, opacity: busy || !validateSkipNote(closing).ok ? 0.55 : 1 }}>אישור סגירת הבקשה</button>
            <button type="button" onClick={() => setClosing(null)} disabled={busy} style={{ ...secondaryBtn, color: tokens.body }}>ביטול</button>
          </div>
        </div>
      )}
      <button type="button" onClick={onClose} disabled={busy} style={secondaryBtn}>סגירה</button>
    </section>
  );
}
