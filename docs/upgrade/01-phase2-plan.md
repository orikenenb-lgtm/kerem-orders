# 01 — Phase 2 Plan (backup · restore · staging · price-list closure)

**Status: PLAN ONLY. Nothing in this document has been executed.**
No staging project created · no image downloaded · no URL changed · no front-end code
touched · no schema, grant or row modified · no money committed.

Written 2026-09-03 against baseline `00-baseline.md` and gate `00b-safety-gate-1.5.md`.

---

## A. What blocks the start, and who unblocks it

| # | Input | Owner action | Why it gates everything |
|---|---|---|---|
| A1 | Railway status | check dashboard: is a `kerem-orders` service running, and what is `SYNC_ENABLED`? | decides whether a 4th service-role writer exists |
| A2 | Supabase plan | Free or Paid? | decides whether automatic backups / PITR exist at all |
| A3 | Free project slot | is a second free project available in the org? | decides staging option B vs A |
| A4 | Foreign tables | may we operate on this project despite `trades`/`wa_*`? | blast radius |
| A5 | Price list | confirmed **not public** (given 2026-09-03) | scope of §E |

### A1 decision tree — prepared in advance

| What you find | What it means | What I do |
|---|---|---|
| No service, or not deployed | dormant, as the evidence suggests | note it; leave `app/` untouched |
| Service running, `SYNC_ENABLED=false` | alive but not writing | note it; no urgency |
| Service running, `SYNC_ENABLED=true` | **4th writer with a service-role key** | **stop.** Raise to P0 and agree a shutdown or lock before any Phase 2 write |

---

## B. Staging plan — Supabase Free project #2 (NOT created)

### B1. Why a second free project, not a local stack
Recorded in gate 1.5: a local `supabase start` is excellent on your own machine but
impossible from this container (no Docker, ephemeral). A second Free project is genuinely
isolated — own database, own keys, own storage, own URL — and the workload fits: ~60 MB of
database plus ~194 MB of images against a 500 MB / 1 GB free allowance.

### B2. What staging must contain

| Component | Source | Note |
|---|---|---|
| Schema | `supabase db dump --schema-only` from prod | tables, functions, triggers, policies, grants, indexes |
| Data — Kerem tables | prod dump, **anonymised** | the 12 tables from the ownership map |
| Data — foreign tables | **excluded entirely** | `trades`, `setups`, `price_cache`, `news`, `secret_store`, `wa_*` |
| Auth users | synthetic only | 4 test accounts: manager, customer A, customer B, anonymous |
| Storage | empty at first | image backup lands here before prod |
| Edge functions | deployed copies | `rivhit-img`, `signup`, `image-thumbs`; `rivhit-sync` **disabled** |
| pg_cron | **none** | staging must never call Rivhit on a schedule |

### B3. Anonymisation — mandatory before any real data lands in staging
`profiles` (3 rows) and `customers` (553 rows) hold real names, phones, emails and VAT
numbers. Rule: **transform on the way in, never copy-then-clean.**

| Column | Becomes |
|---|---|
| `email` | `user<n>@staging.invalid` |
| `full_name`, `business_name` | `לקוח בדיקה <n>` / `עסק בדיקה <n>` |
| `phone` | `050-000-<nnnn>` (sequential, non-dialable range) |
| `vat_number` | sequential 9-digit synthetic |
| `city`, `street`, `house_number`, `zip_code`, `delivery_notes` | fixed placeholder |
| `rivhit_customer_id` | kept — it is an internal integer, not personal |

`orders` / `order_items` keep their **amounts and quantities** (they are the point of the
pricing tests) but attach to synthetic users.

### B4. Staging safety rails (all must be true before it is used)
- Banner on every page: **״סביבת בדיקה — לא אתר אמיתי״**
- `robots: noindex, nofollow` on every route
- `SYNC_ENABLED` absent; **no pg_cron jobs**; Rivhit reachable **read-only or not at all**
- No email provider configured — signup/reset cannot send to a real address
- Separate keys; the prod service-role key must never appear in staging config
- A written note in the project description: *staging, safe to wipe*

### B5. Cost
**₪0**, provided a free slot exists (A3). If not, the choice is a paid project (~$25/mo) or
local Docker. **No project will be created without your explicit word.**

---

## C. Database backup + restore proof (NOT executed)

### C1. Honest limitation
**I cannot take the database backup from here.** This container has no direct Postgres
connection and no egress to `*.supabase.co`; the MCP tools I hold can run SQL but cannot
produce a `pg_dump`. A `SELECT`-everything through SQL is not a backup — it captures no
schema, no policies, no grants, no functions.

**The dump is an owner action.** Two supported routes:

| Route | Command / place | Produces |
|---|---|---|
| Dashboard | Supabase → Database → Backups → Download | full logical backup |
| CLI (recommended) | `supabase db dump -f kerem-YYYYMMDD.sql --linked` | schema + data, reviewable text |

Also capture separately: `supabase db dump --schema-only`, and the roles/grants dump.

### C2. What must be recorded for the backup to count as *proven*
Per the supreme law — a Backup button is not a backup.

- exact UTC timestamp of the dump
- file size in bytes
- **SHA-256 checksum**
- where it is stored (must be **off** this repo and off the ephemeral container)
- who can access it
- retention period
- the exact restore command that was tested

### C3. Restore proof — into staging only, never over production
1. Restore the dump into the **staging** project (§B).
2. Run the count comparison below. **Every row must match the production baseline.**
3. Spot-check integrity, not just counts.

| Check | Production baseline (2026-09-03) |
|---|---|
| products total / active | 7,410 / ~973 (moves — see note) |
| profiles | 3 |
| customers | 553 |
| collections / collection_products | 5 / 247 |
| **orders / order_items / sum** | **9 / 36 / ₪43,245.00** |
| price_overrides | 1 |
| collection price overrides | 228 |
| policies / functions / triggers | 34 / 55 / 18 |

**Note on `products.active`:** it is a live mirror of Rivhit and legitimately moves between
readings (962 → 1,010 → 973 over two weeks). Compare **total rows (7,410)** and the
**active count at dump time**, never against a hard-coded number.

Integrity beyond counts:
- every `order_items.order_id` resolves to an `orders` row (0 orphans)
- `sum(orders.total)` matches to the agora
- all 34 policies present with identical definitions
- `set_price_override`, `catalog_collection`, `catalog_public_prices` definitions byte-identical
- the 12 Kerem tables present; the 8 foreign tables **absent by design**

### C4. Rollback
Restoring into staging cannot affect production — separate project, separate keys.
The only destructive act would be restoring **onto** production, which is **out of scope
for the entire programme** and would additionally roll back the foreign tables.

---

## D. Image backup plan — full detail (NOT executed)

### D1. Measured size (gate 1.5)
8 random products probed via the proxy's `meta=1` endpoint (metadata only, zero image
bytes): all 8 OK, **avg 204.3 KB**, range 102–260 KB.

| | |
|---|---|
| Images | **970** (3 active products have none) |
| Projected | **~194 MB**, band 97–247 MB |
| Free tier (1 GB) | fits, ~830 MB spare |

### D2. Where the job can actually run
**Not from this container** — egress to both `api.rivhit.co.il` and `*.supabase.co` is
blocked, proven in Phase 1.

| Option | Runs where | Pros | Cons |
|---|---|---|---|
| **D2-a. Edge Function** `image-backup` | Supabase network | has egress to Rivhit *and* Storage; no laptop needed; resumable across invocations | deploying it is a production change → needs approval |
| **D2-b. Node script** | your machine | zero new infrastructure; nothing deployed | needs your machine online for the run; needs the service key locally |

**Recommendation: D2-b first** (it deploys nothing), moving to D2-a only if you want it
scheduled monthly.

### D3. The plan, step by step
1. **Manifest before bytes.** For each of the 970: `product_id`, `rivhit_id`,
   `picture_link`, upstream byte size, `content-type`, `sha256(bytes)`.
   Written to `docs/upgrade/image-manifest.csv`. The hash is both the deduplication key
   and the integrity check — several products may share one Rivhit image.
2. **Originals only, content-addressed, immutable.**
   Path: `product-images/original/<sha256>.<ext>`.
   Identical bytes collapse to one object; a re-run can never overwrite a *different*
   image, because the name **is** the content. Rotation stays in
   `products.rotation_override` as presentation metadata — the original is never
   re-encoded, so any rotation decision remains reversible forever.
3. **Resumable and gentle.** Batches of 10, 8-second timeout per image, skip any hash
   already present. Safe to stop and resume. A failure is recorded in the manifest with
   its error — **never silently dropped**.
4. **Verification gate — backup is not "done" until:**
   - stored object count == manifest rows − recorded failures
   - a random **5 %** re-download re-hashes identical
   - total bytes within the 97–247 MB band (outside it ⇒ investigate, do not proceed)
5. **Ordering.** Land it in **staging storage first**, verify, then production storage.
6. **Ongoing.** Re-run monthly and after any large Rivhit change.

### D4. Risk and rollback
| | |
|---|---|
| Writes to | a bucket that holds **0 objects today** |
| Touches product rows | **no** |
| Changes any URL | **no** — the site keeps serving from Rivhit |
| Site behaviour change | **none** |
| Rollback | delete the bucket contents |

Re-pointing the site at the backup is a **separate, later, separately-approved** change
and is explicitly **not** part of this plan.

### D5. The risk this closes
Today we hold **no copy of any product image**. If Rivhit alters or removes one, it is gone
from the site with no recovery path — including the 34 rotations corrected by hand.

---

## E. Price list — closing it without breaking the site

**Given your instruction, the price list is treated as NOT public from now on.**

### E1. Exactly what is exposed today (measured, gate 1.5)
`catalog_public_prices` is `SECURITY DEFINER`, executable by `anon`, page-capped at 60 —
**but `offset` works**, so ~17 requests reach all 973 products. Per product it returns:

| Field | Exposed to anonymous? |
|---|---|
| name, category, image | yes |
| **price — including manager-set global overrides** | **yes** |
| **stock quantity** | **yes** |
| SKU | no |
| barcode | no |

So a competitor gets the full wholesale price list **and inventory depth**, with no account.

### E2. Blast radius of closing it — exactly one page
Verified by tracing every caller:

| Surface | RPC used | Effect if anon loses `catalog_public_prices` |
|---|---|---|
| `/prices` | `catalog_public_prices` | **breaks for anonymous** ← the only casualty |
| `/view` (public catalogue, no prices) | `catalog_public` | unaffected — stays public and indexed |
| `/collection/?k=…` (customer catalogues) | `catalog_collection` | unaffected |
| `/catalog` (logged-in) | `search_products` + direct table reads | unaffected |
| `/admin/*` | manager RPCs | unaffected |

`/prices` is **not linked anywhere in the app and not in the sitemap** — it is a
hand-shared, unlisted link. Nothing else depends on it.

### E3. Options

| # | Approach | Keeps "send a buyer a link"? | New code | Verdict |
|---|---|---|---|---|
| 1 | Revoke anon; require login on `/prices` | ❌ breaks link-sharing to non-customers | none | too blunt |
| 2 | **Move the price list into the existing collection mechanism** | ✅ yes — better | **none** | ✅ **recommended** |
| 3 | New token-gated price route | ✅ | new mechanism to build and secure | reinvents #2 |
| 4 | Tighten the page cap / rate-limit | — | small | **not a fix** — only slows enumeration |

### E4. Recommended: option 2 — reuse what already works
A "price list" is a collection containing every product with `show_prices = true`. That
machinery is already live, already tested, and already better than `/prices`:

- **unguessable 12-character slug** from the browser CSPRNG, not a public route
- **revocable** — one toggle kills a link that went to the wrong person
- **per-recipient** — a different link (and different prices) per chain
- **per-product custom pricing** already built and shipped
- **stock is not exposed** by `catalog_collection`

**Migration order — no window where a buyer is stranded:**
1. Create a collection "מחירון כללי" containing all active products, `show_prices = true`.
2. Send the new link to whoever currently uses `/prices`.
3. **Only then** revoke `EXECUTE ON catalog_public_prices FROM anon`.
4. Leave `/prices` in place, showing a short Hebrew message pointing at the new link —
   do **not** delete the route (dead links are worse than an explained page).

**Rollback:** a single `GRANT EXECUTE … TO anon` restores the old behaviour instantly.
Nothing is dropped, no data changes, the function itself is untouched.

**Risk:** low, and it is entirely *reversible*. The one real risk is a buyer holding the old
link — which step 2 exists to prevent, and step 4 catches anyone missed.

### E5. Separate, related finding (F1 from gate 1.5)
Any **logged-in customer** can read all 7,410 product rows, 6,437 of them inactive, via the
API. Closing `/prices` does not address this. Fix is a narrower RLS policy on `products`
(`is_active` only, for `authenticated`) — **but it must be verified against every screen
first**, because the admin screens legitimately read inactive rows. Deferred to Phase 3
with its own before/after test, not bundled here.

---

## F. Phase 2 execution order — with test and rollback per step

Each step lists the **risk to production**. Nothing runs until the gate above it passes.

| # | Action | Prod risk | How it is verified | Rollback |
|---|---|---|---|---|
| **P2.0** | Owner answers A1–A4 | **none** | answers recorded | n/a |
| **P2.1** | `git bundle` of the full repo + SHA-256, stored off-container | **none** — read-only | `git bundle verify`; clone from the bundle and diff against `origin/main` | delete the file |
| **P2.2** | Owner takes the DB dump (§C1) | **none** — read-only on prod | size + SHA-256 + timestamp recorded | delete the file |
| **P2.3** | Owner creates the staging project | **none** — separate project | project exists, keys issued | delete the project |
| **P2.4** | Restore dump → staging, anonymise | **none** — never touches prod | §C3 count + integrity comparison | wipe and re-restore |
| **P2.5** | Build the image manifest (metadata only) | **none** — `meta=1`, no bytes | 970 rows, 0 unresolved | delete the CSV |
| **P2.6** | Image backup → **staging** storage | **none** | §D3 step 4 gate | empty the bucket |
| **P2.7** | Image backup → **production** storage | **very low** — writes only new objects to an empty bucket; touches no row, no URL | object count + 5 % re-hash; site screenshot unchanged | empty the bucket |
| **P2.8** | Rollback rehearsal on staging | **none** | restore an older dump; counts match | n/a |
| **P2.9** | **GO/NO-GO gate** | — | all of the above green | — |

**P2.7 is the only step that writes to a production system, and it writes exclusively
*new* objects into a bucket that currently holds zero. It cannot alter a product, a price,
an order or an image the site is serving.** It will still not run without your word.

## G. What is explicitly NOT in Phase 2
- No front-end code change of any kind
- No schema change, no migration, no grant change (the `/prices` closure of §E is Phase 3)
- No Railway change; `app/` is not deleted, disabled or edited
- No image URL re-pointed; the site keeps serving from Rivhit
- No deploy to production
- No deletion of anything, anywhere

## H. Gate status after this plan

| Requirement | Status |
|---|---|
| Baseline tests | ✅ `00-baseline.md` |
| Branch/secret/RLS gate | ✅ `00b-safety-gate-1.5.md` |
| Backup **plan** | ✅ this document |
| Backup **taken** | ❌ needs P2.1–P2.2 |
| Restore **proven** | ❌ needs P2.4 |
| Staging **exists** | ❌ needs P2.3 |
| Owner inputs A1–A4 | ❌ outstanding |

**Phase 2 remains not started.**
