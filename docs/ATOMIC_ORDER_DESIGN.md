# תכנון: יצירת הזמנה אטומית בצד השרת

**סטטוס:** מסמך תכנון בלבד — שום דבר מכאן לא יושם. אין שינויי DB בענף הזה.

## 1. הבעיה היום (`placeOrder` ב-`landing/app/catalog/page.tsx`)

הזרימה הנוכחית, כולה מהדפדפן:

1. קריאת פרופיל (הנחה עדכנית) — `SELECT profiles`.
2. Reconcile של העגלה מול `products` (מחיר/זמינות/כמויות מארז) — צד לקוח.
3. בדיקת מינימום הזמנה — צד לקוח.
4. `INSERT INTO orders … RETURNING id`.
5. `INSERT INTO order_items …` (קריאה **נפרדת**).
6. אם 5 נכשל — `DELETE FROM orders WHERE id=…` **best-effort** בלבד.
7. קריאה ל-edge function ‏`rivhit-push` לדחיפת ההזמנה לרווחית.

חולשות מובנות:

- **לא אטומי.** בין 4 ל-5 יכול ליפול רשת/סגירת טאב → הזמנה בלי שורות.
  ה-DELETE בסעיף 6 הוא ניסיון תיקון, לא ערובה (אם ה-RLS יחסם/הרשת נפלה —
  ההזמנה היתומה נשארת).
- **המחירים מהלקוח.** ה-reconcile הוגן אבל רץ בדפדפן; לקוח מהונדס יכול
  לשלוח `unit_price` שרירותי ב-INSERT. (יש טריגרים `validate_order_min` /
  `validate_order_item` שנוספו בגל 5 — אבל הם בודקים מינימום/כמויות,
  והפעלתם תלויה ב-`site_settings.enforce_order_rules`.)
- **אין idempotency.** לחיצה כפולה/רענון באמצע → שתי הזמנות.
- **rivhit-push לפני ודאות.** נקרא אחרי ה-INSERTs מהדפדפן; אם הדחיפה
  מצליחה וההזמנה נכשלה חלקית (או להפך) — אין עסקה אחת שמסנכרנת ביניהם.

## 2. העיצוב המוצע — RPC אחד: `place_order(payload jsonb, client_key uuid)`

פונקציית SQL ‏`SECURITY DEFINER` (או Edge Function שקוראת לה — ראו §4),
המקבלת את העגלה **ללא מחירים** ומחזירה את ההזמנה שנוצרה:

```jsonc
// payload שנשלח מהלקוח — שימו לב: אין מחיר בשום מקום
{
  "items": [ { "product_id": "…", "qty": 24 }, … ],
  "note": "…",
  "contact_name": "…",
  "contact_phone": "…"
}
```

### צעדי הפונקציה (הכול בטרנזקציה אחת)

1. **אימות משתמש:** `auth.uid()` חייב להיות לא-NULL; ההזמנה נרשמת עליו
   בלבד (לא מקבלים `user_id` מהלקוח).
2. **Idempotency:** `client_key` (UUID שהלקוח מגריל פעם אחת לכל ניסיון
   הזמנה ושומר עד הצלחה) נבדק מול עמודת `orders.client_key UNIQUE`.
   אם קיים — מחזירים את ההזמנה הקיימת במקום ליצור חדשה. לחיצה כפולה
   הופכת ל-no-op.
3. **נעילת מוצרים וחישוב מחדש בצד השרת:**
   `SELECT id, price, is_active, display_qty, order_step, … FROM products
   WHERE id = ANY(…) FOR SHARE` —
   - מוצר לא פעיל → החזרת שגיאה מפורטת (שם המוצר) — ההזמנה כולה נדחית.
   - כמות מיושרת ל-step/מארז בשרת (אותה לוגיקה של `lib/quantity.ts`,
     משוכתבת ב-SQL/plpgsql — מקור אמת יחיד חדש).
   - מחיר שורה: `products.price` העדכני × הנחת הלקוח מ-`profiles.
     discount_percent` (נקרא בשרת!). המחיר שהלקוח ראה לא משנה — מה שנקבע
     בשרת הוא שנשמר, וה-UI מציג למשתמש את הסכום שחושב בשרת לפני אישור
     סופי (קריאת "תצוגה מקדימה" נפרדת עם אותו קוד — ראו §5).
4. **מינימום הזמנה:** `SUM(line_total) >= site_settings.min_order_total`
   — אחרת שגיאה. (הטריגר הקיים נשאר כהגנת עומק.)
5. **INSERT orders + order_items** באותה טרנזקציה. כשל בכל שלב → ROLLBACK
   מלא, שום רשומה לא נשארת.
6. **תור דחיפה לרווחית:** במקום לקרוא ל-rivhit-push מהדפדפן — הפונקציה
   כותבת שורה ל-`rivhit_push_queue (order_id, status='pending')` באותה
   טרנזקציה. worker ‏(pg_cron כל דקה / edge function מתוזמנת) דוחף
   לרווחית **רק הזמנות ש-committed**, עם retry ו-status. כך רווחית לא
   מקבלת טיוטות של הזמנות שנכשלו, וכשל ברווחית לא מפיל את ההזמנה.
7. החזרה: `{ order_id, total, lines: [...] }`.

### הרשאות

- `GRANT EXECUTE ON FUNCTION place_order TO authenticated;` בלבד.
- אחרי ההטמעה: `REVOKE INSERT ON orders, order_items FROM authenticated` —
  ה-RPC נהיה הדרך היחידה ליצור הזמנה, ובכך נסגר גם וקטור ה"מחיר מהלקוח".

## 3. שינויי סכימה נדרשים (additive בלבד)

```sql
ALTER TABLE orders ADD COLUMN client_key uuid UNIQUE;          -- idempotency
CREATE TABLE rivhit_push_queue (
  order_id uuid PRIMARY KEY REFERENCES orders(id),
  status   text NOT NULL DEFAULT 'pending',                    -- pending|done|error
  attempts int  NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

שניהם additive; ‏ROLLBACK: ‏`DROP TABLE rivhit_push_queue; ALTER TABLE
orders DROP COLUMN client_key;`.

## 4. RPC או Edge Function?

**המלצה: RPC ‏(plpgsql).** הטרנזקציה טבעית, אין hop רשת נוסף, ואין צורך
בגישה ל-API חיצוני בזמן ההזמנה (הדחיפה לרווחית יוצאת מה-worker). Edge
Function נשארת רק ל-worker של התור (היא ממילא קיימת — `rivhit-push` —
ותוסב לקרוא מהתור במקום מהדפדפן).

## 5. צד לקוח אחרי המעבר

- `placeOrder` מצטמצם ל: הגרלת `client_key` (פעם אחת, נשמר ב-state עד
  הצלחה) → `rpc('place_order', …)` → הצגת תוצאה/שגיאה. כל ה-reconcile
  המקומי נשאר רק כ-UX (הצגת "המחיר התעדכן" לפני שליחה), לא כהגנה.
- שגיאות מהשרת ממופות להודעות העבריות הקיימות (אזל / מינימום / כמות).

## 6. סדר הטמעה בטוח (כשיאושר)

1. מיגרציה additive (§3) — לא משנה שום התנהגות קיימת.
2. יצירת `place_order` + בדיקות ידניות מול DB staging/עותק.
3. העברת הפרונט לקרוא ל-RPC (feature flag: ‏`ff_atomic_order`).
4. אחרי אימות בפרודקשן: ‏REVOKE INSERT הישיר.
5. הסבת `rivhit-push` לצריכת התור.

כל שלב הפיך בנפרד.
