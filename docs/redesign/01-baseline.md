# Premium redesign — mapping, baseline and scope

## Identity (verified 2026-11-16)

| Item | Value |
|---|---|
| Repository | `orikenenb-lgtm/kerem-orders` (remote `origin`) |
| Base branch | `main` |
| BASE_COMMIT | `e4227d3` (= `origin/main`) |
| Live deployment | GitHub Pages deployment of `e4227d3` (status `success`, 2026-11-16 12:02 UTC, daily rebuild of main) |
| Work branch | `feat/kerem-premium-redesign-20261116`, in a separate git worktree (the main checkout holds unrelated, unpushed security work and was not touched) |
| Live URL | https://orikenenb-lgtm.github.io/kerem-orders/ |

## Deployment mechanics (read before any push)

* `deploy-pages.yml`: runs on push to `main` (paths `landing/**`), a daily cron
  on main, and `workflow_dispatch`; both jobs are guarded by
  `if: github.ref == 'refs/heads/main'`. **A push of the work branch or a PR
  does not deploy.** Nothing in this work weakens those guards.
* `ci.yml`: lint (warning cap 33), unit tests, type check, static build — on
  PRs and main. Read-only.
* `rivhit-hourly-sync.yml`: unrelated, untouched.

## Scope

In scope (visual only): home `/`, header, footer, `/catalog` (customers),
`/view` + `/prices` (public), `/collection`, `/product`, `/p`, `/p/[id]`,
sign-in / registration / express / forgot / reset, `/account`, 404 / error
pages, accessibility statement styling.

Out of scope and **not changed**: everything under `/admin` (kept on the
previous look through `app/admin/layout.tsx` → `.kt-scope-classic`), Supabase
(schema, RLS, RPCs, auth config), edge functions, Rivhit sync, prices /
discounts / VAT / totals / quantities, cart storage, order submission,
search / filter / sort logic, captcha, routes, metadata / sitemap.

Shared components also rendered by admin screens: `SiteHeader`, `SiteFooter`,
`ProductImage`, `LoadMoreTail` (admin product browser) — their colours follow
the admin scope.

## Baseline (BASE_COMMIT, production build, this machine)

| Check | Result |
|---|---|
| `eslint . --max-warnings 33` | 0 errors, 33 warnings (at the cap) |
| `tsc --noEmit` | clean |
| `npm test` | 11 suites, all pass |
| `npm run build` (static export) | passes |

JS per page (scripts referenced by each exported HTML, gzip -9):

| Page | JS gz | CSS gz |
|---|---|---|
| home | 243.6 KB | 2.3 KB |
| catalog | 255.9 KB | 2.3 KB |
| view | 247.9 KB | 2.3 KB |
| product | 247.4 KB | 2.3 KB |
| login | 251.9 KB | 2.3 KB |
| collection | 247.9 KB | 2.3 KB |
| admin | 258.1 KB | 2.3 KB |

Budget for the redesign: ≤ +15 KB gz JS on any page (effects are CSS-first),
CSS may grow; no new dependency.

Browser harness (Playwright, Chromium, production build served locally,
Supabase + image proxy mocked with synthetic data, every non-GET write refused
and recorded — 0 writes attempted). Pre-existing observations, NOT caused by
the redesign:

* Layout shift (CLS) on desktop: `/view` 0.484, `/prices` 0.484,
  `/collection` 0.592, `/product` 0.392, `/catalog` 0.071 — the grid/header
  settling after data arrives.
* Pre-existing bug (found 2026-11-10, documented, not fixed — outside the
  scope here): on `/catalog`, if the products arrive before the sign-in check
  finishes, infinite scroll can stop at the first page.

Screenshots of the baseline (desktop 1440×900, iPhone 13) are kept outside the
repository (session scratchpad) and were sent to the owner with the report.
