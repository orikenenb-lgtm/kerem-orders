"use client";

import { useGridDensity, gridColumns, GridDensityPicker } from "../../lib/gridDensity";
import { featureFlags } from "../../lib/featureFlags";
// The "בשורה" picker scrolls away with the page instead of pinning (see ff_lean_sticky).
const ffLeanSticky = featureFlags.ff_lean_sticky;

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import SiteHeader from "./SiteHeader";
import SiteFooter from "./SiteFooter";
import LoadMoreTail from "./LoadMoreTail";
import { supabase } from "../../lib/supabaseClient";
import ProductImage from "./ProductImage";
import { tokens, ils } from "../../lib/ui";
import { orderExactFirst, sanitizeQuery } from "../../lib/searchRank";
import { BUSINESS_NAME, BUSINESS_TAGLINE } from "../../lib/config";
import { useAuth } from "../../lib/auth";
import { readUrlCategory } from "../../lib/urlCategory";
import ui from "./PublicCatalog.module.css";

// Shared public, read-only catalog (no login, no ordering) behind both
// public links:
//   /view   → catalog_public()        — WITHOUT prices
//   /prices → catalog_public_prices() — WITH prices
// Both functions expose only name / picture / category / in-stock (+price on
// the prices one) — never sku/barcode or exact stock counts.
type PublicProduct = {
  id: string;
  name: string;
  price?: number;
  picture_link: string;
  category: string;
  in_stock: boolean;
  rank?: number;
  total?: number;
  // Manual clockwise rotation override (0/90/180/270) for crooked photos.
  // Both public RPCs return this column; nullable → treated as 0.
  rotation_override?: number | null;
};

// Products per request. 48 (was 24): half as many stops on a long category;
// the public RPCs cap a request at 60, so 48 is always served in full.
const PAGE_SIZE = 48;
// The first cards' photos load immediately and first (ProductImage priority):
// they are on the opening screen — or the first row just under the search and
// categories on a phone. All later photos load lazily as they come near.
const PRIORITY_IMAGES = 6;

// Inactive category chips cycle through the premium pastels (ink text on
// every one ≥13.5:1); the active chip is solid purple with white text.
const CHIP_PASTELS = [
  "var(--kp-lav, #EEE5FF)",
  "var(--kp-mint, #D8F5EB)",
  "var(--kp-sky, #DBEEFF)",
  "var(--kp-peach, #FFE8D6)",
  "var(--kp-pink, #FFE3F1)",
];

export default function PublicCatalog({ showPrices }: { showPrices: boolean }) {
  const rpcName = showPrices ? "catalog_public_prices" : "catalog_public";
  // Only to pick which call to action the banner shows — no data depends on it.
  const { session } = useAuth();

  const [input, setInput] = useState("");
  // Products per row — the visitor's own choice, remembered per browser.
  const [density, setDensity] = useGridDensity();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [products, setProducts] = useState<PublicProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [loadErr, setLoadErr] = useState(false);
  const [fuzzyNote, setFuzzyNote] = useState(false);
  const [categories, setCategories] = useState<{ category: string; n: number }[]>([]);
  const [deepLinkCat] = useState<string | null>(() => readUrlCategory());
  const [activeCat, setActiveCat] = useState(() => deepLinkCat ?? "all");
  const [vatLabel, setVatLabel] = useState(true);

  // Product preview dialog. Holds the product being previewed plus the card
  // element that opened it, so closing can hand focus back to that card.
  const [preview, setPreview] = useState<PublicProduct | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const openPreview = (p: PublicProduct, opener: HTMLElement) => {
    openerRef.current = opener;
    setPreview(p);
  };
  const closePreview = useCallback(() => {
    setPreview(null);
    openerRef.current?.focus();
    openerRef.current = null;
  }, []);

  useEffect(() => {
    supabase.rpc("catalog_public_categories").then(({ data }) => {
      setCategories((data as { category: string; n: number }[]) ?? []);
    });
  }, []);

  // ?cat= deep link: the category was applied from the very first request
  // (lib/urlCategory.ts). Once the real list has loaded, an unknown or stale
  // name falls back to "הכל" — unless the customer already picked another.
  useEffect(() => {
    if (!deepLinkCat || categories.length === 0) return;
    if (categories.some((c) => c.category === deepLinkCat)) return;
    const t = window.setTimeout(() => setActiveCat((a) => (a === deepLinkCat ? "all" : a)), 0);
    return () => window.clearTimeout(t);
  }, [categories, deepLinkCat]);

  // VAT note on the prices page only. Anon RLS exposes just this one settings
  // key; a missing row (or a failed read) keeps the default: label shown.
  useEffect(() => {
    if (!showPrices) return;
    supabase
      .from("site_settings")
      .select("value")
      .eq("key", "prices_include_vat")
      .maybeSingle()
      .then(({ data }) => {
        const v = (data as { value: string } | null)?.value;
        setVatLabel(v === undefined || v === null || v === "true" || v === "1");
      });
  }, [showPrices]);

  // Filter generation: bumped whenever the query or category changes. The grid
  // remembers which generation its rows belong to, so a page>0 response can
  // never append onto rows from a previous filter — it restarts at page 0.
  const filterGen = useRef(0);
  const gridGen = useRef(-1);

  // debounce search -> query, reset to page 0
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

  useEffect(() => { filterGen.current++; setPage(0); }, [activeCat]);

  const loadSeq = useRef(0);
  // A short page (fewer than PAGE_SIZE rows) means the data is exhausted, even
  // when dedup/count drift leaves products.length below total — without this
  // the observer would keep requesting empty pages forever.
  const [endReached, setEndReached] = useState(false);

  // Infinite scroll: page 0 replaces the grid, later pages append (deduped by
  // id, so an item shifting between DB pages can never render twice).
  const applyRows = (rows: PublicProduct[], append: boolean) => {
    setProducts((prev) => {
      if (!append) return rows;
      const seen = new Set(prev.map((p) => p.id));
      return [...prev, ...rows.filter((r) => !seen.has(r.id))];
    });
  };

  const loadProducts = useCallback(async () => {
    const seq = ++loadSeq.current;
    const gen = filterGen.current;
    setLoadingProducts(true);
    if (page === 0) setFuzzyNote(false);
    const s = sanitizeQuery(query);
    const { data, error } = await supabase.rpc(rpcName, {
      q: s || null,
      cat: activeCat,
      lim: PAGE_SIZE,
      off: page * PAGE_SIZE,
    });
    if (seq !== loadSeq.current) return;
    if (error) {
      setLoadErr(true);
      setLoadingProducts(false);
      return;
    }
    // A page>0 response whose filter no longer matches the grid's rows must
    // not append — restart cleanly from the first page instead.
    if (page > 0 && gen !== gridGen.current) { setPage(0); return; }
    setLoadErr(false);
    // Exact/whole-word matches float above fuzzy ones within each page —
    // nothing is hidden, already-rendered pages are never reshuffled.
    const rows = orderExactFirst(((data as PublicProduct[]) ?? []), s);
    applyRows(rows, page > 0);
    gridGen.current = gen;
    setEndReached(rows.length < PAGE_SIZE);
    // An empty overflow page carries no window count — keep the known total.
    if (page === 0 || rows.length > 0) setTotal(Number(rows[0]?.total ?? 0));
    // no exact match but similar ones found → "did you mean" mode
    // (rank comes from the RPC row set — unaffected by the client re-order).
    if (page === 0) setFuzzyNote(s.length >= 2 && rows.length > 0 && !rows.some((r) => (r.rank ?? 0) >= 0.55));
    setLoadingProducts(false);
  }, [rpcName, query, page, activeCat]);

  useEffect(() => { loadProducts(); }, [loadProducts]);

  // Auto-load the next page when the sentinel under the grid scrolls into
  // view, so visitors see everything just by scrolling — no page buttons.
  const hasMore = !endReached && products.length < total;
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || loadingProducts || loadErr) return;
    const obs = new IntersectionObserver(
      // Advance only while the grid shows the CURRENT filter: applying a
      // search hides the chips/filters above the grid, which can pull the
      // sentinel into range while the old filter's rows are still on screen —
      // that used to fire a page-2 request for the new filter, which was then
      // thrown away and re-fetched (one wasted round trip per search).
      (entries) => { if (entries[0].isIntersecting && gridGen.current === filterGen.current) setPage((p) => p + 1); },
      // Start the next request ~3 phone screens early, so a customer who
      // scrolls fast meets products, not the loading line.
      { rootMargin: "2000px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loadingProducts, loadErr, products.length]);

  // The order is the server's: the categories RPC returns them in Rivhit's
  // own group order (group 1, 2, 3 …), which is how the owner and his father
  // see them in Rivhit. It used to be busiest-first with the "חדש" groups
  // pulled together; the owner asked for exactly the Rivhit order, everywhere.
  const orderedCats = useMemo(() => [...categories], [categories]);

  return (
    <>
      <SiteHeader />
      <main id="main-content" tabIndex={-1} className={ui.main}>
        <section className={ui.banner} aria-labelledby="kt-public-title">
          <div className={ui.bannerText}>
            <p className={ui.eyebrow}>{BUSINESS_NAME} · {BUSINESS_TAGLINE}</p>
            <h1 id="kt-public-title" className={ui.title}>
              {showPrices ? "קטלוג ומחירון" : "קטלוג המוצרים"}
            </h1>
            <p className={ui.meta}>
              {total.toLocaleString("he-IL")} מוצרים · לצפייה בלבד
              {showPrices && vatLabel ? " · המחירים כוללים מע״מ" : ""}
            </p>
          </div>
          {/* Guest call to action — the same two ways in the header and the
              /p/<id> pages already offer (open an account / log in). A
              signed-in customer gets the way to their ordering catalogue
              instead (the same link the header shows them). */}
          <div className={ui.cta}>
            {session ? (
              <>
                <p className={ui.ctaTitle}>אתם מחוברים — ההזמנה נעשית מקטלוג הלקוחות</p>
                <div className={ui.ctaRow}>
                  <Link href="/catalog" className={ui.ctaPrimary}>לקטלוג הלקוחות</Link>
                </div>
              </>
            ) : (
              <>
                <p className={ui.ctaTitle}>
                  {showPrices ? "להזמנה אונליין — ללקוחות עסקיים רשומים" : "המחירים מוצגים ללקוחות עסקיים רשומים"}
                </p>
                <div className={ui.ctaRow}>
                  <Link href="/register" className={ui.ctaPrimary}>פתיחת חשבון סיטונאי</Link>
                  <Link href="/login" className={ui.ctaGhost}>התחברות ללקוחות</Link>
                </div>
              </>
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
              id="kt-public-search"
              name="public-search"
              // A real programmatic name — placeholder alone is not a label
              // (it vanishes on input and many screen readers skip it).
              aria-label="חיפוש מוצר לפי שם"
              placeholder="חיפוש מוצר…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className={ui.search}
            />
          </div>
          {categories.length > 0 && (
            <div role="group" aria-label="סינון לפי קטגוריה" className={ui.chips}>
              {[{ category: "all", n: 0 }, ...orderedCats].map((c, i) => {
                const active = activeCat === c.category;
                return (
                  <button
                    key={c.category}
                    type="button"
                    onClick={() => setActiveCat(c.category)}
                    aria-pressed={active}
                    className={ui.chip}
                    style={{ "--chip-bg": CHIP_PASTELS[i % CHIP_PASTELS.length] } as CSSProperties}
                  >
                    {c.category === "all" ? "הכל" : `${c.category} (${c.n})`}
                  </button>
                );
              })}
            </div>
          )}
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

        {loadingProducts && products.length === 0 ? (
          <div className={ui.state} role="status">
            <p className={ui.loadingText}><span className="kt-spinner" aria-hidden="true" /> טוען מוצרים…</p>
          </div>
        ) : loadErr && products.length === 0 ? (
          <div className={ui.state}>
            <div className={ui.stateIcon} aria-hidden="true">🧸</div>
            <p className={ui.errorText}>טעינת הקטלוג נכשלה. בדקו את החיבור ונסו שוב.</p>
            <button type="button" onClick={loadProducts} className={ui.ghostBtn}>נסו שוב</button>
          </div>
        ) : products.length === 0 ? (
          <div className={ui.state}>
            <div className={ui.stateIcon} aria-hidden="true">🔎</div>
            <p className={ui.stateText}>
              לא נמצאו מוצרים{query ? ` עבור “${query}”` : ""}. נסו לכתוב חלק מהשם — החיפוש יודע להשלים לבד.
            </p>
          </div>
        ) : (
          <>
            {fuzzyNote && (
              <div className={ui.note}>
                🔎 לא מצאנו התאמה מדויקת ל־“{query}” — אלה המוצרים הכי דומים:
              </div>
            )}
            <div data-density={density} className={ui.grid} style={{ gridTemplateColumns: gridColumns(density) }}>
              {products.map((p, i) => (
                // The whole card is one real <button>: reachable with Tab,
                // activated with Enter/Space, announced with the product
                // name — not a div with an onClick.
                <button
                  key={p.id}
                  type="button"
                  className={`kt-card ${ui.card}`}
                  onClick={(e) => openPreview(p, e.currentTarget)}
                  aria-haspopup="dialog"
                  aria-label={`תצוגה מקדימה: ${p.name}`}
                  // Inline on purpose: tokens.css lifts the card on hover by
                  // re-declaring --kt-shadow-card, which this re-resolves.
                  style={{ boxShadow: tokens.shadowCard }}
                >
                  {/* No stock badge: quantities in Rivhit are not maintained
                      reliably (new items arrive as 0), so an automatic
                      "אזל מהמלאי" label mislabels products that ARE in stock. */}
                  {/* Uniform frame: square in every column width (aspectRatio,
                      not a fixed height), object-fit contain so no toy is
                      ever cropped or stretched, small inner padding, one
                      soft pastel backdrop. */}
                  <div className={ui.frame}>
                    <ProductImage pictureLink={p.picture_link} name={p.name} rotation={p.rotation_override ?? 0} priority={i < PRIORITY_IMAGES} />
                  </div>
                  {/* Clamped to three lines. Rivhit names run to 120 characters, and one
                      long name stretched its card to 453px against 300px for its
                      neighbours — which stretches the whole grid row. title keeps the
                      full name one hover away; the product page always shows it. */}
                  <h3 className={ui.name} title={p.name}>{p.name}</h3>
                  {p.category && (
                    <div className={ui.cat}>{p.category}</div>
                  )}
                  {showPrices && (
                    <div className={ui.price}>
                      {ils(Number(p.price) || 0)}
                    </div>
                  )}
                </button>
              ))}
            </div>

            {/* Infinite-scroll sentinel: when it nears the viewport the next
                page loads automatically — visitors just keep scrolling. */}
            <div ref={sentinelRef} aria-hidden="true" />
            {/* The error block renders whenever a load failed — even when the
                grid is full and hasMore is false (e.g. a failed re-search),
                so a failure is never silent. */}
            {loadErr ? (
              <div className={ui.state}>
                <p className={ui.errorText}>טעינת המוצרים נכשלה. בדקו את החיבור.</p>
                <button type="button" onClick={loadProducts} className={ui.ghostBtn}>נסו שוב</button>
              </div>
            ) : hasMore || loadingProducts ? (
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
      </main>
      <SiteFooter />

      {preview && (
        <ProductPreview
          product={preview}
          showPrice={showPrices}
          vatLabel={vatLabel}
          onClose={closePreview}
        />
      )}
    </>
  );
}

// Accessible product-preview dialog for the public catalogs.
// Shows ONLY what the public RPCs already return (big image, name, category —
// plus price on /prices): no SKU, no barcode, no stock counts.
function ProductPreview({ product, showPrice, vatLabel, onClose }: {
  product: PublicProduct;
  showPrice: boolean;
  vatLabel: boolean;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  // Tap/click the image (or its button) to toggle a larger view. On phones the
  // "zoom" state simply lets the image use the full panel height and native
  // pinch-zoom keeps working — nothing is hijacked.
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    closeBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // Focus trap: Tab cycles among the dialog's controls only.
      if (e.key === "Tab" && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href]'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        } else if (!panelRef.current.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    // Scroll-lock the page behind the dialog.
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
          {/* zoom = request the wider 960 variant for the dialog */}
          <ProductImage pictureLink={product.picture_link} name={product.name} width={zoomed ? 960 : 480} rotation={product.rotation_override ?? 0} />
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
        {showPrice && (
          <p className={ui.dialogPrice}>
            {ils(Number(product.price) || 0)}
            {vatLabel && (
              <span style={{ fontFamily: tokens.assistant, fontWeight: 400, fontSize: "0.85rem", color: tokens.dim }}>
                {" "}· כולל מע״מ
              </span>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

