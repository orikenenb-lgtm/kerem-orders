#!/usr/bin/env python3
"""Build a single self-contained HTML presentation about CRPS with embedded images."""
import base64
import os

UPLOADS = "/root/.claude/uploads/d95bbaf8-f767-53d5-9b8b-0f6c3551b17b"
OUT = os.path.join(os.path.dirname(__file__), "index.html")


def b64(name):
    path = os.path.join(UPLOADS, name)
    with open(path, "rb") as f:
        return "data:image/jpeg;base64," + base64.b64encode(f.read()).decode()


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


def grid(images, extra=""):
    cells = "\n".join(
        f'<figure class="card"><img loading="eager" src="{src}" alt=""></figure>'
        for src in images
    )
    return f'<div class="grid {extra}">{cells}</div>'


slides = []

# 1. Title
slides.append("""
<section class="slide title-slide">
  <div class="title-inner">
    <div class="ribbon">מודעות · CRPS · אורנג'</div>
    <h1 class="mega">CRPS</h1>
    <h2 class="sub">תסמונת כאב אזורי מורכבת</h2>
    <p class="subeng">Complex Regional Pain Syndrome</p>
    <p class="lead">
      מחלה כרונית נדירה של מערכת העצבים, שגורמת לכאב עז ומתמשך —
      לרוב חזק בהרבה ממה שניתן לצפות מהפציעה המקורית.
      זהו סיפור על ימים קשים, על כוח, ועל לא לוותר.
    </p>
    <div class="scroll-hint">לחצו על החצים או על מקלדת ← → למעבר בין שקפים</div>
  </div>
</section>
""")

# 2. What is CRPS
slides.append("""
<section class="slide info-slide">
  <div class="info-inner">
    <h2 class="slide-title">מה זה <span class="hl">CRPS</span>?</h2>
    <div class="cards-row">
      <div class="info-card">
        <div class="ic">🔥</div>
        <h3>כאב מתמיד</h3>
        <p>כאב צורב ועז שלא פוסק, רגישות קיצונית למגע ולשינויי טמפרטורה.</p>
      </div>
      <div class="info-card">
        <div class="ic">🧠</div>
        <h3>מערכת העצבים</h3>
        <p>תגובת יתר של מערכת העצבים — האות של הכאב "נתקע" ומתעצם.</p>
      </div>
      <div class="info-card">
        <div class="ic">💪</div>
        <h3>השפעה על היומיום</h3>
        <p>נפיחות, שינויי צבע בעור, עייפות — ומאבק יומיומי בכל פעולה פשוטה.</p>
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

# 3. Hospital A
slides.append(f"""
<section class="slide gallery-slide">
  <div class="gallery-inner">
    <div class="cat-head"><span class="cat-emoji">🏥</span>
      <div><h2 class="slide-title">ימים בבית החולים</h2>
      <p class="cat-desc">בין עירויים, מיטות אשפוז וקירות לבנים</p></div>
    </div>
    {grid(DATA['hospital_a'], 'g4')}
  </div>
</section>
""")

# 4. Hospital B (monitors)
slides.append(f"""
<section class="slide gallery-slide">
  <div class="gallery-inner">
    <div class="cat-head"><span class="cat-emoji">📈</span>
      <div><h2 class="slide-title">מחוברת למכשירים</h2>
      <p class="cat-desc">אלקטרודות, מוניטורים וצנתרים — שגרה חדשה</p></div>
    </div>
    {grid(DATA['hospital_b'], 'g4')}
  </div>
</section>
""")

# 5. Pain A
slides.append(f"""
<section class="slide gallery-slide">
  <div class="gallery-inner">
    <div class="cat-head"><span class="cat-emoji">😣</span>
      <div><h2 class="slide-title">כשהכאב משתלט</h2>
      <p class="cat-desc">רגעים של עייפות וכאב — בבית וברכב</p></div>
    </div>
    {grid(DATA['pain_a'], 'g5')}
  </div>
</section>
""")

# 6. Pain B
slides.append(f"""
<section class="slide gallery-slide">
  <div class="gallery-inner">
    <div class="cat-head"><span class="cat-emoji">😴</span>
      <div><h2 class="slide-title">לנוח, להתאושש</h2>
      <p class="cat-desc">הגוף דורש מנוחה אחרי ימים ארוכים</p></div>
    </div>
    {grid(DATA['pain_b'], 'g4')}
  </div>
</section>
""")

# 7. Family
slides.append(f"""
<section class="slide gallery-slide">
  <div class="gallery-inner">
    <div class="cat-head"><span class="cat-emoji">👨‍👩‍👦</span>
      <div><h2 class="slide-title">המשפחה תמיד לצידי</h2>
      <p class="cat-desc">החיוך והתמיכה שנותנים כוח להמשיך</p></div>
    </div>
    {grid(DATA['family'], 'g2')}
  </div>
</section>
""")

# 8. Hope
slides.append(f"""
<section class="slide hope-slide">
  <div class="hope-inner">
    <div class="hope-img">{('<img src="%s" alt="">' % DATA['hope'][0])}</div>
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

# 9. Closing
slides.append("""
<section class="slide closing-slide">
  <div class="closing-inner">
    <h2 class="closing-h">כל יום הוא ניצחון 💛</h2>
    <p class="closing-p">
      מודעות ל‑CRPS חשובה. ככל שיותר אנשים יכירו את המחלה,
      כך החולים יקבלו יותר הבנה, תמיכה וטיפול.
    </p>
    <div class="closing-tag">#CRPS_Awareness</div>
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
<title>CRPS — תסמונת כאב אזורי מורכבת</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;500;700;900&display=swap" rel="stylesheet">
<style>
:root{{
  --bg1:#1a1033; --bg2:#2b1a4d; --accent:#ff7a2f; --accent2:#ffb347;
  --ink:#f6f1ff; --muted:#c9bce6; --card:#ffffff14; --line:#ffffff22;
}}
*{{box-sizing:border-box;margin:0;padding:0}}
html,body{{height:100%}}
body{{
  font-family:'Heebo',-apple-system,'Segoe UI',Arial,sans-serif;
  background:#0e0820;color:var(--ink);overflow:hidden;
}}
#deck{{position:fixed;inset:0}}
.slide{{
  position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  padding:clamp(20px,4vw,64px);opacity:0;visibility:hidden;
  transform:scale(1.03);transition:opacity .6s ease,transform .6s ease,visibility .6s;
  background:radial-gradient(120% 120% at 80% 0%,var(--bg2),var(--bg1) 60%,#0e0820 100%);
}}
.slide.active{{opacity:1;visibility:visible;transform:scale(1)}}

/* decorative glow */
.slide::before{{content:"";position:absolute;width:60vw;height:60vw;border-radius:50%;
  background:radial-gradient(circle,#ff7a2f33,transparent 70%);top:-20vw;left:-15vw;
  pointer-events:none;filter:blur(8px)}}
.slide::after{{content:"";position:absolute;width:50vw;height:50vw;border-radius:50%;
  background:radial-gradient(circle,#7a4bff33,transparent 70%);bottom:-20vw;right:-15vw;
  pointer-events:none}}

/* ---- Title ---- */
.title-inner{{text-align:center;max-width:980px;position:relative;z-index:2;
  animation:rise .8s ease both}}
.ribbon{{display:inline-block;padding:8px 20px;border:1px solid var(--line);
  border-radius:999px;color:var(--accent2);letter-spacing:2px;font-weight:500;
  font-size:clamp(11px,1.4vw,14px);background:#ffffff0a;margin-bottom:24px}}
.mega{{font-size:clamp(80px,18vw,220px);font-weight:900;line-height:.9;
  background:linear-gradient(120deg,#fff,var(--accent2),var(--accent));
  -webkit-background-clip:text;background-clip:text;color:transparent;
  letter-spacing:4px;filter:drop-shadow(0 10px 40px #ff7a2f55)}}
.sub{{font-size:clamp(22px,4vw,46px);font-weight:700;margin-top:8px}}
.subeng{{color:var(--muted);font-weight:300;letter-spacing:3px;margin-top:6px;
  font-size:clamp(13px,2vw,20px)}}
.lead{{color:var(--ink);opacity:.92;max-width:760px;margin:28px auto 0;
  font-size:clamp(15px,2.1vw,22px);line-height:1.7;font-weight:300}}
.scroll-hint{{margin-top:40px;color:var(--muted);font-size:13px;opacity:.7}}

/* ---- Section titles ---- */
.slide-title{{font-size:clamp(26px,4.5vw,52px);font-weight:900;line-height:1.1}}
.hl{{color:var(--accent)}}
.cat-desc{{color:var(--muted);font-weight:300;margin-top:6px;
  font-size:clamp(13px,2vw,20px)}}
.cat-desc.big{{font-size:clamp(16px,2.4vw,26px);line-height:1.6;margin-top:16px}}
.cat-head{{display:flex;align-items:center;gap:18px;margin-bottom:clamp(16px,3vh,32px);
  position:relative;z-index:2}}
.cat-emoji{{font-size:clamp(34px,6vw,64px);
  filter:drop-shadow(0 6px 16px #0008);flex:none}}
.cat-emoji.big{{font-size:clamp(48px,8vw,90px)}}

/* ---- Galleries ---- */
.gallery-slide,.info-slide{{align-items:stretch}}
.gallery-inner,.info-inner{{width:100%;max-width:1280px;margin:auto;
  position:relative;z-index:2;display:flex;flex-direction:column;
  animation:rise .7s ease both}}
.grid{{display:grid;gap:clamp(10px,1.6vw,20px);flex:1;min-height:0}}
.grid.g2{{grid-template-columns:repeat(2,1fr)}}
.grid.g4{{grid-template-columns:repeat(2,1fr);grid-template-rows:repeat(2,1fr)}}
.grid.g5{{grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(2,1fr)}}
.grid.g5 .card:first-child{{grid-row:span 2}}
@media(min-width:900px){{ .grid.g4{{grid-template-columns:repeat(4,1fr);
  grid-template-rows:1fr}} }}
.card{{position:relative;overflow:hidden;border-radius:18px;
  border:1px solid var(--line);background:#0008;
  box-shadow:0 16px 40px #0007;transition:transform .35s ease,box-shadow .35s;
  opacity:0;transform:translateY(18px);animation:pop .6s ease forwards}}
.card:nth-child(1){{animation-delay:.05s}} .card:nth-child(2){{animation-delay:.13s}}
.card:nth-child(3){{animation-delay:.21s}} .card:nth-child(4){{animation-delay:.29s}}
.card:nth-child(5){{animation-delay:.37s}}
.card img{{width:100%;height:100%;object-fit:cover;display:block;
  transition:transform .5s ease}}
.card:hover{{transform:translateY(-4px);box-shadow:0 24px 60px #000a;
  border-color:var(--accent)}}
.card:hover img{{transform:scale(1.06)}}

/* ---- Info cards ---- */
.cards-row{{display:grid;grid-template-columns:repeat(2,1fr);
  gap:clamp(12px,2vw,22px);margin-top:clamp(18px,3vh,30px)}}
@media(min-width:900px){{ .cards-row{{grid-template-columns:repeat(4,1fr)}} }}
.info-card{{background:var(--card);border:1px solid var(--line);border-radius:20px;
  padding:clamp(18px,2.5vw,30px);text-align:center;
  backdrop-filter:blur(6px);opacity:0;transform:translateY(18px);
  animation:pop .6s ease forwards}}
.info-card:nth-child(1){{animation-delay:.08s}}
.info-card:nth-child(2){{animation-delay:.18s}}
.info-card:nth-child(3){{animation-delay:.28s}}
.info-card:nth-child(4){{animation-delay:.38s}}
.info-card .ic{{font-size:clamp(34px,5vw,52px);margin-bottom:12px}}
.info-card h3{{font-size:clamp(17px,2.2vw,24px);margin-bottom:8px;color:var(--accent2)}}
.info-card p{{color:var(--muted);font-weight:300;line-height:1.6;
  font-size:clamp(13px,1.6vw,17px)}}

/* ---- Hope ---- */
.hope-inner{{display:flex;gap:clamp(20px,4vw,60px);align-items:center;
  max-width:1180px;width:100%;position:relative;z-index:2;flex-wrap:wrap;
  justify-content:center;animation:rise .7s ease both}}
.hope-img{{flex:0 1 440px;border-radius:24px;overflow:hidden;
  border:2px solid var(--accent);box-shadow:0 24px 70px #ff7a2f44}}
.hope-img img{{width:100%;display:block}}
.hope-text{{flex:1 1 360px;min-width:280px}}

/* ---- Closing ---- */
.closing-inner{{text-align:center;max-width:820px;position:relative;z-index:2;
  animation:rise .8s ease both}}
.closing-h{{font-size:clamp(34px,7vw,72px);font-weight:900;
  background:linear-gradient(120deg,#fff,var(--accent2),var(--accent));
  -webkit-background-clip:text;background-clip:text;color:transparent}}
.closing-p{{color:var(--ink);opacity:.9;font-weight:300;line-height:1.7;
  margin-top:24px;font-size:clamp(16px,2.4vw,24px)}}
.closing-tag{{margin-top:34px;display:inline-block;padding:12px 28px;
  border-radius:999px;background:var(--accent);color:#1a1033;font-weight:700;
  letter-spacing:1px;font-size:clamp(14px,2vw,20px);
  box-shadow:0 12px 34px #ff7a2f66}}

/* ---- Nav ---- */
.nav{{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);
  display:flex;align-items:center;gap:16px;z-index:50}}
.nav button{{width:50px;height:50px;border-radius:50%;border:1px solid var(--line);
  background:#ffffff14;color:#fff;font-size:22px;cursor:pointer;
  display:flex;align-items:center;justify-content:center;
  backdrop-filter:blur(8px);transition:.25s}}
.nav button:hover{{background:var(--accent);color:#1a1033;transform:scale(1.08)}}
.dots{{display:flex;gap:8px}}
.dot{{width:9px;height:9px;border-radius:50%;background:#ffffff44;cursor:pointer;
  transition:.25s}}
.dot.active{{background:var(--accent);width:26px;border-radius:6px}}
.counter{{position:fixed;top:20px;left:24px;z-index:50;color:var(--muted);
  font-size:14px;letter-spacing:1px;background:#ffffff10;padding:6px 14px;
  border-radius:999px;border:1px solid var(--line)}}
.progress{{position:fixed;top:0;right:0;height:4px;background:var(--accent);
  z-index:60;transition:width .5s ease;box-shadow:0 0 14px var(--accent)}}

@keyframes rise{{from{{opacity:0;transform:translateY(26px)}}to{{opacity:1;transform:none}}}}
@keyframes pop{{to{{opacity:1;transform:none}}}}

@media(max-width:600px){{
  .cat-head{{gap:12px}}
  .hope-inner{{flex-direction:column}}
  .grid.g5{{grid-template-columns:repeat(2,1fr);grid-template-rows:none}}
  .grid.g5 .card:first-child{{grid-row:auto}}
}}
</style>
</head>
<body>
<div class="progress" id="progress"></div>
<div class="counter"><span id="cur">1</span> / {n}</div>
<div id="deck">
{slides_html}
</div>
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
function go(n){{
  i=Math.max(0,Math.min(slides.length-1,n));
  slides.forEach((s,x)=>s.classList.toggle('active',x===i));
  dots.forEach((d,x)=>d.classList.toggle('active',x===i));
  progress.style.width=((i+1)/slides.length*100)+'%';
  cur.textContent=i+1;
}}
// RTL: prev button (›) goes back, next button (‹) goes forward visually
document.getElementById('next').onclick=()=>go(i+1);
document.getElementById('prev').onclick=()=>go(i-1);
document.addEventListener('keydown',e=>{{
  if(e.key==='ArrowLeft'||e.key===' '||e.key==='PageDown')go(i+1);
  if(e.key==='ArrowRight'||e.key==='PageUp')go(i-1);
  if(e.key==='Home')go(0);if(e.key==='End')go(slides.length-1);
}});
// swipe
let sx=0;
document.addEventListener('touchstart',e=>sx=e.touches[0].clientX,{{passive:true}});
document.addEventListener('touchend',e=>{{
  const dx=e.changedTouches[0].clientX-sx;
  if(Math.abs(dx)>50){{ dx<0?go(i+1):go(i-1); }}
}},{{passive:true}});
go(0);
</script>
</body>
</html>"""

with open(OUT, "w", encoding="utf-8") as f:
    f.write(HTML)

print(f"Wrote {OUT} ({os.path.getsize(OUT)/1024/1024:.2f} MB), {n} slides")
