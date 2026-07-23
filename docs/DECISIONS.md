# DECISIONS.md — החלטות ארכיטקטוניות

## D-001: גיבוי כענף במקום tag
דחיפת git tag נחסמת ע"י proxy הסביבה (403). במקומו: ענף `backup/pre-upgrade-2026` שמצביע על אותו commit של main. שקול פונקציונלית, גלוי יותר ב-GitHub.

## D-002: דגלי פיצ'ר ב-lib/featureFlags.ts (לא src/config)
הפרויקט לא משתמש בתיקיית `src/` — הקונבנציה הקיימת היא `landing/lib/`. הדגלים סטטיים בקוד (build-time): האתר הוא static export ללא שרת, אז דגל = קבוע שמוחלף ב-build. הדלקה = שינוי `false→true` + דיפלוי; כיבוי = ההפך. עומד בדרישת "הפיך תוך 30 שניות" (revert commit קטן).

## D-003: תיקון תמונות בפרוקסי, לא בסקריפט sharp
אין קבצי תמונות מקומיים — הכל מוגש מרווחית דרך edge function `rivhit-img`. תיקון EXIF orientation יתבצע שם (בזמן ה-resize הקיים), עם דגל, במקום סקריפט חד-פעמי על קבצים שלא קיימים.

## D-004: עמודות Wave 3 (display_qty וכו') בטוחות מהסנכרון
אומת בקוד `rivhit-sync` v7: ה-upsert שולח רשימת עמודות סגורה (name, price, sku, barcode, group_id, category, stock_quantity, picture_link, emoji, in_stock, is_active, updated_at). עמודה חדשה שלא ברשימה לא נדרסת. לכן שדות הדיספליי ינוהלו באדמין ויחיו לצד הסנכרון בלי התנגשות.

## D-005: אכיפת שרת למינימום ולמחירים — טריגר DB ולא edge function
האתר static — אין שרת אפליקציה. נקודת האכיפה האמינה היחידה בין הלקוח ל-DB היא PostgreSQL עצמו (טריגר/constraint על orders+order_items). יתווסף ב-Wave 3/5 מאחורי דגל DB (site_settings) כדי לעמוד ב"אדיטיבי + הפיך".
