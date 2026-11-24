"use client";

// The counted lines. While the count is a draft each line can be changed
// (a new TOTAL, replace semantics, stated as such) or deleted.

import { useEffect, useRef, useState } from "react";
import { tokens } from "../../../../lib/ui";
import { formatWhen, IMPLAUSIBLE_CONFIRM, isImplausibleCount, lineStatusLabel, NOT_VERIFIED_TEXT, nowMs, VERIFIED_TEXT, parseCount, putPending, removePending, rpcErrorText } from "../../../../lib/inventory";
import { deleteLine, saveLine, type Count, type Line } from "./api";
import { card, field, msgStyle, note, pill, secondaryBtn, ERR } from "./styles";

const store = (): Storage | null => {
  try { return window.localStorage; } catch { return null; }
};

export default function ItemsView({ count, lines, onReload }: {
  count: Count;
  lines: Line[];
  onReload: () => Promise<unknown>;
}) {
  const draft = count.status === "draft";
  const [editing, setEditing] = useState<string | null>(null);
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const saveEdit = async (l: Line) => {
    const p = parseCount(val);
    if (!p.ok) { setMsg({ ok: false, text: p.error }); return; }
    if (isImplausibleCount(p.value, l.baseline_qty)
      && !window.confirm(`${IMPLAUSIBLE_CONFIRM}\n${p.value.toLocaleString("he-IL")} יח׳ — ברווחית רשומות ${l.baseline_qty.toLocaleString("he-IL")}.`)) return;
    setBusy(true); setMsg(null);
    putPending(store(), { countId: count.id, productId: l.product_id, name: l.product_name, qty: p.value, expectedVersion: l.version, code: null, at: nowMs() });
    const r = await saveLine(count.id, l.product_id, p.value, l.version, null);
    if (!mountedRef.current) return;
    if (r.ok || r.err.kind !== "network") removePending(store(), count.id, l.product_id);
    await onReload();
    if (!mountedRef.current) return;
    setBusy(false);
    if (r.ok) {
      setEditing(null);
      setMsg({ ok: true, text: `נשמר: ${l.product_name} — ${r.data.counted_qty.toLocaleString("he-IL")} יח׳.` });
    } else if (r.err.kind === "network") {
      setMsg({ ok: false, text: "השמירה נכשלה — הערך נשמר במכשיר. אפשר לנסות שוב כאן או במסך הספירה." });
    } else if (r.err.kind === "conflict") {
      setEditing(null);
      setMsg({ ok: false, text: `${rpcErrorText(r.err)} הרשימה רועננה — בדקו ונסו שוב.` });
    } else {
      setMsg({ ok: false, text: rpcErrorText(r.err) });
    }
  };

  const remove = async (l: Line) => {
    if (!window.confirm(`למחוק את ״${l.product_name}״ מהספירה? הפריט לא יעודכן ברווחית.`)) return;
    setBusy(true); setMsg(null);
    const r = await deleteLine(count.id, l.product_id, l.version);
    await onReload();
    if (!mountedRef.current) return;
    setBusy(false);
    setMsg(r.ok ? { ok: true, text: `״${l.product_name}״ נמחק מהספירה.` } : { ok: false, text: rpcErrorText(r.err) });
  };

  return (
    <div style={{ display: "grid", gap: "0.7rem" }}>
      {msg && <p role={msg.ok ? "status" : "alert"} style={msgStyle(msg.ok)}>{msg.text}</p>}
      {lines.length === 0 && <p style={note}>עוד לא נספר אף פריט.</p>}
      {lines.map((l) => {
        const label = lineStatusLabel(l.sync_status, count.status);
        return (
          <div key={l.id} style={{ ...card, padding: "0.75rem 0.9rem", display: "grid", gap: "0.45rem" }}>
            <div style={{ display: "flex", gap: "0.6rem", alignItems: "baseline", flexWrap: "wrap" }}>
              <strong style={{ flex: 1, minWidth: 160, fontFamily: tokens.rubik, color: tokens.text, overflowWrap: "anywhere" }}>{l.product_name}</strong>
              <span style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.15rem", color: tokens.text }}>{l.counted_qty.toLocaleString("he-IL")}</span>
            </div>
            <div style={{ fontFamily: tokens.assistant, fontSize: "0.82rem", color: tokens.dim, display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
              {l.code_scanned && <span>קוד <span dir="ltr">{l.code_scanned}</span></span>}
              <span>{formatWhen(l.counted_at)}</span>
              <span style={pill(label)}>{label}</span>
              {draft && l.rivhit_baseline_qty !== undefined && (
                <span style={{ color: l.rivhit_baseline_qty !== null ? "#1A7A4D" : tokens.dim }}>
                  {l.rivhit_baseline_qty !== null ? VERIFIED_TEXT : NOT_VERIFIED_TEXT}
                </span>
              )}
            </div>
            {draft && editing === l.id ? (
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                <label style={{ fontFamily: tokens.assistant, fontSize: "0.88rem", color: tokens.body, flex: "1 1 160px", display: "grid", gap: "0.25rem" }}>
                  כמות חדשה (מחליפה את {l.counted_qty.toLocaleString("he-IL")})
                  <input value={val} onChange={(e) => setVal(e.target.value)} inputMode="numeric" pattern="[0-9]*" dir="ltr" autoComplete="off" autoFocus
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void saveEdit(l); } }}
                    style={{ ...field, textAlign: "center", fontWeight: 700 }} />
                </label>
                <button type="button" onClick={() => void saveEdit(l)} disabled={busy} style={{ ...secondaryBtn, alignSelf: "end" }}>שמירה</button>
                <button type="button" onClick={() => setEditing(null)} disabled={busy} style={{ ...secondaryBtn, color: tokens.body, alignSelf: "end" }}>ביטול</button>
              </div>
            ) : draft ? (
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button type="button" onClick={() => { setEditing(l.id); setVal(String(l.counted_qty)); setMsg(null); }} disabled={busy} style={{ ...secondaryBtn, minHeight: 44 }} aria-label={`שינוי הכמות של ${l.product_name}`}>שינוי</button>
                <button type="button" onClick={() => void remove(l)} disabled={busy} style={{ ...secondaryBtn, minHeight: 44, color: ERR }} aria-label={`מחיקת ${l.product_name} מהספירה`}>מחיקה</button>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
