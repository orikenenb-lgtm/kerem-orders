"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import SiteHeader from "../components/SiteHeader";
import { supabase } from "../../lib/supabaseClient";
import { rivhitImg } from "../../lib/images";
import { tokens } from "../../lib/ui";

// Public, read-only catalog (no login, no ordering, no prices).
// Data comes from the catalog_public() function, which exposes ONLY
// name / picture / category / in-stock — never prices or stock counts.
type PublicProduct = {
  id: string;
  name: string;
  picture_link: string;
  category: string;
  in_stock: boolean;
  rank?: number;
  total?: number;
};

const PAGE_SIZE = 24;

export default function PublicCatalogPage() {
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

  useEffect(() => {
    supabase.rpc("catalog_public_categories").then(({ data }) => {
      setCategories((data as { category: string; n: number }[]) ?? []);
    });
  }, []);

  // debounce search -> query, reset to page 0
  useEffect(() => {
    const t = setTimeout(() => { setQuery(input); setPage(0); }, 350);
    return () => clearTimeout(t);
  }, [input]);

  useEffect(() => { setPage(0); }, [activeCat]);

  const loadSeq = useRef(0);
  const loadProducts = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoadingProducts(true);
    setFuzzyNote(false);
    const s = query.trim().replace(/[,()%]/g, " ").trim();
    const { data, error } = await supabase.rpc("catalog_public", {
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
    setLoadErr(false);
    const rows = (data as PublicProduct[]) ?? [];
    setProducts(rows);
    setTotal(Number(rows[0]?.total ?? 0));
    // no exact match but similar ones found → "did you mean" mode
    setFuzzyNote(s.length >= 2 && rows.length > 0 && (rows[0]?.rank ?? 0) < 0.55);
    setLoadingProducts(false);
  }, [query, page, activeCat]);

  useEffect(() => { loadProducts(); }, [loadProducts]);

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

  return (
    <>
      <SiteHeader />
      <main style={{ maxWidth: 1280, margin: "0 auto", padding: "clamp(1.25rem,4vw,2.5rem) clamp(1rem,4vw,2.5rem) 6rem" }}>
        <h1 style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "clamp(1.6rem,4vw,2.6rem)", color: tokens.text }}>
          קטלוג המוצרים
        </h1>
        <p style={{ fontFamily: tokens.assistant, color: tokens.body, marginTop: "0.3rem" }}>
          {total.toLocaleString("he-IL")} מוצרים · לצפייה בלבד
        </p>

        <div style={{ display: "flex", alignItems: "center", gap: "0.8rem", flexWrap: "wrap", marginTop: "0.8rem", fontFamily: tokens.assistant, fontSize: "0.95rem", color: tokens.body, background: "rgba(46,125,255,0.07)", border: "1px solid rgba(46,125,255,0.2)", borderRadius: 14, padding: "0.8rem 1rem" }}>
          <span>💼 מחירים סיטונאיים והזמנות — ללקוחות רשומים בלבד.</span>
          <Link href="/register" style={{ fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.85rem", color: "#fff", background: tokens.rainbow, padding: "0.45rem 1.1rem", borderRadius: 999, textDecoration: "none", whiteSpace: "nowrap" }}>
            פתיחת חשבון סיטונאי
          </Link>
        </div>

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

        {loadingProducts ? (
          <p style={{ fontFamily: tokens.assistant, color: tokens.dim, marginTop: "2rem" }}>טוען מוצרים…</p>
        ) : loadErr ? (
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
                    <div style={{ position: "relative", height: 150, borderRadius: 12, background: "#fff", border: `1px solid ${tokens.border}`, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", fontSize: "2.6rem" }}>
                      <ProductImg src={img} alt={p.name} />
                      {!p.in_stock && (
                        <span style={{ position: "absolute", top: 6, insetInlineStart: 6, fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.68rem", color: "#fff", background: "#FF8A00", padding: "0.2rem 0.6rem", borderRadius: 999 }}>
                          אזל מהמלאי
                        </span>
                      )}
                    </div>
                    <h3 style={{ fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.92rem", color: tokens.text, lineHeight: 1.25, minHeight: "2.3em" }}>{p.name}</h3>
                    {p.category && (
                      <div style={{ fontFamily: tokens.assistant, fontSize: "0.72rem", color: tokens.dim }}>{p.category}</div>
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
