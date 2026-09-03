# 06 — Staging Built & Verified

**Status: DONE. A working staging environment now exists.** No production data, schema,
image, env or deployment was changed to build it. Production was read-only throughout.

Built 2026-09-03. This closes the two hard preconditions (R5 staging, R6 backup) that had
blocked every earlier phase.

---

## What now exists

| Item | Value |
|---|---|
| Staging project | `kerem-staging` (`ahptrtlnrpmevlpgqeac`), Supabase **Pro**, region **ap-southeast-2** (same as prod) |
| Staging API URL | `https://ahptrtlnrpmevlpgqeac.supabase.co` |
| Cost | ~$10/month while it runs; **delete or pause when Phase 3/3B is finished** and it stops |
| Production DB backup | `kerem-20260903.sql`, **45,561,965 bytes**, 74 structure defs + full product data, held **off-Git** on the owner's machine (`C:\Backups\kerem-db`) |

The publishable (anon) key for staging is the normal client key — it is designed to ship in
the browser and is **not** a secret; it is not recorded here and never goes in the repo. The
front end points at staging by swapping the two `NEXT_PUBLIC_SUPABASE_*` values in a local
`.env` (never committed).

---

## How staging was built — and why each choice was safe

### Backup (owner-run, the one step this container cannot do)
`pg_dump` of production `public` schema via the **Session pooler** (IPv4), plain SQL.
Verified: 978-line product COPY block present, 74 `CREATE TABLE/FUNCTION/POLICY` defs.
Production was only ever **read**.

### Schema — replicated exactly from production (read-only introspection)
- **12 of our tables** rebuilt from live column/PK/FK/check metadata — the 8 foreign tables
  (`trades`, `wa_*`, `news`, `price_cache`, `setups`, `secret_store`) were **excluded**.
- **21 functions** (all the catalog RPCs, `is_manager`, `validate_order_item`, the order
  triggers, price logic) copied verbatim via `pg_get_functiondef`. Only `_audit_images_batch`
  was skipped — it calls the prod image edge-function over HTTP, irrelevant to tests.
- **9 triggers, 21 RLS policies, 13 indexes** copied verbatim.
- One deliberate deviation, documented: the cross-schema FKs to `auth.users` on
  `profiles.id` / `orders.user_id` were dropped so synthetic test users can be inserted.

### Data — moved server-side, byte-exact, never couriered through the model
Rather than copy 978 rows through the chat (slow, error-prone), a temporary **`postgres_fdw`**
link was opened from staging to production, the rows were transferred **inside the database**,
and the link (with its credentials) was **dropped immediately after**. Nothing persisted the
password — the FDW setup ran through `execute_sql`, not a migration, so it is not in staging's
migration history, and `pg_foreign_server` / `pg_user_mappings` are both back to **0**.

| Table | Rows in staging | Note |
|---|---|---|
| products | **978** (973 active, 24 categories) | the active set + every product referenced by a collection or override |
| collections | 5 | byte-exact |
| collection_products | 247 | byte-exact |
| price_overrides | 1 | `updated_by` remapped to the synthetic manager |
| customers | 553 | **ANONYMISED on the way in** — names to `לקוח בדיקה N`, phones to `050-000-NNNN`, emails to `@staging.invalid`, VAT synthetic. No real customer PII ever entered staging. |
| profiles | 3 synthetic | `manager@staging.invalid`, `customerA/B@staging.invalid` — no real profile copied |
| orders / order_items | 0 | intentionally empty — the 9 real orders carry contact PII; tests create their own |

**Integrity proof:** an MD5 over `id|name|price|sku|category|is_active|display_qty|sell_by`
of all 978 products was **identical** on both sides —
`631238513334f75a880eed6ab98cf1e0`. The transfer is provably exact, not approximately right.

### Safety rails on staging
- No `pg_cron`, no Rivhit connection, no edge functions, no email provider — nothing can
  fire at a real customer or call Rivhit.
- `enforce_order_rules = on`, `min_order_total = 3500` — same order rules as prod, so the
  order/price tests exercise the real behaviour.
- RLS verified behaviourally: as `anon`, a direct `select` on `products` returns **0 rows**
  (same as prod); the public catalog RPCs still work.

### Functional smoke test (all green on staging)
`catalog_public` → 973 total · `catalog_public_prices` → works · `search_products('רובוט')`
→ 24 hits · `catalog_categories` → 24 · `catalog_collection('cc31ebt9b12v')` → 24 items,
prices shown. The site's real data surface works end-to-end against staging.

---

## Two things still owed (not blocking Phase 3 start)

1. **Reset the production DB password.** It was shown on screen during the backup and is no
   longer private. The site does **not** use it (the site uses API keys), so resetting is
   safe and breaks nothing. Owner action, Supabase → Database → Reset database password.
2. **Second copy of the backup.** `kerem-20260903.sql` holds all 553 real customers — copy
   it to a private drive so it does not live only on one machine.

## Gate status

| Supreme-law requirement | Status |
|---|---|
| Full, valid backup | done — taken & verified (45 MB) |
| Tested restore | done — staging is a working restore of prod's schema+data |
| Separate staging environment | done — `kerem-staging` exists |
| Rollback point | done — backup + staging both exist |

**R5 and R6 are cleared. Phase 3 (the front-end test suite) is now unblocked.**
