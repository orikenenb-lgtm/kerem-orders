import type { BrowserContext, Route } from "@playwright/test";

// A complete offline stand-in for Supabase.
//
// The staging-backed smoke spec proves the real data surface works, but it can
// only run somewhere with network access to *.supabase.co — which CI and this
// build container do not have. A safety net that cannot run is not a safety
// net, so this module answers every Supabase call locally: the same specs then
// run anywhere, deterministically, with no credentials and no network.
//
// Nothing here writes: it is fixtures + request interception only.

/** Project ref out of the configured URL — the key supabase-js persists the
 *  session under is `sb-<ref>-auth-token`, so it has to match the build. */
export function projectRef(): string {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://ahptrtlnrpmevlpgqeac.supabase.co";
  return new URL(url).hostname.split(".")[0];
}

export const USER = {
  id: "00000000-0000-0000-0000-0000000000c1",
  email: "customerA@staging.invalid",
  aud: "authenticated",
  role: "authenticated",
  user_metadata: {},
};

export const SESSION = {
  access_token: "e2e-mock", token_type: "bearer", expires_in: 999999,
  expires_at: Math.floor(Date.now() / 1000) + 999999,
  refresh_token: "e2e-mock", user: USER,
};

export const PROFILE = {
  id: USER.id, email: USER.email, full_name: "לקוח בדיקה 1",
  business_name: "עסק בדיקה 1", phone: "050-000-1001",
  role: "customer", discount_percent: 0,
};

const mkProduct = (
  id: string, name: string, price: number, category: string, sku: string,
  display_qty = 1, sell_by = "unit",
) => ({
  id, name, price, category, sku, barcode: "",
  picture_link: `https://api.rivhit.co.il/pic/${id}`,
  stock_quantity: 120, rotation_override: null, unit_name: "יחידה",
  display_qty, display_name: "מארז", carton_qty: null,
  min_order_qty: 1, order_step: 1, sell_by,
});

/** Shapes copied from real catalogue rows: pack-sold and unit-sold, prices
 *  spread across the live buckets, Hebrew names of realistic length. */
export const PRODUCTS = [
  mkProduct("p1", "פרוזן בדיספלאי 1/12 ק 288", 12, "מותגים", "6928817371677", 12, "display"),
  mkProduct("p2", "קלפים זהב 1/15 פוקימון 900 יח", 7, "קלפים ושקיות", "6946452601065", 15, "display"),
  mkProduct("p3", "רובוט מכונית צהוב בקופסה 72 יח", 22, "מוצרי בנים", "6928810168960"),
  mkProduct("p4", "מכונית שלט מרוצים 72 יח", 38, "מכוניות שלט", "6900260202012"),
  mkProduct("p5", "אוזניות חוט תפוח אייפון 200 יח", 30, "50 אחוז הנחה", "6290202404179"),
  mkProduct("p6", "סביבון לחצן אורות וצלילים בקופסה 144 יח", 12, "סביבונים", "6024070687866"),
  mkProduct("p7", "לגו לוחמים ענק 1/4 קרטון 72 יח", 60, "לגו מותגים", "6929420705910", 4, "display"),
  mkProduct("p8", "עגלת שכיבה חום קרם 24 יח", 45, "עגלות בובה", "6415739802742"),
  mkProduct("p9", "כדור גומי סטיצ איכותי 1/12 קרטון 300", 6, "כדורים", "6943484452030", 12, "display"),
  mkProduct("p10", "ווקי טוקי לוחמים חדש 102 יח", 30, "מוצרי טליה מותגים", "69875441515177"),
  mkProduct("p11", "סליים לוחמים 1/12 ק 240 יח", 4, "סליים", "6952024059295", 12, "display"),
  mkProduct("p12", "מסוק מכבי אש אורות ומוזיקה 48 יח", 36, "מוצרי בנים", "6924050751115"),
];

/** The 24 real category names and counts, largest first. */
export const CATEGORIES: { category: string; n: number }[] = [
  ["דספלאים מותגים", 89], ["50 אחוז הנחה", 88], ["הפתעות", 74], ["מוצרי בנים", 72],
  ["מוצרי טליה מותגים", 66], ["מותגים", 64], ["לגו מותגים", 49], ["סקוויזי וסקוצי", 49],
  ["חדש 1", 45], ["עגלות בובה", 42], ["קלפים ושקיות", 39], ["מוצרי בנות", 38],
  ["מוצרי תליה", 35], ["חוברות ומדברות", 31], ["מוצרי אופניים", 31], ["נדו ודמפלינג", 28],
  ["כדורים", 27], ["מוצרי תינוקות", 24], ["מוצרי קופה", 21], ["רובים", 21],
  ["סביבונים", 15], ["סליים", 12], ["עצמאות", 7], ["מכוניות שלט", 6],
].map(([category, n]) => ({ category: category as string, n: n as number }));

export const ORDER = {
  id: "11111111-2222-3333-4444-555555555555",
  status: "new", total: 2760, note: "",
  created_at: new Date(Date.now() - 86400000 * 9).toISOString(),
  order_items: [
    { id: "i1", product_id: "p1", product_name: PRODUCTS[0].name, unit_price: 12, quantity: 120 },
    { id: "i2", product_id: "p3", product_name: PRODUCTS[2].name, unit_price: 22, quantity: 60 },
  ],
};

/** A cart the specs can assert totals against: 120×₪12 + 60×₪22 = ₪2,760. */
export const SEEDED_CART = {
  p1: { qty: 120, name: PRODUCTS[0].name, price: 12, sku: PRODUCTS[0].sku, picture_link: PRODUCTS[0].picture_link, display_qty: 12, display_name: "מארז" },
  p3: { qty: 60, name: PRODUCTS[2].name, price: 22, sku: PRODUCTS[2].sku, picture_link: PRODUCTS[2].picture_link },
};
export const SEEDED_CART_TOTAL = 120 * 12 + 60 * 22;

const json = (route: Route, body: unknown, headers: Record<string, string> = {}) =>
  route.fulfill({ status: 200, contentType: "application/json", headers, body: JSON.stringify(body) });

/** Install the interceptors. Call once per BrowserContext, before any goto. */
export async function mockSupabase(context: BrowserContext): Promise<void> {
  // Product images come from Rivhit through an edge function; neither is
  // reachable offline, so serve a tiny placeholder rather than let the request
  // fail and dirty the console-error assertion.
  await context.route(/api\.rivhit\.co\.il|functions\/v1\/rivhit-img/, (route) =>
    route.fulfill({
      status: 200, contentType: "image/svg+xml",
      body: "<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><rect width='240' height='240' fill='#F1EEF6'/></svg>",
    }),
  );

  await context.route(/\/auth\/v1\//, (route) => json(route, { ...SESSION }));

  // NB: regex, not a glob. Playwright's URL globs did not match the absolute
  // Supabase URLs here, so every request fell through unmocked and the app
  // booted with no data — the failure looked like a bug in the app rather than
  // in the harness. A regex on the path is unambiguous.
  await context.route(/\/rest\/v1\//, (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path.endsWith("/rpc/catalog_categories")) return json(route, CATEGORIES);
    if (path.endsWith("/rpc/search_products")) {
      return json(route, PRODUCTS.slice(0, 8).map((p, i) => ({ ...p, rank: 1 - i * 0.01, total: 8 })));
    }
    if (path.includes("/site_settings")) {
      return json(route, [
        { key: "min_order_total", value: "3500" },
        { key: "prices_include_vat", value: "true" },
      ]);
    }
    if (path.includes("/price_overrides")) return json(route, []);
    if (path.includes("/profiles")) return json(route, [PROFILE]);
    if (path.includes("/order_items")) return json(route, []);
    if (path.includes("/orders")) return json(route, [ORDER]);

    if (path.includes("/products")) {
      // Honour the filters the browse query actually sends, so a spec can prove
      // the category and price filters really narrow the result set.
      let rows = PRODUCTS.slice();
      const cat = url.searchParams.get("category");
      if (cat?.startsWith("eq.")) rows = rows.filter((r) => r.category === cat.slice(3));
      for (const [k, v] of url.searchParams.entries()) {
        if (k !== "price") continue;
        if (v.startsWith("gte.")) rows = rows.filter((r) => r.price >= Number(v.slice(4)));
        if (v.startsWith("lt.")) rows = rows.filter((r) => r.price < Number(v.slice(3)));
      }
      return json(route, rows, { "content-range": `0-${Math.max(0, rows.length - 1)}/${rows.length}` });
    }
    return json(route, []);
  });
}

/** Seed a signed-in session and a known cart before the app boots. */
export async function seedSession(context: BrowserContext, cart: unknown = SEEDED_CART): Promise<void> {
  await context.addInitScript(
    ([ref, session, c]) => {
      try {
        localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(session));
        localStorage.setItem("kt_cart_v2", JSON.stringify(c));
      } catch { /* private mode — the specs that need storage will say so */ }
    },
    [projectRef(), SESSION, cart] as const,
  );
}
