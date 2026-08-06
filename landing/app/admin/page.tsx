"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SiteHeader from "../components/SiteHeader";
import { StatusBadge } from "../components/StatusBadge";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../lib/auth";
import { rivhitImg } from "../../lib/images";
import { tokens, ils, discountPct } from "../../lib/ui";
import { featureFlags } from "../../lib/featureFlags";
import { stepOf } from "../../lib/quantity";

type OrderItem = { id: string; product_name: string; product_sku: string; unit_price: number; quantity: number };
type Order = {
  id: string;
  status: string;
  total: number;
  note: string;
  created_at: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  business_name: string;
  rivhit_doc_id: number | null;
  rivhit_doc_link: string | null;
  rivhit_error: string | null;
  order_items: OrderItem[];
};

const STATUSES = ["new", "processing", "done", "cancelled"] as const;
const STATUS_HE: Record<string, string> = { new: "התקבלה", processing: "בטיפול", done: "הושלמה", cancelled: "בוטלה" };

export default function AdminPage() {
  const router = useRouter();
  const { session, isManager, loading } = useAuth();
  const [tab, setTab] = useState<"orders" | "products" | "customers">("orders");

  useEffect(() => {
    if (loading) return;
    if (!session) router.replace("/login");
    else if (!isManager) router.replace("/catalog");
  }, [loading, session, isManager, router]);

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
      <main id="main-content" style={{ maxWidth: 1100, margin: "0 auto", padding: "clamp(1.5rem,4vw,3rem) clamp(1rem,4vw,2.5rem)" }}>
        <h1 style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "clamp(1.8rem,4vw,2.6rem)", color: tokens.text, marginBottom: "1.2rem" }}>
          ניהול
        </h1>

        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "2rem", flexWrap: "wrap" }}>
          <TabBtn active={tab === "orders"} onClick={() => setTab("orders")}>הזמנות</TabBtn>
          <TabBtn active={tab === "products"} onClick={() => setTab("products")}>קטלוג</TabBtn>
          <TabBtn active={tab === "customers"} onClick={() => setTab("customers")}>לקוחות</TabBtn>
        </div>

        {tab === "orders" ? <OrdersTab /> : tab === "products" ? <ProductsTab /> : <CustomersTab />}
      </main>
    </>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.95rem", padding: "0.6rem 1.4rem", borderRadius: 999,
        border: `1px solid ${active ? "transparent" : tokens.border}`,
        background: active ? tokens.rainbow : "#fff", color: active ? "#fff" : tokens.body, cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

/* ---------------- Orders ---------------- */
function OrdersTab() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [busy, setBusy] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setErr("");
    const { data, error } = await supabase
      .from("orders")
      .select("*, order_items(*)")
      .order("created_at", { ascending: false });
    if (error) setErr("טעינת ההזמנות נכשלה.");
    setOrders((data as Order[]) ?? []);
    setBusy(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const updateStatus = async (id: string, status: string) => {
    const prev = orders.find((o) => o.id === id)?.status;
    setErr("");
    setOrders((os) => os.map((o) => (o.id === id ? { ...o, status } : o)));
    const { error } = await supabase.from("orders").update({ status }).eq("id", id);
    if (error) {
      // roll the optimistic change back and tell the manager
      setOrders((os) => os.map((o) => (o.id === id ? { ...o, status: prev ?? o.status } : o)));
      setErr("עדכון הסטטוס נכשל, נסו שוב.");
    }
  };

  const [pushingId, setPushingId] = useState<string | null>(null);
  const pushToRivhit = async (id: string) => {
    setPushingId(id);
    setErr("");
    try {
      const { data, error } = await supabase.functions.invoke("rivhit-push", {
        body: { action: "push_order", order_id: id },
      });
      if (error) {
        let msg = "השליחה לרווחית נכשלה.";
        try {
          const ctx = (error as { context?: Response }).context;
          if (ctx && typeof ctx.json === "function") {
            const b = await ctx.json();
            if (b?.not_linked) msg = "הלקוח לא מקושר לרווחית — קשרו אותו בלשונית לקוחות.";
            else if (b?.error) msg = b.error;
          }
        } catch { /* ignore */ }
        setErr(msg);
        return;
      }
      const docId = (data as { doc_id?: number })?.doc_id ?? null;
      setOrders((os) => os.map((o) => (o.id === id ? { ...o, rivhit_doc_id: docId } : o)));
      // Pick up the persisted doc link too, so "צפה במסמך" appears immediately
      // without a manual refresh. Surgical single-row fetch — no list flash.
      const { data: row } = await supabase
        .from("orders")
        .select("rivhit_doc_id,rivhit_doc_link,rivhit_error")
        .eq("id", id)
        .maybeSingle();
      // Defensive merge: never let a stale/partial row regress the doc_id we
      // just got from the push response (that would re-expose the push button).
      if (row) setOrders((os) => os.map((o) => (o.id === id ? { ...o, ...row, rivhit_doc_id: row.rivhit_doc_id ?? docId } : o)));
    } catch {
      setErr("השליחה לרווחית נכשלה — בעיית רשת.");
    } finally {
      setPushingId(null);
    }
  };

  const shown = useMemo(
    () => (filter === "all" ? orders : orders.filter((o) => o.status === filter)),
    [orders, filter]
  );
  const newCount = orders.filter((o) => o.status === "new").length;

  if (busy) return <p style={{ fontFamily: tokens.assistant, color: tokens.dim }}>טוען הזמנות…</p>;

  return (
    <>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1.5rem", alignItems: "center" }}>
        <span style={{ fontFamily: tokens.assistant, color: tokens.body, fontSize: "0.9rem" }}>
          {orders.length} הזמנות · {newCount} חדשות
        </span>
        <span style={{ flex: 1 }} />
        <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="סינון הזמנות לפי סטטוס" style={selStyle}>
          <option value="all">הכול</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_HE[s]}</option>
          ))}
        </select>
        <button onClick={load} style={ghostBtn}>רענון</button>
      </div>

      {err && <p style={{ fontFamily: tokens.assistant, color: "#C0143C" }}>{err}</p>}

      {shown.length === 0 ? (
        <p style={{ fontFamily: tokens.assistant, color: tokens.dim }}>אין הזמנות להצגה.</p>
      ) : (
        <div style={{ display: "grid", gap: "1rem" }}>
          {shown.map((o) => (
            <div key={o.id} style={{ border: `1px solid ${tokens.border}`, borderRadius: 16, padding: "1.2rem", background: "#fff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.6rem", marginBottom: "0.8rem" }}>
                <div>
                  <div style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.05rem", color: tokens.text }}>
                    {o.business_name || "—"}
                  </div>
                  <div style={{ fontFamily: tokens.assistant, color: tokens.body, fontSize: "0.85rem" }}>
                    {o.contact_name}{" "}
                    {o.contact_phone && (
                      <a href={`tel:${o.contact_phone}`} style={{ color: tokens.accent }} dir="ltr">
                        {o.contact_phone}
                      </a>
                    )}{" "}
                    {o.contact_email && (
                      <a href={`mailto:${o.contact_email}`} style={{ color: tokens.accent }} dir="ltr">
                        {o.contact_email}
                      </a>
                    )}
                  </div>
                  <div style={{ fontFamily: tokens.assistant, color: tokens.dim, fontSize: "0.8rem" }}>
                    <span dir="ltr">#{o.id.slice(0, 8)}</span> · {new Date(o.created_at).toLocaleString("he-IL")}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.5rem" }}>
                  <StatusBadge status={o.status} />
                  <select value={o.status} onChange={(e) => updateStatus(o.id, e.target.value)} aria-label={`סטטוס הזמנה ${o.id.slice(0, 8)}`} style={selStyle}>
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>{STATUS_HE[s]}</option>
                    ))}
                  </select>
                  {o.rivhit_doc_id ? (
                    <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.25rem" }}>
                      <span style={{ fontFamily: tokens.assistant, fontSize: "0.78rem", color: "#25C77E", fontWeight: 700 }}>
                        ✓ ברווחית — מסמך <span dir="ltr">#{o.rivhit_doc_id}</span>
                      </span>
                      {/^https:\/\//i.test(o.rivhit_doc_link ?? "") && (
                        <a href={o.rivhit_doc_link!} target="_blank" rel="noreferrer"
                          style={{ fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.78rem", color: "#fff", background: tokens.rainbow, padding: "0.4rem 1rem", borderRadius: 999, textDecoration: "none" }}>
                          📄 צפה במסמך
                        </a>
                      )}
                    </span>
                  ) : (
                    <button onClick={() => pushToRivhit(o.id)} disabled={pushingId === o.id}
                      style={{ ...ghostBtn, padding: "0.4rem 0.9rem", fontSize: "0.78rem", opacity: pushingId === o.id ? 0.6 : 1 }}>
                      {pushingId === o.id ? "שולח…" : "שלח לרווחית ↗"}
                    </button>
                  )}
                </div>
              </div>

              <div style={{ display: "grid", gap: "0.3rem", marginBottom: "0.6rem" }}>
                {o.order_items?.map((it) => (
                  <div key={it.id} style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", fontFamily: tokens.assistant, fontSize: "0.9rem", color: tokens.body }}>
                    <span>
                      {it.product_name} <span style={{ color: tokens.dim }}>× {it.quantity}</span>
                      {it.product_sku && <span style={{ color: tokens.dim }}> · קוד <span dir="ltr">{it.product_sku}</span></span>}
                    </span>
                    <span style={{ whiteSpace: "nowrap" }}>{ils(it.unit_price * it.quantity)}</span>
                  </div>
                ))}
              </div>
              {o.note && <p style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.dim, marginBottom: "0.5rem" }}>הערה: {o.note}</p>}
              <div style={{ borderTop: `1px solid ${tokens.border}`, paddingTop: "0.6rem", display: "flex", justifyContent: "space-between", fontFamily: tokens.rubik, fontWeight: 800, color: tokens.text }}>
                <span>סה״כ</span>
                <span>{ils(o.total)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ---------------- Catalog (Rivhit-synced) ---------------- */
// Shape of the summary jsonb a sync run stores — only the numbers the log
// line renders. Anything else in the blob is ignored.
type SyncSummary = {
  products?: { synced?: number | null; from_rivhit?: number | null } | null;
  customers?: { synced?: number | null } | null;
} | null;

type SyncRun = {
  id: string;
  status: string;
  mode: string | null;
  what: string | null;
  summary: SyncSummary;
  error: string | null;
  created_at: string;
  finished_at: string | null;
};

// Relative time in plain Hebrew: "לפני 5 דקות", "לפני שעתיים", "לפני יומיים".
function heAgo(iso: string, now: number): string {
  const min = Math.floor(Math.max(0, now - new Date(iso).getTime()) / 60000);
  if (min < 1) return "לפני פחות מדקה";
  if (min === 1) return "לפני דקה";
  if (min === 2) return "לפני שתי דקות";
  if (min < 60) return `לפני ${min} דקות`;
  const hr = Math.floor(min / 60);
  if (hr === 1) return "לפני שעה";
  if (hr === 2) return "לפני שעתיים";
  if (hr < 24) return `לפני ${hr} שעות`;
  const d = Math.floor(hr / 24);
  if (d === 1) return "לפני יום";
  if (d === 2) return "לפני יומיים";
  return `לפני ${d} ימים`;
}

// Owner-friendly Hebrew for the runs log — no technical values on screen.
const SYNC_WHAT_HE: Record<string, string> = { full: "מלא", both: "מלא", products: "מוצרים", customers: "לקוחות" };
const SYNC_MODE_HE: Record<string, string> = { sync: "עדכון", dry: "בדיקה", test: "בדיקה", check: "בדיקה" };
const SYNC_STATUS_HE: Record<string, { word: string; color: string }> = {
  done: { word: "הצליח", color: "#25C77E" },
  error: { word: "נכשל", color: "#C0143C" },
  running: { word: "רץ עכשיו…", color: "#2563EB" },
};
const syncModeHe = (m: string | null) => (m ? SYNC_MODE_HE[m] ?? m : "עדכון");
const syncWhatHe = (w: string | null) => (w ? SYNC_WHAT_HE[w] ?? w : "");

// "עודכנו 915 מוצרים (מתוך 8,790 ברווחית) · 12 לקוחות" from the summary jsonb.
function syncNumbers(summary: SyncSummary): string {
  const parts: string[] = [];
  const p = summary?.products;
  if (p?.synced != null) {
    let t = `עודכנו ${Number(p.synced).toLocaleString("he-IL")} מוצרים`;
    if (p.from_rivhit != null) t += ` (מתוך ${Number(p.from_rivhit).toLocaleString("he-IL")} ברווחית)`;
    parts.push(t);
  }
  const c = summary?.customers;
  if (c?.synced != null) {
    const n = Number(c.synced).toLocaleString("he-IL");
    parts.push(parts.length > 0 ? `${n} לקוחות` : `עודכנו ${n} לקוחות`);
  }
  return parts.join(" · ");
}

function CatalogImg({ link, name }: { link: string; name: string }) {
  const img = rivhitImg(link);
  const [err, setErr] = useState(false);
  useEffect(() => { setErr(false); }, [img]);
  if (!img || err) return <span>🧸</span>;
  return <img src={img} alt={name} loading="lazy" onError={() => setErr(true)} style={{ width: "100%", height: "100%", objectFit: "contain" }} />;
}

// Wave 3: the packaging (מארז/מגש) fields a manager can edit per product.
// Only the columns the editor actually shows/saves are selected — plus
// min_order_qty/order_step which feed the live preview via stepOf().
type ProductRow = {
  id: string;
  name: string;
  price: number;
  sku: string | null;
  picture_link: string | null;
  stock_quantity: number | null;
  display_qty: number | null;
  display_name: string | null;
  carton_qty: number | null;
  min_order_qty: number | null;
  order_step: number | null;
  sell_by: string | null;
};

// The pack-name presets offered in the editor (free text is also allowed).
const PACK_NAMES: string[] = ["מגש", "מארז", "דיספליי", "קרטונית"];

// One-line human summary of how a product is packaged/sold, for the list row.
// e.g. "מגש = 12 יח׳ · קרטון 144"  /  "נמכר ביחידות"
function packagingSummary(p: ProductRow): { text: string; packSold: boolean } {
  const dq = Math.floor(Number(p.display_qty) || 1);
  const packSold = (p.sell_by === "display" || p.sell_by === "carton") && dq > 1;
  const name = (p.display_name || "מארז").trim() || "מארז";
  const parts = packSold ? [`${name} = ${dq} יח׳`] : ["נמכר ביחידות"];
  const cq = Math.floor(Number(p.carton_qty) || 0);
  if (cq > 0) parts.push(`קרטון ${cq}`);
  return { text: parts.join(" · "), packSold };
}

function ProductsTab() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ProductRow[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [msg, setMsg] = useState("");
  // Load errors get their own state (separate from sync messages) so a stale
  // "load failed" never lingers after a later successful load — and vice versa.
  const [loadErr, setLoadErr] = useState("");

  // A once-a-minute tick: relative times ("לפני X דקות") stay fresh, and the
  // runs list refreshes so server-side (cron) syncs show up while the tab is open.
  const [now, setNow] = useState(() => Date.now());

  const loadRuns = useCallback(async () => {
    const { data } = await supabase.from("rivhit_sync_runs").select("*").order("created_at", { ascending: false }).limit(5);
    const rows = (data as SyncRun[]) ?? [];
    setRuns(rows);
    return rows;
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      loadRuns();
    }, 60000);
    return () => clearInterval(t);
  }, [loadRuns]);

  const load = useCallback(async () => {
    setBusy(true);
    const s = query.trim().replace(/[,()%]/g, " ").trim();
    let q = supabase.from("products").select("id,name,price,sku,picture_link,stock_quantity,display_qty,display_name,carton_qty,min_order_qty,order_step,sell_by", { count: "exact" }).eq("is_active", true);
    if (s) q = q.or(`name.ilike.%${s}%,sku.ilike.%${s}%,barcode.ilike.%${s}%`);
    const { data, count, error } = await q.order("name").range(0, 49);
    if (error) {
      // Don't render a fake "0 מוצרים" on a failed fetch — keep what we have.
      setLoadErr("טעינת הקטלוג נכשלה, נסו שוב.");
      setBusy(false);
      return;
    }
    setLoadErr("");
    setItems((data as ProductRow[]) ?? []); setCount(count ?? 0); setBusy(false);
  }, [query]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadRuns(); }, [loadRuns]);

  // ---- packaging editor helpers ----
  const toggleSelect = useCallback((id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // Merge saved packaging fields back into the visible list, so the row
  // summary refreshes instantly without a refetch.
  const mergeRows = useCallback((ids: string[], patch: Partial<ProductRow>) => {
    const idSet = new Set(ids);
    setItems((xs) => xs.map((x) => (idSet.has(x.id) ? { ...x, ...patch } : x)));
  }, []);

  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  const runSync = async () => {
    setSyncing(true); setMsg("");
    try {
      const { data, error } = await supabase.functions.invoke("rivhit-sync", { body: { mode: "sync", what: "both" } });
      if (error) throw error;
      const runId = (data as { run_id?: string } | null)?.run_id;
      // Show the fresh "running" row right away (headline flips to
      // "מתעדכן עכשיו…"), then poll every ~3s up to ~60s. Each poll reloads
      // the runs list, so the headline and the log update live.
      setNow(Date.now());
      await loadRuns();
      let finished = false;
      for (let i = 0; i < 20 && runId; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        setNow(Date.now());
        const rows = await loadRuns();
        const row = rows.find((x) => x.id === runId);
        if (row && row.status !== "running") {
          finished = true;
          break;
        }
      }
      if (runId && !finished) {
        // Polling window elapsed while the sync is still running — say so
        // instead of silently re-enabling the button with no result.
        setMsg("העדכון נמשך ברקע — הכותרת למעלה תתעדכן לבד כשהוא יסתיים.");
      }
      await load();
    } catch (e) {
      setMsg("העדכון נכשל: " + String((e as Error)?.message ?? e));
    } finally {
      setSyncing(false);
    }
  };

  // ---- status headline, computed from the freshest run ----
  const latest = runs[0];
  let headText = "עוד לא בוצע עדכון — הוא יתחיל אוטומטית בקרוב";
  let headColor: string = tokens.dim;
  if (latest) {
    if (latest.status === "done") {
      // Staleness watchdog: the products cron runs every 15 min, so if the
      // newest successful run is much older than that the sync itself has
      // stopped — a plain green "succeeded 3h ago" would hide a real outage.
      const ageMin = Math.floor(Math.max(0, now - new Date(latest.finished_at ?? latest.created_at).getTime()) / 60000);
      if (ageMin > 40) {
        headText = `⚠ הסנכרון לא רץ כבר ${heAgo(latest.finished_at ?? latest.created_at, now)} — אמור לרוץ כל 15 דקות. בדקו/לחצו "עדכן עכשיו".`;
        headColor = "#C0143C";
      } else {
        headText = `✓ הסנכרון תקין — עודכן ${heAgo(latest.finished_at ?? latest.created_at, now)}`;
        headColor = "#1A7A4D";
      }
    } else if (latest.status === "error") {
      headText = `⚠ בעיה בעדכון האחרון — ${heAgo(latest.finished_at ?? latest.created_at, now)}`;
      headColor = "#C0143C";
    } else {
      const runMin = Math.floor(Math.max(0, now - new Date(latest.created_at).getTime()) / 60000);
      if (runMin >= 10) {
        headText = `עדכון תקוע? רץ כבר ${runMin} דקות`;
        headColor = "#B45309";
      } else {
        headText = "מתעדכן עכשיו…";
        headColor = "#2563EB";
      }
    }
  }
  // Numbers from the freshest run that actually finished successfully.
  const lastDone = runs.find((r) => r.status === "done");
  const lastNumbers = lastDone ? syncNumbers(lastDone.summary) : "";

  return (
    <>
      <div style={{ background: tokens.surface, border: `1px solid ${tokens.border}`, borderRadius: 14, padding: "1.1rem 1.2rem", marginBottom: "1.25rem", display: "grid", gap: "0.7rem" }}>
        <div>
          <div style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.25rem", color: headColor, lineHeight: 1.4 }}>{headText}</div>
          {latest?.status === "error" && latest.error && (
            <div style={{ fontFamily: tokens.assistant, fontSize: "0.82rem", color: "#C0143C", marginTop: "0.2rem", lineHeight: 1.5 }}>{latest.error}</div>
          )}
          <div style={{ fontFamily: tokens.assistant, fontSize: "0.8rem", color: tokens.dim, marginTop: "0.3rem" }}>
            עדכון אוטומטי: מלאי ומחירים כל 15 דקות · קטלוג מלא כל לילה ב־03:00
          </div>
        </div>
        {lastNumbers && (
          <div style={{ fontFamily: tokens.assistant, fontSize: "0.92rem", color: tokens.body }}>{lastNumbers}</div>
        )}
        <div style={{ borderTop: `1px solid ${tokens.border}`, paddingTop: "0.8rem", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.1rem", color: tokens.text }}>{count.toLocaleString("he-IL")} מוצרים פעילים</div>
            <div style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.body }}>מסונכרן מרווחית (קריאה בלבד) — לא משנה דבר ברווחית.</div>
          </div>
          <button onClick={runSync} disabled={syncing} style={solidBtnA(syncing)}>{syncing ? "מעדכן…" : "עדכן עכשיו"}</button>
        </div>
        <div style={{ borderTop: `1px solid ${tokens.border}`, paddingTop: "0.8rem", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.1rem", color: tokens.text }}>יישור תמונות</div>
            <div style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.body }}>תמונה שצולמה עקום? עוברים עליהן ומסובבים בלחיצה.</div>
          </div>
          <Link href="/admin/images-review" style={{ ...ghostBtn, textDecoration: "none", whiteSpace: "nowrap" }}>פתיחת מסך היישור ←</Link>
        </div>
      </div>
      {msg && <p style={{ fontFamily: tokens.assistant, color: tokens.body, fontSize: "0.9rem", marginBottom: "1rem" }}>{msg}</p>}
      {loadErr && <p style={{ fontFamily: tokens.assistant, color: "#C0143C", fontSize: "0.9rem", marginBottom: "1rem" }}>{loadErr}</p>}

      {runs.length > 0 && (
        <div style={{ marginBottom: "1.25rem" }}>
          <div style={{ fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.8rem", color: tokens.dim, marginBottom: "0.4rem" }}>עדכונים אחרונים</div>
          {runs.map((r) => {
            const st = SYNC_STATUS_HE[r.status] ?? { word: r.status, color: tokens.dim };
            const what = syncWhatHe(r.what);
            const nums = syncNumbers(r.summary);
            return (
              <div key={r.id} style={{ fontFamily: tokens.assistant, fontSize: "0.8rem", color: tokens.body, display: "flex", gap: "0.6rem", padding: "0.15rem 0", flexWrap: "wrap" }}>
                <span style={{ color: tokens.dim }}>{heAgo(r.created_at, now)}</span>
                <span>{syncModeHe(r.mode)}{what ? ` ${what}` : ""}</span>
                <span style={{ fontWeight: 700, color: st.color }}>{st.word}</span>
                {nums && <span>· {nums}</span>}
                {r.status === "error" && r.error && <span style={{ color: "#C0143C" }}>· {r.error}</span>}
              </div>
            );
          })}
        </div>
      )}

      {!featureFlags.ff_display_quantities && (
        <p style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.body, background: tokens.surface, border: `1px dashed ${tokens.border}`, borderRadius: 10, padding: "0.55rem 0.9rem", marginBottom: "1rem", lineHeight: 1.6 }}>
          💡 שינויים במארזים נשמרים כאן מיד, אבל באתר הלקוחות המכירה במארזים שלמים תופעל רק כשנדליק את האפשרות — עד אז הלקוחות ממשיכים להזמין כרגיל.
        </p>
      )}

      <input aria-label="חיפוש מוצר לפי שם או קוד" placeholder="🔍 חיפוש מוצר / קוד…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: "100%", fontFamily: tokens.assistant, fontSize: "0.95rem", padding: "0.6rem 0.9rem", borderRadius: 12, border: `1px solid ${tokens.border}`, background: "#fff", color: tokens.text, marginBottom: "0.5rem" }} />
      <p style={{ fontFamily: tokens.assistant, fontSize: "0.8rem", color: tokens.dim, marginBottom: "0.8rem" }}>
        לחצו על מוצר כדי לערוך את המארז שלו · סמנו ✓ כמה מוצרים יחד לעדכון קבוצתי
      </p>

      {selectedIds.length > 0 && (
        <BulkBar
          ids={selectedIds}
          onApplied={mergeRows}
          onClear={() => setSelected(new Set())}
        />
      )}

      {busy ? (
        <p style={{ fontFamily: tokens.assistant, color: tokens.dim }}>טוען…</p>
      ) : (
        <div style={{ display: "grid", gap: "0.4rem" }}>
          {items.map((p) => {
            const isOpen = expandedId === p.id;
            const sum = packagingSummary(p);
            return (
              <div key={p.id} style={{ border: `1px solid ${isOpen ? tokens.accent : tokens.border}`, borderRadius: 10, background: "#fff", overflow: "hidden" }}>
                <div
                  onClick={() => setExpandedId(isOpen ? null : p.id)}
                  style={{ display: "flex", alignItems: "center", gap: "0.8rem", padding: "0.5rem 0.9rem", cursor: "pointer" }}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(p.id)}
                    onChange={() => toggleSelect(p.id)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`סימון ${p.name} לעדכון קבוצתי`}
                    style={{ width: 16, height: 16, flexShrink: 0, accentColor: tokens.accent, cursor: "pointer" }}
                  />
                  <span style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 8, border: `1px solid ${tokens.border}`, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.3rem" }}>
                    <CatalogImg link={p.picture_link ?? ""} name={p.name} />
                  </span>
                  <span style={{ flex: 1, minWidth: 160 }}>
                    <span style={{ display: "block", fontFamily: tokens.assistant, fontSize: "0.9rem", color: tokens.text }}>{p.name}</span>
                    <span style={{ display: "block", fontFamily: tokens.assistant, fontSize: "0.76rem", fontWeight: sum.packSold ? 700 : 400, color: sum.packSold ? "#1A7A4D" : tokens.dim }}>
                      📦 {sum.text}
                    </span>
                  </span>
                  <span style={{ fontFamily: tokens.assistant, fontSize: "0.78rem", color: tokens.dim }} dir="ltr">{p.sku}</span>
                  <span style={{ fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.95rem", color: tokens.text, minWidth: 64, textAlign: "left" }}>{ils(p.price)}</span>
                  <span aria-hidden style={{ fontFamily: tokens.assistant, fontSize: "0.7rem", color: tokens.dim, flexShrink: 0 }}>{isOpen ? "▲" : "▼"}</span>
                </div>
                {isOpen && <PackagingEditor key={p.id} p={p} onSaved={(patch) => mergeRows([p.id], patch)} />}
              </div>
            );
          })}
          {count > items.length && <p style={{ fontFamily: tokens.assistant, color: tokens.dim, fontSize: "0.82rem", textAlign: "center", marginTop: "0.5rem" }}>מציג 50 ראשונים · השתמשו בחיפוש למציאת מוצר</p>}
        </div>
      )}
    </>
  );
}

function solidBtnA(busy: boolean): React.CSSProperties {
  return { fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.9rem", color: "#fff", background: tokens.rainbow, border: "none", padding: "0.7rem 1.4rem", borderRadius: 999, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 };
}

/* --------- Wave 3: per-product packaging (מארז) editor --------- */

const fieldLabel: React.CSSProperties = { fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.8rem", color: tokens.text };
const fieldHint: React.CSSProperties = { fontFamily: tokens.assistant, fontSize: "0.75rem", color: tokens.dim, lineHeight: 1.5 };
// Validation notes are warm amber, not alarm-red — the manager just needs a nudge.
const softWarn: React.CSSProperties = { fontFamily: tokens.assistant, fontSize: "0.78rem", color: "#B45309", lineHeight: 1.5 };
const editInput: React.CSSProperties = {
  fontFamily: tokens.assistant, fontSize: "0.9rem", padding: "0.5rem 0.7rem", borderRadius: 10,
  border: `1px solid ${tokens.border}`, background: "#fff", color: tokens.text, width: "100%",
};

function ToggleChip({ active, disabled, onClick, children }: { active: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.8rem", padding: "0.45rem 1rem", borderRadius: 999,
        border: `1px solid ${active ? "transparent" : tokens.border}`,
        background: active ? tokens.rainbow : "#fff", color: active ? "#fff" : tokens.body,
        cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.6 : 1,
      }}
    >
      {children}
    </button>
  );
}

function PackagingEditor({ p, onSaved }: { p: ProductRow; onSaved: (patch: Partial<ProductRow>) => void }) {
  const initName = (p.display_name || "מארז").trim() || "מארז";
  const initIsPreset = PACK_NAMES.includes(initName);
  const [qtyStr, setQtyStr] = useState(String(Math.floor(Number(p.display_qty) || 1)));
  const [nameChoice, setNameChoice] = useState<string>(initIsPreset ? initName : "custom");
  const [customName, setCustomName] = useState(initIsPreset ? "" : initName);
  const [cartonStr, setCartonStr] = useState(p.carton_qty ? String(Math.floor(Number(p.carton_qty))) : "");
  const [sellBy, setSellBy] = useState<"unit" | "display">(p.sell_by === "display" || p.sell_by === "carton" ? "display" : "unit");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");

  // Any edit clears the "✓ נשמר" mark and stale errors (runs once on mount too — harmless).
  useEffect(() => { setSaved(false); setErr(""); }, [qtyStr, nameChoice, customName, cartonStr, sellBy]);

  const packName = (nameChoice === "custom" ? customName : nameChoice).trim() || "מארז";

  const qtyNum = Number(qtyStr);
  const qtyOk = qtyStr.trim() !== "" && Number.isInteger(qtyNum) && qtyNum >= 1 && qtyNum <= 1000;
  const cartonEmpty = cartonStr.trim() === "";
  const cartonNum = Number(cartonStr);
  const cartonIsInt = Number.isInteger(cartonNum) && cartonNum >= 1;
  const cartonOk = cartonEmpty || (cartonIsInt && (!qtyOk || cartonNum >= qtyNum));

  const qtyWarn = qtyOk ? "" : "כמות היחידות במארז צריכה להיות מספר שלם בין 1 ל־1000.";
  const cartonWarn = cartonOk
    ? ""
    : cartonIsInt
      ? `קרטון שלם מכיל לפחות מארז אחד — הזינו ${qtyNum} או יותר (או השאירו ריק).`
      : "כמות היחידות בקרטון צריכה להיות מספר שלם — או להישאר ריקה.";

  // Live preview: exactly what the customer will experience, from the DRAFT values.
  const packSold = sellBy === "display" && qtyOk && qtyNum > 1;
  let preview = "";
  if (qtyOk) {
    if (packSold) {
      preview = `${packName} = ${qtyNum} יחידות · כל לחיצה על + מוסיפה עוד ${packName} (${qtyNum} יח׳)`;
    } else {
      const step = stepOf({ price: p.price, display_qty: qtyNum, sell_by: sellBy, order_step: p.order_step, min_order_qty: p.min_order_qty });
      const stepTxt = step > 1 ? `כל לחיצה על + מוסיפה ${step} יח׳` : "כל לחיצה על + מוסיפה יחידה אחת";
      preview = sellBy === "display" && qtyNum === 1
        ? `נמכר ביחידות (כי במארז יש רק יחידה אחת) · ${stepTxt}`
        : `נמכר ביחידות · ${stepTxt}`;
    }
    if (cartonOk && !cartonEmpty) {
      preview += packSold && cartonNum % qtyNum === 0
        ? ` · קרטון שלם = ${cartonNum} יח׳ (${cartonNum / qtyNum} × ${packName})`
        : ` · קרטון שלם = ${cartonNum} יח׳`;
    }
  }

  const canSave = qtyOk && cartonOk && !saving;
  const save = async () => {
    if (!canSave) return;
    setSaving(true); setErr(""); setSaved(false);
    const patch: Partial<ProductRow> = {
      display_qty: qtyNum,
      display_name: packName,
      carton_qty: cartonEmpty ? null : cartonNum,
      sell_by: sellBy,
    };
    const { data, error } = await supabase.from("products").update(patch).eq("id", p.id).select("id");
    if (error || !data || data.length === 0) {
      setErr("השמירה נכשלה, נסו שוב." + (error?.message ? ` (${error.message})` : ""));
    } else {
      onSaved(patch);
      setSaved(true);
    }
    setSaving(false);
  };

  return (
    <div style={{ borderTop: `1px solid ${tokens.border}`, background: tokens.surface, padding: "1rem 0.9rem", display: "grid", gap: "0.9rem" }}>
      <div style={{ display: "grid", gap: "0.35rem" }}>
        <span style={fieldLabel}>איך המוצר נמכר ללקוח?</span>
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
          <ToggleChip active={sellBy === "unit"} disabled={saving} onClick={() => setSellBy("unit")}>נמכר ביחידות</ToggleChip>
          <ToggleChip active={sellBy === "display"} disabled={saving} onClick={() => setSellBy("display")}>נמכר במארזים שלמים</ToggleChip>
        </div>
      </div>

      <div style={{ display: "grid", gap: "0.9rem", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        <label style={{ display: "grid", gap: "0.3rem", alignContent: "start" }}>
          <span style={fieldLabel}>כמה יחידות במארז?</span>
          <input
            value={qtyStr}
            onChange={(e) => setQtyStr(e.target.value.replace(/\D/g, ""))}
            disabled={saving}
            inputMode="numeric"
            style={editInput}
          />
          <span style={fieldHint}>כמה יחידות יש במארז/מגש אחד? 1 = נמכר ביחידות</span>
          {qtyWarn && <span style={softWarn}>{qtyWarn}</span>}
        </label>

        <label style={{ display: "grid", gap: "0.3rem", alignContent: "start" }}>
          <span style={fieldLabel}>איך קוראים למארז?</span>
          <select value={nameChoice} onChange={(e) => setNameChoice(e.target.value)} disabled={saving} aria-label="שם המארז" style={{ ...selStyle, width: "100%" }}>
            {PACK_NAMES.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
            <option value="custom">שם אחר…</option>
          </select>
          {nameChoice === "custom" && (
            <input
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              disabled={saving}
              placeholder="למשל: שרוול, חבילה…"
              style={editInput}
            />
          )}
          <span style={fieldHint}>השם שהלקוח יראה ליד הכמות (מגש, מארז, דיספליי…)</span>
        </label>

        <label style={{ display: "grid", gap: "0.3rem", alignContent: "start" }}>
          <span style={fieldLabel}>כמה יחידות בקרטון שלם?</span>
          <input
            value={cartonStr}
            onChange={(e) => setCartonStr(e.target.value.replace(/\D/g, ""))}
            disabled={saving}
            inputMode="numeric"
            placeholder="לא חובה"
            style={editInput}
          />
          <span style={fieldHint}>כמה יחידות בקרטון שלם? לא חובה — אפשר להשאיר ריק</span>
          {cartonWarn && <span style={softWarn}>{cartonWarn}</span>}
        </label>
      </div>

      {preview && (
        <div style={{ fontFamily: tokens.assistant, fontSize: "0.88rem", color: tokens.text, background: "rgba(37,199,126,0.10)", border: "1px solid rgba(37,199,126,0.35)", borderRadius: 10, padding: "0.6rem 0.9rem", lineHeight: 1.6 }}>
          👁 מה הלקוח יראה: <strong>{preview}</strong>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: "0.7rem", flexWrap: "wrap" }}>
        <button onClick={save} disabled={!canSave} style={{ ...solidBtnA(saving), padding: "0.55rem 1.4rem", fontSize: "0.85rem", opacity: canSave ? 1 : 0.6 }}>
          {saving ? "שומר…" : "שמירה"}
        </button>
        {saved && <span style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: "#25C77E", fontWeight: 700 }}>✓ נשמר</span>}
        {err && <span style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: "#C0143C" }}>{err}</span>}
      </div>
    </div>
  );
}

// Bulk bar: set the same units-per-pack for every checked product in one update.
function BulkBar({ ids, onApplied, onClear }: {
  ids: string[];
  onApplied: (ids: string[], patch: Partial<ProductRow>) => void;
  onClear: () => void;
}) {
  const [val, setVal] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [isErr, setIsErr] = useState(false);

  // A stale "✓ עודכנו…" must not survive a change in what's selected.
  useEffect(() => { setMsg(""); setIsErr(false); }, [ids.length]);

  const n = Number(val);
  const valid = val.trim() !== "" && Number.isInteger(n) && n >= 1 && n <= 1000;

  const apply = async () => {
    if (!valid || saving) return;
    setSaving(true); setMsg(""); setIsErr(false);
    // One update for all: units-per-pack, and the matching sale mode —
    // more than one unit per pack means "sold in whole packs".
    const patch: Partial<ProductRow> = { display_qty: n, sell_by: n > 1 ? "display" : "unit" };
    const { data, error } = await supabase.from("products").update(patch).in("id", ids).select("id");
    if (error) {
      setMsg("העדכון הקבוצתי נכשל, נסו שוב." + (error.message ? ` (${error.message})` : ""));
      setIsErr(true);
    } else {
      const updated = ((data as { id: string }[]) ?? []).map((r) => r.id);
      onApplied(updated, patch);
      // Report the ACTUAL count the DB confirmed — if fewer rows came back
      // than were selected, say so instead of claiming full success.
      setMsg(updated.length < ids.length
        ? `✓ עודכנו ${updated.length} מתוך ${ids.length} מוצרים`
        : `✓ עודכנו ${updated.length} מוצרים`);
    }
    setSaving(false);
  };

  return (
    <div style={{ background: "#fff", border: `1px solid ${tokens.accent}`, borderRadius: 12, padding: "0.8rem 1rem", marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
      <span style={{ fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.85rem", color: tokens.text }}>
        עדכון קבוצתי · {ids.length} מסומנים
      </span>
      <span style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.body }}>קבע לכל המסומנים: יחידות במארז =</span>
      <input
        value={val}
        onChange={(e) => setVal(e.target.value.replace(/\D/g, ""))}
        disabled={saving}
        inputMode="numeric"
        aria-label="יחידות במארז לכל המסומנים"
        style={{ ...editInput, width: 72, textAlign: "center", fontFamily: tokens.rubik, fontWeight: 700 }}
      />
      <button onClick={apply} disabled={!valid || saving} style={{ ...solidBtnA(saving), padding: "0.5rem 1.2rem", fontSize: "0.8rem", opacity: valid && !saving ? 1 : 0.6 }}>
        {saving ? "מעדכן…" : "עדכון"}
      </button>
      <button onClick={onClear} disabled={saving} style={{ ...ghostBtn, padding: "0.5rem 1rem", fontSize: "0.8rem" }}>נקה בחירה</button>
      {msg && <span style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", fontWeight: 700, color: isErr ? "#C0143C" : "#25C77E" }}>{msg}</span>}
      {!valid && val.trim() !== "" && <span style={softWarn}>כמות היחידות צריכה להיות מספר שלם בין 1 ל־1000.</span>}
      <span style={{ ...fieldHint, flexBasis: "100%" }}>
        מארז של יחידה אחת = נמכר ביחידות · יותר מיחידה אחת = נמכר במארזים שלמים. שם המארז והקרטון לא משתנים כאן.
      </span>
    </div>
  );
}

/* ---------------- Customers (site accounts ↔ Rivhit) ---------------- */
type SiteProfile = {
  id: string;
  email: string;
  full_name: string;
  business_name: string;
  phone: string;
  role: string;
  rivhit_customer_id: number | null;
  // Optional: column may not exist until discount-setup.sql is applied.
  discount_percent?: number | null;
};
type RivhitCustomer = { rivhit_id: number; name: string; city: string; phone: string; email: string };

const digits = (s: string) => (s || "").replace(/\D/g, "");

function CustomersTab() {
  const [profiles, setProfiles] = useState<SiteProfile[]>([]);
  const [rivhit, setRivhit] = useState<RivhitCustomer[]>([]);
  const [busy, setBusy] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [loadErr, setLoadErr] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    const [ps, cs] = await Promise.all([
      // select("*") on purpose: an explicit column list would 400 if
      // discount_percent doesn't exist in the DB yet; "*" degrades gracefully.
      supabase.from("profiles").select("*").order("created_at", { ascending: false }),
      supabase.from("customers").select("rivhit_id,name,city,phone,email").eq("is_active", true).order("name"),
    ]);
    if (ps.error || cs.error) {
      // A failed fetch is not "0 לקוחות" — surface it and keep existing data.
      setLoadErr("טעינת הלקוחות נכשלה, נסו שוב.");
      setBusy(false);
      return;
    }
    setLoadErr("");
    setProfiles((ps.data as SiteProfile[]) ?? []);
    setRivhit((cs.data as RivhitCustomer[]) ?? []);
    setBusy(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const suggestion = useCallback((p: SiteProfile): RivhitCustomer | undefined => {
    const ph = digits(p.phone);
    if (ph.length >= 9) {
      const hit = rivhit.find((c) => digits(c.phone).endsWith(ph.slice(-9)));
      if (hit) return hit;
    }
    if (p.email) {
      const hit = rivhit.find((c) => (c.email || "").toLowerCase() === p.email.toLowerCase());
      if (hit) return hit;
    }
    return undefined;
  }, [rivhit]);

  const link = async (p: SiteProfile, rivhitId: number | null) => {
    setSavingId(p.id);
    setMsg("");
    const { error } = await supabase.from("profiles").update({ rivhit_customer_id: rivhitId }).eq("id", p.id);
    if (error) setMsg("שמירת הקישור נכשלה: " + error.message);
    else setProfiles((ps) => ps.map((x) => (x.id === p.id ? { ...x, rivhit_customer_id: rivhitId } : x)));
    setSavingId(null);
  };

  // Set a customer's fixed discount (%) — same manager→profiles update path
  // that link() already uses in production.
  const saveDiscount = async (p: SiteProfile, n: number) => {
    setSavingId(p.id);
    setMsg("");
    const d = Math.min(Math.max(Number(n) || 0, 0), 99);
    const { error } = await supabase.from("profiles").update({ discount_percent: d }).eq("id", p.id);
    if (error) setMsg("שמירת ההנחה נכשלה: " + error.message + " (אם העמודה חסרה — יש להריץ קודם את supabase/discount-setup.sql)");
    else setProfiles((ps) => ps.map((x) => (x.id === p.id ? { ...x, discount_percent: d } : x)));
    setSavingId(null);
  };

  if (busy) return <p style={{ fontFamily: tokens.assistant, color: tokens.dim }}>טוען לקוחות…</p>;

  return (
    <>
      <div style={{ background: tokens.surface, border: `1px solid ${tokens.border}`, borderRadius: 14, padding: "1rem 1.2rem", marginBottom: "1.25rem" }}>
        <p style={{ fontFamily: tokens.assistant, color: tokens.body, fontSize: "0.9rem", lineHeight: 1.6 }}>
          {profiles.length} חשבונות באתר · {rivhit.length} לקוחות ברווחית. קשרו כל חשבון לכרטיס
          הלקוח שלו ברווחית — כך נזהה אוטומטית כל הזמנה, ובעתיד גם מחירון אישי. (קריאה בלבד — לא משנה כלום ברווחית.)
        </p>
      </div>
      {msg && <p style={{ fontFamily: tokens.assistant, color: "#C0143C", fontSize: "0.9rem", marginBottom: "1rem" }}>{msg}</p>}
      {loadErr && (
        <p style={{ fontFamily: tokens.assistant, color: "#C0143C", fontSize: "0.9rem", marginBottom: "1rem" }}>
          {loadErr}{" "}
          <button onClick={load} style={{ fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.85rem", color: tokens.accent, background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
            נסו שוב
          </button>
        </p>
      )}

      <div style={{ display: "grid", gap: "0.8rem" }}>
        {profiles.map((p) => {
          const linked = rivhit.find((c) => c.rivhit_id === p.rivhit_customer_id);
          const sug = !p.rivhit_customer_id ? suggestion(p) : undefined;
          return (
            <div key={p.id} style={{ border: `1px solid ${tokens.border}`, borderRadius: 14, padding: "1rem 1.2rem", background: "#fff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "0.8rem", flexWrap: "wrap", alignItems: "center" }}>
                <div>
                  <div style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1rem", color: tokens.text }}>
                    {p.business_name || p.full_name || p.email}
                    {p.role === "manager" && <span style={{ marginInlineStart: 8, fontFamily: tokens.rubik, fontSize: "0.68rem", color: tokens.accent, background: "rgba(138,63,252,0.078)", padding: "0.15rem 0.6rem", borderRadius: 999 }}>מנהל</span>}
                  </div>
                  <div style={{ fontFamily: tokens.assistant, fontSize: "0.82rem", color: tokens.body }}>
                    {p.full_name} · <span dir="ltr">{p.email}</span> {p.phone && <span dir="ltr">· {p.phone}</span>}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                  {linked ? (
                    <>
                      <span style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: "#25C77E", fontWeight: 700 }}>
                        ✓ מקושר: {linked.name} <span dir="ltr">#{linked.rivhit_id}</span>
                      </span>
                      <button onClick={() => link(p, null)} disabled={savingId === p.id} style={{ ...ghostBtn, padding: "0.4rem 0.9rem", fontSize: "0.78rem" }}>ניתוק</button>
                    </>
                  ) : (
                    <LinkPicker rivhit={rivhit} suggestion={sug} saving={savingId === p.id} onPick={(id) => link(p, id)} />
                  )}
                </div>
              </div>
              <DiscountEditor
                current={discountPct(p.discount_percent)}
                saving={savingId === p.id}
                onSave={(n) => saveDiscount(p, n)}
              />
            </div>
          );
        })}
      </div>
    </>
  );
}

// Inline editor for a customer's fixed discount, shown on every account row.
function DiscountEditor({ current, saving, onSave }: { current: number; saving: boolean; onSave: (n: number) => void }) {
  const [val, setVal] = useState(String(current || 0));
  useEffect(() => { setVal(String(current || 0)); }, [current]);
  // Malformed input (e.g. "7..5" or an emptied field) must never silently
  // save as 0 and wipe a customer's discount — it simply isn't savable.
  const n = Number(val);
  const valid = val.trim() !== "" && Number.isFinite(n);
  const parsed = valid ? Math.min(Math.max(n, 0), 99) : current;
  const dirty = valid && parsed !== current;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.7rem", paddingTop: "0.7rem", borderTop: `1px dashed ${tokens.border}`, flexWrap: "wrap" }}>
      <span style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: current > 0 ? "#1A7A4D" : tokens.body, fontWeight: current > 0 ? 700 : 400 }}>
        🎁 הנחה קבועה:
      </span>
      <input
        value={val}
        onChange={(e) => setVal(e.target.value.replace(/[^\d.]/g, ""))}
        disabled={saving}
        inputMode="decimal"
        aria-label="אחוז הנחה קבועה"
        style={{ width: 64, fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.9rem", padding: "0.35rem 0.5rem", borderRadius: 8, border: `1px solid ${tokens.border}`, background: "#fff", color: tokens.text, textAlign: "center" }}
      />
      <span style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.dim }}>%</span>
      {dirty && (
        <button onClick={() => onSave(parsed)} disabled={saving}
          style={{ ...ghostBtn, padding: "0.35rem 0.9rem", fontSize: "0.78rem", opacity: saving ? 0.6 : 1 }}>
          {saving ? "שומר…" : "שמירה"}
        </button>
      )}
      {current > 0 && !dirty && (
        <span style={{ fontFamily: tokens.assistant, fontSize: "0.78rem", color: tokens.dim }}>
          הלקוח רואה את כל המחירים אחרי {current}% הנחה
        </span>
      )}
    </div>
  );
}

function LinkPicker({ rivhit, suggestion, saving, onPick }: {
  rivhit: RivhitCustomer[];
  suggestion?: RivhitCustomer;
  saving: boolean;
  onPick: (rivhitId: number) => void;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  // Only match by phone when the query actually contains digits — otherwise
  // includes("") is true for every customer and a name search shows arbitrary
  // results (risking linking the account to the WRONG Rivhit card).
  const nd = digits(needle);
  const matches = needle
    ? rivhit.filter((c) => c.name.toLowerCase().includes(needle) || (nd !== "" && digits(c.phone).includes(nd))).slice(0, 6)
    : [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", minWidth: 240 }}>
      {suggestion && (
        <button onClick={() => onPick(suggestion.rivhit_id)} disabled={saving}
          style={{ fontFamily: tokens.assistant, fontSize: "0.82rem", color: "#1A1730", background: "rgba(37,199,126,0.12)", border: "1px solid rgba(37,199,126,0.4)", borderRadius: 10, padding: "0.45rem 0.7rem", cursor: "pointer", textAlign: "right" }}>
          💡 הצעה: {suggestion.name} ({suggestion.city || "—"}) — לחצו לקישור
        </button>
      )}
      <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="חיפוש לקוח רווחית לפי שם או טלפון" placeholder="🔍 חיפוש לקוח רווחית לפי שם/טלפון…"
        style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", padding: "0.45rem 0.7rem", borderRadius: 10, border: `1px solid ${tokens.border}`, background: "#fff", color: tokens.text }} />
      {matches.map((c) => (
        <button key={c.rivhit_id} onClick={() => onPick(c.rivhit_id)} disabled={saving}
          style={{ fontFamily: tokens.assistant, fontSize: "0.82rem", color: tokens.text, background: tokens.surface, border: `1px solid ${tokens.border}`, borderRadius: 10, padding: "0.45rem 0.7rem", cursor: "pointer", textAlign: "right" }}>
          {c.name} {c.city && `· ${c.city}`} {c.phone && <span dir="ltr">· {c.phone}</span>}
        </button>
      ))}
    </div>
  );
}

const ghostBtn: React.CSSProperties = {
  fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.9rem", color: tokens.accent,
  background: "#fff", border: `1px solid ${tokens.border}`, padding: "0.6rem 1.2rem", borderRadius: 999, cursor: "pointer",
};
const selStyle: React.CSSProperties = {
  fontFamily: tokens.assistant, fontSize: "0.9rem", padding: "0.5rem 0.8rem", borderRadius: 10,
  border: `1px solid ${tokens.border}`, background: "#fff", color: tokens.text,
};
