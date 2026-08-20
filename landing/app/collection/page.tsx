"use client";

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
import ProductImage from "../components/ProductImage";
import { supabase } from "../../lib/supabaseClient";
import { tokens, ils } from "../../lib/ui";
import { orderExactFirst, sanitizeQuery } from "../../lib/searchRank";

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

const PAGE_SIZE = 24;

function CollectionCatalog() {
  const params = useSearchParams();
  const slug = (params.get("k") || "").trim();

  const [input, setInput] = useState("");
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

  useEffect(() => {
    const t = setTimeout(() => { filterGen.current++; setQuery(input); setPage(0); }, 350);
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
      { rootMargin: "700px" }
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
      <main id="main-content" tabIndex={-1} style={{ maxWidth: 640, margin: "0 auto", padding: "5rem 1.25rem", textAlign: "center" }}>
        <div style={{ fontSize: "3rem", marginBottom: "1rem" }} aria-hidden="true">🧸</div>
        <h1 style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.6rem", color: tokens.text, marginBottom: "0.6rem" }}>
          הקטלוג המבוקש לא נמצא
        </h1>
        <p style={{ fontFamily: tokens.assistant, color: tokens.body }}>
          יכול להיות שהקישור השתנה או שהקטלוג הוסר. אפשר ליצור קשר ונשלח קישור מעודכן.
        </p>
      </main>
    );
  }

  return (
    <main id="main-content" tabIndex={-1} style={{ maxWidth: 1280, margin: "0 auto", padding: "clamp(1.25rem,4vw,2.5rem) clamp(1rem,4vw,2.5rem) 6rem" }}>
      <h1 style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "clamp(1.6rem,4vw,2.6rem)", color: tokens.text }}>
        {collectionName || "קטלוג מותאם"}
      </h1>
      <p style={{ fontFamily: tokens.assistant, color: tokens.body, marginTop: "0.3rem" }}>
        קטלוג מותאם אישית · {total.toLocaleString("he-IL")} מוצרים · לצפייה בלבד
        {showPrices ? " · המחירים כוללים מע״מ" : ""}
      </p>
      {showPrices && discount > 0 && (
        <p style={{ fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.95rem", color: "#1A7A4D", background: "rgba(37,199,126,0.12)", border: "1px solid rgba(37,199,126,0.4)", borderRadius: 999, padding: "0.4rem 1rem", display: "inline-block", marginTop: "0.6rem" }}>
          🎁 הנחה של {discount}% על כל המוצרים בקטלוג — כבר מחושבת במחירים
        </p>
      )}

      <div style={{ position: "sticky", top: "var(--kt-header-h, 96px)", zIndex: 40, background: "rgba(255,255,255,0.94)", backdropFilter: "blur(8px)", padding: "1rem 0", marginTop: "0.5rem" }}>
        <input
          type="search"
          aria-label="חיפוש מוצר בקטלוג המותאם"
          placeholder="🔍 חיפוש מוצר…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          style={{ width: "100%", fontFamily: tokens.assistant, fontSize: "1rem", padding: "0.85rem 1rem", borderRadius: 14, border: `1px solid ${tokens.border}`, background: tokens.surface, color: tokens.text }}
        />
      </div>

      {loading && products.length === 0 ? (
        <p style={{ fontFamily: tokens.assistant, color: tokens.dim, marginTop: "2rem" }}>טוען מוצרים…</p>
      ) : loadErr && products.length === 0 ? (
        <div style={{ textAlign: "center", marginTop: "2rem" }}>
          <p style={{ fontFamily: tokens.assistant, color: "#C0143C", marginBottom: "0.8rem" }}>הטעינה נכשלה. בדקו את החיבור ונסו שוב.</p>
          <button onClick={load} style={ghostBtn}>נסו שוב</button>
        </div>
      ) : products.length === 0 ? (
        <p style={{ fontFamily: tokens.assistant, color: tokens.dim, marginTop: "2rem" }}>
          {query
            ? `לא נמצאו מוצרים עבור “${query}”.`
            : "הקטלוג הזה עדיין ריק. נוסיף אליו מוצרים בקרוב — הקישור עצמו תקין וימשיך לעבוד."}
        </p>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(clamp(132px, 46%, 150px), 1fr))", gap: "1rem", marginTop: "1rem" }}>
            {products.map((p) => (
              <button
                key={p.id}
                type="button"
                className="kt-card"
                onClick={(e) => { openerRef.current = e.currentTarget; setPreview(p); }}
                aria-haspopup="dialog"
                aria-label={`תצוגה מקדימה: ${p.name}`}
                style={{ textAlign: "start", cursor: "pointer", font: "inherit", border: `1px solid ${tokens.border}`, borderRadius: tokens.radiusCard, padding: "0.9rem", background: "#fff", boxShadow: tokens.shadowCard, display: "flex", flexDirection: "column", gap: "0.45rem" }}
              >
                <div style={{ position: "relative", width: "100%", aspectRatio: "1 / 1", borderRadius: 12, background: "#fff", border: `1px solid ${tokens.border}`, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", padding: 8 }}>
                  <ProductImage pictureLink={p.picture_link} name={p.name} rotation={p.rotation_override ?? 0} imgStyle={{ width: "100%", height: "100%", objectFit: "contain" }} />
                </div>
                <h3 style={{ fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.92rem", color: tokens.text, lineHeight: 1.25, minHeight: "2.3em", margin: 0 }}>{p.name}</h3>
                {p.category && (
                  <div style={{ fontFamily: tokens.assistant, fontSize: "0.72rem", color: tokens.dim }}>{p.category}</div>
                )}
                {showPrices && p.price != null && (
                  <div style={{ display: "flex", alignItems: "baseline", gap: "0.4rem", flexWrap: "wrap" }}>
                    <span style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.1rem", color: discount > 0 ? "#1A7A4D" : tokens.text }}>
                      {ils(Number(p.price) || 0)}
                    </span>
                    {discount > 0 && p.list_price != null && (
                      <s style={{ fontFamily: tokens.assistant, fontSize: "0.82rem", color: tokens.dim }}>{ils(Number(p.list_price) || 0)}</s>
                    )}
                  </div>
                )}
              </button>
            ))}
          </div>

          <div ref={sentinelRef} aria-hidden="true" />
          {loadErr ? (
            <div style={{ textAlign: "center", marginTop: "1.5rem" }}>
              <p style={{ fontFamily: tokens.assistant, color: "#C0143C", marginBottom: "0.8rem" }}>טעינת המוצרים נכשלה.</p>
              <button onClick={load} style={ghostBtn}>נסו שוב</button>
            </div>
          ) : hasMore || loading ? (
            <p style={{ textAlign: "center", fontFamily: tokens.assistant, color: tokens.dim, marginTop: "1.5rem" }}>טוען עוד מוצרים…</p>
          ) : products.length > PAGE_SIZE ? (
            <p style={{ textAlign: "center", fontFamily: tokens.assistant, color: tokens.dim, marginTop: "1.5rem" }}>
              זהו — רואים את כל {total.toLocaleString("he-IL")} המוצרים ✔
            </p>
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
          style={{ border: `1px solid ${tokens.border}`, borderRadius: 14, background: "#fff", padding: 8, cursor: "zoom-in", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 220, maxHeight: zoomed ? "70dvh" : 340, overflow: "hidden" }}
        >
          <ProductImage
            pictureLink={product.picture_link}
            name={product.name}
            width={zoomed ? 960 : 480}
            rotation={product.rotation_override ?? 0}
            imgStyle={{ maxWidth: "100%", maxHeight: zoomed ? "68dvh" : 320, objectFit: "contain" }}
          />
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
        {showPrice && product.price != null && (
          <p style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.35rem", color: Number(product.discount_percent) > 0 ? "#1A7A4D" : tokens.text, margin: 0 }}>
            {ils(Number(product.price) || 0)}
            {Number(product.discount_percent) > 0 && product.list_price != null && (
              <s style={{ fontFamily: tokens.assistant, fontWeight: 400, fontSize: "0.9rem", color: tokens.dim }}> {ils(Number(product.list_price) || 0)}</s>
            )}
            <span style={{ fontFamily: tokens.assistant, fontWeight: 400, fontSize: "0.85rem", color: tokens.dim }}> · כולל מע״מ</span>
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
