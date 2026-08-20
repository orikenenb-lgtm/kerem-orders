"use client";

// Manager-only image-straightening screen. Photos that carry an EXIF
// orientation tag are already straightened automatically by the rivhit-img
// proxy; this screen is for the rest — a photo shot crooked and saved with no
// tag, which NO automation can detect. The manager eyeballs the grid and taps
// a rotation; it saves to products.rotation_override (safe from the nightly
// sync) and the proxy re-renders that image upright everywhere on the site.

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
  const [aiRunning, setAiRunning] = useState(false);
  const [aiMsg, setAiMsg] = useState("");
  const aiStopRef = useRef(false);
  // Async helpers resolve after navigation away — never setState then. Also
  // guards the AI-scan continuation after an in-flight invoke resolves
  // post-unmount, and the cleanup below stops the scan loop itself.
  // Strict Mode replays mount→cleanup→mount, so setup must re-arm mountedRef
  // or every post-request setState is dropped and the AI scan exits after its
  // first invoke. aiStopRef needs no re-arm here: runAiScan resets it itself.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; aiStopRef.current = true; };
  }, []);

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
    if (!mountedRef.current) return;
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

  // Generation guard: a slower earlier query (search/filter/page) must not
  // overwrite a newer one that already resolved, and nothing setState's after
  // unmount. Each load bumps the generation; a stale response is dropped.
  const loadGenRef = useRef(0);
  const load = useCallback(async () => {
    if (!isManager) return;
    const gen = ++loadGenRef.current;
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
    // Drop a superseded or post-unmount response before touching any state.
    if (gen !== loadGenRef.current || !mountedRef.current) return;
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
    if (!mountedRef.current) return; // navigated away mid-save — don't touch state
    setSavingId(null);
    if (error || !data || data.length === 0) {
      // revert + tell the manager
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, rotation_override: prev } : r)));
      setSaveErr("שמירת הסיבוב נכשלה, נסו שוב.");
      return;
    }
    loadFixedCount();
  };
  // Stable identity for the memoized cards (same pattern as fix-images):
  // aiMsg ticking during a scan must not re-render all 30 image cards.
  const setRotationRef = useRef(setRotation);
  useEffect(() => { setRotationRef.current = setRotation; });
  const onRotate = useCallback((id: string, deg: number) => { setRotationRef.current(id, deg); }, []);

  const stopAiScan = () => { aiStopRef.current = true; };

  // Drive the detect-orientation edge function in a loop until nothing is left
  // to scan, showing live progress. Each round scans a small batch so the tab
  // never blocks; the manager can stop anytime.
  const runAiScan = useCallback(async () => {
    aiStopRef.current = false;
    setAiRunning(true);
    setAiMsg("מתחיל סריקה…");
    let checked = 0, flipped = 0;
    try {
      for (let round = 0; round < 300; round++) {
        if (aiStopRef.current) { setAiMsg(`נעצר · נסרקו ${checked.toLocaleString("he-IL")}, סובבו ${flipped.toLocaleString("he-IL")}`); break; }
        const { data, error } = await supabase.functions.invoke("detect-orientation", { body: { limit: 20 } });
        if (!mountedRef.current) return;
        if (error) {
          let msg = "שגיאה בסריקה.";
          try { const ctx = (error as { context?: Response }).context; if (ctx && typeof ctx.json === "function") { const b = await ctx.json(); if (b?.error) msg = b.error; } } catch { /* */ }
          setAiMsg("נעצר: " + msg + (msg.includes("ANTHROPIC") ? " — יש להוסיף מפתח API בהגדרות." : ""));
          break;
        }
        const d = (data ?? {}) as { checked?: number; flipped?: number; remaining?: number | null; error?: string };
        if (d.error) { setAiMsg("נעצר: " + d.error); break; }
        checked += d.checked ?? 0; flipped += d.flipped ?? 0;
        setAiMsg(`נסרקו ${checked.toLocaleString("he-IL")} · סובבו ${flipped.toLocaleString("he-IL")} · נותרו ${(d.remaining ?? 0).toLocaleString("he-IL")}`);
        loadFixedCount();
        if (!d.remaining || d.remaining <= 0) { setAiMsg(`✓ הסריקה הושלמה — סובבו ${flipped.toLocaleString("he-IL")} תמונות מתוך ${checked.toLocaleString("he-IL")} שנבדקו.`); break; }
        if ((d.checked ?? 0) === 0) { setAiMsg("נעצר: לא ניתן היה לעבד תמונות (בדקו מפתח API / מכסה) ונסו שוב."); break; }
      }
    } catch (e) {
      if (mountedRef.current) setAiMsg("שגיאת רשת בסריקה: " + String((e as Error)?.message ?? e));
    } finally {
      if (mountedRef.current) {
        setAiRunning(false);
        load();
      }
    }
  }, [loadFixedCount, load]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

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

  return (
    <>
      <SiteHeader />
      <main id="main-content" tabIndex={-1} style={{ maxWidth: 1100, margin: "0 auto", padding: "clamp(1.5rem,4vw,3rem) clamp(1rem,4vw,2.5rem) 5rem" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "1rem", flexWrap: "wrap" }}>
          <h1 style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "clamp(1.6rem,4vw,2.4rem)", color: tokens.text }}>
            יישור תמונות
          </h1>
          <Link href="/admin" style={{ fontFamily: tokens.assistant, color: tokens.accent, fontWeight: 600 }}>← חזרה לניהול</Link>
        </div>

        <p style={{ fontFamily: tokens.assistant, color: tokens.body, marginTop: "0.5rem", lineHeight: 1.7, maxWidth: 720 }}>
          רוב התמונות מיושרות אוטומטית. כאן מסדרים תמונה שצולמה עקום — פשוט מסתכלים,
          ואם היא על הצד או הפוכה לוחצים על כפתורי הסיבוב עד שהיא ישרה בתצוגה
          המקדימה, ואז לוחצים <b>שמירה</b>. שום דבר לא משתנה באתר לפני השמירה;
          ביטול מחזיר את התמונה למצב השמור. <b>כבר תוקנו: {fixedCount.toLocaleString("he-IL")} תמונות.</b>
        </p>

        {/* AI auto-scan: goes over every not-yet-scanned image, detects
            upside-down / rotated ones with a vision model, and fixes them. */}
        <div style={{ marginTop: "1.1rem", background: "linear-gradient(120deg, rgba(138,63,252,0.08), rgba(37,199,126,0.08))", border: `1px solid ${tokens.border}`, borderRadius: 16, padding: "1rem 1.2rem", display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 260px" }}>
            <div style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1rem", color: tokens.text }}>🤖 סריקת AI אוטומטית</div>
            <div style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: aiMsg.startsWith("נעצר") ? "#C0143C" : tokens.body, marginTop: "0.25rem", lineHeight: 1.5 }}>
              {aiMsg || "המערכת תעבור על כל התמונות שעוד לא נסרקו, תזהה הפוכות/מסובבות ותסובב אותן אוטומטית. תמונות שכבר סובבו לא ייגעו. אפשר לעצור בכל רגע (השאירו את החלון פתוח)."}
            </div>
          </div>
          <button
            onClick={aiRunning ? stopAiScan : runAiScan}
            style={{
              fontFamily: tokens.rubik, fontWeight: 800, fontSize: "0.9rem", padding: "0.7rem 1.5rem", borderRadius: 999,
              cursor: "pointer", whiteSpace: "nowrap",
              background: aiRunning ? "#fff" : tokens.rainbow, color: aiRunning ? tokens.body : "#fff",
              border: aiRunning ? `1px solid ${tokens.border}` : "none",
            }}
          >
            {aiRunning ? "⏹ עצור" : "🤖 התחל סריקה"}
          </button>
        </div>

        <div style={{ display: "flex", gap: "0.7rem", flexWrap: "wrap", alignItems: "center", margin: "1.2rem 0", position: "sticky", top: 64, zIndex: 10, background: "rgba(255,255,255,0.94)", backdropFilter: "blur(8px)", padding: "0.6rem 0" }}>
          <input
            aria-label="חיפוש מוצר לפי שם"
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
              <ImageCard key={r.id} row={r} saving={savingId === r.id} onRotate={onRotate} />
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

// memo + stable onRotate: page-level state ticks (AI scan progress, savingId)
// must not re-render every card — each card owns an <img> whose remount
// would refetch.
const ImageCard = memo(function ImageCard({ row, saving, onRotate }: { row: Row; saving: boolean; onRotate: (id: string, deg: number) => void }) {
  const saved = row.rotation_override ?? 0;
  // Preview-before-save: picking a rotation only changes the LOCAL preview.
  // Nothing touches the DB until the manager presses שמירה, and ביטול returns
  // to the saved state. (The old version wrote on every rotation click, so a
  // wrong press was live on the site for a moment before being corrected.)
  //
  // The preview requests the SAME plain w=480 variant the catalog caches and
  // rotates with CSS — the old per-click `w=360&rot=draft` variants forced the
  // proxy to re-decode the ~3MB original for every angle of every card, the
  // exact overload that made whole screenfuls of images fail.
  const [draft, setDraft] = useState(saved);
  const [status, setStatus] = useState<ProductImageStatus | undefined>();
  const [retryKey, setRetryKey] = useState(0);
  useEffect(() => { setDraft(saved); }, [saved]);
  const dirty = draft !== saved;
  const loaded = status?.phase === "loaded";
  const failed = status?.phase === "failed";
  const controlsDisabled = saving || !loaded;

  return (
    <div style={{ border: `1px solid ${failed ? "rgba(192,20,60,0.45)" : dirty ? tokens.accent : tokens.border}`, borderRadius: 16, background: "#fff", padding: "0.8rem", display: "flex", flexDirection: "column", gap: "0.6rem", boxShadow: "0 6px 18px rgba(26,23,48,0.05)" }}>
      <div style={{ aspectRatio: "1 / 1", borderRadius: 12, border: `1px solid ${tokens.border}`, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", background: "#fff", fontSize: "2.4rem", padding: 8 }}>
        <ProductImage
          pictureLink={row.picture_link}
          name={row.name}
          rotation={0}
          retryKey={retryKey}
          onStatus={setStatus}
          imgStyle={{ maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto", transform: draft ? `rotate(${draft}deg) scale(${draft % 180 === 0 ? 1 : 0.78})` : undefined, transition: "transform 0.12s ease" }}
        />
      </div>
      <div style={{ fontFamily: tokens.assistant, fontSize: "0.82rem", color: tokens.text, minHeight: "2.4em", lineHeight: 1.3 }}>{row.name}</div>
      {failed && (
        // role="status" (polite) — see fix-images: a mass failure must not
        // fire a screenful of assertive alerts.
        <div role="status" style={{ fontFamily: tokens.assistant, fontSize: "0.82rem", color: "#C0143C", background: "rgba(192,20,60,0.07)", border: "1px solid rgba(192,20,60,0.25)", borderRadius: 10, padding: "0.5rem 0.6rem", lineHeight: 1.45 }}>
          <b>לא ניתן לבדוק את התמונה כי היא לא נטענה.</b>
          <div style={{ display: "flex", gap: "0.3rem", marginTop: "0.45rem", flexWrap: "wrap" }}>
            <button onClick={() => setRetryKey((k) => k + 1)} style={smallBtn}>↻ נסה שוב</button>
            {isDirectFallbackAllowed(row.picture_link) && (
              <a href={row.picture_link} target="_blank" rel="noopener noreferrer" style={{ ...smallBtn, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
                פתח מקור מרווחית ↗
              </a>
            )}
          </div>
        </div>
      )}
      <div role="group" aria-label={`סיבוב עבור ${row.name}`} style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", alignItems: "center" }}>
        {STEPS.map((deg) => {
          const active = draft === deg;
          return (
            <button
              key={deg}
              onClick={() => setDraft(deg)}
              disabled={controlsDisabled}
              aria-pressed={active}
              title={deg === 0 ? "ישר (בלי סיבוב)" : `סיבוב ${deg}° עם כיוון השעון — תצוגה מקדימה בלבד עד שמירה`}
              style={{
                fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.8rem",
                padding: "0.4rem 0.6rem", borderRadius: 10, cursor: controlsDisabled ? "default" : "pointer",
                border: `1px solid ${active ? "transparent" : tokens.border}`,
                background: active ? tokens.accent : "#fff", color: active ? "#fff" : tokens.body,
                opacity: controlsDisabled ? 0.6 : 1, minWidth: 44,
              }}
            >
              {deg === 0 ? "ישר" : `↻ ${deg}°`}
            </button>
          );
        })}
      </div>
      {dirty && (
        <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
          <button
            onClick={() => onRotate(row.id, draft)}
            disabled={controlsDisabled}
            style={{ flex: 1, fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.85rem", color: "#fff", background: "#1A7A4D", border: "none", padding: "0.5rem 0.8rem", borderRadius: 10, cursor: controlsDisabled ? "default" : "pointer", opacity: controlsDisabled ? 0.6 : 1 }}
          >
            {saving ? "שומר…" : "שמירה"}
          </button>
          <button
            onClick={() => setDraft(saved)}
            disabled={saving}
            style={{ fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.85rem", color: tokens.body, background: "#fff", border: `1px solid ${tokens.border}`, padding: "0.5rem 0.8rem", borderRadius: 10, cursor: saving ? "default" : "pointer" }}
          >
            ביטול
          </button>
        </div>
      )}
    </div>
  );
});

const ghostBtn = {
  fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.9rem", color: tokens.text,
  background: "#fff", border: `1px solid ${tokens.border}`, padding: "0.7rem 1.4rem",
  borderRadius: 999, cursor: "pointer",
} as const;

const smallBtn: React.CSSProperties = {
  fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.78rem",
  padding: "0.35rem 0.6rem", borderRadius: 9, border: `1px solid ${tokens.border}`,
  background: "#fff", color: tokens.body, cursor: "pointer",
};
