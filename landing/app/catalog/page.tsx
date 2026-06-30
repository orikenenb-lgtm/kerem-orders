"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import SiteHeader from "../components/SiteHeader";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../lib/auth";
import { rivhitImg } from "../../lib/images";
import { tokens, ils } from "../../lib/ui";

type Product = {
  id: string;
  name: string;
  price: number;
  sku: string | null;
  barcode: string;
  picture_link: string;
  stock_quantity: number;
};
type CartLine = { qty: number; name: string; price: number; sku: string | null; picture_link: string };
type Cart = Record<string, CartLine>;

const CART_KEY = "kt_cart_v2";
const PAGE_SIZE = 24;

export default function CatalogPage() {
  const router = useRouter();
  const { session, profile, loading } = useAuth();

  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [categories, setCategories] = useState<{ category: string; n: number }[]>([]);
  const [activeCat, setActiveCat] = useState("all");

  const [cart, setCart] = useState<Cart>({});
  const [note, setNote] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [placed, setPlaced] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [cartOpen, setCartOpen] = useState(false);

  useEffect(() => {
    if (!loading && !session) router.replace("/login");
  }, [loading, session, router]);

  // cart persistence
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CART_KEY);
      if (raw) setCart(JSON.parse(raw));
    } catch { /* */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch { /* */ }
  }, [cart]);

  useEffect(() => {
    if (profile) {
      setContactName((v) => v || profile.full_name || "");
      setContactPhone((v) => v || profile.phone || "");
    }
  }, [profile]);

  // load category list once
  useEffect(() => {
    if (!session) return;
    supabase.rpc("catalog_categories").then(({ data }) => {
      setCategories((data as { category: string; n: number }[]) ?? []);
    });
  }, [session]);

  // debounce search -> query, reset to page 0
  useEffect(() => {
    const t = setTimeout(() => { setQuery(input); setPage(0); }, 350);
    return () => clearTimeout(t);
  }, [input]);

  // reset to first page when switching category
  useEffect(() => { setPage(0); }, [activeCat]);

  const loadProducts = useCallback(async () => {
    if (!session) return;
    setLoadingProducts(true);
    const s = query.trim().replace(/[,()%]/g, " ").trim();
    let q = supabase
      .from("products")
      .select("id,name,price,sku,barcode,picture_link,stock_quantity", { count: "exact" })
      .eq("is_active", true);
    if (activeCat !== "all") q = q.eq("category", activeCat);
    if (s) q = q.or(`name.ilike.%${s}%,sku.ilike.%${s}%,barcode.ilike.%${s}%`);
    const { data, count } = await q
      .order("name", { ascending: true })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    setProducts((data as Product[]) ?? []);
    setTotal(count ?? 0);
    setLoadingProducts(false);
  }, [session, query, page, activeCat]);

  useEffect(() => { loadProducts(); }, [loadProducts]);

  const setQty = (p: Product, qty: number) =>
    setCart((c) => {
      const next = { ...c };
      if (qty <= 0) delete next[p.id];
      else next[p.id] = { qty: Math.min(qty, 9999), name: p.name, price: p.price, sku: p.sku, picture_link: p.picture_link };
      return next;
    });

  const lines = useMemo(
    () => Object.entries(cart).map(([id, v]) => ({ id, ...v })),
    [cart]
  );
  const cartTotal = useMemo(() => lines.reduce((s, l) => s + l.price * l.qty, 0), [lines]);
  const itemCount = useMemo(() => lines.reduce((s, l) => s + l.qty, 0), [lines]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // keep all "חדש/חדשים" categories grouped together (adjacent) in the chip bar
  const orderedCats = useMemo(() => {
    const isNew = (name: string) => /חדש/.test(name);
    const newMax = categories.filter((c) => isNew(c.category)).reduce((m, c) => Math.max(m, c.n), 0);
    return [...categories].sort((a, b) => {
      const ra = isNew(a.category) ? newMax + 1 : a.n;
      const rb = isNew(b.category) ? newMax + 1 : b.n;
      return ra !== rb ? rb - ra : b.n - a.n;
    });
  }, [categories]);

  const placeOrder = async () => {
    if (!session || lines.length === 0) return;
    setSubmitting(true);
    setError("");
    try {
      const { data: order, error: oErr } = await supabase
        .from("orders")
        .insert({
          user_id: session.user.id,
          total: cartTotal,
          note,
          contact_name: contactName,
          contact_phone: contactPhone,
          business_name: profile?.business_name ?? "",
          status: "new",
        })
        .select("id")
        .single();
      if (oErr || !order) throw oErr ?? new Error("order failed");
      const items = lines.map((l) => ({
        order_id: order.id,
        product_id: l.id,
        product_sku: l.sku ?? "",
        product_name: l.name,
        unit_price: l.price,
        quantity: l.qty,
      }));
      const { error: iErr } = await supabase.from("order_items").insert(items);
      if (iErr) throw iErr;
      setPlaced(order.id);
      setCart({});
      setNote("");
      setCartOpen(false);
    } catch {
      setError("שליחת ההזמנה נכשלה. נסו שוב בעוד רגע.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !session) {
    return (
      <>
        <SiteHeader />
        <main style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: tokens.assistant, color: tokens.dim }}>
          טוען…
        </main>
      </>
    );
  }

  if (placed) {
    return (
      <>
        <SiteHeader />
        <main style={{ maxWidth: 640, margin: "0 auto", padding: "5rem 1.25rem", textAlign: "center" }}>
          <div style={{ fontSize: "4rem", marginBottom: "1rem" }}>🎉</div>
          <h1 style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "2rem", color: tokens.text, marginBottom: "0.6rem" }}>ההזמנה נשלחה!</h1>
          <p style={{ fontFamily: tokens.assistant, color: tokens.body, marginBottom: "2rem" }}>
            ההזמנה התקבלה ונשלחה למנהל. מספר הזמנה: <b dir="ltr">{placed.slice(0, 8)}</b>
          </p>
          <div style={{ display: "flex", gap: "0.8rem", justifyContent: "center", flexWrap: "wrap" }}>
            <button onClick={() => setPlaced(null)} style={ghostBtn}>להזמנה נוספת</button>
            <button onClick={() => router.push("/account")} style={solidBtn}>ההזמנות שלי</button>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <SiteHeader />
      <main style={{ maxWidth: 1280, margin: "0 auto", padding: "clamp(1.25rem,4vw,2.5rem) clamp(1rem,4vw,2.5rem) 6rem" }}>
        <h1 style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "clamp(1.6rem,4vw,2.6rem)", color: tokens.text }}>
          הקטלוג הסיטונאי
        </h1>
        <p style={{ fontFamily: tokens.assistant, color: tokens.body, marginTop: "0.3rem" }}>
          {total.toLocaleString("he-IL")} מוצרים · מסונכרן מרווחית
        </p>

        <div style={{ position: "sticky", top: 64, zIndex: 20, background: "rgba(255,255,255,0.94)", backdropFilter: "blur(8px)", padding: "1rem 0", marginTop: "0.5rem" }}>
          <input
            placeholder="🔍 חיפוש לפי שם, קוד פריט או ברקוד…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            style={{ width: "100%", fontFamily: tokens.assistant, fontSize: "1rem", padding: "0.85rem 1rem", borderRadius: 14, border: `1px solid ${tokens.border}`, background: tokens.surface, color: tokens.text }}
          />
          {categories.length > 0 && (
            <div style={{ display: "flex", gap: "0.5rem", overflowX: "auto", paddingBottom: "0.3rem", marginTop: "0.7rem" }}>
              {[{ category: "all", n: 0 }, ...orderedCats].map((c, i) => {
                const active = activeCat === c.category;
                const accent = c.category === "all" ? tokens.accent : tokens.rainbowColors[i % tokens.rainbowColors.length];
                return (
                  <button
                    key={c.category}
                    onClick={() => setActiveCat(c.category)}
                    style={{
                      whiteSpace: "nowrap", fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.82rem",
                      padding: "0.45rem 1rem", borderRadius: 999, cursor: "pointer",
                      border: `1px solid ${active ? "transparent" : tokens.border}`,
                      background: active ? accent : "#fff", color: active ? "#fff" : tokens.body,
                    }}
                  >
                    {c.category === "all" ? "הכל" : `${c.category} (${c.n})`}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {loadingProducts ? (
          <p style={{ fontFamily: tokens.assistant, color: tokens.dim, marginTop: "2rem" }}>טוען מוצרים…</p>
        ) : products.length === 0 ? (
          <p style={{ fontFamily: tokens.assistant, color: tokens.dim, marginTop: "2rem" }}>לא נמצאו מוצרים{query ? ` עבור “${query}”` : ""}.</p>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "1rem", marginTop: "1rem" }}>
              {products.map((p, i) => {
                const accent = tokens.rainbowColors[i % tokens.rainbowColors.length];
                const qty = cart[p.id]?.qty ?? 0;
                const img = rivhitImg(p.picture_link);
                return (
                  <div key={p.id} style={{ border: `1px solid ${tokens.border}`, borderTop: `3px solid ${accent}`, borderRadius: 16, padding: "0.9rem", background: "#fff", boxShadow: "0 8px 24px rgba(26,23,48,0.05)", display: "flex", flexDirection: "column", gap: "0.45rem" }}>
                    <div style={{ height: 150, borderRadius: 12, background: "#fff", border: `1px solid ${tokens.border}`, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", fontSize: "2.6rem" }}>
                      {img ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={img} alt={p.name} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                      ) : (
                        <span>🧸</span>
                      )}
                    </div>
                    <h3 style={{ fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.92rem", color: tokens.text, lineHeight: 1.25, minHeight: "2.3em" }}>{p.name}</h3>
                    <div style={{ fontFamily: tokens.assistant, fontSize: "0.72rem", color: tokens.dim }}>קוד: <span dir="ltr">{p.sku || "—"}</span></div>
                    <div style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.1rem", color: tokens.text }}>{ils(p.price)}</div>
                    {qty === 0 ? (
                      <button onClick={() => setQty(p, 1)} style={{ ...solidBtn, width: "100%", padding: "0.55rem" }}>הוספה</button>
                    ) : (
                      <Stepper qty={qty} onChange={(n) => setQty(p, n)} accent={accent} />
                    )}
                  </div>
                );
              })}
            </div>

            {pages > 1 && (
              <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "1rem", marginTop: "2rem" }}>
                <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} style={{ ...ghostBtn, opacity: page === 0 ? 0.4 : 1 }}>← הקודם</button>
                <span style={{ fontFamily: tokens.rubik, fontWeight: 700, color: tokens.body }}>עמוד {page + 1} מתוך {pages}</span>
                <button onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1} style={{ ...ghostBtn, opacity: page >= pages - 1 ? 0.4 : 1 }}>הבא →</button>
              </div>
            )}
          </>
        )}
      </main>

      {itemCount > 0 && !cartOpen && (
        <button onClick={() => setCartOpen(true)} style={{ position: "fixed", insetInlineStart: 20, bottom: 20, zIndex: 60, fontFamily: tokens.rubik, fontWeight: 800, fontSize: "0.95rem", color: "#fff", background: tokens.rainbow, border: "none", padding: "1rem 1.6rem", borderRadius: 999, boxShadow: "0 12px 30px rgba(138,63,252,0.35)", cursor: "pointer" }}>
          🛒 העגלה ({itemCount}) · {ils(cartTotal)}
        </button>
      )}

      {cartOpen && (
        <div onClick={() => setCartOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(26,23,48,0.4)", display: "flex", justifyContent: "flex-start" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(420px, 92vw)", height: "100%", background: "#fff", padding: "1.5rem", overflowY: "auto", boxShadow: "0 0 60px rgba(0,0,0,0.2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.2rem" }}>
              <h2 style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.4rem", color: tokens.text }}>העגלה ({itemCount})</h2>
              <button onClick={() => setCartOpen(false)} style={{ background: "none", border: "none", fontSize: "1.6rem", cursor: "pointer", color: tokens.dim }}>×</button>
            </div>
            {lines.length === 0 ? (
              <p style={{ fontFamily: tokens.assistant, color: tokens.dim }}>העגלה ריקה.</p>
            ) : (
              <>
                <div style={{ display: "grid", gap: "0.8rem", marginBottom: "1rem" }}>
                  {lines.map((l) => {
                    const img = rivhitImg(l.picture_link);
                    return (
                      <div key={l.id} style={{ display: "flex", gap: "0.6rem", alignItems: "center", borderBottom: `1px solid ${tokens.border}`, paddingBottom: "0.6rem" }}>
                        <div style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 8, border: `1px solid ${tokens.border}`, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.4rem" }}>
                          {img ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={img} alt={l.name} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                          ) : (<span>🧸</span>)}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontFamily: tokens.assistant, fontWeight: 600, fontSize: "0.88rem", color: tokens.text }}>{l.name}</div>
                          <div style={{ fontFamily: tokens.assistant, fontSize: "0.8rem", color: tokens.dim }}>{ils(l.price)} ליח׳</div>
                        </div>
                        <Stepper qty={l.qty} accent={tokens.accent} compact onChange={(n) => setCart((c) => {
                          const next = { ...c };
                          if (n <= 0) delete next[l.id]; else next[l.id] = { ...c[l.id], qty: n };
                          return next;
                        })} />
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.2rem", color: tokens.text, marginBottom: "1.2rem" }}>
                  <span>סה״כ</span><span>{ils(cartTotal)}</span>
                </div>
                <div style={{ display: "grid", gap: "0.6rem", marginBottom: "1rem" }}>
                  <input placeholder="שם איש קשר" value={contactName} onChange={(e) => setContactName(e.target.value)} style={miniInp} />
                  <input placeholder="טלפון" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} style={miniInp} inputMode="tel" />
                  <textarea placeholder="הערה להזמנה (לא חובה)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} style={{ ...miniInp, resize: "vertical" }} />
                </div>
                {error && <div role="alert" style={{ fontFamily: tokens.assistant, color: "#C0143C", fontSize: "0.88rem", marginBottom: "0.8rem" }}>{error}</div>}
                <button onClick={placeOrder} disabled={submitting} style={{ ...solidBtn, width: "100%", padding: "0.95rem" }}>
                  {submitting ? "שולח…" : "שליחת הזמנה למנהל"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Stepper({ qty, onChange, accent, compact }: { qty: number; onChange: (q: number) => void; accent: string; compact?: boolean }) {
  const sz = compact ? 30 : 34;
  const btn: React.CSSProperties = { width: sz, height: sz, borderRadius: 9, border: `1px solid ${accent}`, background: "#fff", color: accent, fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.05rem", cursor: "pointer", flexShrink: 0 };
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.4rem" }}>
      <button aria-label="פחות" style={btn} onClick={() => onChange(qty - 1)}>−</button>
      <input value={qty} onChange={(e) => { const n = parseInt(e.target.value.replace(/\D/g, ""), 10); onChange(Number.isFinite(n) ? n : 0); }} style={{ width: compact ? 44 : 52, textAlign: "center", fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.95rem", border: `1px solid ${tokens.border}`, borderRadius: 9, padding: "0.4rem 0" }} inputMode="numeric" />
      <button aria-label="עוד" style={btn} onClick={() => onChange(qty + 1)}>+</button>
    </div>
  );
}

const solidBtn: React.CSSProperties = { fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.88rem", color: "#fff", background: tokens.rainbow, border: "none", padding: "0.7rem 1.3rem", borderRadius: 999, cursor: "pointer" };
const ghostBtn: React.CSSProperties = { fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.88rem", color: tokens.accent, background: "#fff", border: `1px solid ${tokens.border}`, padding: "0.7rem 1.3rem", borderRadius: 999, cursor: "pointer" };
const miniInp: React.CSSProperties = { fontFamily: tokens.assistant, fontSize: "0.95rem", padding: "0.6rem 0.75rem", borderRadius: 10, border: `1px solid ${tokens.border}`, background: tokens.surface, color: tokens.text, width: "100%" };
