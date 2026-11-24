"use client";

// Start screen: "ספירה חדשה" / "המשך ספירה" / previous counts.
// The warehouse choice appears ONLY when inventory-sync reports more than one
// storage. If the function is unreachable the count opens with no storage
// (null) and a small note says the sync status is unknown.

import { useEffect, useRef, useState } from "react";
import { tokens } from "../../../../lib/ui";
import { BACKEND_MISSING_TEXT, countStatusLabel, formatWhen, isActiveCount, rpcErrorText, shortId } from "../../../../lib/inventory";
import BackendMissing from "./BackendMissing";
import { fetchCounts, openCount, type Count, type SyncInfo } from "./api";
import { bigBtn, card, field, h2, labelStyle, msgStyle, note, pill, secondaryBtn, selStyle } from "./styles";

export default function StartView({ sync, syncState, onOpen }: {
  sync: SyncInfo | null;
  syncState: "loading" | "ok" | "unknown" | "missing";
  onOpen: (countId: string) => void;
}) {
  const [counts, setCounts] = useState<Count[] | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [noBackend, setNoBackend] = useState(false);
  const [reload, setReload] = useState(0);
  const [storageIdx, setStorageIdx] = useState<string>("");
  const [noteText, setNoteText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; openId?: string } | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  useEffect(() => {
    let live = true;
    void fetchCounts().then((r) => {
      if (!live) return;
      if (!r.ok && r.err.kind === "missing_backend") { setNoBackend(true); setCounts([]); return; }
      if (!r.ok) { setLoadErr(rpcErrorText(r.err)); setCounts([]); return; }
      setLoadErr("");
      setCounts(r.data);
    });
    return () => { live = false; };
  }, [reload]);

  const storages = syncState === "ok" ? sync?.storages ?? [] : [];
  const multi = storages.length > 1;
  const chosen = multi ? (storageIdx === "" ? null : storages[Number(storageIdx)] ?? null) : storages[0] ?? null;
  const storageId = chosen?.storage_id ?? null;
  const storageName = chosen?.storage_name ?? null;
  const active = (counts ?? []).filter((c) => isActiveCount(c.status));
  const blocking = active.find((c) => (c.storage_id ?? 0) === (storageId ?? 0));
  const past = (counts ?? []).filter((c) => !isActiveCount(c.status));

  const start = async () => {
    if (busy || (multi && !chosen)) return;
    setBusy(true);
    setMsg(null);
    const r = await openCount(storageId, storageName, noteText.trim() || null);
    if (!mountedRef.current) return;
    setBusy(false);
    if (r.ok) { onOpen(r.data); return; }
    if (r.err.kind === "active_exists") {
      setMsg({ text: "כבר יש ספירה פתוחה למחסן הזה — ממשיכים אותה במקום לפתוח חדשה.", openId: r.err.countId });
      setReload((n) => n + 1);
      return;
    }
    setMsg({ text: rpcErrorText(r.err) });
  };

  if (noBackend) return <BackendMissing />;

  return (
    <div style={{ display: "grid", gap: "1.1rem" }}>
      {active.length > 0 && (
        <section aria-label="ספירות פתוחות" style={{ display: "grid", gap: "0.6rem" }}>
          {active.map((c) => (
            <div key={c.id} style={{ ...card, borderColor: "rgba(138,63,252,0.35)", display: "grid", gap: "0.5rem" }}>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                <strong style={{ fontFamily: tokens.rubik, fontSize: "1.05rem", color: tokens.text }}>ספירה פתוחה</strong>
                <span style={pill(countStatusLabel(c.status))}>{countStatusLabel(c.status)}</span>
                {c.mode === "simulation" && <span style={pill("טיוטה")}>סימולציה</span>}
              </div>
              <div style={{ fontFamily: tokens.assistant, fontSize: "0.88rem", color: tokens.body }}>
                נפתחה {formatWhen(c.created_at)}{c.storage_name ? ` · ${c.storage_name}` : ""}{c.note ? ` · ${c.note}` : ""}
              </div>
              <button type="button" onClick={() => onOpen(c.id)} style={bigBtn(false)}>המשך ספירה</button>
            </div>
          ))}
        </section>
      )}

      <section aria-label="ספירה חדשה" style={{ ...card, display: "grid", gap: "0.75rem" }}>
        <h2 style={h2}>ספירה חדשה</h2>
        {syncState === "missing" && (
          <p role="note" style={note}>{BACKEND_MISSING_TEXT} (שירות העדכון לרווחית). אפשר לספור; האישור והעדכון לרווחית יחכו עד שהשירות יותקן.</p>
        )}
        {syncState === "unknown" && (
          <p role="note" style={note}>מצב העדכון לרווחית לא ידוע כרגע (השירות לא ענה). אפשר לספור כרגיל; האישור והעדכון לרווחית יחכו עד שהשירות יחזור.</p>
        )}
        {multi && (
          <label style={labelStyle}>מחסן
            <select value={storageIdx} onChange={(e) => setStorageIdx(e.target.value)} style={{ ...selStyle, minHeight: 48, fontSize: "1rem" }}>
              <option value="">בחרו מחסן…</option>
              {storages.map((s, i) => <option key={`${s.storage_id}-${i}`} value={String(i)}>{s.storage_name}</option>)}
            </select>
          </label>
        )}
        {blocking ? (
          <p style={note}>יש כבר ספירה פתוחה{chosen?.storage_name && multi ? ` ל${chosen.storage_name}` : ""} — ממשיכים אותה (למעלה). אפשר ספירה פתוחה אחת לכל מחסן.</p>
        ) : (
          <>
            <label style={labelStyle}>הערה (לא חובה)
              <input value={noteText} onChange={(e) => setNoteText(e.target.value)} maxLength={500} autoComplete="off" placeholder="למשל: מדפים 1–4" style={field} />
            </label>
            <button type="button" onClick={() => void start()} disabled={busy || counts === null || (multi && !chosen)} style={bigBtn(busy || counts === null || (multi && !chosen))}>
              {busy ? "פותח…" : "ספירה חדשה"}
            </button>
          </>
        )}
        {msg && (
          <div role="alert" style={{ ...msgStyle(false), display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ flex: 1, minWidth: 160 }}>{msg.text}</span>
            {msg.openId && <button type="button" onClick={() => onOpen(msg.openId!)} style={{ ...secondaryBtn, minHeight: 44 }}>המשך ספירה</button>}
          </div>
        )}
      </section>

      <section aria-label="ספירות קודמות" style={{ display: "grid", gap: "0.5rem" }}>
        <h2 style={h2}>ספירות קודמות</h2>
        {loadErr && (
          <div role="alert" style={{ ...msgStyle(false), display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ flex: 1 }}>טעינת הספירות נכשלה. {loadErr}</span>
            <button type="button" onClick={() => setReload((n) => n + 1)} style={{ ...secondaryBtn, minHeight: 44 }}>נסו שוב</button>
          </div>
        )}
        {counts === null && <p role="status" style={note}>טוען…</p>}
        {counts && past.length === 0 && !loadErr && <p style={note}>אין עדיין ספירות קודמות.</p>}
        {past.map((c) => (
          <button key={c.id} type="button" onClick={() => onOpen(c.id)}
            style={{ ...card, padding: "0.7rem 0.9rem", minHeight: 56, display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap", cursor: "pointer", textAlign: "right", width: "100%" }}>
            <span style={{ flex: 1, minWidth: 150, fontFamily: tokens.assistant, fontSize: "0.92rem", color: tokens.text }}>
              {formatWhen(c.created_at)}{c.storage_name ? ` · ${c.storage_name}` : ""} <span style={{ color: tokens.dim }} dir="ltr">#{shortId(c.id)}</span>
            </span>
            {c.mode === "simulation" && <span style={pill("טיוטה")}>סימולציה</span>}
            <span style={pill(countStatusLabel(c.status))}>{countStatusLabel(c.status)}</span>
          </button>
        ))}
      </section>
    </div>
  );
}
