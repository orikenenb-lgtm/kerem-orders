// "Return to where I was" for the customer catalogue.
//
// The product page is a separate route, so coming back to /catalog (browser
// Back, the "הקטלוג" breadcrumb, "← חזרה לקטלוג") used to rebuild the
// catalogue from scratch: category back to "הכל", search cleared, only the
// first 48 products, scrolled to the top. A customer who had scrolled through
// 150 products to open one had to find their place again every time.
//
// When a product is opened from the grid, the catalogue saves ITS OWN VIEW
// STATE — nothing else — in sessionStorage (this tab only, gone when the tab
// closes): the filters, how many products were loaded, and where the opened
// card sat on screen. On the next arrival at /catalog it is read ONCE and
// removed.
//
// Deliberately NOT stored: products, prices, discounts, the cart (it has its
// own storage), or anything from the profile. Rows and prices are always
// fetched fresh from the database exactly as before.
//
// Guards: belongs to one signed-in user (a different account never inherits
// it), expires after 30 minutes, and anything malformed is ignored.
//
// Pure module (no React) — unit-tested in tests/catalogReturn.test.mjs.

export const CATALOG_RETURN_KEY = "kt-catalog-return-v1";
export const CATALOG_RETURN_MAX_AGE_MS = 30 * 60 * 1000;
/** Never re-load more than this many pages to restore a position (10 × 48). */
export const CATALOG_RETURN_MAX_PAGES = 10;

export type CatalogSort = "name" | "price_asc" | "price_desc";

export type CatalogReturn = {
  uid: string;
  at: number;
  activeCat: string;
  input: string;
  sort: CatalogSort;
  priceBucket: string;
  /** Pages of products that were on screen (≥ 1). */
  pages: number;
  /** The product card that was opened, and its distance from the top of the
   *  viewport at that moment — restored so the card is where it was. */
  anchorId: string;
  anchorTop: number;
  scrollY: number;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null; // storage blocked (privacy mode) — the feature is simply off
  }
}

const SORTS: readonly string[] = ["name", "price_asc", "price_desc"];
const isStr = (v: unknown, max = 200): v is string => typeof v === "string" && v.length <= max;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Validates an untrusted parsed value; returns null unless every field is sane. */
export function parseCatalogReturn(raw: unknown, now: number): CatalogReturn | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isStr(r.uid, 100) || !r.uid) return null;
  if (!isNum(r.at) || now - r.at < 0 || now - r.at > CATALOG_RETURN_MAX_AGE_MS) return null;
  if (!isStr(r.activeCat) || !r.activeCat) return null;
  if (!isStr(r.input) || !isStr(r.priceBucket, 40) || !r.priceBucket) return null;
  if (!isStr(r.sort, 20) || !SORTS.includes(r.sort)) return null;
  if (!isNum(r.pages) || r.pages < 1) return null;
  if (!isStr(r.anchorId, 100) || !isNum(r.anchorTop) || !isNum(r.scrollY) || r.scrollY < 0) return null;
  return {
    uid: r.uid,
    at: r.at,
    activeCat: r.activeCat,
    input: r.input,
    sort: r.sort as CatalogSort,
    priceBucket: r.priceBucket,
    pages: Math.min(Math.floor(r.pages), CATALOG_RETURN_MAX_PAGES),
    anchorId: r.anchorId,
    anchorTop: r.anchorTop,
    scrollY: r.scrollY,
  };
}

/** Saves the view, stamped with the current time (`at`). */
export function saveCatalogReturn(
  s: Omit<CatalogReturn, "at">,
  store: StorageLike | null = storage(),
  now: number = Date.now(),
): void {
  try {
    // Field by field on purpose: nothing a caller passes beyond the view
    // state (a product row, a price…) can ever reach storage.
    const v: CatalogReturn = {
      uid: s.uid, at: now, activeCat: s.activeCat, input: s.input, sort: s.sort,
      priceBucket: s.priceBucket, pages: s.pages, anchorId: s.anchorId,
      anchorTop: s.anchorTop, scrollY: s.scrollY,
    };
    store?.setItem(CATALOG_RETURN_KEY, JSON.stringify(v));
  } catch {
    /* quota / blocked — nothing to restore later, no harm */
  }
}

/** Reads the saved view (any user — the uid is checked once the session is
 *  known). Does not remove it: React may call a state initializer twice in
 *  development, so removal is a separate step (clearCatalogReturn), done once
 *  the view has been applied. */
export function readCatalogReturn(now: number = Date.now(), store: StorageLike | null = storage()): CatalogReturn | null {
  if (!store) return null;
  let raw: string | null = null;
  try {
    raw = store.getItem(CATALOG_RETURN_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    return parseCatalogReturn(JSON.parse(raw), now);
  } catch {
    return null;
  }
}

/** Applied at most once: removed as soon as the catalogue has taken it. */
export function clearCatalogReturn(store: StorageLike | null = storage()): void {
  try {
    store?.removeItem(CATALOG_RETURN_KEY);
  } catch {
    /* blocked storage — nothing was saved either */
  }
}

// Which page the customer is coming from. SiteHeader (on every page) notes
// each route after it renders; the catalogue reads it while rendering, before
// its own header has noted "/catalog" — so it still holds the PREVIOUS page.
// A saved view is applied only when that page was a product page (browser
// Back, the breadcrumb, "חזרה לקטלוג"); a category tile on the home page, the
// login redirect or a fresh page load always starts clean.
let lastRoute = "";
export function noteRoute(path: string): void {
  lastRoute = path || "";
}
export function cameFromProductPage(): boolean {
  return /\/product\/?$/.test(lastRoute);
}
