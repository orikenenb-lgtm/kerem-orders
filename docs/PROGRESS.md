# PROGRESS.md — יומן חי של שדרוג 2026

## Wave 0 — מיפוי (2026-07-23) ✅
- הוקם ענף `feat/kerem-upgrade-2026`; גיבוי מצב קיים בענף `backup/pre-upgrade-2026` (דחיפת tag נחסמה ע"י ה-proxy של הסביבה — ענף גיבוי שקול ובטוח יותר).
- נכתב `backups/schema-before.sql` — צילום סכמה, RLS, פונקציות, cron.
- שני Mapper agents מיפו frontend + data layer; הדו"חות אוחדו ל-`docs/AUDIT.md`.
- **ממצאים מרכזיים:** אין 3D בכלל (ה-hero הוא 12MB פריימים placeholder); תמונות מרווחית דרך פרוקסי (אין EXIF handling); סנכרון קיים ורץ יומית; מינימום הזמנה חי = ₪500 (הפרומט מבקש 3,500 — ממתין להחלטה); מינימום ומחירים נאכפים client-only; הסנכרון דורס עריכות אדמין על עמודות מסונכרנות (עמודות חדשות בטוחות).
- קבצים שנוצרו: `docs/AUDIT.md`, `docs/PROGRESS.md`, `docs/DECISIONS.md`, `backups/schema-before.sql`, `landing/lib/featureFlags.ts`.
- נשבר: כלום. לא שונה קוד קיים.

⏸️ עצירה לאישור AUDIT לפני Wave 1, כנדרש בפרומט.
