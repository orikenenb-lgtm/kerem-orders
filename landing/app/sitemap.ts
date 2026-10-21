import type { MetadataRoute } from "next";
import { getPublicCatalog } from "../lib/publicProducts";

// Static sitemap for the public, indexable routes only. The auth screens are
// transactional and the /admin area is noindex, so neither belongs here.
// /prices/ was listed here and is not any more — it is the wholesale price list
// and is now noindex; see app/prices/layout.tsx for why.
// The public product pages (/p/ and /p/<id>/, ff_public_product_pages) are
// listed from the same build-time list that generates them.
// Emitted at build to out/sitemap.xml (served under the /kerem-orders basePath);
// submit it once to Google Search Console for discovery.
// Required so the route is emitted as a static file under `output: export`.
export const dynamic = "force-static";

const BASE = "https://orikenenb-lgtm.github.io/kerem-orders";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { products } = await getPublicCatalog();
  return [
    { url: `${BASE}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/view/`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${BASE}/accessibility/`, changeFrequency: "yearly", priority: 0.3 },
    ...(products.length > 0
      ? [
          { url: `${BASE}/p/`, changeFrequency: "daily" as const, priority: 0.8 },
          ...products.map((p) => ({ url: `${BASE}/p/${p.id}/`, changeFrequency: "weekly" as const, priority: 0.6 })),
        ]
      : []),
  ];
}
