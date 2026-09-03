# 04 — Phase 3B Execution Order (impact vs. risk)

**Status: PLAN ONLY. No code written.**

3B is approved **as a plan**. This document is the order it would be built in, and — just as
important — what would **not** be built.

---

## 0. The owner's five preconditions, recorded as the contract for this phase

| # | Condition | Where it is enforced |
|---|---|---|
| 1 | **Staging must exist and work** | Phase 2 P2.3–P2.4. Nothing in 3B starts before it. |
| 2 | **Phase 3 tests green** | Phase 3 A1–A4. A redesign without an E2E suite is a guess. |
| 3 | **Every front-end change behind its own flag** | one flag per wave *and* per risky item — the "flag" column below |
| 4 | **No change to price / quantity / order / Excel / catalogue logic without explicit approval** | `lib/pricing.ts`, `lib/quantity.ts`, `lib/collectionExcel.ts` and the submit path are frozen; anything that would touch them is in §4 |
| 5 | **No database change in 3B** | every item needing an RPC argument is in §4 and marked Phase 4 |

**Consequence of 4 + 5, stated up front:** two items from the 3B plan are removed from the
build order entirely — the price-block rebuild (touches money on screen) and every filter
outside `/catalog` browse mode (needs an RPC). They are not deferred quietly; they are in
§4 with the reason.

---

## 1. The order

Ranked by **felt impact ÷ risk**, with dependencies respected. One wave per PR, draft
until approved, no merge while E2E is red.

### Wave 1 — the bug (must come before any filter work)

| Change | Felt by customer | Risk | Staging? | DB? | Flag | Recommendation |
|---|---|---|---|---|---|---|
| **B0** — category + sort respected in search mode | **High** — searching in a category stops silently returning all 973 | Medium — touches `loadProducts` | **Yes** | No | `ff_search_respects_filters` | **First.** It is a correctness bug, and B2 is built on it. |

### Wave 2 — the card's look, plus the free wins (one mock, one approval)

| Change | Felt | Risk | Staging? | DB? | Flag | Recommendation |
|---|---|---|---|---|---|---|
| **B1.1** neutral card, colour only where it means something | **High** | Low | Yes — screenshot diff | No | `ff_card_v2` | **Do.** Owner approves the mock before it is built. |
| **B1.3** pack line — `מארז = 12 יח׳ · ₪156 למארז` | **High** — 375 of 973 | Low | Yes | No | `ff_card_v2` | **Do.** Best content-per-risk on the card. |
| **B1.6** name clamp 3 → 2 lines | Medium — ~one more row per screen | Very low | No — local build | No | `ff_card_v2` | **Do.** Max measured name is 54 chars. |
| **B1.5** `מק״ט` uses `barcode \|\| sku` | **Low** — 5 products | Very low | No | No | `ff_card_v2` | **Do**, it is free and matches the Excel. |
| **B4.3** iPhone safe-area on the cart button | Medium (iPhone only) | Very low | No | No | `ff_mobile_ergo` | **Do.** Minutes of work. |
| **B4.4** `inputMode` / keyboard closes on submit | Medium | Very low | No | No | `ff_mobile_ergo` | **Do.** |

### Wave 3 — the stepper (the single largest time saving)

| Change | Felt | Risk | Staging? | DB? | Flag | Recommendation |
|---|---|---|---|---|---|---|
| **B1.4** quantity stepper on the card, calling `resolveQuantity` | **Very high** — 20 products stops being 20 page visits | **Medium** — writes the cart | **Yes** | No | `ff_card_actions` | **Do, alone, in its own PR.** |
| **B1.7** in-cart badge + distinct border | **High** — today the cart is the only way to know | Low | Yes | No | `ff_card_actions` | **Do** — it is the stepper's feedback, same wave. |

### Wave 4 — filters, built mobile-first

The bottom sheet is not a separate wave: on a phone it **is** the filter UI.

| Change | Felt | Risk | Staging? | DB? | Flag | Recommendation |
|---|---|---|---|---|---|---|
| **B2.3** מבצעים = the existing `50 אחוז הנחה` category (88) | **High** | Very low | Yes — count check | No | `ff_filters_v2` | **Do first inside the wave.** Best ratio in all of 3B. |
| **B2.1** 6 chips + a sheet listing all 24 with counts | **High** | Low | Yes | No | `ff_filters_v2` | **Do.** 24 chips do not fit 390 px. |
| **B2.2** price buckets `<5 · 5–10 · 10–20 · 20–50 · 50–100 · 100+` | Medium–high | Low — PostgREST `gte`/`lte` | Yes | No | `ff_filters_v2` | **Do.** Buckets, never a slider. |
| **B2.4** חדש = `חדש 1` (45) or `created_at` < 30d (115) | Medium | Low | Yes | No | `ff_filters_v2` | **Do** — owner picks which definition. |
| **B2.6** active-filter pills + נקה הכל | Medium — a forgotten filter hides 900 products | Low | Yes | No | `ff_filters_v2` | **Do.** Required by the others. |
| **B4.2 + B4.5** bottom sheet, focus trapped, Escape closes | **High on mobile** | Low | Yes | No | `ff_filters_v2` | **Do** — part of this wave, not a later one. |

### Wave 5 — the cart

| Change | Felt | Risk | Staging? | DB? | Flag | Recommendation |
|---|---|---|---|---|---|---|
| **B3.1** line rows: thumbnail, stepper, line total, remove | **High** | Low | **Yes** | No | `ff_cart_v2` | **Do.** |
| **B3.2** minimum-order bar pinned while editing | **High** — most of a session sits under ₪3,500 | Low | Yes | No | `ff_cart_v2` | **Do.** |
| **B3.3** reconcile messages shown **on the affected line** | **High** — today's worst moment in the flow | **Medium** — checkout path | **Yes** | No | `ff_cart_line_errors` | **Do — but in its own PR, after B3.1/B3.2 are live and quiet.** |

### Wave 6 — the rest of mobile, then polish

| Change | Felt | Risk | Staging? | DB? | Flag | Recommendation |
|---|---|---|---|---|---|---|
| **B4.1** tap targets ≥ 44 px | **High on mobile** | Low | No — measurable locally | No | `ff_mobile_ergo` | **Do.** |
| **B4.6** skeleton cards | Medium — reads as speed | Low | Yes | No | `ff_skeletons` | **Do.** |
| **B5.2** "הזמן שוב", re-priced through `resolvePrice` | **High for repeat buyers** | **Medium** — writes the cart | **Yes** | No | `ff_reorder` | **Do last of the felt items.** Never the stored line price. |
| **B6** micro-motion, CSS only, reduced-motion respected | Low–medium — polish | Very low | No | No | `ff_micro_motion` | **Do last.** Animating a layout you are about to change is wasted work. |

---

## 2. Defer — real value, wrong moment

| Change | Why deferred |
|---|---|
| **B5.3** admin order filter/search | Manager-only, and **all 9 orders are still status `new`** — the workflow it would improve has never been used. Revisit when order volume justifies it. |
| **B5.4** virtualise the 241-row collection list | Manager-only. It is a performance fix for a screen that works today. |
| **Bundle trimming (P3.E)** | ~1 MB/page is worth fixing, but real Core Web Vitals must be measured **from a real client** first — this container cannot reach production. Measure, then decide. |

## 3. Do not do now

| Change | Why not |
|---|---|
| **B2.5 availability filter** | **The data is wrong.** `in_stock` is `true` for all 973; **143 products carry negative stock**. A filter on it would hide products that are in stock. Reinstated the day Rivhit's stock is trustworthy — it is then a one-line addition to a filter bar that already exists. |
| **B1.2 price-block rebuild** | It is **money on screen**, and its benefit is invisible today: **0 customers carry a discount, 0 per-customer overrides**, so the struck-through price and both badges have never been shown to anyone. Rewriting the riskiest rendering in the app for zero visible gain is a bad trade. Revisit **after** discounts actually exist — and then only with explicit approval, per precondition 4. |
| **Shared `<ProductCard>` extraction (P3.D)** | **Reversing my own earlier suggestion, on the evidence.** It is the highest-risk item in the programme with **zero** customer benefit, and the card changes that would justify it turn out to be a handful of lines repeated three times — cheaper and far safer than moving ~1,500 lines. The stepper and in-cart badge only apply to `/catalog` anyway (the other two screens have no cart). **Skip it.** Reconsider only if the three screens genuinely start to diverge. |
| **B5.1 account order cards** | 9 orders, average 4 lines. Near-zero value today. |
| **Filters in search mode, and on `/view` / `/prices` / `/collection`** | Those paths are RPC-only, so it means new arguments on `search_products`, `catalog_public`, `catalog_public_prices`, `catalog_collection` — **a database change, which precondition 5 excludes from 3B.** Planned as Phase 4, on its own, with its own review. |
| **Product descriptions, ratings, reviews** | **0 of 973 products have a description**, and there is no mechanism to collect the rest. |

---

## 4. What this order buys

If waves 1–4 ship and nothing else does, the customer already gets: search that respects
the category, a calmer card that leads with the price, the pack price visible on 375
products, a quantity stepper, an in-cart badge, a מבצעים button over the 88 products that
are already discounted, working category and price filters, and a filter sheet built for a
thumb.

**Everything that touches money, quantity, orders, Excel or the database is either frozen
or excluded.** The riskiest thing in the whole order is a stepper that calls
`resolveQuantity` — a function that already exists and already has 20 assertions behind it.

## 5. Status

Nothing has been executed. 3B is blocked on preconditions 1 and 2, and both are blocked on
the owner's four answers about Railway and Supabase.
