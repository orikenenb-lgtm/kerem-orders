# כרם טויס — Scroll Hero Landing Page

A scroll-driven, RTL Hebrew product landing page for **Kerem Toys** (כרם טויס),
a toy import & wholesale brand. The hero is a frame-by-frame canvas scrub of a
toy cluster bursting into a balanced exploded arrangement, driven purely by
scroll position (no `<video>` element, no scroll listener — a `requestAnimationFrame`
loop reading `getBoundingClientRect`).

## Stack

- Next.js 15 (App Router) · React 19 · TypeScript
- Framer Motion for scroll-triggered fade-ins
- Rubik + Assistant (Hebrew + Latin) via `next/font/google`

## The hero assets (`hero.mp4` + `frames/`)

The brief calls for a **Higgsfield AI**-generated `hero.mp4` (a toy cluster
orbiting, then bursting into an exploded flat-lay on a pure-white background).
Higgsfield AI is not reachable from this build environment, so the committed
frames are **procedurally generated placeholders** that reproduce the exact
motion the page scrubs through: a tight cluster → a balanced, airy exploded
arrangement of six toys on pure white.

### Swapping in the real Higgsfield video

1. Generate the three assets per the brief and save the video as `hero.mp4`.
2. Extract frames and refresh `public/`:

   ```bash
   ffmpeg -i hero.mp4 -vf "fps=24,scale=1920:-1" -q:v 3 "frames/frame_%04d.jpg"
   cp -r frames/. public/frames/
   cp hero.mp4 public/hero.mp4
   ```

3. Set `FRAME_COUNT` at the top of `app/components/ScrollHero.tsx` to the number
   of extracted frames.

The placeholder frames can be regenerated any time with `npm run frames`
(requires `python3` + Pillow). The generator lives in `scripts/generate_frames.py`.

## Run

```bash
npm install
npm run dev    # http://localhost:3000
```
