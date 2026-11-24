"use client";

// היסטוריה: inventory_events for this count — who, when, what. Append-only.

import { useEffect, useState } from "react";
import { tokens } from "../../../../lib/ui";
import { BACKEND_MISSING_TEXT, eventLabelFor, formatWhen, rpcErrorText } from "../../../../lib/inventory";
import { fetchEvents, fetchPeople, type EventRow, type Line } from "./api";
import { card, msgStyle, note } from "./styles";

function describe(e: EventRow): string {
  const d = (e.detail ?? {}) as Record<string, unknown>;
  const before = d.before as { counted_qty?: number } | null | undefined;
  const after = d.after as { counted_qty?: number } | null | undefined;
  const parts: string[] = [];
  if (after && typeof after.counted_qty === "number") {
    parts.push(before && typeof before.counted_qty === "number"
      ? `${before.counted_qty.toLocaleString("he-IL")} ← ${after.counted_qty.toLocaleString("he-IL")}`
      : `${after.counted_qty.toLocaleString("he-IL")} יח׳`);
  }
  if (d.recount === true) parts.push("ספירה חוזרת");
  if (typeof d.delta === "number") parts.push(`הפרש ${d.delta > 0 ? "+" : ""}${d.delta}`);
  if (typeof d.current === "number") parts.push(`ברווחית ${d.current}`);
  if (typeof d.doc_number === "string" || typeof d.doc_number === "number") parts.push(`מסמך ${d.doc_number}`);
  if (typeof d.note === "string" && d.note) parts.push(`הערה: ${d.note}`);
  if (typeof d.storage_name === "string" && d.storage_name) parts.push(d.storage_name);
  if (typeof d.reason === "string") parts.push(d.reason);
  return parts.join(" · ");
}

export default function HistoryView({ countId, lines }: { countId: string; lines: Line[] }) {
  const [rows, setRows] = useState<EventRow[] | null>(null);
  const [people, setPeople] = useState<Map<string, string>>(new Map());
  const [err, setErr] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    void fetchEvents(countId).then(async (r) => {
      if (!live) return;
      if (!r.ok) { setErr(r.err.kind === "missing_backend" ? BACKEND_MISSING_TEXT : rpcErrorText(r.err)); setRows([]); return; }
      setErr("");
      setRows(r.data);
      const ppl = await fetchPeople(r.data.map((x) => x.actor ?? ""));
      if (live) setPeople(ppl);
    });
    return () => { live = false; };
  }, [countId, reload]);

  const names = new Map(lines.map((l) => [l.product_id, l.product_name]));

  return (
    <div style={{ display: "grid", gap: "0.5rem" }}>
      {err && (
        <div role="alert" style={{ ...msgStyle(false), display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ flex: 1 }}>טעינת ההיסטוריה נכשלה. {err}</span>
          <button type="button" onClick={() => setReload((n) => n + 1)} style={{ fontFamily: tokens.rubik, minHeight: 44, borderRadius: 999, border: `1px solid ${tokens.border}`, background: "#fff", padding: "0 1rem", cursor: "pointer" }}>נסו שוב</button>
        </div>
      )}
      {rows === null && <p role="status" style={note}>טוען…</p>}
      {rows && rows.length === 0 && !err && <p style={note}>אין עדיין אירועים.</p>}
      {rows && rows.length > 0 && (
        <ol aria-label="היסטוריית הספירה" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.45rem" }}>
          {rows.map((e) => {
            const what = describe(e);
            return (
              <li key={e.id} style={{ ...card, padding: "0.6rem 0.85rem" }}>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "baseline" }}>
                  <strong style={{ fontFamily: tokens.rubik, color: tokens.text, fontSize: "0.95rem" }}>{eventLabelFor(e.kind, e.detail)}</strong>
                  {e.product_id && names.get(e.product_id) && <span style={{ fontFamily: tokens.assistant, color: tokens.body, fontSize: "0.9rem", overflowWrap: "anywhere" }}>{names.get(e.product_id)}</span>}
                </div>
                <div style={{ fontFamily: tokens.assistant, fontSize: "0.82rem", color: tokens.dim }}>
                  {formatWhen(e.at)} · {e.actor ? people.get(e.actor) ?? "מנהל" : "המערכת"}{what ? ` · ${what}` : ""}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
