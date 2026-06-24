#!/usr/bin/env python3
"""Build a single self-contained, cinematic HTML presentation about CRPS with embedded images."""
import base64
import io
import os

from PIL import Image, ImageOps

UPLOADS = "/root/.claude/uploads/d95bbaf8-f767-53d5-9b8b-0f6c3551b17b"
OUT = os.path.join(os.path.dirname(__file__), "index.html")

# Optimisation: phones don't need full-res photos. Down-scaling + recompressing
# keeps the deck sharp on a phone screen while shrinking the file ~3x so it
# opens instantly everywhere instead of choking on a heavy preview.
MAX_DIM = 1080
QUALITY = 68


def b64(name):
    path = os.path.join(UPLOADS, name)
    img = Image.open(path)
    img = ImageOps.exif_transpose(img)  # honour camera rotation, then drop EXIF
    img = img.convert("RGB")
    img.thumbnail((MAX_DIM, MAX_DIM), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=QUALITY, optimize=True, progressive=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


# Categorized images
CATS = {
    "hospital_a": [
        "0d84f904-IMG20250722WA0067.jpg",
        "fbf59d46-IMG20250722WA0091.jpg",
        "582b1db3-IMG20250722WA0113.jpg",
        "a2cf3253-IMG20250722WA0114.jpg",
    ],
    "hospital_b": [
        "90cfb7c7-IMG20250722WA0119.jpg",
        "e7b993c6-IMG20250722WA0122.jpg",
        "58cd4fb2-IMG20250722WA0101.jpg",
        "869e2c39-IMG20250722WA0106.jpg",
    ],
    "pain_a": [
        "187dc8c6-IMG20250722WA0098.jpg",
        "e4fe0174-IMG20250722WA0096.jpg",
        "6ee703d5-IMG20250722WA0120.jpg",
        "e4c31d2e-IMG20250722WA0115.jpg",
        "9a38cdbf-IMG20250722WA0117.jpg",
    ],
    "pain_b": [
        "5b89500d-IMG20250722WA0112.jpg",
        "eb63f106-IMG20250722WA0116.jpg",
        "b429ab7b-IMG20250722WA0097.jpg",
        "880af9ad-IMG20250722WA0107.jpg",
    ],
    "family": [
        "a73f490c-IMG20250722WA0118.jpg",
        "203d0b5b-IMG20250722WA0079.jpg",
    ],
    "hope": [
        "f5dc4285-IMG20250722WA0121.jpg",
    ],
}

DATA = {k: [b64(n) for n in v] for k, v in CATS.items()}
# A strong portrait used as the cinematic cover / divider backdrop.
HERO = DATA["hope"][0]


def grid(images, extra=""):
    cells = "\n".join(
        f'<figure class="card zoomable">'
        f'<img loading="eager" src="{src}" alt="">'
        f'<span class="card-zoom">⤢</span></figure>'
        for src in images
    )
    return f'<div class="grid {extra}">{cells}</div>'


slides = []

# 1. Cinematic cover ---------------------------------------------------------
slides.append(f"""
<section class="slide cover-slide" style="--cover:url('{HERO}')">
  <div class="cover-bg"></div>
  <div class="cover-veil"></div>
  <div class="cover-inner">
    <div class="ribbon">מסע של כאב · כוח · ואי־ויתור</div>
    <h1 class="mega">CRPS</h1>
    <div class="mega-line"></div>
    <h2 class="sub">תסמונת כאב אזורי מורכבת</h2>
    <p class="subeng">Complex Regional Pain Syndrome</p>
    <p class="lead">
      מחלה כרונית ונדירה של מערכת העצבים, שגורמת לכאב צורב ובלתי־פוסק —
      חזק הרבה יותר ממה שאפשר לדמיין. זה הסיפור האמיתי שמאחורי החיוך.
    </p>
    <div class="scroll-hint"><span class="arrow">⌄</span> החליקו או לחצו על החצים כדי להתחיל</div>
  </div>
</section>
""")

# 2. What is CRPS ------------------------------------------------------------
slides.append("""
<section class="slide info-slide">
  <div class="info-inner">
    <span class="eyebrow">להכיר מקרוב</span>
    <h2 class="slide-title">מה זה <span class="hl">CRPS</span>?</h2>
    <div class="cards-row">
      <div class="info-card">
        <div class="ic">🔥</div>
        <h3>כאב מתמיד</h3>
        <p>כאב צורב ועז שלא פוסק, עם רגישות קיצונית למגע ולשינויי טמפרטורה.</p>
      </div>
      <div class="info-card">
        <div class="ic">🧠</div>
        <h3>מערכת העצבים</h3>
        <p>תגובת־יתר של מערכת העצבים — אות הכאב "נתקע" ומתעצם ללא הרף.</p>
      </div>
      <div class="info-card">
        <div class="ic">💪</div>
        <h3>השפעה על היומיום</h3>
        <p>נפיחות, שינויי צבע בעור ועייפות — מאבק בכל פעולה פשוטה.</p>
      </div>
      <div class="info-card">
        <div class="ic">❤️</div>
        <h3>צריך תמיכה</h3>
        <p>טיפול, סבלנות והרבה אהבה מהמשפחה הופכים את ההתמודדות לאפשרית.</p>
      </div>
    </div>
  </div>
</section>
""")

# 3. Impact / statistics -----------------------------------------------------
slides.append("""
<section class="slide stat-slide">
  <div class="stat-inner">
    <span class="eyebrow">העוצמה של הכאב</span>
    <h2 class="slide-title">כאב שמדורג <span class="hl">מעל הכל</span></h2>
    <p class="stat-sub">לפי מדד הכאב של מקגיל (McGill Pain Index) — CRPS נחשב לאחד הכאבים העזים שתועדו אצל בני אדם.</p>
    <div class="stat-grid">
      <div class="stat-card big">
        <div class="num" data-to="42">0</div>
        <div class="stat-of">מתוך 50 במדד הכאב</div>
        <div class="stat-cap">CRPS — גבוה יותר מקטיעת אצבע ומלידה טבעית</div>
      </div>
      <div class="stat-col">
        <div class="stat-card">
          <div class="num small" data-to="1">0</div>
          <div class="stat-cap">מתוך ~3,800 אנשים מאובחנים — מחלה נדירה</div>
        </div>
        <div class="stat-card">
          <div class="num small suffix" data-to="2" data-suffix="–4×">0</div>
          <div class="stat-cap">שכיח יותר אצל נשים מאשר אצל גברים</div>
        </div>
        <div class="stat-card">
          <div class="num small suffix" data-to="100" data-suffix="%">0</div>
          <div class="stat-cap">אמיתי ומתיש — גם כשלא רואים אותו מבחוץ</div>
        </div>
      </div>
    </div>
  </div>
</section>
""")

# 4. Hospital A --------------------------------------------------------------
slides.append(f"""
<section class="slide gallery-slide">
  <div class="gallery-inner">
    <div class="cat-head"><span class="sec-num">01</span>
      <div><h2 class="slide-title">ימים בבית החולים</h2>
      <p class="cat-desc">בין עירויים, מיטות אשפוז וקירות לבנים</p></div>
    </div>
    {grid(DATA['hospital_a'], 'g4')}
  </div>
</section>
""")

# 5. Hospital B (monitors) ---------------------------------------------------
slides.append(f"""
<section class="slide gallery-slide">
  <div class="gallery-inner">
    <div class="cat-head"><span class="sec-num">02</span>
      <div><h2 class="slide-title">מחוברת למכשירים</h2>
      <p class="cat-desc">אלקטרודות, מוניטורים וצנתרים — שגרה חדשה</p></div>
    </div>
    {grid(DATA['hospital_b'], 'g4')}
  </div>
</section>
""")

# 6. Quote -------------------------------------------------------------------
slides.append(f"""
<section class="slide quote-slide" style="--cover:url('{DATA['pain_a'][0]}')">
  <div class="cover-bg dim"></div>
  <div class="cover-veil"></div>
  <div class="quote-inner">
    <div class="quote-mark">”</div>
    <blockquote>הכאב לא תמיד נראה מבחוץ —<br>אבל הוא אמיתי בכל שנייה.</blockquote>
    <div class="quote-by">— החיים עם CRPS</div>
  </div>
</section>
""")

# 7. Pain A ------------------------------------------------------------------
slides.append(f"""
<section class="slide gallery-slide">
  <div class="gallery-inner">
    <div class="cat-head"><span class="sec-num">03</span>
      <div><h2 class="slide-title">כשהכאב משתלט</h2>
      <p class="cat-desc">רגעים של עייפות וכאב — בבית וברכב</p></div>
    </div>
    {grid(DATA['pain_a'], 'g5')}
  </div>
</section>
""")

# 8. Pain B ------------------------------------------------------------------
slides.append(f"""
<section class="slide gallery-slide">
  <div class="gallery-inner">
    <div class="cat-head"><span class="sec-num">04</span>
      <div><h2 class="slide-title">לנוח, להתאושש</h2>
      <p class="cat-desc">הגוף דורש מנוחה אחרי ימים ארוכים</p></div>
    </div>
    {grid(DATA['pain_b'], 'g4')}
  </div>
</section>
""")

# 9. Family ------------------------------------------------------------------
slides.append(f"""
<section class="slide gallery-slide">
  <div class="gallery-inner">
    <div class="cat-head"><span class="sec-num">05</span>
      <div><h2 class="slide-title">המשפחה תמיד לצידי</h2>
      <p class="cat-desc">החיוך והתמיכה שנותנים כוח להמשיך</p></div>
    </div>
    {grid(DATA['family'], 'g2')}
  </div>
</section>
""")

# 10. Hope (feature) ---------------------------------------------------------
slides.append(f"""
<section class="slide hope-slide">
  <div class="hope-inner">
    <div class="hope-img zoomable">
      <img src="{DATA['hope'][0]}" alt="">
      <span class="card-zoom">⤢</span>
    </div>
    <div class="hope-text">
      <span class="cat-emoji big">👑</span>
      <h2 class="slide-title">אבל לא מוותרים</h2>
      <p class="cat-desc big">
        למרות הכל — ממשיכים לחייך, להתלבש יפה, ולחיות.
        הכאב הוא חלק מהסיפור, אבל הוא לא כל הסיפור.
      </p>
    </div>
  </div>
</section>
""")

# 11. Closing ----------------------------------------------------------------
slides.append(f"""
<section class="slide closing-slide" style="--cover:url('{HERO}')">
  <div class="cover-bg dim"></div>
  <div class="cover-veil"></div>
  <div class="closing-inner">
    <h2 class="closing-h">כל יום הוא ניצחון 💛</h2>
    <p class="closing-p">
      מודעות ל‑CRPS חשובה. ככל שיותר אנשים יכירו את המחלה,
      כך החולים יקבלו יותר הבנה, תמיכה וטיפול.
    </p>
    <div class="closing-tag" dir="ltr">#CRPS_Awareness</div>
  </div>
</section>
""")

slides_html = "\n".join(slides)
n = len(slides)

HTML = f"""<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<meta name="theme-color" content="#0a0710">
<title>CRPS — תסמונת כאב אזורי מורכבת</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Frank+Ruhl+Libre:wght@500;700;900&family=Heebo:wght@300;400;500;700;900&display=swap" rel="stylesheet">
<style>
:root{{
  --bg0:#0a0710; --bg1:#1a1024; --bg2:#2a1530;
  --accent:#ff8a3d; --accent2:#ffce8a; --gold:#e8b366; --rose:#ff6b8a;
  --ink:#fbf7ff; --muted:#cabbe0; --card:#ffffff10; --line:#ffffff1f;
  --serif:'Frank Ruhl Libre',Georgia,serif;
  --sans:'Heebo',-apple-system,'Segoe UI',Arial,sans-serif;
}}
*{{box-sizing:border-box;margin:0;padding:0}}
html,body{{height:100%}}
body{{
  font-family:var(--sans);background:var(--bg0);color:var(--ink);
  overflow:hidden;-webkit-font-smoothing:antialiased;
}}
#deck{{position:fixed;inset:0}}

/* film grain + vignette overlays for a cinematic, mature feel */
#grain,#vignette{{position:fixed;inset:0;pointer-events:none;z-index:40}}
#vignette{{box-shadow:inset 0 0 26vw 6vw #000a, inset 0 0 4vw #0006;}}
#grain{{opacity:.05;mix-blend-mode:overlay;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");}}

.slide{{
  position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  padding:clamp(20px,4vw,68px);opacity:0;visibility:hidden;
  transform:scale(1.04);transition:opacity .7s ease,transform .7s ease,visibility .7s;
  background:radial-gradient(130% 130% at 78% -10%,var(--bg2),var(--bg1) 55%,var(--bg0) 100%);
}}
.slide.active{{opacity:1;visibility:visible;transform:scale(1)}}

/* decorative glow */
.slide::before{{content:"";position:absolute;width:62vw;height:62vw;border-radius:50%;
  background:radial-gradient(circle,#ff8a3d2e,transparent 70%);top:-22vw;left:-16vw;
  pointer-events:none;filter:blur(10px)}}
.slide::after{{content:"";position:absolute;width:52vw;height:52vw;border-radius:50%;
  background:radial-gradient(circle,#7a4bff2b,transparent 70%);bottom:-22vw;right:-16vw;
  pointer-events:none}}

/* ---- Cinematic full-bleed background (cover / quote / closing) ---- */
.cover-bg{{position:absolute;inset:0;background-image:var(--cover);
  background-size:cover;background-position:center 28%;
  transform:scale(1.12);animation:kenburns 18s ease-in-out infinite alternate;z-index:0}}
.cover-bg.dim{{filter:brightness(.5) saturate(.9)}}
.cover-veil{{position:absolute;inset:0;z-index:1;
  background:linear-gradient(180deg,#0a0710cc 0%,#0a071066 38%,#0a0710aa 75%,#0a0710f2 100%),
             radial-gradient(120% 90% at 50% 30%,transparent 30%,#0a0710bb 100%)}}
@keyframes kenburns{{from{{transform:scale(1.12) translate(0,0)}}to{{transform:scale(1.24) translate(-2%,-3%)}}}}

/* ---- Cover ---- */
.cover-inner{{text-align:center;max-width:1000px;position:relative;z-index:3;
  animation:rise 1s ease both}}
.ribbon{{display:inline-block;padding:9px 22px;border:1px solid var(--line);
  border-radius:999px;color:var(--accent2);letter-spacing:3px;font-weight:500;
  font-size:clamp(11px,1.4vw,14px);background:#ffffff0d;margin-bottom:26px;
  backdrop-filter:blur(6px)}}
.mega{{font-family:var(--serif);font-size:clamp(86px,19vw,232px);font-weight:900;line-height:.86;
  background:linear-gradient(120deg,#fff 10%,var(--accent2) 55%,var(--accent));
  -webkit-background-clip:text;background-clip:text;color:transparent;
  letter-spacing:6px;filter:drop-shadow(0 14px 50px #ff8a3d66)}}
.mega-line{{width:clamp(80px,16vw,180px);height:3px;margin:18px auto 0;border-radius:3px;
  background:linear-gradient(90deg,transparent,var(--accent),transparent)}}
.sub{{font-family:var(--serif);font-size:clamp(24px,4.4vw,50px);font-weight:700;margin-top:18px}}
.subeng{{color:var(--muted);font-weight:300;letter-spacing:4px;margin-top:8px;
  font-size:clamp(13px,2vw,20px);text-transform:uppercase}}
.lead{{color:var(--ink);opacity:.94;max-width:720px;margin:26px auto 0;
  font-size:clamp(15px,2.1vw,22px);line-height:1.75;font-weight:300}}
.scroll-hint{{margin-top:42px;color:var(--muted);font-size:14px;opacity:.85;letter-spacing:1px}}
.scroll-hint .arrow{{display:inline-block;font-size:20px;animation:bob 1.8s ease-in-out infinite}}
@keyframes bob{{0%,100%{{transform:translateY(0)}}50%{{transform:translateY(6px)}}}}

/* ---- Section titles ---- */
.eyebrow{{display:inline-block;color:var(--accent);letter-spacing:4px;font-weight:700;
  font-size:clamp(11px,1.5vw,14px);text-transform:uppercase;margin-bottom:10px;opacity:.95}}
.slide-title{{font-family:var(--serif);font-size:clamp(28px,4.8vw,56px);font-weight:900;line-height:1.08}}
.hl{{background:linear-gradient(120deg,var(--accent2),var(--accent));
  -webkit-background-clip:text;background-clip:text;color:transparent}}
.cat-desc{{color:var(--muted);font-weight:300;margin-top:8px;
  font-size:clamp(13px,2vw,20px)}}
.cat-desc.big{{font-size:clamp(16px,2.4vw,26px);line-height:1.65;margin-top:18px}}
.cat-head{{display:flex;align-items:center;gap:20px;margin-bottom:clamp(16px,3vh,34px);
  position:relative;z-index:2}}
.sec-num{{font-family:var(--serif);font-size:clamp(40px,7vw,84px);font-weight:900;line-height:1;
  background:linear-gradient(160deg,var(--accent2),var(--accent));
  -webkit-background-clip:text;background-clip:text;color:transparent;
  flex:none;opacity:.95;filter:drop-shadow(0 6px 20px #ff8a3d44)}}
.cat-emoji{{font-size:clamp(34px,6vw,64px);filter:drop-shadow(0 6px 16px #0008);flex:none}}
.cat-emoji.big{{font-size:clamp(48px,8vw,90px)}}

/* ---- Galleries ---- */
.gallery-slide,.info-slide,.stat-slide{{align-items:stretch}}
.gallery-inner,.info-inner,.stat-inner{{width:100%;max-width:1300px;margin:auto;
  position:relative;z-index:2;display:flex;flex-direction:column;
  animation:rise .8s ease both}}
.grid{{display:grid;gap:clamp(10px,1.6vw,20px);flex:1;min-height:0}}
.grid.g2{{grid-template-columns:repeat(2,1fr)}}
.grid.g4{{grid-template-columns:repeat(2,1fr);grid-template-rows:repeat(2,1fr)}}
.grid.g5{{grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(2,1fr)}}
.grid.g5 .card:first-child{{grid-row:span 2}}
@media(min-width:900px){{ .grid.g4{{grid-template-columns:repeat(4,1fr);grid-template-rows:1fr}} }}
.card{{position:relative;overflow:hidden;border-radius:18px;cursor:pointer;
  border:1px solid var(--line);background:#0008;
  box-shadow:0 18px 44px #0008;transition:transform .4s ease,box-shadow .4s,border-color .4s;
  opacity:0;transform:translateY(20px);animation:pop .7s ease forwards}}
.card:nth-child(1){{animation-delay:.05s}} .card:nth-child(2){{animation-delay:.14s}}
.card:nth-child(3){{animation-delay:.23s}} .card:nth-child(4){{animation-delay:.32s}}
.card:nth-child(5){{animation-delay:.41s}}
.card img{{width:100%;height:100%;object-fit:cover;display:block;transition:transform .6s ease}}
.card::after{{content:"";position:absolute;inset:0;
  background:linear-gradient(180deg,transparent 55%,#0a071099);opacity:.6;transition:.4s}}
.card-zoom{{position:absolute;bottom:12px;left:12px;z-index:3;width:34px;height:34px;
  display:flex;align-items:center;justify-content:center;border-radius:50%;
  background:#0a0710aa;border:1px solid var(--line);color:var(--accent2);
  font-size:15px;opacity:0;transform:scale(.7);transition:.35s;backdrop-filter:blur(4px)}}
.card:hover{{transform:translateY(-5px);box-shadow:0 28px 66px #000b;border-color:var(--accent)}}
.card:hover img{{transform:scale(1.07)}}
.card:hover .card-zoom{{opacity:1;transform:scale(1)}}

/* ---- Info cards ---- */
.cards-row{{display:grid;grid-template-columns:repeat(2,1fr);
  gap:clamp(12px,2vw,22px);margin-top:clamp(18px,3vh,32px)}}
@media(min-width:900px){{ .cards-row{{grid-template-columns:repeat(4,1fr)}} }}
.info-card{{background:var(--card);border:1px solid var(--line);border-radius:22px;
  padding:clamp(20px,2.6vw,32px);text-align:center;
  backdrop-filter:blur(8px);opacity:0;transform:translateY(20px);
  animation:pop .7s ease forwards;transition:transform .35s,border-color .35s}}
.info-card:hover{{transform:translateY(-6px);border-color:var(--accent)}}
.info-card:nth-child(1){{animation-delay:.10s}} .info-card:nth-child(2){{animation-delay:.22s}}
.info-card:nth-child(3){{animation-delay:.34s}} .info-card:nth-child(4){{animation-delay:.46s}}
.info-card .ic{{font-size:clamp(34px,5vw,52px);margin-bottom:14px}}
.info-card h3{{font-size:clamp(17px,2.2vw,24px);margin-bottom:8px;color:var(--accent2);font-weight:700}}
.info-card p{{color:var(--muted);font-weight:300;line-height:1.6;font-size:clamp(13px,1.6vw,17px)}}

/* ---- Stats ---- */
.stat-inner{{text-align:center;max-width:1120px}}
.stat-sub{{color:var(--muted);font-weight:300;max-width:760px;margin:14px auto 0;
  line-height:1.65;font-size:clamp(14px,2vw,20px)}}
.stat-grid{{display:grid;gap:clamp(12px,2vw,20px);margin-top:clamp(20px,3.5vh,38px);
  grid-template-columns:1fr;text-align:right}}
@media(min-width:880px){{ .stat-grid{{grid-template-columns:1.1fr 1fr;align-items:stretch}} }}
.stat-col{{display:grid;gap:clamp(12px,2vw,20px)}}
.stat-card{{background:var(--card);border:1px solid var(--line);border-radius:22px;
  padding:clamp(20px,3vw,40px);backdrop-filter:blur(8px);
  display:flex;flex-direction:column;justify-content:center;
  opacity:0;transform:translateY(20px);animation:pop .7s ease forwards}}
.stat-card.big{{align-items:center;text-align:center;
  background:linear-gradient(160deg,#ff8a3d22,#ffffff08);border-color:#ff8a3d55}}
.stat-card:nth-child(1){{animation-delay:.1s}} .stat-card:nth-child(2){{animation-delay:.25s}}
.stat-card:nth-child(3){{animation-delay:.4s}}
.num{{font-family:var(--serif);font-weight:900;line-height:1;
  background:linear-gradient(120deg,#fff,var(--accent2),var(--accent));
  -webkit-background-clip:text;background-clip:text;color:transparent;
  font-size:clamp(72px,15vw,150px);filter:drop-shadow(0 10px 30px #ff8a3d44)}}
.num.small{{font-size:clamp(40px,7vw,72px)}}
.stat-of{{font-weight:700;color:var(--accent2);margin-top:6px;font-size:clamp(15px,2vw,22px)}}
.stat-cap{{color:var(--muted);font-weight:300;margin-top:10px;line-height:1.55;
  font-size:clamp(13px,1.7vw,18px)}}

/* ---- Quote ---- */
.quote-inner{{position:relative;z-index:3;text-align:center;max-width:920px;
  animation:rise .9s ease both}}
.quote-mark{{font-family:var(--serif);font-size:clamp(90px,18vw,200px);line-height:.5;
  color:var(--accent);opacity:.5;height:.4em}}
blockquote{{font-family:var(--serif);font-weight:700;line-height:1.35;
  font-size:clamp(26px,5.2vw,62px);margin-top:10px;
  text-shadow:0 8px 40px #000a}}
.quote-by{{margin-top:26px;color:var(--accent2);letter-spacing:2px;
  font-size:clamp(14px,2vw,20px);font-weight:500}}

/* ---- Hope ---- */
.hope-inner{{display:flex;gap:clamp(20px,4vw,64px);align-items:center;
  max-width:1200px;width:100%;position:relative;z-index:2;flex-wrap:wrap;
  justify-content:center;animation:rise .8s ease both}}
.hope-img{{flex:0 1 440px;border-radius:26px;overflow:hidden;cursor:pointer;position:relative;
  border:2px solid var(--accent);box-shadow:0 28px 80px #ff8a3d44}}
.hope-img img{{width:100%;display:block;transition:transform .6s ease}}
.hope-img:hover img{{transform:scale(1.05)}}
.hope-img .card-zoom{{opacity:1}}
.hope-text{{flex:1 1 360px;min-width:280px}}

/* ---- Closing ---- */
.closing-inner{{text-align:center;max-width:840px;position:relative;z-index:3;
  animation:rise 1s ease both}}
.closing-h{{font-family:var(--serif);font-size:clamp(36px,7.4vw,78px);font-weight:900;
  background:linear-gradient(120deg,#fff,var(--accent2),var(--accent));
  -webkit-background-clip:text;background-clip:text;color:transparent}}
.closing-p{{color:var(--ink);opacity:.92;font-weight:300;line-height:1.75;
  margin-top:24px;font-size:clamp(16px,2.4vw,24px)}}
.closing-tag{{margin-top:36px;display:inline-block;padding:13px 30px;
  border-radius:999px;background:linear-gradient(120deg,var(--accent),var(--gold));
  color:#1a1024;font-weight:700;letter-spacing:1px;font-size:clamp(14px,2vw,20px);
  box-shadow:0 14px 40px #ff8a3d66}}

/* ---- Lightbox ---- */
#lightbox{{position:fixed;inset:0;z-index:100;background:#050308f2;
  display:none;align-items:center;justify-content:center;padding:4vw;
  backdrop-filter:blur(10px);cursor:zoom-out}}
#lightbox.open{{display:flex;animation:fade .3s ease}}
#lightbox img{{max-width:94vw;max-height:90vh;border-radius:16px;
  box-shadow:0 30px 90px #000c;border:1px solid var(--line)}}
#lightbox .lb-close{{position:absolute;top:18px;left:22px;font-size:34px;color:#fff;
  cursor:pointer;opacity:.8;line-height:1}}
@keyframes fade{{from{{opacity:0}}to{{opacity:1}}}}

/* ---- Nav ---- */
.nav{{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);
  display:flex;align-items:center;gap:16px;z-index:50}}
.nav button{{width:50px;height:50px;border-radius:50%;border:1px solid var(--line);
  background:#ffffff14;color:#fff;font-size:22px;cursor:pointer;
  display:flex;align-items:center;justify-content:center;
  backdrop-filter:blur(8px);transition:.25s}}
.nav button:hover{{background:var(--accent);color:#1a1024;transform:scale(1.08)}}
.dots{{display:flex;gap:8px}}
.dot{{width:9px;height:9px;border-radius:50%;background:#ffffff44;cursor:pointer;transition:.25s}}
.dot.active{{background:var(--accent);width:26px;border-radius:6px}}
.counter{{position:fixed;top:20px;left:24px;z-index:50;color:var(--muted);
  font-size:14px;letter-spacing:1px;background:#ffffff10;padding:6px 14px;
  border-radius:999px;border:1px solid var(--line);backdrop-filter:blur(6px)}}
.progress{{position:fixed;top:0;right:0;height:4px;background:linear-gradient(90deg,var(--gold),var(--accent));
  z-index:60;transition:width .6s ease;box-shadow:0 0 16px var(--accent)}}

@keyframes rise{{from{{opacity:0;transform:translateY(28px)}}to{{opacity:1;transform:none}}}}
@keyframes pop{{to{{opacity:1;transform:none}}}}

@media(max-width:600px){{
  .cat-head{{gap:14px}}
  .hope-inner{{flex-direction:column}}
  .grid.g5{{grid-template-columns:repeat(2,1fr);grid-template-rows:none}}
  .grid.g5 .card:first-child{{grid-row:auto}}
  .stat-grid{{text-align:center}}
  #vignette{{box-shadow:inset 0 0 30vw 4vw #0009}}
}}
@media(prefers-reduced-motion:reduce){{
  .cover-bg{{animation:none}}
}}
</style>
</head>
<body>
<div class="progress" id="progress"></div>
<div class="counter"><span id="cur">1</span> / {n}</div>
<div id="deck">
{slides_html}
</div>
<div id="vignette"></div>
<div id="grain"></div>
<div id="lightbox"><span class="lb-close">✕</span><img src="" alt=""></div>
<div class="nav">
  <button id="next" aria-label="הבא">‹</button>
  <div class="dots" id="dots"></div>
  <button id="prev" aria-label="הקודם">›</button>
</div>
<script>
const slides=[...document.querySelectorAll('.slide')];
const dotsWrap=document.getElementById('dots');
const progress=document.getElementById('progress');
const cur=document.getElementById('cur');
let i=0;
slides.forEach((_,idx)=>{{
  const d=document.createElement('div');d.className='dot';
  d.onclick=()=>go(idx);dotsWrap.appendChild(d);
}});
const dots=[...document.querySelectorAll('.dot')];

function animateStats(slide){{
  slide.querySelectorAll('.num[data-to]').forEach(el=>{{
    const to=+el.dataset.to, suf=el.dataset.suffix||'';
    const dur=1100, t0=performance.now();
    function step(t){{
      const p=Math.min(1,(t-t0)/dur);
      const e=1-Math.pow(1-p,3);
      el.textContent=Math.round(to*e)+(p>=1?suf:'');
      if(p<1)requestAnimationFrame(step);
    }}
    requestAnimationFrame(step);
  }});
}}

function go(n){{
  i=Math.max(0,Math.min(slides.length-1,n));
  slides.forEach((s,x)=>s.classList.toggle('active',x===i));
  dots.forEach((d,x)=>d.classList.toggle('active',x===i));
  progress.style.width=((i+1)/slides.length*100)+'%';
  cur.textContent=i+1;
  if(slides[i].classList.contains('stat-slide'))animateStats(slides[i]);
}}
// RTL: ‹ goes forward, › goes back
document.getElementById('next').onclick=()=>go(i+1);
document.getElementById('prev').onclick=()=>go(i-1);
document.addEventListener('keydown',e=>{{
  if(e.key==='ArrowLeft'||e.key===' '||e.key==='PageDown')go(i+1);
  if(e.key==='ArrowRight'||e.key==='PageUp')go(i-1);
  if(e.key==='Home')go(0);if(e.key==='End')go(slides.length-1);
  if(e.key==='Escape')closeLb();
}});
// swipe
let sx=0,sy=0;
document.addEventListener('touchstart',e=>{{sx=e.touches[0].clientX;sy=e.touches[0].clientY;}},{{passive:true}});
document.addEventListener('touchend',e=>{{
  const dx=e.changedTouches[0].clientX-sx, dy=e.changedTouches[0].clientY-sy;
  if(Math.abs(dx)>50&&Math.abs(dx)>Math.abs(dy)){{ dx<0?go(i+1):go(i-1); }}
}},{{passive:true}});

// lightbox
const lb=document.getElementById('lightbox'), lbImg=lb.querySelector('img');
function openLb(src){{lbImg.src=src;lb.classList.add('open');}}
function closeLb(){{lb.classList.remove('open');}}
document.querySelectorAll('.zoomable').forEach(el=>{{
  el.addEventListener('click',()=>{{const im=el.querySelector('img');if(im)openLb(im.src);}});
}});
lb.addEventListener('click',closeLb);

go(0);
</script>
</body>
</html>"""

with open(OUT, "w", encoding="utf-8") as f:
    f.write(HTML)

print(f"Wrote {OUT} ({os.path.getsize(OUT)/1024/1024:.2f} MB), {n} slides")
