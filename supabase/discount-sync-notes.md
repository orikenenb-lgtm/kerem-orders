# סנכרון הנחות קבועות מרווחית — הערות למימוש עתידי

המצב היום (אחרי `discount-setup.sql` + ה-PR של הפיצ'ר):

- `profiles.discount_percent` — ההנחה שהלקוח **מקבל בפועל** באתר. המנהל קובע אותה
  במסך ניהול → לקוחות (שדה "🎁 הנחה קבועה"). זה מסלול העבודה המלא כבר עכשיו.
- `customers.discount_percent` — מוכן לקליטת ההנחה מרווחית, עדיין לא מוזן.

## שלב עתידי (אופציונלי): מילוי אוטומטי מרווחית

חשוב: **שם השדה של ההנחה ב-Customer.List של רווחית לא אומת עדיין** (אין תיעוד
בריפו; המועמדים: `discount_percent`, `discount`, `customer_discount`). לפני כל
מימוש יש לגלות את השם האמיתי באחת משתי דרכים:

1. להריץ (ממחשב עם גישה לרווחית) את הסקריפט הקיים בריפו `ai-assistant`:
   `RIVHIT_API_TOKEN=... python3 backend/scripts/check_rivhit_discounts.py`
   — הוא קורא Customer.List (קריאה בלבד), מגלה אוטומטית את שדות ההנחה ומדפיס
   מי מהלקוחות מחזיק הנחה וכמה.
2. או להסתכל על רשומת לקוח אחת ב-`rivhit_sync_runs`/לוג של פונקציית הסנכרון.

אחרי שהשם ידוע, הפאץ' לפונקציית ה-Edge `rivhit-sync` (שקוראת Customer.List):

```ts
// בתוך מיפוי הלקוח, לצד name/phone/email:
discount_percent: Number(c.<REAL_FIELD_NAME>) || 0,
```

ואז העתקה ל-profiles המקושרים (אפשר כ-SQL בסוף הסנכרון או טריגר):

```sql
-- שים לב: בלי תנאי "> 0" — כדי שהנחה שבוטלה ברווחית תתאפס גם באתר.
update public.profiles p
set discount_percent = c.discount_percent
from public.customers c
where p.rivhit_customer_id = c.rivhit_id
  and p.discount_percent is distinct from c.discount_percent;
```

⚠️ לפני הפעלת ההעתקה האוטומטית, להחליט על מדיניות: היא **דורסת** הנחות שהמנהל
קבע ידנית באתר (רווחית הופכת למקור האמת היחיד). אם רוצים לשמר קביעה ידנית —
להוסיף עמודת `discount_source` ('manual'/'rivhit') ולדלג על שורות manual.

הערה: הטריגר `trg_protect_discount_percent` (מ-discount-setup.sql) מתיר עדכון
בהקשר שרת (auth.uid() ריק), כך שהסנכרון לא ייחסם.

עד אז — קביעה ידנית ע"י המנהל עובדת מקצה לקצה, והסנכרון האוטומטי הוא שיפור
נוחות בלבד. רווחית נשארת תמיד קריאה-בלבד.
