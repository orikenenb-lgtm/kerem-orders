"""
Procedural placeholder frame generator for the Kerem Toys scroll-hero.

This stands in for the Higgsfield AI-generated `hero.mp4` until the real
asset is available. It renders FRAME_COUNT JPEG frames on a pure-white
background that animate a tight cluster of toys into a balanced, joyful
exploded burst — exactly the motion ScrollHero.tsx scrubs through.

To replace with the real Higgsfield video, drop hero.mp4 in this folder and run:
    ffmpeg -i hero.mp4 -vf "fps=24,scale=1920:-1" -q:v 3 "frames/frame_%04d.jpg"
then copy frames/ -> public/frames/ and hero.mp4 -> public/hero.mp4.
"""

import math
import os

from PIL import Image, ImageDraw, ImageFilter

W, H = 1920, 1080
FRAME_COUNT = 120
CX, CY = W // 2, H // 2

OUT = os.path.join(os.path.dirname(__file__), "..", "frames")
os.makedirs(OUT, exist_ok=True)

# --- design tokens ---------------------------------------------------------
MAGENTA = (255, 46, 147)
ORANGE = (255, 138, 0)
YELLOW = (255, 196, 0)
GREEN = (37, 199, 126)
BLUE = (46, 125, 255)
PURPLE = (138, 63, 252)
BROWN = (166, 110, 70)
BROWN_D = (132, 84, 50)
GREY = (120, 130, 150)
GREY_L = (180, 190, 205)
DARK = (26, 23, 48)
WHITE = (255, 255, 255)


def ease_in_out(t: float) -> float:
    return t * t * (3 - 2 * t)


def ease_out_back(t: float) -> float:
    c1 = 1.70158
    c3 = c1 + 1
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2


def rounded(draw, box, r, fill, outline=None, width=1):
    draw.rounded_rectangle(box, radius=r, fill=fill, outline=outline, width=width)


# --- individual toy renderers (drawn centered on a transparent tile) -------
TILE = 460
C = TILE // 2


def tile():
    img = Image.new("RGBA", (TILE, TILE), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img)


def toy_blocks():
    img, d = tile()
    s = 110
    cols = [MAGENTA, BLUE, GREEN, YELLOW]
    pos = [(-s, -s), (0, -s), (-s, 0), (0, 0)]
    off = 18
    for (px, py), col in zip(pos, cols):
        x = C + px - s // 2
        y = C + py - s // 2
        d.polygon([(x, y), (x + s, y), (x + s + off, y - off), (x + off, y - off)],
                  fill=tuple(int(c * 0.82) for c in col))
        d.polygon([(x + s, y), (x + s, y + s), (x + s + off, y + s - off), (x + s + off, y - off)],
                  fill=tuple(int(c * 0.68) for c in col))
        rounded(d, [x, y, x + s, y + s], 14, col)
    return img


def toy_teddy():
    img, d = tile()
    # ears
    for ex in (-95, 95):
        d.ellipse([C + ex - 55, C - 150, C + ex + 55, C - 40], fill=BROWN_D)
        d.ellipse([C + ex - 32, C - 128, C + ex + 32, C - 64], fill=BROWN)
    # body
    d.ellipse([C - 110, C - 20, C + 110, C + 190], fill=BROWN)
    d.ellipse([C - 62, C + 30, C + 62, C + 150], fill=(206, 160, 120))
    # head
    d.ellipse([C - 100, C - 150, C + 100, C + 40], fill=BROWN)
    # muzzle
    d.ellipse([C - 52, C - 60, C + 52, C + 20], fill=(214, 172, 132))
    d.ellipse([C - 18, C - 50, C + 18, C - 18], fill=DARK)
    # eyes
    d.ellipse([C - 52, C - 96, C - 24, C - 68], fill=DARK)
    d.ellipse([C + 24, C - 96, C + 52, C - 68], fill=DARK)
    # arms + legs
    for ax in (-110, 110):
        d.ellipse([C + ax - 38, C + 10, C + ax + 38, C + 100], fill=BROWN_D)
    for lx in (-58, 58):
        d.ellipse([C + lx - 44, C + 130, C + lx + 44, C + 215], fill=BROWN_D)
    return img


def toy_robot():
    img, d = tile()
    # antenna
    d.line([C, C - 150, C, C - 110], fill=GREY, width=10)
    d.ellipse([C - 16, C - 168, C + 16, C - 136], fill=MAGENTA)
    # head
    rounded(d, [C - 80, C - 120, C + 80, C - 10], 26, BLUE)
    d.ellipse([C - 50, C - 92, C - 14, C - 56], fill=WHITE)
    d.ellipse([C + 14, C - 92, C + 50, C - 56], fill=WHITE)
    d.ellipse([C - 40, C - 82, C - 24, C - 66], fill=DARK)
    d.ellipse([C + 24, C - 82, C + 40, C - 66], fill=DARK)
    rounded(d, [C - 34, C - 40, C + 34, C - 24], 8, DARK)
    # body
    rounded(d, [C - 95, C + 0, C + 95, C + 150], 22, GREY_L)
    rounded(d, [C - 50, C + 24, C + 50, C + 96], 12, GREEN)
    # arms
    rounded(d, [C - 135, C + 10, C - 100, C + 120], 16, GREY)
    rounded(d, [C + 100, C + 10, C + 135, C + 120], 16, GREY)
    # legs
    rounded(d, [C - 64, C + 150, C - 18, C + 215], 12, GREY)
    rounded(d, [C + 18, C + 150, C + 64, C + 215], 12, GREY)
    return img


def toy_train():
    img, d = tile()
    # cab + body
    rounded(d, [C - 150, C + 10, C + 10, C + 110], 16, MAGENTA)
    rounded(d, [C - 70, C - 70, C + 30, C + 30], 16, ORANGE)
    # boiler
    rounded(d, [C + 0, C + 0, C + 150, C + 90], 40, BLUE)
    d.ellipse([C + 120, C - 2, C + 175, C + 90], fill=tuple(int(c * 0.85) for c in BLUE))
    # chimney
    rounded(d, [C + 30, C - 70, C + 70, C + 0], 8, YELLOW)
    d.ellipse([C + 22, C - 84, C + 78, C - 54], fill=YELLOW)
    # window
    rounded(d, [C - 52, C - 52, C + 12, C + 12], 10, (220, 240, 255))
    # wheels
    for wx in (-110, -40, 70, 130):
        d.ellipse([C + wx - 34, C + 86, C + wx + 34, C + 154], fill=DARK)
        d.ellipse([C + wx - 14, C + 106, C + wx + 14, C + 134], fill=GREY_L)
    return img


def toy_ball():
    img, d = tile()
    r = 130
    box = [C - r, C - r, C + r, C + r]
    cols = [MAGENTA, ORANGE, YELLOW, GREEN, BLUE, PURPLE]
    for i, col in enumerate(cols):
        d.pieslice(box, i * 60, (i + 1) * 60, fill=col)
    d.ellipse([C - 26, C - 26, C + 26, C + 26], fill=WHITE)
    # gloss
    d.ellipse([C - 80, C - 90, C - 20, C - 40], fill=(255, 255, 255, 90))
    return img


def toy_rings():
    img, d = tile()
    # base cone peg
    d.polygon([(C - 18, C + 120), (C + 18, C + 120), (C + 8, C - 110), (C - 8, C - 110)],
              fill=GREY_L)
    cols = [PURPLE, BLUE, GREEN, YELLOW, ORANGE, MAGENTA]
    widths = [150, 132, 114, 96, 78, 58]
    y = C + 100
    for col, w in zip(cols, widths):
        h = int(w * 0.5)
        d.ellipse([C - w // 2, y - h // 2, C + w // 2, y + h // 2], fill=col)
        d.ellipse([C - w // 6, y - h // 6, C + w // 6, y + h // 6], fill=WHITE)
        y -= int(h * 0.62)
    return img


# toy: (renderer, cluster offset, explode angle deg, explode distance, spin)
# explode targets sit on a balanced hexagon, all kept inside the 1920x1080 frame
TOYS = [
    (toy_teddy, (10, -160), 90, 270, 8),
    (toy_blocks, (-150, -70), 150, 440, -14),
    (toy_robot, (180, -40), 30, 440, 12),
    (toy_train, (-180, 130), 210, 440, -10),
    (toy_ball, (170, 150), 330, 440, 18),
    (toy_rings, (0, 40), 270, 250, -8),
]


def render_frame(idx: int) -> Image.Image:
    p = idx / (FRAME_COUNT - 1)
    base = Image.new("RGB", (W, H), WHITE)

    # camera orbit: gentle horizontal sweep in the first half
    orbit = ease_in_out(min(p / 0.5, 1.0))
    cam_dx = (orbit - 0.5) * 120  # sweep through center
    cam_scale = 1.0 + 0.04 * math.sin(orbit * math.pi)

    # explosion ramps in over the back half with a soft bounce
    if p <= 0.45:
        ex = 0.0
    else:
        ex = ease_out_back(min((p - 0.45) / 0.55, 1.0))

    shadow_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow_layer)

    placed = []
    for render, (ox, oy), ang, dist, spin in TOYS:
        a = math.radians(ang)
        tx_off = math.cos(a) * dist
        ty_off = -math.sin(a) * dist
        # interpolate from the tight cluster position to the radial target
        dx = ox * (1 - ex) + tx_off * ex
        dy = oy * (1 - ex) + ty_off * ex
        # gentle float bob once exploded
        dy += math.sin(p * math.pi * 2 + ang) * 10 * ex
        scale = (0.9 + 0.18 * ex) * cam_scale
        rot = spin * ex + math.sin(orbit * math.pi) * 3

        tx = CX + (dx + cam_dx) * cam_scale
        ty = CY + dy * cam_scale

        toy = render()
        if scale != 1.0:
            ns = max(8, int(TILE * scale))
            toy = toy.resize((ns, ns), Image.LANCZOS)
        toy = toy.rotate(rot, resample=Image.BICUBIC, expand=True)
        placed.append((toy, tx, ty, ex))

        # soft contact shadow, fades as toys lift away
        sw = int(toy.width * 0.5)
        sh = int(toy.width * 0.12)
        salpha = int(60 * (1 - 0.7 * ex))
        sd.ellipse(
            [tx - sw, ty + toy.height * 0.30 - sh, tx + sw, ty + toy.height * 0.30 + sh],
            fill=(26, 23, 48, salpha),
        )

    shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(26))
    base = Image.alpha_composite(base.convert("RGBA"), shadow_layer)

    for toy, tx, ty, _ in placed:
        base.alpha_composite(toy, (int(tx - toy.width / 2), int(ty - toy.height / 2)))

    return base.convert("RGB")


def main():
    for i in range(FRAME_COUNT):
        frame = render_frame(i)
        frame.save(os.path.join(OUT, f"frame_{i + 1:04d}.jpg"), quality=90)
        if (i + 1) % 20 == 0:
            print(f"  rendered {i + 1}/{FRAME_COUNT}")
    print(f"done: {FRAME_COUNT} frames -> {os.path.abspath(OUT)}")


if __name__ == "__main__":
    main()
