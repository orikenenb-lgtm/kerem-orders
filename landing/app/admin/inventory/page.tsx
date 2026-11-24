"use client";

// Manager screen: ספירת מלאי (stock count). Contract: docs/inventory/CONTRACT.md.
//
// One static route, /admin/inventory/, with its views in the query string:
//   (none)                       start: new count / continue / previous counts
//   ?count=<id>&view=count       scan → quantity → save and continue
//   ?count=<id>&view=items       the counted lines (edit / delete while draft)
//   ?count=<id>&view=review      differences, approve once, sync status
//   ?count=<id>&view=history     inventory_events for the count
// The query is read with useSyncExternalStore (no Suspense, no setState in an
// effect) and changed with history.pushState, so the back button works.
//
// Access: the guard below hides the screen from non-managers, but what really
// protects the data is the database: SELECT on every inventory table is
// manager-only and every write is an is_manager() RPC or the manager-checked
// inventory-sync function.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SiteHeader from "../../components/SiteHeader";
import { useAuth } from "../../../lib/auth";
import { tokens } from "../../../lib/ui";
import { featureFlags } from "../../../lib/featureFlags";
import { countStatusLabel, formatWhen, rpcErrorText, type RpcError } from "../../../lib/inventory";
import { fetchCount, fetchLines, fetchSettings, invokeSync, type Count, type Line, type Settings, type SyncInfo } from "./components/api";
import StartView from "./components/StartView";
import BackendMissing from "./components/BackendMissing";
import CountView from "./components/CountView";
import ItemsView from "./components/ItemsView";
import ReviewView from "./components/ReviewView";
import HistoryView from "./components/HistoryView";
import { msgStyle, note, pill, secondaryBtn, WARN } from "./components/styles";

const ff = featureFlags.ff_inventory_count;
const NAV_EVT = "kt-inv-nav";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VIEWS = ["count", "items", "review", "history"] as const;
type View = (typeof VIEWS)[number];

function subscribe(cb: () => void) {
  window.addEventListener("popstate", cb);
  window.addEventListener(NAV_EVT, cb);
  return () => {
    window.removeEventListener("popstate", cb);
    window.removeEventListener(NAV_EVT, cb);
  };
}
const getSearch = () => window.location.search;
const getServerSearch = () => "";

function navigate(p: { count?: string | null; view?: View | null; product?: string | null }) {
  const qs = new URLSearchParams();
  if (p.count) qs.set("count", p.count);
  if (p.count && p.view) qs.set("view", p.view);
  if (p.count && p.product) qs.set("product", p.product);
  const s = qs.toString();
  window.history.pushState(null, "", s ? `?${s}` : window.location.pathname);
  window.dispatchEvent(new Event(NAV_EVT));
  window.scrollTo({ top: 0 });
}

export default function InventoryPage() {
  const router = useRouter();
  const { session, isManager, loading } = useAuth();
  const allowed = !loading && !!session && isManager && ff;

  useEffect(() => {
    if (loading) return;
    if (!session) router.replace("/login");
    else if (!isManager || !ff) router.replace("/admin");
  }, [loading, session, isManager, router]);

  const search = useSyncExternalStore(subscribe, getSearch, getServerSearch);
  const params = new URLSearchParams(search);
  const rawCount = params.get("count");
  const countId = rawCount && UUID.test(rawCount) ? rawCount : null;
  const rawView = params.get("view") as View | null;
  const view: View = rawView && (VIEWS as readonly string[]).includes(rawView) ? rawView : "count";
  const rawProduct = params.get("product");
  const productParam = rawProduct && UUID.test(rawProduct) ? rawProduct : null;

  const [sync, setSync] = useState<SyncInfo | null>(null);
  const [syncState, setSyncState] = useState<"loading" | "ok" | "unknown" | "missing">("loading");
  useEffect(() => {
    if (!allowed) return;
    let live = true;
    void invokeSync<SyncInfo>({ action: "status" }).then((r) => {
      if (!live) return;
      if (r.ok && r.data && Array.isArray(r.data.storages)) { setSync(r.data); setSyncState("ok"); }
      else setSyncState(!r.ok && r.err.kind === "missing_backend" ? "missing" : "unknown");
    });
    return () => { live = false; };
  }, [allowed]);

  if (!allowed) return null;

  return (
    <>
      <SiteHeader />
      <main id="main-content" tabIndex={-1} style={{ maxWidth: 1000, margin: "0 auto", padding: "clamp(1rem,4vw,2.5rem) clamp(0.9rem,4vw,2.5rem) 5rem", boxSizing: "border-box", overflowX: "clip" }}>
        <div style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.dim, marginBottom: "0.6rem" }}>
          <Link href="/admin" style={{ color: tokens.accent, textDecoration: "none" }}>ניהול</Link> ·{" "}
          {countId ? (
            <a href="?" onClick={(e) => { e.preventDefault(); navigate({}); }} style={{ color: tokens.accent, textDecoration: "none" }}>ספירת מלאי</a>
          ) : "ספירת מלאי"}
        </div>
        <h1 style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "clamp(1.5rem,4vw,2.2rem)", color: tokens.text, margin: "0 0 0.6rem" }}>ספירת מלאי</h1>

        {syncState === "ok" && sync?.mode === "simulation" && (
          <p role="note" data-testid="inv-sim-banner" style={{ ...msgStyle(true), color: WARN, background: "rgba(180,83,9,0.07)", borderColor: "rgba(180,83,9,0.35)", marginBottom: "0.9rem" }}>
            <strong>מצב סימולציה</strong> — אפשר לספור ולאשר, אבל שום דבר לא נכתב ברווחית (לא מסמכים ולא מלאי).
          </p>
        )}
        {syncState === "ok" && sync?.mode === "live" && (
          <p role="note" style={{ ...note, marginBottom: "0.9rem", color: tokens.body }}>
            מצב אמת: אישור ספירה מעדכן את המלאי ברווחית — רק לפריטים שנספרו.
          </p>
        )}

        {countId ? (
          <Workspace key={countId} countId={countId} view={view} productParam={productParam}
            simulationHint={syncState === "ok" ? sync?.mode === "simulation" : null} syncUnknown={syncState === "unknown" || syncState === "missing"} />
        ) : (
          <StartView sync={sync} syncState={syncState} onOpen={(id) => navigate({ count: id, view: "count" })} />
        )}
      </main>
    </>
  );
}

function Workspace({ countId, view, productParam, simulationHint, syncUnknown }: {
  countId: string;
  view: View;
  productParam: string | null;
  simulationHint: boolean | null;
  syncUnknown: boolean;
}) {
  const [count, setCount] = useState<Count | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [settings, setSettings] = useState<Settings>({ highlight_abs_diff: 20, rivhit_writes_enabled: false });
  const [state, setState] = useState<"loading" | "ok" | "missing" | "error" | "nobackend">("loading");
  const [err, setErr] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  useEffect(() => {
    let live = true;
    void Promise.all([fetchCount(countId), fetchLines(countId), fetchSettings()]).then(([c, l, s]) => {
      if (!live) return;
      setSettings(s);
      if (!c.ok || !l.ok) {
        const e: RpcError = !c.ok ? c.err : (l as { ok: false; err: RpcError }).err;
        if (e.kind === "missing_backend") { setState("nobackend"); return; }
        setErr(rpcErrorText(e));
        setState("error");
        return;
      }
      if (!c.data) { setState("missing"); return; }
      setCount(c.data);
      setLines(l.data);
      setState("ok");
    });
    return () => { live = false; };
  }, [countId, reloadKey]);

  /** Refresh the count and its lines (or take lines just fetched). Returns the lines. */
  const reload = useCallback(async (fresh?: Line[]): Promise<Line[] | null> => {
    const [c, l] = await Promise.all([fetchCount(countId), fresh ? Promise.resolve({ ok: true as const, data: fresh }) : fetchLines(countId)]);
    if (!mountedRef.current) return null;
    if (c.ok && c.data) setCount(c.data);
    if (l.ok) { setLines(l.data); return l.data; }
    return null;
  }, [countId]);

  if (state === "loading") return <p role="status" style={note}>טוען את הספירה…</p>;
  if (state === "nobackend") return <BackendMissing />;
  if (state === "missing") {
    return (
      <div role="alert" style={msgStyle(false)}>
        הספירה לא נמצאה. <a href="?" onClick={(e) => { e.preventDefault(); navigate({}); }} style={{ color: tokens.accent }}>חזרה לספירת מלאי</a>
      </div>
    );
  }
  if (state === "error" || !count) {
    return (
      <div role="alert" style={{ ...msgStyle(false), display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ flex: 1 }}>טעינת הספירה נכשלה. {err}</span>
        <button type="button" onClick={() => { setState("loading"); setReloadKey((n) => n + 1); }} style={{ ...secondaryBtn, minHeight: 44 }}>נסו שוב</button>
      </div>
    );
  }

  const simulation = count.mode ? count.mode === "simulation" : !!simulationHint;
  const status = countStatusLabel(count.status, lines.some((l) => l.sync_status === "skipped"));
  const tabs: { v: View; label: string }[] = [
    { v: "count", label: "ספירה" },
    { v: "items", label: `רשימה (${lines.length.toLocaleString("he-IL")})` },
    { v: "review", label: count.status === "draft" ? "סיכום ואישור" : "סיכום ומצב" },
    { v: "history", label: "היסטוריה" },
  ];

  return (
    <div style={{ display: "grid", gap: "0.9rem" }}>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", fontFamily: tokens.assistant, fontSize: "0.9rem", color: tokens.body }}>
        <span data-testid="inv-status" style={pill(status)}>{status}</span>
        {count.mode === "simulation" && <span style={pill("טיוטה")}>סימולציה</span>}
        <span>נפתחה {formatWhen(count.created_at)}</span>
        {count.storage_name && <span>· {count.storage_name}</span>}
        {count.note && <span>· {count.note}</span>}
      </div>
      <div data-testid="inv-counter" aria-live="polite" style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.1rem", color: tokens.text }}>
        נספרו {lines.length.toLocaleString("he-IL")} פריטים
      </div>
      {syncUnknown && <p role="note" style={note}>מצב העדכון לרווחית לא ידוע כרגע (השירות לא ענה). אפשר להמשיך לספור.</p>}

      <nav aria-label="מסכי הספירה" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "0.35rem" }}>
        {tabs.map((t) => (
          <button key={t.v} type="button" aria-current={view === t.v ? "page" : undefined} onClick={() => navigate({ count: countId, view: t.v })}
            style={{
              minHeight: 48, borderRadius: 12, padding: "0.3rem 0.25rem", cursor: "pointer", fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.86rem", lineHeight: 1.2,
              border: view === t.v ? `2px solid ${tokens.accent}` : `1px solid ${tokens.border}`,
              background: view === t.v ? "rgba(138,63,252,0.08)" : "#fff", color: view === t.v ? tokens.accent : tokens.body,
            }}>
            {t.label}
          </button>
        ))}
      </nav>

      {view === "count" && (
        <CountView count={count} lines={lines} simulation={simulation} onLinesChanged={reload} initialProductId={productParam} />
      )}
      {view === "items" && <ItemsView count={count} lines={lines} onReload={reload} />}
      {view === "review" && (
        <ReviewView count={count} lines={lines} settings={settings} simulation={simulation} onReload={reload}
          onRecount={(pid) => navigate({ count: countId, view: "count", product: pid })}
          onCancelled={() => navigate({})} />
      )}
      {view === "history" && <HistoryView countId={countId} lines={lines} />}
    </div>
  );
}
