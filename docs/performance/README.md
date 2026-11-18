# Performance pass — November 2026

Branch `feat/kerem-performance-20261116`, base `bec8169` (= the live site with
the approved premium design). Nothing in Supabase (schema, RLS, RPCs, edge
functions, settings), Rivhit, prices, discounts, VAT, quantities, the cart or
order submission was changed.

## 1. What was slow — evidence

| # | Bottleneck | Evidence |
|---|---|---|
| 1 | **Product photos.** Every card photo came from the `rivhit-img` edge function, which downloads the ~3 MB Rivhit original, decodes and resizes it on **every** request. There is no shared cache in front of it. | Production function logs, 24 h (aggregates only): 5,713 requests for only 834 distinct photos (all `w=480`). 200s: median **1.6 s**, p75 2.5 s, p95 6.0 s. **27 % failed with 546** (worker resource limit) after a median 4.2 s, which then cost the browser a 1.2 s wait, a retry, and sometimes the 3 MB original. |
| 2 | **Back from a product page lost the catalogue.** The category, search and sort went back to the defaults, only 48 products were shown, and the page was scrolled to the top. *(Reported by the owner.)* | Browser test: 432 products loaded → after Back 48, the card is gone, and the filters and search are reset. |
| 3 | **Returning to the tab reloaded everything.** Supabase re-emits `SIGNED_IN` with a new session object when the tab becomes visible, and every effect keyed on the session re-ran. | 8 data requests per two tab returns. On the product page the loader flashed and **the chosen quantity reset 3 → 1**. |
| 4 | **Infinite scroll could stop at 48 products.** The products arrived while the sign-in check was still on screen, so the scroll sentinel was not mounted and the observer never attached. | Reproduced on desktop (stuck at 48). It was a known, documented bug since 2026-11-10. |
| 5 | Typing in the catalogue search ~100 ms per keystroke at 4x CPU. | Profile: `ils()` built a new `Intl` formatter for every price, 110 ms of the typing profile. |
| 6 | Viewport prefetch of every product page from every card. | About 130 RSC prefetch requests and ~800 ms of IntersectionObserver work per 4 s of scrolling. |
| 7 | The `?cat=` link (home tiles) loaded "all" first. | One wasted 48-row query and the first photos of the wrong grid; the wrong products were visible for ~350 ms. |
| 8 | Search race: applying a search hid the filters, which pulled the sentinel into range. | 3 requests instead of 1 for 3 of 8 searches, about one round trip later. |
| 9 | Desktop home hero: an endless float animation under a drop-shadow filter. | Main thread busy 1,006 ms of every 3 s at 4x CPU. |
| 10 | Home: highlights row inserted after load. | CLS 0.02–0.10. |

Already fine (measured, left alone): data requests on home, `/catalog` and
`/product` start in parallel; the stale-response guards are correct; Reveal is
cheap; framer-motion and exceljs are not on any first-paint path; the
font-swap shift is ≤ 0.006; card shadows cost nothing measurable. Supabase-js
Realtime and storage (~32 KB gz) are unused but would need new direct
dependencies to drop. Not done; noted for later.

## 2. What changed

* **Static product photos** (`lib/imageMirror.ts`, `scripts/mirror-images.mjs`,
  deploy step).
  * At deploy time, each **public** product's card photo is downloaded once from
    the existing proxy (the exact URL the browser uses, so it is byte-for-byte the
    proxy's own output, with the EXIF fix and saved rotation) and shipped under
    `/pimg/480/`.
  * GitHub Pages serves it from its CDN.
  * The list of photos really present is built into the page, so there are no 404 tries.
  * **Fallback:** anything not in the list, or a static file that fails, goes
    through the unchanged chain: proxy → one retry → original → placeholder.
    That is at most one extra, immediate attempt.
  * A new product, a changed rotation, a customer-only product and the 900/960
    product-page sizes all keep using the proxy until the next deploy.
  * The script's cache: `actions/cache` keeps the copies between deploys, so a
    normal deploy only asks for **new** photos plus at most 40 of the oldest
    (older than 14 days), so every copy is re-made about every 3 weeks.
  * The script runs two at a time, with bounded retries and a time budget.
  * It never fails a deploy: on any error the site uses the proxy as before.
* **Return to the same place** (`lib/catalogReturn.ts`, `/catalog`).
  * Opening a product saves the catalogue's *view state only* (filters, number
    of pages, where the card was) in `sessionStorage`. This tab only, one user,
    30 minutes, read once, cleared on sign-out.
  * Back, the breadcrumb, and "חזרה לקטלוג" all bring it back.
  * It is applied only when arriving **from a product page**. A home tile, the
    login redirect or a fresh load always starts clean.
  * If the customer scrolls, taps, or changes a filter while the pages reload,
    the restore stops: their action wins.
  * No products, prices or profile data are stored. Rows and prices are always
    fetched fresh.
* **Stable session object** (`lib/auth.tsx`): the same object is kept when the
  token and user are unchanged. A token refresh, a different user, or sign-out
  still propagates.
* **Infinite-scroll fix**: the sentinel is now held in state through a callback
  ref, so the observer attaches whenever the grid mounts.
* `ils()` uses one shared formatter. The output is identical on every value tested.
* `prefetch={false}` on the catalogue's two product links per card.
* The `?cat=` link applies the category from the first request (`lib/urlCategory.ts`).
  It falls back to "הכל" if the name is unknown.
* The infinite-scroll observer advances only while the grid shows the current
  filter, in `/catalog`, `/view` and `/collection`.
* The hero float runs twice on arrival and then rests, ending in the same position.
* Placeholder for the home highlights row while loading.
* A second `preconnect` with `crossorigin` for data requests.
* The `latin-ext` font subset, which carries ₪, is preloaded with the rest.

## 3. Measurements (lab, this machine; not field data)

Production static builds, Chromium, Supabase mocked. Median of 3, range in brackets.

**Photos on the first screen**. The proxy is simulated with the production
profile above (lognormal: median 1.6 s, p95 6 s; 27 % → 546 after ~4.2 s).
Static files get 80 ms.

| Scenario | Before (live code) | After |
|---|---|---|
| `/catalog`, phone: all photos on screen | 11.0 s [5.6–13.0] | **0.39 s** [0.38–0.40] |
| `/view`, phone | 7.9 s [6.1–11.0] | **0.38 s** [0.38–0.38] |
| `/catalog`, desktop | 12.6 s [10.8–12.8] | **0.40 s** [0.40–0.40] |
| Proxy requests / 546 failures / 3 MB originals (desktop) | 33–35 / 8–10 / 1–2 | **0 / 0 / 0** |

**Behaviour**

| Test | Before | After |
|---|---|---|
| Return-to-place suite (18 checks: Back / breadcrumb / search, phone + desktop, other user, expiry) | 9 / 18 | **18 / 18** |
| Two tab returns: data requests / product quantity | 8 / 3 → 1 | **0 / 3 → 3** |
| Catalogue regression suite (28) | 28 / 28 | 28 / 28 |
| Static photo missing → falls back to the proxy | — | 11 / 11, no errors |

**Weight / stability**

* JS: +1.7 to +3 KB gz per page, for the photo list and the new code.
* CLS, before → after:
  * home desktop 0.020 → 0.001;
  * catalog, view and product unchanged;
  * phone 0 everywhere.
* A product-page loader change was tried, made desktop CLS worse (0.12 → 0.24),
  and was **reverted**.
* Not measured here: real phones on a real network, and field Core Web Vitals.
  The live site is not reachable from this machine. The CI smoke test measures the
  real proxy from GitHub's network.

## 4. New products and new photos

* **New product or new photo** (new Rivhit picture id): shown through the proxy at
  once, as today. It is copied to a static file on the next deploy (every push to
  `main` and the daily 03:41 UTC rebuild).
* **Rotation changed in the admin screens**: the key includes the rotation, so the
  new rotation is used at once (proxy), and the static copy follows on the next deploy.
* **Photo replaced in Rivhit under the same id**: every copy is re-made about
  every 3 weeks (copies older than 14 days, up to 40 per deploy, daily rebuild).
  Today's browser cache of the proxy (30 days, immutable) is stale for longer.
* **The manager's photo screens** (review / fix) never use the static copy:
  they always show the live photo from Rivhit.

## 5. Cache and privacy

* Static photos are public product photos (the same set `/view` and `/p/` already
  show). Nothing private, and no prices.
* GitHub Pages serves every file with `max-age=600`. Repeat visits after 10 minutes
  revalidate with a cheap 304 from the CDN. This header cannot be changed on Pages.
* The return-to-place state lives in `sessionStorage` (one tab), holds no data
  rows, is tied to the user id, and expires after 30 minutes.

## 6. Risks left

* The first deploy downloads ~830 photos through the proxy, 2 at a time, within a
  10-minute budget. Photos not reached are taken on the next deploys, and the
  proxy serves them meanwhile.
* Pages artifact +~35 MB, far below the 1 GB limit.
* actions/cache: ~35 MB per deploy entry, LRU-evicted, within the free limit.

## 7. Rollback

* **Full:** `git revert -m 1 <merge commit>` through a PR. Merging it redeploys.
  The static photos simply stop being produced and used.
* **Photos only:** remove the two "photo" steps from `deploy-pages.yml`. The data
  file stays empty, so every photo uses the proxy as before.
