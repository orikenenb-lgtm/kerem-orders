# docs/AUDIT.md — מיפוי מצב קיים (Wave 0)

תאריך: 2026-07-23 · ענף עבודה: `feat/kerem-upgrade-2026` · גיבוי: ענף `backup/pre-upgrade-2026` + `backups/schema-before.sql`
מקורות: Mapper #1 (frontend), Mapper #2 (data layer), שאילתות ישירות ל-Supabase `mcdchalyzeqjkkgfeznd`.

---

## 0. פערים מהותיים בין הפרומט למציאות (לקרוא קודם!)

| הנחת הפרומט | המציאות בפועל | השלכה |
|---|---|---|
| יש קוד תלת-ממד (three.js / react-three) להסיר | **אין שום 3D בכלל.** אין תלות כזו. ה-hero הוא canvas frame-scrubbing על 120 תמונות | Wave 1 עדיין רלוונטי (יש מה לנקות ולהאיץ), פשוט "מסך פתיחה כבד" ולא "3D" |
| תמונות מוצרים בקבצים מקומיים לתקן עם sharp/EXIF | **התמונות מגיעות מרווחית בזמן אמת** (`picture_link`), לא בריפו ולא ב-Storage | Wave 2: אי אפשר סקריפט sharp על קבצים. התיקון חייב לקרות בפרוקסי-התמונות `rivhit-img` |
| לבנות סנכרון רווחית מאפס | **הסנכרון כבר קיים ועובד** (rivhit-sync, רץ יומית 03:00, קלט 915 מוצרים) | Wave 8 = שדרוג (תדירות, מסך ניהול, התראות), לא בנייה |
| מינימום הזמנה 3,500 ₪ | **הערך החי הוא 500 ₪** (`site_settings.min_order_total`) | ⚠️ החלטה עסקית — ראה §9 |
| טבלת "לקוחות/משתמשים" אחת | יש **profiles** (משתמשי אתר) ו-**customers** (מראה של רווחית) — שתי טבלאות | Wave 4: שדות כתובת יתווספו ל-profiles |
| ניקוי "פתיחת חשבון סיטונאי" | קיים ב-6 מקומות. "סיטונאות צעצועים" (תיאור העסק) נשאר | Wave 1 |

---

## 1. עץ ראוטים

| ראוט | תפקיד | התחברות | הערה |
|---|---|---|---|
| `/` | דף נחיתה שיווקי (ScrollHero + 3 sections) | לא | 12MB פריימים placeholder |
| `/login` | התחברות | לא | |
| `/register` | הרשמה דרך edge `signup` | לא | |
| `/catalog` | קטלוג מחובר + עגלה + checkout | **כן** | |
| `/account` | היסטוריית הזמנות | **כן** | |
| `/admin` | ניהול (הזמנות/קטלוג/לקוחות) | **מנהל** | |
| `/view` | קטלוג ציבורי בלי מחירים | לא | RPC `catalog_public` |
| `/prices` | קטלוג ציבורי עם מחירים | לא | RPC `catalog_public_prices` |

Stack: Next.js 15 (static export, basePath `/kerem-orders`), React 19, TypeScript, **בלי Tailwind** (הכל inline styles), design tokens ב-`lib/ui.ts`, פונטים Rubik+Assistant. 5 תלויות ריצה בלבד: supabase-js, framer-motion, next, react, react-dom.

## 2. עיצוב

- טוקנים: `landing/lib/ui.ts` (bg/surface/text/body/dim/border/accent + גרדיאנט קשת + rainbowColors).
- **סיכון drift:** הפלטה משוכפלת כ-const מקומיים ו-hex ידני ב-14 קבצים (admin 22, catalog 17, ClosingCTA 14, FeaturesSection 12, ScrollHero 11, PublicCatalog 7...). שינוי מיתוג = עריכה רוחבית ידנית. → Wave 7 יאחד לטוקנים.
- `globals.css` = 17 שורות בלבד (reset+rtl). אין service worker (PWA ללא offline).

## 3. חישובי מחיר/כמות (הליבה העסקית)

- `cartonSize()` (`catalog/page.tsx:30-39`) — regex על **שם המוצר החופשי** ("קרטון 864"/"ק 216"/"144 יח"). **שביר** — תלוי בסגנון הקלדה ברווחית. → Wave 3 מחליף במודל נתונים אמיתי.
- מתמטיקת הנחה: `lib/ui.ts` `discountPct`/`applyDiscount` — מקור אמת יחיד (תצוגה+עגלה+reconcile).
- עגלה: localStorage `kt_cart_v2`, מחיר שמור = אחרי הנחה.
- checkout `placeOrder` (256-380): reconcile מול DB → insert orders → insert order_items → fire-and-forget ל-`rivhit-push`.

## 4. סכמת DB (טבלאות עסקיות)

products (915 פעילים/7,246), orders (8), order_items (29), profiles (3), customers (548 מראה רווחית), site_settings (`min_order_total=500`), rivhit_sync_runs (44). RLS מופעל בכל מקום.
טבלאות זרות באותו DB (trades, wa_*, price_cache, news, setups) — פרויקטים אחרים, **מחוץ לתחום, לא נוגעים**.

## 5. פונקציות DB

`is_manager`, `search_products` (authenticated), `catalog_public`/`catalog_public_prices`/`catalog_public_categories` (anon), `catalog_categories`, `_get_rivhit_token` (service_role), טריגרי הנחה. כולן SECURITY DEFINER.

## 6. תזמון

pg_cron job יחיד: `rivhit-daily-sync`, `0 3 * * *` → POST ל-`rivhit-sync`. **פעם ביום.** (הפרומט מבקש כל 15 דק' — ראה Wave 8.)

## 7. Edge functions (כולן verify_jwt=false, אימות ידני בקוד)

- `signup` — יצירה+אישור משתמש, קידום `orikenen.b@gmail.com` ל-manager.
- `rivhit-sync` — משיכה יומית, exclude group 999 + /נגמר/, anti-wipe, deactivate-not-delete.
- `rivhit-push` — יצירת **הצעת מחיר (Document type 6)** בלבד, התאמת לקוח ח.פ→טלפון→אימייל→שם, אידמפוטנטי.
- `rivhit-img` — פרוקסי תמונות, allowlist מנורמל, resize w=480, JPEG 78, cache 30 יום.
- `rivhit-probe-*` ×4 — פונקציות אבחון ישנות, **עדיין ACTIVE ופתוחות**. → מומלץ להסיר (Wave 8/9).

## 8. תמונות ומלאי

- זרימת תמונה: `picture_link` → `rivhitImg(w=480)` → `rivhit-img` → CDN. אין תמונות בריפו/Storage.
- **EXIF orientation לא מטופל** — תמונה שצולמה מסובבת תוגש מסובבת, וה-recompress מוחק את דגל ה-EXIF. → Wave 2 יטפל בפרוקסי.
- מלאי: 915 פעילים — 628 חיובי, 26 אפס, **261 שלילי**. הכמויות ברווחית **לא אמינות** (מכאן הסרנו את הבאדג' מהקטלוג המחובר). **אבל** `/view` ו-`/prices` עדיין מחשבים `in_stock = stock_quantity>0` → ~287 מוצרים עלולים להיות מסומנים "לא במלאי" בטעות בעמודים הציבוריים.

## 9. ⚠️ סיכונים לתשומת ליבך (חלקם דורשים החלטה)

1. **מינימום הזמנה — client-only.** נאכף רק ב-UI. RLS על orders בודקת רק בעלות. **לקוח מהונדס יכול להזמין בכל סכום.** גם הסכום החי (500) ≠ מה שהפרומט מבקש (3,500), ו-NumbersSection מציג 500 hardcoded.
2. **שלמות מחירים — client-only.** `order_items.unit_price/quantity` לא מאומתים בשרת. הבלם היחיד: הצעת מחיר לא-חשבונאית + מייל למנהל (ביקורת אנושית). → Wave 3/5 יוסיף אכיפת שרת.
3. **הסנכרון היומי דורס עריכות אדמין** על name/description/category/price/picture_link/is_active/emoji. **עמודות חדשות (display_qty וכו') בטוחות** — upsert מעדכן רק עמודות שנשלחות. קריטי ל-Wave 3.
4. **rollback הזמנה יתומה לא עובד** (אין policy DELETE על orders).
5. **`rivhit-sync` פתוחה לגמרי** — אין בדיקת caller, וקטור עומס. + 4 probe functions פתוחות.
6. **אין הגנת טריגר על `profiles.role`** — לוודא שאין נתיב שלקוח מקדם עצמו ל-manager.
7. **התראות דרך formsubmit.co** — צד ג' חינמי, מסירה לא מובטחת.
8. **אין פרטי קשר באתר** — אין טלפון/footer/כתובת/תקנון. הפרומט מוסיף טלפון 050-852-4448 ב-Wave 1.
9. **manifest hardcoded ל-`/kerem-orders/`** — ישבר במעבר דומיין.

---

## מדיניות שדרוג (מהפרומט, מאומצת)

- **אדיטיבי בלבד.** אין DROP/מחיקת ראוט/שינוי חתימה. שינוי התנהגות = חדש-לצד-הישן.
- כל פיצ'ר מאחורי דגל ב-`landing/lib/featureFlags.ts`, ברירת מחדל `false`.
- כל מיגרציה עם `-- ROLLBACK:`.
- העבודה על `feat/kerem-upgrade-2026`. **main נשאר האתר החי** — feature branch בונה אבל לא נפרס לאתר (רק main נפרס), אז אפשר לעבוד בבטחה.
- שער איכות בין Waves: build ירוק, 0 שגיאות TS, זרימת הזמנה עובדת, כל הדגלים כבויים = התנהגות זהה למקור.
