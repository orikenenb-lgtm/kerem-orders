# Premium redesign — design decisions & agent brief

Branch `feat/kerem-premium-redesign-20261116` · base `e4227d3` (= origin/main =
the live GitHub Pages deployment on 2026-11-16) · flag `ff_premium_theme`.

The mockup image referenced in the request was **not attached** to the session
(only text arrived). Fidelity to the image could not be checked; the design
follows the written direction below.

## Direction

A luxurious, joyful, colourful toy shop — never noisy, never a generic template.
Clean white space, a leading purple, pastel accents, soft depth, round corners,
large clear product photos. This stays a **wholesale catalogue for business
customers** (prices only for signed-in customers or the public price list that
already exists; orders are quote-style, minimum order from the DB). No checkout,
favourites, loyalty club, ratings, reviews, countdowns, "best sellers", brands or
promotions that do not exist in the data.

## Tokens (app/tokens.css, html.kt-premium) — use the variables, not literals

| Role | Variable | Value |
|---|---|---|
| Page background | `--kt-bg` | #FBFAFF |
| Surfaces / cards | `--kp-white` | #FFFFFF |
| Soft surface (inputs) | `--kt-surface` | #F4F0FF |
| Leading purple | `--kp-purple` (= `--kt-accent`) | #6D28D9 |
| Deep purple / indigo | `--kp-purple-deep`, `--kp-indigo` | #4C1D95, #3B3FB8 |
| Ink text | `--kp-ink` (= `--kt-text`) | #27163F |
| Body / dim text | `--kt-body`, `--kt-dim` | #4A3D63, #6B6185 |
| Yellow | `--kp-yellow` | #FFD84D |
| Pastels | `--kp-lav`, `--kp-mint`, `--kp-sky`, `--kp-peach`, `--kp-pink` | #EEE5FF, #D8F5EB, #DBEEFF, #FFE8D6, #FFE3F1 |
| Radii | `--kp-radius-lg/md/pill` | 28px / 18px / 999px |
| Shadows | `--kp-shadow-soft`, `--kp-shadow-pop` | soft purple depth |
| Hero gradient | `--kp-hero` | deep purple → purple → indigo |
| Motion | `--kp-ease`, `--kp-fast` (160ms), `--kp-mid` (320ms) | |

Contrast (measured): every pair above meets WCAG AA ≥ 4.5:1. **Light fills
(yellow, pastels, white) always carry ink text, never white.** White text only
on purple / deep purple / indigo / the hero gradient.

Fonts: the existing `var(--font-rubik)` (headings, buttons) and
`var(--font-assistant)` (body). No new fonts.

The real logo is the text wordmark "כרם טויס" (no image file exists) — keep it.

## Verified business facts you may show (nothing else)

* Minimum order: read via `getMinOrderTotal()` (lib/siteSettings) — fallback
  `MIN_ORDER_FALLBACK` (lib/config). Never hard-code 3,500.
* "כל המחירים כוללים מע״מ" (all prices include VAT).
* "משלוח לכל הארץ" (already shown in the live header strip).
* Phone `PHONE_DISPLAY` / `PHONE_TEL` (lib/config). No WhatsApp number exists
  (`CONTACT.whatsapp` is empty) → no WhatsApp button.
* Business name / tagline: `BUSINESS_NAME`, `BUSINESS_TAGLINE` (lib/config).
* Categories: only from the existing RPCs (`catalog_public_categories` for
  guests, `catalog_categories` for customers). Real names include
  "50 אחוז הנחה" (a real sale category) and "סחורה חדשה 1" (new stock) — a
  "מבצעים"/"חדש" area may link to those categories only when they exist in
  the returned list.

## Hard rules (every agent)

1. Visual / presentational changes only. Do NOT change: prices, discounts, VAT,
   totals, quantities/packs/steps, cart storage keys or shape, search/filter/sort
   logic, order/quote submission, payloads, Supabase queries' filters, auth,
   captcha, validation, handlers' semantics, routes or links' targets.
   Allowed: markup structure, class names, styles, layout, animations, copy of
   purely decorative headings (accurate, non-promissory).
2. Keep React keys, state, handlers and refs as they are. An animation must never
   trigger an action twice (no double add-to-cart).
3. Own files only (your list). Need a change elsewhere → describe it in your
   report; the orchestrator does it. Never edit: lib/*, package.json, lockfile,
   app/layout.tsx, app/globals.css, app/tokens.css, featureFlags, tests config.
4. Style with a CSS Module next to your component (`X.module.css`) and/or
   inline styles using the variables above (with a sensible fallback, e.g.
   `var(--kp-purple, #6D28D9)`, so the component still renders correctly if
   the flag is turned off). No new global selectors. Rollback strategy: the
   full rollback is a `git revert` of the merge; `ff_premium_theme: false`
   only switches the colour tokens back (quick partial rollback) — so do not
   keep two copies of a component's markup.
5. No new dependencies. No GSAP/Three/WebGL/UI libraries. framer-motion exists
   but the home and catalogue avoid it to keep JS light — use CSS transitions /
   keyframes and the shared `components/premium/Reveal.tsx`.
6. Motion: transform + opacity only; feedback 120–220ms, sections 250–450ms,
   small distances; no autoplay carousels, parallax, scroll hijacking, custom
   cursor, confetti, video backgrounds, infinite decorative loops on many
   elements, auto-scroll or focus moves. `prefers-reduced-motion: reduce` →
   no movement. Content must be visible if JS fails.
7. RTL first; CSS logical properties (`margin-inline-start`, `inset-inline-end`…).
   Numbers/prices/SKUs/phones with `dir="ltr"` or `unicode-bidi: isolate` where
   mixed. Widths 360/390/412/768/1024/1440: no horizontal scroll, no clipped
   text, touch targets ≥ 44px for primary actions (≥ 24px minimum anywhere).
8. Accessibility: semantic HTML, one h1 per page, visible focus, accessible
   names, labels, alt text from product names, dialogs/drawers keep their
   existing focus return and Escape handling.
9. Images: keep `ProductImage` (fallback chain, `priority` for the first 6 grid
   cards only, lazy for the rest). Keep square, fixed-ratio frames (no layout
   shift). Do not add `priority`/eager to other images.
10. No secrets, no personal data, no real orders. Do not run `npm run build`
    (the orchestrator builds); you may run `npx tsc --noEmit -p .` and
    `npx eslint <your files>` from `landing/`. Do not commit — report back.

## Agents (who did what)

| Agent | Scope (own files only) | Status |
|---|---|---|
| Orchestrator | tokens, globals, `Reveal`, layout flag, admin scope, integration, builds, harness, fixes after review | done |
| Home | `LandingV2` + `home/*` (hero with local SVG art, real-category tiles, highlights for "סחורה חדשה 1" / "50 אחוז הנחה" only when those categories exist, 8 real public products, how-to-order, contact band) | done |
| Header / footer | `SiteHeader`, `SiteFooter` | done |
| Customer catalogue | `catalog/page.tsx` + module (presentation only) | done |
| Public catalogue / product | `PublicCatalog`, `LoadMoreTail`, `/collection`, `/product`, `/p`, `/p/[id]` | done |
| Auth / account / status | auth forms + shell, `/reset`, `/account`, 404 / error pages, accessibility page, `PasswordInput`, `Turnstile` container | done |
| Code reviewer (independent) | read-only review of the full diff for non-visual changes | done — findings in 03-qa.md |
| Design / a11y reviewer (independent) | contrast, reduced motion, no-JS, keyboard, headings, touch targets | done — findings in 03-qa.md |

Not restyled (left as is on purpose): `StatusBadge` (shared with admin order
screens), every `/admin` screen.
