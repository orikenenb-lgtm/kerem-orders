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
import SiteFooter from "../../components/SiteFooter";
import ProductImage from "../../components/ProductImage";
import AdminProductBrowser, { type BrowserProduct } from "../components/AdminProductBrowser";
import { supabase } from "../../../lib/supabaseClient";
import { useAuth } from "../../../lib/auth";
import { tokens } from "../../../lib/ui";

type Collection = {
  id: string;
  slug: string;
  name: string;
  show_prices: boolean;
  discount_percent: number | string | null;
  is_active: boolean;
  created_at: string;
  n?: number;
};

// The browser hands back full product rows; the collection only stores ids,
// but keeping the same shape means members and search results render alike.
type ProductRow = BrowserProduct;

// A member additionally knows its two price layers: the exact price set for
// THIS collection (col_price, from collection_products.price_override) and the
// manager's global price for everyone (glob_price, from price_overrides).
// Both are needed to tell the manager the truth: what the customer in this
// link will actually see, and what he would have seen without the override.
type MemberRow = ProductRow & { col_price: number | null; glob_price: number | null };

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
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [membersBusy, setMembersBusy] = useState(false);

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

  // The skeleton is for the FIRST load only. Every add and every remove calls
  // this to refresh the member counts, and flipping `busy` back on swapped the
  // whole list for "טוען…" — which unmounted <AdminProductBrowser> and threw
  // away its search text, its category chip and its scroll position. Building a
  // 50-item catalogue meant paying that reset 50 times. Refreshes now update
  // the counts underneath a list that never disappears.
  const loadedOnceRef = useRef(false);
  const loadCollections = useCallback(async () => {
    if (!isManager) return;
    if (!loadedOnceRef.current) setBusy(true);
    const { data, error } = await supabase
      .from("collections")
      .select("id,slug,name,show_prices,discount_percent,is_active,created_at, collection_products(count)")
      .order("created_at", { ascending: false });
    if (!mountedRef.current) return;
    if (error) { setErr("טעינת הקטלוגים נכשלה."); setBusy(false); return; }
    setErr("");
    type RawRow = Collection & { collection_products?: { count: number }[] };
    setCollections(((data ?? []) as RawRow[]).map((r) => ({
      ...r,
      n: r.collection_products?.[0]?.count ?? 0,
    })));
    loadedOnceRef.current = true;
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

  // One click sets a percentage off EVERY product in this catalogue. It is
  // stored on the collection and applied server-side inside catalog_collection,
  // so it covers products added later too — no need to re-apply, and no
  // per-product rows to keep in sync.
  // The typed value used to be clamped: "-15" lost its minus and became 15%,
  // and "150" became 99.99% — a near-free price list from one slip of the
  // keyboard, reported back as a success ("הנחה של 99.99% הוחלה"). Out-of-range
  // input is refused now, and a very large discount has to be confirmed, so a
  // typo cannot quietly become the price a chain buyer sees.
  const setDiscount = async (c: Collection, pct: number) => {
    if (!Number.isFinite(pct) || pct < 0 || pct > 99.99) {
      setErr("אחוז ההנחה חייב להיות בין 0 ל־99.99.");
      return;
    }
    const d = Math.round(pct * 100) / 100;
    if (d > 50 && !confirm(`הנחה של ${d}% על כל המוצרים בקטלוג "${c.name}" — זה כמעט חינם. להמשיך?`)) return;
    setErr("");
    const { error } = await supabase.from("collections").update({ discount_percent: d }).eq("id", c.id);
    if (error) { setErr("שמירת ההנחה נכשלה."); return; }
    setNotice(d > 0
      ? `הנחה של ${d}% הוחלה על כל המוצרים בקטלוג "${c.name}".`
      : `ההנחה בקטלוג "${c.name}" בוטלה.`);
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
      // Select every column BrowserProduct declares — the rows are typed as
      // that shape, so a short select would leave price/category undefined at
      // runtime while the types claim otherwise.
      .select("sort_order, price_override, products(id,name,sku,price,category,picture_link,rotation_override)")
      .eq("collection_id", collectionId)
      .order("sort_order", { ascending: true });
    if (!mountedRef.current) return;
    if (error) { setMembersBusy(false); setErr("טעינת מוצרי הקטלוג נכשלה."); return; }
    type Joined = { sort_order: number; price_override: number | string | null; products: ProductRow | null };
    const rows = ((data ?? []) as unknown as Joined[]).filter((r): r is Joined & { products: ProductRow } => !!r.products);

    // The manager's GLOBAL per-product prices (price_overrides, user_id null).
    // Without them the "regular price" shown next to the custom-price editor
    // would be the raw Rivhit price — a number the customer never sees when a
    // global override exists, which makes the comparison a lie exactly where
    // the manager is deciding a price. One extra query, members only.
    const ids = rows.map((r) => r.products.id);
    const globs = new Map<string, number>();
    if (ids.length > 0) {
      const { data: po } = await supabase
        .from("price_overrides")
        .select("product_id, price")
        .is("user_id", null)
        .in("product_id", ids);
      for (const o of (po ?? []) as { product_id: string; price: number | string }[]) {
        globs.set(o.product_id, Number(o.price));
      }
    }
    if (!mountedRef.current) return;
    setMembersBusy(false);
    setMembers(rows.map((r) => ({
      ...r.products,
      col_price: r.price_override == null ? null : Number(r.price_override),
      glob_price: globs.get(r.products.id) ?? null,
    })));
  }, []);

  // Closing has to bring the manager back to the collection he was editing.
  // Opening one renders the whole 962-product catalogue with infinite scroll
  // underneath it, so by the time he has picked his products the "סגירת עריכה"
  // button is thousands of pixels above him and there is no way out except
  // scrolling all the way back up. Close now scrolls the card back into view.
  const closeCollection = useCallback((id: string | null) => {
    setOpenId(null);
    setMembers([]);
    if (!id) return;
    // After the panel unmounts, not before — otherwise we scroll to where the
    // card used to be.
    requestAnimationFrame(() => {
      document.getElementById(`col-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      // Move focus with the eye. Whichever control closed the panel — Escape,
      // or the bar at the bottom — has just been unmounted or left behind, and
      // a keyboard user would otherwise land back on <body> and have to tab
      // through the entire page again to reach the card he was editing.
      // preventScroll so this does not fight the smooth scroll above.
      const toggle = document.getElementById(`col-toggle-${id}`) as HTMLButtonElement | null;
      toggle?.focus({ preventScroll: true });
    });
  }, []);

  const openCollection = (c: Collection) => {
    if (openId === c.id) { closeCollection(c.id); return; }
    setOpenId(c.id);
    setMembers([]);
    loadMembers(c.id);
  };

  // Escape is the other way out, and the one a keyboard user reaches for.
  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => {
      // Not while typing in the search box — Escape clears a search field
      // natively and stealing it would be worse than useless.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.key === "Escape") closeCollection(openId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId, closeCollection]);

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
    setMembers((m) => [...m, { ...p, col_price: null, glob_price: null }]);
    // Refresh in the background: the count on the card, and the member's
    // glob_price (the optimistic row above assumes it has none).
    loadCollections();
    loadMembers(openId);
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

  // ---- per-product price in THIS collection --------------------------------
  // One editor at a time: which product's price is being edited, and the raw
  // text as typed. The value is parsed only on save — never clamped or
  // stripped first (D-014: stripping the minus is what turned "-15" into 15).
  //
  // The key is "card:<id>" / "row:<id>", not the bare product id: the same
  // product renders BOTH as a browser card and as a member row, and a bare id
  // opened two identical editors at once — two autofocus inputs mirroring one
  // draft. The editor opens only where the manager clicked.
  const [priceEditId, setPriceEditId] = useState<string | null>(null);
  const [priceDraft, setPriceDraft] = useState("");
  const [priceBusy, setPriceBusy] = useState(false);

  const startPriceEdit = (m: MemberRow, src: "card" | "row") => {
    setPriceEditId(`${src}:${m.id}`);
    setPriceDraft(m.col_price != null ? String(m.col_price) : "");
  };

  const saveColPrice = async (m: MemberRow) => {
    if (!openId || priceBusy) return;
    const raw = priceDraft.trim().replace("٫", ".").replace(",", ".");
    let value: number | null;
    if (raw === "") {
      // Empty means "back to the regular price" — the one deliberate way to
      // clear an override, so a typo cannot do it by accident.
      value = null;
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n)) { setErr("מחיר לא תקין — מספר בלבד, למשל 12.90"); return; }
      if (n <= 0) { setErr("מחיר מותאם חייב להיות גדול מאפס. כדי לחזור למחיר הרגיל — משאירים ריק ושומרים."); return; }
      if (n > 999999) { setErr("המחיר גבוה מדי."); return; }
      value = Math.round(n * 100) / 100; // agorot, like every price in the system
      const list = m.glob_price ?? m.price;
      // A price under a tenth of the regular one is almost always a missing
      // digit (1.29 for 12.90). Confirm with both numbers in the question.
      if (list > 0 && value < list * 0.1 &&
          !window.confirm(`המחיר שהוקלד — ₪${value.toLocaleString("he-IL")} — נמוך מעשירית מהמחיר הרגיל (₪${list.toLocaleString("he-IL")}). לקבוע אותו בכל זאת?`)) {
        return;
      }
    }
    setPriceBusy(true);
    // .select() so we can tell "saved" from "matched no row" (product removed
    // from the collection in another tab): PostgREST reports both as success.
    const { data, error } = await supabase
      .from("collection_products")
      .update({ price_override: value })
      .eq("collection_id", openId)
      .eq("product_id", m.id)
      .select("product_id");
    if (!mountedRef.current) return;
    setPriceBusy(false);
    if (error || !data || data.length === 0) {
      setErr("שמירת המחיר נכשלה — המחיר הקודם נשאר כפי שהיה.");
      return;
    }
    setErr("");
    setMembers((ms) => ms.map((x) => (x.id === m.id ? { ...x, col_price: value } : x)));
    setPriceEditId(null);
    setNotice(value == null
      ? `"${m.name}" חזר למחיר הרגיל.`
      : `נקבע מחיר ₪${value.toLocaleString("he-IL")} ל"${m.name}" בקטלוג הזה בלבד.`);
  };

  // The collection the bottom bar is describing (null when nothing is open).
  const openCollectionRow = openId ? collections.find((c) => c.id === openId) ?? null : null;

  if (loading || !isManager) return null;

  const memberIds = new Set(members.map((m) => m.id));
  const membersById = new Map(members.map((m) => [m.id, m]));

  // What the customer opening THIS link will pay for a member product —
  // the same chain the catalog_collection RPC computes, kept in one place so
  // the number the manager sees while pricing is the number the link shows.
  const effectivePrice = (m: MemberRow): number => {
    if (m.col_price != null) return m.col_price;
    const list = m.glob_price ?? m.price;
    const d = Number(openCollectionRow?.discount_percent) || 0;
    if (d <= 0) return list;
    return Math.max(list > 0 ? 0.01 : 0, Math.round(list * (100 - d)) / 100);
  };

  const priceEditor = (m: MemberRow) => (
    <div style={{ display: "grid", gap: "0.3rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
        <input
          autoFocus
          dir="ltr"
          inputMode="decimal"
          aria-label={`מחיר מותאם ל${m.name}`}
          placeholder={`₪${(m.glob_price ?? m.price).toLocaleString("he-IL")}`}
          value={priceDraft}
          onChange={(e) => setPriceDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); saveColPrice(m); }
            // Escape closes the editor, not the whole collection — the page
            // handler already ignores keys typed inside inputs.
            if (e.key === "Escape") setPriceEditId(null);
          }}
          style={{ width: 84, fontFamily: tokens.assistant, fontSize: "0.9rem", padding: "0.4rem 0.5rem", borderRadius: 8, border: `1px solid ${tokens.border}`, background: tokens.surface, color: tokens.text }}
        />
        <button onClick={() => saveColPrice(m)} disabled={priceBusy} style={{ ...miniBtn, background: "#1A7A4D", color: "#fff", border: "none", opacity: priceBusy ? 0.6 : 1 }}>
          {priceBusy ? "שומר…" : "שמירה"}
        </button>
        <button onClick={() => setPriceEditId(null)} style={miniBtn}>ביטול</button>
      </div>
      <span style={{ fontFamily: tokens.assistant, fontSize: "0.72rem", color: tokens.dim }}>
        ריק = חזרה למחיר הרגיל
        {Number(openCollectionRow?.discount_percent) > 0 ? " · מחיר מותאם הוא סופי — הנחת הקטלוג לא חלה עליו" : ""}
      </span>
      {openCollectionRow && !openCollectionRow.show_prices && (
        <span style={{ fontFamily: tokens.assistant, fontSize: "0.72rem", color: "#C0143C" }}>
          ⚠ הקישור מוגדר בלי מחירים — המחיר ייראה רק אם מדליקים ״להציג מחירים״.
        </span>
      )}
    </div>
  );

  // One line of truth about a member's price: the custom one when set, the
  // regular one (after the collection discount) when not.
  const priceLine = (m: MemberRow) => (
    m.col_price != null ? (
      <span style={{ fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.8rem", color: "#1A7A4D" }}>
        ₪{m.col_price.toLocaleString("he-IL")} · מחיר מותאם
      </span>
    ) : (
      <span style={{ fontFamily: tokens.assistant, fontSize: "0.78rem", color: tokens.dim }}>
        ₪{effectivePrice(m).toLocaleString("he-IL")}
        {Number(openCollectionRow?.discount_percent) > 0 ? ` (אחרי הנחת ${Number(openCollectionRow?.discount_percent)}%)` : ""}
      </span>
    )
  );

  return (
    <>
      <SiteHeader />
      <main
        id="main-content"
        tabIndex={-1}
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          // Extra room at the bottom while the fixed back bar is up, so it
          // never covers the last row of the product list.
          padding: `clamp(1.25rem,4vw,2.5rem) clamp(1rem,4vw,2.5rem) ${openId ? "9rem" : "5rem"}`,
        }}
      >
        {/* The way back, always on screen.
            While a collection is open the page below it is the entire 962-product
            catalogue with infinite scroll, so every control at the top of the card
            — including "סגירת עריכה" — is unreachable without scrolling back up
            past everything just added. This bar is fixed to the bottom of the
            viewport for exactly as long as a collection is open, and it doubles as
            the live count, which otherwise also lives far below the fold.

            It is rendered HERE, at the top of <main>, and not next to the footer
            where it visually sits. Being position:fixed the DOM position costs
            nothing visually, but it decides two things that are not free: the bar
            was tab stop 63 of 69, behind every product card in the catalogue, and
            it sat outside every landmark, so a screen-reader user browsing by
            region never reached it at all. */}
        {openCollectionRow && (
          <div
            role="region"
            aria-label="הקטלוג שנערך כרגע"
            style={{
              position: "fixed", insetInline: 0, bottom: 0, zIndex: 90,
              background: "rgba(255,255,255,0.97)", backdropFilter: "blur(8px)",
              borderTop: `1px solid ${tokens.border}`,
              boxShadow: "0 -6px 20px rgba(20,16,32,0.10)",
              padding: "0.7rem clamp(1rem,4vw,2.5rem)",
              paddingBottom: "max(0.7rem, env(safe-area-inset-bottom))",
              display: "flex", alignItems: "center", gap: "0.8rem", flexWrap: "wrap",
            }}
          >
            <div style={{ flex: 1, minWidth: 150 }}>
              <div style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "0.95rem", color: tokens.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {openCollectionRow.name}
              </div>
              <div style={{ fontFamily: tokens.assistant, fontSize: "0.82rem", color: tokens.dim }}>
                {membersBusy
                  ? "טוען…"
                  : `${members.length.toLocaleString("he-IL")} מוצרים בקטלוג`}
              </div>
            </div>
            <button
              onClick={() => closeCollection(openId)}
              style={{
                fontFamily: tokens.rubik, fontWeight: 800, fontSize: "0.9rem",
                color: "#fff", background: tokens.accent, border: "none",
                padding: "0.7rem 1.2rem", borderRadius: 999, cursor: "pointer",
                minHeight: 44, whiteSpace: "nowrap",
              }}
            >
              סיום ← חזרה לרשימה
            </button>
          </div>
        )}

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
          <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", minHeight: 44, fontFamily: tokens.assistant, fontSize: "0.9rem", color: tokens.body, cursor: "pointer" }}>
            {/* The default checkbox renders 13x13 — half the WCAG 2.2 AA minimum.
                The label is clickable too, but the box is what a finger aims at. */}
            <input type="checkbox" checked={newPrices} onChange={(e) => setNewPrices(e.target.checked)} style={{ width: 24, height: 24, accentColor: tokens.accent, cursor: "pointer" }} />
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
              // minWidth: 0 — a grid item defaults to min-width:auto and will not
              // shrink below the min-content width of what is inside it. What is
              // inside here, once the editor opens, is the whole product browser.
              <div key={c.id} id={`col-${c.id}`} style={{ minWidth: 0, border: `1px solid ${openId === c.id ? tokens.accent : tokens.border}`, borderRadius: 16, background: "#fff", padding: "1rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.8rem", flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.05rem", color: tokens.text }}>
                      {c.name}
                      {!c.is_active && <span style={{ fontFamily: tokens.assistant, fontWeight: 400, fontSize: "0.8rem", color: "#C0143C" }}> · כבוי</span>}
                    </div>
                    <div style={{ fontFamily: tokens.assistant, fontSize: "0.82rem", color: tokens.dim }}>
                      {(c.n ?? 0).toLocaleString("he-IL")} מוצרים · {c.show_prices ? "עם מחירים" : "בלי מחירים"}
                      {Number(c.discount_percent) > 0 ? ` · הנחה ${Number(c.discount_percent)}% על הכל` : ""}
                    </div>
                  </div>
                  <button onClick={() => copyLink(c)} style={miniBtn}>📋 העתקת קישור</button>
                  <button onClick={() => togglePrices(c)} style={miniBtn}>{c.show_prices ? "להסתיר מחירים" : "להציג מחירים"}</button>
                  <button onClick={() => toggleActive(c)} style={{ ...miniBtn, color: c.is_active ? "#C0143C" : "#1A7A4D" }}>
                    {c.is_active ? "כיבוי הקישור" : "הפעלת הקישור"}
                  </button>
                  <button id={`col-toggle-${c.id}`} onClick={() => openCollection(c)} aria-expanded={openId === c.id} aria-controls={openId === c.id ? `col-editor-${c.id}` : undefined} style={{ ...miniBtn, background: openId === c.id ? tokens.accent : "#fff", color: openId === c.id ? "#fff" : tokens.text }}>
                    {openId === c.id ? "סגירת עריכה" : "עריכת מוצרים"}
                  </button>
                </div>

                {/* One-click discount on the whole catalogue. Applies to every
                    product in it, including ones added later. Only meaningful
                    when the link shows prices at all. */}
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.7rem", paddingTop: "0.7rem", borderTop: `1px dashed ${tokens.border}` }}>
                  <span style={{ fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.85rem", color: tokens.text }}>הנחה על כל הקטלוג:</span>
                  {[10, 20, 30, 40, 50].map((pct) => (
                    <button
                      key={pct}
                      onClick={() => setDiscount(c, pct)}
                      aria-pressed={Number(c.discount_percent) === pct}
                      style={{
                        ...miniBtn,
                        background: Number(c.discount_percent) === pct ? "#1A7A4D" : "#fff",
                        color: Number(c.discount_percent) === pct ? "#fff" : tokens.text,
                        border: `1px solid ${Number(c.discount_percent) === pct ? "transparent" : tokens.border}`,
                      }}
                    >
                      {pct}%
                    </button>
                  ))}
                  <label style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                    <span style={{ fontFamily: tokens.assistant, fontSize: "0.8rem", color: tokens.dim }}>אחר:</span>
                    <input
                      aria-label={`אחוז הנחה מותאם לקטלוג ${c.name}`}
                      defaultValue={Number(c.discount_percent) || ""}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        // Do NOT strip characters before parsing: stripping the
                        // minus is what turned "-15" into a 15% discount. Take
                        // the value as typed and let setDiscount refuse it.
                        const raw = (e.target as HTMLInputElement).value.trim().replace("٫", ".").replace(",", ".");
                        if (raw === "") { setDiscount(c, 0); return; }
                        setDiscount(c, Number(raw));
                      }}
                      inputMode="decimal"
                      placeholder="%"
                      style={{ width: 62, fontFamily: tokens.assistant, fontSize: "0.85rem", padding: "0.3rem 0.5rem", borderRadius: 8, border: `1px solid ${tokens.border}`, background: tokens.surface, color: tokens.text }}
                    />
                  </label>
                  {Number(c.discount_percent) > 0 && (
                    <button onClick={() => setDiscount(c, 0)} style={{ ...miniBtn, color: "#C0143C" }}>ביטול ההנחה</button>
                  )}
                  {!c.show_prices && Number(c.discount_percent) > 0 && (
                    <span style={{ fontFamily: tokens.assistant, fontSize: "0.78rem", color: "#C0143C" }}>
                      ⚠ הקישור מוגדר בלי מחירים — ההנחה לא תיראה עד שמדליקים ״להציג מחירים״.
                    </span>
                  )}
                </div>

                {openId === c.id && (
                  <div
                    id={`col-editor-${c.id}`}
                    role="group"
                    aria-label={`עריכת המוצרים בקטלוג ${c.name}`}
                    style={{ borderTop: `1px solid ${tokens.border}`, marginTop: "0.9rem", paddingTop: "0.9rem" }}
                  >
                    {/* The whole catalogue, shown immediately — same grid,
                        categories, search and infinite scroll the customer
                        sees. Cards already in this collection are outlined and
                        offer הסרה instead of הוספה. */}
                    {/* No stickyTop override. It used to be 0, which pinned the
                        search box and the category chips to the very top of the
                        viewport — underneath the site header, which is fixed,
                        opaque and z-50 against the browser's z-40. The moment
                        the manager scrolled, the only way to find one product
                        among 962 was covered and stopped taking clicks. The
                        component's default already offsets by the real header
                        height. */}
                    <AdminProductBrowser
                      searchLabel="חיפוש מוצר להוספה (שם / קוד / ברקוד)"
                      highlight={(p) => memberIds.has(p.id)}
                      renderAction={(p) => {
                        const mem = membersById.get(p.id);
                        if (!mem) {
                          return (
                            <button
                              onClick={() => addProduct(p)}
                              style={{ marginTop: "auto", width: "100%", fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.85rem", cursor: "pointer", border: "none", padding: "0.55rem 0.9rem", borderRadius: 12, color: "#fff", background: "#1A7A4D" }}
                            >
                              + הוספה לקטלוג
                            </button>
                          );
                        }
                        // In the collection: the price this link will show,
                        // a way to change it, and a way out.
                        return (
                          <div style={{ marginTop: "auto", display: "grid", gap: "0.35rem" }}>
                            {priceEditId === `card:${p.id}` ? priceEditor(mem) : (
                              <>
                                {priceLine(mem)}
                                <div style={{ display: "flex", gap: "0.35rem" }}>
                                  <button
                                    onClick={() => startPriceEdit(mem, "card")}
                                    style={{ flex: 1, fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.8rem", cursor: "pointer", border: `1px solid ${tokens.border}`, padding: "0.5rem 0.4rem", borderRadius: 12, color: tokens.text, background: "#fff", minHeight: 40 }}
                                  >
                                    ₪ שינוי מחיר
                                  </button>
                                  <button
                                    onClick={() => removeProduct(p)}
                                    aria-label={`הסרת ${p.name} מהקטלוג`}
                                    style={{ flex: 1, fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.8rem", cursor: "pointer", border: "none", padding: "0.5rem 0.4rem", borderRadius: 12, color: "#fff", background: "#C0143C", minHeight: 40 }}
                                  >
                                    הסרה
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        );
                      }}
                    />

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
                          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", border: `1px solid ${p.col_price != null ? "#1A7A4D" : tokens.border}`, borderRadius: 10, padding: "0.35rem 0.5rem" }}>
                            <div style={{ width: 36, height: 36, flexShrink: 0, borderRadius: 8, border: `1px solid ${tokens.border}`, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", background: "#fff" }}>
                              <ProductImage pictureLink={p.picture_link} name={p.name} width={480} rotation={p.rotation_override ?? 0} imgStyle={{ width: "100%", height: "100%", objectFit: "contain" }} />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontFamily: tokens.assistant, fontSize: "0.8rem", color: tokens.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                              {priceEditId !== `row:${p.id}` && priceLine(p)}
                            </div>
                            {priceEditId === `row:${p.id}` ? priceEditor(p) : (
                              <button onClick={() => startPriceEdit(p, "row")} aria-label={`שינוי מחיר ל${p.name} בקטלוג`} title="שינוי מחיר בקטלוג הזה" style={{ ...miniBtn, padding: "0.25rem 0.5rem", minHeight: 32 }}>₪</button>
                            )}
                            <button onClick={() => removeProduct(p)} aria-label={`הסרת ${p.name} מהקטלוג`} style={{ ...miniBtn, padding: "0.25rem 0.5rem", minHeight: 32, color: "#C0143C" }}>✕</button>
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

      {/* The fixed bar sits over whatever is at the bottom of the viewport, and
          at the bottom of the DOCUMENT that is the footer — so while a
          collection was open the bar covered the phone number and the copyright
          and they could not be reached at all. main's own 9rem reserve does not
          help here because the footer comes after main. Reserve the same room
          under the footer for exactly as long as the bar exists. */}
      <div style={{ paddingBottom: openId ? "9rem" : 0 }}>
        <SiteFooter />
      </div>
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
