"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import SiteHeader from "../components/SiteHeader";
import { StatusBadge } from "../components/StatusBadge";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../lib/auth";
import { PRODUCTS, CATEGORIES } from "../../lib/catalog";
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
  business_name: string;
  order_items: OrderItem[];
};

const STATUSES = ["new", "processing", "done", "cancelled"] as const;
const STATUS_HE: Record<string, string> = { new: "התקבלה", processing: "בטיפול", done: "הושלמה", cancelled: "בוטלה" };

export default function AdminPage() {
  const router = useRouter();
  const { session, isManager, loading } = useAuth();
  const [tab, setTab] = useState<"orders" | "products">("orders");

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

        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "2rem" }}>
          <TabBtn active={tab === "orders"} onClick={() => setTab("orders")}>הזמנות</TabBtn>
          <TabBtn active={tab === "products"} onClick={() => setTab("products")}>קטלוג</TabBtn>
        </div>

        {tab === "orders" ? <OrdersTab /> : <ProductsTab />}
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
    setOrders((os) => os.map((o) => (o.id === id ? { ...o, status } : o)));
    await supabase.from("orders").update({ status }).eq("id", id);
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

/* ---------------- Catalog (read-only) ---------------- */
function ProductsTab() {
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState("all");

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return PRODUCTS.filter(
      (p) =>
        (cat === "all" || p.category === cat) &&
        (!needle || p.name.toLowerCase().includes(needle) || p.sku.includes(needle))
    );
  }, [query, cat]);

  return (
    <>
      <div style={{ background: tokens.surface, border: `1px solid ${tokens.border}`, borderRadius: 14, padding: "1rem 1.2rem", marginBottom: "1.5rem" }}>
        <p style={{ fontFamily: tokens.assistant, color: tokens.body, fontSize: "0.9rem", lineHeight: 1.6 }}>
          הקטלוג ({PRODUCTS.length} מוצרים) נטען מקובץ האקסל שלכם. בשלב הבא נחבר אותו
          ישירות ל<b>רווחית</b> כדי שהמלאי, הקודים והמחירים יתעדכנו אוטומטית.
        </p>
      </div>

      <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", marginBottom: "1.2rem" }}>
        <input
          placeholder="🔍 חיפוש מוצר / קוד…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: "1 1 240px", fontFamily: tokens.assistant, fontSize: "0.95rem", padding: "0.6rem 0.9rem", borderRadius: 12, border: `1px solid ${tokens.border}`, background: "#fff", color: tokens.text }}
        />
        <select value={cat} onChange={(e) => setCat(e.target.value)} style={selStyle}>
          <option value="all">כל הקטגוריות</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <p style={{ fontFamily: tokens.assistant, color: tokens.dim, fontSize: "0.85rem", marginBottom: "0.8rem" }}>{shown.length} מוצרים</p>

      <div style={{ display: "grid", gap: "0.4rem" }}>
        {shown.slice(0, 400).map((p) => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: "0.8rem", border: `1px solid ${tokens.border}`, borderRadius: 10, padding: "0.6rem 0.9rem", background: "#fff" }}>
            <span style={{ fontSize: "1.4rem" }}>{p.emoji}</span>
            <span style={{ flex: 1, fontFamily: tokens.assistant, fontSize: "0.9rem", color: tokens.text }}>{p.name}</span>
            <span style={{ fontFamily: tokens.assistant, fontSize: "0.78rem", color: tokens.dim }} dir="ltr">{p.sku}</span>
            <span style={{ fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.95rem", color: tokens.text, minWidth: 70, textAlign: "left" }}>{ils(p.price)}</span>
          </div>
        ))}
      </div>
    </>
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
