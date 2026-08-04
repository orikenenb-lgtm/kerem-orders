"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import SiteHeader from "../components/SiteHeader";
import SiteFooter from "../components/SiteFooter";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../lib/auth";
import { rivhitImg } from "../../lib/images";
import { tokens, ils, discountPct, applyDiscount } from "../../lib/ui";
import { featureFlags } from "../../lib/featureFlags";
import { resolveQuantity, stepOf } from "../../lib/quantity";

const ffQty = featureFlags.ff_display_quantities;
const CART_KEY = "kt_cart_v2";
const PROD_COLS =
  "id,name,price,sku,barcode,picture_link,category,rotation_override,unit_name,display_qty,display_name,carton_qty,min_order_qty,order_step,sell_by,is_active";

type Product = {
  id: string;
  name: string;
  price: number;
  sku: string | null;
  barcode: string | null;
  picture_link: string;
  category: string | null;
  rotation_override?: number | null;
  unit_name?: string | null;
  display_qty?: number | null;
  display_name?: string | null;
  carton_qty?: number | null;
  min_order_qty?: number | null;
  order_step?: number | null;
  sell_by?: string | null;
  is_active?: boolean;
};

// Image with graceful emoji fallback (same behavior as the catalog).
function ProductImg({ src, alt, style }: { src: string; alt: string; style?: React.CSSProperties }) {
  const [err, setErr] = useState(false);
  useEffect(() => { setErr(false); }, [src]);
  if (!src || err) return <span style={{ fontSize: "4rem" }}>🧸</span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} loading="lazy" onError={() => setErr(true)} style={style} />;
}

// Add `addUnits` to the SAME localStorage cart the catalog uses, through the
// SAME shared resolver — so a line added here is byte-identical to one added
// from the catalog, and the checkout reconcile never flags it.
function addToCart(p: Product, addUnits: number, discount: number) {
  let cart: Record<string, { qty: number; name: string; price: number; sku: string | null; picture_link: string; display_qty?: number | null; display_name?: string | null }> = {};
  try {
    const raw = localStorage.getItem(CART_KEY);
    if (raw) cart = JSON.parse(raw);
  } catch { /* ignore */ }
  const existing = Number(cart[p.id]?.qty) || 0;
  const requested = existing + addUnits;
  const q = ffQty ? resolveQuantity(p, Math.min(requested, 9999)).units : Math.min(requested, 9999);
  if (q <= 0) delete cart[p.id];
  else cart[p.id] = {
    qty: q,
    name: p.name,
    price: applyDiscount(p.price, discount),
    sku: p.sku,
    picture_link: p.picture_link,
    ...(ffQty ? { display_qty: p.display_qty ?? null, display_name: p.display_name ?? null } : {}),
  };
  try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch { /* ignore */ }
  return q;
}

function ProductDetail() {
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get("id") || "";
  const { session, profile, loading } = useAuth();
  const discount = discountPct(profile?.discount_percent);

  const [product, setProduct] = useState<Product | null>(null);
  const [related, setRelated] = useState<Product[]>([]);
  const [busy, setBusy] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(0);
  const [vatLabel, setVatLabel] = useState(true);

  useEffect(() => {
    if (!loading && !session) router.replace("/login");
  }, [loading, session, router]);

  useEffect(() => {
    if (!session) return;
    supabase.from("site_settings").select("key,value").in("key", ["prices_include_vat"]).then(({ data }) => {
      const v = ((data ?? []) as { key: string; value: string }[]).find((r) => r.key === "prices_include_vat")?.value;
      setVatLabel(v === undefined || v === "true" || v === "1");
    });
  }, [session]);

  const load = useCallback(async () => {
    if (!session) return;
    if (!id) { setBusy(false); setNotFound(true); return; }
    setBusy(true);
    setNotFound(false);
    const { data, error } = await supabase.from("products").select(PROD_COLS).eq("id", id).eq("is_active", true).maybeSingle();
    if (error) { setBusy(false); setNotFound(true); return; }
    if (!data) { setBusy(false); setNotFound(true); return; }
    const p = data as Product;
    setProduct(p);
    setQty(ffQty ? stepOf(p) : 1);
    setBusy(false);
    // related — same category, a handful, excluding self
    if (p.category) {
      const { data: rel } = await supabase
        .from("products")
        .select(PROD_COLS)
        .eq("is_active", true)
        .eq("category", p.category)
        .neq("id", p.id)
        .order("name")
        .limit(8);
      setRelated((rel as Product[]) ?? []);
    } else {
      setRelated([]);
    }
  }, [session, id]);

  useEffect(() => { load(); }, [load]);

  if (loading || busy) {
    return (
      <main id="main-content" style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: tokens.assistant, color: tokens.dim }}>
        טוען…
      </main>
    );
  }

  if (notFound || !product) {
    return (
      <main id="main-content" style={{ maxWidth: 640, margin: "0 auto", padding: "5rem 1.25rem", textAlign: "center" }}>
        <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🧸</div>
        <h1 style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.6rem", color: tokens.text, marginBottom: "1rem" }}>המוצר לא נמצא</h1>
        <Link href="/catalog" style={{ fontFamily: tokens.rubik, fontWeight: 700, color: "#fff", background: tokens.rainbow, padding: "0.7rem 1.6rem", borderRadius: 999, textDecoration: "none" }}>← חזרה לקטלוג</Link>
      </main>
    );
  }

  const p = product;
  const img = rivhitImg(p.picture_link, 900, p.rotation_override ?? 0);
  const step = ffQty ? stepOf(p) : 1;
  const unitPrice = applyDiscount(p.price, discount);
  // The button total reflects the quantity that will ACTUALLY be added: for
  // pack-sold products a typed number is rounded up to a whole pack, so preview
  // the resolved units, not the raw input.
  const effectiveQty = ffQty ? resolveQuantity(p, qty).units : qty;
  const lineTotal = unitPrice * effectiveQty;

  return (
    <main id="main-content" style={{ maxWidth: 1100, margin: "0 auto", padding: "clamp(1.25rem,4vw,2.5rem) clamp(1rem,4vw,2.5rem) 4rem" }}>
      <div style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.dim, marginBottom: "1.2rem" }}>
        <Link href="/catalog" style={{ color: tokens.accent, textDecoration: "none" }}>הקטלוג</Link>
        {p.category ? <> · {p.category}</> : null}
      </div>

      <div style={{ display: "grid", gap: "clamp(1.5rem,4vw,3rem)", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", alignItems: "start" }}>
        {/* image */}
        <div style={{ background: "#fff", border: `1px solid ${tokens.border}`, borderRadius: 20, padding: "1.5rem", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 340, boxShadow: tokens.shadowCard }}>
          <ProductImg src={img} alt={p.name} style={{ maxWidth: "100%", maxHeight: 440, width: "auto", height: "auto", objectFit: "contain" }} />
        </div>

        {/* details */}
        <div>
          <h1 style={{ fontFamily: tokens.rubik, fontWeight: 900, fontSize: "clamp(1.4rem,3vw,2rem)", color: tokens.text, lineHeight: 1.2 }}>{p.name}</h1>
          <div style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.dim, marginTop: "0.6rem", display: "flex", gap: "1.2rem", flexWrap: "wrap" }}>
            <span>קוד: <span dir="ltr">{p.sku || "—"}</span></span>
            {p.barcode ? <span>ברקוד: <span dir="ltr">{p.barcode}</span></span> : null}
          </div>

          {/* price */}
          <div style={{ marginTop: "1.4rem", display: "flex", alignItems: "baseline", gap: "0.6rem", flexWrap: "wrap" }}>
            {discount > 0 ? (
              <>
                <span style={{ fontFamily: tokens.rubik, fontWeight: 900, fontSize: "2rem", color: "#1A7A4D" }}>{ils(unitPrice)}</span>
                <s style={{ fontFamily: tokens.assistant, fontSize: "1rem", color: tokens.dim }}>{ils(p.price)}</s>
                <span style={{ fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.8rem", color: "#fff", background: "#25C77E", padding: "0.2rem 0.7rem", borderRadius: 999 }}>‎-{discount}%</span>
              </>
            ) : (
              <span style={{ fontFamily: tokens.rubik, fontWeight: 900, fontSize: "2rem", color: tokens.text }}>{ils(p.price)}</span>
            )}
            <span style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.dim }}>ליחידה{vatLabel ? " · כולל מע״מ" : ""}</span>
          </div>

          {/* quantity + add */}
          <div style={{ marginTop: "1.6rem", display: "flex", alignItems: "center", gap: "0.8rem", flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <button aria-label="פחות" onClick={() => setQty((n) => Math.max(step, n - step))}
                style={{ width: 40, height: 40, borderRadius: 10, border: `1px solid ${tokens.accent}`, background: "#fff", color: tokens.accent, fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.2rem", cursor: "pointer" }}>−</button>
              <input value={qty} onChange={(e) => { const n = parseInt(e.target.value.replace(/\D/g, ""), 10); setQty(Number.isFinite(n) && n > 0 ? n : step); }} inputMode="numeric"
                style={{ width: 72, textAlign: "center", fontFamily: tokens.rubik, fontWeight: 700, fontSize: "1rem", border: `1px solid ${tokens.border}`, borderRadius: 10, padding: "0.5rem 0" }} />
              <button aria-label="עוד" onClick={() => setQty((n) => n + step)}
                style={{ width: 40, height: 40, borderRadius: 10, border: `1px solid ${tokens.accent}`, background: "#fff", color: tokens.accent, fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.2rem", cursor: "pointer" }}>+</button>
            </div>
            <button
              onClick={() => { const total = addToCart(p, qty, discount); setAdded(total); }}
              style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1rem", color: "#fff", background: tokens.rainbow, border: "none", padding: "0.85rem 2rem", borderRadius: 999, cursor: "pointer" }}
            >
              🛒 הוספה לעגלה · {ils(lineTotal)}
            </button>
          </div>

          {added > 0 && (
            <div role="status" style={{ marginTop: "1rem", fontFamily: tokens.assistant, fontSize: "0.92rem", color: "#1A7A4D", background: "rgba(37,199,126,0.12)", border: "1px solid rgba(37,199,126,0.4)", borderRadius: 12, padding: "0.7rem 1rem", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <span>✓ נוסף לעגלה ({added.toLocaleString("he-IL")} בעגלה)</span>
              <Link href="/catalog" style={{ fontFamily: tokens.rubik, fontWeight: 700, color: "#fff", background: "#1A7A4D", padding: "0.45rem 1.1rem", borderRadius: 999, textDecoration: "none", whiteSpace: "nowrap" }}>למעבר לעגלה ולסיום הזמנה ←</Link>
            </div>
          )}
        </div>
      </div>

      {/* related */}
      {related.length > 0 && (
        <section style={{ marginTop: "3.5rem" }}>
          <h2 style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.3rem", color: tokens.text, marginBottom: "1.2rem" }}>מוצרים דומים</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "1rem" }}>
            {related.map((r) => {
              const rImg = rivhitImg(r.picture_link, 480, r.rotation_override ?? 0);
              const rPrice = applyDiscount(r.price, discount);
              return (
                <Link key={r.id} href={`/product/?id=${r.id}`} className="kt-card" style={{ textDecoration: "none", border: `1px solid ${tokens.border}`, borderRadius: tokens.radiusCard, padding: "0.8rem", background: "#fff", boxShadow: tokens.shadowCard, display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                  {/* Same uniform frame as the catalog cards: square, contain,
                      inner padding, white background. */}
                  <div style={{ aspectRatio: "1 / 1", borderRadius: 12, border: `1px solid ${tokens.border}`, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", padding: 8 }}>
                    <ProductImg src={rImg} alt={r.name} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                  </div>
                  <div style={{ fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.85rem", color: tokens.text, lineHeight: 1.25, minHeight: "2.2em" }}>{r.name}</div>
                  <div style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1rem", color: discount > 0 ? "#1A7A4D" : tokens.text }}>{ils(rPrice)}</div>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}

export default function ProductPage() {
  return (
    <>
      <SiteHeader />
      <Suspense fallback={<main id="main-content" style={{ minHeight: "60vh" }} />}>
        <ProductDetail />
      </Suspense>
      <SiteFooter />
    </>
  );
}
