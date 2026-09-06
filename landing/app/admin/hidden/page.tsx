"use client";

// Manager screen: hide things from the site, whatever Rivhit says.
//
// The Rivhit sync was checked end to end and is doing its job — every active
// product is rewritten on each 15-minute run, and anything that stops coming
// back from Item.List is deactivated. But a product the owner considers gone
// can still be reported by Rivhit as sellable (a finished line whose stock was
// zeroed still returns with a price), and then it stays on the site forever.
//
// This screen is the override. It writes hidden_manually, and a database
// trigger forces is_active = false on every write to that row — so the next
// sync cannot bring the product back. Nothing is deleted: un-hiding restores
// the product immediately, and the sync corrects it from there.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SiteHeader from "../../components/SiteHeader";
import SiteFooter from "../../components/SiteFooter";
import { supabase } from "../../../lib/supabaseClient";
import { useAuth } from "../../../lib/auth";
import { tokens, ils } from "../../../lib/ui";
import { normalizeHe } from "../../../lib/searchRank";

type Row = { id: string; name: string; category: string | null; sku: string | null; price: number | string | null };
type Cat = { category: string; n: number };

export default function HiddenAdminPage() {
  const router = useRouter();
  const { session, isManager, loading } = useAuth();

  const [cats, setCats] = useState<Cat[]>([]);
  const [hidden, setHidden] = useState<Row[]>([]);
  const [found, setFound] = useState<Row[]>([]);
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!session) router.replace("/login");
    else if (!isManager) router.replace("/catalog");
  }, [loading, session, isManager, router]);

  useEffect(() => {
    const t = setTimeout(() => setQuery(input), 350);
    return () => clearTimeout(t);
  }, [input]);

  // `busy` starts true, so the FIRST load has nothing to announce — only a
  // manual retry needs the spinner turned back on. Keeping setBusy out of the
  // synchronous path means the mount effect never setStates before its first
  // await, which is the cascading-render pattern the lint rule is about.
  const load = useCallback(async (showSpinner = false) => {
    if (!isManager) return;
    if (showSpinner) setBusy(true);
    const [c, h] = await Promise.all([
      supabase.rpc("catalog_categories"),
      supabase.rpc("hidden_products"),
    ]);
    if (!mountedRef.current) return;
    if (c.error || h.error) {
      // Never render an empty screen that reads like "nothing is hidden" when
      // the truth is "we could not ask".
      setErr("טעינת הנתונים נכשלה. בדקו את החיבור ונסו שוב.");
      setBusy(false);
      return;
    }
    setErr("");
    setCats((c.data as Cat[]) ?? []);
    setHidden((h.data as Row[]) ?? []);
    setBusy(false);
  }, [isManager]);

  useEffect(() => { load(); }, [load]);

  // Product search runs over ACTIVE products only — a hidden one already has
  // its own list below, and showing it in both places invites double-clicking.
  useEffect(() => {
    let alive = true;
    (async () => {
      const q = query.trim();
      // No synchronous setState here: a short query is handled at render time
      // (see `visibleFound`) instead of by clearing state inside the effect
      // body, which cascades a render for every keystroke.
      if (q.length < 2) return;
      const { data } = await supabase
        .from("products")
        .select("id,name,category,sku,price")
        .eq("is_active", true)
        .or(`name.ilike.%${q}%,sku.ilike.%${q}%,barcode.ilike.%${q}%`)
        .order("name")
        .limit(30);
      if (alive && mountedRef.current) setFound((data as Row[]) ?? []);
    })();
    return () => { alive = false; };
  }, [query]);

  const hideProduct = async (id: string, name: string, hide: boolean) => {
    setWorking(id); setMsg("");
    const { error } = await supabase.rpc("set_product_hidden", { p_product: id, p_hidden: hide });
    if (!mountedRef.current) return;
    setWorking(null);
    if (error) { setMsg(error.message || "הפעולה נכשלה."); return; }
    setMsg(hide ? `“${name}” הוסתר מהאתר.` : `“${name}” חזר לאתר.`);
    load();
    if (!hide) setFound((f) => f.slice());
  };

  const hideCategory = async (category: string, hide: boolean) => {
    setWorking(category); setMsg("");
    const { data, error } = await supabase.rpc("set_category_hidden", { p_category: category, p_hidden: hide });
    if (!mountedRef.current) return;
    setWorking(null);
    if (error) { setMsg(error.message || "הפעולה נכשלה."); return; }
    const n = Number(data) || 0;
    setMsg(hide ? `הקטגוריה “${category}” הוסתרה — ${n.toLocaleString("he-IL")} מוצרים.`
                : `הקטגוריה “${category}” חזרה — ${n.toLocaleString("he-IL")} מוצרים.`);
    load();
  };

  // Categories that exist ONLY as hidden rows: once every product in a category
  // is hidden the category vanishes from catalog_categories(), so without this
  // there would be no way to put it back.
  const hiddenCats = useMemo(() => {
    const live = new Set(cats.map((c) => c.category));
    const m = new Map<string, number>();
    for (const r of hidden) {
      const k = (r.category || "").trim();
      if (!k || live.has(k)) continue;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].map(([category, n]) => ({ category, n })).sort((a, b) => b.n - a.n);
  }, [cats, hidden]);

  const shownCats = useMemo(() => {
    const q = normalizeHe(query);
    if (!q) return cats;
    return cats.filter((c) => normalizeHe(c.category).includes(q));
  }, [cats, query]);

  // Results belong to the CURRENT query. Deriving this instead of clearing
  // state keeps a stale list from flashing while a new search is in flight.
  const visibleFound = query.trim().length >= 2 ? found : [];

  if (loading || !isManager) return null;

  return (
    <>
      <SiteHeader />
      <main id="main-content" tabIndex={-1} style={{ maxWidth: 1000, margin: "0 auto", padding: "clamp(1.25rem,4vw,2.5rem) clamp(1rem,4vw,2.5rem) 5rem" }}>
        <div style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.dim, marginBottom: "0.8rem" }}>
          <Link href="/admin" style={{ color: tokens.accent, textDecoration: "none" }}>ניהול</Link> · הסתרה מהאתר
        </div>
        <h1 style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "clamp(1.5rem,4vw,2.2rem)", color: tokens.text }}>
          הסתרה מהאתר
        </h1>
        <p style={{ fontFamily: tokens.assistant, color: tokens.body, marginTop: "0.4rem", maxWidth: 760 }}>
          מוצר או קטגוריה שהוסתרו כאן <strong>לא יחזרו לאתר גם אחרי עדכון מרווחית</strong>.
          שום דבר לא נמחק — אפשר להחזיר בלחיצה, והמוצר חוזר מיד.
        </p>

        {msg && (
          <p role="status" style={{ fontFamily: tokens.assistant, fontSize: "0.9rem", color: msg.includes("נכשל") ? "#C0143C" : "#1A7A4D", marginTop: "0.8rem" }}>{msg}</p>
        )}
        {err && (
          <div style={{ marginTop: "0.8rem" }}>
            <p role="alert" style={{ fontFamily: tokens.assistant, color: "#C0143C", marginBottom: "0.5rem" }}>{err}</p>
            <button onClick={() => load(true)} style={miniBtn}>נסו שוב</button>
          </div>
        )}

        <input
          type="search"
          aria-label="חיפוש מוצר או קטגוריה"
          placeholder="🔍 חיפוש מוצר לפי שם / מק״ט / ברקוד, או שם קטגוריה…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          style={{ width: "100%", fontFamily: tokens.assistant, fontSize: "1rem", padding: "0.85rem 1rem", borderRadius: 14, border: `1px solid ${tokens.border}`, background: tokens.surface, color: tokens.text, marginTop: "1.2rem" }}
        />

        {visibleFound.length > 0 && (
          <section style={{ marginTop: "1.4rem" }}>
            <h2 style={sectionH}>מוצרים שנמצאו ({visibleFound.length.toLocaleString("he-IL")})</h2>
            <div style={{ display: "grid", gap: "0.5rem" }}>
              {visibleFound.map((p) => (
                <div key={p.id} style={rowBox}>
                  <div style={{ flex: 1, minWidth: 170 }}>
                    <div style={{ fontFamily: tokens.assistant, fontWeight: 700, fontSize: "0.9rem", color: tokens.text }}>{p.name}</div>
                    <div style={{ fontFamily: tokens.assistant, fontSize: "0.78rem", color: tokens.dim }}>
                      {p.category || "בלי קטגוריה"} · <span dir="ltr">{p.sku || "—"}</span> · {ils(Number(p.price) || 0)}
                    </div>
                  </div>
                  <button onClick={() => hideProduct(p.id, p.name, true)} disabled={working === p.id} style={dangerBtn}>
                    {working === p.id ? "…" : "הסתרה"}
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        <section style={{ marginTop: "1.6rem" }}>
          <h2 style={sectionH}>קטגוריות באתר ({shownCats.length.toLocaleString("he-IL")})</h2>
          <p style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.dim, marginBottom: "0.6rem" }}>
            הסתרת קטגוריה מסתירה את כל המוצרים שבה, והיא נעלמת מרשימת הקטגוריות בקטלוג.
          </p>
          {busy && <p style={{ fontFamily: tokens.assistant, color: tokens.dim }}>טוען…</p>}
          <div style={{ display: "grid", gap: "0.5rem" }}>
            {shownCats.map((c) => (
              <div key={c.category} style={rowBox}>
                <div style={{ flex: 1, minWidth: 150, fontFamily: tokens.assistant, fontWeight: 700, fontSize: "0.9rem", color: tokens.text }}>
                  {c.category} <span style={{ color: tokens.dim, fontWeight: 400 }}>({c.n.toLocaleString("he-IL")})</span>
                </div>
                <button onClick={() => hideCategory(c.category, true)} disabled={working === c.category} style={dangerBtn}>
                  {working === c.category ? "…" : "הסתרת הקטגוריה"}
                </button>
              </div>
            ))}
          </div>
        </section>

        {hiddenCats.length > 0 && (
          <section style={{ marginTop: "1.6rem" }}>
            <h2 style={sectionH}>קטגוריות מוסתרות ({hiddenCats.length})</h2>
            <div style={{ display: "grid", gap: "0.5rem" }}>
              {hiddenCats.map((c) => (
                <div key={c.category} style={{ ...rowBox, background: "rgba(0,0,0,0.02)" }}>
                  <div style={{ flex: 1, minWidth: 150, fontFamily: tokens.assistant, fontWeight: 700, fontSize: "0.9rem", color: tokens.dim }}>
                    {c.category} <span style={{ fontWeight: 400 }}>({c.n.toLocaleString("he-IL")} מוסתרים)</span>
                  </div>
                  <button onClick={() => hideCategory(c.category, false)} disabled={working === c.category} style={{ ...miniBtn, minHeight: 44, color: "#1A7A4D", borderColor: "rgba(37,199,126,0.45)" }}>
                    {working === c.category ? "…" : "החזרה לאתר"}
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        <section style={{ marginTop: "1.6rem" }}>
          <h2 style={sectionH}>מוצרים מוסתרים ({hidden.length.toLocaleString("he-IL")})</h2>
          {hidden.length === 0 ? (
            <p style={{ fontFamily: tokens.assistant, color: tokens.dim }}>אין כרגע מוצרים מוסתרים.</p>
          ) : (
            <div style={{ display: "grid", gap: "0.5rem" }}>
              {hidden.map((p) => (
                <div key={p.id} style={{ ...rowBox, background: "rgba(0,0,0,0.02)" }}>
                  <div style={{ flex: 1, minWidth: 170 }}>
                    <div style={{ fontFamily: tokens.assistant, fontWeight: 700, fontSize: "0.9rem", color: tokens.dim }}>{p.name}</div>
                    <div style={{ fontFamily: tokens.assistant, fontSize: "0.78rem", color: tokens.dim }}>
                      {p.category || "בלי קטגוריה"} · <span dir="ltr">{p.sku || "—"}</span>
                    </div>
                  </div>
                  <button onClick={() => hideProduct(p.id, p.name, false)} disabled={working === p.id} style={{ ...miniBtn, minHeight: 44, color: "#1A7A4D", borderColor: "rgba(37,199,126,0.45)" }}>
                    {working === p.id ? "…" : "החזרה לאתר"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

const sectionH: React.CSSProperties = {
  fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.05rem", color: tokens.text, marginBottom: "0.5rem",
};
const rowBox: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: "0.7rem", flexWrap: "wrap",
  border: `1px solid ${tokens.border}`, borderRadius: 12, background: "#fff", padding: "0.7rem 0.9rem",
};
const miniBtn: React.CSSProperties = {
  fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.85rem", color: tokens.text,
  background: "#fff", border: `1px solid ${tokens.border}`, padding: "0.5rem 1rem",
  borderRadius: 999, cursor: "pointer",
};
const dangerBtn: React.CSSProperties = {
  ...miniBtn, minHeight: 44, color: "#C0143C", borderColor: "rgba(192,20,60,0.35)", background: "rgba(192,20,60,0.05)",
};
