# ROLLBACK.md — איך מחזירים כל דבר אחורה

עיקרון: כל שינוי הפיך באחת משלוש דרכים — כיבוי דגל (שורה אחת), ROLLBACK של מיגרציה (מתועד בכל מיגרציה), או revert של קומיט. האתר החי נפרס רק מ-main.

## 1. דגלי פיצ'ר (הכי מהיר — שורה אחת + דיפלוי)

`landing/lib/featureFlags.ts` — להפוך `true` ל-`false`, קומיט ל-main, הפריסה רצה אוטומטית (~2 דק').

| דגל | מה הוא מדליק |
|---|---|
| ff_new_landing | מסך הפתיחה החדש (כבוי = הדף הישן) |
| ff_display_quantities | הזמנה במארזים שלמים בקטלוג |
| ff_register_address | שדות כתובת בהרשמה |
| ff_min_order_vat_ui | סרגל מינימום + פירוט מע"מ בעגלה |
| ff_a11y_widget | ווידג'ט הנגישות |
| ff_new_theme | העיצוב החדש |

## 2. מתגי שרת (בלי דיפלוי בכלל — SQL אחד)

- **אכיפת הזמנות (מינימום/מחירים/מארזים)**:
  `update site_settings set value='off' where key='enforce_order_rules';` — כיבוי מיידי.
- **מינימום הזמנה חזרה ל-500**:
  `update site_settings set value='500' where key='min_order_total';`
- **סנכרון כל 15 דק' — ביטול**:
  `select cron.unschedule('rivhit-products-15m');` (הלילי ב-03:00 נשאר).

## 3. מיגרציות

כל מיגרציה ב-Supabase migration history מכילה בלוק `-- ROLLBACK:` עם הפקודות ההופכיות המדויקות. סדר ביטול מלא (מהאחרון לראשון):
1. `wave8_sync_secret_and_schedule`
2. `wave3_5_server_side_order_enforcement`
3. `wave4_profile_address_fields`
4. `wave3_display_quantities`
5. `min_order_3500_and_public_read`

## 4. Edge functions

לכל פונקציה יש היסטוריית גרסאות ב-Supabase; פריסה מחדש של הגרסה הקודמת מהמקור השמור:
- rivhit-img: v7 (נוכחי, EXIF) ← v4 (resize בלי EXIF) ← v1 (מקורי)
- rivhit-sync: v8 (עם אימות) ← v7 (פתוח) — אם v8 חוסם בטעות: הקרון כבר שולח key, כפתור המנהל עובר JWT; לחזרה ל-v7 יש להסיר את בלוק ה-auth gate בלבד.
- signup: v3 (כתובת) ← v2.
- rivhit-probe-*: הוחלפו בבדל 410 בכוונה — אין להחזיר.

## 5. חזרה מלאה למצב שלפני השדרוג

- קוד: `git checkout backup/pre-upgrade-2026` (או merge של הענף הזה ל-main). הענף מצביע על main של 2026-07-23 לפני Wave 0.
- סכמה: להריץ את בלוקי ה-ROLLBACK של חמש המיגרציות לפי הסדר בסעיף 3, ואז `backups/schema-before.sql` הוא הרפרנס לווידוא.
- שים לב: תיקון התמונות (PR #35) נכנס ל-main כתיקון באג חי **לפני** מיזוג השדרוג — חזרה אליו תחזיר תמונות שוכבות; לא מומלץ.
