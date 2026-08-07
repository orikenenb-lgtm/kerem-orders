# כרם טויס — Kerem Toys storefront

RTL Hebrew wholesale storefront for **Kerem Toys** (כרם טויס), a toy import &
wholesale business. A Next.js App Router app exported as a static site and
served from GitHub Pages, backed by Supabase (catalog, auth, orders) with
Row-Level-Security enforcing all access.

## Stack

- Next.js 16 (App Router, `output: "export"`) · React 19 · TypeScript
- Supabase (`@supabase/supabase-js`) — public catalog RPCs, auth, orders
- Rubik + Assistant (Hebrew + Latin) via `next/font/google`
- Framer Motion (legacy landing only, lazy-loaded behind a feature flag)

## Routes

- `/` — landing (behind `ff_new_landing`; the legacy scroll-hero page is kept,
  lazy-loaded, for one-line rollback)
- `/view` — public catalog, no prices/SKU · `/prices` — public price list
- `/login`, `/register`, `/forgot`, `/reset` — customer auth
- `/catalog`, `/account` — logged-in ordering & order history
- `/admin`, `/admin/images-review` — manager-only (noindex; RLS-enforced)
- `/accessibility` — accessibility statement

## Configuration

- Business constants: `lib/config.ts` · feature flags: `lib/featureFlags.ts`
- Supabase URL/anon key: `lib/supabaseClient.ts` (anon key is public by design;
  RLS is the security boundary)
- The GitHub Pages basePath (`/kerem-orders`) is applied only in production
  builds (`next.config.ts`).

## Run

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # unit tests (quantity + search ranking)
npm run lint     # eslint (flat config)
npm run build    # static export to ./out
npm run serve    # serve the built ./out locally
```

## Legacy hero assets (`hero.mp4` + `frames/`)

The legacy scroll-hero landing (behind `ff_new_landing=false`) scrubs a frame
sequence in `public/frames/` plus `public/hero.mp4`. These are retained only to
keep that rollback path working; the placeholder frames can be regenerated with
`npm run frames` (requires `python3` + Pillow, see `scripts/generate_frames.py`).

## Deployment

Pushing to `main` triggers `.github/workflows/deploy-pages.yml`, which builds
the static export and publishes `landing/out` to GitHub Pages. Deploys run from
`main` only. CI (`.github/workflows/ci.yml`) runs lint, tests, type-check and
the production build on every PR.
