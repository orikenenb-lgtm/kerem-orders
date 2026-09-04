"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SiteHeader from "../components/SiteHeader";
import SiteFooter from "../components/SiteFooter";
import ProductImage from "../components/ProductImage";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../lib/auth";
import { tokens, ils, discountPct, disabledBtn } from "../../lib/ui";
import { buildPriceMap, resolvePrice, hasSpecialPrice, type PriceMap, type PriceOverrideRow } from "../../lib/pricing";
import { featureFlags } from "../../lib/featureFlags";
import { VAT_RATE, MIN_ORDER_FALLBACK } from "../../lib/config";
import { resolveQuantity, stepOf, describeQuantity, pluralPack } from "../../lib/quantity";
import { orderExactFirst, sanitizeQuery } from "../../lib/searchRank";
import { readCart } from "../../lib/cart";

type Product = {
  id: string;
  name: string;
  price: number;
  sku: string | null;
  barcode: string;
  picture_link: string;
  stock_quantity: number;
  rank?: number;
  total?: number;
  // Manual clockwise rotation override (0/90/180/270) for photos crooked
  // without EXIF. Nullable.
  rotation_override?: number | null;
  // Wave 3 quantity-model columns (ff_display_quantities). search_products now
  // returns these alongside the browse query, so a product found by search and
  // the same product found by browsing step, price and add identically. They
  // stay optional only because the type is shared with older cart lines.
  //
  // They were NOT returned before, and that was a real money bug: 382 of 962
  // active products are sold by the pack, and without display_qty the client
  // read every search result as a single unit — same product, two prices, and
  // a quantity silently rewritten at the last click.
  unit_name?: string | null;
  display_qty?: number | null;
  display_name?: string | null;
  carton_qty?: number | null;
  min_order_qty?: number | null;
  order_step?: number | null;
  sell_by?: string | null;
};
type CartLine = {
  qty: number; name: string; price: number; sku: string | null; picture_link: string;
  // Wave 3 (ff_display_quantities): pack info persisted with the line so the
  // cart drawer can describe/step display-sold products. Optional so carts
  // saved before the flag keep working — missing means a unit product.
  display_qty?: number | null;
  display_name?: string | null;
};
type Cart = Record<string, CartLine>;

const CART_KEY = "kt_cart_v2";
const PAGE_SIZE = 24;
const ffQty = featureFlags.ff_display_quantities;
// Wave 5: minimum-order progress bar + VAT breakdown in the cart drawer.
const ffMinVat = featureFlags.ff_min_order_vat_ui;
// 3B wave 1: redesigned product card (neutral frame, 2-line name, barcode||sku).
// Off = byte-identical to the previous card.
const ffCardV2 = featureFlags.ff_card_v2;
// 3B wave 2: at-a-glance "in cart" state (corner badge + green ring).
const ffCardIncart = featureFlags.ff_card_incart;
// 3B wave 3: price-bucket filter (browse mode only — PostgREST gte/lt on price,
// no RPC/DB change). Off = the control never renders and the query is unchanged.
const ffFilters = featureFlags.ff_filters_v2;
// Buckets straight from the live price histogram (median ₪13, 84% under ₪50).
// lo is inclusive, hi exclusive, so the ranges partition the catalogue with no
// product counted twice.
const PRICE_BUCKETS: { key: string; label: string; lo?: number; hi?: number }[] = [
  { key: "all", label: "כל המחירים" },
  { key: "u5", label: "עד ₪5", hi: 5 },
  { key: "5-10", label: "₪5–10", lo: 5, hi: 10 },
  { key: "10-20", label: "₪10–20", lo: 10, hi: 20 },
  { key: "20-50", label: "₪20–50", lo: 20, hi: 50 },
  { key: "50-100", label: "₪50–100", lo: 50, hi: 100 },
  { key: "100+", label: "₪100+", lo: 100 },
];
// 3B wave 4: clearer cart lines (per-line total + explicit remove). Drawer
// presentation only — the submit/reconcile path is untouched.
const ffCartV2 = featureFlags.ff_cart_v2;
// 3B wave 5: mobile polish (safe-area, search keyboard, skeletons) and CSS-only
// micro-motion. globals.css already kills all motion under prefers-reduced-motion.
const ffMobile = featureFlags.ff_mobile_polish;
const ffMotion = featureFlags.ff_micro_motion;
// 3B wave 6: collapse the 24-chip category row to the 6 largest + an "עוד" toggle.
const ffCatSheet = featureFlags.ff_category_sheet;
const CAT_CHIPS_COLLAPSED = 6;

// Wave 3: rebuild a quantity-model view of a stored cart line. Only
// display_qty/display_name are persisted; min_order_qty/order_step are not —
// the checkout reconcile re-normalizes against the fresh DB row anyway.
function lineQtyProduct(l: CartLine) {
  const dq = Math.floor(Number(l.display_qty) || 0);
  return {
    price: l.price,
    display_qty: dq > 1 ? dq : null,
    display_name: l.display_name ?? null,
    sell_by: dq > 1 ? "display" : "unit",
  };
}

// Extract the carton (wholesale pack) quantity embedded in the product name,
// as the wholesaler writes it: "קרטון 864" / "ק 216" / "144 יח".
function cartonSize(name: string): number | null {
  const n = name || "";
  const m =
    n.match(/קרטון\s*(\d+)/) ||
    n.match(/(?:^|[\s/])ק\s+(\d+)/) ||
    n.match(/(\d+)\s*יח/);
  if (!m) return null;
  const v = parseInt(m[1], 10);
  return Number.isFinite(v) && v >= 2 && v <= 10000 ? v : null;
}

export default function CatalogPage() {
  const router = useRouter();
  const { session, profile, loading, refreshProfile } = useAuth();

  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [loadErr, setLoadErr] = useState(false);
  const [categories, setCategories] = useState<{ category: string; n: number }[]>([]);
  const [activeCat, setActiveCat] = useState("all");
  const [sort, setSort] = useState<"name" | "price_asc" | "price_desc">("name");
  // 3B wave 3: selected price bucket key (see PRICE_BUCKETS). "all" = no filter.
  const [priceBucket, setPriceBucket] = useState("all");

  const [cart, setCart] = useState<Cart>({});
  const [note, setNote] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [placed, setPlaced] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [cartOpen, setCartOpen] = useState(false);
  const [minOrder, setMinOrder] = useState(MIN_ORDER_FALLBACK);
  const [vatLabel, setVatLabel] = useState(true);

  // The customer's fixed discount (0 when none / column not present yet).
  // ONE derived value drives display, cart storage and checkout reconcile.
  const discount = discountPct(profile?.discount_percent);

  // Manager-set prices (for everyone / for this customer). RLS returns only
  // the global rows and this customer's own, so the map is safe to hold in the
  // browser. Null until loaded — resolvePrice then falls back to list price.
  const [priceMap, setPriceMap] = useState<PriceMap | null>(null);
  useEffect(() => {
    if (!session) return;
    supabase
      .from("price_overrides")
      .select("product_id,user_id,price")
      .then(({ data }) => {
        setPriceMap(buildPriceMap((data as PriceOverrideRow[]) ?? [], session.user.id));
      });
  }, [session]);

  // ONE place decides what a product costs this customer; every price shown,
  // stored in the cart and re-checked at checkout goes through these.
  const unitPrice = useCallback(
    (p: { id: string; price: number }) => resolvePrice(p.id, p.price, priceMap, discount),
    [priceMap, discount]
  );
  /** List price before the fixed discount (honours a global override). */
  const listPrice = useCallback(
    (p: { id: string; price: number }) => priceMap?.get(p.id)?.all ?? (Number(p.price) || 0),
    [priceMap]
  );
  const isSpecial = useCallback(
    (p: { id: string }) => hasSpecialPrice(p.id, priceMap),
    [priceMap]
  );

  // site settings: minimum-order threshold + whether to show the VAT label
  // (prices_include_vat defaults to on; set the row to 'false' to hide).
  useEffect(() => {
    if (!session) return;
    supabase
      .from("site_settings")
      .select("key,value")
      .in("key", ["min_order_total", "prices_include_vat"])
      .then(({ data }) => {
        const rows = (data ?? []) as { key: string; value: string }[];
        // Fail CLOSED. This used to be `|| 0`, and every guard downstream reads
        // `minOrder > 0 && …` — so a failed or slow settings read silently removed
        // the minimum entirely: no warning, no progress bar, and an enabled submit
        // button on a ₪50 cart that the database would then reject.
        const n = Number(rows.find((r) => r.key === "min_order_total")?.value);
        setMinOrder(Number.isFinite(n) && n > 0 ? n : MIN_ORDER_FALLBACK);
        const vat = rows.find((r) => r.key === "prices_include_vat")?.value;
        setVatLabel(vat === undefined || vat === "true" || vat === "1");
      });
  }, [session]);

  useEffect(() => {
    if (!loading && !session) router.replace("/login");
  }, [loading, session, router]);

  // cart persistence
  useEffect(() => {
    setCart(readCart<CartLine>(localStorage.getItem(CART_KEY)));
  }, []);
  useEffect(() => {
    try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch { /* */ }
  }, [cart]);

  useEffect(() => {
    if (profile) {
      setContactName((v) => v || profile.full_name || "");
      setContactPhone((v) => v || profile.phone || "");
    }
  }, [profile]);

  // load category list once
  useEffect(() => {
    if (!session) return;
    supabase.rpc("catalog_categories").then(({ data }) => {
      setCategories((data as { category: string; n: number }[]) ?? []);
    });
  }, [session]);

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

  // reset to first page when switching category, sort, or price bucket
  useEffect(() => { filterGen.current++; setPage(0); }, [activeCat, sort, priceBucket]);

  const loadSeq = useRef(0);
  const [fuzzyNote, setFuzzyNote] = useState(false);
  // A short page (fewer than PAGE_SIZE rows) means the data is exhausted, even
  // when dedup/count drift leaves products.length below total — without this
  // the observer would keep requesting empty pages forever.
  const [endReached, setEndReached] = useState(false);

  // Infinite scroll: page 0 replaces the grid, later pages append (deduped by
  // id, so an item shifting between DB pages can never render twice).
  const applyRows = (rows: Product[], append: boolean) => {
    setProducts((prev) => {
      if (!append) return rows;
      const seen = new Set(prev.map((p) => p.id));
      return [...prev, ...rows.filter((r) => !seen.has(r.id))];
    });
  };

  const loadProducts = useCallback(async () => {
    if (!session) return;
    const seq = ++loadSeq.current;
    const gen = filterGen.current;
    setLoadingProducts(true);
    if (page === 0) setFuzzyNote(false);
    const s = sanitizeQuery(query);
    if (s.length >= 2) {
      // smart typo-tolerant search (trigram-ranked in the database)
      const { data, error: rpcErr } = await supabase.rpc("search_products", {
        q: s,
        lim: PAGE_SIZE,
        off: page * PAGE_SIZE,
      });
      if (seq !== loadSeq.current) return;
      if (rpcErr) {
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
      const rows = orderExactFirst(((data as Product[]) ?? []), s);
      applyRows(rows, page > 0);
      gridGen.current = gen;
      setEndReached(rows.length < PAGE_SIZE);
      // An empty overflow page carries no window count — keep the known total.
      if (page === 0 || rows.length > 0) setTotal(Number(rows[0]?.total ?? 0));
      // no exact match but similar ones found → "did you mean" mode
      // (rank comes from the RPC row set — unaffected by the client re-order).
      if (page === 0) setFuzzyNote(rows.length > 0 && !rows.some((r) => (r.rank ?? 0) >= 0.55));
      setLoadingProducts(false);
      return;
    }
    let q = supabase
      .from("products")
      .select("id,name,price,sku,barcode,picture_link,stock_quantity,rotation_override,unit_name,display_qty,display_name,carton_qty,min_order_qty,order_step,sell_by", { count: "exact" })
      .eq("is_active", true);
    if (activeCat !== "all") q = q.eq("category", activeCat);
    // 3B wave 3: price bucket (browse mode only). Flag off or bucket "all" leaves
    // the query byte-identical to before.
    if (ffFilters && priceBucket !== "all") {
      const b = PRICE_BUCKETS.find((x) => x.key === priceBucket);
      if (b?.lo !== undefined) q = q.gte("price", b.lo);
      if (b?.hi !== undefined) q = q.lt("price", b.hi);
    }
    if (s) q = q.or(`name.ilike.%${s}%,sku.ilike.%${s}%,barcode.ilike.%${s}%`);
    // Browse-mode sorting. Price sorts add a name tiebreak so paging is stable
    // (equal prices keep a deterministic order across pages).
    const sorted =
      sort === "price_asc"
        ? q.order("price", { ascending: true }).order("name", { ascending: true })
        : sort === "price_desc"
        ? q.order("price", { ascending: false }).order("name", { ascending: true })
        : q.order("name", { ascending: true });
    const { data, count, error: qErr } = await sorted
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    // A newer request superseded this one (fast typing / category hopping) —
    // drop the stale result so the grid never shows the wrong page.
    if (seq !== loadSeq.current) return;
    if (qErr) {
      // A failed fetch is not "לא נמצאו מוצרים" — keep what's shown and offer a retry.
      setLoadErr(true);
      setLoadingProducts(false);
      return;
    }
    if (page > 0 && gen !== gridGen.current) { setPage(0); return; }
    setLoadErr(false);
    const rows = (data as Product[]) ?? [];
    applyRows(rows, page > 0);
    gridGen.current = gen;
    setEndReached(rows.length < PAGE_SIZE);
    setTotal(count ?? 0);
    setLoadingProducts(false);
  }, [session, query, page, activeCat, sort, priceBucket]);

  useEffect(() => { loadProducts(); }, [loadProducts]);

  // A11y for the cart drawer — the same dialog pattern the public catalogs'
  // ProductPreview already follows: Escape closes, Tab cycles inside the
  // drawer only, the page behind is scroll-locked, focus lands on the close
  // button when it opens and returns to the floating cart button on close.
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const cartCloseRef = useRef<HTMLButtonElement | null>(null);
  const cartOpenerRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!cartOpen) return;
    cartCloseRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setCartOpen(false);
        return;
      }
      if (e.key === "Tab" && drawerRef.current) {
        const focusables = drawerRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled])'
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
        } else if (!drawerRef.current.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      // The floating cart button unmounts while the drawer is open and only
      // remounts after this cleanup — hand focus back on the next tick, once
      // the fresh button is in the DOM. No-op when it isn't (e.g. order sent).
      // Reading the ref LATE is the point here: the usual "copy ref.current
      // into the effect" fix would capture the unmounted node.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      setTimeout(() => cartOpenerRef.current?.focus(), 0);
    };
  }, [cartOpen]);

  // Auto-load the next page when the sentinel under the grid scrolls into
  // view, so customers see everything just by scrolling — no page buttons.
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

  // Wave 3: transient "we rounded your quantity" note per product card
  // (product id → Hebrew message). Set/cleared on every setQty when the flag
  // is on; only display-sold products get a note.
  const [qtyNotes, setQtyNotes] = useState<Record<string, string>>({});

  const setQty = (p: Product, qty: number) => {
    // Wave 3: when the flag is on EVERY path into the cart goes through the
    // shared resolver — add button, stepper, carton button, typed input — so
    // the stored quantity is always step-aligned. Cap BEFORE resolving so the
    // cap can never break step alignment.
    let q = qty;
    if (ffQty) {
      const r = resolveQuantity(p, Math.min(qty, 9999));
      q = r.units;
      const dq = Math.floor(Number(p.display_qty) || 0);
      const packName = (p.display_name || "מארז").trim() || "מארז";
      setQtyNotes((notes) => {
        const show = r.wasAdjusted && q > 0 && dq > 1;
        if (!show && !(p.id in notes)) return notes;
        const next = { ...notes };
        if (show) next[p.id] = `עיגלנו ל־${q.toLocaleString("he-IL")} יחידות (${describeQuantity(p, q)}) — המוצר נמכר ב${pluralPack(packName, 2)} שלמים`;
        else delete next[p.id];
        return next;
      });
    }
    setCart((c) => {
      const next = { ...c };
      if (q <= 0) delete next[p.id];
      // The cart stores the price the customer actually pays — a manager-set
      // price for them, else a global price, else the list price after their
      // fixed discount (unitPrice decides; same rule as the DB trigger).
      // Flag on: q is already resolved (and capped pre-resolve), so no second
      // cap — it could knock the quantity off its step.
      else next[p.id] = {
        qty: ffQty ? q : Math.min(q, 9999),
        name: p.name, price: unitPrice(p), sku: p.sku, picture_link: p.picture_link,
        ...(ffQty ? { display_qty: p.display_qty ?? null, display_name: p.display_name ?? null } : {}),
      };
      return next;
    });
  };

  const lines = useMemo(
    () => Object.entries(cart).map(([id, v]) => ({ id, ...v })),
    [cart]
  );
  const cartTotal = useMemo(() => lines.reduce((s, l) => s + l.price * l.qty, 0), [lines]);
  const itemCount = useMemo(() => lines.reduce((s, l) => s + l.qty, 0), [lines]);

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

  // Wave 6 (ff_category_sheet): 24 chips do not fit a phone. Collapsed shows the
  // 6 largest — plus the selected one if it fell outside that slice, so the
  // active filter is never hidden from the person who set it.
  const [catsExpanded, setCatsExpanded] = useState(false);
  const visibleCats = useMemo(() => {
    if (!ffCatSheet || catsExpanded) return orderedCats;
    const top = orderedCats.slice(0, CAT_CHIPS_COLLAPSED);
    if (activeCat !== "all" && !top.some((c) => c.category === activeCat)) {
      const sel = orderedCats.find((c) => c.category === activeCat);
      if (sel) return [...top, sel];
    }
    return top;
  }, [orderedCats, catsExpanded, activeCat]);
  const hiddenCats = orderedCats.length - visibleCats.length;

  const placeOrder = async () => {
    if (!session || lines.length === 0 || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      // Use the freshest discount straight from the DB for THIS order — a
      // discount granted or changed mid-session must not be missed. On any
      // failure we keep the session value (fail-safe: worst case is the
      // discount the customer already sees).
      let d = discount;
      try {
        const { data: prow } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", session.user.id)
          .maybeSingle();
        if (prow) d = discountPct((prow as { discount_percent?: number | null }).discount_percent);
      } catch { /* keep session value */ }
      if (d !== discount) refreshProfile().catch(() => {});
      // Re-read the manager-set prices too, for the same reason the discount is
      // re-read: one that changed mid-session must be caught HERE, where the
      // customer is asked to confirm, rather than by the DB trigger rejecting
      // the order with a raw "price mismatch".
      let freshMap = priceMap;
      try {
        const { data: pov } = await supabase
          .from("price_overrides")
          .select("product_id,user_id,price");
        freshMap = buildPriceMap((pov as PriceOverrideRow[]) ?? [], session.user.id);
        setPriceMap(freshMap);
      } catch { /* keep the map already loaded */ }
      // Reconcile the cart against the DB (the single source of truth) before
      // ordering: drop sold-out items and refresh changed prices IN THE CART.
      // If anything changed, update the cart and ask the customer to review and
      // confirm again — so an order is never placed on a stale/tampered price or
      // on an unavailable item, and the total shown always matches what is sent.
      const ids = lines.map((l) => l.id);
      // Fetch in chunks of 100 so even a huge cart never builds a query string
      // longer than the gateway allows.
      type FreshRow = {
        id: string; name: string; price: number; is_active: boolean;
        unit_name?: string | null; display_qty?: number | null; display_name?: string | null;
        carton_qty?: number | null; min_order_qty?: number | null; order_step?: number | null; sell_by?: string | null;
      };
      const byId = new Map<string, FreshRow>();
      for (let i = 0; i < ids.length; i += 100) {
        const { data: fresh, error: pErr } = await supabase
          .from("products")
          .select("id,name,price,is_active,unit_name,display_qty,display_name,carton_qty,min_order_qty,order_step,sell_by")
          .in("id", ids.slice(i, i + 100));
        if (pErr) throw pErr;
        for (const p of (fresh ?? []) as FreshRow[]) {
          byId.set(p.id, p);
        }
      }
      const removed: string[] = [];
      let priceChanged = false;
      // Wave 3: quantities are re-normalized against the FRESH row (pack sizes
      // may have changed since the line was added) — a changed quantity blocks
      // the order the same way a changed price does.
      let qtyChanged = false;
      const reconciled: Cart = {};
      for (const l of lines) {
        const p = byId.get(l.id);
        if (!p || p.is_active === false) { removed.push(l.name); continue; }
        // CRITICAL: resolve the price the SAME way as at add-to-cart time
        // (resolvePrice is shared), otherwise every discounted customer — and
        // now every customer with a manager-set price — would hit a false
        // "price changed" and have the cart rewritten to full price.
        const freshPrice = resolvePrice(p.id, Number(p.price) || 0, freshMap, d);
        if (Math.abs(freshPrice - (Number(l.price) || 0)) > 0.001) priceChanged = true;
        let qty = l.qty;
        if (ffQty) {
          const r = resolveQuantity(p, l.qty);
          if (r.units !== l.qty) qtyChanged = true;
          qty = r.units;
        }
        reconciled[l.id] = {
          qty, name: p.name ?? l.name, price: freshPrice, sku: l.sku, picture_link: l.picture_link,
          ...(ffQty ? { display_qty: p.display_qty ?? null, display_name: p.display_name ?? null } : {}),
        };
      }
      if (removed.length > 0 || priceChanged || qtyChanged) {
        setCart(reconciled);
        setError(
          removed.length > 0
            ? `חלק מהמוצרים אזלו והוסרו מהעגלה: ${removed.join(", ")}. בדקו את העגלה ואשרו שוב.`
            : priceChanged
            ? "המחירים התעדכנו מאז שהוספתם לעגלה. בדקו את הסכום ואשרו שוב."
            : "כמויות בעגלה עודכנו לפי גדלי המארזים העדכניים — חלק מהמוצרים נמכרים במארזים שלמים. בדקו את העגלה ואשרו שוב."
        );
        setSubmitting(false);
        return;
      }
      const validLines = Object.entries(reconciled).map(([id, v]) => ({ id, ...v }));
      if (validLines.length === 0) {
        setError("העגלה ריקה.");
        setSubmitting(false);
        return;
      }
      const freshTotal = validLines.reduce((s, l) => s + l.price * l.qty, 0);
      if (minOrder > 0 && freshTotal < minOrder) {
        setError(`מינימום הזמנה: ${ils(minOrder)}. עדכנו את העגלה ונסו שוב.`);
        setSubmitting(false);
        return;
      }

      // Identity is guaranteed: email always comes from the session, and
      // name/business fall back to the signup metadata if the profile is empty.
      const meta = (session.user.user_metadata ?? {}) as Record<string, string>;
      const { data: order, error: oErr } = await supabase
        .from("orders")
        .insert({
          user_id: session.user.id,
          total: freshTotal,
          note,
          contact_name: contactName || profile?.full_name || meta.full_name || "",
          contact_phone: contactPhone || profile?.phone || meta.phone || "",
          contact_email: session.user.email ?? "",
          business_name: profile?.business_name || meta.business_name || "",
          status: "new",
        })
        .select("id")
        .single();
      if (oErr || !order) throw oErr ?? new Error("order failed");
      const items = validLines.map((l) => ({
        order_id: order.id,
        product_id: l.id,
        product_sku: l.sku ?? "",
        product_name: l.name,
        unit_price: l.price,
        quantity: l.qty,
      }));
      const { error: iErr } = await supabase.from("order_items").insert(items);
      if (iErr) {
        // The order row was created but its lines failed — roll it back so no
        // empty "orphan" order is left behind. Best-effort: if RLS forbids the
        // delete it simply stays, exactly as it would have before this guard.
        try { await supabase.from("orders").delete().eq("id", order.id); } catch { /* ignore */ }
        throw iErr;
      }
      // Auto-push the order into Rivhit as an "הזמנה" document (only if this
      // account is linked to a Rivhit customer). Fire-and-forget: the order is
      // safely stored either way, and the manager can push it manually later.
      supabase.functions
        .invoke("rivhit-push", { body: { action: "push_order", order_id: order.id } })
        .catch(() => {});
      setPlaced(order.id);
      setCart({});
      setNote("");
      setCartOpen(false);
    } catch {
      setError("שליחת ההזמנה נכשלה. נסו שוב בעוד רגע.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !session) {
    return (
      <>
        <SiteHeader />
        <main id="main-content" tabIndex={-1} style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: tokens.assistant, color: tokens.dim }}>
          טוען…
        </main>
        <SiteFooter />
      </>
    );
  }

  if (placed) {
    return (
      <>
        <SiteHeader />
        <main id="main-content" tabIndex={-1} style={{ maxWidth: 640, margin: "0 auto", padding: "5rem 1.25rem", textAlign: "center" }}>
          <div style={{ fontSize: "4rem", marginBottom: "1rem" }}>🎉</div>
          <h1 style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "2rem", color: tokens.text, marginBottom: "0.6rem" }}>ההזמנה נשלחה!</h1>
          <p style={{ fontFamily: tokens.assistant, color: tokens.body, marginBottom: "2rem" }}>
            ההזמנה התקבלה ונשלחה למנהל. מספר הזמנה: <b dir="ltr">{placed.slice(0, 8)}</b>
          </p>
          <div style={{ display: "flex", gap: "0.8rem", justifyContent: "center", flexWrap: "wrap" }}>
            <button onClick={() => setPlaced(null)} style={ghostBtn}>להזמנה נוספת</button>
            <button onClick={() => router.push("/account")} style={solidBtn}>ההזמנות שלי</button>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <SiteHeader />
      <main id="main-content" tabIndex={-1} style={{ maxWidth: 1280, margin: "0 auto", padding: "clamp(1.25rem,4vw,2.5rem) clamp(1rem,4vw,2.5rem) 6rem" }}>
        <section
          style={{
            position: "relative",
            overflow: "hidden",
            borderRadius: 28,
            background: "linear-gradient(125deg, #8A3FFC 0%, #2E7DFF 26%, #25C77E 46%, #FFC400 62%, #FF8A00 80%, #FF2E93 100%)",
            padding: "clamp(1.8rem,5vw,3.2rem)",
            boxShadow: "0 16px 44px rgba(138,63,252,0.28)",
          }}
        >
          {/* soft scrim keeps the white text crisp over the bright bands */}
          <div aria-hidden style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.16)" }} />
          <div aria-hidden style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
            <span style={{ position: "absolute", insetInlineEnd: "3%", top: "-12%", fontSize: 155, opacity: 0.25 }}>🧸</span>
            <span style={{ position: "absolute", insetInlineEnd: "26%", bottom: "-22%", fontSize: 95, opacity: 0.2 }}>🎈</span>
            <span style={{ position: "absolute", insetInlineStart: "4%", bottom: "-14%", fontSize: 82, opacity: 0.18 }}>🚗</span>
            <span style={{ position: "absolute", insetInlineStart: "24%", top: "-6%", fontSize: 60, opacity: 0.16 }}>⭐</span>
          </div>
          <div style={{ position: "relative" }}>
            <span style={{ display: "inline-block", fontFamily: tokens.rubik, fontWeight: 800, fontSize: "0.72rem", letterSpacing: "0.12em", color: "#fff", background: "rgba(255,255,255,0.22)", border: "1px solid rgba(255,255,255,0.45)", borderRadius: 999, padding: "0.35rem 1rem", marginBottom: "1rem", backdropFilter: "blur(4px)" }}>
              🎉 הקטלוג הסיטונאי · כרם טויס
            </span>
            <h1 style={{ fontFamily: tokens.rubik, fontWeight: 900, fontSize: "clamp(1.9rem,5vw,3.2rem)", color: "#fff", lineHeight: 1.08, maxWidth: 640, textShadow: "0 2px 14px rgba(0,0,0,0.22)" }}>
              כל הצעצועים שילדים אוהבים — במחירי סיטונאות 🎈
            </h1>
            <p style={{ fontFamily: tokens.assistant, color: "rgba(255,255,255,0.96)", marginTop: "0.8rem", fontSize: "1.05rem", fontWeight: 500, textShadow: "0 1px 8px rgba(0,0,0,0.18)" }}>
              {total.toLocaleString("he-IL")} מוצרים · מעודכן ישירות מהמלאי{vatLabel ? " · המחירים כוללים מע״מ" : ""}
            </p>
          </div>
        </section>
        {/* Wave 5 (ff_min_order_vat_ui): quiet reminder of the minimum while
            the cart is still under it — disappears once the minimum is met. */}
        {ffMinVat && minOrder > 0 && cartTotal < minOrder && (
          <div style={{ marginTop: "0.6rem" }}>
            <span style={{ display: "inline-block", fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.body, background: tokens.surface, border: `1px solid ${tokens.border}`, borderRadius: 999, padding: "0.35rem 0.9rem" }}>
              מינימום הזמנה: {ils(minOrder)} · בעגלה: {ils(cartTotal)}
            </span>
          </div>
        )}
        {discount > 0 && (
          <div style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", marginTop: "0.7rem", fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.9rem", color: "#1A7A4D", background: "rgba(37,199,126,0.12)", border: "1px solid rgba(37,199,126,0.4)", borderRadius: 999, padding: "0.45rem 1.1rem" }}>
            🎁 יש לך הנחה קבועה של {discount}% — כל המחירים כבר מחושבים אחרי ההנחה
          </div>
        )}

        <div style={{ position: "sticky", top: "var(--kt-header-h, 96px)", zIndex: 40, background: "rgba(255,255,255,0.94)", backdropFilter: "blur(8px)", padding: "1rem 0", marginTop: "0.5rem" }}>
          <input
            type="search"
            id="kt-catalog-search"
            name="catalog-search"
            // A real programmatic name — placeholder alone is not a label
            // (it vanishes on input and many screen readers skip it).
            aria-label="חיפוש מוצר לפי שם, קוד פריט או ברקוד"
            placeholder="🔍 חיפוש לפי שם, קוד פריט או ברקוד…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            // Wave 5 (ff_mobile_polish): a real search keyboard, and Enter closes
            // it instead of doing nothing — the results are already live-filtered
            // by the debounce, so there is no form to submit.
            enterKeyHint={ffMobile ? "search" : undefined}
            onKeyDown={ffMobile ? (e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } } : undefined}
            style={{ width: "100%", fontFamily: tokens.assistant, fontSize: "1rem", padding: "0.85rem 1rem", borderRadius: 14, border: `1px solid ${tokens.border}`, background: tokens.surface, color: tokens.text }}
          />
          {/* Category chips apply while browsing. A text search runs across ALL
              categories (search_products takes no category argument), so the
              chips are hidden during search — leaving them visible and
              highlighted would falsely imply the results are filtered. */}
          {categories.length > 0 && query.trim().length < 2 && (
            <div role="group" aria-label="סינון לפי קטגוריה" style={{ display: "flex", gap: "0.5rem", flexWrap: ffCatSheet && catsExpanded ? "wrap" : "nowrap", overflowX: ffCatSheet && catsExpanded ? "visible" : "auto", paddingBottom: "0.3rem", marginTop: "0.7rem" }}>
              {[{ category: "all", n: 0 }, ...visibleCats].map((c, i) => {
                const active = activeCat === c.category;
                const isAll = c.category === "all";
                const accent = isAll ? tokens.accent : tokens.rainbowColors[i % tokens.rainbowColors.length];
                return (
                  <button
                    key={c.category}
                    onClick={() => setActiveCat(c.category)}
                    aria-pressed={active}
                    style={{
                      whiteSpace: "nowrap", fontFamily: tokens.rubik, fontWeight: 800, fontSize: "0.82rem",
                      padding: "0.5rem 1.1rem", borderRadius: 999, cursor: "pointer",
                      // categories carry their own rainbow tint; only literal hex
                      // colors (rainbowColors) get the alpha suffix, never the
                      // var()-based accent used for "all".
                      border: `1.5px solid ${active ? "transparent" : isAll ? tokens.border : `${accent}55`}`,
                      background: active ? accent : isAll ? "#fff" : `${accent}18`,
                      color: active ? "#fff" : isAll ? tokens.body : accent,
                      boxShadow: active ? `0 4px 12px ${isAll ? "rgba(138,63,252,0.30)" : `${accent}66`}` : "none",
                    }}
                  >
                    {isAll ? "הכל" : `${c.category} (${c.n})`}
                  </button>
                );
              })}
              {ffCatSheet && (hiddenCats > 0 || catsExpanded) && (
                <button
                  onClick={() => setCatsExpanded((v) => !v)}
                  aria-expanded={catsExpanded}
                  style={{
                    whiteSpace: "nowrap", fontFamily: tokens.rubik, fontWeight: 800, fontSize: "0.82rem",
                    padding: "0.5rem 1.1rem", borderRadius: 999, cursor: "pointer",
                    border: `1.5px dashed ${tokens.border}`, background: "#fff", color: tokens.body,
                  }}
                >
                  {catsExpanded ? "פחות ↑" : `עוד ${hiddenCats} ↓`}
                </button>
              )}
            </div>
          )}
          {/* 3B wave 3: price buckets. Browse mode only (the RPC search path
              takes no price argument), so hidden during a text search — exactly
              like the category chips above — to never imply a filter that is not
              applied. */}
          {ffFilters && query.trim().length < 2 && (
            <div role="group" aria-label="סינון לפי מחיר" style={{ display: "flex", gap: "0.5rem", overflowX: "auto", paddingBottom: "0.3rem", marginTop: "0.7rem" }}>
              {PRICE_BUCKETS.map((b) => {
                const active = priceBucket === b.key;
                return (
                  <button
                    key={b.key}
                    onClick={() => setPriceBucket(b.key)}
                    aria-pressed={active}
                    style={{
                      whiteSpace: "nowrap", fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.8rem",
                      padding: "0.45rem 0.95rem", borderRadius: 999, cursor: "pointer",
                      border: `1.5px solid ${active ? "transparent" : tokens.border}`,
                      background: active ? tokens.accent : "#fff",
                      color: active ? "#fff" : tokens.body,
                    }}
                  >
                    {b.label}
                  </button>
                );
              })}
            </div>
          )}
          {/* Sorting applies while browsing; during a text search results are
              ranked by relevance, so the control is hidden then. */}
          {query.trim().length < 2 && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.7rem" }}>
              <label htmlFor="kt-sort" style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.dim }}>מיון:</label>
              <select
                id="kt-sort"
                value={sort}
                onChange={(e) => setSort(e.target.value as "name" | "price_asc" | "price_desc")}
                style={{ fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.82rem", color: tokens.text, background: "#fff", border: `1px solid ${tokens.border}`, borderRadius: 999, padding: "0.4rem 0.9rem", cursor: "pointer" }}
              >
                <option value="name">שם (א-ת)</option>
                <option value="price_asc">מחיר: מהזול ליקר</option>
                <option value="price_desc">מחיר: מהיקר לזול</option>
              </select>
            </div>
          )}
        </div>

        {loadingProducts && products.length === 0 ? (
          ffMobile ? (
            // Wave 5: skeleton cards instead of a bare line — the page looks like
            // the catalogue immediately instead of an empty screen. Decorative
            // only; the live region below still announces the load.
            <div aria-busy="true" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(clamp(132px, 46%, 150px), 1fr))", gap: "1rem", marginTop: "1rem" }}>
              <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)" }} role="status">טוען מוצרים…</span>
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} aria-hidden="true" style={{ border: `1px solid ${tokens.border}`, borderRadius: tokens.radiusCard, padding: "0.9rem", background: "#fff", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  <div style={{ aspectRatio: "1 / 1", borderRadius: 12, background: tokens.surface }} />
                  <div style={{ height: "0.85em", borderRadius: 6, background: tokens.surface }} />
                  <div style={{ height: "0.85em", width: "60%", borderRadius: 6, background: tokens.surface }} />
                </div>
              ))}
            </div>
          ) : (
            <p style={{ fontFamily: tokens.assistant, color: tokens.dim, marginTop: "2rem" }}>טוען מוצרים…</p>
          )
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
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(clamp(132px, 46%, 150px), 1fr))", gap: "1rem", marginTop: "1rem" }}>
              {products.map((p, i) => {
                const accent = tokens.rainbowColors[i % tokens.rainbowColors.length];
                const qty = cart[p.id]?.qty ?? 0;
                // Wave 3 (flag on): pack-aware card. RPC rows lack the quantity
                // columns → step 1 (unit product), so nothing changes for them.
                const step = ffQty ? stepOf(p) : 1;
                const dq = Math.floor(Number(p.display_qty) || 0);
                const displaySold = ffQty && step > 1 && dq > 1;
                const packName = (p.display_name || "מארז").trim() || "מארז";
                return (
                  <div key={p.id} className={ffMotion ? "kt-card kt-press" : "kt-card"} style={{ border: `1px solid ${tokens.border}`, borderTop: ffCardV2 ? `1px solid ${tokens.border}` : `3px solid ${accent}`, borderRadius: tokens.radiusCard, padding: "0.9rem", background: "#fff", boxShadow: ffCardIncart && qty > 0 ? `0 0 0 2px #1A7A4D inset, ${tokens.shadowCard}` : tokens.shadowCard, display: "flex", flexDirection: "column", gap: "0.45rem" }}>
                    {/* No stock badge: quantities in Rivhit are not maintained
                        reliably (new items arrive as 0), so an automatic
                        "אזל מהמלאי" label mislabels products that ARE in stock. */}
                    {/* Uniform frame: square in every column width (aspectRatio,
                        not a fixed height), contain (no cropping/stretching),
                        small inner padding, one white background. */}
                    <Link href={`/product/?id=${p.id}`} aria-label={`פרטים על ${p.name}`} style={{ display: "block", position: "relative", aspectRatio: "1 / 1", borderRadius: 12, background: "#fff", border: `1px solid ${tokens.border}`, overflow: "hidden" }}>
                      {ffCardIncart && qty > 0 && (
                        <span aria-hidden="true" style={{ position: "absolute", insetInlineEnd: 6, top: 6, zIndex: 2, background: "#1A7A4D", color: "#fff", fontFamily: tokens.rubik, fontWeight: 800, fontSize: "0.7rem", padding: "0.15rem 0.5rem", borderRadius: 999 }}>
                          בעגלה · {qty.toLocaleString("he-IL")}
                        </span>
                      )}
                      <span style={{ position: "absolute", inset: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "2.6rem" }}>
                        <ProductImage pictureLink={p.picture_link} name={p.name} rotation={p.rotation_override ?? 0} />
                      </span>
                    </Link>
                    <Link href={`/product/?id=${p.id}`} style={{ textDecoration: "none" }}>
                      {/* Clamped to keep every card the same height. Rivhit names run
                          long, and one long name stretched its card to 453px against 300px
                          for its neighbours — which stretches the whole grid row. title
                          keeps the full name one hover away; the product page always shows
                          it. ff_card_v2: 2 lines (the longest live name is 54 chars, so a
                          third line was almost always empty) reclaims a row of vertical
                          space. */}
                      <h3 style={{ fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.92rem", color: tokens.text, lineHeight: 1.25, minHeight: ffCardV2 ? "2.5em" : "2.3em", display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: ffCardV2 ? 2 : 3, overflow: "hidden" }} title={p.name}>{p.name}</h3>
                    </Link>
                    {/* ff_card_v2: prefer the barcode, fall back to sku — the same rule the
                        Excel export uses. Today every active product's barcode is empty and
                        the EAN lives in sku, so this reads identically now, but it keeps the
                        card and the export in step if barcodes are ever populated. */}
                    <div style={{ fontFamily: tokens.assistant, fontSize: "0.72rem", color: tokens.dim }}>קוד: <span dir="ltr">{(ffCardV2 ? (p.barcode || p.sku) : p.sku) || "—"}</span></div>
                    {displaySold && (
                      <div style={{ fontFamily: tokens.assistant, fontWeight: 600, fontSize: "0.78rem", color: tokens.body }}>
                        {packName} = {dq.toLocaleString("he-IL")} יחידות
                      </div>
                    )}
                    {/* A price the manager set for THIS customer replaces the
                        discount presentation entirely — showing a "-10%" badge
                        next to a negotiated price would be a lie, since the
                        discount is not applied on top of it. */}
                    {/* The price is ALWAYS per unit — the owner's explicit
                        decision (was: pack-sold products led with a per-display
                        figure like "לדיספליי: ₪96", which he did not want).
                        Pack-sold products keep the "מארז = N יחידות" line above
                        and the "סה״כ: …" summary once a quantity is chosen, so
                        the buyer still sees what one press adds and what it
                        costs — but the headline number is the unit price,
                        labelled ליחידה so it cannot be misread as the pack's. */}
                    {isSpecial(p) ? (
                      <div style={{ display: "flex", alignItems: "baseline", gap: "0.45rem", flexWrap: "wrap" }}>
                        <span style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.1rem", color: "#1A7A4D" }}>
                          {ils(unitPrice(p))}{displaySold ? <span style={{ fontFamily: tokens.assistant, fontWeight: 400, fontSize: "0.8rem", color: tokens.dim }}> ליחידה</span> : null}
                        </span>
                        <span style={{ fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.68rem", color: "#fff", background: "#1A7A4D", padding: "0.15rem 0.5rem", borderRadius: 999 }}>מחיר מיוחד</span>
                      </div>
                    ) : discount > 0 ? (
                      <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", flexWrap: "wrap" }}>
                        <span style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.1rem", color: "#1A7A4D" }}>{ils(unitPrice(p))}{displaySold ? <span style={{ fontFamily: tokens.assistant, fontWeight: 400, fontSize: "0.8rem", color: tokens.dim }}> ליחידה</span> : null}</span>
                        <s style={{ fontFamily: tokens.assistant, fontSize: "0.82rem", color: tokens.dim }}>{ils(listPrice(p))}</s>
                        <span style={{ fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.68rem", color: "#fff", background: "#25C77E", padding: "0.15rem 0.5rem", borderRadius: 999 }}>‎-{discount}%</span>
                      </div>
                    ) : (
                      <div style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.1rem", color: tokens.text }}>{ils(unitPrice(p))}{displaySold ? <span style={{ fontFamily: tokens.assistant, fontWeight: 400, fontSize: "0.8rem", color: tokens.dim }}> ליחידה</span> : null}</div>
                    )}
                    {(() => {
                      // Wave 3 (flag on): the DB carton_qty wins; the legacy
                      // name-parse stays as fallback. Flag off: name-parse only.
                      const dbCarton = ffQty ? Math.floor(Number(p.carton_qty) || 0) : 0;
                      const carton = dbCarton >= 2 ? dbCarton : cartonSize(p.name);
                      // What the button will ACTUALLY put in the cart. A carton
                      // is not always a whole number of packs — e.g. a carton of
                      // 100 on a product sold in packs of 8 — and setQty rounds
                      // up to the next whole pack. The button used to promise
                      // the raw carton figure and quietly charge for the rounded
                      // one; on the worst product in the catalogue that was
                      // ₪240 more than the label said. Label the real number.
                      const cartonUnits = carton
                        ? (ffQty ? resolveQuantity(p, carton).units : carton)
                        : null;
                      if (qty === 0) {
                        return (
                          <>
                            <div style={{ display: "flex", gap: "0.4rem" }}>
                              {/* Flag on: one press adds one whole step (setQty
                                  normalizes anyway). Flag off: step === 1. */}
                              <button onClick={() => setQty(p, step)} style={{ ...solidBtn, flex: 1, padding: "0.55rem" }}>הוספה</button>
                              {carton && cartonUnits && (
                                <button
                                  onClick={() => setQty(p, cartonUnits)}
                                  title={
                                    cartonUnits === carton
                                      ? `הוספת קרטון של ${carton} יחידות`
                                      : `קרטון = ${carton} יחידות, והמוצר נמכר ב${pluralPack(packName, 2)} שלמים — יתווספו ${cartonUnits} יחידות`
                                  }
                                  // No whiteSpace:nowrap. This button is 92px of
                                  // unbreakable text inside a 136px grid column
                                  // at 320px, and it was the single thing making
                                  // /catalog 339px wide there — 19px of every
                                  // screen clipped, including the logo, the phone
                                  // link and the first category chip, with no way
                                  // to scroll to them. Two lines beats cut off.
                                  style={{ ...ghostBtn, flex: 1, padding: "0.55rem 0.4rem", fontSize: "0.8rem", lineHeight: 1.15 }}>
                                  📦 קרטון ({cartonUnits.toLocaleString("he-IL")})
                                </button>
                              )}
                            </div>
                            {displaySold && (
                              <div style={{ fontFamily: tokens.assistant, fontSize: "0.72rem", color: tokens.dim, textAlign: "center" }}>
                                +1 {packName}
                              </div>
                            )}
                          </>
                        );
                      }
                      return (
                        <div style={{ display: "grid", gap: "0.35rem" }}>
                          <Stepper qty={qty} onChange={(n) => setQty(p, n)} accent={accent} step={step} label={p.name}
                            onCommitTyped={ffQty ? (n) => setQty(p, n) : undefined} />
                          {displaySold && (
                            <div style={{ fontFamily: tokens.assistant, fontSize: "0.78rem", color: tokens.body }}>
                              סה״כ: {describeQuantity(p, qty)}
                            </div>
                          )}
                          {ffQty && qtyNotes[p.id] && (
                            <div role="status" style={{ fontFamily: tokens.assistant, fontSize: "0.75rem", color: "#1A7A4D", background: "rgba(37,199,126,0.12)", border: "1px solid rgba(37,199,126,0.4)", borderRadius: 8, padding: "0.4rem 0.6rem" }}>
                              {qtyNotes[p.id]}
                            </div>
                          )}
                          {carton && cartonUnits && (
                            <button onClick={() => setQty(p, qty + cartonUnits)}
                              style={{ ...ghostBtn, padding: "0.4rem", fontSize: "0.75rem" }}>
                              📦 ‎+ קרטון ({cartonUnits.toLocaleString("he-IL")})
                            </button>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>

            {/* Infinite-scroll sentinel: when it nears the viewport the next
                page loads automatically — customers just keep scrolling. */}
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

      {itemCount > 0 && !cartOpen && (
        <button ref={cartOpenerRef} onClick={() => setCartOpen(true)} aria-haspopup="dialog" style={{ position: "fixed", insetInlineStart: 20, bottom: ffMobile ? "calc(20px + env(safe-area-inset-bottom))" : 20, zIndex: 60, fontFamily: tokens.rubik, fontWeight: 800, fontSize: "0.95rem", color: "#fff", background: tokens.rainbow, border: "none", padding: "1rem 1.6rem", borderRadius: 999, boxShadow: "0 12px 30px rgba(138,63,252,0.35)", cursor: "pointer" }}>
          🛒 העגלה ({itemCount}) · {ils(cartTotal)}
        </button>
      )}

      {cartOpen && (
        <div onClick={() => setCartOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(26,23,48,0.4)", display: "flex", justifyContent: "flex-start" }}>
          <div ref={drawerRef} role="dialog" aria-modal="true" aria-label="עגלת הקניות" onClick={(e) => e.stopPropagation()} style={{ width: "min(420px, 92vw)", height: "100%", background: "#fff", padding: "1.5rem", overflowY: "auto", boxShadow: "0 0 60px rgba(0,0,0,0.2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.2rem" }}>
              <h2 style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.4rem", color: tokens.text }}>העגלה ({itemCount})</h2>
              <button ref={cartCloseRef} onClick={() => setCartOpen(false)} aria-label="סגירת העגלה" style={{ background: "none", border: "none", fontSize: "1.6rem", cursor: "pointer", color: tokens.dim, minWidth: 44, minHeight: 44 }}>×</button>
            </div>
            {/* The error banner lives OUTSIDE the empty/non-empty branch, so the
                "items sold out and were removed" explanation is still visible
                even when the reconcile emptied the whole cart. */}
            {error && <div role="alert" style={{ fontFamily: tokens.assistant, color: "#C0143C", fontSize: "0.88rem", marginBottom: "0.8rem" }}>{error}</div>}
            {lines.length === 0 ? (
              <p style={{ fontFamily: tokens.assistant, color: tokens.dim }}>העגלה ריקה.</p>
            ) : (
              <>
                <div style={{ display: "grid", gap: "0.8rem", marginBottom: "1rem" }}>
                  {lines.map((l) => {
                    // Wave 3: the drawer is a path into the cart too — when the
                    // flag is on its stepper moves by the pack size and every
                    // change is normalized. Lines without pack fields (old
                    // carts, flag off) behave as unit products, exactly as today.
                    const lp = lineQtyProduct(l);
                    const lineStep = ffQty ? stepOf(lp) : 1;
                    const changeLineQty = (n: number) => {
                      const q = ffQty ? resolveQuantity(lp, Math.min(n, 9999)).units : n;
                      setCart((c) => {
                        const next = { ...c };
                        if (q <= 0) delete next[l.id]; else next[l.id] = { ...c[l.id], qty: ffQty ? q : Math.min(q, 9999) };
                        return next;
                      });
                    };
                    return (
                      <div key={l.id} style={{ display: "flex", gap: "0.6rem", alignItems: "center", borderBottom: `1px solid ${tokens.border}`, paddingBottom: "0.6rem" }}>
                        <div style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 8, border: `1px solid ${tokens.border}`, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.4rem" }}>
                          <ProductImage pictureLink={l.picture_link} name={l.name} />
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontFamily: tokens.assistant, fontWeight: 600, fontSize: "0.88rem", color: tokens.text }}>{l.name}</div>
                          <div style={{ fontFamily: tokens.assistant, fontSize: "0.8rem", color: tokens.dim }}>{ils(l.price)} ליח׳</div>
                          {ffQty && lineStep > 1 && (
                            <div style={{ fontFamily: tokens.assistant, fontSize: "0.78rem", color: tokens.body }}>{describeQuantity(lp, l.qty)}</div>
                          )}
                          {ffCartV2 && (
                            <div style={{ fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.82rem", color: tokens.text, marginTop: "0.15rem" }}>סה״כ: {ils(l.price * l.qty)}</div>
                          )}
                        </div>
                        <Stepper qty={l.qty} accent={tokens.accent} compact step={lineStep} label={l.name}
                          onCommitTyped={ffQty ? changeLineQty : undefined}
                          onChange={changeLineQty} />
                        {ffCartV2 && (
                          <button onClick={() => changeLineQty(0)} aria-label={`הסרת ${l.name} מהעגלה`}
                            style={{ flexShrink: 0, minWidth: 32, minHeight: 32, border: "none", background: "none", color: tokens.dim, fontSize: "1.3rem", lineHeight: 1, cursor: "pointer" }}>×</button>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.2rem", color: tokens.text, marginBottom: vatLabel ? "0.2rem" : "1.2rem" }}>
                  <span>סה״כ</span><span>{ils(cartTotal)}</span>
                </div>
                {vatLabel && (ffMinVat ? (() => {
                  // Wave 5: the plain "המחירים כוללים מע״מ" note becomes a
                  // breakdown. Prices already include VAT, so the pre-VAT part
                  // is EXTRACTED from the total (X = Z/(1+VAT), Y = Z−X), all
                  // in whole agorot so the three lines always add up exactly.
                  const totalAg = Math.round(cartTotal * 100);
                  const preVatAg = Math.round(totalAg / (1 + VAT_RATE));
                  const row: React.CSSProperties = { display: "flex", justifyContent: "space-between" };
                  return (
                    <div style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.body, display: "grid", gap: "0.3rem", marginBottom: "1.2rem" }}>
                      <div style={row}><span>סה״כ לפני מע״מ:</span><span>{ils(preVatAg / 100)}</span></div>
                      <div style={row}><span>מע״מ ({Math.round(VAT_RATE * 100)}%):</span><span>{ils((totalAg - preVatAg) / 100)}</span></div>
                      <div style={{ ...row, borderTop: `1px solid ${tokens.border}`, paddingTop: "0.4rem", fontFamily: tokens.rubik, fontWeight: 700, color: tokens.text }}>
                        <span>סה״כ לתשלום:</span><span>{ils(totalAg / 100)}</span>
                      </div>
                    </div>
                  );
                })() : (
                  <div style={{ fontFamily: tokens.assistant, fontSize: "0.78rem", color: tokens.dim, textAlign: "left", marginBottom: "1.2rem" }}>
                    המחירים כוללים מע״מ
                  </div>
                ))}
                <div style={{ display: "grid", gap: "0.6rem", marginBottom: "1rem" }}>
                  {/* Real programmatic names — a placeholder vanishes on input
                      and many screen readers skip it entirely. */}
                  <input aria-label="שם איש קשר" autoComplete="name" placeholder="שם איש קשר" value={contactName} onChange={(e) => setContactName(e.target.value)} style={miniInp} />
                  <input aria-label="טלפון" autoComplete="tel" placeholder="טלפון" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} style={miniInp} inputMode="tel" />
                  <textarea aria-label="הערה להזמנה (לא חובה)" placeholder="הערה להזמנה (לא חובה)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} style={{ ...miniInp, resize: "vertical" }} />
                </div>
                {/* Wave 5 (ff_min_order_vat_ui): minimum-order progress. The
                    track is a flex row, so the fill grows from the inline-start
                    (right, in RTL); capped at 100% once the minimum is met. */}
                {ffMinVat && minOrder > 0 && (
                  <div style={{ marginBottom: "0.9rem" }}>
                    <div style={{ fontFamily: tokens.assistant, fontWeight: 600, fontSize: "0.88rem", color: cartTotal < minOrder ? tokens.body : "#1A7A4D", marginBottom: "0.35rem" }}>
                      {cartTotal < minOrder ? `עוד ${ils(minOrder - cartTotal)} למינימום ההזמנה` : "הגעת למינימום ההזמנה 🎉"}
                    </div>
                    <div role="progressbar" aria-label="התקדמות למינימום ההזמנה" aria-valuemin={0} aria-valuemax={minOrder} aria-valuenow={Math.round(Math.min(cartTotal, minOrder))}
                      style={{ height: 10, borderRadius: 999, background: tokens.surface, border: `1px solid ${tokens.border}`, overflow: "hidden", display: "flex", justifyContent: "flex-start" }}>
                      <div style={{ width: `${Math.min(100, (cartTotal / minOrder) * 100)}%`, background: tokens.rainbow, borderRadius: 999, transition: "width 0.3s ease" }} />
                    </div>
                  </div>
                )}
                {minOrder > 0 && cartTotal < minOrder ? (
                  <>
                    {ffMinVat ? (
                      // Wave 5: the progress bar above carries the message —
                      // the explanation shrinks to a quiet caption beside it.
                      <div style={{ fontFamily: tokens.assistant, fontSize: "0.8rem", color: tokens.dim, textAlign: "center", marginBottom: "0.6rem" }}>
                        מינימום הזמנה: {ils(minOrder)} · חסרים עוד {ils(minOrder - cartTotal)}
                      </div>
                    ) : (
                      <div style={{ fontFamily: tokens.assistant, fontSize: "0.9rem", color: "#C0143C", background: "rgba(255,138,0,0.1)", border: "1px solid rgba(255,138,0,0.35)", borderRadius: 12, padding: "0.7rem 0.9rem", marginBottom: "0.8rem", textAlign: "center" }}>
                        מינימום הזמנה: {ils(minOrder)} · חסרים עוד {ils(minOrder - cartTotal)}
                      </div>
                    )}
                    <button disabled style={{ ...disabledBtn, width: "100%", padding: "0.95rem", fontSize: "0.88rem", marginTop: 0 }}>
                      שליחת הזמנה למנהל
                    </button>
                  </>
                ) : (
                  <button onClick={placeOrder} disabled={submitting} style={{ ...solidBtn, width: "100%", padding: "0.95rem" }}>
                    {submitting ? "שולח…" : "שליחת הזמנה למנהל"}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Stepper({ qty, onChange, accent, compact, step = 1, onCommitTyped, label }: {
  qty: number; onChange: (q: number) => void; accent: string; compact?: boolean;
  /** Wave 3 (ff_display_quantities): +/- move by this many units. Default 1. */
  step?: number;
  /** Wave 3: when set, typed input edits a local draft committed on blur/Enter
   *  (so a normalizer can't fight each keystroke); +/- commit immediately.
   *  When absent (flag off) typing calls onChange per keystroke, as today. */
  onCommitTyped?: (q: number) => void;
  /** Product name for the accessible names — a grid renders dozens of
   *  steppers, and bare "כמות"/"פחות"/"עוד" are indistinguishable in a
   *  screen reader's form-controls list. */
  label?: string;
}) {
  const sz = compact ? 30 : 34;
  const [draft, setDraft] = useState<string | null>(null);
  const suffix = label ? ` — ${label}` : "";
  const btn: React.CSSProperties = { width: sz, height: sz, borderRadius: 9, border: `1px solid ${accent}`, background: "#fff", color: accent, fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.05rem", cursor: "pointer", flexShrink: 0 };
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.4rem" }}>
      <button aria-label={`פחות${suffix}`} style={btn} onClick={() => onChange(qty - step)}>−</button>
      <input
        value={draft ?? qty}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "");
          if (onCommitTyped) { setDraft(digits); return; }
          const n = parseInt(digits, 10);
          onChange(Number.isFinite(n) ? n : 0);
        }}
        onBlur={onCommitTyped ? () => {
          if (draft === null) return;
          // An empty field means "I cleared it to retype", not "remove this
          // line" — restore the current qty instead of committing 0 (which
          // would delete the cart line the moment focus leaves). A typed 0
          // still removes, as documented.
          if (draft === "") { setDraft(null); return; }
          const n = parseInt(draft, 10);
          setDraft(null);
          onCommitTyped(Number.isFinite(n) ? n : 0);
        } : undefined}
        onKeyDown={onCommitTyped ? (e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); } : undefined}
        aria-label={`כמות${suffix}`}
        style={{ width: compact ? 44 : 52, textAlign: "center", fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.95rem", border: `1px solid ${tokens.border}`, borderRadius: 9, padding: "0.4rem 0" }} inputMode="numeric" />
      <button aria-label={`עוד${suffix}`} style={btn} onClick={() => onChange(qty + step)}>+</button>
    </div>
  );
}

// Solid accent, not the rainbow: white on the yellow stop measured 1.60:1.
const solidBtn: React.CSSProperties = { fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.88rem", color: "#fff", background: tokens.accent, border: "none", padding: "0.7rem 1.3rem", borderRadius: 999, cursor: "pointer" };
const ghostBtn: React.CSSProperties = { fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.88rem", color: tokens.accent, background: "#fff", border: `1px solid ${tokens.border}`, padding: "0.7rem 1.3rem", borderRadius: 999, cursor: "pointer" };
const miniInp: React.CSSProperties = { fontFamily: tokens.assistant, fontSize: "0.95rem", padding: "0.6rem 0.75rem", borderRadius: 10, border: `1px solid ${tokens.border}`, background: tokens.surface, color: tokens.text, width: "100%" };
