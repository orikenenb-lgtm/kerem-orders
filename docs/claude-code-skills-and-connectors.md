# מדריך התקנה — סקילים וחיבורים ל-Claude Code

> מדריך עזר לשימוש אישי. **שים לב:** הסקילים והחיבורים מותקנים *בתוך* Claude Code
> (הדבקת פרומפט / פקודת `claude mcp add`), ולא כקבצים בריפו הזה. הקובץ הזה הוא רק
> רשימת התקנה נוחה להעתקה.

---

## 📦 20 הסקילים — לפי קטגוריה

| # | קטגוריה | שם | מה עושה | יוצר |
|---|---|---|---|---|
| 01 | שיווק | Marketing Skills | 30+ סוכני שיווק: SEO, קופי, רצפי מיילים, CRO, דאטה | Corey Haines |
| 02 | כתיבה | Stop-Slop | חותך כל "ריח" של AI מהטקסט שיישמע אנושי | Hardik Pandya |
| 03 | עיצוב | UI/UX Pro Max | 50+ סגנונות UI, 161 פלטות, 10 פריימוורקים | Next Level Builder |
| 04 | וידאו | Remotion Video | בונה סרטונים מונפשים מטקסט (רשמי) | Remotion Dev |
| 05 | פרודוקטיביות | Context Engineering Kit | חוסך טוקנים, פחות מגבלות שימוש | NeoLab HQ |
| 06 | פרסום | Arcads | מודעות וידאו עם שחקני AI | Kruse Media |
| 07 | פיתוח | Superpowers | חבילת כלי-על למפתחים | Jesse Vincent |
| 08 | עיצוב | Picsart GenAI CLI | עריכת תמונות מהטרמינל (CLI, לא ריפו) | Picsart |
| 09 | מכירות | AI Sales Team | צוות מכירות: לידים, מעקב, סגירה | Zubair Trabzada |
| 10 | ידע | Obsidian Second Brain | זיכרון חיצוני דרך אובסידיאן | Eugeniu Ghelbur |
| 11 | אבטחה | Trail of Bits Security | בדיקות אבטחה לקוד | Trail of Bits |
| 12 | פרודוקטיביות | Caveman Mode | מצב חיסכון/מיקוד | Julius Brussee |
| 13 | בדיקות | Playwright Skill | בדיקות אוטומטיות לאתרים | Justin Lackey |
| 14 | SEO | SEO Machine | מכונת SEO מלאה | Craig Hewitt |
| 15 | אוטומציה | Entrepreneur Skills | סקילים לבעלי עסקים | Matt Warren |
| 16 | דאטה | D3.js Visualization | ויזואליזציות דאטה | Chris von Csefalvay |
| 17 | מובייל | iOS Simulator | הרצת אפליקציות iOS | Conor Luddy |
| 18 | עיצוב | Frontend Slides | מצגות מעוצבות בקוד | Rui Zhang |
| 19 | עיצוב | Algorithmic Art | אמנות גנרטיבית (רשמי) | Anthropic |
| 20 | מובייל | React Native Skills | סקילים ל-RN (רשמי) | Callstack |

---

## ⌨️ פקודות התקנת הסקילים — הדבק שורה-שורה ל-Claude Code

> כל שורה היא פרומפט נפרד. מדביקים אחת, Enter, מחכים שיסיים — ואז הבאה.

```
התקן את הסקיל מ-https://github.com/coreyhaines31/marketingskills
התקן את הסקיל מ-https://github.com/hardikpandya/stop-slop
התקן את הסקיל מ-https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
התקן את הסקיל מ-https://github.com/remotion-dev/skills
התקן את הסקיל מ-https://github.com/NeoLabHQ/context-engineering-kit
התקן את הסקיל מ-https://github.com/krusemediallc/arcads-claude-code
התקן את הסקיל מ-https://github.com/obra/superpowers
התקן את הסקיל מ-https://github.com/zubair-trabzada/ai-sales-team-claude
התקן את הסקיל מ-https://github.com/eugeniughelbur/obsidian-second-brain
התקן את הסקיל מ-https://github.com/trailofbits/skills
התקן את הסקיל מ-https://github.com/juliusbrussee/caveman
התקן את הסקיל מ-https://github.com/lackeyjb/playwright-skill
התקן את הסקיל מ-https://github.com/TheCraigHewitt/seomachine
התקן את הסקיל מ-https://github.com/mfwarren/entrepreneur-claude-skills
התקן את הסקיל מ-https://github.com/chrisvoncsefalvay/claude-d3js-skill
התקן את הסקיל מ-https://github.com/conorluddy/ios-simulator-skill
התקן את הסקיל מ-https://github.com/zarazhangrui/frontend-slides
התקן את הסקיל מ-https://github.com/anthropics/skills
התקן את הסקיל מ-https://github.com/callstackincubator/agent-skills
```

> סקיל #8 (Picsart) הוא לא ריפו אלא כלי CLI — מתקינים מהדף: https://picsart.com/gen-ai-cli/

---

## 🔌 5 החיבורים (אוטומציה / MCP)

| חיבור | מה עושה | איך |
|---|---|---|
| Canva | קרוסלות, מצגות, ברנד קיט | טרמינל ✅ |
| Meta Ads | ניהול קמפיינים פייסבוק/אינסטגרם | טרמינל ✅ |
| Higgsfield | תמונות, סרטונים, UGC | טרמינל ✅ |
| Booking.com | חיפוש והשוואת מלונות | אפליקציה בלבד ⚠️ |
| Gmail | קריאה, סיכום וניסוח מיילים | אפליקציה בלבד ⚠️ |

פקודות טרמינל לחיבורים (פקודות אמיתיות, רצות ישר):

```bash
claude mcp add --transport http Canva https://mcp.canva.com/mcp
claude mcp add meta-ads-mcp --transport http https://meta-ads.mcp.pipeboard.co/
claude mcp add --transport http Higgsfield https://mcp.higgsfield.ai/mcp
```

**Booking** ו-**Gmail** עובדים רק דרך האפליקציה: Settings ← Connectors ← מחפשים ולוחצים Connect (לא בטרמינל).

---

## ⚠️ דברים שכדאי לדעת

- חיבור מותאם דרך URL (כמו Higgsfield) דורש מנוי **Pro/Max**.
- ב-Higgsfield כל יצירה צורכת **קרדיטים** מהחשבון שלך שם.
