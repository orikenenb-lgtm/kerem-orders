"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SiteHeader from "./SiteHeader";
import { supabase } from "../../lib/supabaseClient";
import { rivhitImg } from "../../lib/images";
import { tokens, ils } from "../../lib/ui";

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
    const rows = (data as PublicProduct[]) ?? [];
    applyRows(rows, page > 0);
    gridGen.current = gen;
    setEndReached(rows.length < PAGE_SIZE);
    // An empty overflow page carries no window count — keep the known total.
    if (page === 0 || rows.length > 0) setTotal(Number(rows[0]?.total ?? 0));
    // no exact match but similar ones found → "did you mean" mode
    if (page === 0) setFuzzyNote(s.length >= 2 && rows.length > 0 && (rows[0]?.rank ?? 0) < 0.55);
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
      <main style={{ maxWidth: 1280, margin: "0 auto", padding: "clamp(1.25rem,4vw,2.5rem) clamp(1rem,4vw,2.5rem) 6rem" }}>
        <h1 style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "clamp(1.6rem,4vw,2.6rem)", color: tokens.text }}>
          {showPrices ? "קטלוג ומחירון" : "קטלוג המוצרים"}
        </h1>
        <p style={{ fontFamily: tokens.assistant, color: tokens.body, marginTop: "0.3rem" }}>
          {total.toLocaleString("he-IL")} מוצרים · לצפייה בלבד
          {showPrices && vatLabel ? " · המחירים כוללים מע״מ" : ""}
        </p>

        <div style={{ position: "sticky", top: 64, zIndex: 20, background: "rgba(255,255,255,0.94)", backdropFilter: "blur(8px)", padding: "1rem 0", marginTop: "0.5rem" }}>
          <input
            placeholder="🔍 חיפוש מוצר…"
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
                const img = rivhitImg(p.picture_link);
                return (
                  <div key={p.id} style={{ border: `1px solid ${tokens.border}`, borderTop: `3px solid ${accent}`, borderRadius: 16, padding: "0.9rem", background: "#fff", boxShadow: "0 8px 24px rgba(26,23,48,0.05)", display: "flex", flexDirection: "column", gap: "0.45rem" }}>
                    {/* No stock badge: quantities in Rivhit are not maintained
                        reliably (new items arrive as 0), so an automatic
                        "אזל מהמלאי" label mislabels products that ARE in stock. */}
                    <div style={{ position: "relative", height: 150, borderRadius: 12, background: "#fff", border: `1px solid ${tokens.border}`, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", fontSize: "2.6rem" }}>
                      <ProductImg src={img} alt={p.name} />
                    </div>
                    <h3 style={{ fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.92rem", color: tokens.text, lineHeight: 1.25, minHeight: "2.3em" }}>{p.name}</h3>
                    {p.category && (
                      <div style={{ fontFamily: tokens.assistant, fontSize: "0.72rem", color: tokens.dim }}>{p.category}</div>
                    )}
                    {showPrices && (
                      <div style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.1rem", color: tokens.text }}>
                        {ils(Number(p.price) || 0)}
                      </div>
                    )}
                  </div>
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
    </>
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
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} loading="lazy" onError={() => setErr(true)} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
  );
}
