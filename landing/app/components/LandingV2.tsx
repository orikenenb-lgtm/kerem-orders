"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import SiteHeader from "./SiteHeader";
import SiteFooter from "./SiteFooter";
import ProductImage from "./ProductImage";
import Reveal from "./premium/Reveal";
import HeroArt from "./home/HeroArt";
import { categoryEmoji, NEW_STOCK_CATEGORY, SALE_CATEGORY } from "./home/categoryEmoji";
import styles from "./LandingV2.module.css";
import { getMinOrderTotal } from "../../lib/siteSettings";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../lib/auth";
import { featureFlags } from "../../lib/featureFlags";
import {
  MIN_ORDER_FALLBACK,
  PHONE_DISPLAY,
  PHONE_TEL,
  BUSINESS_NAME,
  BUSINESS_TAGLINE,
} from "../../lib/config";

// Home page (behind ff_new_landing). 2026-11 premium redesign: a purple hero
// with a locally drawn toy scene, the REAL categories as pastel tiles, a small
// taste of real products, and the true ordering facts (minimum order from the
// DB, prices incl. VAT, phone). Every data block hides itself on error/empty —
// no placeholder data is ever shown as if it were real.

type Category = { category: string; n: number };
type Product = {
  id: string;
  name: string;
  picture_link: string | null;
  rotation_override: number | null;
  category: string | null;
};

// Pastel tile fills, rotated in order. Light fills always carry ink text.
const TILE_TONES = [styles.toneLav, styles.toneMint, styles.toneSky, styles.tonePeach, styles.tonePink, styles.toneSun];

const SHOWCASE_SIZE = 8;

const countLabel = (n: number) => (n === 1 ? "מוצר אחד" : `${n.toLocaleString("he-IL")} מוצרים`);

export default function LandingV2() {
  const { session } = useAuth();
  const signedIn = !!session;

  // Display-only: the enforced value lives in the DB and is read again in the
  // cart. Anon RLS exposes exactly this key; on any failure show the fallback.
  const [minOrder, setMinOrder] = useState(MIN_ORDER_FALLBACK);
  // null = loading, "error" = hide the section, [] = nothing to show (hidden).
  const [categories, setCategories] = useState<Category[] | null | "error">(null);
  const [products, setProducts] = useState<Product[] | null | "error">(null);

  useEffect(() => {
    getMinOrderTotal().then(setMinOrder);
  }, []);

  useEffect(() => {
    let alive = true;
    supabase.rpc("catalog_public_categories").then(
      ({ data, error }) => {
        if (!alive) return;
        if (error || !Array.isArray(data)) {
          setCategories("error");
          return;
        }
        setCategories(
          (data as Category[]).filter((c) => typeof c?.category === "string" && c.category.trim() !== "" && Number(c.n) > 0),
        );
      },
      () => {
        if (alive) setCategories("error");
      },
    );
    supabase.rpc("catalog_public", { q: null, cat: "all", lim: SHOWCASE_SIZE, off: 0 }).then(
      ({ data, error }) => {
        if (!alive) return;
        if (error || !Array.isArray(data)) {
          setProducts("error");
          return;
        }
        setProducts((data as Product[]).filter((p) => p?.id && p?.name).slice(0, SHOWCASE_SIZE));
      },
      () => {
        if (alive) setProducts("error");
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  // Guests browse the public catalogue (no prices); customers their own.
  const catalogBase = signedIn ? "/catalog/" : "/view/";
  const catHref = (name: string) => `${catalogBase}?cat=${encodeURIComponent(name)}`;
  // The showcase reads the live catalogue, but /p/<id>/ pages are generated at
  // deploy time (daily) — a product added since then would 404. Link to the
  // product's category in the catalogue instead, which always exists.
  const productHref = (category: string | null | undefined) => (category ? catHref(category) : catalogBase);

  const catList = Array.isArray(categories) ? categories : [];
  const newStock = catList.find((c) => c.category === NEW_STOCK_CATEGORY);
  const sale = catList.find((c) => c.category === SALE_CATEGORY);
  const minOrderText = (
    <span className={styles.num}>{minOrder.toLocaleString("he-IL")} ₪</span>
  );

  return (
    <>
      <SiteHeader />
      <main id="main-content" tabIndex={-1} className={styles.main}>
        {/* ---------------- HERO ---------------- */}
        <section className={styles.hero} aria-labelledby="home-title">
          <div className={styles.heroText}>
            <p className={styles.eyebrow}>
              <span aria-hidden="true">🚚</span> ללקוחות עסקיים · משלוח לכל הארץ
            </p>
            <h1 id="home-title" className={styles.title}>
              <span className={styles.brand}>{BUSINESS_NAME}</span>{" "}
              <span className={styles.tagline}>{BUSINESS_TAGLINE}</span>
            </h1>
            <p className={styles.lead}>
              קטלוג צעצועים ומתנות לחנויות ולעסקים: צופים במוצרים, מזמינים אונליין, וכל המחירים כוללים מע״מ.
            </p>

            <div className={styles.actions}>
              {signedIn ? (
                <Link href="/catalog" className={`${styles.btn} ${styles.btnPrimary}`}>
                  לקטלוג
                </Link>
              ) : (
                <>
                  <Link href="/login" className={`${styles.btn} ${styles.btnPrimary}`}>
                    כניסה לחשבון
                  </Link>
                  <Link href="/register" className={`${styles.btn} ${styles.btnGhost}`}>
                    פתיחת חשבון לקוח
                  </Link>
                </>
              )}
            </div>

            <div className={styles.heroLinks}>
              {!signedIn && featureFlags.ff_rivhit_express && (
                // The door for existing Rivhit customers (ExpressForm).
                <Link href="/login/?tab=express" className={styles.heroLink}>
                  כבר קונים אצלנו? כניסה מהירה עם ח״פ או טלפון ←
                </Link>
              )}
              <Link href="/view" className={styles.heroLink}>
                לצפייה בקטלוג — בלי צורך בחשבון ←
              </Link>
            </div>
          </div>

          <div className={styles.heroArt}>
            <HeroArt />
          </div>
        </section>

        {/* ---------------- HIGHLIGHTS (only real categories) ---------------- */}
        {/* While the category list is still loading, hold the row's space so
            the sections below do not jump down when it arrives (it is the
            first thing under the hero; measured CLS 0.09–0.10 on phones). */}
        {categories === null && (
          <section className={styles.section} aria-hidden="true">
            <div className={styles.highlights}>
              <span className={`${styles.highlight} ${styles.skeleton} ${styles.highlightSkel}`} />
              <span className={`${styles.highlight} ${styles.skeleton} ${styles.highlightSkel}`} />
            </div>
          </section>
        )}
        {(newStock || sale) && (
          <section className={styles.section} aria-label="חדש במלאי ומבצעים">
            <Reveal>
              <div className={styles.highlights}>
                {newStock && (
                  <Link href={catHref(newStock.category)} className={`${styles.highlight} ${styles.highlightNew}`}>
                    <span className={styles.highlightEmoji} aria-hidden="true">🆕</span>
                    <span className={styles.highlightBody}>
                      <span className={styles.highlightTitle}>חדש במלאי</span>
                      <span className={styles.highlightSub}>{countLabel(newStock.n)} בקטגוריה <span className={styles.num}>״{newStock.category}״</span></span>
                    </span>
                    <span className={styles.highlightArrow} aria-hidden="true">←</span>
                  </Link>
                )}
                {sale && (
                  <Link href={catHref(sale.category)} className={`${styles.highlight} ${styles.highlightSale}`}>
                    <span className={styles.highlightEmoji} aria-hidden="true">🏷️</span>
                    <span className={styles.highlightBody}>
                      <span className={styles.highlightTitle}>מבצעים: {sale.category}</span>
                      <span className={styles.highlightSub}>{countLabel(sale.n)} בקטגוריה</span>
                    </span>
                    <span className={styles.highlightArrow} aria-hidden="true">←</span>
                  </Link>
                )}
              </div>
            </Reveal>
          </section>
        )}

        {/* ---------------- CATEGORIES ---------------- */}
        {categories !== "error" && !(Array.isArray(categories) && categories.length === 0) && (
          <section className={styles.section} aria-labelledby="home-cats">
            <Reveal>
              <div className={styles.sectionHead}>
                <h2 id="home-cats" className={styles.h2}>קטגוריות</h2>
                <p className={styles.sectionSub}>בוחרים קטגוריה ונכנסים ישר למוצרים שלה</p>
              </div>
              {categories === null ? (
                <div className={styles.catGrid} role="status">
                  <span className={styles.srOnly}>טוען קטגוריות…</span>
                  {Array.from({ length: 8 }, (_, i) => (
                    <span key={i} className={`${styles.catTile} ${styles.skeleton}`} aria-hidden="true" />
                  ))}
                </div>
              ) : (
                <ul className={styles.catGrid}>
                  {categories.map((c, i) => (
                    <li key={c.category} className={styles.catItem}>
                      <Link href={catHref(c.category)} className={`${styles.catTile} ${TILE_TONES[i % TILE_TONES.length]}`}>
                        <span className={styles.catEmoji} aria-hidden="true">{categoryEmoji(c.category)}</span>
                        <span className={styles.catName}>{c.category}</span>
                        <span className={styles.catCount}>{countLabel(c.n)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Reveal>
          </section>
        )}

        {/* ---------------- PRODUCT SHOWCASE (public data, no prices) ---------------- */}
        {products !== "error" && !(Array.isArray(products) && products.length === 0) && (
          <section className={styles.section} aria-labelledby="home-products">
            <Reveal>
              <div className={styles.sectionHead}>
                <h2 id="home-products" className={styles.h2}>הצצה לקטלוג</h2>
                <Link href={signedIn ? "/catalog" : "/view"} className={styles.moreLink}>
                  לכל הקטלוג ←
                </Link>
              </div>
              {products === null ? (
                <div className={styles.prodGrid} role="status">
                  <span className={styles.srOnly}>טוען מוצרים…</span>
                  {Array.from({ length: 4 }, (_, i) => (
                    <span key={i} className={styles.prodCard} aria-hidden="true">
                      <span className={`${styles.prodFrame} ${styles.skeleton}`} />
                      <span className={`${styles.skelLine} ${styles.skeleton}`} />
                    </span>
                  ))}
                </div>
              ) : (
                <ul className={styles.prodGrid}>
                  {products.map((p) => (
                    <li key={p.id} className={styles.catItem}>
                      <Link href={productHref(p.category)} className={styles.prodCard}>
                        <span className={styles.prodFrame}>
                          <ProductImage pictureLink={p.picture_link} name={p.name} rotation={p.rotation_override} width={480} />
                        </span>
                        <span className={styles.prodName}>{p.name}</span>
                        {p.category && <span className={styles.prodCat}>{p.category}</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Reveal>
          </section>
        )}

        {/* ---------------- HOW IT WORKS (verified facts only) ---------------- */}
        <section className={styles.section} aria-labelledby="home-how">
          <Reveal>
            <div className={styles.sectionHead}>
              <h2 id="home-how" className={styles.h2}>איך מזמינים?</h2>
            </div>
            <ol className={styles.steps}>
              <li className={`${styles.step} ${styles.toneLav}`}>
                <span className={styles.stepNum} aria-hidden="true">1</span>
                <span className={styles.stepTitle}>פותחים חשבון לקוח</span>
                <span className={styles.stepText}>נרשמים באתר כלקוח עסקי — ואז רואים את הקטלוג עם המחירים.</span>
              </li>
              <li className={`${styles.step} ${styles.toneMint}`}>
                <span className={styles.stepNum} aria-hidden="true">2</span>
                <span className={styles.stepTitle}>מזמינים אונליין</span>
                <span className={styles.stepText}>בוחרים מוצרים מהקטלוג ושולחים הזמנה מהאתר.</span>
              </li>
              <li className={`${styles.step} ${styles.toneSun}`}>
                <span className={styles.stepNum} aria-hidden="true">3</span>
                <span className={styles.stepTitle}>
                  <span aria-hidden="true">🛒 </span>מינימום הזמנה: {minOrderText}
                </span>
                <span className={styles.stepText}>
                  <span aria-hidden="true">🧾 </span>כל המחירים כוללים מע״מ
                </span>
              </li>
              <li className={`${styles.step} ${styles.toneSky}`}>
                <span className={styles.stepNum} aria-hidden="true">4</span>
                <span className={styles.stepTitle}>משלוח לכל הארץ</span>
                <span className={styles.stepText}>יש שאלה? מתקשרים אלינו.</span>
              </li>
            </ol>
          </Reveal>
        </section>

        {/* ---------------- CONTACT ---------------- */}
        <section className={styles.section} aria-label="יצירת קשר">
          <Reveal>
            <div className={styles.contact}>
              <p className={styles.contactText}>להזמנות ושאלות — דברו איתנו</p>
              <a href={`tel:${PHONE_TEL}`} className={`${styles.btn} ${styles.btnPrimary} ${styles.phone}`}>
                <span aria-hidden="true">📞</span>
                <span className={styles.srOnly}>להזמנות ושאלות:</span>
                <span dir="ltr">{PHONE_DISPLAY}</span>
              </a>
            </div>
            <p className={styles.quietLinks}>
              {/* The statement page must stay reachable (IS 5568) even though the
                  floating widget was removed — a quiet text link, not a button. */}
              <Link href="/accessibility" className={styles.quietLink}>
                הצהרת נגישות
              </Link>
              {/* The crawlable route to every public product page (ff_public_product_pages). */}
              {featureFlags.ff_public_product_pages && (
                <>
                  <span aria-hidden="true"> · </span>
                  <Link href="/p/" className={styles.quietLink}>
                    כל המוצרים
                  </Link>
                </>
              )}
            </p>
          </Reveal>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
