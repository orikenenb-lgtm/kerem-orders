"use client";

import { useGridDensity, gridColumns, GridDensityPicker } from "../../lib/gridDensity";
import { featureFlags } from "../../lib/featureFlags";
// The "בשורה" picker scrolls away with the page instead of pinning (see ff_lean_sticky).
const ffLeanSticky = featureFlags.ff_lean_sticky;

// Customer-specific curated catalog ("קישור לרשת"): /collection/?k=<slug>
// shows ONLY the products the manager put into that collection — built for
// a chain that starts with ~50 items and grows over time.
//
// Read path: the catalog_collection RPC alone (anon). It returns display-safe
// columns; price arrives ONLY when the collection was created with
// show_prices=true, so a prices-off link never even receives numbers.
// An unknown or deactivated slug returns zero rows → friendly "not found"
// state. A LIVE collection with no products returns one header-only row
// instead, so "empty catalogue" and "wrong link" are different screens.

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import SiteHeader from "../components/SiteHeader";
import SiteFooter from "../components/SiteFooter";
import LoadMoreTail from "../components/LoadMoreTail";
import ProductImage from "../components/ProductImage";
import { supabase } from "../../lib/supabaseClient";
import { tokens, ils } from "../../lib/ui";
import { orderExactFirst, sanitizeQuery } from "../../lib/searchRank";
import { BUSINESS_NAME } from "../../lib/config";
// Same premium look as the public catalogue (/view, /prices) — one stylesheet.
import ui from "../components/PublicCatalog.module.css";

type CollectionProduct = {
  /** Null on the single header-only row a live-but-empty collection returns. */
  id: string | null;
  name: string;
  category: string | null;
  picture_link: string;
  in_stock: boolean;
  rotation_override: number | null;
  price: number | null;
  /** Price before the collection discount — for the struck-through original. */
  list_price: number | null;
  discount_percent: number | string | null;
  collection_name: string;
  show_prices: boolean;
  total: number;
};

// Products per request. 48 (was 24): half as many stops on a long category;
// the public RPCs cap a request at 60, so 48 is always served in full.
const PAGE_SIZE = 48;
// The first cards' photos load immediately and first (ProductImage priority):
// they are on the opening screen — or the first row just under the search and
// categories on a phone. All later photos load lazily as they come near.
const PRIORITY_IMAGES = 6;

function CollectionCatalog() {
  const params = useSearchParams();
  const slug = (params.get("k") || "").trim();

  const [input, setInput] = useState("");
  // Products per row — the visitor's own choice, remembered per browser.
  const [density, setDensity] = useGridDensity();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [products, setProducts] = useState<CollectionProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [collectionName, setCollectionName] = useState("");
  const [showPrices, setShowPrices] = useState(false);
  const [discount, setDiscount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(false);
  // Distinguish "collection empty/unknown" from "search found nothing".
  const [known, setKnown] = useState<boolean | null>(null);

  const [preview, setPreview] = useState<CollectionProduct | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  // Same staleness guards as the public catalog: sequence + filter generation.
  const loadSeq = useRef(0);
  const filterGen = useRef(0);
  const gridGen = useRef(-1);
  const [endReached, setEndReached] = useState(false);

  // Only a REAL change of the search text starts a new filter generation. On
  // mount (and after typing back to the same text) there is nothing to apply;
  // bumping the generation anyway made the first scroll's page-2 response look
  // stale, so the grid threw it away and fetched page 1 and page 2 again — the
  // extra wait at the bottom of the first products.
  const appliedInput = useRef(input);
  useEffect(() => {
    if (input === appliedInput.current) return;
    const t = setTimeout(() => { appliedInput.current = input; filterGen.current++; setQuery(input); setPage(0); }, 350);
    return () => clearTimeout(t);
  }, [input]);

  const load = useCallback(async () => {
    if (!slug) { setLoading(false); setKnown(false); return; }
    const seq = ++loadSeq.current;
    const gen = filterGen.current;
    setLoading(true);
    const s = sanitizeQuery(query);
    const { data, error } = await supabase.rpc("catalog_collection", {
      cslug: slug,
      q: s || null,
      lim: PAGE_SIZE,
      off: page * PAGE_SIZE,
    });
    if (seq !== loadSeq.current) return;
    if (error) { setLoadErr(true); setLoading(false); return; }
    if (page > 0 && gen !== gridGen.current) { setPage(0); return; }
    setLoadErr(false);
    // A LIVE collection with nothing to show returns exactly one header-only
    // row — id null, total 0 — carrying the name, show_prices and discount. It
    // is what lets this page say "this catalogue is empty" instead of "this
    // link is wrong", which is what an empty collection used to tell a customer
    // the owner had just sent the link to. It also keeps the header when a
    // search inside a real catalogue finds nothing.
    const raw = (data as CollectionProduct[]) ?? [];
    const header = raw.find((r) => r.id === null) ?? null;
    const rows = orderExactFirst(raw.filter((r) => r.id !== null), s);
    setProducts((prev) => {
      if (page === 0) return rows;
      const seen = new Set(prev.map((p) => p.id));
      return [...prev, ...rows.filter((r) => !seen.has(r.id))];
    });
    gridGen.current = gen;
    setEndReached(rows.length < PAGE_SIZE);
    const head = rows[0] ?? header;
    if (head) {
      setKnown(true);
      setCollectionName(head.collection_name);
      setShowPrices(head.show_prices);
      setDiscount(Number(head.discount_percent) || 0);
      setTotal(Number(rows[0]?.total ?? 0));
    } else if (page === 0) {
      // Still nothing at all: the slug is unknown or the collection was turned
      // off. Those two stay indistinguishable on purpose — no way to probe
      // which slugs exist.
      setKnown(false);
      setTotal(0);
    }
    setLoading(false);
  }, [slug, query, page]);

  useEffect(() => { load(); }, [load]);

  const hasMore = !endReached && products.length < total;
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || loading || loadErr) return;
    const obs = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) setPage((p) => p + 1); },
      // Start the next request ~3 phone screens early, so a customer who
      // scrolls fast meets products, not the loading line.
      { rootMargin: "2000px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loading, loadErr, products.length]);

  const closePreview = useCallback(() => {
    setPreview(null);
    openerRef.current?.focus();
    openerRef.current = null;
  }, []);

  if (known === false) {
    return (
      <main id="main-content" tabIndex={-1} className={ui.main}>
        <div className={ui.state} style={{ marginTop: "clamp(1.5rem, 6vw, 4rem)" }}>
          <div className={ui.stateIcon} aria-hidden="true">🧸</div>
          <h1 className={ui.stateTitle}>
            הקטלוג המבוקש לא נמצא
          </h1>
          <p className={ui.stateText}>
            יכול להיות שהקישור השתנה או שהקטלוג הוסר. אפשר ליצור קשר ונשלח קישור מעודכן.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main id="main-content" tabIndex={-1} className={ui.main}>
      <section className={ui.banner} aria-labelledby="kt-collection-title">
        <div className={ui.bannerText}>
          <p className={ui.eyebrow}>{BUSINESS_NAME}</p>
          <h1 id="kt-collection-title" className={ui.title}>
            {collectionName || "קטלוג מותאם"}
          </h1>
          <p className={ui.meta}>
            קטלוג מותאם אישית · {total.toLocaleString("he-IL")} מוצרים · לצפייה בלבד
            {showPrices ? " · המחירים כוללים מע״מ" : ""}
          </p>
          {showPrices && discount > 0 && (
            <p className={ui.offer}>
              🎁 הנחה של {discount}% על כל המוצרים בקטלוג — כבר מחושבת במחירים
            </p>
          )}
        </div>
      </section>

      <div className={ui.toolbar}>
        <div className={ui.searchWrap}>
          <svg className={ui.searchIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" focusable="false">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.6-3.6" />
          </svg>
          <input
            type="search"
            aria-label="חיפוש מוצר בקטלוג המותאם"
            placeholder="חיפוש מוצר…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className={ui.search}
          />
        </div>
        {!ffLeanSticky && (
          <div className={ui.densityRow}>
            <GridDensityPicker value={density} onChange={setDensity} />
          </div>
        )}
      </div>
      {ffLeanSticky && (
        <div className={ui.densityRowLean}>
          <GridDensityPicker value={density} onChange={setDensity} />
        </div>
      )}

      {loading && products.length === 0 ? (
        <div className={ui.state} role="status">
          <p className={ui.loadingText}><span className="kt-spinner" aria-hidden="true" /> טוען מוצרים…</p>
        </div>
      ) : loadErr && products.length === 0 ? (
        <div className={ui.state}>
          <div className={ui.stateIcon} aria-hidden="true">🧸</div>
          <p className={ui.errorText}>הטעינה נכשלה. בדקו את החיבור ונסו שוב.</p>
          <button type="button" onClick={load} className={ui.ghostBtn}>נסו שוב</button>
        </div>
      ) : products.length === 0 ? (
        <div className={ui.state}>
          <div className={ui.stateIcon} aria-hidden="true">{query ? "🔎" : "📦"}</div>
          <p className={ui.stateText}>
            {query
              ? `לא נמצאו מוצרים עבור “${query}”.`
              : "הקטלוג הזה עדיין ריק. נוסיף אליו מוצרים בקרוב — הקישור עצמו תקין וימשיך לעבוד."}
          </p>
        </div>
      ) : (
        <>
          <div data-density={density} className={ui.grid} style={{ gridTemplateColumns: gridColumns(density) }}>
            {products.map((p, i) => (
              <button
                key={p.id}
                type="button"
                className={`kt-card ${ui.card}`}
                onClick={(e) => { openerRef.current = e.currentTarget; setPreview(p); }}
                aria-haspopup="dialog"
                aria-label={`תצוגה מקדימה: ${p.name}`}
                // Inline on purpose: tokens.css lifts the card on hover by
                // re-declaring --kt-shadow-card, which this re-resolves.
                style={{ boxShadow: tokens.shadowCard }}
              >
                <div className={ui.frame}>
                  <ProductImage pictureLink={p.picture_link} name={p.name} rotation={p.rotation_override ?? 0} priority={i < PRIORITY_IMAGES} imgStyle={{ width: "100%", height: "100%", objectFit: "contain" }} />
                </div>
                {/* Clamped to three lines. Rivhit names run to 120 characters, and one
                    long name stretched its card to 453px against 300px for its
                    neighbours — which stretches the whole grid row. title keeps the
                    full name one hover away; the product page always shows it. */}
                <h3 className={ui.name} title={p.name}>{p.name}</h3>
                {p.category && (
                  <div className={ui.cat}>{p.category}</div>
                )}
                {showPrices && p.price != null && (() => {
                  // Green + strikethrough are decided per ROW, not by the
                  // collection discount: a per-product custom price (Wave:
                  // collection_products.price_override) is cheaper than list
                  // with no discount set, and is NOT derived from the discount
                  // when one is. price < list_price is the one honest test.
                  const cheaper = p.list_price != null && Number(p.price) < Number(p.list_price);
                  return (
                    <div className={ui.priceRow}>
                      <span className={ui.price} style={{ marginTop: 0, color: cheaper ? "#1A7A4D" : tokens.text }}>
                        {ils(Number(p.price) || 0)}
                      </span>
                      {cheaper && (
                        <s style={{ fontFamily: tokens.assistant, fontSize: "0.82rem", color: tokens.dim }}>{ils(Number(p.list_price) || 0)}</s>
                      )}
                    </div>
                  );
                })()}
              </button>
            ))}
          </div>

          <div ref={sentinelRef} aria-hidden="true" />
          {loadErr ? (
            <div className={ui.state}>
              <p className={ui.errorText}>טעינת המוצרים נכשלה.</p>
              <button type="button" onClick={load} className={ui.ghostBtn}>נסו שוב</button>
            </div>
          ) : hasMore || loading ? (
            <LoadMoreTail shown={products.length} total={total} columns={gridColumns(density)} />
          ) : products.length > PAGE_SIZE ? (
            <div className={ui.endNote}>
              <p>
                זהו — רואים את כל {total.toLocaleString("he-IL")} המוצרים ✔
              </p>
            </div>
          ) : null}
        </>
      )}

      {preview && (
        <CollectionPreview product={preview} showPrice={showPrices} onClose={closePreview} />
      )}
    </main>
  );
}

// Same accessible dialog pattern as the public catalog preview: Escape,
// backdrop click, Tab trap, focus restore, tap-to-zoom.
function CollectionPreview({ product, showPrice, onClose }: {
  product: CollectionProduct;
  showPrice: boolean;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    closeBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "Tab" && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]');
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
        else if (!panelRef.current.contains(active)) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div onClick={onClose} className={ui.backdrop}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={product.name}
        onClick={(e) => e.stopPropagation()}
        className={ui.panel}
      >
        <div className={ui.panelTop}>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="סגירת התצוגה המקדימה"
            className={ui.closeBtn}
          >
            ✕
          </button>
        </div>
        <button
          type="button"
          onClick={() => setZoomed((z) => !z)}
          aria-pressed={zoomed}
          aria-label={zoomed ? "הקטנת התמונה" : "הגדלת התמונה"}
          className={ui.zoomBtn}
          style={{ maxHeight: zoomed ? "70dvh" : 340 }}
        >
          <ProductImage
            pictureLink={product.picture_link}
            name={product.name}
            width={zoomed ? 960 : 480}
            rotation={product.rotation_override ?? 0}
            imgStyle={{ maxWidth: "100%", maxHeight: zoomed ? "68dvh" : 320, objectFit: "contain" }}
          />
        </button>
        <p className={ui.hint}>
          {zoomed ? "לחיצה נוספת מקטינה חזרה" : "אפשר ללחוץ על התמונה להגדלה"}
        </p>
        <h2 className={ui.dialogTitle}>
          {product.name}
        </h2>
        {product.category && (
          <p className={ui.dialogCat}>
            קטגוריה: {product.category}
          </p>
        )}
        {showPrice && product.price != null && (() => {
          // Same per-row rule as the grid: cheaper-than-list decides the
          // green and the strikethrough, whatever produced the price.
          const cheaper = product.list_price != null && Number(product.price) < Number(product.list_price);
          return (
            <p className={ui.dialogPrice} style={{ color: cheaper ? "#1A7A4D" : tokens.text }}>
              {ils(Number(product.price) || 0)}
              {cheaper && (
                <s style={{ fontFamily: tokens.assistant, fontWeight: 400, fontSize: "0.9rem", color: tokens.dim }}> {ils(Number(product.list_price) || 0)}</s>
              )}
              <span style={{ fontFamily: tokens.assistant, fontWeight: 400, fontSize: "0.85rem", color: tokens.dim }}> · כולל מע״מ</span>
            </p>
          );
        })()}
      </div>
    </div>
  );
}

// useSearchParams requires a Suspense boundary in the App Router.
export default function CollectionPage() {
  return (
    <>
      <SiteHeader />
      <Suspense fallback={null}>
        <CollectionCatalog />
      </Suspense>
      <SiteFooter />
    </>
  );
}
