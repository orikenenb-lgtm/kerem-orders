"use client";

// Manager-only image-straightening screen. Photos that carry an EXIF
// orientation tag are already straightened automatically by the rivhit-img
// proxy; this screen is for the rest — a photo shot crooked and saved with no
// tag, which NO automation can detect. The manager eyeballs the grid and taps
// a rotation; it saves to products.rotation_override (safe from the nightly
// sync) and the proxy re-renders that image upright everywhere on the site.

import { useCallback, useEffect, useRef, useState } from "react";
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
};

const PAGE_SIZE = 30;
const STEPS = [0, 90, 180, 270] as const;

export default function ImagesReviewPage() {
  const router = useRouter();
  const { session, isManager, loading } = useAuth();

  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(true);
  const [loadErr, setLoadErr] = useState(false);
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [onlyFixed, setOnlyFixed] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState("");
  const [fixedCount, setFixedCount] = useState(0);

  useEffect(() => {
    if (loading) return;
    if (!session) router.replace("/login");
    else if (!isManager) router.replace("/catalog");
  }, [loading, session, isManager, router]);

  // count of already-corrected images (independent of the current filter)
  const loadFixedCount = useCallback(async () => {
    const { count } = await supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true)
      .not("rotation_override", "is", null)
      .neq("rotation_override", 0);
    setFixedCount(count ?? 0);
  }, []);

  useEffect(() => {
    if (isManager) loadFixedCount();
  }, [isManager, loadFixedCount]);

  useEffect(() => {
    const t = setTimeout(() => { setQuery(input); setPage(0); }, 350);
    return () => clearTimeout(t);
  }, [input]);
  useEffect(() => { setPage(0); }, [onlyFixed]);

  const load = useCallback(async () => {
    if (!isManager) return;
    setBusy(true);
    let q = supabase
      .from("products")
      .select("id,name,picture_link,rotation_override", { count: "exact" })
      .eq("is_active", true)
      .neq("picture_link", "");
    const s = query.trim();
    if (s) q = q.ilike("name", `%${s}%`);
    if (onlyFixed) q = q.not("rotation_override", "is", null).neq("rotation_override", 0);
    const { data, count, error } = await q
      .order("name", { ascending: true })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (error) { setLoadErr(true); setBusy(false); return; }
    setLoadErr(false);
    setRows((data as Row[]) ?? []);
    setTotal(count ?? 0);
    setBusy(false);
  }, [isManager, query, onlyFixed, page]);

  useEffect(() => { load(); }, [load]);

  const setRotation = async (id: string, rot: number) => {
    const prev = rows.find((r) => r.id === id)?.rotation_override ?? null;
    const value = rot === 0 ? null : rot;
    setSaveErr("");
    setSavingId(id);
    // optimistic
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, rotation_override: value } : r)));
    const { data, error } = await supabase
      .from("products")
      .update({ rotation_override: value })
      .eq("id", id)
      .select("id");
    setSavingId(null);
    if (error || !data || data.length === 0) {
      // revert + tell the manager
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, rotation_override: prev } : r)));
      setSaveErr("שמירת הסיבוב נכשלה, נסו שוב.");
      return;
    }
    loadFixedCount();
  };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

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

  return (
    <>
      <SiteHeader />
      <main id="main-content" style={{ maxWidth: 1100, margin: "0 auto", padding: "clamp(1.5rem,4vw,3rem) clamp(1rem,4vw,2.5rem) 5rem" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "1rem", flexWrap: "wrap" }}>
          <h1 style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "clamp(1.6rem,4vw,2.4rem)", color: tokens.text }}>
            יישור תמונות
          </h1>
          <Link href="/admin" style={{ fontFamily: tokens.assistant, color: tokens.accent, fontWeight: 600 }}>← חזרה לניהול</Link>
        </div>

        <p style={{ fontFamily: tokens.assistant, color: tokens.body, marginTop: "0.5rem", lineHeight: 1.7, maxWidth: 720 }}>
          רוב התמונות מיושרות אוטומטית. כאן מסדרים תמונה שצולמה עקום — פשוט מסתכלים,
          ואם היא על הצד או הפוכה לוחצים על כפתור הסיבוב עד שהיא ישרה. השינוי נשמר מיד
          ומופיע בכל האתר. <b>כבר תוקנו ידנית: {fixedCount.toLocaleString("he-IL")} תמונות.</b>
        </p>

        <div style={{ display: "flex", gap: "0.7rem", flexWrap: "wrap", alignItems: "center", margin: "1.2rem 0", position: "sticky", top: 64, zIndex: 10, background: "rgba(255,255,255,0.94)", backdropFilter: "blur(8px)", padding: "0.6rem 0" }}>
          <input
            placeholder="🔍 חיפוש מוצר לפי שם"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            style={{ flex: "1 1 240px", fontFamily: tokens.assistant, fontSize: "1rem", padding: "0.7rem 0.9rem", borderRadius: 12, border: `1px solid ${tokens.border}`, background: tokens.surface, color: tokens.text }}
          />
          <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontFamily: tokens.assistant, fontSize: "0.9rem", color: tokens.body, cursor: "pointer" }}>
            <input type="checkbox" checked={onlyFixed} onChange={(e) => setOnlyFixed(e.target.checked)} />
            רק תמונות שסובבו
          </label>
          <span style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.dim }}>
            {total.toLocaleString("he-IL")} תמונות
          </span>
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
          <p style={{ fontFamily: tokens.assistant, color: tokens.dim, marginTop: "2rem" }}>לא נמצאו תמונות.</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "1.2rem" }}>
            {rows.map((r) => (
              <ImageCard key={r.id} row={r} saving={savingId === r.id} onRotate={(deg) => setRotation(r.id, deg)} />
            ))}
          </div>
        )}

        {pages > 1 && (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "1rem", marginTop: "2rem" }}>
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} style={{ ...ghostBtn, opacity: page === 0 ? 0.4 : 1 }}>← הקודם</button>
            <span style={{ fontFamily: tokens.rubik, fontWeight: 700, color: tokens.body }}>עמוד {page + 1} מתוך {pages}</span>
            <button onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1} style={{ ...ghostBtn, opacity: page >= pages - 1 ? 0.4 : 1 }}>הבא →</button>
          </div>
        )}
      </main>
    </>
  );
}

function ImageCard({ row, saving, onRotate }: { row: Row; saving: boolean; onRotate: (deg: number) => void }) {
  const current = row.rotation_override ?? 0;
  const [imgErr, setImgErr] = useState(false);
  useEffect(() => { setImgErr(false); }, [current]);
  // 360px preview through the proxy, honoring the saved rotation.
  const src = rivhitImg(row.picture_link, 360, current);

  return (
    <div style={{ border: `1px solid ${tokens.border}`, borderRadius: 16, background: "#fff", padding: "0.8rem", display: "flex", flexDirection: "column", gap: "0.6rem", boxShadow: "0 6px 18px rgba(26,23,48,0.05)" }}>
      <div style={{ height: 200, borderRadius: 12, border: `1px solid ${tokens.border}`, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", background: tokens.surface, fontSize: "2.4rem" }}>
        {imgErr ? <span>🧸</span> : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={row.name} loading="lazy" onError={() => setImgErr(true)} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
        )}
      </div>
      <div style={{ fontFamily: tokens.assistant, fontSize: "0.82rem", color: tokens.text, minHeight: "2.4em", lineHeight: 1.3 }}>{row.name}</div>
      <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", alignItems: "center" }}>
        {STEPS.map((deg) => {
          const active = current === deg;
          return (
            <button
              key={deg}
              onClick={() => onRotate(deg)}
              disabled={saving}
              title={deg === 0 ? "ישר (בלי סיבוב)" : `סובב ${deg}° עם כיוון השעון`}
              style={{
                fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.8rem",
                padding: "0.4rem 0.6rem", borderRadius: 10, cursor: saving ? "default" : "pointer",
                border: `1px solid ${active ? "transparent" : tokens.border}`,
                background: active ? tokens.accent : "#fff", color: active ? "#fff" : tokens.body,
                opacity: saving ? 0.6 : 1, minWidth: 44,
              }}
            >
              {deg === 0 ? "✓ ישר" : `↻ ${deg}°`}
            </button>
          );
        })}
        {saving && <span style={{ fontFamily: tokens.assistant, fontSize: "0.75rem", color: tokens.dim }}>שומר…</span>}
      </div>
    </div>
  );
}

const ghostBtn = {
  fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.9rem", color: tokens.text,
  background: "#fff", border: `1px solid ${tokens.border}`, padding: "0.7rem 1.4rem",
  borderRadius: 999, cursor: "pointer",
} as const;
