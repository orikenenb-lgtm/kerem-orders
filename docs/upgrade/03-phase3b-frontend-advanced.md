# 03 — Phase 3B Plan (advanced front end / redesign)

**Status: PLAN ONLY. Nothing in this document has been executed.**
No component edited · no flag flipped · no deploy · no schema, grant, row, image or
environment change.

Phase 3 (`02-phase3-frontend-plan.md`) is stability and the safety net. **This document is
the design work**: what the store should look like and how it should behave. It assumes
Phase 3's test suite exists first — a redesign without an E2E suite is a guess.

Written 2026-09-03. Every number below was measured against the live database, read-only,
while writing it.

---

## 0. What the data says — and what it forbids

A redesign that ignores the data invents features the catalogue cannot fill. Measured today:

| Fact | Number | What it means for design |
|---|---|---|
| Active products | 973 in **24 categories** | 24 chips do not fit a phone. The category row needs a real design, not a longer row. |
| Median price | **₪13** (₪1–₪450) | 84 % of the catalogue is under ₪50. A price *slider* would be useless; **preset buckets** are the correct control. |
| Price spread | <5: 121 · 5–10: 160 · 10–20: **339** · 20–50: 268 · 50–100: 75 · 100+: 10 | the buckets, straight from the histogram |
| **Sold in packs** | **375 of 973 — 39 %** | the pack model is not an edge case, it is two of every five cards |
| Products without a photo | **3** | the placeholder is a rounding error, not a design problem |
| Longest product name | **54 characters**, zero names over 60 | the card clamps to 3 lines for names "up to 120 chars" — **measurably over-cautious**, 2 lines is enough and buys vertical space |
| `description` filled | **0 of 973** | **a product page cannot show a description.** Do not design one. |
| `in_stock` | **true for all 973** | worthless as a filter — zero variance |
| `stock_quantity` | 820 > 0 · 10 = 0 · **143 negative** | Rivhit's stock is **not trustworthy**. An availability filter built on it would hide products that are in stock. |
| `price_overrides` | **1 row**, global, **0 per-customer** | |
| Profiles with a discount | **0 of 3** | |
| Orders | 9, all status `new`, avg 4 lines | the order-history screen is nearly empty in real life |
| Collections | 5, avg 62 products, largest **241** | |

### Three consequences that change what can be built

**(a) The discount UI is dead code in production.** The card has three price presentations —
plain, struck-through + `-N%` badge, and the green *מחיר מיוחד* badge. With **0 customers
carrying a discount and 0 per-customer overrides, no customer has ever seen the second or
third.** They work and are unit-tested; nothing feeds them. Making discounts visible is a
*business* action (set them), not a design action.

**(b) "מבצעים" and "מוצרים חדשים" already exist — as categories.** Rivhit already carries
**"50 אחוז הנחה" with 88 products** and **"חדש 1" with 45**. The right move is to *promote
what exists*, not to build a second sale engine that would show exactly one product.

**(c) An availability filter should not be built.** 143 products carry negative stock. The
code already refuses a stock badge for this reason (`app/catalog/page.tsx:765`) and that
decision was correct. **I am declining item 3's "זמינות" and stating why rather than
shipping a filter that lies.** If Rivhit's stock is ever made reliable, it becomes a
one-line addition to a filter bar that will already exist.

---

## 1. The architectural constraint that shapes every filter

`/catalog` — the ordering screen — has **two** data paths:

| Mode | Trigger | Source | Can filter / sort? |
|---|---|---|---|
| **Browse** | no search text | direct PostgREST query on `products` | **yes** — `.eq(category)`, `.order(price)`, `.range()` today; `gte`/`lte`/`created_at` are available at zero DB cost |
| **Search** | 2+ characters | RPC `search_products(q, lim, off)` | **no** — the function takes three arguments and nothing else |

Two things follow.

**First — an existing bug, found while writing this.** In search mode the selected category
and the sort order are **silently ignored**: the RPC never receives them, so a buyer who
picks "לגו מותגים", then types "רכב", quietly gets results from the whole catalogue with
the chip still highlighted. It is listed as B0 below.

**Second — the honest split on filters:**

| Where | New filters cost |
|---|---|
| `/catalog` **browse mode** | **front end only** — PostgREST already supports it. ✅ in 3B |
| `/catalog` **search mode** | needs new arguments on `search_products` → **a DB migration** ❌ not in 3B |
| `/view`, `/prices`, `/collection` | RPC-only screens → **a DB migration** ❌ not in 3B |

So 3B delivers the full filter experience on the screen where customers actually order, and
**states plainly** that carrying it into search and into the public catalogues is a Phase 4
database change, planned separately, not smuggled in here.

---

## 2. Design direction — what "more professional" means for *this* store

Not a mood board. Four principles, each argued from the data.

**P1 — The catalogue is a scanning tool, not a showcase.** A buyer works through 973 SKUs
on a phone to build a ₪3,500+ order. Every pixel that does not help them decide *is this one
in, and how many* is working against them. Today the cards on `/catalog` and on
`PublicCatalog` (`/view`, `/prices`) carry a **coloured top border cycling through six
rainbow hues by grid index** — `catalog/page.tsx:755` and `PublicCatalog.tsx:247`, both
`rainbowColors[i % 6]`. That colour means nothing, changes as the grid re-flows, and
competes with the price for attention. **Colour must earn its place by carrying meaning:**
price, pack, sale, in-cart.

The strongest evidence that this is the right call: **`/collection` — the link the owner
actually sends to buyers — already has no rainbow border** (`collection/page.tsx:207`). The
calm neutral card is not a new idea that needs selling; it is already shipping to customers
on one screen. B1.1 brings the other two into line with it.

**P2 — Keep the contrast work that is already there.** `lib/ui.ts` records that white on
the rainbow gradient measured **1.60:1 on #FFC400** against a 4.5:1 minimum, so ~85 % of
every primary button failed WCAG 1.4.3; the rainbow was cut back to the wordmark and the
button moved to the accent at 4.76:1. **The redesign does not undo that.** Every new colour
pair gets measured before it ships, and the rainbow stays decorative.

**P3 — The pack is the unit of thought for 39 % of the catalogue.** A card showing only
"₪13 ליחידה" for a product sold in packs of 12 forces mental arithmetic 375 times a
session. The pack, the pack price and what one press adds must be readable **without
tapping**.

**P4 — Density beats decoration on a phone.** At 390 px the grid gives two columns of
~150 px. With names never exceeding 54 characters, the 3-line clamp wastes a line on
almost every card. Reclaiming it is free vertical space — more products per screen, less
scrolling through 973 items.

---

## 3. The work — grouped, each with felt/technical, risk, test, rollback

Flags are build-time constants (`lib/featureFlags.ts`), so **every item below gets its own
flag** and rollback means one line back to `false` plus a deploy (~3 min).

### Group B0 — the bug found while planning

| | |
|---|---|
| **What** | Pass `activeCat` and `sort` through search mode. Either extend the client's browse query to handle text (it already has `.or(name/sku/barcode ilike)`) or hide the chips and sort control while searching so the UI stops claiming a filter it is not applying. |
| **Customer feels it** | **Yes.** Searching inside a category stops silently returning the whole catalogue. |
| **Risk** | Low — but it touches `loadProducts`, the most load-bearing function on the ordering screen. |
| **Test** | New E2E: pick a category → search → **every result is in that category**; the trigram typo tolerance still works. |
| **Rollback** | `ff_search_respects_filters = false`. |

### Group B1 — the product card

The card is the redesign. It appears on `/catalog`, `/collection`, `/view` and `/prices`,
so its markup is the strongest argument for Phase 3's shared `<ProductCard>` — **do B1
after that extraction, or accept doing it three times.**

| # | Change | Customer feels it? | Risk | Test | Rollback |
|---|---|---|---|---|---|
| B1.1 | Replace the meaningless rainbow top border with a calm neutral card; colour reserved for meaning | **Yes — strongly.** The grid stops flickering with colour and the eye lands on the price. | low | A4 screenshot diff, owner approves before merge | flag |
| B1.2 | Price block rebuilt: unit price is the headline (the owner's standing decision), pack price second, `-N%` and *מחיר מיוחד* keep their exact current rules | **Only when discounts exist** — see §0(a). Today: pack products read better. | **medium — this is money on screen** | pricing unit tests unchanged + E2E asserting the rendered number equals `resolvePrice` | flag |
| B1.3 | Pack line promoted: `מארז = 12 יחידות · ₪156 למארז` | **Yes — for 375 of 973 products** | low | E2E on a pack product: the card figure matches `describeQuantity` | flag |
| B1.4 | Quantity stepper on the card: − / number / + honouring `order_step`, plus the existing carton button | **Yes — the largest single time saving.** Adding 20 products stops being 20 round trips through a product page. | **medium** — it writes to the cart | E2E: stepper respects `order_step`, never produces a partial pack, cart total matches | flag |
| B1.5 | `מק״ט` line uses `barcode \|\| sku` — the same fallback as the Excel export | Barely — 5 products still show `—` (measured: 5 have neither) | very low | unit test on the shared helper | flag |
| B1.6 | Name clamp 3 lines → 2 (max measured name: 54 chars) | **Yes** — roughly one more row of products per screen | very low | screenshot diff at 390/768/1440 | flag |
| B1.7 | In-cart state on the card — quantity badge + a visibly different border | **Yes.** Today the only way to know what is already in the cart is to open it. | low | E2E: add → badge appears → matches the drawer | flag |

**Explicitly not on the card:** a stock badge (§0(c)), a description (0 of 973 have one),
and a rating or review (no such data and no way to collect it).

### Group B2 — search and filtering

A filter bar above the grid, collapsed to one row on a phone.

| # | Filter | Source | Customer feels it? | Risk | Rollback |
|---|---|---|---|---|---|
| B2.1 | **Categories redesigned.** 24 chips do not fit 390 px. Proposal: the 6 largest as chips + a "כל הקטגוריות" sheet listing all 24 with counts | **Yes** | low | E2E: every one of the 24 reachable; counts match the DB | flag |
| B2.2 | **Price buckets** — `<₪5 · 5–10 · 10–20 · 20–50 · 50–100 · 100+`, straight from the histogram | **Yes** | low — browse mode only, PostgREST `gte`/`lte` | E2E: every returned price inside the bucket | flag |
| B2.3 | **מבצעים** = the existing **"50 אחוז הנחה"** category (88 products), surfaced as a first-class button | **Yes** | very low — it is a category filter | E2E: returns exactly that category | flag |
| B2.4 | **חדש** = the existing **"חדש 1"** category (45), optionally `created_at > now() - 30 days` (**115 products** today) | **Yes** | low | E2E on both definitions; the owner picks one | flag |
| B2.5 | **זמינות — declined.** 143 products carry negative stock. Reinstated the day Rivhit's stock is trustworthy. | — | — | — | — |
| B2.6 | Active filters shown as removable pills with a "נקה הכל" | **Yes** — today a forgotten category filter silently hides 900 products | low | E2E: clearing restores the full count | flag |

**Stated limit, again:** B2.1–B2.4 apply to `/catalog` browse mode. Search mode and the
public catalogues need RPC arguments — a Phase 4 database change.

### Group B3 — the cart

| # | Change | Customer feels it? | Risk | Test | Rollback |
|---|---|---|---|---|---|
| B3.1 | Line rows rebuilt: thumbnail, name, unit price, pack, stepper, line total, remove | **Yes** | low | E2E: line totals sum to the cart total | flag |
| B3.2 | The minimum-order bar (already built, `ff_min_order_vat_ui`) pinned so it is visible while editing | **Yes** — ₪3,500 minimum means most of a session is spent below it | low | E2E at both sides of the minimum | flag |
| B3.3 | The reconcile messages ("המחירים התעדכנו…", "חלק מהמוצרים אזלו…") shown **on the affected line**, not only as a banner | **Yes — this is the current worst moment in the flow.** Today the buyer is told something changed and must find it themselves. | **medium — checkout path** | E2E: force a price change on staging, assert the right line is marked and the order still completes | flag |
| B3.4 | VAT breakdown kept exactly as it is | no | none | existing | — |

**Hard rule for B3: the submit logic in `app/catalog/page.tsx:~540–585` is not touched.**
Re-fetch, reconcile, minimum check, insert order, insert lines, roll back the order if the
lines fail, fire-and-forget the Rivhit push — that sequence is presentation-independent and
stays byte-identical. B3 changes what is drawn around it.

### Group B4 — mobile

Measured today: 0 horizontal overflow and 0 console errors at 390 px on all six screens.
The base is sound; this is refinement, not rescue.

| # | Change | Customer feels it? | Risk | Rollback |
|---|---|---|---|---|
| B4.1 | Every tap target ≥ 44×44 px — steppers and chips especially | **Yes** | low | flag |
| B4.2 | Filter bar becomes a bottom sheet on phones — thumb reach, not top-of-screen | **Yes** | low | flag |
| B4.3 | Sticky cart button gets a safe-area inset so iPhone's home indicator stops overlapping it | **Yes, on iPhone** | very low | flag |
| B4.4 | Search input `inputMode`/`enterKeyHint`, and the keyboard closes on submit | **Yes** | very low | flag |
| B4.5 | The category sheet and cart drawer keep focus trapped and close on Escape (the cart already does; the new sheets must match) | screen-reader and keyboard users | low | flag |
| B4.6 | Skeleton cards instead of "טוען מוצרים…" | **Yes** | low | flag |

### Group B5 — customer, orders, catalogues

Honest scale first: **9 orders exist, all `new`, average 4 lines.** This screen is not where
the value is today. Scoped accordingly.

| # | Change | Customer feels it? | Risk | Rollback |
|---|---|---|---|---|
| B5.1 | `/account`: order cards with thumbnails, status and a total, instead of a bare list | Yes, mildly — 9 orders | low | flag |
| B5.2 | **"הזמן שוב"** — loads a past order back into the cart, re-priced at today's prices through `resolvePrice` (never the stored line price) | **Yes — the highest-value item here**, for a wholesaler who reorders the same lines | **medium** — writes the cart | flag |
| B5.3 | `/admin`: order list gets filter + search; the status control made obvious (**all 9 orders are still `new` — the workflow has never been used**) | manager only | low | flag |
| B5.4 | `/admin/collections`: the largest catalogue holds **241** products — virtualise the list and keep the Excel button pinned | manager only | low | flag |

### Group B6 — motion

Budget, not decoration. `framer-motion` is already in the bundle but reachable only through
the legacy landing behind `next/dynamic`; **B6 must not pull it into the catalogue.** CSS
transitions only.

- Card hover/press: `transform: scale(0.98)`, 120 ms
- Add-to-cart: the count badge pulses once, 200 ms
- Filter/skeleton: 150 ms fade, no layout shift
- Drawer/sheet: 200 ms slide
- **`@media (prefers-reduced-motion: reduce)` disables all of it** — non-negotiable
- **Nothing animates on the price.** A moving number reads as an unstable number.

Felt: yes, subtly. Risk: very low. Rollback: `ff_micro_motion = false`.

---

## 4. Felt by the customer vs. technical only

Item 9, answered directly.

| **Felt — the customer will notice** | **Technical — invisible if done right** |
|---|---|
| B0 search inside a category actually filtering | shared `<ProductCard>` extraction |
| B1.4 quantity stepper on the card | B1.5 the `barcode \|\| sku` helper |
| B1.7 in-cart badge | virtualising a 241-row admin list |
| B1.3 pack price on 375 products | the 31 `set-state-in-effect` fixes |
| B1.6 more products per screen | skeletons (felt as speed, not as a feature) |
| B2.1–B2.4 filters, מבצעים, חדש | error boundaries — felt **only** when something breaks |
| B3.1–B3.3 a clearer cart, errors on the line | bundle trimming |
| B4.1–B4.4 mobile ergonomics | |
| B5.2 "הזמן שוב" | |
| B6 motion — felt as polish, not as a feature | |

**Not felt by anyone today, and the plan says so:** every discount presentation (0 customers
have a discount), any availability signal (the data is wrong), any product description
(0 of 973 exist).

---

## 5. How the existing logic is protected

Item 8. The rule for all of 3B: **presentation changes; the functions that decide money,
quantity and orders do not.**

| Logic | Where it lives | 3B's rule | What catches a break |
|---|---|---|---|
| **Price** | `lib/pricing.ts` → mirrored by SQL `validate_order_item()` | not edited. Cards call `resolvePrice`; no component computes a price itself. | Phase 3 A3 parity test + E2E comparing the rendered number to `resolvePrice`; server-side the trigger refuses a mismatched line |
| **Discount** | `applyDiscount` / `discountPct` in `lib/ui.ts` | not edited | existing 10 pricing assertions |
| **Quantity / packs** | `lib/quantity.ts` (`resolveQuantity`, `stepOf`, `describeQuantity`) | the stepper **calls** it, never re-implements it | existing 20 assertions + E2E on a pack product |
| **Order submit** | `app/catalog/page.tsx` ~540–585 | **byte-identical.** Re-fetch → reconcile → minimum → insert → insert lines → roll back on failure → Rivhit push | E2E places a real order on staging and reads it back |
| **Catalogue data** | the 5 RPCs + the browse query | **no RPC signature changes in 3B.** Browse-mode filters use PostgREST only | E2E on all four catalogue screens |
| **Excel** | `lib/collectionExcel.ts` | **not touched at all.** No 3B item enters this file | Phase 3 A2 workbook test + E2E download |
| **WhatsApp** | `SiteHeader.tsx` / `SiteFooter.tsx` | after Phase 3 C1 turns it on, the redesign must keep it in both places | E2E asserts the `wa.me` link and number on both |

---

## 6. Order of work, and the gate on each

Design is agreed **before** it is built: B1 and B2 start as static mock pages on staging
with real anonymised data, shown to the owner, and only then wired to real state.

| Wave | Contents | Gate |
|---|---|---|
| 0 | Phase 3 A1–A4 exist and are green | E2E covers order, price, catalogue, Excel |
| 1 | B0 (the search bug) | E2E: search inside a category |
| 2 | B1 card, behind `ff_card_v2` | owner approves the screenshot diff |
| 3 | B2 filters, behind `ff_filters_v2` | counts match the DB on all 24 categories |
| 4 | B3 cart, behind `ff_cart_v2` | a real order placed on staging, price unchanged |
| 5 | B4 mobile + B6 motion | 0 overflow, 0 console errors at 390/768/1440 |
| 6 | B5 account/admin | manager walkthrough |

**One wave per PR. Draft until approved. No merge while E2E is red. No production deploy
without an explicit GO LIVE.**

---

## 7. Rollback

Same four layers as Phase 3, with one addition specific to a redesign:

**Every replaced screen stays in the tree behind its flag for two weeks of production use
before the old code is deleted.** A redesign that deletes the old version on merge day has
no rollback, only a rewrite.

| Layer | Mechanism | Time |
|---|---|---|
| 1 | one flag → `false`, deploy | ~3 min |
| 2 | revert one commit | ~5 min |
| 3 | revert the wave's merge | ~5 min |
| 4 | reset `main` to the last known-good commit | ~5 min |

Unchanged limits: Pages rollback is a rebuild, not instant; flags are build-time; **a placed
order cannot be undone by a deploy** — which is why the submit path is frozen in §5 and why
`validate_order_item()` stays as the server-side guard.

---

## 8. Not in Phase 3B

- **No RPC or schema change** — so no filters in search mode and none on the public
  catalogues. That is Phase 4, planned separately.
- **No availability filter or stock badge** — the data is wrong (§0(c)).
- **No product descriptions** — 0 of 973 exist.
- **No discount engine** — the presentation already exists; feeding it is a business action.
- No change to Rivhit sync, edge functions, `app/`, images, or `/prices`.
- No new dependency. No `framer-motion` in the catalogue.
- No production deploy.

## 9. Status

| | |
|---|---|
| Phase 1 baseline · Gate 1.5 | ✅ done |
| Phase 2 plan · Phase 3 plan | ✅ written, **not executed** |
| Phase 3B plan | ✅ this document |
| Phase 3B executed | ❌ **not started** — blocked on staging and on Phase 3's E2E suite |

**No code has been written.**
