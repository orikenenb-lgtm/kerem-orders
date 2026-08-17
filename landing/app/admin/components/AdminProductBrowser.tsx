"use client";

// Shared product browser for the manager screens.
//
// Every admin screen that operates on products should show the WHOLE
// catalogue the way a customer sees it — grid, category chips, search,
// infinite scroll — instead of an empty box that only fills in after you
// type. Screens differ only in what each card offers, so they pass a
// `renderAction` for the bottom of the card and (optionally) a highlight.
//
// One implementation means the price screen and the collections screen can
// never drift apart in behaviour.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ProductImage from "../../components/ProductImage";
import { supabase } from "../../../lib/supabaseClient";
import { tokens } from "../../../lib/ui";

export type BrowserProduct = {
  id: string;
  name: string;
  sku: string | null;
  price: number;
  category: string | null;
  picture_link: string;
  rotation_override: number | null;
};

const PAGE_SIZE = 24;
const PROD_COLS = "id,name,sku,price,category,picture_link,rotation_override";

export default function AdminProductBrowser({
  searchLabel,
  renderAction,
  highlight,
  stickyTop = 64,
  onTotal,
}: {
  searchLabel: string;
  /** Bottom of each card — the screen's own action(s). */
  renderAction: (p: BrowserProduct) => React.ReactNode;
  /** Draw the card with an accent border (e.g. already in the collection). */
  highlight?: (p: BrowserProduct) => boolean;
  stickyTop?: number;
  onTotal?: (n: number) => void;
}) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState("all");
  const [categories, setCategories] = useState<{ category: string; n: number }[]>([]);
  const [page, setPage] = useState(0);
  const [products, setProducts] = useState<BrowserProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(true);
  const [loadErr, setLoadErr] = useState(false);
  const [endReached, setEndReached] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    supabase.rpc("catalog_categories").then(({ data }) => {
      if (mountedRef.current) setCategories((data as { category: string; n: number }[]) ?? []);
    });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { setQuery(input); setPage(0); }, 350);
    return () => clearTimeout(t);
  }, [input]);
  useEffect(() => { setPage(0); }, [activeCat]);

  // Generation guard: a slow earlier page must never append onto rows that
  // belong to a newer filter.
  const genRef = useRef(0);
  const gridGenRef = useRef(-1);
  useEffect(() => { genRef.current++; }, [query, activeCat]);

  const load = useCallback(async () => {
    const gen = genRef.current;
    setBusy(true);
    let q = supabase.from("products").select(PROD_COLS, { count: "exact" }).eq("is_active", true);
    if (activeCat !== "all") q = q.eq("category", activeCat);
    const s = query.trim();
    if (s) q = q.or(`name.ilike.%${s}%,sku.ilike.%${s}%,barcode.ilike.%${s}%`);
    const { data, count, error } = await q
      .order("name", { ascending: true })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (!mountedRef.current) return;
    if (error) { setLoadErr(true); setBusy(false); return; }
    if (page > 0 && gen !== gridGenRef.current) { setPage(0); return; }
    setLoadErr(false);
    const rows = (data as BrowserProduct[]) ?? [];
    setProducts((prev) => {
      if (page === 0) return rows;
      const seen = new Set(prev.map((p) => p.id));
      return [...prev, ...rows.filter((r) => !seen.has(r.id))];
    });
    gridGenRef.current = gen;
    setEndReached(rows.length < PAGE_SIZE);
    setTotal(count ?? 0);
    setBusy(false);
  }, [query, activeCat, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { onTotal?.(total); }, [total, onTotal]);

  const hasMore = !endReached && products.length < total;
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || busy || loadErr) return;
    const obs = new IntersectionObserver(
      (e) => { if (e[0].isIntersecting) setPage((p) => p + 1); },
      { rootMargin: "700px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, busy, loadErr, products.length]);

  const orderedCats = useMemo(() => [...categories].sort((a, b) => b.n - a.n), [categories]);

  return (
    <>
      <div style={{ position: "sticky", top: stickyTop, zIndex: 20, background: "rgba(255,255,255,0.94)", backdropFilter: "blur(8px)", padding: "1rem 0" }}>
        <input
          type="search"
          aria-label={searchLabel}
          placeholder={`🔍 ${searchLabel}…`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          style={{ width: "100%", fontFamily: tokens.assistant, fontSize: "1rem", padding: "0.8rem 1rem", borderRadius: 12, border: `1px solid ${tokens.border}`, background: tokens.surface, color: tokens.text }}
        />
        {categories.length > 0 && (
          <div role="group" aria-label="סינון לפי קטגוריה" style={{ display: "flex", gap: "0.5rem", overflowX: "auto", paddingBottom: "0.3rem", marginTop: "0.7rem" }}>
            {[{ category: "all", n: 0 }, ...orderedCats].map((c) => {
              const active = activeCat === c.category;
              return (
                <button
                  key={c.category}
                  onClick={() => setActiveCat(c.category)}
                  aria-pressed={active}
                  style={{ whiteSpace: "nowrap", fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.82rem", padding: "0.45rem 1rem", borderRadius: 999, cursor: "pointer", border: `1px solid ${active ? "transparent" : tokens.border}`, background: active ? tokens.accent : "#fff", color: active ? "#fff" : tokens.body }}
                >
                  {c.category === "all" ? "הכל" : `${c.category} (${c.n})`}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {busy && products.length === 0 ? (
        <p style={{ fontFamily: tokens.assistant, color: tokens.dim, marginTop: "1.5rem" }}>טוען מוצרים…</p>
      ) : loadErr && products.length === 0 ? (
        <div style={{ textAlign: "center", marginTop: "1.5rem" }}>
          <p style={{ fontFamily: tokens.assistant, color: "#C0143C", marginBottom: "0.8rem" }}>הטעינה נכשלה.</p>
          <button onClick={load} style={retryBtn}>נסו שוב</button>
        </div>
      ) : products.length === 0 ? (
        <p style={{ fontFamily: tokens.assistant, color: tokens.dim, marginTop: "1.5rem" }}>
          לא נמצאו מוצרים{query ? ` עבור “${query}”` : ""}.
        </p>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "1rem", marginTop: "1rem" }}>
            {products.map((p) => (
              <div
                key={p.id}
                className="kt-card"
                style={{ border: `1px solid ${highlight?.(p) ? "rgba(37,199,126,0.55)" : tokens.border}`, borderRadius: tokens.radiusCard, padding: "0.9rem", background: "#fff", boxShadow: tokens.shadowCard, display: "flex", flexDirection: "column", gap: "0.45rem" }}
              >
                <div style={{ position: "relative", width: "100%", aspectRatio: "1 / 1", borderRadius: 12, background: "#fff", border: `1px solid ${tokens.border}`, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", padding: 8 }}>
                  <ProductImage pictureLink={p.picture_link} name={p.name} rotation={p.rotation_override ?? 0} imgStyle={{ width: "100%", height: "100%", objectFit: "contain" }} />
                </div>
                <h3 style={{ fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.9rem", color: tokens.text, lineHeight: 1.25, minHeight: "2.3em", margin: 0 }}>{p.name}</h3>
                <div style={{ fontFamily: tokens.assistant, fontSize: "0.72rem", color: tokens.dim }} dir="ltr">{p.sku || "—"}</div>
                {renderAction(p)}
              </div>
            ))}
          </div>

          <div ref={sentinelRef} aria-hidden="true" />
          {loadErr ? (
            <div style={{ textAlign: "center", marginTop: "1.5rem" }}>
              <p style={{ fontFamily: tokens.assistant, color: "#C0143C", marginBottom: "0.8rem" }}>טעינת המוצרים נכשלה.</p>
              <button onClick={load} style={retryBtn}>נסו שוב</button>
            </div>
          ) : hasMore || busy ? (
            <p style={{ textAlign: "center", fontFamily: tokens.assistant, color: tokens.dim, marginTop: "1.5rem" }}>טוען עוד מוצרים…</p>
          ) : products.length > PAGE_SIZE ? (
            <p style={{ textAlign: "center", fontFamily: tokens.assistant, color: tokens.dim, marginTop: "1.5rem" }}>
              זהו — כל {total.toLocaleString("he-IL")} המוצרים ✔
            </p>
          ) : null}
        </>
      )}
    </>
  );
}

const retryBtn: React.CSSProperties = {
  fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.9rem", color: tokens.text,
  background: "#fff", border: `1px solid ${tokens.border}`, padding: "0.6rem 1.3rem",
  borderRadius: 999, cursor: "pointer",
};
