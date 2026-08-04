# דוח תלויות ואבטחת חבילות

**תאריך:** 2026-08-04 · **ענף:** `collab/kerem-upgrade`

## מה נמצא (npm audit — לפני הטיפול)

3 התרעות High, כולן בעץ התלויות של `next@15`:

| חבילה | גרסה שהיתה | התרעה | תיקון מלא |
|---|---|---|---|
| next | 15.5.19 | GHSA-955p-x3mx-jcvp — חשיפת endpoints של Server Functions ללא אימות | Next **16** (major) |
| postcss (תלות של next) | 8.4.31 | XSS ב-stringify ‏(GHSA-qx2v-qp2m-jg93) + שרשרת sourceMappingURL (קריאת קבצים) | ‏8.5.23+ |
| sharp (תלות של next) | 0.34.5 | CVEs של libvips ‏(GHSA-f88m-g3jw-g9cj) | ‏0.35+ |

## מה בוצע (בלי major, בלי `npm audit fix --force`)

1. **next ‏15.5.19 → 15.5.22** — עדכון patch באותו minor. כל הבדיקות
   (test / tsc / build מלא) עברו.
2. **postcss ‏8.4.31 → 8.5.25** דרך `overrides` ב-package.json — אותו
   major (semver-תואם); postcss היא תלות של זמן-בנייה בלבד. הבדיקות עברו.

## מה נשאר פתוח ולמה — דורש החלטת בעלים

| פריט | גרסה נוכחית | מומלצת | למה לא בוצע כאן | סיכון בפועל |
|---|---|---|---|---|
| next | 15.5.22 | **16.x** | שדרוג major — אסור בענף זה; דורש בדיקת תאימות (static export, basePath, dynamic) | **נמוך בפרודקשן**: האתר הוא `output:'export'` — HTML סטטי על GitHub Pages, אין Server Functions בכלל; החולשה רלוונטית בעיקר ל-`next dev` מקומי |
| sharp | 0.34.5 | 0.35+ | ‏next מצהיר `^0.34`; ב-0.x ה-minor הוא נתיב שבירה — override חוצה את הטווח המוצהר של next | **אפסי בפרויקט הזה**: ‏`images.unoptimized: true` + static export — sharp לא רץ לא בבנייה ולא בזמן-ריצה |

## המלצה קדימה

לתכנן שדרוג ל-Next 16 כמשימה ייעודית (בענף נפרד, עם בדיקת כל 12 ה-routes
והתנהגות ה-basePath/trailingSlash), ואיתו sharp נפתר מעצמו. עד אז החשיפה
המעשית של האתר החי מהתרעות אלה — זניחה, מהנימוקים בטבלה.

## פקודות הבדיקה שרצו (וכולן ירוקות אחרי השינויים)

```
npm ci
npm audit          # נותרו 2 High — מנומקים למעלה
npm test           # 16 + 6 בדיקות יחידה
npx tsc --noEmit
npm run build      # כל 12 ה-routes מיוצאים
```
