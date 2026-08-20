"use client";

// מסך תיקון תמונות — סיבוב חופשי בכל זווית, בגלילה אינסופית.
//
// התצוגה מסתובבת בדפדפן (CSS) מעל התמונה הרגילה — ללא שום עבודה בשרת.
// הסיבוב האמיתי נשמר במסד ומופעל בכל מקום שהלקוחות רואים את המוצר.
//
// דפדוף: cursor לפי id ולא offset. כשמסמנים תמונה כ"נבדקה" היא יוצאת מתנאי
// הסינון, ואז offset היה מזיז את החלון ו*מדלג* על תמונות שלא נבדקו. cursor
// לפי מפתח ייחודי ויציב לא מושפע מכך — שום תמונה לא נופלת בין הכיסאות.

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SiteHeader from "../../components/SiteHeader";
import SiteFooter from "../../components/SiteFooter";
import ProductImage, { type ProductImageStatus } from "../../components/ProductImage";
import { supabase } from "../../../lib/supabaseClient";
import { useAuth } from "../../../lib/auth";
import { isDirectFallbackAllowed } from "../../../lib/imageFallback";
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
  // Client-side filter: show only cards whose image FAILED to load (so the
  // manager can collect them, retry, or open the Rivhit source). It filters
  // what is already on screen — scrolling keeps loading more to inspect.
  const [onlyUnloaded, setOnlyUnloaded] = useState(false);
  // Per-product image state reported by ProductImage — drives the guards:
  // a card whose photo did not really load must not be reviewable.
  const [imgStatus, setImgStatus] = useState<Record<string, ProductImageStatus>>({});
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
  // Async helpers resolve after navigation away — never setState then.
  // Strict Mode replays mount→cleanup→mount, so setup must re-arm the flag
  // the replayed cleanup cleared.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

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
    if (!mountedRef.current) return;
    setTotalAll(all ?? 0);
    setDone(reviewed ?? 0);
  }, []);

  // reset=true starts a fresh list (filter/search changed); otherwise append.
  const fetchPage = useCallback(async (reset: boolean) => {
    if (!isManager) return;
    // Only APPENDS are dropped while a load is in flight. A reset must always
    // go through — it bumps the generation, so the stale in-flight response is
    // discarded by the gen check below instead of the new filter being lost.
    if (!reset && loadingRef.current) return;
    loadingRef.current = true;
    const gen = reset ? ++genRef.current : genRef.current;
    if (reset) { cursorRef.current = null; setHasMore(true); }
    // NOTE: imgStatus is deliberately NOT cleared on reset. A card that
    // survives the reset keeps its React instance (same key), so its
    // ProductImage never re-reports — wiping the map would leave such cards
    // with no status and therefore permanently disabled controls. The map is
    // bounded by the catalog size (~1000 tiny entries), which is fine.
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

    // A newer filter/search superseded this request, or the screen unmounted —
    // drop the stale result WITHOUT touching loadingRef (a supersession means
    // it now belongs to the newer request).
    if (gen !== genRef.current || !mountedRef.current) { return; }

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

  const onImgStatus = useCallback((id: string, s: ProductImageStatus) => {
    setImgStatus((prev) => {
      const cur = prev[id];
      if (cur && cur.phase === s.phase && cur.stage === s.stage) return prev;
      return { ...prev, [id]: s };
    });
  }, []);

  // Save any angle (0-359) and mark the photo as reviewed by a human.
  // Guarded in FixCard: unreachable while the image has not actually loaded.
  // Handed to the memoized cards through a ref so its identity is stable and
  // one card's status change doesn't re-render the whole grid.
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
    if (!mountedRef.current) return; // navigated away mid-save — don't touch state
    setSavingId(null);
    if (error || !data || data.length === 0) {
      setRows((rs) => rs.map((r) => (r.id === id && prev ? prev : r)));
      setSaveErr("השמירה נכשלה, נסו שוב.");
      return;
    }
    loadProgress();
  };
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; });
  const onSave = useCallback((id: string, deg: number) => { saveRef.current(id, deg); }, []);

  if (loading || !session || !isManager) {
    return (
      <>
        <SiteHeader />
        <main id="main-content" tabIndex={-1} style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: tokens.assistant, color: tokens.dim }}>
          טוען…
        </main>
        <SiteFooter />
      </>
    );
  }

  const pct = totalAll > 0 ? Math.round((done / totalAll) * 100) : 0;
  const remaining = Math.max(0, totalAll - done);
  const failedCount = rows.filter((r) => imgStatus[r.id]?.phase === "failed").length;
  // "Unloaded only" hides rows once their photo has ACTUALLY loaded, but keeps
  // unknown/loading rows mounted — a card must render for its image to be
  // probed at all, so new rows arriving from the infinite scroll still get
  // checked and join the list if they fail.
  const shownRows = onlyUnloaded ? rows.filter((r) => imgStatus[r.id]?.phase !== "loaded") : rows;

  return (
    <>
      <SiteHeader />
      <main id="main-content" tabIndex={-1} style={{ maxWidth: 1200, margin: "0 auto", padding: "clamp(1rem,3vw,2rem) clamp(0.8rem,3vw,2rem) 4rem" }}>
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
            type="search"
            aria-label="חיפוש מוצר לפי שם"
            placeholder="🔍 חיפוש מוצר לפי שם"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: "1 1 220px", fontFamily: tokens.assistant, fontSize: "1rem", padding: "0.7rem 0.9rem", borderRadius: 12, border: `1px solid ${tokens.border}`, background: "#fff", color: tokens.text }}
          />
          <label style={{ display: "flex", alignItems: "center", gap: "0.45rem", fontFamily: tokens.assistant, fontSize: "0.95rem", color: tokens.body, cursor: "pointer" }}>
            <input type="checkbox" checked={onlyTodo} onChange={(e) => setOnlyTodo(e.target.checked)} style={{ width: 18, height: 18 }} />
            רק מה שלא בדקתי
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "0.45rem", fontFamily: tokens.assistant, fontSize: "0.95rem", color: tokens.body, cursor: "pointer" }}>
            <input type="checkbox" checked={onlyUnloaded} onChange={(e) => setOnlyUnloaded(e.target.checked)} style={{ width: 18, height: 18 }} />
            רק תמונות שלא נטענו{failedCount > 0 ? ` (${failedCount.toLocaleString("he-IL")})` : ""}
          </label>
          <span style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.dim }}>
            {shownRows.length.toLocaleString("he-IL")} מוצגים
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
        ) : shownRows.length === 0 ? (
          <p style={{ fontFamily: tokens.assistant, color: tokens.dim, marginTop: "1.5rem" }}>
            כל התמונות שנטענו עד כה תקינות — גללו כדי לטעון ולבדוק תמונות נוספות.
          </p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "1rem" }}>
            {shownRows.map((r) => (
              <FixCard key={r.id} row={r} saving={savingId === r.id} status={imgStatus[r.id]} onStatus={onImgStatus} onSave={onSave} />
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

// memo: the page lifts every card's image status into one map, so each status
// transition re-renders the page — without memo that's O(cards²) work as the
// infinite scroll grows.
const FixCard = memo(function FixCard({ row, saving, status, onStatus, onSave }: {
  row: Row;
  saving: boolean;
  status: ProductImageStatus | undefined;
  onStatus: (id: string, s: ProductImageStatus) => void;
  onSave: (id: string, deg: number) => void;
}) {
  const saved = row.rotation_override ?? 0;
  const [angle, setAngle] = useState(saved);
  // Bumping restarts the fallback chain from the proxy ("נסה שוב").
  const [retryKey, setRetryKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { setAngle(row.rotation_override ?? 0); }, [row.rotation_override]);
  useEffect(() => () => { if (copiedTimer.current) clearTimeout(copiedTimer.current); }, []);

  const dirty = angle !== saved;
  const reviewed = !!row.orient_human_ok;

  // A photo that did not ACTUALLY load must not be reviewable: no slider, no
  // rotation, no save, no "תקין" — and it must not advance the progress bar.
  // The manager approves only what their own eyes have seen.
  const loaded = status?.phase === "loaded";
  const failed = status?.phase === "failed";
  const controlsDisabled = saving || !loaded;

  // The preview ALWAYS requests the plain, un-rotated w=480 variant (the one
  // the catalog already caches) and rotates in the browser with CSS — asking
  // the proxy for per-angle variants is what used to overwhelm the edge
  // worker. ProductImage adds the shared fallback chain on top:
  // proxy → retry → direct Rivhit original → accessible placeholder.
  // A rotated rectangle has to shrink to stay inside its frame.
  const previewScale = angle % 180 === 0 ? 1 : angle % 90 === 0 ? 0.78 : 0.68;

  // Terminal failures report either "no-url" (nothing was ever attempted) or
  // "exhausted" (proxy, retry AND the direct original all failed).
  const stageText =
    status?.stage === "no-url" ? "למוצר אין כתובת תמונה תקינה ברווחית" :
    status?.stage === "exhausted" ? "גם שרת התמונות וגם המקור מרווחית נכשלו" :
    "";

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(row.picture_link);
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable — the link is still visible in Rivhit */ }
  };

  const nudge = (d: number) => setAngle((a) => (((Math.round(a + d) % 360) + 360) % 360));

  return (
    <div style={{
      border: `2px solid ${failed ? "rgba(192,20,60,0.45)" : dirty ? tokens.accent : reviewed ? "rgba(37,199,126,0.55)" : tokens.border}`,
      borderRadius: 16, background: "#fff", padding: "0.7rem",
      display: "flex", flexDirection: "column", gap: "0.55rem",
      boxShadow: "0 6px 18px rgba(26,23,48,0.05)",
    }}>
      <div style={{ position: "relative", height: 210, borderRadius: 12, border: `1px solid ${tokens.border}`, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", background: "#fff", fontSize: "2.4rem" }}>
        <ProductImage
          pictureLink={row.picture_link}
          name={row.name}
          rotation={0}
          retryKey={retryKey}
          onStatus={(s) => onStatus(row.id, s)}
          imgStyle={{
            maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto",
            transform: `rotate(${angle}deg) scale(${previewScale})`,
            transition: "transform 0.08s linear",
          }}
        />
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

      {failed && (
        // role="status" (polite), NOT alert — a proxy outage flips a whole
        // screenful of cards at once and dozens of assertive announcements
        // would drown a screen-reader user.
        <div role="status" style={{ fontFamily: tokens.assistant, fontSize: "0.82rem", color: "#C0143C", background: "rgba(192,20,60,0.07)", border: "1px solid rgba(192,20,60,0.25)", borderRadius: 10, padding: "0.5rem 0.6rem", lineHeight: 1.45 }}>
          <b>לא ניתן לבדוק את התמונה כי היא לא נטענה.</b>
          {stageText && <div style={{ color: tokens.body, marginTop: "0.2rem" }}>{stageText}</div>}
          <div style={{ display: "flex", gap: "0.3rem", marginTop: "0.45rem", flexWrap: "wrap" }}>
            <button onClick={() => setRetryKey((k) => k + 1)} style={miniBtn}>↻ נסה שוב</button>
            {isDirectFallbackAllowed(row.picture_link) && (
              <a href={row.picture_link} target="_blank" rel="noopener noreferrer"
                style={{ ...miniBtn, textDecoration: "none", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                פתח מקור מרווחית ↗
              </a>
            )}
            {row.picture_link && (
              <button onClick={copyLink} style={miniBtn}>{copied ? "✓ הועתק" : "העתק קישור"}</button>
            )}
          </div>
        </div>
      )}

      {/* free-angle slider — locked until the photo has really loaded */}
      <input
        type="range" min={0} max={359} step={1} value={angle}
        onChange={(e) => setAngle(Number(e.target.value))}
        disabled={controlsDisabled}
        aria-label={`זווית סיבוב עבור ${row.name}`}
        style={{ width: "100%", accentColor: "#8A3FFC", opacity: controlsDisabled ? 0.4 : 1 }}
      />

      {/* fine tuning */}
      <div style={{ display: "flex", gap: "0.3rem" }}>
        <button onClick={() => nudge(-5)} disabled={controlsDisabled} style={miniBtn}>−5°</button>
        <button onClick={() => nudge(-1)} disabled={controlsDisabled} style={miniBtn}>−1°</button>
        <button onClick={() => nudge(1)} disabled={controlsDisabled} style={miniBtn}>+1°</button>
        <button onClick={() => nudge(5)} disabled={controlsDisabled} style={miniBtn}>+5°</button>
      </div>

      {/* quick jumps */}
      <div style={{ display: "flex", gap: "0.3rem" }}>
        <button onClick={() => setAngle(90)} disabled={controlsDisabled} style={miniBtn}>↻90</button>
        <button onClick={() => setAngle(180)} disabled={controlsDisabled} style={miniBtn}>180</button>
        <button onClick={() => setAngle(270)} disabled={controlsDisabled} style={miniBtn}>↺90</button>
        <button onClick={() => setAngle(0)} disabled={controlsDisabled} style={miniBtn}>איפוס</button>
      </div>

      {dirty ? (
        <button onClick={() => onSave(row.id, angle)} disabled={controlsDisabled}
          style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "0.9rem", color: "#fff", background: tokens.rainbow, border: "none", padding: "0.7rem", borderRadius: 999, cursor: controlsDisabled ? "default" : "pointer", opacity: controlsDisabled ? 0.6 : 1 }}>
          {saving ? "שומר…" : `שמירה (${angle}°)`}
        </button>
      ) : (
        <button onClick={() => onSave(row.id, angle)} disabled={controlsDisabled || reviewed}
          style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "0.9rem", color: reviewed ? "#1A7A4D" : "#fff", background: reviewed ? "rgba(37,199,126,0.14)" : "#1A7A4D", border: "none", padding: "0.7rem", borderRadius: 999, cursor: controlsDisabled || reviewed ? "default" : "pointer", opacity: saving || (!loaded && !reviewed) ? 0.6 : 1 }}>
          {reviewed ? "✓ נבדק" : "✓ תקין — סמן כנבדק"}
        </button>
      )}
    </div>
  );
});

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
