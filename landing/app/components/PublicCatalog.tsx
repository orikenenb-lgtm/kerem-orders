"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SiteHeader from "./SiteHeader";
import SiteFooter from "./SiteFooter";
import { supabase } from "../../lib/supabaseClient";
import { rivhitImg } from "../../lib/images";
import { tokens, ils } from "../../lib/ui";
import { orderExactFirst } from "../../lib/searchRank";

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

const PAGE_SIZE = 24;

export default function PublicCatalog({ showPrices }: { showPrices: boolean }) {
  const rpcName = showPrices ? "catalog_public_prices" : "catalog_public";

  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [products, setProducts] = useState<PublicProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [loadErr, setLoadErr] = useState(false);
  const [fuzzyNote, setFuzzyNote] = useState(false);
  const [categories, setCategories] = useState<{ category: string; n: number }[]>([]);
  const [activeCat, setActiveCat] = useState("all");
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
  useEffect(() => {
    const t = setTimeout(() => { filterGen.current++; setQuery(input); setPage(0); }, 350);
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
    const s = query.trim().replace(/[,()%]/g, " ").trim();
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
      (entries) => { if (entries[0].isIntersecting) setPage((p) => p + 1); },
      { rootMargin: "700px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loadingProducts, loadErr, products.length]);

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

  return (
    <>
      <SiteHeader />
      <main id="main-content" style={{ maxWidth: 1280, margin: "0 auto", padding: "clamp(1.25rem,4vw,2.5rem) clamp(1rem,4vw,2.5rem) 6rem" }}>
        <h1 style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "clamp(1.6rem,4vw,2.6rem)", color: tokens.text }}>
          {showPrices ? "קטלוג ומחירון" : "קטלוג המוצרים"}
        </h1>
        <p style={{ fontFamily: tokens.assistant, color: tokens.body, marginTop: "0.3rem" }}>
          {total.toLocaleString("he-IL")} מוצרים · לצפייה בלבד
          {showPrices && vatLabel ? " · המחירים כוללים מע״מ" : ""}
        </p>

        <div style={{ position: "sticky", top: 64, zIndex: 20, background: "rgba(255,255,255,0.94)", backdropFilter: "blur(8px)", padding: "1rem 0", marginTop: "0.5rem" }}>
          <input
            type="search"
            // A real programmatic name — placeholder alone is not a label
            // (it vanishes on input and many screen readers skip it).
            aria-label="חיפוש מוצר לפי שם"
            placeholder="🔍 חיפוש מוצר…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            style={{ width: "100%", fontFamily: tokens.assistant, fontSize: "1rem", padding: "0.85rem 1rem", borderRadius: 14, border: `1px solid ${tokens.border}`, background: tokens.surface, color: tokens.text }}
          />
          {categories.length > 0 && (
            <div role="group" aria-label="סינון לפי קטגוריה" style={{ display: "flex", gap: "0.5rem", overflowX: "auto", paddingBottom: "0.3rem", marginTop: "0.7rem" }}>
              {[{ category: "all", n: 0 }, ...orderedCats].map((c, i) => {
                const active = activeCat === c.category;
                const accent = c.category === "all" ? tokens.accent : tokens.rainbowColors[i % tokens.rainbowColors.length];
                return (
                  <button
                    key={c.category}
                    onClick={() => setActiveCat(c.category)}
                    aria-pressed={active}
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

        {loadingProducts && products.length === 0 ? (
          <p style={{ fontFamily: tokens.assistant, color: tokens.dim, marginTop: "2rem" }}>טוען מוצרים…</p>
        ) : loadErr && products.length === 0 ? (
          <div style={{ textAlign: "center", marginTop: "2rem" }}>
            <p style={{ fontFamily: tokens.assistant, color: "#C0143C", marginBottom: "0.8rem" }}>טעינת הקטלוג נכשלה. בדקו את החיבור ונסו שוב.</p>
            <button onClick={loadProducts} style={ghostBtn}>נסו שוב</button>
          </div>
        ) : products.length === 0 ? (
          <p style={{ fontFamily: tokens.assistant, color: tokens.dim, marginTop: "2rem" }}>
            לא נמצאו מוצרים{query ? ` עבור “${query}”` : ""}. נסו לכתוב חלק מהשם — החיפוש יודע להשלים לבד.
          </p>
        ) : (
          <>
            {fuzzyNote && (
              <div style={{ fontFamily: tokens.assistant, fontSize: "0.95rem", color: tokens.body, background: "rgba(138,63,252,0.08)", border: "1px solid rgba(138,63,252,0.25)", borderRadius: 12, padding: "0.7rem 1rem", marginTop: "1rem" }}>
                🔎 לא מצאנו התאמה מדויקת ל־“{query}” — אלה המוצרים הכי דומים:
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "1rem", marginTop: "1rem" }}>
              {products.map((p, i) => {
                const accent = tokens.rainbowColors[i % tokens.rainbowColors.length];
                const img = rivhitImg(p.picture_link, 480, p.rotation_override ?? 0);
                return (
                  // The whole card is one real <button>: reachable with Tab,
                  // activated with Enter/Space, announced with the product
                  // name — not a div with an onClick.
                  <button
                    key={p.id}
                    type="button"
                    className="kt-card"
                    onClick={(e) => openPreview(p, e.currentTarget)}
                    aria-haspopup="dialog"
                    aria-label={`תצוגה מקדימה: ${p.name}`}
                    style={{ textAlign: "start", cursor: "pointer", font: "inherit", border: `1px solid ${tokens.border}`, borderTop: `3px solid ${accent}`, borderRadius: tokens.radiusCard, padding: "0.9rem", background: "#fff", boxShadow: tokens.shadowCard, display: "flex", flexDirection: "column", gap: "0.45rem" }}
                  >
                    {/* No stock badge: quantities in Rivhit are not maintained
                        reliably (new items arrive as 0), so an automatic
                        "אזל מהמלאי" label mislabels products that ARE in stock. */}
                    {/* Uniform frame: square in every column width (aspectRatio,
                        not a fixed height), object-fit contain so no toy is
                        ever cropped or stretched, small inner padding, one
                        background for photographed-on-white images. */}
                    <div style={{ position: "relative", width: "100%", aspectRatio: "1 / 1", borderRadius: 12, background: "#fff", border: `1px solid ${tokens.border}`, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", fontSize: "2.6rem", padding: 8 }}>
                      <ProductImg src={img} alt={p.name} />
                    </div>
                    <h3 style={{ fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.92rem", color: tokens.text, lineHeight: 1.25, minHeight: "2.3em", margin: 0 }}>{p.name}</h3>
                    {p.category && (
                      <div style={{ fontFamily: tokens.assistant, fontSize: "0.72rem", color: tokens.dim }}>{p.category}</div>
                    )}
                    {showPrices && (
                      <div style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.1rem", color: tokens.text }}>
                        {ils(Number(p.price) || 0)}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Infinite-scroll sentinel: when it nears the viewport the next
                page loads automatically — visitors just keep scrolling. */}
            <div ref={sentinelRef} aria-hidden="true" />
            {/* The error block renders whenever a load failed — even when the
                grid is full and hasMore is false (e.g. a failed re-search),
                so a failure is never silent. */}
            {loadErr ? (
              <div style={{ textAlign: "center", marginTop: "1.5rem" }}>
                <p style={{ fontFamily: tokens.assistant, color: "#C0143C", marginBottom: "0.8rem" }}>טעינת המוצרים נכשלה. בדקו את החיבור.</p>
                <button onClick={loadProducts} style={ghostBtn}>נסו שוב</button>
              </div>
            ) : hasMore || loadingProducts ? (
              <p style={{ textAlign: "center", fontFamily: tokens.assistant, color: tokens.dim, marginTop: "1.5rem" }}>
                טוען עוד מוצרים…
              </p>
            ) : products.length > PAGE_SIZE ? (
              <p style={{ textAlign: "center", fontFamily: tokens.assistant, color: tokens.dim, marginTop: "1.5rem" }}>
                זהו — רואים את כל {total.toLocaleString("he-IL")} המוצרים ✔
              </p>
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

  // Big image: request a wider variant for the dialog; zoom = the original.
  const imgSmall = rivhitImg(product.picture_link, 480, product.rotation_override ?? 0);
  const imgBig = rivhitImg(product.picture_link, 960, product.rotation_override ?? 0);

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
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(20,16,32,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={product.name}
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#fff", width: "100%", maxWidth: 560, maxHeight: "92dvh", overflowY: "auto", borderRadius: 20, padding: "1rem 1rem 1.4rem", display: "flex", flexDirection: "column", gap: "0.8rem" }}
      >
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="סגירת התצוגה המקדימה"
            style={{ width: 44, height: 44, borderRadius: 12, border: `1px solid ${tokens.border}`, background: "#fff", color: tokens.text, fontSize: "1.25rem", lineHeight: 1, cursor: "pointer" }}
          >
            ✕
          </button>
        </div>

        <button
          type="button"
          onClick={() => setZoomed((z) => !z)}
          aria-pressed={zoomed}
          aria-label={zoomed ? "הקטנת התמונה" : "הגדלת התמונה"}
          style={{ border: `1px solid ${tokens.border}`, borderRadius: 14, background: "#fff", padding: 8, cursor: "zoom-in", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 220, maxHeight: zoomed ? "70dvh" : 340, overflow: "hidden", fontSize: "3rem" }}
        >
          <ProductImg src={zoomed ? imgBig : imgSmall} alt={product.name} />
        </button>
        <p style={{ fontFamily: tokens.assistant, fontSize: "0.78rem", color: tokens.dim, textAlign: "center", margin: 0 }}>
          {zoomed ? "לחיצה נוספת מקטינה חזרה" : "אפשר ללחוץ על התמונה להגדלה"}
        </p>

        <h2 style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.2rem", color: tokens.text, margin: 0, lineHeight: 1.3 }}>
          {product.name}
        </h2>
        {product.category && (
          <p style={{ fontFamily: tokens.assistant, fontSize: "0.9rem", color: tokens.body, margin: 0 }}>
            קטגוריה: {product.category}
          </p>
        )}
        {showPrice && (
          <p style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.35rem", color: tokens.text, margin: 0 }}>
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

const ghostBtn = {
  fontFamily: tokens.rubik,
  fontWeight: 700,
  fontSize: "0.9rem",
  color: tokens.text,
  background: "#fff",
  border: `1px solid ${tokens.border}`,
  padding: "0.7rem 1.4rem",
  borderRadius: 999,
  cursor: "pointer",
} as const;

// Product image with a graceful fallback: if the (proxied) image fails to load,
// show the toy emoji instead of a broken-image icon.
function ProductImg({ src, alt }: { src: string | null; alt: string }) {
  const [err, setErr] = useState(false);
  useEffect(() => { setErr(false); }, [src]);
  if (!src || err) return <span>🧸</span>;
  return (
    <img src={src} alt={alt} loading="lazy" onError={() => setErr(true)} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
  );
}
