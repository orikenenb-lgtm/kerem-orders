"use client";

// מסך מהיר לתיקון תמונות עקומות/הפוכות.
//
// עובד כמו תור עבודה: מציג רק את מה שעוד לא בדקת, לחיצה אחת מסובבת ומסמנת
// כ"נבדק", ויש פס התקדמות — כך שאפשר לעבור על כל הקטלוג בלי לראות שוב את
// אותן תמונות. מותאם לנייד (תמונות גדולות, כפתורים גדולים).

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SiteHeader from "../../components/SiteHeader";
import { supabase } from "../../../lib/supabaseClient";
import { useAuth } from "../../../lib/auth";
import { rivhitImg } from "../../../lib/images";
import { tokens } from "../../../lib/ui";

type Row = {
  id: string;
  name: string;
  picture_link: string;
  rotation_override: number | null;
  orient_human_ok: boolean | null;
};

const BATCH = 24;

export default function FixImagesPage() {
  const router = useRouter();
  const { session, isManager, loading } = useAuth();

  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true);
  const [loadErr, setLoadErr] = useState(false);
  const [onlyTodo, setOnlyTodo] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState("");
  const [done, setDone] = useState(0);
  const [totalAll, setTotalAll] = useState(0);

  useEffect(() => {
    if (loading) return;
    if (!session) router.replace("/login");
    else if (!isManager) router.replace("/catalog");
  }, [loading, session, isManager, router]);

  // overall progress (independent of the current batch)
  const loadProgress = useCallback(async () => {
    const base = () =>
      supabase.from("products").select("id", { count: "exact", head: true })
        .eq("is_active", true).neq("picture_link", "");
    const [{ count: all }, { count: reviewed }] = await Promise.all([
      base(),
      base().eq("orient_human_ok", true),
    ]);
    setTotalAll(all ?? 0);
    setDone(reviewed ?? 0);
  }, []);

  const load = useCallback(async () => {
    if (!isManager) return;
    setBusy(true);
    let q = supabase
      .from("products")
      .select("id,name,picture_link,rotation_override,orient_human_ok")
      .eq("is_active", true)
      .neq("picture_link", "");
    if (onlyTodo) q = q.eq("orient_human_ok", false);
    const { data, error } = await q.order("name").limit(BATCH);
    if (error) { setLoadErr(true); setBusy(false); return; }
    setLoadErr(false);
    setRows((data as Row[]) ?? []);
    setBusy(false);
    loadProgress();
  }, [isManager, onlyTodo, loadProgress]);

  useEffect(() => { load(); }, [load]);

  // One tap: store the rotation AND mark the photo as reviewed by a human.
  const apply = async (id: string, rot: number) => {
    const prev = rows.find((r) => r.id === id);
    setSaveErr("");
    setSavingId(id);
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, rotation_override: rot === 0 ? null : rot, orient_human_ok: true } : r)));
    const { data, error } = await supabase
      .from("products")
      .update({ rotation_override: rot === 0 ? null : rot, orient_human_ok: true })
      .eq("id", id)
      .select("id");
    setSavingId(null);
    if (error || !data || data.length === 0) {
      setRows((rs) => rs.map((r) => (r.id === id && prev ? prev : r)));
      setSaveErr("השמירה נכשלה, נסו שוב.");
      return;
    }
    loadProgress();
  };

  if (loading || !session || !isManager) {
    return (
      <>
        <SiteHeader />
        <main id="main-content" style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: tokens.assistant, color: tokens.dim }}>
          טוען…
        </main>
      </>
    );
  }

  const pct = totalAll > 0 ? Math.round((done / totalAll) * 100) : 0;
  const remaining = Math.max(0, totalAll - done);

  return (
    <>
      <SiteHeader />
      <main id="main-content" style={{ maxWidth: 1100, margin: "0 auto", padding: "clamp(1rem,3vw,2rem) clamp(0.8rem,3vw,2rem) 4rem" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "1rem", flexWrap: "wrap" }}>
          <h1 style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "clamp(1.5rem,4vw,2.2rem)", color: tokens.text }}>
            תיקון תמונות
          </h1>
          <Link href="/admin" style={{ fontFamily: tokens.assistant, color: tokens.accent, fontWeight: 600 }}>← חזרה לניהול</Link>
        </div>

        <p style={{ fontFamily: tokens.assistant, color: tokens.body, marginTop: "0.5rem", lineHeight: 1.7 }}>
          רואים תמונה הפוכה או על הצד? לוחצים על כפתור הסיבוב עד שהיא ישרה.
          אם היא כבר תקינה — לוחצים <b>✓ תקין</b>. השינוי נשמר מיד ומופיע באתר.
        </p>

        {/* progress */}
        <div style={{ margin: "1rem 0 1.2rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.9rem", color: tokens.body, marginBottom: "0.4rem" }}>
            <span>בדקת {done.toLocaleString("he-IL")} מתוך {totalAll.toLocaleString("he-IL")}</span>
            <span style={{ color: remaining === 0 ? "#1A7A4D" : tokens.accent }}>
              {remaining === 0 ? "הכול נבדק! 🎉" : `נשארו ${remaining.toLocaleString("he-IL")}`}
            </span>
          </div>
          <div style={{ height: 10, borderRadius: 999, background: tokens.surface, border: `1px solid ${tokens.border}`, overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: tokens.rainbow, transition: "width 0.3s ease" }} />
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.7rem", flexWrap: "wrap", alignItems: "center", marginBottom: "1rem" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "0.45rem", fontFamily: tokens.assistant, fontSize: "0.95rem", color: tokens.body, cursor: "pointer" }}>
            <input type="checkbox" checked={onlyTodo} onChange={(e) => setOnlyTodo(e.target.checked)} style={{ width: 18, height: 18 }} />
            הצג רק מה שעוד לא בדקתי
          </label>
          <button onClick={load} style={ghostBtn}>{busy ? "טוען…" : "טען עוד ↻"}</button>
        </div>

        {saveErr && <p role="alert" style={{ fontFamily: tokens.assistant, color: "#C0143C" }}>{saveErr}</p>}

        {busy && rows.length === 0 ? (
          <p style={{ fontFamily: tokens.assistant, color: tokens.dim }}>טוען תמונות…</p>
        ) : loadErr ? (
          <div style={{ textAlign: "center", marginTop: "2rem" }}>
            <p style={{ fontFamily: tokens.assistant, color: "#C0143C", marginBottom: "0.8rem" }}>טעינת התמונות נכשלה.</p>
            <button onClick={load} style={ghostBtn}>נסו שוב</button>
          </div>
        ) : rows.length === 0 ? (
          <div style={{ textAlign: "center", padding: "3rem 1rem", border: `1px dashed ${tokens.border}`, borderRadius: 18 }}>
            <div style={{ fontSize: "3rem", marginBottom: "0.6rem" }}>🎉</div>
            <p style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.2rem", color: "#1A7A4D" }}>
              סיימת! עברת על כל התמונות.
            </p>
            <p style={{ fontFamily: tokens.assistant, color: tokens.body, marginTop: "0.5rem" }}>
              אפשר לבטל את הסימון למעלה כדי לעבור שוב על הכול.
            </p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "0.9rem" }}>
            {rows.map((r) => (
              <FixCard key={r.id} row={r} saving={savingId === r.id} onApply={(deg) => apply(r.id, deg)} />
            ))}
          </div>
        )}

        {rows.length > 0 && (
          <div style={{ textAlign: "center", marginTop: "2rem" }}>
            <button onClick={load} style={{ ...ghostBtn, padding: "0.9rem 2rem", fontSize: "1rem" }}>
              {busy ? "טוען…" : "טען את הקבוצה הבאה ←"}
            </button>
          </div>
        )}
      </main>
    </>
  );
}

function FixCard({ row, saving, onApply }: { row: Row; saving: boolean; onApply: (deg: number) => void }) {
  const current = row.rotation_override ?? 0;
  const [imgErr, setImgErr] = useState(false);
  useEffect(() => { setImgErr(false); }, [current]);
  const src = rivhitImg(row.picture_link, 360, current);
  const reviewed = !!row.orient_human_ok;

  const btn = (active: boolean, strong?: boolean): React.CSSProperties => ({
    flex: 1,
    fontFamily: tokens.rubik,
    fontWeight: 800,
    fontSize: "0.8rem",
    padding: "0.5rem 0.2rem",
    borderRadius: 10,
    cursor: saving ? "default" : "pointer",
    border: `1px solid ${active ? "transparent" : tokens.border}`,
    background: active ? (strong ? "#1A7A4D" : tokens.accent) : "#fff",
    color: active ? "#fff" : tokens.body,
    opacity: saving ? 0.6 : 1,
    minHeight: 38,
  });

  return (
    <div style={{
      border: `2px solid ${reviewed ? "rgba(37,199,126,0.55)" : tokens.border}`,
      borderRadius: 16, background: "#fff", padding: "0.6rem",
      display: "flex", flexDirection: "column", gap: "0.5rem",
      boxShadow: "0 6px 18px rgba(26,23,48,0.05)",
    }}>
      <div style={{ position: "relative", height: 165, borderRadius: 12, border: `1px solid ${tokens.border}`, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", background: tokens.surface, fontSize: "2.4rem" }}>
        {imgErr ? <span>🧸</span> : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={row.name} loading="lazy" onError={() => setImgErr(true)} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
        )}
        {reviewed && (
          <span style={{ position: "absolute", top: 6, insetInlineEnd: 6, fontFamily: tokens.rubik, fontWeight: 800, fontSize: "0.65rem", color: "#fff", background: "#25C77E", padding: "0.15rem 0.5rem", borderRadius: 999 }}>
            ✓ נבדק
          </span>
        )}
      </div>

      <div style={{ fontFamily: tokens.assistant, fontSize: "0.78rem", color: tokens.text, minHeight: "2.4em", lineHeight: 1.3 }}>
        {row.name}
      </div>

      {/* the common case first: upside-down */}
      <button onClick={() => onApply(current === 180 ? 0 : 180)} disabled={saving}
        style={{ ...btn(current === 180), fontSize: "0.85rem", padding: "0.6rem" }}>
        🔄 הפוך (180°)
      </button>

      <div style={{ display: "flex", gap: "0.3rem" }}>
        <button onClick={() => onApply(90)} disabled={saving} style={btn(current === 90)} title="סובב 90° עם כיוון השעון">↻ 90°</button>
        <button onClick={() => onApply(270)} disabled={saving} style={btn(current === 270)} title="סובב 270° עם כיוון השעון">↺ 90°</button>
        <button onClick={() => onApply(0)} disabled={saving} style={btn(current === 0 && reviewed, true)} title="התמונה תקינה">✓ תקין</button>
      </div>
    </div>
  );
}

const ghostBtn: React.CSSProperties = {
  fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.9rem", color: tokens.text,
  background: "#fff", border: `1px solid ${tokens.border}`, padding: "0.7rem 1.4rem",
  borderRadius: 999, cursor: "pointer",
};
