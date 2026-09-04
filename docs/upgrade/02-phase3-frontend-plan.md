# 02 — Phase 3 Plan (front end only)

**Status: PLAN ONLY. Nothing in this document has been executed.**
No component edited · no flag flipped · no test written · no deploy · no schema, grant,
row, image or environment variable touched.

Written 2026-09-03 against `00-baseline.md`, `00b-safety-gate-1.5.md` and
`01-phase2-plan.md`. Phase 2 is approved **as a plan** and has not run either.

---

## 0. What Phase 3 depends on

| Dependency | From | Why |
|---|---|---|
| Staging project, populated + anonymised | Phase 2 P2.3–P2.4 | E2E tests must sign in, add to a cart and **place a real order**. That cannot happen against production. |
| Tested restore | Phase 2 P2.4 | If a test writes something wrong, staging must be re-creatable in minutes. |
| Owner answers A1–A4 | Phase 2 §A | unchanged |

**What can start before staging exists:** the pure-unit work in P3.A2 and P3.A3-part-1
(Excel and pricing tests run in Node against fixtures, no database). Everything that
signs in, orders, or renders a real catalogue waits for staging.

**This plan is not a redesign.** The owner did not ask for one, and a redesign of a
working, revenue-carrying store is the single easiest way to break it. Phase 3 is:
build the safety net that does not exist → fix what is measurably fragile → then make
small, visible improvements, each one behind a flag that can be switched off.

---

## A. What the front end is today — measured, not estimated

18 routes · 20 components · 14 client pages · **6,158 lines across pages**, 4,047 across
components. All styling is inline (`747` style objects) over two CSS files
(`app/tokens.css`, `app/globals.css`).

| Route | Who sees it | Lines | Data source |
|---|---|---|---|
| `/` | everyone | 11 (+`HomeGate`) | — |
| `/view` | public catalogue, **no prices** | 6 → `PublicCatalog` | `catalog_public` |
| `/prices` | unlisted price list | 6 → `PublicCatalog` | `catalog_public_prices` |
| `/collection/?k=…` | **the link the owner sends buyers** | 392 | `catalog_collection` |
| `/catalog` | logged-in customer — **the ordering screen** | 1,102 | `search_products` + tables |
| `/product/?id=…` | product detail | 278 | tables |
| `/account` | customer's own orders | 115 | `orders` + `order_items` |
| `/login` `/register` `/forgot` `/reset` | auth | 10/9/9/169 (+710 `RegisterForm`) | Auth |
| `/admin` | manager — orders, products, customers | 1,187 | `orders` + `order_items` |
| `/admin/collections` | catalogue builder + pricing pass + **Excel** | 1,079 | collections |
| `/admin/prices` | per-customer prices | 435 | `price_overrides` |
| `/admin/customers` | customer search | 301 | `customers` |
| `/admin/images-review` `/admin/fix-images` | image tooling | 436 / 482 | products |
| `/accessibility` | statement | 131 | — |

Feature flags (`lib/featureFlags.ts`) are **build-time constants**: 6 on, 1 off
(`ff_a11y_widget`, off at the owner's request). Turning one off is a one-line diff plus a
deploy — this is the rollback mechanism Phase 3 leans on, and its limitation (not instant,
not per-user) is stated here so nobody is surprised by it later.

---

## B. Findings that shape this plan

Each one is evidence, with the file and line it came from.

### B1. WhatsApp is not live on the site
`app/components/SiteHeader.tsx:15` — `whatsapp: ""`. Both render sites
(`SiteHeader.tsx:141`, `SiteFooter.tsx:92`) are guarded by `CONTACT.whatsapp && …`, so an
empty string means **no WhatsApp button is rendered anywhere on the site today.** The same
is true of `email: ""`, and `HAS_LOGO_FILE = false` (there is no `landing/public/logo.png`,
so the header shows a text logo).

This matters because WhatsApp is on the owner's must-not-break list — the honest position
is that there is nothing there to break, and switching it on is filling in one string.
Raised as a decision for the owner, not changed here.

### B2. There is no error boundary anywhere in the app
`find app -name "error.tsx" -o -name "global-error.tsx"` returns **nothing**; only
`not-found.tsx` exists. Consequence: any uncaught render error in a client component —
and 14 of the 18 pages are client components — produces a **blank white screen** with no
message and no way back. This is exactly the failure class of the D-018 blank-screen bug,
which was found by chance in a browser test rather than by the app reporting it.

### B3. The catalogue is implemented three times
`app/catalog/page.tsx`, `app/components/PublicCatalog.tsx` and `app/collection/page.tsx`
each carry their own copy of the same screen — byte-identical grid definition
(`repeat(auto-fill, minmax(clamp(132px, 46%, 150px), 1fr))`), the same `PAGE_SIZE = 24`,
the same `IntersectionObserver` infinite scroll, near-identical cards.

The cost is already visible: one failure produces three different Hebrew messages —
*"הטעינה נכשלה. בדקו את החיבור ונסו שוב."* / *"טעינת המוצרים נכשלה."* /
*"טעינת הקטלוג נכשלה. בדקו את החיבור ונסו שוב."* A card fix must be made three times, and
a bug can live in one copy and not the others.

### B4. 31 `react-hooks/set-state-in-effect` warnings
Measured across 17 files (7 in `/admin`, 4 in `/catalog`). These are not cosmetic: setting
state inside an effect is the pattern that produces a second render pass and visible
flicker on load. Lint is currently green because the ratchet is set at 33 — the warnings
are permitted, not absent.

### B5. There is no E2E test, no Excel test, and no pricing-parity test
`npm test` runs 7 Node files, 122 assertions, all pure units: quantity, searchRank,
imageFallback, rivhitImgProxy, signup, turnstile, pricing. **Nothing exercises a browser,
an order, or a workbook.** Every browser check so far has been an ad-hoc script in a
scratch directory — not committed, not run by CI, gone when the container is reclaimed.

`lib/collectionExcel.ts:57` already says the quiet part: *"Exposed separately from the
download so a Node test can build a sheet and read it back."* The seam exists. The test
was never written.

### B6. Pricing is implemented twice, and only a comment links them
`lib/pricing.ts` resolves what a customer pays; `validate_order_item()` re-computes it in
SQL and rejects the line if it disagrees. The file says: *"Change one and you MUST change
the other."* Nothing enforces it. If the two ever drift, the symptom is not a wrong price
— it is **customers unable to place orders at all**, which is worse.

---

## C. The work, in waves

Every wave lists: what changes · what the customer sees · which components · risk ·
rollback. Nothing here runs without the owner's word, wave by wave.

### P3.A — The safety net (zero user-visible change)

This wave exists to answer the owner's question *"איך בודקים שזה לא שובר"* **before**
anything is changed. A test written after the change proves nothing about the change.

| # | Work | Components | Customer sees | Risk | Rollback |
|---|---|---|---|---|---|
| A1 | Playwright E2E suite committed to the repo, run against **staging**, added to `ci.yml` | new `landing/e2e/` — no app file touched | nothing | **none** — new files only | delete the directory |
| A2 | Excel regression test on `buildCollectionWorkbook` | new `tests/collectionExcel.test.mjs` | nothing | **none** | delete the file |
| A3 | Pricing-parity test: `resolvePrice` (TS) vs `validate_order_item` (SQL), run against staging | new test file | nothing | **none** — reads only | delete the file |
| A4 | Visual baseline: every customer screen at 390 / 768 / 1440 from staging, committed as the reference | new `docs/upgrade/baseline-shots/` | nothing | **none** | delete the directory |

**A1 covers these journeys, end to end:**
1. login → `/catalog` → search → filter by category → add to cart → cart totals →
   minimum-order bar → **place an order** → order visible in `/account` and in `/admin`
2. the pack model: a product sold in a מארז adds whole packs, and the line total matches
   `describeQuantity`
3. per-customer price: customer A and customer B see **different** prices for the same
   product, and neither sees the other's
4. `/collection/?k=…` renders with the collection's prices and no stock
5. `/view` renders with no prices at all
6. `/admin/collections` → pricing pass → save → **Excel downloads and opens**
7. a wrong `k`, an expired collection, and a signed-out `/catalog` each land somewhere sane

**A2 asserts** — five columns in order (תמונה · תיאור פריט · ברקוד · מחיר · מחיר רשת),
RTL sheet view, frozen header row, `twoCellAnchor` on every picture (the RTL drift fix),
`barcode || sku` fallback including the **5 products that legitimately export an empty
barcode cell**, sheet-name sanitisation, and that zero rows produces a valid file rather
than a crash.

**A3 asserts** the four precedence cases from `lib/pricing.ts` — override-for-this-customer
(discount NOT applied on top), override-for-everyone (discount applied), plain list price,
and the ₪0.004 → ₪0.01 rounding floor — give the **same number** in TypeScript and in SQL.

### P3.B — Fix what is fragile

| # | Work | Components | Customer sees | Risk | Rollback |
|---|---|---|---|---|---|
| B1 | Error boundaries: `global-error.tsx` + one `error.tsx` per segment | new files only; no existing component edited | instead of a **white screen**: a card — *״משהו השתבש. נסו שוב״* — with a retry button and the phone number | **very low** — renders only where the page is blank today | delete the files |
| B2 | The 31 `set-state-in-effect` warnings, in small batches | 17 files, **one commit per file** | slightly less flicker on load | **medium, per file** — real logic | revert that one commit |
| B3 | One shared Hebrew wording for a failed catalogue load | the 3 catalogues | one consistent message | very low | revert |

**B2 is deliberately the slowest item in the plan.** One file per commit, E2E green after
each, lint ratchet lowered as warnings disappear and **never raised**. If a file turns out
to be risky (the cart effects in `/catalog` are the obvious candidate) it is left alone and
recorded as such — a warning is cheaper than a broken cart.

### P3.C — Customer-visible improvements

Each is small, independent, and behind its own flag.

| # | Improvement | Customer sees | Components | Risk | Rollback |
|---|---|---|---|---|---|
| C1 | Turn WhatsApp on (owner supplies the number) | a 💬 וואטסאפ button in the header and footer; one tap opens a chat | `SiteHeader.tsx:15` — **one string** | very low | set it back to `""` |
| C2 | Contact email + real logo file, if the owner wants them | email link in the footer; the logo instead of the text mark | `SiteHeader.tsx:16`, `HAS_LOGO_FILE` | very low | same |
| C3 | Cart survives a failed submit more visibly — the existing reconcile messages ("המחירים התעדכנו…") get a clearer place in the drawer | fewer buyers confused about why the button did nothing | `/catalog` cart drawer | low | flag off |
| C4 | Skeleton cards while the grid loads, instead of the text *"טוען מוצרים…"* | the page looks like the catalogue immediately rather than an empty screen | shared card component (needs P3.D) or 3× | low | flag off |

**Not proposed, on purpose:** a stock badge. `app/catalog/page.tsx:765` records why —
Rivhit quantities are not maintained reliably, new items arrive as 0, and an automatic
"אזל מהמלאי" would mislabel products that are in stock. That decision stands.

### P3.D — The three duplicate catalogues (structural)

Extract `<ProductGrid>` and `<ProductCard>` — **presentation only**. No data fetching
moves, no pricing logic moves, each screen keeps its own RPC and its own price source.

- **Customer sees: nothing.** That is the acceptance criterion — the A4 screenshots must
  match pixel for pixel, at all three widths, on all three screens.
- **Risk: the highest in this plan**, and it buys the customer nothing on day one. It buys
  the *next* ten changes being made once instead of three times.
- **Recommendation: do it after P3.B, or skip it.** If the owner wants minimum risk, this
  is the wave to drop. Everything else in this plan stands without it.
- Rollback: `ff_shared_product_grid = false` restores the three original screens, which
  stay in the tree until the flag has been on in production for two weeks.

### P3.E — Performance

Baseline: ~1 MB transferred per page; largest chunk **912 KB** (exceljs — already correctly
split behind `await import()`, fetched only when the export button is pressed); `out/` is
17 MB. `framer-motion` is confirmed reachable only through the legacy landing, which is
behind `next/dynamic` and not fetched while `ff_new_landing` is on.

Work: measure real Core Web Vitals **from a real client** (this container cannot reach
production — the Phase 1 numbers are local render timings and are labelled as such), then
trim the shared chunks. No customer-visible change intended. Deferred to the end: it is
the least urgent item and the easiest to get wrong.

---

## D. How each thing the owner named is protected

The owner's list — הזמנה · מחיר · קטלוג · וואטסאפ · אקסל — mapped to the specific test
that would catch a break, and to what happens if it fires.

| Protected | Test that catches a break | Where it runs | If it fires |
|---|---|---|---|
| **הזמנה** | A1 journey 1 — a real order placed on staging, then read back from `orders` + `order_items` with the right total | staging, every PR | merge blocked |
| | server-side `validate_order_item()` — already live, rejects any line whose price disagrees | production, always | order refused, not mispriced |
| **מחיר** | A3 parity: TS and SQL agree on all four precedence cases | staging | merge blocked |
| | A1 journey 3: customer A ≠ customer B, and neither sees the other's price | staging | merge blocked |
| **קטלוג** | A1 journeys 4–5 + A4 pixel comparison across `/catalog`, `/collection`, `/view` | staging | merge blocked |
| **וואטסאפ** | **nothing to break today (B1)** — once C1 turns it on, an E2E assertion that the `wa.me` link renders with the right number | staging | merge blocked |
| **אקסל** | A2 unit assertions + A1 journey 6 (the file actually downloads) | Node + staging | merge blocked |

Two properties of this table matter more than its contents:

1. **Every test runs against staging, never production.** No test signs up, resets a
   password, sends a message or places an order on the live system.
2. **The tests are written in P3.A, before any change in P3.B–P3.E.** A suite written
   after the fact would encode the new behaviour as correct, which is not a test.

---

## E. Rollback

Four layers, cheapest first.

| Layer | Mechanism | Time | Cost |
|---|---|---|---|
| 1 | **Feature flag** — flip one constant to `false`, deploy | ~3 min (a Pages build) | none; old code still in the tree |
| 2 | **Revert one commit** — the reason B2 is one file per commit | ~5 min | that single fix is undone |
| 3 | **Revert the merge**, redeploy | ~5 min | the whole wave is undone |
| 4 | **Reset `main` to the last known-good commit** | ~5 min | everything after it is undone |

Limits, stated rather than discovered later:
- Rollback is **not instant.** Pages serves whatever `main` last built; there is no
  point-the-domain-elsewhere switch. Worst case is a few minutes of the bad version live.
- Flags are **build-time**, so a flag rollback is still a deploy.
- **A placed order cannot be rolled back by a deploy.** This is why the order path is
  tested first, on staging, and why `validate_order_item()` stays as the server-side guard
  no matter what the front end does.

**Fixed rule for this phase: one wave per PR, drafts until the owner says otherwise, and
no merge to `main` while the E2E suite is red.**

---

## F. Definition of done — the gate for each wave

1. `npm run lint` — 0 errors, warning count **at or below** the ratchet, never above
2. `npx tsc --noEmit` — clean
3. `npm test` — every existing assertion still passes, plus the new ones
4. `npm run build` — 21 static pages
5. E2E green on staging
6. A4 screenshots compared; any visual difference shown to the owner **before** merge
7. The wave's flag proven to work **in both directions** on staging
8. `docs/DECISIONS.md` updated with what changed and why

## G. Not in Phase 3

- No schema change, no migration, no RLS change, no grant change
- **The `/prices` closure is not here** — it is a business decision with a DB grant behind
  it, planned in `01-phase2-plan.md` §E, and it waits for the owner's word
- Finding F1 (customers can read 6,437 inactive products) is a **policy** fix, not a
  front-end one — it stays in its own change with its own before/after test
- No redesign, no new colour scheme, no re-layout of a working screen
- No change to the Rivhit sync, the edge functions, or `app/`
- No deploy to production without an explicit GO LIVE

## H. Status

| Requirement | Status |
|---|---|
| Phase 1 baseline | ✅ `00-baseline.md` |
| Safety gate 1.5 | ✅ `00b-safety-gate-1.5.md` |
| Phase 2 **plan** | ✅ `01-phase2-plan.md` |
| Phase 2 **executed** | ❌ not started — awaiting owner inputs A1–A4 |
| Phase 3 **plan** | ✅ this document |
| Phase 3 **executed** | ❌ not started, and blocked on staging existing |

**No code has been written. Phase 3 begins only when staging exists and the owner says so.**
