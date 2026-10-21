import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import SiteHeader from "../../components/SiteHeader";
import SiteFooter from "../../components/SiteFooter";
import ProductImage from "../../components/ProductImage";
import { tokens } from "../../../lib/ui";
import { rivhitImg } from "../../../lib/images";
import { categoryAnchor, getPublicCatalog, PLACEHOLDER_ID } from "../../../lib/publicProducts";

// One public, indexable page per product — static HTML built at deploy from
// the public catalogue (see lib/publicProducts.ts for exactly what is read and
// why the build stops rather than publish an empty list). Name, photo and
// category only: prices stay for signed-in business customers, and the page
// says so with the two ways in (open an account / log in).

export const dynamicParams = false;

const SITE = "https://orikenenb-lgtm.github.io/kerem-orders";

export async function generateStaticParams() {
  const { products } = await getPublicCatalog();
  if (products.length === 0) return [{ id: PLACEHOLDER_ID }];
  return products.map((p) => ({ id: p.id }));
}

async function find(id: string) {
  const data = await getPublicCatalog();
  return { data, product: data.products.find((p) => p.id === id) };
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const { product } = await find(id);
  if (!product) return { title: "מוצר", robots: { index: false, follow: false } };
  const description = `${product.name} — ${product.category}. כרם טויס, יבוא ושיווק צעצועים בסיטונאות לחנויות ולעסקים, משלוח לכל הארץ. מחירים ללקוחות עסקיים רשומים.`;
  const image = rivhitImg(product.picture_link, 900, product.rotation_override ?? 0);
  return {
    title: product.name,
    description,
    // Relative to metadataBase (…/kerem-orders/) — no leading slash, or it
    // would resolve to the github.io root.
    alternates: { canonical: `p/${product.id}/` },
    openGraph: {
      type: "website",
      siteName: "כרם טויס",
      locale: "he_IL",
      title: product.name,
      description,
      url: `p/${product.id}/`,
      ...(image ? { images: [{ url: image, alt: product.name }] } : {}),
    },
  };
}

export default async function PublicProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data, product } = await find(id);
  if (!product) notFound();

  const related = data.products.filter((p) => p.category === product.category && p.id !== product.id).slice(0, 8);
  const anchor = categoryAnchor(data.categories, product.category);
  const crumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "כרם טויס", item: `${SITE}/` },
      { "@type": "ListItem", position: 2, name: "כל המוצרים", item: `${SITE}/p/` },
      { "@type": "ListItem", position: 3, name: product.name, item: `${SITE}/p/${product.id}/` },
    ],
  };

  const btn: React.CSSProperties = { fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.95rem", minHeight: 48, padding: "0.75rem 1.4rem", borderRadius: 999, textDecoration: "none", display: "inline-flex", alignItems: "center", justifyContent: "center" };

  return (
    <>
      <SiteHeader />
      <main id="main-content" tabIndex={-1} style={{ maxWidth: 1100, margin: "0 auto", padding: "clamp(1rem,4vw,2.5rem) clamp(1rem,4vw,2.5rem) 4rem" }}>
        <nav aria-label="נתיב" style={{ fontFamily: tokens.assistant, fontSize: "0.85rem", color: tokens.dim, marginBottom: "1rem", lineHeight: 1.6 }}>
          <Link href="/" style={{ color: tokens.accent, textDecoration: "none" }}>כרם טויס</Link>
          {" › "}
          <Link href={anchor ? `/p/#${anchor}` : "/p/"} style={{ color: tokens.accent, textDecoration: "none" }}>{product.category}</Link>
          {" › "}
          <span aria-current="page">{product.name}</span>
        </nav>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: "clamp(1rem,3vw,2.5rem)", alignItems: "start" }}>
          <div style={{ width: "100%", aspectRatio: "1 / 1", borderRadius: 16, background: "#fff", border: `1px solid ${tokens.border}`, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", padding: 12 }}>
            <ProductImage pictureLink={product.picture_link} name={product.name} width={900} rotation={product.rotation_override ?? 0} />
          </div>

          <div>
            <h1 style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "clamp(1.4rem,3.5vw,2.1rem)", color: tokens.text, lineHeight: 1.25, margin: 0, overflowWrap: "anywhere" }}>{product.name}</h1>
            <p style={{ fontFamily: tokens.assistant, fontSize: "0.95rem", color: tokens.body, margin: "0.6rem 0 0" }}>
              קטגוריה: <Link href={anchor ? `/p/#${anchor}` : "/p/"} style={{ color: tokens.accent }}>{product.category}</Link>
            </p>
            <p style={{ fontFamily: tokens.assistant, fontSize: "1rem", color: tokens.body, lineHeight: 1.6, margin: "1rem 0 0" }}>
              מוצר מקטלוג הסיטונאות של כרם טויס — יבוא ושיווק צעצועים לחנויות, לרשתות ולעסקים, עם משלוח לכל הארץ.
            </p>

            <section aria-label="מחירים והזמנה" style={{ marginTop: "1.3rem", border: `1px solid ${tokens.border}`, borderRadius: 16, background: tokens.surface, padding: "1rem 1.1rem" }}>
              <p style={{ fontFamily: tokens.rubik, fontWeight: 700, fontSize: "1.05rem", color: tokens.text, margin: 0 }}>המחירים מוצגים ללקוחות עסקיים רשומים</p>
              <p style={{ fontFamily: tokens.assistant, fontSize: "0.92rem", color: tokens.body, margin: "0.35rem 0 0", lineHeight: 1.55 }}>
                פותחים חשבון סיטונאי בחינם, ורואים את המחירים ומזמינים אונליין מכל הקטלוג.
              </p>
              <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", marginTop: "0.9rem" }}>
                <Link href="/register" style={{ ...btn, background: tokens.accent, color: "#fff" }}>פתיחת חשבון סיטונאי</Link>
                <Link href="/login" style={{ ...btn, background: "#fff", color: tokens.accent, border: `1.5px solid ${tokens.accent}` }}>התחברות ללקוחות</Link>
              </div>
            </section>

            <p style={{ fontFamily: tokens.assistant, fontSize: "0.92rem", margin: "1rem 0 0" }}>
              <Link href="/view" style={{ color: tokens.accent }}>לקטלוג המלא ←</Link>
            </p>
          </div>
        </div>

        {related.length > 0 && (
          <section aria-label={`עוד מ${product.category}`} style={{ marginTop: "2.5rem" }}>
            <h2 style={{ fontFamily: tokens.rubik, fontWeight: 800, fontSize: "1.25rem", color: tokens.text, margin: "0 0 0.8rem" }}>עוד מ{product.category}</h2>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "0.8rem" }}>
              {related.map((r) => (
                <li key={r.id}>
                  <Link href={`/p/${r.id}/`} style={{ display: "flex", flexDirection: "column", gap: "0.45rem", textDecoration: "none", border: `1px solid ${tokens.border}`, borderRadius: 14, background: "#fff", padding: "0.7rem", height: "100%" }}>
                    <span style={{ display: "flex", width: "100%", aspectRatio: "1 / 1", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                      <ProductImage pictureLink={r.picture_link} name={r.name} rotation={r.rotation_override ?? 0} />
                    </span>
                    <span style={{ fontFamily: tokens.rubik, fontWeight: 700, fontSize: "0.88rem", color: tokens.text, lineHeight: 1.3 }}>{r.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(crumbs).replace(/</g, "\\u003c") }} />
      </main>
      <SiteFooter />
    </>
  );
}
