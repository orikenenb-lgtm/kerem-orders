# 00 — Baseline (Phase 1)

**Captured:** 2026-09-03 · **Mode:** read-only · **Production touched:** no · **Data changed:** no

This is the reference point. Every later phase compares against these numbers. Nothing
here was fixed, tuned, or "cleaned up" — the point is to record what is true today,
including what is already broken.

---

## 1. Environment

| Item | Value |
|---|---|
| Working dir / git root | `/home/user/kerem-orders` (identical — correct project) |
| Branch at capture | `fix/excel-file-robust` @ `6548118` (already squash-merged as `9f68f31`) |
| `origin/main` | `9f68f319795bce45d12c803dccb200267682d6a5` — "fix(excel): images locked inside their cells (#90)" |
| Working tree | **clean** — no uncommitted third-party changes to protect |
| Remote | `github.com/orikenenb-lgtm/kerem-orders` (**public**) |
| Tracked files | 287 |
| Node | v22.22.2 |
| npm | 10.9.7 (**sole** package manager — only `landing/package-lock.json`, no competitor lockfile) |
| Python | 3.11.15 |
| OS | Linux 6.18.44 x86_64 |

## 2. Deployment surface

| Workflow | Trigger | What it does |
|---|---|---|
| `ci.yml` | PR + push to `main` | lint · test · tsc · production build. **Does not deploy.** |
| `deploy-pages.yml` | push to `main` | builds `landing/` → GitHub Pages |
| `rivhit-hourly-sync.yml` | cron `17 * * * *` | invokes the `rivhit-sync` edge function |

- **Production:** GitHub Pages, `https://orikenenb-lgtm.github.io/kerem-orders/`
  (static export, `basePath=/kerem-orders`, `trailingSlash=true`, `images.unoptimized`)
- **Last known-good deploy:** run #122, `9f68f31`, success
- **Staging / preview environment: NONE.** There is no second environment of any kind.
- **Rollback today** = revert the commit on `main` and let deploy #123 run. There is no
  instant re-point-the-domain mechanism, because Pages serves whatever `main` last built.

### Second, undeployed application in this repo
`app/` is a complete FastAPI backend (auth, orders, products, admin, quotes, Rivhit sync,
notifications, a 4-hourly scheduler using a **service-role key**). Evidence it is dormant:

- last commit touching it: `e6a3738`, 2026-07-05 — **0 commits in 60 days**
- the frontend never references it (its only outbound hosts are Supabase, Rivhit,
  Cloudflare Turnstile, wa.me, github.io)
- the two tables it needs — `sync_logs`, `quotes` — **do not exist** in the database
- no workflow builds or deploys it
- `railway.toml` points at a `railway.json` and a `backend/` directory that do not exist

**Not proven:** whether a Railway service is running this image. Cannot be checked from
here. Open question #1 for the owner.

## 3. Baseline test results — run with **zero** code changes

| Gate | Command | Result |
|---|---|---|
| Frozen install | `npm ci` | ✅ pass (23s) |
| Lint | `npm run lint` | ✅ exit 0 — **0 errors, 33 warnings** (ratchet is set at 33) |
| Typecheck | `npx tsc --noEmit` | ✅ exit 0 |
| Unit tests (front) | `npm test` | ✅ **122 assertions / 7 suites** — quantity 20, searchRank 8, imageFallback 29, rivhit-img 32, signup 15, turnstile 8, pricing 10 |
| Production build | `npm run build` | ✅ 21 static pages |
| Backend tests | `pytest tests/` | ✅ **107 passed** (run in an isolated venv; `pytest` is not installed in the repo env) |
| `npm audit` | — | 2 **moderate**, 0 high, 0 critical (513 deps) |

**No pre-existing failures.** Any red in a later phase is a regression introduced by us.

### Gaps in the existing suite (facts, not fixes)
- **No E2E suite in the repo.** All browser testing so far has been ad-hoc scripts in a
  scratch directory, not committed, not run by CI.
- **No integration tests against a real database.** Front-end tests are pure units;
  backend tests use mocks.
- **No migration tests** — see §5.
- **No accessibility or visual-regression tests.**

## 4. Data baseline (production, read-only)

| Metric | Value |
|---|---|
| products — rows total | 7,410 |
| products — **active** | **973** |
| active with photo | 970 |
| active **without** photo | **3** |
| active without `barcode` | **973 (all of them)** |
| active without `sku` | 5 |
| active with **neither** barcode nor sku | **5** |
| active whose `sku` is not an 8–14 digit EAN | **7** |
| profiles (site accounts) | 3 (1 manager) |
| customers (Rivhit mirror) | 553 |
| collections | 5 |
| collection_products | 247 (**228** carry a per-collection price) |
| orders | 9 · order_items 36 · **sum ₪43,245.00** |
| price_overrides | 1 |
| Supabase storage objects | **0** |

### The 962 / 973 / 1,010 question — answered
Not a bookkeeping inconsistency. **All 973 active rows share one `updated_at`
(2026-09-03 11:45)** — the timestamp of the last sync. The sync rewrites every sellable
item and deactivates everything it did not touch, so `is_active` is a live mirror of what
Rivhit returned *that minute*. 962 (Aug 20), 1,010 (Aug 30) and 973 (Sep 3) are three
readings of a moving number, days apart. Nothing is wrong; the number is simply not a
constant and must never be hard-coded in a test.

### Barcode reality
`products.barcode` is empty for **100%** of active products. The EAN lives in `sku`
(the sync fills `sku` from `item_part_num` falling back to `barcode`). The Excel export's
`barcode || sku` fallback is therefore correct — but it leaves **5 products with an empty
barcode cell** and **7 exporting a value that is not an EAN**. Both are P1 candidates.

### Images
**Supabase storage holds 0 objects.** Every product image is hot-linked from Rivhit
(`api.rivhit.co.il/.../getItemPic/…`) and reshaped on the fly by the `rivhit-img` edge
function. Consequence for Phase 2: *there is nothing of ours to back up*, and equally,
**we hold no copy** — if Rivhit changes or removes an image, it is gone from the site with
no recovery path. Rotation corrections (`products.rotation_override`) are ours and are
covered by a database backup; the pixels are not.

## 5. Database structure

| Object | Count |
|---|---|
| Tables | 20 (**all 20 have RLS enabled** — zero exceptions) |
| Views | **0** — so no view can bypass RLS |
| Functions | 55 (**21 SECURITY DEFINER**) |
| Triggers | 18 |
| RLS policies | 34 |
| Indexes | 50 · Extensions | 9 |
| pg_cron jobs | 2 — `rivhit-products-15m` (`*/15 * * * *`), `rivhit-daily-sync` (`7 3 * * *`) |

### No migrations directory
There is **no `supabase/migrations/`**. Every schema change — including all of this
session's — was applied straight to production, with hand-written mirror files in
`supabase/*.sql` (`collections.sql`, `price-overrides.sql`, `discontinued-products.sql`,
`security-hardening.sql`, `discount-setup.sql`). There is no ordering, no numbering, and
no way to rebuild this schema from scratch. The prompt's requirement of *numbered,
replayable, restore-tested migrations* cannot be met until this is built. **P1.**

### Sync health
4,087 runs recorded · 4 errors ever · **0 errors in the last 7 days** · last run
2026-09-03 11:45 `done`, 974 products. 5 rows stuck at `running` from an earlier
concurrent-build incident (cosmetic, no effect).

**Known writers to this database:** pg_cron ×2 → edge function; GitHub Actions hourly →
edge function; admin "עדכן עכשיו" button → edge function. A **fourth** writer (the Python
scheduler, service-role, every 4h) exists in code — dormant unless Railway is running it.

### The database is shared with an unrelated application
8 of the 20 tables are referenced **nowhere** in this repository: `trades` (29 cols),
`setups`, `price_cache`, `news`, `secret_store`, `wa_contacts`, `wa_messages`,
`wa_settings`. They look like a trading/WhatsApp system living in the same Supabase
project. Two consequences:

1. **Blast radius** — a destructive statement here can damage a system outside this project.
2. **Restore is not unilateral** — a project-level restore rolls that system back too.
   This directly constrains the Phase 2 restore proof.

(`image_sheets` and `image_audit` are ours — they belong to the image-review tooling.)

### Security advisors — baseline (0 ERROR-level)
| Level | Finding |
|---|---|
| WARN | `catalog_public_prices` is executable by **anon** — the known open question about the private price list |
| WARN | `catalog_public`, `catalog_public_categories`, `catalog_collection`, `is_manager`, `order_rules_enabled` also anon-executable (by design — they are the public read surface) |
| WARN | **Leaked-password protection is disabled** in Supabase Auth |
| WARN | `pg_trgm` installed in the `public` schema |
| INFO | RLS on with no policies: `image_sheets`, `secret_store`, `wa_contacts`, `wa_messages`, `wa_settings` (deny-all — safe, and 4 of 5 are the other app's) |

## 6. Performance baseline

Measured against the **local production build** with a mocked API.
**Limitation, stated plainly:** production is unreachable from this container (egress to
`github.io` and `*.supabase.co` is blocked), so these are render timings for the shipped
bundle, **not** real-world network timings. Real Core Web Vitals still need to be measured
from a real client — carried forward to Phase 4 / G9.

| Viewport | Page | load ms | FCP ms | KB | requests | h-overflow | console errors |
|---|---|---|---|---|---|---|---|
| mobile 390 | landing | 591 | 576 | 917 | 34 | 0 | 0 |
| mobile 390 | login | 174 | 112 | 1121 | 62 | 0 | 0 |
| mobile 390 | catalog | 188 | 80 | 1026 | 58 | 0 | 0 |
| mobile 390 | admin | 131 | 84 | 968 | 40 | 0 | 0 |
| mobile 390 | admin/collections | 109 | 164 | 1010 | 38 | 0 | 0 |
| mobile 390 | admin/images-review | 124 | 76 | 992 | 43 | 0 | 0 |
| desktop 1440 | landing | 117 | 92 | 917 | 34 | 0 | 0 |
| desktop 1440 | login | 125 | 144 | 1125 | 68 | 0 | 0 |
| desktop 1440 | catalog | 127 | 84 | 1028 | 60 | 0 | 0 |
| desktop 1440 | admin | 120 | 80 | 971 | 44 | 0 | 0 |
| desktop 1440 | admin/collections | 112 | 184 | 1079 | 50 | 0 | 0 |
| desktop 1440 | admin/images-review | 128 | 84 | 991 | 41 | 0 | 0 |

**Zero horizontal overflow and zero console errors on every page at both widths.**

Build artifact: `out/` = 17 MB · JS chunks 2.3 MB · largest chunk **911 KB** (exceljs,
correctly split — loads only when the export button is pressed). ~1 MB transferred per
page is the standing figure to improve in G9.

Screenshots of all six screens at 390 px are held in the session scratch directory; they
are not committed (they are mock-data renders, not production evidence).

## 7. Open risks carried into Phase 2

| # | Risk | Why it blocks |
|---|---|---|
| R1 | Railway/Python service status unknown | possible 4th service-role writer |
| R2 | Database shared with a foreign application | restore + blast radius |
| R3 | No migrations directory | no replayable, restore-tested schema |
| R4 | `.env` absent from `.gitignore` on a **public** repo | one `git add -A` from leaking the Rivhit token and service-role key |
| R5 | No staging environment exists | the supreme law forbids changes without one |
| R6 | Backup/restore never proven | same |
| R7 | Product images exist only on Rivhit's servers | unrecoverable if Rivhit drops one |

## 8. Gate status

| Supreme-law requirement | Status |
|---|---|
| Full, valid backup | ❌ not proven |
| Tested restore | ❌ not attempted |
| Separate test environment | ❌ does not exist |
| Rollback point to last working version | ⚠️ partial — revert-and-redeploy only |
| Baseline tests documenting current behaviour | ✅ **this document** |
| Ability to disable any new feature | ⚠️ flags exist (`landing/lib/featureFlags.ts`) but are build-time constants |
| Explicit owner approval before production | ✅ honoured — nothing changed |

**Phase 2 cannot start until R1–R6 are resolved. Stopping here as instructed.**
