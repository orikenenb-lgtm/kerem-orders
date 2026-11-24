"use client";

// סיכום ואישור: the differences against Rivhit, ONE approve, then the sync and
// its per-line outcome. Approval is double-click safe three times over: a ref
// guard here, the disabled button, and the server (inv_approve only moves a
// draft at the expected version; anything else raises INV_CONFLICT).

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { tokens } from "../../../../lib/ui";
import {
  canSkipLine, countStatusLabel, rivhitDiff, SKIP_WARNING, UNVERIFIED_REVIEW_TEXT, validateSkipNote, diffTone, formatSigned, isHighlighted, lineAttention, lineStatusLabel,
  rpcErrorText, summarizeDiffs,
} from "../../../../lib/inventory";
import { approveCount, cancelCount, invokeSync, resolveLine, type Count, type Line, type Settings, type SyncResult } from "./api";
import { bigBtn, card, ERR, field, h2, msgStyle, note, OK, pill, secondaryBtn, WARN } from "./styles";

const POLL_MS = 4000;
const POLL_MAX = 30;

export default function ReviewView({ count, lines, settings, simulation, onReload, onRecount, onCancelled }: {
  count: Count;
  lines: Line[];
  settings: Settings;
  simulation: boolean;
  onReload: () => Promise<unknown>;
  onRecount: (productId: string) => void;
  onCancelled: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; retry?: boolean } | null>(null);
  const approvingRef = useRef(false);
  const [skip, setSkip] = useState<{ lineId: string; note: string } | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const draft = count.status === "draft";
  const threshold = settings.highlight_abs_diff;
  // The difference shown is the one the approval SENDS: counted − Rivhit's
  // quantity captured right after the count. Lines never verified against
  // Rivhit have no difference; they are listed apart and left out of totals.
  const [verified, unverified] = useMemo(() => {
    const byName = (a: Line, b: Line) => a.product_name.localeCompare(b.product_name, "he");
    const v = lines.filter((l) => rivhitDiff(l) !== null)
      .sort((a, b) => Math.abs(rivhitDiff(b)!) - Math.abs(rivhitDiff(a)!) || byName(a, b));
    const u = lines.filter((l) => rivhitDiff(l) === null).sort(byName);
    return [v, u];
  }, [lines]);
  const sum = summarizeDiffs(lines, threshold);
  const open = lines.some((l) => ["pending", "in_progress", "sent"].includes(l.sync_status));
  const hasUnknown = lines.some((l) => l.sync_status === "unknown");
  const hasFailed = lines.some((l) => l.sync_status === "failed");
  const hasSkipped = lines.some((l) => l.sync_status === "skipped");
  const countLabel = countStatusLabel(count.status, hasSkipped);
  const canSync = !draft && ["approved", "syncing", "needs_attention"].includes(count.status);

  // R4: render from a fresh read of the count (its version) and its lines.
  useEffect(() => { void onReload(); }, [onReload]);

  // While the count is being synced (by us or another manager), refresh.
  const pollRef = useRef(0);
  useEffect(() => {
    if (busy || !(count.status === "approved" || count.status === "syncing")) return;
    const t = setInterval(() => {
      pollRef.current += 1;
      if (pollRef.current > POLL_MAX) { clearInterval(t); return; }
      void onReload();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [busy, count.status, onReload]);

  const runSync = async (opts: { includeUnknown?: boolean; retryFailed?: boolean } = {}) => {
    setBusy(true);
    setMsg(null);
    pollRef.current = 0;
    const body: Record<string, unknown> = { action: "sync_count", count_id: count.id };
    if (opts.includeUnknown) body.include_unknown = true;
    if (opts.retryFailed) body.retry_failed = true;
    const r = await invokeSync<SyncResult>(body);
    await onReload();
    if (!mountedRef.current) return;
    setBusy(false);
    if (!r.ok) {
      setMsg({ ok: false, retry: true, text: r.err.kind === "network"
        ? "העדכון לרווחית לא התחיל — אין חיבור לשירות. הספירה שמורה ומאושרת; לחצו ״המשך עדכון״."
        : `העדכון לרווחית נעצר: ${rpcErrorText(r.err)}` });
      return;
    }
    const st = r.data.count_status;
    if (r.data.stopped === "rate_limited") setMsg({ ok: false, retry: true, text: "רווחית ביקשה להאט (עומס). חלק מהפריטים עוד ממתינים — לחצו ״המשך עדכון״ בעוד דקה." });
    else if (r.data.stopped === "network") setMsg({ ok: false, retry: true, text: "החיבור לרווחית נקטע. פריטים שלא עודכנו ממתינים — לחצו ״המשך עדכון״." });
    else if (r.data.stopped) setMsg({ ok: false, retry: true, text: "חלק מהפריטים עוד ממתינים לעדכון — לחצו ״המשך עדכון״." });
    else if (st === "done") setMsg({ ok: true, text: simulation ? "הושלם (סימולציה — שום דבר לא נכתב ברווחית)." : "הושלם: כל הפריטים שנספרו עודכנו ברווחית." });
    else if (st === "needs_attention") setMsg({ ok: false, text: "חלק מהפריטים דורשים טיפול — ראו את הסיבה ליד כל פריט." });
    else setMsg({ ok: true, text: "העדכון רץ…" });
  };

  const approve = async () => {
    if (approvingRef.current || busy || !draft || lines.length === 0) return;
    approvingRef.current = true;
    const ok = window.confirm(simulation
      ? `לאשר את הספירה (${lines.length} פריטים)?\nמצב סימולציה: שום דבר לא ייכתב ברווחית.\nאחרי האישור אי אפשר לשנות כמויות.`
      : `לאשר את הספירה (${lines.length} פריטים)?\nההפרשים יעודכנו ברווחית (מסמכי כניסה/יציאה למלאי).\nאחרי האישור אי אפשר לשנות כמויות.`);
    if (!ok) { approvingRef.current = false; return; }
    setBusy(true);
    setMsg(null);
    // R4: the version of the count AS RENDERED. Every line save/delete bumps it,
    // so approving a list other than the one on screen is refused.
    const renderedVersion = count.version;
    const r = await approveCount(count.id, renderedVersion);
    if (!mountedRef.current) return;
    if (!r.ok) {
      await onReload();
      if (!mountedRef.current) return;
      setBusy(false);
      approvingRef.current = false;
      setMsg({ ok: false, text: r.err.kind !== "conflict"
        ? rpcErrorText(r.err)
        : r.err.status === "draft" || r.err.status === null
          ? "הרשימה השתנתה מאז שנפתח המסך (מישהו שמר או מחק פריט). הטבלה רועננה — בדקו אותה ואשרו שוב."
          : `הספירה כבר לא בטיוטה (${countStatusLabel(r.err.status)}) — כנראה אושרה כבר, בלחיצה קודמת או ע״י מנהל אחר. לא נשלח כלום פעמיים.` });
      return;
    }
    setMsg({ ok: true, text: "הספירה אושרה. מעדכנים את רווחית…" });
    await runSync();
  };

  const cancel = async () => {
    if (busy || !draft) return;
    if (!window.confirm("לבטל את הספירה? הכמויות שנספרו לא יישלחו לרווחית. אי אפשר לבטל את הביטול.")) return;
    setBusy(true);
    const r = await cancelCount(count.id, count.version);
    if (!mountedRef.current) return;
    setBusy(false);
    if (!r.ok) { await onReload(); setMsg({ ok: false, text: rpcErrorText(r.err) }); return; }
    onCancelled();
  };

  /** R2: close a stuck line with a written reason. */
  const doSkip = async (lineId: string) => {
    if (!skip || busy) return;
    const v = validateSkipNote(skip.note);
    if (!v.ok) { setMsg({ ok: false, text: v.error }); return; }
    setBusy(true);
    setMsg(null);
    const r = await resolveLine(lineId, v.note);
    await onReload();
    if (!mountedRef.current) return;
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, text: `הדילוג נכשל: ${rpcErrorText(r.err)}` }); return; }
    setSkip(null);
    setMsg({ ok: true, text: r.data === "done" ? "הפריט דולג. הספירה הושלמה (עם פריטים שדולגו)." : "הפריט דולג. נשארו פריטים שדורשים טיפול." });
  };

  const recheck = () => {
    if (busy) return;
    if (!window.confirm("בדיקה חוזרת קוראת את הכמות ברווחית ובודקת אם העדכון כבר נקלט.\nזה בטוח: רווחית חוסמת מסמך כפול לאותה שורה, כך שהמלאי לא יעודכן פעמיים.\nלהמשיך?")) return;
    void runSync({ includeUnknown: true });
  };

  const retryFailed = () => {
    if (busy) return;
    if (!window.confirm("רווחית דחתה את העדכון של חלק מהפריטים ולא נוצר מסמך. לנסות לשלוח אותם שוב?")) return;
    void runSync({ retryFailed: true });
  };

  const th: React.CSSProperties = { fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.8rem", color: tokens.dim, textAlign: "right", padding: "0.45rem 0.35rem", borderBottom: `1px solid ${tokens.border}` };
  const td: React.CSSProperties = { fontFamily: tokens.assistant, fontSize: "0.9rem", color: tokens.text, padding: "0.5rem 0.35rem", borderBottom: `1px solid ${tokens.border}`, verticalAlign: "top" };
  const num: React.CSSProperties = { ...td, textAlign: "center", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <section aria-label="סיכום" style={{ ...card, display: "grid", gap: "0.5rem" }}>
        <h2 style={h2}>סיכום ההפרשים</h2>
        <div style={{ fontFamily: tokens.assistant, fontSize: "0.95rem", color: tokens.text }}>
          <span data-testid="inv-review-summary">
            {sum.lines.toLocaleString("he-IL")} פריטים נספרו · <span style={{ color: OK }}>{sum.up} עודף</span> · <span style={{ color: ERR }}>{sum.down} חוסר</span> · {sum.same} בלי הפרש
            {sum.highlighted > 0 && <> · <strong style={{ color: WARN }}>{sum.highlighted} מודגשים</strong> (הפרש של {threshold}+)</>}
            {sum.unverified > 0 && <> · <strong style={{ color: WARN }}>{sum.unverified} לא אומתו מול רווחית</strong></>}
          </span>
        </div>
        <p role="note" style={{ ...note, color: tokens.body, fontSize: "0.9rem" }}>
          <strong>פריטים שלא נספרו לא משתנים.</strong> רק הפריטים שבטבלה מתעדכנים ברווחית — כל אחד לכמות שנספרה.
          ״כמות ברווחית״ = הכמות שנקראה מרווחית מיד אחרי שהפריט נספר, וההפרש הוא בדיוק מה שיישלח. אם המלאי ברווחית השתנה מאז —
          הפריט ייעצר, יסומן ״ספור מחדש״ ולא יעודכן. פריט שלא אומת מול רווחית לא מקבל הפרש ולא יעודכן עד שייספר מחדש.
        </p>
        {!draft && (
          <div style={{ fontFamily: tokens.assistant, fontSize: "0.95rem" }}>
            מצב הספירה: <span data-testid="inv-count-status" style={pill(countLabel)}>{countLabel}</span>
            {count.mode === "simulation" && <span style={{ ...pill("טיוטה"), marginInlineStart: "0.4rem" }}>סימולציה</span>}
          </div>
        )}
      </section>

      {msg && (
        <div role={msg.ok ? "status" : "alert"} style={{ ...msgStyle(msg.ok), display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ flex: 1, minWidth: 180 }}>{msg.text}</span>
          {msg.retry && canSync && <button type="button" onClick={() => void runSync()} disabled={busy} style={{ ...secondaryBtn, minHeight: 44 }}>נסו שוב</button>}
        </div>
      )}

      {lines.length === 0 ? (
        <p style={note}>עוד לא נספר אף פריט.</p>
      ) : (
        <div style={{ ...card, padding: "0.4rem" }}>
          <table data-testid="inv-review-table" style={{ width: "100%", borderCollapse: "collapse", tableLayout: "auto" }}>
            <thead>
              <tr>
                <th scope="col" style={th}>פריט</th>
                <th scope="col" style={{ ...th, textAlign: "center" }}>כמות ברווחית בזמן הספירה</th>
                <th scope="col" style={{ ...th, textAlign: "center" }}>נספר</th>
                <th scope="col" style={{ ...th, textAlign: "center" }}>הפרש</th>
                {!draft && <th scope="col" style={th}>מצב</th>}
              </tr>
            </thead>
            <tbody>
              {[...verified, ...unverified].map((l, i) => {
                const d = rivhitDiff(l);
                const hi = d !== null && isHighlighted(d, threshold);
                const groupHead = i === verified.length && unverified.length > 0;
                const tone = d === null ? "zero" : diffTone(d);
                const att = !draft ? lineAttention(l.sync_status, l.last_error) : null;
                const label = lineStatusLabel(l.sync_status, count.status);
                return (
                  <Fragment key={l.id}>
                  {groupHead && (
                    <tr>
                      <th scope="rowgroup" colSpan={draft ? 4 : 5} data-testid="inv-unverified-head"
                        style={{ ...th, color: WARN, background: "rgba(180,83,9,0.06)", fontSize: "0.85rem", whiteSpace: "normal" }}>
                        {UNVERIFIED_REVIEW_TEXT}
                      </th>
                    </tr>
                  )}
                  <tr data-highlight={hi ? "1" : undefined} data-unverified={d === null ? "1" : undefined} style={{ background: hi ? "rgba(255,196,0,0.16)" : undefined }}>
                    <td style={{ ...td, overflowWrap: "anywhere" }}>
                      {l.product_name}
                      {att && (
                        <div style={{ marginTop: "0.35rem", display: "grid", gap: "0.3rem" }}>
                          <span style={{ fontSize: "0.82rem", color: ERR }}>{att.reason}</span>
                          {att.action === "recount" && count.status === "needs_attention" && (
                            <button type="button" onClick={() => onRecount(l.product_id)} disabled={busy} style={{ ...secondaryBtn, minHeight: 44, justifySelf: "start" }}>ספור מחדש</button>
                          )}
                          {att.action === "recheck" && (
                            <button type="button" onClick={recheck} disabled={busy} style={{ ...secondaryBtn, minHeight: 44, justifySelf: "start" }}>בדיקה חוזרת</button>
                          )}
                          {canSkipLine(l.sync_status, count.status) && skip?.lineId !== l.id && (
                            <button type="button" onClick={() => { setSkip({ lineId: l.id, note: "" }); setMsg(null); }} disabled={busy}
                              style={{ ...secondaryBtn, minHeight: 44, justifySelf: "start", color: tokens.body }}>דלג על הפריט</button>
                          )}
                          {skip?.lineId === l.id && (
                            <div role="group" aria-label={`דילוג על ${l.product_name}`} style={{ display: "grid", gap: "0.4rem", border: "1px solid rgba(180,83,9,0.4)", background: "rgba(180,83,9,0.06)", borderRadius: 12, padding: "0.6rem" }}>
                              <p role="note" style={{ ...note, color: WARN, fontSize: "0.88rem" }}>{SKIP_WARNING}</p>
                              {l.sync_status === "unknown" && (
                                <p style={{ ...note, color: ERR, fontSize: "0.88rem", fontWeight: 700 }}>
                                  שימו לב: לפריט הזה לא ידוע אם העדכון נקלט — ייתכן שתעודה כבר נוצרה ברווחית
                                  {l.rivhit_doc_number ? ` (מספר ${l.rivhit_doc_number})` : ""}. בדקו ברווחית לפני הדילוג.
                                </p>
                              )}
                              <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.85rem", color: tokens.body }}>
                                סיבה (חובה, 3–500 תווים)
                                <textarea value={skip.note} onChange={(e) => setSkip({ lineId: l.id, note: e.target.value })} maxLength={500} rows={2}
                                  style={{ ...field, minHeight: 64, fontSize: "0.95rem", resize: "vertical" }} />
                              </label>
                              <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                                <button type="button" onClick={() => void doSkip(l.id)} disabled={busy || !validateSkipNote(skip.note).ok}
                                  style={{ ...secondaryBtn, minHeight: 44, color: ERR, opacity: busy || !validateSkipNote(skip.note).ok ? 0.55 : 1 }}>אישור הדילוג</button>
                                <button type="button" onClick={() => setSkip(null)} disabled={busy} style={{ ...secondaryBtn, minHeight: 44, color: tokens.body }}>ביטול</button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                    <td style={num}>
                      {l.rivhit_baseline_qty !== null && l.rivhit_baseline_qty !== undefined ? l.rivhit_baseline_qty.toLocaleString("he-IL") : "—"}
                      {l.baseline_qty !== l.rivhit_baseline_qty && (
                        <div style={{ fontSize: "0.72rem", color: tokens.dim }}>באתר: {l.baseline_qty.toLocaleString("he-IL")}</div>
                      )}
                    </td>
                    <td style={num}>{l.counted_qty.toLocaleString("he-IL")}</td>
                    <td style={{ ...num, fontWeight: hi ? 800 : 600, color: tone === "pos" ? OK : tone === "neg" ? ERR : tokens.dim }}>
                      {d === null ? <span title={UNVERIFIED_REVIEW_TEXT}>—</span> : <span dir="ltr">{formatSigned(d)}</span>}
                    </td>
                    {!draft && <td style={td}><span style={pill(label)}>{label}</span></td>}
                  </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {draft && (
        <div style={{ display: "grid", gap: "0.5rem" }}>
          <button type="button" data-testid="inv-approve" onClick={() => void approve()} disabled={busy || lines.length === 0} style={bigBtn(busy || lines.length === 0)}>
            {busy ? "מאשר…" : "אישור הספירה"}
          </button>
          <p style={note}>
            {simulation ? "מצב סימולציה: האישור לא כותב כלום ברווחית — רק מראה מה היה קורה." : "האישור שולח את ההפרשים לרווחית. אחריו אי אפשר לשנות כמויות."}
          </p>
          <button type="button" onClick={() => void cancel()} disabled={busy} style={{ ...secondaryBtn, color: ERR, justifySelf: "start" }}>ביטול הספירה</button>
        </div>
      )}

      {canSync && (open || hasUnknown || hasFailed) && (
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {open && <button type="button" onClick={() => void runSync()} disabled={busy} style={{ ...bigBtn(busy), width: "auto", flex: 1 }}>{busy ? "מעדכן…" : "המשך עדכון"}</button>}
          {hasUnknown && <button type="button" onClick={recheck} disabled={busy} style={{ ...secondaryBtn, flex: 1 }}>בדיקה חוזרת</button>}
          {hasFailed && <button type="button" onClick={retryFailed} disabled={busy} style={{ ...secondaryBtn, flex: 1 }}>שליחה חוזרת של מה שנדחה</button>}
        </div>
      )}
    </div>
  );
}
