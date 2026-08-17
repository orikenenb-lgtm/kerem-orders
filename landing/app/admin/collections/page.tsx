"use client";

// Manager screen: customer-specific catalog links ("קישור לרשת").
// Create a named collection, tick whether it shows prices, add/remove
// products (start with 50, grow over time), copy the shareable link.
//
// Data lives in collections / collection_products (manager-only RLS);
// the public page reads through the catalog_collection RPC.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SiteHeader from "../../components/SiteHeader";
import ProductImage from "../../components/ProductImage";
import { supabase } from "../../../lib/supabaseClient";
import { useAuth } from "../../../lib/auth";
import { tokens } from "../../../lib/ui";

type Collection = {
  id: string;
  slug: string;
  name: string;
  show_prices: boolean;
  is_active: boolean;
  created_at: string;
  n?: number;
};

type ProductRow = {
  id: string;
  name: string;
  sku: string | null;
  picture_link: string;
  rotation_override: number | null;
};

// Unguessable link token: 12 chars, URL-safe, from the browser CSPRNG.
function makeSlug(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

const base = process.env.NEXT_PUBLIC_BASE_PATH || "";

function collectionUrl(slug: string): string {
  if (typeof window === "undefined") return `${base}/collection/?k=${slug}`;
  return `${window.location.origin}${base}/collection/?k=${slug}`;
}

export default function CollectionsAdminPage() {
  const router = useRouter();
  const { session, isManager, loading } = useAuth();

  const [collections, setCollections] = useState<Collection[]>([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");

  // create form
  const [newName, setNewName] = useState("");
  const [newPrices, setNewPrices] = useState(false);
  const [creating, setCreating] = useState(false);

  // editing state: which collection is open + its member ids
  const [openId, setOpenId] = useState<string | null>(null);
  const [members, setMembers] = useState<ProductRow[]>([]);
  const [membersBusy, setMembersBusy] = useState(false);

  // product search (for adding)
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductRow[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);

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

  const loadCollections = useCallback(async () => {
    if (!isManager) return;
    setBusy(true);
    const { data, error } = await supabase
      .from("collections")
      .select("id,slug,name,show_prices,is_active,created_at, collection_products(count)")
      .order("created_at", { ascending: false });
    if (!mountedRef.current) return;
    if (error) { setErr("טעינת הקטלוגים נכשלה."); setBusy(false); return; }
    setErr("");
    type RawRow = Collection & { collection_products?: { count: number }[] };
    setCollections(((data ?? []) as RawRow[]).map((r) => ({
      ...r,
      n: r.collection_products?.[0]?.count ?? 0,
    })));
    setBusy(false);
  }, [isManager]);

  useEffect(() => { loadCollections(); }, [loadCollections]);

  const createCollection = async () => {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    setErr("");
    const { error } = await supabase
      .from("collections")
      .insert({ name, slug: makeSlug(), show_prices: newPrices });
    if (!mountedRef.current) return;
    setCreating(false);
    if (error) { setErr("יצירת הקטלוג נכשלה. נסו שוב."); return; }
    setNewName("");
    setNewPrices(false);
    setNotice(`הקטלוג "${name}" נוצר — עכשיו מוסיפים אליו מוצרים.`);
    loadCollections();
  };

  const toggleActive = async (c: Collection) => {
    const { error } = await supabase
      .from("collections")
      .update({ is_active: !c.is_active })
      .eq("id", c.id);
    if (error) { setErr("העדכון נכשל."); return; }
    loadCollections();
  };

  const togglePrices = async (c: Collection) => {
    const { error } = await supabase
      .from("collections")
      .update({ show_prices: !c.show_prices })
      .eq("id", c.id);
    if (error) { setErr("העדכון נכשל."); return; }
    loadCollections();
  };

  const copyLink = async (c: Collection) => {
    try {
      await navigator.clipboard.writeText(collectionUrl(c.slug));
      setNotice(`הקישור של "${c.name}" הועתק — אפשר לשלוח ללקוח.`);
    } catch {
      setNotice(`הקישור: ${collectionUrl(c.slug)}`);
    }
  };

  const loadMembers = useCallback(async (collectionId: string) => {
    setMembersBusy(true);
    const { data, error } = await supabase
      .from("collection_products")
      .select("sort_order, products(id,name,sku,picture_link,rotation_override)")
      .eq("collection_id", collectionId)
      .order("sort_order", { ascending: true });
    if (!mountedRef.current) return;
    setMembersBusy(false);
    if (error) { setErr("טעינת מוצרי הקטלוג נכשלה."); return; }
    type Joined = { sort_order: number; products: ProductRow | null };
    setMembers(((data ?? []) as unknown as Joined[]).map((r) => r.products).filter((p): p is ProductRow => !!p));
  }, []);

  const openCollection = (c: Collection) => {
    if (openId === c.id) { setOpenId(null); setMembers([]); return; }
    setOpenId(c.id);
    setMembers([]);
    setInput("");
    setQuery("");
    setResults([]);
    loadMembers(c.id);
  };

  // debounce product search
  useEffect(() => {
    const t = setTimeout(() => setQuery(input), 350);
    return () => clearTimeout(t);
  }, [input]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const s = query.trim();
      if (!openId || s.length < 2) { setResults([]); return; }
      setSearchBusy(true);
      const { data } = await supabase
        .from("products")
        .select("id,name,sku,picture_link,rotation_override")
        .eq("is_active", true)
        .or(`name.ilike.%${s}%,sku.ilike.%${s}%,barcode.ilike.%${s}%`)
        .order("name")
        .limit(12);
      if (cancelled || !mountedRef.current) return;
      setSearchBusy(false);
      setResults((data as ProductRow[]) ?? []);
    };
    run();
    return () => { cancelled = true; };
  }, [query, openId]);

  const addProduct = async (p: ProductRow) => {
    if (!openId) return;
    // sort_order: append at the end.
    const { error } = await supabase
      .from("collection_products")
      .insert({ collection_id: openId, product_id: p.id, sort_order: members.length });
    if (error) {
      // duplicate insert (already in the collection) is the common case — quiet.
      if (!/duplicate|unique/i.test(error.message)) setErr("הוספת המוצר נכשלה.");
      return;
    }
    setMembers((m) => [...m, p]);
    loadCollections(); // refresh counts
  };

  const removeProduct = async (p: ProductRow) => {
    if (!openId) return;
    const { error } = await supabase
      .from("collection_products")
      .delete()
      .eq("collection_id", openId)
      .eq("product_id", p.id);
    if (error) { setErr("הסרת המוצר נכשלה."); return; }
    setMembers((m) => m.filter((x) => x.id !== p.id));
    loadCollections();
  };

  if (loading || !isManager) return null;

  const memberIds = new Set(members.map((m) => m.id));

  return (
    <>
      <SiteHeader />
      <main id="main-content" style={{ maxWidth: 1100, margin: "0 auto", padding: "clamp(1.25rem,4vw,2.5rem) clamp(1rem,4vw,2.5rem) 5rem" }}>
        <div style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.dim, marginBottom: "0.8rem" }}>
          <Link href="/admin" style={{ color: tokens.accent, textDecoration: "none" }}>ניהול</Link> · קטלוגים ללקוחות
        </div>
        <h1 style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "clamp(1.5rem,4vw,2.2rem)", color: tokens.text }}>
          קטלוגים מותאמים ללקוחות
        </h1>
        <p style={{ fontFamily: tokens.assistant, color: tokens.body, marginTop: "0.4rem", maxWidth: 640 }}>
          בונים קטלוג עם המוצרים שנבחרו ללקוח מסוים (למשל רשת), ושולחים לו קישור אחד.
          הלקוח רואה רק את המוצרים שבקטלוג — אפשר להוסיף ולהסיר בכל רגע והקישור נשאר אותו קישור.
        </p>

        {/* create */}
        <div style={{ marginTop: "1.4rem", border: `1px solid ${tokens.border}`, borderRadius: 16, background: "#fff", padding: "1rem", display: "flex", gap: "0.7rem", flexWrap: "wrap", alignItems: "center" }}>
          <input
            aria-label="שם הקטלוג החדש"
            placeholder="שם הקטלוג — למשל: רשת הצעצועים של רמי"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") createCollection(); }}
            style={{ flex: 1, minWidth: 220, fontFamily: tokens.assistant, fontSize: "1rem", padding: "0.7rem 0.9rem", borderRadius: 12, border: `1px solid ${tokens.border}`, background: tokens.surface, color: tokens.text }}
          />
          <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontFamily: tokens.assistant, fontSize: "0.9rem", color: tokens.body, cursor: "pointer" }}>
            <input type="checkbox" checked={newPrices} onChange={(e) => setNewPrices(e.target.checked)} />
            להציג מחירים בקישור
          </label>
          <button onClick={createCollection} disabled={creating || !newName.trim()} style={{ fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.9rem", color: "#fff", background: tokens.rainbow, border: "none", padding: "0.7rem 1.4rem", borderRadius: 999, cursor: "pointer", opacity: creating || !newName.trim() ? 0.6 : 1 }}>
            {creating ? "יוצר…" : "+ קטלוג חדש"}
          </button>
        </div>

        {notice && <p role="status" style={{ fontFamily: tokens.assistant, color: "#1A7A4D", background: "rgba(37,199,126,0.12)", border: "1px solid rgba(37,199,126,0.4)", borderRadius: 10, padding: "0.5rem 0.8rem", marginTop: "0.8rem" }}>{notice}</p>}
        {err && <p role="alert" style={{ fontFamily: tokens.assistant, color: "#C0143C", marginTop: "0.8rem" }}>{err}</p>}

        {/* list */}
        {busy ? (
          <p style={{ fontFamily: tokens.assistant, color: tokens.dim, marginTop: "1.5rem" }}>טוען…</p>
        ) : collections.length === 0 ? (
          <p style={{ fontFamily: tokens.assistant, color: tokens.dim, marginTop: "1.5rem" }}>
            עוד אין קטלוגים — יוצרים אחד למעלה ומתחילים להוסיף מוצרים.
          </p>
        ) : (
          <div style={{ display: "grid", gap: "0.9rem", marginTop: "1.4rem" }}>
            {collections.map((c) => (
              <div key={c.id} style={{ border: `1px solid ${openId === c.id ? tokens.accent : tokens.border}`, borderRadius: 16, background: "#fff", padding: "1rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.8rem", flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.05rem", color: tokens.text }}>
                      {c.name}
                      {!c.is_active && <span style={{ fontFamily: tokens.assistant, fontWeight: 400, fontSize: "0.8rem", color: "#C0143C" }}> · כבוי</span>}
                    </div>
                    <div style={{ fontFamily: tokens.assistant, fontSize: "0.82rem", color: tokens.dim }}>
                      {(c.n ?? 0).toLocaleString("he-IL")} מוצרים · {c.show_prices ? "עם מחירים" : "בלי מחירים"}
                    </div>
                  </div>
                  <button onClick={() => copyLink(c)} style={miniBtn}>📋 העתקת קישור</button>
                  <button onClick={() => togglePrices(c)} style={miniBtn}>{c.show_prices ? "להסתיר מחירים" : "להציג מחירים"}</button>
                  <button onClick={() => toggleActive(c)} style={{ ...miniBtn, color: c.is_active ? "#C0143C" : "#1A7A4D" }}>
                    {c.is_active ? "כיבוי הקישור" : "הפעלת הקישור"}
                  </button>
                  <button onClick={() => openCollection(c)} aria-expanded={openId === c.id} style={{ ...miniBtn, background: openId === c.id ? tokens.accent : "#fff", color: openId === c.id ? "#fff" : tokens.text }}>
                    {openId === c.id ? "סגירת עריכה" : "עריכת מוצרים"}
                  </button>
                </div>

                {openId === c.id && (
                  <div style={{ borderTop: `1px solid ${tokens.border}`, marginTop: "0.9rem", paddingTop: "0.9rem" }}>
                    <input
                      type="search"
                      aria-label="חיפוש מוצר להוספה לקטלוג"
                      placeholder="🔍 חיפוש מוצר להוספה (שם / קוד / ברקוד)…"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      style={{ width: "100%", fontFamily: tokens.assistant, fontSize: "0.95rem", padding: "0.7rem 0.9rem", borderRadius: 12, border: `1px solid ${tokens.border}`, background: tokens.surface, color: tokens.text }}
                    />
                    {searchBusy && <p style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.dim, marginTop: "0.5rem" }}>מחפש…</p>}
                    {results.length > 0 && (
                      <div style={{ display: "grid", gap: "0.4rem", marginTop: "0.6rem" }}>
                        {results.map((p) => {
                          const inCol = memberIds.has(p.id);
                          return (
                            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: "0.6rem", border: `1px solid ${tokens.border}`, borderRadius: 10, padding: "0.4rem 0.6rem" }}>
                              <div style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 8, border: `1px solid ${tokens.border}`, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", background: "#fff" }}>
                                <ProductImage pictureLink={p.picture_link} name={p.name} width={480} rotation={p.rotation_override ?? 0} imgStyle={{ width: "100%", height: "100%", objectFit: "contain" }} />
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontFamily: tokens.assistant, fontWeight: 600, fontSize: "0.88rem", color: tokens.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                                {p.sku && <div style={{ fontFamily: tokens.assistant, fontSize: "0.72rem", color: tokens.dim }} dir="ltr">{p.sku}</div>}
                              </div>
                              <button onClick={() => (inCol ? removeProduct(p) : addProduct(p))} style={{ ...miniBtn, color: inCol ? "#C0143C" : "#1A7A4D" }}>
                                {inCol ? "הסרה" : "+ הוספה"}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div style={{ fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.95rem", color: tokens.text, marginTop: "1rem" }}>
                      בקטלוג ({members.length.toLocaleString("he-IL")})
                    </div>
                    {membersBusy ? (
                      <p style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.dim }}>טוען…</p>
                    ) : members.length === 0 ? (
                      <p style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.dim }}>אין עדיין מוצרים — מחפשים למעלה ומוסיפים.</p>
                    ) : (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: "0.5rem", marginTop: "0.5rem" }}>
                        {members.map((p) => (
                          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", border: `1px solid ${tokens.border}`, borderRadius: 10, padding: "0.35rem 0.5rem" }}>
                            <div style={{ width: 36, height: 36, flexShrink: 0, borderRadius: 8, border: `1px solid ${tokens.border}`, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", background: "#fff" }}>
                              <ProductImage pictureLink={p.picture_link} name={p.name} width={480} rotation={p.rotation_override ?? 0} imgStyle={{ width: "100%", height: "100%", objectFit: "contain" }} />
                            </div>
                            <div style={{ flex: 1, minWidth: 0, fontFamily: tokens.assistant, fontSize: "0.8rem", color: tokens.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                            <button onClick={() => removeProduct(p)} aria-label={`הסרת ${p.name} מהקטלוג`} style={{ ...miniBtn, padding: "0.25rem 0.5rem", color: "#C0143C" }}>✕</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );
}

const miniBtn: React.CSSProperties = {
  fontFamily: tokens.rubik,
  fontWeight: 700,
  fontSize: "0.82rem",
  color: tokens.text,
  background: "#fff",
  border: `1px solid ${tokens.border}`,
  padding: "0.45rem 0.8rem",
  borderRadius: 999,
  cursor: "pointer",
};
