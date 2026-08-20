import type { MetadataRoute } from "next";

// Static sitemap for the public, indexable routes only. The auth screens are
// transactional and the /admin area is noindex, so neither belongs here.
// /prices/ was listed here and is not any more — it is the wholesale price list
// and is now noindex; see app/prices/layout.tsx for why.
// Emitted at build to out/sitemap.xml (served under the /kerem-orders basePath);
// submit it once to Google Search Console for discovery.
// Required so the route is emitted as a static file under `output: export`.
export const dynamic = "force-static";

const BASE = "https://orikenenb-lgtm.github.io/kerem-orders";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${BASE}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/view/`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${BASE}/accessibility/`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
