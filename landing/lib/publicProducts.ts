// Build-time data for the public product pages (/p/ and /p/<id>/).
//
// Google can only index what is in the HTML it downloads. Every product page
// on the site so far was either behind the sign-in (/catalog, /product) or a
// client-rendered list (/view), so not one of the ~940 products was findable
// by name. These pages are generated once per deploy as plain static HTML.
//
// EXPOSURE: nothing new. The list comes from catalog_public() and
// catalog_public_categories() — the exact anon RPCs the public /view catalogue
// already calls from every visitor's browser — and a page shows only what
// /view shows: name, photo, category. Never a price, sku/barcode or stock
// count. Products hidden by the manager or moved to "ניגמרים" are not in
// catalog_public(), so they get no page.
//
// FAILURE: if the list cannot be read the build FAILS, on purpose. A failed
// deploy leaves the live site exactly as it was; publishing with zero
// products would delete every product page Google has indexed.
//
// Local test builds have no network to Supabase: KEREM_PUBLIC_PRODUCTS_FIXTURE
// points at a JSON file { categories, products } used instead.

import { readFileSync } from "node:fs";
import { featureFlags } from "./featureFlags";

export type PublicItem = {
  id: string;
  name: string;
  picture_link: string;
  category: string;
  rotation_override: number | null;
};
export type PublicCategory = { category: string; n: number };
export type PublicCatalogData = { categories: PublicCategory[]; products: PublicItem[] };

// Same values and fallbacks as lib/supabaseClient.ts (the publishable key is
// a public, browser-shipped key; RLS and the RPCs' own SELECT list are the
// boundary).
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://mcdchalyzeqjkkgfeznd.supabase.co";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_ie1SyncNyRabOTCWTxt8pw_AsESY6F9";

/** The id of the one page generated when there are no product pages (flag
 *  off): a static export needs at least one path per dynamic route. */
export const PLACEHOLDER_ID = "_";

const PAGE = 60; // catalog_public() caps lim at 60

async function rpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()) as T;
    } catch (e) {
      last = e;
      if (attempt < 3) await new Promise((res) => setTimeout(res, 2000 * attempt));
    }
  }
  throw new Error(`public product pages: ${name} failed 3 times (${String((last as Error)?.message ?? last)}) — build stopped so the live site keeps its current pages`);
}

async function load(): Promise<PublicCatalogData> {
  if (!featureFlags.ff_public_product_pages) return { categories: [], products: [] };

  const fixture = process.env.KEREM_PUBLIC_PRODUCTS_FIXTURE;
  if (fixture) return JSON.parse(readFileSync(fixture, "utf8")) as PublicCatalogData;

  const categories = await rpc<PublicCategory[]>("catalog_public_categories", {});
  // catalog_public() orders by name only, and a dozen names repeat — rows that
  // tie across a page boundary are not guaranteed to come back in the same
  // order on the next call, so one pass could skip one. Collect by id and
  // repeat the pass (at most 3) until every row the RPC counts is in hand.
  const byId = new Map<string, PublicItem>();
  let total = 0;
  for (let pass = 1; pass <= 3; pass++) {
    for (let off = 0; ; off += PAGE) {
      const rows = await rpc<(PublicItem & { total?: number })[]>("catalog_public", { q: null, cat: "all", lim: PAGE, off });
      for (const r of rows) {
        total = Math.max(total, Number(r.total) || 0);
        byId.set(r.id, { id: r.id, name: r.name, picture_link: r.picture_link, category: r.category, rotation_override: r.rotation_override ?? null });
      }
      if (rows.length < PAGE) break;
      if (off > 20_000) throw new Error("public product pages: catalog_public paging did not end");
    }
    if (byId.size >= total) break;
  }
  if (byId.size < total) console.warn(`public product pages: ${byId.size} of ${total} products read`);
  const products = [...byId.values()];
  if (products.length === 0) {
    throw new Error("public product pages: catalog_public returned 0 products — build stopped so the live site keeps its current pages");
  }
  return { categories, products };
}

// One read per build worker, shared by generateStaticParams, every page,
// generateMetadata and the sitemap.
let cached: Promise<PublicCatalogData> | null = null;
export function getPublicCatalog(): Promise<PublicCatalogData> {
  if (!cached) cached = load();
  return cached;
}

/** Stable in-page anchor for a category on the /p/ index (its position in
 *  the Rivhit group order — Hebrew ids work but are ugly in a shared URL). */
export function categoryAnchor(categories: PublicCategory[], category: string): string {
  const i = categories.findIndex((c) => c.category === category);
  return i >= 0 ? `cat-${i + 1}` : "";
}
