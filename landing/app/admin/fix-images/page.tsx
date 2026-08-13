"use client";

// מסך תיקון תמונות — סיבוב חופשי בכל זווית, בגלילה אינסופית.
//
// התצוגה מסתובבת בדפדפן (CSS) מעל התמונה הרגילה — ללא שום עבודה בשרת.
// הסיבוב האמיתי נשמר במסד ומופעל בכל מקום שהלקוחות רואים את המוצר.
//
// דפדוף: cursor לפי id ולא offset. כשמסמנים תמונה כ"נבדקה" היא יוצאת מתנאי
// הסינון, ואז offset היה מזיז את החלון ו*מדלג* על תמונות שלא נבדקו. cursor
// לפי מפתח ייחודי ויציב לא מושפע מכך — שום תמונה לא נופלת בין הכיסאות.

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
  orient_human_ok: boolean | null;
};

const BATCH = 12;

export default function FixImagesPage() {
  const router = useRouter();
  const { session, isManager, loading } = useAuth();

  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true);
  const [loadErr, setLoadErr] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [onlyTodo, setOnlyTodo] = useState(true);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState("");
  const [done, setDone] = useState(0);
  const [totalAll, setTotalAll] = useState(0);

  // Guards so overlapping scroll-triggered loads can't duplicate or interleave.
  const cursorRef = useRef<string | null>(null);
  const loadingRef = useRef(false);
  const genRef = useRef(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!session) router.replace("/login");
    else if (!isManager) router.replace("/catalog");
  }, [loading, session, isManager, router]);

  useEffect(() => {
    const t = setTimeout(() => setQuery(search), 350);
    return () => clearTimeout(t);
  }, [search]);

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

  // reset=true starts a fresh list (filter/search changed); otherwise append.
  const fetchPage = useCallback(async (reset: boolean) => {
    if (!isManager) return;
    if (loadingRef.current) return;
    loadingRef.current = true;
    const gen = reset ? ++genRef.current : genRef.current;
    if (reset) { cursorRef.current = null; setHasMore(true); }
    setBusy(true);

    let q = supabase
      .from("products")
      .select("id,name,picture_link,rotation_override,orient_human_ok")
      .eq("is_active", true)
      .neq("picture_link", "");
    if (onlyTodo) q = q.eq("orient_human_ok", false);
    const s = query.trim().replace(/[,()%]/g, " ").trim();
    if (s) q = q.ilike("name", `%${s}%`);
    if (cursorRef.current) q = q.gt("id", cursorRef.current);

    const { data, error } = await q.order("id", { ascending: true }).limit(BATCH);

    // A newer filter/search superseded this request — drop the stale result.
    if (gen !== genRef.current) { loadingRef.current = false; return; }

    if (error) { setLoadErr(true); setBusy(false); loadingRef.current = false; return; }
    setLoadErr(false);
    const batch = (data as Row[]) ?? [];
    if (batch.length > 0) cursorRef.current = batch[batch.length - 1].id;
    setHasMore(batch.length === BATCH);
    setRows((prev) => {
      if (reset) return batch;
      const seen = new Set(prev.map((r) => r.id));
      return [...prev, ...batch.filter((r) => !seen.has(r.id))];
    });
    setBusy(false);
    loadingRef.current = false;
    loadProgress();
  }, [isManager, onlyTodo, query, loadProgress]);

  // restart the list whenever the filter or the search changes
  useEffect(() => { fetchPage(true); }, [fetchPage]);

  // infinite scroll: load the next batch when the sentinel nears the viewport
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && hasMore && !loadingRef.current) {
        fetchPage(false);
      }
    }, { rootMargin: "600px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [fetchPage, hasMore]);

  // Save any angle (0-359) and mark the photo as reviewed by a human.
  const save = async (id: string, angle: number) => {
    const norm = ((Math.round(angle) % 360) + 360) % 360;
    const prev = rows.find((r) => r.id === id);
    setSaveErr("");
    setSavingId(id);
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, rotation_override: norm === 0 ? null : norm, orient_human_ok: true } : r)));
    const { data, error } = await supabase
      .from("products")
      .update({ rotation_override: norm === 0 ? null : norm, orient_human_ok: true })
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
      <main id="main-content" style={{ maxWidth: 1200, margin: "0 auto", padding: "clamp(1rem,3vw,2rem) clamp(0.8rem,3vw,2rem) 4rem" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "1rem", flexWrap: "wrap" }}>
          <h1 style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "clamp(1.5rem,4vw,2.2rem)", color: tokens.text }}>
            תיקון תמונות
          </h1>
          <Link href="/admin" style={{ fontFamily: tokens.assistant, color: tokens.accent, fontWeight: 600 }}>← חזרה לניהול</Link>
        </div>

        <p style={{ fontFamily: tokens.assistant, color: tokens.body, marginTop: "0.5rem", lineHeight: 1.7 }}>
          גוררים את הסרגל עד שהתמונה ישרה — <b>כל זווית שרוצים</b>. אפשר גם כפתורי
          קפיצה מהירים, ו־<b>±1°</b> לכיוונון עדין. הכול בדף אחד — פשוט <b>ממשיכים לגלול</b>
          והתמונות הבאות נטענות לבד.
        </p>

        {/* progress — sticky so it stays visible while scrolling */}
        <div style={{ position: "sticky", top: 0, zIndex: 20, background: "rgba(255,255,255,0.95)", backdropFilter: "blur(8px)", padding: "0.8rem 0 0.6rem", margin: "0.6rem 0" }}>
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
          <input
            placeholder="🔍 חיפוש מוצר לפי שם"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: "1 1 220px", fontFamily: tokens.assistant, fontSize: "1rem", padding: "0.7rem 0.9rem", borderRadius: 12, border: `1px solid ${tokens.border}`, background: "#fff", color: tokens.text }}
          />
          <label style={{ display: "flex", alignItems: "center", gap: "0.45rem", fontFamily: tokens.assistant, fontSize: "0.95rem", color: tokens.body, cursor: "pointer" }}>
            <input type="checkbox" checked={onlyTodo} onChange={(e) => setOnlyTodo(e.target.checked)} style={{ width: 18, height: 18 }} />
            רק מה שלא בדקתי
          </label>
          <span style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.dim }}>
            {rows.length.toLocaleString("he-IL")} מוצגים
          </span>
        </div>

        {saveErr && <p role="alert" style={{ fontFamily: tokens.assistant, color: "#C0143C" }}>{saveErr}</p>}

        {busy && rows.length === 0 ? (
          <p style={{ fontFamily: tokens.assistant, color: tokens.dim }}>טוען תמונות…</p>
        ) : loadErr && rows.length === 0 ? (
          <div style={{ textAlign: "center", marginTop: "2rem" }}>
            <p style={{ fontFamily: tokens.assistant, color: "#C0143C", marginBottom: "0.8rem" }}>טעינת התמונות נכשלה.</p>
            <button onClick={() => fetchPage(true)} style={ghostBtn}>נסו שוב</button>
          </div>
        ) : rows.length === 0 ? (
          <div style={{ textAlign: "center", padding: "3rem 1rem", border: `1px dashed ${tokens.border}`, borderRadius: 18 }}>
            <div style={{ fontSize: "3rem", marginBottom: "0.6rem" }}>🎉</div>
            <p style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.2rem", color: "#1A7A4D" }}>
              {query ? "לא נמצאו תמונות לחיפוש הזה." : "סיימת! עברת על כל התמונות."}
            </p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "1rem" }}>
            {rows.map((r) => (
              <FixCard key={r.id} row={r} saving={savingId === r.id} onSave={(deg) => save(r.id, deg)} />
            ))}
          </div>
        )}

        {/* auto-load sentinel */}
        <div ref={sentinelRef} aria-hidden="true" style={{ height: 1 }} />

        {rows.length > 0 && (
          <div style={{ textAlign: "center", marginTop: "1.5rem" }}>
            {loadErr ? (
              <>
                <p style={{ fontFamily: tokens.assistant, color: "#C0143C", marginBottom: "0.6rem" }}>טעינת ההמשך נכשלה.</p>
                <button onClick={() => fetchPage(false)} style={ghostBtn}>נסו שוב</button>
              </>
            ) : busy ? (
              <p style={{ fontFamily: tokens.assistant, color: tokens.dim }}>טוען עוד תמונות…</p>
            ) : hasMore ? (
              <button onClick={() => fetchPage(false)} style={ghostBtn}>טען עוד</button>
            ) : (
              <p style={{ fontFamily: tokens.assistant, color: tokens.dim }}>זהו — אלה כל התמונות ✔</p>
            )}
          </div>
        )}
      </main>
    </>
  );
}

function FixCard({ row, saving, onSave }: { row: Row; saving: boolean; onSave: (deg: number) => void }) {
  const saved = row.rotation_override ?? 0;
  const [angle, setAngle] = useState(saved);
  const [imgErr, setImgErr] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { setAngle(row.rotation_override ?? 0); }, [row.rotation_override]);
  useEffect(() => { setImgErr(false); setAttempt(0); }, [row.picture_link]);

  const dirty = angle !== saved;
  const reviewed = !!row.orient_human_ok;

  // ALWAYS request the plain, un-rotated variant (w=480, no rot) and do the
  // rotation here in the browser with CSS.
  //
  // Why: asking the proxy for a rotated variant makes it decode the ~3MB
  // original and re-encode it — per photo, per angle. A grid firing that for
  // a screenful at once overwhelmed the edge worker and every image failed.
  // The plain w=480 variant is the one the catalog already uses, so it is
  // already cached for every product and comes straight off the CDN. The
  // server-side rotation still applies everywhere customers see the photo;
  // this screen only needs an accurate preview, and CSS gives that for free.
  const src = rivhitImg(row.picture_link, 480, 0);
  // A rotated rectangle has to shrink to stay inside its frame.
  const previewScale = angle % 180 === 0 ? 1 : angle % 90 === 0 ? 0.78 : 0.68;

  // One transient failure shouldn't strand the card on the emoji: retry the
  // same (cacheable) URL a couple of times, backing off, before giving up.
  const onImgError = () => {
    if (attempt >= 2) { setImgErr(true); return; }
    const next = attempt + 1;
    setTimeout(() => setAttempt(next), 1200 * next);
  };

  const nudge = (d: number) => setAngle((a) => (((Math.round(a + d) % 360) + 360) % 360));

  return (
    <div style={{
      border: `2px solid ${dirty ? tokens.accent : reviewed ? "rgba(37,199,126,0.55)" : tokens.border}`,
      borderRadius: 16, background: "#fff", padding: "0.7rem",
      display: "flex", flexDirection: "column", gap: "0.55rem",
      boxShadow: "0 6px 18px rgba(26,23,48,0.05)",
    }}>
      <div style={{ position: "relative", height: 210, borderRadius: 12, border: `1px solid ${tokens.border}`, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", background: "#fff", fontSize: "2.4rem" }}>
        {imgErr ? <span>🧸</span> : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={attempt}
            src={src}
            alt={row.name}
            loading="lazy"
            onError={onImgError}
            style={{
              maxWidth: "100%", maxHeight: "100%", objectFit: "contain",
              transform: `rotate(${angle}deg) scale(${previewScale})`,
              transition: "transform 0.08s linear",
            }}
          />
        )}
        {reviewed && !dirty && (
          <span style={{ position: "absolute", top: 6, insetInlineEnd: 6, fontFamily: tokens.rubik, fontWeight: 800, fontSize: "0.65rem", color: "#fff", background: "#25C77E", padding: "0.15rem 0.5rem", borderRadius: 999 }}>
            ✓ נבדק
          </span>
        )}
        <span style={{ position: "absolute", bottom: 6, insetInlineStart: 6, fontFamily: tokens.rubik, fontWeight: 800, fontSize: "0.75rem", color: "#fff", background: "rgba(26,23,48,0.72)", padding: "0.15rem 0.6rem", borderRadius: 999 }} dir="ltr">
          {angle}°
        </span>
      </div>

      <div style={{ fontFamily: tokens.assistant, fontSize: "0.8rem", color: tokens.text, minHeight: "2.4em", lineHeight: 1.3 }}>
        {row.name}
      </div>

      {/* free-angle slider */}
      <input
        type="range" min={0} max={359} step={1} value={angle}
        onChange={(e) => setAngle(Number(e.target.value))}
        aria-label={`זווית סיבוב עבור ${row.name}`}
        style={{ width: "100%", accentColor: "#8A3FFC" }}
      />

      {/* fine tuning */}
      <div style={{ display: "flex", gap: "0.3rem" }}>
        <button onClick={() => nudge(-5)} disabled={saving} style={miniBtn}>−5°</button>
        <button onClick={() => nudge(-1)} disabled={saving} style={miniBtn}>−1°</button>
        <button onClick={() => nudge(1)} disabled={saving} style={miniBtn}>+1°</button>
        <button onClick={() => nudge(5)} disabled={saving} style={miniBtn}>+5°</button>
      </div>

      {/* quick jumps */}
      <div style={{ display: "flex", gap: "0.3rem" }}>
        <button onClick={() => setAngle(90)} disabled={saving} style={miniBtn}>↻90</button>
        <button onClick={() => setAngle(180)} disabled={saving} style={miniBtn}>180</button>
        <button onClick={() => setAngle(270)} disabled={saving} style={miniBtn}>↺90</button>
        <button onClick={() => setAngle(0)} disabled={saving} style={miniBtn}>איפוס</button>
      </div>

      {dirty ? (
        <button onClick={() => onSave(angle)} disabled={saving}
          style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "0.9rem", color: "#fff", background: tokens.rainbow, border: "none", padding: "0.7rem", borderRadius: 999, cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1 }}>
          {saving ? "שומר…" : `שמירה (${angle}°)`}
        </button>
      ) : (
        <button onClick={() => onSave(angle)} disabled={saving || reviewed}
          style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "0.9rem", color: reviewed ? "#1A7A4D" : "#fff", background: reviewed ? "rgba(37,199,126,0.14)" : "#1A7A4D", border: "none", padding: "0.7rem", borderRadius: 999, cursor: reviewed ? "default" : "pointer", opacity: saving ? 0.6 : 1 }}>
          {reviewed ? "✓ נבדק" : "✓ תקין — סמן כנבדק"}
        </button>
      )}
    </div>
  );
}

const miniBtn: React.CSSProperties = {
  flex: 1, fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.78rem",
  padding: "0.45rem 0.2rem", borderRadius: 9, border: `1px solid ${tokens.border}`,
  background: "#fff", color: tokens.body, cursor: "pointer", minHeight: 34,
};

const ghostBtn: React.CSSProperties = {
  fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.9rem", color: tokens.text,
  background: "#fff", border: `1px solid ${tokens.border}`, padding: "0.7rem 1.4rem",
  borderRadius: 999, cursor: "pointer",
};
