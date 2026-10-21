import type { Metadata } from "next";
import Link from "next/link";
import SiteHeader from "../components/SiteHeader";
import SiteFooter from "../components/SiteFooter";
import { tokens } from "../../lib/ui";
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
      <main id="main-content" tabIndex={-1} style={{ maxWidth: 1100, margin: "0 auto", padding: "clamp(1rem,4vw,2.5rem) clamp(1rem,4vw,2.5rem) 4rem" }}>
        <h1 style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "clamp(1.5rem,4vw,2.2rem)", color: tokens.text, margin: 0 }}>כל המוצרים</h1>
        <p style={{ fontFamily: tokens.assistant, fontSize: "1rem", color: tokens.body, lineHeight: 1.6, maxWidth: 720, margin: "0.6rem 0 0" }}>
          {products.length > 0
            ? `${products.length.toLocaleString("he-IL")} צעצועים בקטלוג הסיטונאות של כרם טויס. המחירים וההזמנה — ללקוחות עסקיים רשומים.`
            : "הקטלוג זמין כרגע בקטלוג המלא."}
        </p>
        <p style={{ fontFamily: tokens.assistant, fontSize: "0.95rem", margin: "0.6rem 0 0" }}>
          <Link href="/view" style={{ color: tokens.accent }}>לקטלוג המלא עם תמונות ←</Link>
        </p>

        {groups.length > 1 && (
          <nav aria-label="קטגוריות" style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem", marginTop: "1.2rem" }}>
            {groups.filter((g) => g.category).map((g) => (
              <a key={g.category} href={`#${categoryAnchor(categories, g.category)}`}
                style={{ fontFamily: tokens.assistant, fontSize: "0.88rem", color: tokens.text, textDecoration: "none", border: `1px solid ${tokens.border}`, borderRadius: 999, padding: "0.4rem 0.85rem", background: "#fff", minHeight: 36, display: "inline-flex", alignItems: "center" }}>
                {g.category} ({g.items.length})
              </a>
            ))}
          </nav>
        )}

        {groups.map((g) => (
          <section key={g.category || "other"} id={g.category ? categoryAnchor(categories, g.category) : "cat-other"} aria-label={g.category || "שונות"} style={{ marginTop: "2rem", scrollMarginTop: "5rem" }}>
            <h2 style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.25rem", color: tokens.text, margin: "0 0 0.6rem" }}>{g.category || "שונות"}</h2>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 260px), 1fr))", gap: "0.15rem 1.2rem" }}>
              {g.items.map((p) => (
                <li key={p.id}>
                  <Link href={`/p/${p.id}/`} style={{ fontFamily: tokens.assistant, fontSize: "0.95rem", color: tokens.body, textDecoration: "none", display: "block", padding: "0.4rem 0", borderBottom: `1px solid ${tokens.border}` }}>{p.name}</Link>
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
