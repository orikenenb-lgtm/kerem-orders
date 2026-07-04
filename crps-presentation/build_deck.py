#!/usr/bin/env python3
"""Build the professional CRPS deck (16:9 PDF-ready HTML) for a pain-clinic audience.

Presenter: הילית פז לביא. Design: formal medical-keynote — ivory content pages,
deep-navy chapter pages, copper accent, serif display + Heebo body, embedded fonts.
"""
import base64
import glob
import io
import os

from PIL import Image, ImageOps

UPLOADS = "/root/.claude/uploads/d95bbaf8-f767-53d5-9b8b-0f6c3551b17b"
SCRATCH = "/tmp/claude-0/-home-user-kerem-orders/d95bbaf8-f767-53d5-9b8b-0f6c3551b17b/scratchpad"
PDFIMG = os.path.join(SCRATCH, "pdfimg")
FONTS = os.path.join(SCRATCH, "fonts")
OUT = os.path.join(os.path.dirname(__file__), "deck.html")

GRID_DIM, GRID_Q = 640, 58
HERO_DIM, HERO_Q = 1150, 72


def encode(path, max_dim=GRID_DIM, quality=GRID_Q, crop_bottom=0.0):
    img = Image.open(path)
    img = ImageOps.exif_transpose(img).convert("RGB")
    if crop_bottom:
        w, h = img.size
        img = img.crop((0, 0, w, int(h * (1 - crop_bottom))))
    img.thumbnail((max_dim, max_dim), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality, optimize=True, progressive=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def U(name, **kw):   # original uploads
    return encode(os.path.join(UPLOADS, name), **kw)


def P(idx, **kw):    # pdf album photos (A01..A44, B01..B51)
    return encode(os.path.join(PDFIMG, idx + ".jpeg"), **kw)


def font_face(fam, weight, path):
    with open(path, "rb") as f:
        b = base64.b64encode(f.read()).decode()
    return (f"@font-face{{font-family:'{fam}';font-weight:{weight};font-style:normal;"
            f"src:url(data:font/ttf;base64,{b}) format('truetype')}}")


# Font files downloaded from Google Fonts (order matches the css2 query output).
FONT_CSS = "\n".join([
    font_face("Frank Ruhl Libre", 700, os.path.join(FONTS, "989fc779.ttf")),
    font_face("Frank Ruhl Libre", 900, os.path.join(FONTS, "ed593e0b.ttf")),
    font_face("Heebo", 300, os.path.join(FONTS, "4c7cca4a.ttf")),
    font_face("Heebo", 400, os.path.join(FONTS, "8203db7b.ttf")),
    font_face("Heebo", 600, os.path.join(FONTS, "e7253e23.ttf")),
    font_face("Heebo", 800, os.path.join(FONTS, "02b7acf8.ttf")),
])

# ---------------------------------------------------------------- photo pools
PAIN_LEAD = ["A23", "A12", "A18", "A35", "A43", "A21"]
PAIN_WALL = ["A01", "A02", "A06", "A08", "A19", "A27"]
PAIN_WALL_U = ["187dc8c6-IMG20250722WA0098.jpg", "e4fe0174-IMG20250722WA0096.jpg",
               "e4c31d2e-IMG20250722WA0115.jpg", "9a38cdbf-IMG20250722WA0117.jpg",
               "b429ab7b-IMG20250722WA0097.jpg", "6ee703d5-IMG20250722WA0120.jpg"]
HOSP_HERO = "A04"
HOSP_ROW = ["A14", "A22", "A25", "A31", "A40"]
HOSP_WALL = ["A03", "A05", "A13", "A15", "A24", "A41"]
HOSP_WALL_U = ["0d84f904-IMG20250722WA0067.jpg", "fbf59d46-IMG20250722WA0091.jpg",
               "582b1db3-IMG20250722WA0113.jpg", "a2cf3253-IMG20250722WA0114.jpg"]
TREAT_HERO = "A37"
TREAT_ROW = ["A32", "A39", "A44", "B02", "B03"]
TREAT_WALL = ["A07", "A10", "A16", "A17", "A20", "A26", "A34", "A36", "A38", "B06"]
TREAT_WALL_U = ["90cfb7c7-IMG20250722WA0119.jpg", "e7b993c6-IMG20250722WA0122.jpg"]
REST = ["A09", "A11", "A28", "A30", "A42", "B07"]
REST_U = ["5b89500d-IMG20250722WA0112.jpg", "eb63f106-IMG20250722WA0116.jpg",
          "880af9ad-IMG20250722WA0107.jpg"]
OUT_PAIR = ["A29", "A33"]
FAMILY_U = ["a73f490c-IMG20250722WA0118.jpg", "203d0b5b-IMG20250722WA0079.jpg"]
FAMILY = ["B09", "B15", "B05", "B10"]
LIFE = ["B01", "B04", "B11", "B12", "B13", "B16"]
WW = "B08"
CROWN = "f5dc4285-IMG20250722WA0121.jpg"
GIVE_INTRO = ["B20", "B23", "B19"]
GIVE_WALL1 = ["B14", "B17", "B18", "B21", "B22", "B24", "B25", "B26", "B27", "B28", "B29", "B30"]
GIVE_WALL2 = ["B31", "B32", "B33", "B34", "B35", "B37", "B38", "B39", "B40", "B41", "B42", "B43"]
GIVE_WALL3 = ["B44", "B45", "B46", "B47", "B48", "B49", "B50", "B36"]
FLYER = "B51"

# ------------------------------------------------------------------ helpers
pages = []
TOTAL_PLACEHOLDER = "@@TOTAL@@"


def page(body, dark=False, chapter="", klass=""):
    n = len(pages) + 1
    theme = "dark" if dark else "light"
    chap = f'<div class="chap">{chapter}</div>' if chapter else ""
    folio = (f'<div class="folio"><span dir="ltr">{n:02d} / {TOTAL_PLACEHOLDER}</span>'
             f'<span class="ft">CRPS · הילית פז לביא · מסע אישי</span></div>')
    pages.append(f'<section class="page {theme} {klass}">{chap}{body}{folio}</section>')


def fig(src, cap="", klass=""):
    c = f'<figcaption>{cap}</figcaption>' if cap else ""
    return f'<figure class="ph {klass}"><img src="{src}">{c}</figure>'


def wall(images, cols):
    cells = "".join(fig(s) for s in images)
    return f'<div class="wall" style="grid-template-columns:repeat({cols},1fr)">{cells}</div>'


# ================================================================== 1 · COVER
# Crop the app watermark off the bottom of the crown photo.
crown_hero = U(CROWN, max_dim=HERO_DIM, quality=HERO_Q, crop_bottom=0.14)
page(f"""
<div class="cover">
  <div class="cover-img"><img src="{crown_hero}"></div>
  <div class="cover-txt">
    <div class="eyebrow">מצגת אישית בפני צוות מרפאת הכאב</div>
    <h1>CRPS</h1>
    <div class="rule"></div>
    <h2>תסמונת כאב אזורי מורכבת</h2>
    <p class="en">Complex Regional Pain Syndrome</p>
    <p class="byline">הסיפור של <b>הילית פז לביא</b></p>
    <p class="tagline">״איך לנצל כאב לעוצמה, כוח ונתינה״</p>
  </div>
</div>""", dark=True, klass="coverpage")

# ============================================================ 2 · THE STORY
page(f"""
<div class="split">
  <div class="txt">
    <div class="eyebrow">פתיחה</div>
    <h2 class="h">״אפצ׳י אחד שינה את חיי״</h2>
    <p class="body">
      כך נקראת ההרצאה שאני מעבירה היום ברחבי הארץ — כי לפעמים מספיק רגע אחד קטן,
      תנועה אחת לא נכונה, כדי שהחיים ישתנו מהקצה אל הקצה.
    </p>
    <p class="body">
      אני אמא, אשת משפחה, אישה פעילה ומלאת חיים. ויום אחד — בלי אזהרה —
      הגוף שלי הפך לזירת קרב. כאב צורב, בלתי־פוסק, שאף בדיקה לא הצליחה להסביר
      ואף משכך לא הצליח להשתיק.
    </p>
    <p class="body accent-line">
      זו לא הרצאה על מחלה. זה סיפור על החיים שמסביב לה —
      ועל מה שאתם, הרופאים, יכולים לעשות כדי לשנות אותם.
    </p>
  </div>
  <div class="pane">{fig(P('B19', max_dim=HERO_DIM, quality=HERO_Q), 'ממשיכה לצאת, לפעול ולתת — גם בימים הקשים')}</div>
</div>""", chapter="פתיחה")

# ========================================================= 3 · WHAT IS CRPS
page("""
<div class="center-head">
  <div class="eyebrow">רקע קליני</div>
  <h2 class="h">מה זה CRPS?</h2>
  <p class="sub">תסמונת כאב כרונית־נוירופתית, המתפתחת לרוב לאחר חבלה או ניתוח —
  והכאב בה <b>אינו פרופורציונלי</b> לאירוע המחולל.</p>
</div>
<div class="cards4">
  <div class="card"><div class="dot d1"></div><h3>כאב שורף ומתמשך</h3>
    <p>כאב עז, צורב ועמוק בגפה — נמשך הרבה אחרי שהפציעה המקורית החלימה.</p></div>
  <div class="card"><div class="dot d2"></div><h3>אלודיניה</h3>
    <p>מגע קל — סדין, בגד, רוח — נחווה ככאב חד. הגוף מתרגם כל גירוי לאיום.</p></div>
  <div class="card"><div class="dot d3"></div><h3>שינויים נראים</h3>
    <p>נפיחות, שינויי צבע וטמפרטורה בעור, הזעה מוגברת, שינויים בציפורניים ובשיער.</p></div>
  <div class="card"><div class="dot d4"></div><h3>פגיעה תפקודית</h3>
    <p>ירידה בטווח תנועה, חולשה ורעד — עד כדי אובדן שימוש בגפה ופגיעה קשה בתפקוד.</p></div>
</div>
<p class="foot-note">ההנחה המקובלת: תגובה מוגזמת של מערכת העצבים המרכזית וההיקפית — ״אזעקת כאב״ שנתקעה במצב פתוח.</p>
""", chapter="רקע קליני")

# ==================================================== 4 · BUDAPEST CRITERIA
page("""
<div class="center-head">
  <div class="eyebrow">אבחנה</div>
  <h2 class="h">קריטריוני בודפשט</h2>
  <p class="sub">האבחנה קלינית בלבד — אין בדיקת מעבדה או הדמיה שמאשרת CRPS.
  נדרשים תסמינים בשלוש מתוך ארבע קטגוריות, וסימנים בשתיים לפחות:</p>
</div>
<div class="cards4">
  <div class="card"><div class="dot d1"></div><h3>תחושתי</h3>
    <p>היפראלגזיה · אלודיניה — כאב לא פרופורציונלי לגירוי.</p></div>
  <div class="card"><div class="dot d2"></div><h3>וזומוטורי</h3>
    <p>אסימטריה בטמפרטורת העור · שינויי צבע — אדום, סגול, חיוור.</p></div>
  <div class="card"><div class="dot d3"></div><h3>סודומוטורי / בצקת</h3>
    <p>נפיחות · שינויים בהזעה ואסימטריה בין הגפיים.</p></div>
  <div class="card"><div class="dot d4"></div><h3>מוטורי / טרופי</h3>
    <p>ירידה בטווח תנועה · חולשה, רעד, דיסטוניה · שינויים בעור, שיער וציפורניים.</p></div>
</div>
<p class="foot-note"><b>ולכן —</b> החשד הקליני שלכם הוא כלי האבחון החשוב ביותר.
כשמטופלת מתארת כאב ״מוגזם״ ביחס לממצאים — ייתכן שזה בדיוק הסימן.</p>
""", chapter="רקע קליני")

# ============================================================== 5 · NUMBERS
LADDER = [
    ("שבר בעצם", 17, ""),
    ("לידה טבעית (ללא אלחוש)", 35, ""),
    ("קטיעת אצבע ללא הרדמה", 40, ""),
    ("CRPS — הכאב שאני חיה איתו", 42, "crps"),
]
ladder_rows = "".join(
    f'''<div class="lrow {cls}">
      <div class="llab">{lab}</div>
      <div class="lbar"><div class="track"></div>
        <div class="fill" style="width:{val/50*100:.0f}%"></div></div>
      <div class="lnum">{val}</div>
    </div>''' for lab, val, cls in LADDER)
page(f"""
<div class="center-head">
  <div class="eyebrow">בשפה של מספרים</div>
  <h2 class="h">כמה חזק הכאב הזה?</h2>
  <p class="sub">מדד הכאב של מקגיל (McGill) מדרג כאבים על סולם של 0–50, לפי דיווחי מטופלים.
  ככה נראה CRPS לעומת כאבים שכולנו מכירים:</p>
</div>
<div class="ladder">{ladder_rows}</div>
<p class="kicker">והנקודה שחשוב לזכור: לידה נגמרת אחרי שעות, שבר מחלים אחרי שבועות —
<b>הכאב של CRPS נמשך יום אחרי יום, שנה אחרי שנה.</b></p>
<p class="foot-note">ערכים מקורבים מתוך McGill Pain Index — להמחשה במסגרת הרצאה אישית.</p>
""", dark=True, chapter="בשפה של מספרים")

# ======================================================== 6 · INVISIBLE PAIN
page(f"""
<div class="split">
  <div class="txt">
    <div class="eyebrow">המסע שלי · פרק א׳</div>
    <h2 class="h">הכאב שלא רואים</h2>
    <p class="body">
      אלה לא תמונות קלות — ובכוונה. ככה נראות שעות הלילה,
      כשהכאב מגיע לשיא ואין תנוחה אחת שמרגיעה אותו.
    </p>
    <p class="body">
      בבדיקות הכל ״תקין״. בעיניים — הכל שבור.
      זה הפער שכל מטופלת CRPS חיה בתוכו יום־יום.
    </p>
  </div>
  <div class="pane">
    <div class="wall" style="grid-template-columns:repeat(3,1fr)">
      {''.join(fig(P(i)) for i in PAIN_LEAD)}
    </div>
  </div>
</div>""", chapter="המסע שלי")

# ============================================================= 7 · PAIN WALL
page(f"""
<div class="wall-head"><h2 class="h">רגעים שאין להם פילטר</h2>
<p class="sub">תיעוד אמיתי, לאורך חודשים — כי חשוב לי שתראו את מה שלא נכנס לתיק הרפואי.</p></div>
{wall([P(i) for i in PAIN_WALL] + [U(n) for n in PAIN_WALL_U], 6)}
""", chapter="המסע שלי")

# ========================================================== 8 · HOSPITAL
page(f"""
<div class="hero-row">
  <div class="hero-main">{fig(P(HOSP_HERO, max_dim=HERO_DIM, quality=HERO_Q), 'אשפוז. שוב. הקירות הלבנים נהיו בית שני')}</div>
  <div class="hero-side">
    <div class="eyebrow">המסע שלי · פרק ב׳</div>
    <h2 class="h">ימים במחלקה</h2>
    <p class="body">אשפוזים חוזרים, לילות של ניטור, אינספור בדיקות.
    בין מיטה למיטה למדתי את השפה הרפואית — והרופאים למדו להכיר אותי.</p>
  </div>
</div>
{wall([P(i) for i in HOSP_ROW], 5)}
""", chapter="המסע שלי")

# ======================================================= 9 · HOSPITAL WALL
page(f"""
<div class="wall-head"><h2 class="h">בין עירוי לעירוי</h2>
<p class="sub">גם במחלקה מוצאים רגעים של חיוך — בעיקר כשהילדים מגיעים לבקר.</p></div>
{wall([P(i) for i in HOSP_WALL] + [U(n) for n in HOSP_WALL_U], 5)}
""", chapter="המסע שלי")

# ========================================================= 10 · TREATMENTS
page(f"""
<div class="hero-row">
  <div class="hero-main">{fig(P(TREAT_HERO, max_dim=HERO_DIM, quality=HERO_Q), 'משאבת עירוי — הטיפול נכנס הביתה, לשגרה, לשינה')}</div>
  <div class="hero-side">
    <div class="eyebrow">המסע שלי · פרק ג׳</div>
    <h2 class="h">הטיפולים</h2>
    <p class="body">עירויים חוזרים, משאבות, אלקטרודות, חסימות עצביות, תרופות שמחליפות זו את זו.
    חלק עוזר לכמה ימים, חלק לא — אבל מפסיקים לנסות רק מי שמוותרים, ואני לא.</p>
  </div>
</div>
{wall([P(i) for i in TREAT_ROW], 5)}
""", chapter="המסע שלי")

# ===================================================== 11 · TREATMENTS WALL
page(f"""
<div class="wall-head"><h2 class="h">הגוף כזירת טיפול</h2>
<p class="sub">צנתרים, מוניטורים ומשאבות — המחיר היומיומי של המרדף אחרי הקלה.</p></div>
{wall([P(i) for i in TREAT_WALL] + [U(n) for n in TREAT_WALL_U], 6)}
""", chapter="המסע שלי")

# ============================================================== 12 · QUOTE
quote_bg = P("A28", max_dim=HERO_DIM, quality=HERO_Q)
page(f"""
<div class="quote-bg"><img src="{quote_bg}"></div>
<div class="quote-veil"></div>
<div class="quote">
  <div class="qmark">”</div>
  <blockquote>הכאב לא תמיד נראה מבחוץ.<br>אבל הוא אמיתי — בכל שנייה, בכל נשימה.</blockquote>
  <div class="qby">— מה שכל מטופלת CRPS הייתה רוצה שתדעו</div>
</div>""", dark=True, klass="quotepage")

# ======================================================= 13 · DAILY IMPACT
page("""
<div class="center-head">
  <div class="eyebrow">ההשפעה</div>
  <h2 class="h">מה הכאב לוקח מהחיים</h2>
  <p class="sub">CRPS הוא לא ״כאב בגפה״. הוא מערכת שלמה שמתערערת:</p>
</div>
<div class="cards4">
  <div class="card"><div class="dot d1"></div><h3>שינה</h3>
    <p>הכאב מתעצם בלילה. שנה שלמה בלי לילה רצוף אחד — וכל יום מתחיל בגירעון.</p></div>
  <div class="card"><div class="dot d2"></div><h3>תפקוד</h3>
    <p>להתלבש, לבשל, לנהוג — פעולות שהיו אוטומטיות הופכות למשימות מתוכננות.</p></div>
  <div class="card"><div class="dot d3"></div><h3>משפחה</h3>
    <p>הילדים לומדים לזהות את ״הימים הקשים״. התפקידים בבית מתהפכים.</p></div>
  <div class="card"><div class="dot d4"></div><h3>זהות</h3>
    <p>המאבק הכי גדול: להישאר אני — אישה, אמא, יוצרת — ולא ״החולה מחדר 4״.</p></div>
</div>
<p class="foot-note">ולמרות כל זה — הפרקים הבאים הם הסיבה האמיתית שאני כאן.</p>
""", chapter="ההשפעה")

# =============================================================== 14 · REST
page(f"""
<div class="wall-head"><h2 class="h">גם מנוחה היא מאבק</h2>
<p class="sub">אחרי לילה של כאב, הגוף גובה את שלו — ברכב, על הספה, בכל רגע שמתאפשר.</p></div>
{wall([P(i) for i in REST] + [U(n) for n in REST_U], 5)}
""", chapter="ההשפעה")

# ======================================================== 15 · OUT ANYWAY
page(f"""
<div class="split">
  <div class="txt">
    <div class="eyebrow">נקודת מפנה</div>
    <h2 class="h">ובכל זאת — יוצאים</h2>
    <p class="body">
      היד חבושה, הכאב נוכח — ובכל זאת: קניון, הליכה, החיים.
      הבן שלי לצידי, תומך בכל צעד.
    </p>
    <p class="body accent-line">
      למדתי שהכאב אולי קובע את הקצב — אבל אני קובעת את הכיוון.
    </p>
  </div>
  <div class="pane">
    <div class="wall" style="grid-template-columns:repeat(2,1fr)">
      {fig(P(OUT_PAIR[0], max_dim=800, quality=64), 'היד ביד — יוצאים לעולם')}
      {fig(P(OUT_PAIR[1], max_dim=800, quality=64), 'צעד אחר צעד, ביחד')}
    </div>
  </div>
</div>""", chapter="נקודת מפנה")

# ============================================================= 16 · FAMILY
page(f"""
<div class="wall-head"><h2 class="h">המשפחה — התרופה שאין לה מרשם</h2>
<p class="sub">הם היו שם בכל אשפוז, בכל לילה לבן. החיבוק שלהם שווה יותר מכל משכך.</p></div>
{wall([U(n) for n in FAMILY_U] + [P(i) for i in FAMILY], 3)}
""", chapter="הכוח")

# =============================================================== 17 · LIFE
page(f"""
<div class="wall-head"><h2 class="h">ממשיכים לחיות — בקול רם</h2>
<p class="sub">מרוצים, אירועים, חברים. כל תמונה כאן היא החלטה מודעת לא לתת לכאב את המילה האחרונה.</p></div>
{wall([P(i) for i in LIFE], 3)}
""", chapter="הכוח")

# ======================================================== 18 · WONDER WOMAN
page(f"""
<div class="split rev">
  <div class="pane ww">{fig(P(WW, max_dim=HERO_DIM, quality=HERO_Q))}</div>
  <div class="txt">
    <div class="eyebrow">הכוח</div>
    <h2 class="h">לפעמים צריך תחפושת.<br>בדרך כלל מספיק אומץ.</h2>
    <p class="body">
      יום אחד הפכתי את עצמי לוונדר וומן — והבנתי שזו בכלל לא תחפושת.
      כל מי שקמה בבוקר עם CRPS ובוחרת לחיות את היום הזה בכל זאת —
      היא גיבורת־על אמיתית.
    </p>
    <p class="body accent-line">וכשצריך כתר — שמים כתר. 👑</p>
  </div>
</div>""", chapter="הכוח")

# ====================================================== 19 · GIVING INTRO
page(f"""
<div class="split">
  <div class="txt">
    <div class="eyebrow">הכוח · נתינה</div>
    <h2 class="h">הפכתי את הכאב לנתינה</h2>
    <p class="body">
      במקום לשאול ״למה זה קרה לי״, התחלתי לשאול ״מה אני עושה עם זה״.
      כך נולד מיזם הנתינה שלי: נעליים בעבודת יד עם הכיתוב <b>״עם ישראל חי״</b>,
      שאני מעניקה באופן אישי <b>לחטופים ששבו מהשבי ולשורדי הטבח במסיבת הנובה</b>.
    </p>
    <p class="body">
      והדלת שלי לא נסגרת: אני מארחת אצלי בבית, סביב שולחן וארוחה חמה,
      שבים מהשבי, שורדי המסיבה והורים שכולים של נרצחי השבעה באוקטובר —
      ביד פתוחה ובלב שלם.
    </p>
    <p class="body accent-line">
      כאב מזהה כאב. דווקא בגלל מה שעברתי, אני יודעת כמה רגע אחד של אור
      יכול להחזיק אדם עוד יום — והנתינה הזאת מרפאת גם אותי.
    </p>
  </div>
  <div class="pane">
    <div class="wall" style="grid-template-columns:repeat(3,1fr)">
      {fig(P('B20'), 'ערכה לכבודו של אביתר דוד, ששב מהשבי')}
      {fig(P('B23'), 'נעלי ״עם ישראל חי״ בעבודת יד')}
      {fig(P('B19'), 'בדרך למסירה נוספת')}
    </div>
  </div>
</div>""", chapter="הכוח")

# ================================================== 20-22 · GIVING WALLS
page(f"""
<div class="wall-head"><h2 class="h">״עם ישראל חי״ — לשבים מהשבי ולשורדי הנובה</h2>
<p class="sub">בתמונות האלה: מי שנחטפו לעזה וחזרו הביתה, ומי ששרדו את הטבח במסיבת הנובה
בשבעה באוקטובר. לכל אחד ואחת אני מגיעה עם זוג נעליים מצויר ביד — חיבוק אישי שאומר: אתם לא לבד.</p></div>
{wall([P(i) for i in GIVE_WALL1], 6)}
""", chapter="הכוח")

page(f"""
<div class="wall-head"><h2 class="h">We Will Dance Again — עוד נרקוד</h2>
<p class="sub">המוטו של שורדי הנובה הפך אצלי לשליחות: להגיע לכל שורד ושורדת,
ולהזכיר להם שהריקוד שלהם עוד לפניהם.</p></div>
{wall([P(i) for i in GIVE_WALL2], 6)}
""", chapter="הכוח")

page(f"""
<div class="wall-head"><h2 class="h">ובית שהדלת שלו תמיד פתוחה</h2>
<p class="sub">את חלקם אירחתי אצלי בבית — שבים מהשבי, שורדי המסיבה והורים שכולים של נרצחי
השבעה באוקטובר — סביב שולחן, ארוחה חמה ולב פתוח.</p></div>
{wall([P(i) for i in GIVE_WALL3], 4)}
""", chapter="הכוח")

# ========================================================== 23 · LECTURING
page(f"""
<div class="split rev">
  <div class="pane flyer">{fig(P(FLYER, max_dim=900, quality=68), 'מתוך פרסום להרצאה — רחובות, יוני 2026')}</div>
  <div class="txt">
    <div class="eyebrow">הכוח · השמעת קול</div>
    <h2 class="h">היום אני עומדת על במות</h2>
    <p class="body">
      אני מרצה לקהילות ברחבי הארץ על החיים עם כאב כרוני:
      <b>״אפצ׳י אחד שינה את חיי — איך לנצל כאב לעוצמה, כוח ונתינה״</b>.
    </p>
    <p class="body">
      מי שפעם לא הצליחה לקום מהמיטה — מחזיקה היום מיקרופון מול קהל.
      זה לא קרה למרות הכאב. זה קרה בגללו — כי בחרתי לתת לו משמעות.
    </p>
    <p class="body accent-line">והמצגת הזאת, מולכם — היא הבמה הכי חשובה שלי עד היום.</p>
  </div>
</div>""", chapter="השמעת קול")

# ============================================================ 24 · THE ASK
page("""
<div class="center-head">
  <div class="eyebrow">המסר שלי אליכם</div>
  <h2 class="h">מה מטופלת CRPS מבקשת מהרופאים שלה</h2>
</div>
<ol class="asks">
  <li><b>תאמינו לנו.</b> הכאב אמיתי גם כשההדמיה תקינה. משפט אחד — ״אני מאמין לך״ — שווה יותר מעשר בדיקות.</li>
  <li><b>חשדו מוקדם.</b> ב‑CRPS הזמן הוא פרוגנוזה: אבחון והתערבות מוקדמים משנים את מהלך המחלה.</li>
  <li><b>טפלו רב־תחומית.</b> כאב, פיזיותרפיה, תמיכה נפשית ומשפחה — אף טיפול בודד לא מספיק לבדו.</li>
  <li><b>שמרו על רצף.</b> אל תתנו לנו להתחיל כל פעם מאפס מול רופא חדש. ליווי קבוע הוא עוגן.</li>
  <li><b>תראו את האדם.</b> לא רק את הגפה. תמכו בזהות, בעשייה ובתקווה — הן חלק מהטיפול.</li>
</ol>
""", dark=True, chapter="המסר")

# ============================================================ 25 · CLOSING
page(f"""
<div class="cover">
  <div class="cover-img"><img src="{crown_hero}"></div>
  <div class="cover-txt">
    <div class="eyebrow">תודה שהקשבתם</div>
    <h1 class="small">כל יום הוא ניצחון</h1>
    <div class="rule"></div>
    <p class="byline">הילית פז לביא</p>
    <p class="tagline">״הכאב הוא חלק מהסיפור שלי — אבל הוא לא כל הסיפור.״</p>
    <p class="hash">#CRPS_Awareness</p>
  </div>
</div>""", dark=True, klass="coverpage")

# ------------------------------------------------------------------- html
total = len(pages)
body = "\n".join(pages).replace(TOTAL_PLACEHOLDER, f"{total:02d}")

HTML = f"""<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<title>CRPS — הילית פז לביא</title>
<style>
{FONT_CSS}
:root{{
  --ivory:#faf7f1; --ink:#1c2434; --muted:#5d6675; --line:#d8d2c6;
  --copper:#b4642a; --copper2:#8a4a1d; --navy:#111a2b; --navy2:#1a2740;
  --gold:#dfa35c; --dink:#f2ede4; --dmuted:#a9b2c4;
  --serif:'Frank Ruhl Libre',Georgia,serif; --sans:'Heebo',Arial,sans-serif;
}}
*{{box-sizing:border-box;margin:0;padding:0}}
html,body{{background:#e8e4dc;font-family:var(--sans)}}
@page{{size:13.333in 7.5in;margin:0}}
.page{{width:1280px;height:720px;position:relative;overflow:hidden;
  page-break-after:always;padding:56px 64px 52px;display:flex;flex-direction:column}}
.page.light{{background:var(--ivory);color:var(--ink)}}
.page.light::before{{content:"";position:absolute;top:0;left:0;right:0;height:5px;
  background:linear-gradient(90deg,var(--copper),var(--gold))}}
.page.dark{{background:radial-gradient(120% 130% at 80% -10%,var(--navy2),var(--navy) 70%);color:var(--dink)}}
.page.dark::before{{content:"";position:absolute;top:0;left:0;right:0;height:5px;
  background:linear-gradient(90deg,var(--gold),var(--copper))}}

.chap{{position:absolute;top:22px;left:64px;font-size:11px;letter-spacing:3px;
  color:var(--muted);font-weight:600}}
.dark .chap{{color:var(--dmuted)}}
.folio{{position:absolute;bottom:18px;right:64px;left:64px;display:flex;
  justify-content:space-between;font-size:10.5px;letter-spacing:1.5px;color:var(--muted)}}
.dark .folio{{color:var(--dmuted)}}
.folio .ft{{opacity:.75}}

.eyebrow{{font-size:12px;letter-spacing:4px;font-weight:800;color:var(--copper);
  margin-bottom:12px}}
.dark .eyebrow{{color:var(--gold)}}
.h{{font-family:var(--serif);font-weight:900;font-size:40px;line-height:1.12}}
.sub{{color:var(--muted);font-weight:300;font-size:17px;line-height:1.55;
  max-width:900px;margin:12px auto 0}}
.dark .sub{{color:var(--dmuted)}}
.body{{font-size:16.5px;line-height:1.72;font-weight:300;margin-top:16px;color:var(--ink)}}
.dark .body{{color:var(--dink)}}
.body b{{font-weight:800}}
.accent-line{{border-right:3px solid var(--copper);padding-right:16px;
  font-weight:400;color:var(--copper2)}}
.dark .accent-line{{color:var(--gold);border-color:var(--gold)}}

/* cover */
.coverpage{{padding:0}}
.cover{{display:flex;height:100%;align-items:stretch}}
.cover-img{{flex:0 0 44%;position:relative;overflow:hidden}}
.cover-img img{{width:100%;height:100%;object-fit:cover;object-position:center 20%}}
.cover-img::after{{content:"";position:absolute;inset:0;
  background:linear-gradient(270deg,#111a2b 2%,transparent 45%)}}
.cover-txt{{flex:1;display:flex;flex-direction:column;justify-content:center;
  padding:60px 84px;position:relative;z-index:2}}
.cover-txt h1{{font-family:var(--serif);font-weight:900;font-size:150px;line-height:.95;
  letter-spacing:3px;background:linear-gradient(120deg,#fff,var(--gold) 60%,var(--copper));
  -webkit-background-clip:text;background-clip:text;color:transparent}}
.cover-txt h1.small{{font-size:76px;letter-spacing:0}}
.cover-txt h2{{font-family:var(--serif);font-weight:700;font-size:34px;margin-top:14px}}
.cover-txt .en{{color:var(--dmuted);letter-spacing:4px;font-size:14px;margin-top:8px;
  text-transform:uppercase}}
.rule{{width:130px;height:3px;border-radius:2px;margin:22px 0 6px;
  background:linear-gradient(90deg,var(--gold),transparent)}}
.byline{{font-size:20px;margin-top:18px;font-weight:300}}
.byline b{{font-weight:800;color:var(--gold)}}
.tagline{{font-family:var(--serif);font-size:19px;color:var(--dmuted);margin-top:10px;font-weight:700}}
.hash{{display:inline-block;margin-top:22px;font-weight:800;font-size:15px;
  color:var(--navy);background:linear-gradient(90deg,var(--gold),var(--copper));
  padding:9px 22px;border-radius:999px;direction:ltr;width:fit-content}}

/* layouts */
.split{{display:flex;gap:44px;flex:1;min-height:0;align-items:center}}
.split .txt{{flex:1.05}}
.split .pane{{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center}}
.split.rev .pane{{flex:.92}}
.center-head{{text-align:center;margin-bottom:26px}}
.cards4{{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;flex:1;align-content:center}}
.card{{background:#fff;border:1px solid var(--line);border-radius:14px;padding:24px 20px;
  box-shadow:0 6px 18px #1c243414;min-height:235px;display:flex;
  flex-direction:column;justify-content:center}}
.dark .card{{background:#ffffff0d;border-color:#ffffff22;box-shadow:none}}
.card h3{{font-size:18px;font-weight:800;margin:12px 0 8px;color:var(--copper2)}}
.dark .card h3{{color:var(--gold)}}
.card p{{font-size:13.5px;line-height:1.6;color:var(--muted);font-weight:300}}
.dark .card p{{color:var(--dmuted)}}
.dot{{width:14px;height:14px;border-radius:50%}}
.d1{{background:#b4642a}}.d2{{background:#8a6f3c}}.d3{{background:#5f7460}}.d4{{background:#54617e}}
.foot-note{{margin-top:22px;text-align:center;font-size:13.5px;color:var(--muted);font-weight:300}}
.dark .foot-note{{color:var(--dmuted)}}

/* photos */
.ph{{position:relative;overflow:hidden;border-radius:10px;background:#0002;
  border:1px solid #00000014;display:flex;flex-direction:column;min-height:0}}
.dark .ph{{border-color:#ffffff22}}
.ph img{{width:100%;height:100%;object-fit:cover;flex:1;min-height:0}}
.ph figcaption{{position:absolute;bottom:0;left:0;right:0;padding:22px 12px 8px;
  font-size:12px;color:#fff;font-weight:400;
  background:linear-gradient(0deg,#000c,transparent);letter-spacing:.2px}}
.wall{{display:grid;gap:12px;flex:1;min-height:0;grid-auto-rows:1fr}}
.wall .ph{{aspect-ratio:auto}}
.wall-head{{text-align:center;margin-bottom:20px}}
.wall-head .sub{{margin-top:8px}}

/* hero rows */
.hero-row{{display:flex;gap:24px;margin-bottom:16px;height:330px}}
.hero-row .hero-main{{flex:0 0 40%;display:flex}}
.hero-row .hero-main .ph{{width:100%}}
.hero-row .hero-side{{flex:1;display:flex;flex-direction:column;justify-content:center}}
.hero-row + .wall{{height:212px;flex:none}}

/* stats */
.stats{{display:flex;gap:22px;flex:1;align-items:stretch;min-height:0}}
.stat{{background:#ffffff0d;border:1px solid #ffffff22;border-radius:16px;
  padding:26px 30px;display:flex;flex-direction:column;justify-content:center}}
.stat.main{{flex:1.15;align-items:center;text-align:center;
  background:linear-gradient(160deg,#b4642a2e,#ffffff08);border-color:#dfa35c66}}
.statcol{{flex:1;display:grid;gap:16px}}
.stat .num{{font-family:var(--serif);font-weight:900;font-size:130px;line-height:1;
  background:linear-gradient(120deg,#fff,var(--gold),var(--copper));
  -webkit-background-clip:text;background-clip:text;color:transparent;direction:ltr}}
.stat .num.s{{font-size:44px}}
.stat .num .of{{font-size:44px;font-weight:700}}
.stat p{{color:var(--dmuted);font-size:15px;line-height:1.55;margin-top:10px;font-weight:300}}

/* pain ladder — 3D extruded bars */
.ladder{{max-width:1000px;width:100%;margin:6px auto 0;flex:1;display:flex;
  flex-direction:column;justify-content:center;gap:30px}}
.lrow{{display:flex;align-items:center;gap:18px}}
.llab{{flex:0 0 250px;font-size:16.5px;color:var(--dmuted);font-weight:400}}
.lbar{{flex:1;height:34px;position:relative;overflow:visible}}
.lbar .track{{position:absolute;inset:0;border-radius:6px;background:#ffffff07;
  border:1px dashed #ffffff14}}
.fill{{position:absolute;top:0;right:0;bottom:0;background:#5d6a85;
  border-radius:2px;box-shadow:0 10px 22px #0006}}
.fill::before{{content:"";position:absolute;left:0;right:0;top:-11px;height:11px;
  background:#7d89a4;transform:skewX(45deg);transform-origin:bottom}}
.fill::after{{content:"";position:absolute;left:-11px;top:0;bottom:0;width:11px;
  background:#454f68;transform:skewY(45deg);transform-origin:right}}
.lnum{{flex:0 0 64px;font-family:var(--serif);font-weight:900;font-size:26px;
  color:var(--dmuted);direction:ltr;text-align:left;
  text-shadow:0 2px 0 #0008,0 4px 10px #0006}}
.lrow.crps .llab{{color:var(--gold);font-weight:800;font-size:18px}}
.lrow.crps .lbar{{height:46px}}
.lrow.crps .fill{{background:linear-gradient(90deg,var(--gold),var(--copper));
  box-shadow:0 14px 30px #dfa35c44}}
.lrow.crps .fill::before{{top:-14px;height:14px;background:#f2c487}}
.lrow.crps .fill::after{{left:-14px;width:14px;background:#8a4a1d}}
.lrow.crps .lnum{{color:var(--gold);font-size:38px}}
.kicker{{text-align:center;font-size:17px;color:var(--dink);font-weight:300;
  margin-top:16px;line-height:1.6}}
.kicker b{{color:var(--gold);font-weight:800}}

/* quote */
.quotepage{{align-items:center;justify-content:center}}
.quote-bg{{position:absolute;inset:0}}
.quote-bg img{{width:100%;height:100%;object-fit:cover;filter:brightness(.34) saturate(.85)}}
.quote-veil{{position:absolute;inset:0;background:radial-gradient(90% 90% at 50% 40%,transparent 20%,#111a2bd9 100%)}}
.quote{{position:relative;z-index:2;text-align:center;max-width:900px;margin:auto}}
.qmark{{font-family:var(--serif);font-size:150px;line-height:.4;color:var(--gold);opacity:.65}}
.quote blockquote{{font-family:var(--serif);font-weight:700;font-size:46px;line-height:1.35;
  margin-top:16px;text-shadow:0 6px 30px #000c}}
.qby{{margin-top:24px;color:var(--gold);font-size:16px;letter-spacing:2px}}

/* asks */
.asks{{list-style:none;counter-reset:ask;max-width:980px;margin:8px auto 0;flex:1;
  display:flex;flex-direction:column;justify-content:center;gap:15px}}
.asks li{{counter-increment:ask;display:flex;align-items:center;gap:22px;
  background:#ffffff0d;border:1px solid #ffffff1f;border-radius:14px;padding:16px 24px;
  font-size:17.5px;line-height:1.55;font-weight:300}}
.asks li b{{font-weight:800;color:var(--gold)}}
.asks li::before{{content:counter(ask);font-family:var(--serif);font-weight:900;
  font-size:34px;color:var(--gold);flex:0 0 40px;text-align:center}}

.ww .ph img{{object-position:center 12%}}
.flyer .ph{{max-height:560px}}
.flyer .ph img{{object-fit:contain;background:#fff}}
.pane .wall{{height:520px}}
</style>
</head>
<body>
{body}
</body>
</html>"""

with open(OUT, "w", encoding="utf-8") as f:
    f.write(HTML)
print(f"Wrote {OUT} ({os.path.getsize(OUT)/1024/1024:.2f} MB), {total} pages")
