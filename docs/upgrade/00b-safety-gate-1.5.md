# 00b — Safety Gate 1.5

**Run:** 2026-09-03 · **Mode:** read-only · **Production / DB / migrations / Railway / images / env / deploy config: untouched**

No merge, no rebase, no history rewrite. Every database probe below ran inside
`begin … rollback` and used `SELECT` only.

---

## 1–4. Branch provenance and PR 91 hygiene

| Question | Answer |
|---|---|
| Branch created from | `9f68f31` — **exactly `origin/main`** ("fix(excel) … (#90)") |
| Commits ahead of main | 2 — `4a6e85d` (baseline doc), `1fc7fd3` (.gitignore) |
| Commits behind main | 0 |
| PR 91 base | **`main` @ `9f68f31`** ✅ · head `1fc7fd3` · draft · `mergeable_state: clean` |
| PR 91 contents | `.gitignore` (M) + `docs/upgrade/00-baseline.md` (A) — **242 insertions, 0 deletions** |
| CI on the branch | run #88 — **passed** |

### Can the Excel work leak into PR 91? **No.**

Two independent proofs:

1. `fix/excel-file-robust` is **not an ancestor** of the upgrade branch — its commit
   object `6548118` is absent from the branch's history.
2. `git diff fix/excel-file-robust origin/main` → **identical trees**. That work is
   already fully in `main` (squash-merged as #90), so there is nothing left in it to
   merge anywhere.

The one dangling commit object `6548118` is the *pre-squash* copy of #90. It is inert:
not on `main`, not on the upgrade branch, referenced only by the stale local branch.

**Nothing needs separating. Item 6 has no work to do.** If the branch is ever wanted
gone, the safe form is `git branch -d fix/excel-file-robust` (lower-case `-d` refuses
unless the content is already merged — it is) — **not performed**, and not needed.

## 16. Commit contents verified

```
4a6e85d  docs/upgrade/00-baseline.md | 225 +++++++   (1 file, 225 insertions)
1fc7fd3  .gitignore                  |  17 +++++++   (1 file,  17 insertions)
```

Filtering the branch diff for anything that is **not** those two paths returns nothing.
Total deleted lines across the branch: **0**. No `__pycache__`, no temp files, no code.

## 7–8. Secret scan of the shipped build — **CLEAN, not P0**

134 text files (3.1 MB) of `landing/out` scanned. The 134 skipped files are binary media
only (120 `.jpg`, 9 `.woff2`, 3 `.png`, 1 `.mp4`, 1 sitemap `.xml`). **No secret value is
reproduced anywhere in this document.**

| Pattern | Result |
|---|---|
| Supabase **secret** key (`sb_secret_`) | clean |
| Supabase **publishable** key (`sb_publishable_`) | 2 `.js` files — **expected and by design**; RLS enforces access server-side |
| JWTs of any kind (decoded and role-claim inspected) | **none present at all** |
| Cloudflare Turnstile **secret** (`0x4AAAAAAA…`) | clean |
| `SUPABASE_SERVICE_ROLE_KEY` / `RIVHIT_API_TOKEN` / `TURNSTILE_SECRET` (even as names) | clean |
| AWS keys · private-key blocks · GitHub tokens · `api_token=` | clean |
| Source maps in the build | **0** — source not exposed |

Supporting evidence:
- The deploy workflow injects exactly one variable, `TURNSTILE_SITE_KEY`, and takes it
  from `vars.` (not `secrets.`) — correct, a *site* key is public by definition.
- Client code reads **only** `NEXT_PUBLIC_*` (`BASE_PATH`, `SUPABASE_ANON_KEY`,
  `SUPABASE_URL`, `TURNSTILE_SITE_KEY`). A grep for any non-`NEXT_PUBLIC` `process.env.*`
  in `app/` and `lib/` returns nothing.

**Verdict: no credential reaches the browser. No P0 raised.**

## 9. Table ownership map — 12 Kerem Toys / 8 foreign

Classified by foreign-key linkage and repository references, not by name.

### Kerem Toys — 12 (do back up, do include in a future baseline migration)

| Table | Rows | Size | Proof of ownership |
|---|---|---|---|
| `products` | 7,410 | 14 MB | hub — referenced by 4 tables |
| `profiles` | 3 | 32 kB | → `auth.users`; referenced by `price_overrides` |
| `orders` | 9 | 64 kB | → `auth.users`; parent of `order_items` |
| `order_items` | 36 | 48 kB | → `orders`, `products` |
| `collections` | 5 | 48 kB | parent of `collection_products` |
| `collection_products` | 247 | 136 kB | → `collections`, `products` |
| `price_overrides` | 1 | 80 kB | → `products`, `profiles` ×2 |
| `customers` | 553 | 280 kB | Rivhit mirror, written by the sync |
| `rivhit_sync_runs` | 4,088 | 2.7 MB | written by the sync edge function |
| `site_settings` | 2 | 32 kB | read by `SiteHeader` / `getMinOrderTotal` |
| `image_audit` | 942 | 384 kB | **FK → `products`** |
| `image_sheets` | 234 | **42 MB** | image-review tooling (edge function `image-thumbs`) |

### Foreign — 8 (**do not touch, do not include in any migration**)

| Table | Rows | Policies | FK to any Kerem table |
|---|---|---|---|
| `trades` | **0** | 4 | none (→ `auth.users` only) |
| `setups` | **0** | 1 | none (→ `auth.users` only) |
| `price_cache` | **0** | 1 | none |
| `news` | **0** | 2 | none |
| `wa_contacts` | **0** | 0 | none |
| `wa_messages` | **0** | 0 | none |
| `wa_settings` | 1 | 0 | none |
| `secret_store` | 2 | 0 | none — and `anon` is denied at GRANT level |

**Correction to the Phase 1 risk note.** I framed R2 as an unrelated *live* system sharing
the database. The evidence is narrower: **seven of the eight hold zero rows**, and the
whole foreign set holds **3 rows in total**. This is dormant scaffolding, not a running
business. The blast-radius warning still stands for any destructive statement, and a
project-level restore still touches them — but the earlier framing overstated it.

## 10. Baseline migration scope — pre-registered

When a baseline migration is eventually authored (**not now, not without approval**) it
must cover **only the 12 tables above**, and must exclude `trades`, `setups`,
`price_cache`, `news`, `secret_store`, `wa_contacts`, `wa_messages`, `wa_settings`.

## 15. RLS proven by behaviour, not by flag

Four actors, impersonated in rolled-back transactions. Counts are rows actually visible.

| Table | anon | Customer A | Customer B | Manager |
|---|---|---|---|---|
| `profiles` | 0 | 1 (own) | 1 (own) | 3 |
| — *other people's* profiles | — | **0** ✅ | **0** ✅ | 3 (intended) |
| `orders` | 0 | 4 (own) | 3 (own) | 9 |
| — *other people's* orders | — | **0** ✅ | **0** ✅ | 9 (intended) |
| `order_items` | 0 | 17 | 13 | 36 |
| — orphaned/leaked items | — | — | **0** ✅ | — |
| `customers` (Rivhit) | 0 | **0** ✅ | — | 553 |
| `collections` | 0 | **0** ✅ | **0** ✅ | 5 |
| `collection_products` | 0 | — | — | 247 |
| `price_overrides` | 0 | 1 (global only) | — | 1 |
| `site_settings` | 1 (intended) | — | — | 2 |
| `secret_store` | **denied at GRANT** ✅ | — | — | — |
| `is_manager()` | — | — | — | `true` ✅ |

A + B see 4 + 3 orders and 17 + 13 items out of 9 / 36 — the remainder belongs to the
third account. **No cross-customer visibility anywhere.** Anonymous direct table access is
completely closed; the public catalogue works only through the SECURITY DEFINER RPCs,
exactly as designed.

### Two real findings from this probe

**F1 — every logged-in customer can read all 7,410 product rows, 6,437 of them inactive.**
`SELECT count(*) FROM products` as Customer B returns 7,410. The site's UI filters
`is_active`, but the RLS policy does not. Consequences: the "נגמרים / לא פעילים disappear
from the system" guarantee holds for the **website**, not for the **API** — a customer
account can enumerate discontinued products with their names, prices and stock. Severity
**P2** (commercial information disclosure; not money, not cross-customer privacy).

**F2 — the whole price list is anonymously enumerable.** `catalog_public_prices` caps a
page at 60 rows, but `offset` works: four probes at offsets 0/60/600/900 returned
**240 distinct products**. ~17 requests reach all 973. This is the open business question
made concrete, with numbers. Severity **P1** if the price list is meant to be private —
**by design and harmless** if the public `/prices` page is intended. **Owner's call.**

## 11. Is the FastAPI backend receiving traffic?

### Against (dormant) — six independent signals
1. Its two required tables, `sync_logs` and `quotes`, **do not exist** in the database.
2. Untouched for 60 days (last commit `e6a3738`, 2026-07-05).
3. No workflow builds or deploys it; `railway.toml` points at a `railway.json` and a
   `backend/` directory that do not exist in the repo.
4. The frontend never calls it — its only outbound hosts are Supabase, Rivhit,
   Cloudflare Turnstile, `wa.me` and `github.io`.
5. Live connections to the database are **all Supabase-internal**:
   `mgmt-api | pg_cron scheduler | pg_net | postgres_exporter | PostgREST`.
6. All 973 active products share **one** `updated_at`, matching the edge sync to the
   sub-second (12:00:03.533 vs 12:00:03.495). A 4-hourly external writer leaves no trace.

### Not conclusive — stated honestly
- `supabase-py` speaks through **PostgREST**, so its traffic is indistinguishable from the
  frontend's in the connection list. 163 PostgREST requests in 24 h leaves room for it.
- This project's `edge_logs` carry an **empty `user_agent`** field, so the client cannot be
  identified from logs.

**Conclusion: dormant on the balance of evidence; not proven.** The decisive check is the
Railway dashboard (service running? `SYNC_ENABLED`?). **Nothing was deleted.**

## 12–13. Staging options

| Option | Cost | Isolation | Fidelity | Verdict |
|---|---|---|---|---|
| **A. Local Supabase** (`supabase start`, Docker) | **₪0** | total — own Postgres/storage/auth on the machine | high: same Postgres + RLS + edge runtime. No public URL; pg_cron/Vault differ | ⚠️ can't run here — this container has no Docker and is ephemeral. Excellent on the owner's own machine. |
| **B. Second Supabase Free project** | **₪0** (2 free projects per org; needs a slot) | total — separate DB, keys, storage, URL | highest — identical managed platform | ✅ **recommended** |
| **C. Paid project** (~$25/mo) | pays | total | highest + PITR + branching | only if a free slot is unavailable or PITR is wanted |

**Recommendation: B**, falling back to A. It is free, it is a genuine separate environment
satisfying the supreme law, and at ~200 MB of images plus a ~60 MB database it fits the
free tier with room to spare. **No project created. No money committed.**

Note for B: the seeded data must be **anonymised** — 3 profiles and 553 Rivhit customers
carry real names, phones, emails and VAT numbers.

## 14. Image backup plan — measured, not estimated

Sampled 8 random active products through the proxy's `meta=1` endpoint (metadata only, no
image bytes transferred): **8/8 OK, average 204.3 KB, range 102–260 KB.**

| Metric | Value |
|---|---|
| Images to back up | **970** (3 active products have none) |
| Projected total | **~194 MB** (band 97–247 MB) |
| Fits Supabase Free (1 GB)? | yes — ~830 MB spare |

### Plan (not executed)
1. **Manifest first, bytes second.** For each of the 970: `product_id`, `rivhit_id`,
   `picture_link`, upstream byte size, `content-type`, and a **SHA-256 of the bytes** →
   `docs/upgrade/image-manifest.csv`. The hash is the deduplication key and the integrity
   check; several products may share one Rivhit image.
2. **Originals only, immutable.** Store the untouched upstream bytes at
   `product-images/original/<sha256>.<ext>`, content-addressed. Identical bytes collapse
   to one object automatically; a re-run can never overwrite a different image.
   `rotation_override` stays in the database as presentation metadata — the original is
   never re-encoded, so a wrong rotation is always reversible.
3. **Resumable, rate-limited.** Batches of 10 with the existing 8-second timeout, skipping
   any hash already stored. Safe to stop and resume; a failed image is recorded in the
   manifest with its error and never silently dropped.
4. **Verification gate.** Backup is "proven" only when: object count == manifest rows
   minus recorded failures, and a random 5 % re-hash matches. Anything less is not a backup.
5. **Rollback.** The job only ever *writes new objects* to a bucket that is empty today
   (`storage.objects = 0`) — it changes no product row and no site behaviour. Undo is
   deleting the bucket contents. **The site keeps serving from Rivhit; nothing is
   re-pointed at the backup without a separate, approved change.**
6. **Ongoing.** Re-run monthly, or after any large Rivhit change, to capture new products.

Risk this closes: today **we hold no copy of any product image**. If Rivhit alters or drops
one, it is gone from the site with no recovery path.

## Gate verdict

| Check | Result |
|---|---|
| PR 91 based on the right branch | ✅ `main` @ `9f68f31` |
| Risk of mixing in the Excel work | ✅ **none** — proven twice |
| Secret in the public build | ✅ **none found** — no P0 |
| Table ownership mapped | ✅ 12 Kerem / 8 foreign (7 of them empty) |
| Backend traffic evidence | ⚠️ dormant on 6 signals; **not proven** — needs Railway |
| Staging recommendation | ✅ Option B, free, not created |
| Image backup plan | ✅ measured (~194 MB), not executed |
| Commits contain only what was declared | ✅ 2 files, 242 insertions, 0 deletions |
| **Safe to proceed to Phase 2?** | ❌ **not yet** — backup, tested restore and staging still do not exist |
