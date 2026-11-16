import type { Metadata } from "next";
import Link from "next/link";
import SiteHeader from "../components/SiteHeader";
import SiteFooter from "../components/SiteFooter";
import ui from "./p.module.css";
import { categoryAnchor, getPublicCatalog } from "../../lib/publicProducts";
import { featureFlags } from "../../lib/featureFlags";

// Every public product as a plain, crawlable list of links, grouped by
// category in the Rivhit group order — the page that leads Google (and anyone
// browsing) to each /p/<id>/ page. Static HTML built at deploy, like them.

export const metadata: Metadata = {
  title: "כל המוצרים",
  description: "כל הצעצועים בקטלוג הסיטונאות של כרם טויס, לפי קטגוריות — יבוא ושיווק צעצועים לחנויות ולעסקים, משלוח לכל הארץ.",
  alternates: { canonical: "p/" },
  // Flag off → the page is an empty shell pointing at /view: keep it out of Google.
  ...(featureFlags.ff_public_product_pages ? {} : { robots: { index: false, follow: true } }),
};

export default async function AllProductsPage() {
  const { categories, products } = await getPublicCatalog();
  // Categories in the server's (Rivhit) order; anything uncategorised last.
  const known = new Set(categories.map((c) => c.category));
  const groups = [
    ...categories.map((c) => ({ category: c.category, items: products.filter((p) => p.category === c.category) })),
    { category: "", items: products.filter((p) => !known.has(p.category)) },
  ].filter((g) => g.items.length > 0);

  return (
    <>
      <SiteHeader />
      <main id="main-content" tabIndex={-1} className={ui.main}>
        <section className={ui.banner} aria-labelledby="kt-all-title">
          <h1 id="kt-all-title" className={ui.bannerTitle}>כל המוצרים</h1>
          <p className={ui.bannerText}>
            {products.length > 0
              ? `${products.length.toLocaleString("he-IL")} צעצועים בקטלוג הסיטונאות של כרם טויס. המחירים וההזמנה — ללקוחות עסקיים רשומים.`
              : "הקטלוג זמין כרגע בקטלוג המלא."}
          </p>
          <p className={ui.bannerLinkWrap}>
            <Link href="/view" className={ui.bannerLink}>לקטלוג המלא עם תמונות ←</Link>
          </p>
        </section>

        {groups.length > 1 && (
          <nav aria-label="קטגוריות" className={ui.chips}>
            {groups.filter((g) => g.category).map((g) => (
              <a key={g.category} href={`#${categoryAnchor(categories, g.category)}`} className={ui.chip}>
                {g.category} ({g.items.length})
              </a>
            ))}
          </nav>
        )}

        {groups.map((g) => (
          <section key={g.category || "other"} id={g.category ? categoryAnchor(categories, g.category) : "cat-other"} aria-label={g.category || "שונות"} className={ui.group}>
            <h2 className={ui.groupTitle}>{g.category || "שונות"}</h2>
            <ul className={ui.list}>
              {g.items.map((p) => (
                <li key={p.id}>
                  <Link href={`/p/${p.id}/`} className={ui.listLink}>{p.name}</Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>
      <SiteFooter />
    </>
  );
}
