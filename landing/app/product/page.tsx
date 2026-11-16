"use client";

import { useGridDensity, gridColumns } from "../../lib/gridDensity";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import SiteHeader from "../components/SiteHeader";
import SiteFooter from "../components/SiteFooter";
import ProductImage from "../components/ProductImage";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../lib/auth";
import { tokens, ils, discountPct } from "../../lib/ui";
import { buildPriceMap, resolvePrice, hasSpecialPrice, type PriceMap, type PriceOverrideRow } from "../../lib/pricing";
import { featureFlags } from "../../lib/featureFlags";
import { resolveQuantity, stepOf } from "../../lib/quantity";
import { readCart } from "../../lib/cart";
import ui from "./page.module.css";

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

// Add `addUnits` to the SAME localStorage cart the catalog uses, through the
// SAME shared resolver — so a line added here is byte-identical to one added
// from the catalog, and the checkout reconcile never flags it.
function addToCart(p: Product, addUnits: number, discount: number, priceMap: PriceMap | null) {
  const cart = readCart<{ qty: number; name: string; price: number; sku: string | null; picture_link: string; display_qty?: number | null; display_name?: string | null }>(
    localStorage.getItem(CART_KEY)
  );
  const existing = Number(cart[p.id]?.qty) || 0;
  const requested = existing + addUnits;
  const q = ffQty ? resolveQuantity(p, Math.min(requested, 9999)).units : Math.min(requested, 9999);
  if (q <= 0) delete cart[p.id];
  else cart[p.id] = {
    qty: q,
    name: p.name,
    price: resolvePrice(p.id, p.price, priceMap, discount),
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
  // The "similar products" strip follows the same per-row choice the customer
  // made on the catalogue, so the two screens never disagree about density.
  const [density] = useGridDensity();
  const [notFound, setNotFound] = useState(false);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(0);
  const [vatLabel, setVatLabel] = useState(true);

  useEffect(() => {
    if (!loading && !session) router.replace("/login");
  }, [loading, session, router]);

  // Manager-set prices (global + this customer's). Same source and same
  // resolver as the catalog, so both screens always quote one number.
  const [priceMap, setPriceMap] = useState<PriceMap | null>(null);
  useEffect(() => {
    if (!session) return;
    supabase.from("price_overrides").select("product_id,user_id,price").then(({ data }) => {
      setPriceMap(buildPriceMap((data as PriceOverrideRow[]) ?? [], session.user.id));
    });
  }, [session]);

  useEffect(() => {
    if (!session) return;
    supabase.from("site_settings").select("key,value").in("key", ["prices_include_vat"]).then(({ data }) => {
      const v = ((data ?? []) as { key: string; value: string }[]).find((r) => r.key === "prices_include_vat")?.value;
      setVatLabel(v === undefined || v === "true" || v === "1");
    });
  }, [session]);

  // Drop superseded responses: clicking through "מוצרים דומים" fires a new
  // load before the previous one resolves, so an earlier product's response
  // could otherwise overwrite a later one (same guard the catalog uses).
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    if (!session) return;
    if (!id) { setBusy(false); setNotFound(true); return; }
    const seq = ++loadSeq.current;
    setBusy(true);
    setNotFound(false);
    const { data, error } = await supabase.from("products").select(PROD_COLS).eq("id", id).eq("is_active", true).maybeSingle();
    if (seq !== loadSeq.current) return;
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
      if (seq !== loadSeq.current) return;
      setRelated((rel as Product[]) ?? []);
    } else {
      setRelated([]);
    }
  // setQty is a useState setter (stable) — listed so the React compiler can
  // keep this memoization; it never changes and never re-runs the load.
  }, [session, id, setQty]);

  useEffect(() => { load(); }, [load]);

  if (loading || busy) {
    return (
      <main id="main-content" tabIndex={-1} className={ui.loading}>
        <span className="kt-spinner" aria-hidden="true" /> טוען…
      </main>
    );
  }

  if (notFound || !product) {
    return (
      <main id="main-content" tabIndex={-1} className={ui.main}>
        <div className={ui.notFound}>
          <div className={ui.notFoundIcon} aria-hidden="true">🧸</div>
          <h1 className={ui.notFoundTitle}>המוצר לא נמצא</h1>
          <Link href="/catalog" className={ui.primaryLink}>← חזרה לקטלוג</Link>
        </div>
      </main>
    );
  }

  const p = product;
  const step = ffQty ? stepOf(p) : 1;
  const unitPrice = resolvePrice(p.id, p.price, priceMap, discount);
  const special = hasSpecialPrice(p.id, priceMap);
  /** List price before the fixed discount — honours a global override. */
  const listPrice = priceMap?.get(p.id)?.all ?? (Number(p.price) || 0);
  // The button total reflects the quantity that will ACTUALLY be added: for
  // pack-sold products a typed number is rounded up to a whole pack, so preview
  // the resolved units, not the raw input.
  const effectiveQty = ffQty ? resolveQuantity(p, qty).units : qty;
  const lineTotal = unitPrice * effectiveQty;
  // Pack facts — display only, the same rule the catalogue card uses
  // ("מארז = N יחידות" for display-sold products) plus the DB carton size.
  const dq = Math.floor(Number(p.display_qty) || 0);
  const displaySold = ffQty && step > 1 && dq > 1;
  const packName = (p.display_name || "מארז").trim() || "מארז";
  const cartonQty = ffQty ? Math.floor(Number(p.carton_qty) || 0) : 0;

  return (
    <main id="main-content" tabIndex={-1} className={ui.main}>
      <nav aria-label="נתיב" className={ui.crumbs}>
        <Link href="/catalog" className={ui.crumbLink}>הקטלוג</Link>
        {p.category ? <><span aria-hidden="true">›</span> <span>{p.category}</span></> : null}
      </nav>

      <div className={ui.layout}>
        {/* image */}
        {/* Fixed 1:1 box reserves the space before the async image loads, so
            the details below don't jump when it arrives (matches the grid
            cards' aspect-ratio approach — no CLS). */}
        <div className={ui.imageFrame}>
          <ProductImage pictureLink={p.picture_link} name={p.name} width={900} rotation={p.rotation_override ?? 0}
            imgStyle={{ maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto" }}
            placeholderStyle={{ fontSize: "4rem" }} />
        </div>

        {/* details */}
        <div className={ui.details}>
          {p.category ? <span className={ui.catPill}>{p.category}</span> : null}
          <h1 className={ui.title}>{p.name}</h1>
          <div className={ui.codes}>
            <span className={ui.code}>קוד: <span dir="ltr">{p.sku || "—"}</span></span>
            {p.barcode ? <span className={ui.code}>ברקוד: <span dir="ltr">{p.barcode}</span></span> : null}
          </div>

          {/* price */}
          <div className={ui.pricePanel}>
            <div className={ui.priceRow}>
              {/* A price set for this customer is already their price — no
                  discount badge on top of it (the discount is not applied). */}
              {special ? (
                <>
                  <span className={ui.price} style={{ color: "#1A7A4D" }}>{ils(unitPrice)}</span>
                  <span className={ui.badge} style={{ color: "#fff", background: "#1A7A4D" }}>מחיר מיוחד</span>
                </>
              ) : discount > 0 ? (
                <>
                  <span className={ui.price} style={{ color: "#1A7A4D" }}>{ils(unitPrice)}</span>
                  <s style={{ fontFamily: tokens.assistant, fontSize: "1rem", color: tokens.dim }}>{ils(listPrice)}</s>
                  <span className={ui.badge} style={{ color: "#1A7A4D", background: "var(--kp-mint, #D8F5EB)" }}>‎-{discount}%</span>
                </>
              ) : (
                <span className={ui.price} style={{ color: tokens.text }}>{ils(unitPrice)}</span>
              )}
              <span className={ui.perUnit}>ליחידה{vatLabel ? " · כולל מע״מ" : ""}</span>
            </div>
            {(displaySold || cartonQty > 0) && (
              <ul className={ui.packs} aria-label="אריזה">
                {displaySold && <li className={ui.pack}>{packName} = {dq.toLocaleString("he-IL")} יחידות</li>}
                {cartonQty > 0 && <li className={ui.pack}>קרטון = {cartonQty.toLocaleString("he-IL")} יחידות</li>}
              </ul>
            )}
          </div>

          {/* quantity + add */}
          <div className={ui.buyRow}>
            <div className={ui.stepper}>
              <button type="button" aria-label="פחות" onClick={() => setQty((n) => Math.max(step, n - step))} className={ui.stepBtn}>−</button>
              <input value={qty} aria-label="כמות" onChange={(e) => { const n = parseInt(e.target.value.replace(/\D/g, ""), 10); setQty(Number.isFinite(n) && n > 0 ? n : step); }} inputMode="numeric"
                className={ui.qty} />
              <button type="button" aria-label="עוד" onClick={() => setQty((n) => n + step)} className={ui.stepBtn}>+</button>
            </div>
            <button
              type="button"
              onClick={() => { const total = addToCart(p, qty, discount, priceMap); setAdded(total); }}
              className={ui.addBtn}
            >
              🛒 הוספה לעגלה · <span className={ui.lineTotal}>{ils(lineTotal)}</span>
            </button>
          </div>

          {added > 0 && (
            <div role="status" className={ui.added}>
              <span>✓ נוסף לעגלה ({added.toLocaleString("he-IL")} בעגלה)</span>
              <Link href="/catalog" className={ui.addedLink}>למעבר לעגלה ולסיום הזמנה ←</Link>
            </div>
          )}
        </div>
      </div>

      {/* related */}
      {related.length > 0 && (
        <section className={ui.related} aria-labelledby="kt-related-title">
          <h2 id="kt-related-title" className={ui.relatedTitle}>מוצרים דומים</h2>
          <div data-density={density} className={ui.relGrid} style={{ gridTemplateColumns: gridColumns(density) }}>
            {related.map((r) => {
              const rPrice = resolvePrice(r.id, r.price, priceMap, discount);
              return (
                <Link key={r.id} href={`/product/?id=${r.id}`} className={`kt-card ${ui.relCard}`} style={{ boxShadow: tokens.shadowCard }}>
                  {/* Same uniform frame as the catalog cards: square, contain,
                      inner padding, soft pastel backdrop. */}
                  <div className={ui.relFrame}>
                    <ProductImage pictureLink={r.picture_link} name={r.name} rotation={r.rotation_override ?? 0} placeholderStyle={{ fontSize: "2.6rem" }} />
                  </div>
                  <div className={ui.relName}>{r.name}</div>
                  <div className={ui.relPrice} style={{ color: discount > 0 ? "#1A7A4D" : tokens.text }}>{ils(rPrice)}</div>
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
      <Suspense fallback={<main id="main-content" tabIndex={-1} style={{ minHeight: "60vh" }} />}>
        <ProductDetail />
      </Suspense>
      <SiteFooter />
    </>
  );
}
