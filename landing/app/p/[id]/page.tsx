import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import SiteHeader from "../../components/SiteHeader";
import SiteFooter from "../../components/SiteFooter";
import ProductImage from "../../components/ProductImage";
import ui from "../p.module.css";
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

  return (
    <>
      <SiteHeader />
      <main id="main-content" tabIndex={-1} className={ui.main}>
        <nav aria-label="נתיב" className={ui.crumbs}>
          <Link href="/" className={ui.crumbLink}>כרם טויס</Link>
          {" › "}
          <Link href={anchor ? `/p/#${anchor}` : "/p/"} className={ui.crumbLink}>{product.category}</Link>
          {" › "}
          <span aria-current="page">{product.name}</span>
        </nav>

        <div className={ui.layout}>
          <div className={ui.imageFrame}>
            <ProductImage pictureLink={product.picture_link} name={product.name} width={900} rotation={product.rotation_override ?? 0} />
          </div>

          <div>
            <h1 className={ui.title}>{product.name}</h1>
            <p className={ui.catLine}>
              קטגוריה: <Link href={anchor ? `/p/#${anchor}` : "/p/"} className={ui.catLink}>{product.category}</Link>
            </p>
            <p className={ui.lead}>
              מוצר מקטלוג הסיטונאות של כרם טויס — יבוא ושיווק צעצועים לחנויות, לרשתות ולעסקים, עם משלוח לכל הארץ.
            </p>

            <section aria-label="מחירים והזמנה" className={ui.ctaBox}>
              <p className={ui.ctaTitle}>המחירים מוצגים ללקוחות עסקיים רשומים</p>
              <p className={ui.ctaText}>
                פותחים חשבון סיטונאי בחינם, ורואים את המחירים ומזמינים אונליין מכל הקטלוג.
              </p>
              <div className={ui.ctaRow}>
                <Link href="/register" className={ui.btnPrimary}>פתיחת חשבון סיטונאי</Link>
                <Link href="/login" className={ui.btnGhost}>התחברות ללקוחות</Link>
              </div>
            </section>

            <p className={ui.moreLink}>
              <Link href="/view">לקטלוג המלא ←</Link>
            </p>
          </div>
        </div>

        {related.length > 0 && (
          <section aria-label={`עוד מ${product.category}`} className={ui.related}>
            <h2 className={ui.relatedTitle}>עוד מ{product.category}</h2>
            <ul className={ui.relGrid}>
              {related.map((r) => (
                <li key={r.id}>
                  <Link href={`/p/${r.id}/`} className={ui.relCard}>
                    <span className={ui.relFrame}>
                      <ProductImage pictureLink={r.picture_link} name={r.name} rotation={r.rotation_override ?? 0} />
                    </span>
                    <span className={ui.relName}>{r.name}</span>
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
