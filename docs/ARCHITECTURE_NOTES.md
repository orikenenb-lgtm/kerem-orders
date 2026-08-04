# מבנה הפרויקט — מה חי, מה legacy, ומה מקור האמת

**סטטוס:** דוח והמלצות בלבד. שום קוד לא הוזז ולא נמחק.

## 1. שתי שכבות backend — למה, ומה באמת רץ

| שכבה | מיקום | מצב בפועל |
|---|---|---|
| FastAPI ‏(Python) | `app/` + `Dockerfile` + `railway.toml` + `tests/` | **Legacy.** גרסה מוקדמת של המערכת: שרת API עם סנכרון רווחית משלו, שנועד לרוץ על Railway. האתר החי **אינו** פונה אליו בשום מקום — אין אף `fetch` אליו ב-`landing/`. |
| Supabase ישיר | `landing/` (Next.js static) + Postgres/RLS/RPC/Edge Functions | **הפרודקשן האמיתי.** הפרונט מדבר ישירות עם Supabase (anon key + RLS), ההזמנות, הסנכרון מרווחית (pg_cron כל 15 ד׳), התמונות (rivhit-img) והחיפוש — הכול שם. |

ראיות: ‏`landing/lib/supabaseClient.ts` הוא הלקוח היחיד; אין כתובת של
שרת FastAPI בשום קובץ תחת `landing/`; ה-deploy היחיד המוגדר הוא GitHub
Pages (סטטי).

### המלצה

- להכריז רשמית: **מקור האמת = Supabase + `landing/`**.
- את `app/` **לא למחוק** (כלל הענף), אבל: להוסיף שורה ב-README שמסמנת
  אותו כ-legacy שאינו בשימוש, לוודא שאין לו deployment חי ב-Railway
  שעדיין רץ ומסנכרן (אם יש — לכבות, אחרת שני מסנכרנים ירוצו במקביל!),
  ולתכנן גריעה מסודרת בעתיד.
- `crps-presentation/` ו-`backups/` אינם חלק מהאתר — לא לגעת.

**נקודה לבדיקת הבעלים:** האם שרת Railway עדיין פעיל ומחויב בתשלום? אם
כן — לכבות אחרי אימות שהסנכרון של Supabase מכסה הכול.

## 2. קוד ה-Edge Functions לא נמצא בריפו

הפונקציות החיות בפרויקט Supabase ‏(`signup`, `rivhit-img`, `rivhit-push`,
`rivhit-sync`, `image-thumbs`, `detect-orientation` ועוד) פותחו ופרוסות
ישירות (דרך MCP/Dashboard) — **המקור שלהן לא בגיט**. אותו דבר לגבי
המיגרציות: תיקיית `supabase/` בריפו מכילה רק `discount-setup.sql` ורשימות
הערות, לא את המיגרציות שהוחלו בפועל.

הסיכונים: אי אפשר לשחזר פונקציה שנדרסה; code review בלתי אפשרי; ידע חבוי.

### איך להכניס אותן לריפו בלי לחשוף סודות

1. **משיכת המקור:** לכל פונקציה, להוריד את הקוד החי (Dashboard → Edge
   Functions → הצגת מקור, או `supabase functions download <name>` עם CLI
   מחובר) ולשמור תחת `supabase/functions/<name>/index.ts`.
2. **סודות נשארים בחוץ:** הפונקציות כבר כתובות נכון מהבחינה הזו — הן
   קוראות `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')` וסוד-סנכרון מ-Vault
   ‏(`_get_sync_secret()`), לא מחרוזות בקוד. לוודא ב-review שאף קובץ שמורד
   לא מכיל מפתח, ולהוסיף `supabase/.env*` ל-`.gitignore` ליתר ביטחון.
3. **מיגרציות:** מעתה כל שינוי סכימה נשמר כקובץ
   `supabase/migrations/<timestamp>_<name>.sql` עם בלוק ROLLBACK בתחתית
   (כפי שנעשה בגלי-השדרוג), גם כשהוא מוחל דרך MCP. עבור העבר — לייצא
   `pg_dump --schema-only` חד-פעמי כ-baseline.
4. **פריסה מהריפו:** מעבר ל-`supabase functions deploy` מ-CI (או לפחות
   ידנית מהריפו), כך שהריפו הופך למקור האמת והדשבורד לצריכה בלבד.

### rollback מסודר (אחרי שהקוד בריפו)

- פונקציה: ‏git revert לקובץ + ‏deploy מחדש. ה-Dashboard שומר גם גרסאות
  קודמות (`version` בכל פונקציה) — אפשר לחזור גם משם.
- סכימה: בלוק ה-ROLLBACK שבכל מיגרציה (קיים כבר ב-`docs/ROLLBACK.md`
  עבור גלי-השדרוג).
- פרונט: ‏revert של commit + דחיפה ל-main (ה-deploy אוטומטי).

## 3. סיכום המלצות בשורה

1. Supabase + `landing/` = מקור אמת יחיד; `app/` מסומן legacy (לא נמחק).
2. לוודא ששרת Railway הישן לא רץ במקביל.
3. להכניס את מקור ה-Edge Functions וה-migrations לריפו (בלי סודות) ולפרוס
   מהריפו בלבד מכאן והלאה.
