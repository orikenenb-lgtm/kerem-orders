"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import SiteHeader from "../components/SiteHeader";
import { StatusBadge } from "../components/StatusBadge";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../lib/auth";
import { rivhitImg } from "../../lib/images";
import { tokens, ils } from "../../lib/ui";

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
        <main style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: tokens.assistant, color: tokens.dim }}>
          טוען…
        </main>
      </>
    );
  }

  return (
    <>
      <SiteHeader />
      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "clamp(1.5rem,4vw,3rem) clamp(1rem,4vw,2.5rem)" }}>
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
        <select value={filter} onChange={(e) => setFilter(e.target.value)} style={selStyle}>
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
                  <select value={o.status} onChange={(e) => updateStatus(o.id, e.target.value)} style={selStyle}>
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>{STATUS_HE[s]}</option>
                    ))}
                  </select>
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
type SyncRun = { id: string; status: string; summary: any; error: string | null; created_at: string };

function CatalogImg({ link, name }: { link: string; name: string }) {
  const img = rivhitImg(link);
  if (!img) return <span>🧸</span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={img} alt={name} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "contain" }} />;
}

function ProductsTab() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<any[]>([]);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [msg, setMsg] = useState("");

  const loadRuns = useCallback(async () => {
    const { data } = await supabase.from("rivhit_sync_runs").select("*").order("created_at", { ascending: false }).limit(5);
    setRuns((data as SyncRun[]) ?? []);
  }, []);

  const load = useCallback(async () => {
    setBusy(true);
    const s = query.trim().replace(/[,()%]/g, " ").trim();
    let q = supabase.from("products").select("id,name,price,sku,picture_link,stock_quantity", { count: "exact" }).eq("is_active", true);
    if (s) q = q.or(`name.ilike.%${s}%,sku.ilike.%${s}%,barcode.ilike.%${s}%`);
    const { data, count } = await q.order("name").range(0, 49);
    setItems(data ?? []); setCount(count ?? 0); setBusy(false);
  }, [query]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadRuns(); }, [loadRuns]);

  const runSync = async () => {
    setSyncing(true); setMsg("");
    try {
      const { data, error } = await supabase.functions.invoke("rivhit-sync", { body: { mode: "sync", what: "both" } });
      if (error) throw error;
      const runId = (data as any)?.run_id;
      for (let i = 0; i < 40 && runId; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const { data: row } = await supabase.from("rivhit_sync_runs").select("status,summary,error").eq("id", runId).maybeSingle();
        if (row && row.status !== "running") {
          setMsg(row.status === "done"
            ? `הסנכרון הושלם: ${row.summary?.products?.synced ?? 0} מוצרים, ${row.summary?.customers?.synced ?? 0} לקוחות.`
            : `שגיאה: ${row.error}`);
          break;
        }
      }
      await load(); await loadRuns();
    } catch (e: any) {
      setMsg("הסנכרון נכשל: " + (e?.message ?? e));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <>
      <div style={{ background: tokens.surface, border: `1px solid ${tokens.border}`, borderRadius: 14, padding: "1.1rem 1.2rem", marginBottom: "1.25rem", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.1rem", color: tokens.text }}>{count.toLocaleString("he-IL")} מוצרים פעילים</div>
          <div style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.body }}>מסונכרן מרווחית (קריאה בלבד) — לא משנה דבר ברווחית.</div>
        </div>
        <button onClick={runSync} disabled={syncing} style={solidBtnA(syncing)}>{syncing ? "מסנכרן…" : "סנכרן מרווחית ↻"}</button>
      </div>
      {msg && <p style={{ fontFamily: tokens.assistant, color: tokens.body, fontSize: "0.9rem", marginBottom: "1rem" }}>{msg}</p>}

      {runs.length > 0 && (
        <div style={{ marginBottom: "1.25rem" }}>
          <div style={{ fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.8rem", color: tokens.dim, marginBottom: "0.4rem" }}>ריצות סנכרון אחרונות</div>
          {runs.map((r) => (
            <div key={r.id} style={{ fontFamily: tokens.assistant, fontSize: "0.8rem", color: tokens.body, display: "flex", gap: "0.6rem", padding: "0.15rem 0", flexWrap: "wrap" }}>
              <span>{new Date(r.created_at).toLocaleString("he-IL")}</span>
              <span style={{ fontWeight: 700, color: r.status === "done" ? "#25C77E" : r.status === "error" ? "#C0143C" : tokens.dim }}>{r.status}</span>
              {r.summary?.products && <span>· {r.summary.products.synced} מוצרים</span>}
              {r.summary?.customers && <span>· {r.summary.customers.synced} לקוחות</span>}
            </div>
          ))}
        </div>
      )}

      <input placeholder="🔍 חיפוש מוצר / קוד…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: "100%", fontFamily: tokens.assistant, fontSize: "0.95rem", padding: "0.6rem 0.9rem", borderRadius: 12, border: `1px solid ${tokens.border}`, background: "#fff", color: tokens.text, marginBottom: "1rem" }} />

      {busy ? (
        <p style={{ fontFamily: tokens.assistant, color: tokens.dim }}>טוען…</p>
      ) : (
        <div style={{ display: "grid", gap: "0.4rem" }}>
          {items.map((p) => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: "0.8rem", border: `1px solid ${tokens.border}`, borderRadius: 10, padding: "0.5rem 0.9rem", background: "#fff" }}>
              <span style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 8, border: `1px solid ${tokens.border}`, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.3rem" }}>
                <CatalogImg link={p.picture_link} name={p.name} />
              </span>
              <span style={{ flex: 1, fontFamily: tokens.assistant, fontSize: "0.9rem", color: tokens.text }}>{p.name}</span>
              <span style={{ fontFamily: tokens.assistant, fontSize: "0.78rem", color: tokens.dim }} dir="ltr">{p.sku}</span>
              <span style={{ fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.95rem", color: tokens.text, minWidth: 64, textAlign: "left" }}>{ils(p.price)}</span>
            </div>
          ))}
          {count > items.length && <p style={{ fontFamily: tokens.assistant, color: tokens.dim, fontSize: "0.82rem", textAlign: "center", marginTop: "0.5rem" }}>מציג 50 ראשונים · השתמשו בחיפוש למציאת מוצר</p>}
        </div>
      )}
    </>
  );
}

function solidBtnA(busy: boolean): React.CSSProperties {
  return { fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.9rem", color: "#fff", background: tokens.rainbow, border: "none", padding: "0.7rem 1.4rem", borderRadius: 999, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 };
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
};
type RivhitCustomer = { rivhit_id: number; name: string; city: string; phone: string; email: string };

const digits = (s: string) => (s || "").replace(/\D/g, "");

function CustomersTab() {
  const [profiles, setProfiles] = useState<SiteProfile[]>([]);
  const [rivhit, setRivhit] = useState<RivhitCustomer[]>([]);
  const [busy, setBusy] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    const [{ data: ps }, { data: cs }] = await Promise.all([
      supabase.from("profiles").select("id,email,full_name,business_name,phone,role,rivhit_customer_id").order("created_at", { ascending: false }),
      supabase.from("customers").select("rivhit_id,name,city,phone,email").eq("is_active", true).order("name"),
    ]);
    setProfiles((ps as SiteProfile[]) ?? []);
    setRivhit((cs as RivhitCustomer[]) ?? []);
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
                    {p.role === "manager" && <span style={{ marginInlineStart: 8, fontFamily: tokens.rubik, fontSize: "0.68rem", color: tokens.accent, background: `${tokens.accent}14`, padding: "0.15rem 0.6rem", borderRadius: 999 }}>מנהל</span>}
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
            </div>
          );
        })}
      </div>
    </>
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
  const matches = needle
    ? rivhit.filter((c) => c.name.toLowerCase().includes(needle) || digits(c.phone).includes(digits(needle))).slice(0, 6)
    : [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", minWidth: 240 }}>
      {suggestion && (
        <button onClick={() => onPick(suggestion.rivhit_id)} disabled={saving}
          style={{ fontFamily: tokens.assistant, fontSize: "0.82rem", color: "#1A1730", background: "rgba(37,199,126,0.12)", border: "1px solid rgba(37,199,126,0.4)", borderRadius: 10, padding: "0.45rem 0.7rem", cursor: "pointer", textAlign: "right" }}>
          💡 הצעה: {suggestion.name} ({suggestion.city || "—"}) — לחצו לקישור
        </button>
      )}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 חיפוש לקוח רווחית לפי שם/טלפון…"
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
