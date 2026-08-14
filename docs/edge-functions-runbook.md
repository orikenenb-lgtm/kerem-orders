# Edge Functions — export, deployment and rollback runbook

Status: **Steps 0–1 were EXECUTED on 2026-08-14** (owner login + read-only
export). Steps 2–5 (deployment) remain owner-gated and NOT executed.

- The byte-exact deployed sources are vendored in
  `supabase/functions-deployed/` (see its README for versions + hashes) and
  archived privately outside Git
  (`Documents\kerem-orders-deployed-functions-BACKUP-2026-08-14.zip`).
- Secret scan of the export: **zero embedded literals** — all credentials
  are runtime `Deno.env.get(...)` or Vault RPCs, so the committed copy is
  identical to production (nothing sanitized).
- The export revealed **11 ACTIVE functions**, not 5: additionally
  `image-audit`, `image-thumbs`, and four retired `rivhit-probe-*` stubs
  (each answers `410 gone`).
- Deployed `rivhit-img` is **v11**,
  `ezbr_sha256 d0752de68da33770435afc477c13cb582499608dba47657b0abdbbd24522c4ba`.

Project ref: `mcdchalyzeqjkkgfeznd`. The hardened replacement under
`supabase/functions/rivhit-img/` remains a PROPOSED implementation.

---

## Step 0 — one-time owner authentication (blocker for everything below)

```bash
npx supabase login          # opens a browser; owner account only
npx supabase link --project-ref mcdchalyzeqjkkgfeznd
```

No step below works without this. Never paste an access token into a chat,
script or commit; `supabase login` stores it locally.

## Step 1 — export the CURRENTLY DEPLOYED sources (the rollback artifact)

```bash
set -euo pipefail   # fail-fast: a partial export is NOT a rollback artifact
for f in rivhit-img rivhit-sync rivhit-push signup detect-orientation; do
  npx supabase functions download "$f"
  test -d "supabase/functions/$f"   # verify each export actually landed
done
```

Then, before committing:

1. **First archive the EXACT export untouched, outside Git** (e.g. a
   password-protected zip in the owner's private storage). This byte-exact
   copy — not the sanitized one — is what a rollback redeploys, and it
   preserves any embedded literals the deployed code actually relies on.
2. Search every downloaded file for embedded secrets (keys, tokens,
   passwords, connection strings). Replace any literal with
   `Deno.env.get("NAME")` and record in the commit message that the committed
   copy is sanitized. **List every replaced NAME here and provision it with
   `npx supabase secrets set` BEFORE any redeploy of the sanitized copy** —
   otherwise rollback restores code whose env vars were never provisioned.
3. Commit the sanitized copy to a branch as `deployed-source snapshot <date>`.
   Keep the proposed implementation in a separate directory or commit until
   cut-over is decided.
4. Record the deployed `rivhit-img` version:
   `npx supabase functions list` (note the version/updated-at for rollback).

**Hard rule: no deployment before this snapshot exists.** Without it there is
no exact way back.

## Step 2 — pre-deployment gates (all must be green)

- Branch: `fix/edge-functions-source-and-image-hardening` (or its merge into
  main), exact commit recorded.
- `git status` clean; CI green; `(cd landing && npm test)` green — the test
  suite lives in `landing/`, there is no root `package.json` (includes the
  proxy-lib tests and fallback tests).
- Local serve check of the function:
  `npx supabase functions serve rivhit-img` and probe:
  - `?u=<real getItemPic URL>&w=480&v=2` → 200 `image/jpeg`,
    `Cache-Control: public, max-age=2592000, immutable`
  - same with `&rot=90` → 200, visually rotated **clockwise**
  - `?u=https://example.com/` → 400
  - `?u=<http:// variant>` → 400
  - missing `u` → 400
  - `&meta=1` → 200 JSON `{"size":…,"orientation":…}`, `no-store`
- Env vars required: **none** (the allowlist is compiled in). If the exported
  deployed source used env vars, list their NAMES here (never values).

## Step 3 — deploy (only `rivhit-img`, nothing else)

```bash
npx supabase functions deploy rivhit-img --project-ref mcdchalyzeqjkkgfeznd
```

Do **not** deploy any other function in the same operation.

## Step 4 — post-deploy smoke test (small sample BEFORE the full catalog)

```bash
# 1. a known-good cached product (must stay 200 image/jpeg). Use GET — the
#    function only accepts GET and answers HEAD with 405, so `curl -I` cannot
#    validate anything:
curl -s -o /dev/null --max-time 20 \
  -w "status=%{http_code} type=%{content_type} bytes=%{size_download}\n" \
  "https://mcdchalyzeqjkkgfeznd.supabase.co/functions/v1/rivhit-img?u=<enc>&w=480&v=2"
# expect: status=200 type=image/jpeg bytes>0
# 2. a rot=90 product — compare orientation with the pre-deploy screenshot;
#    if it rotated the WRONG way, rollback immediately. (Low risk since
#    2026-08-14: the proposed pipeline now mirrors the vendored deployed v11
#    — same imagescript@1.3.0 rotate() call, same EXIF mapping — so this is
#    a sanity check, not an open question.)
# 3. an invalid u — expect 400 within ~100ms.
# 4. run the read-only sweep on a 60-product sample:
SUPABASE_KEY=<anon publishable key> node scripts/diagnose-images.mjs --limit 60
```

Only if the sample is clean, run the full-catalog sweep and compare against
the **latest** baseline in `docs/image-pipeline-findings.md` §7 — the
2026-08-13 evening rerun: **1 proxy failure / 980** (the earlier 8/980 was a
cold-cache morning run; gating on it would approve a regression). Two
separate gates, both required:

- **Success gate:** proxy failures ≤ 1/980. A `resource_limit` JSON response
  **counts as a failure** for this gate — structured errors are nicer than
  raw 546 bodies, but the image still did not load.
- **Error-format gate:** any failures that do occur must be sanitized JSON
  `{error,reason}` (no raw 546 HTML/empty bodies, no stacks, no URLs).

## Step 5 — rollback (exact)

```bash
# The snapshot from Step 1 is the previous version:
git checkout <snapshot-commit> -- supabase/functions/rivhit-img
npx supabase functions deploy rivhit-img --project-ref mcdchalyzeqjkkgfeznd
# verify with the same Step 4 smoke tests
```

Roll back **immediately** if any of these appear after deployment:

- broad catalog image failures (placeholders across whole pages)
- valid Rivhit sources rejected with 400
- error rate or `WORKER_RESOURCE_LIMIT`-class failures INCREASE
- p95 latency rises significantly vs. the pre-deploy sweep
- the function returns HTML, stack traces or anything resembling a secret
- rot=90 images render rotated the wrong way
- any authentication/order flow breakage traced to the function

## Monitoring after deploy

- Supabase dashboard → Edge Functions → rivhit-img logs: the new structured
  JSON lines (`{"evt":"rivhit-img","outcome":…,"stage":…}`) make error
  categories greppable; watch `resource_limit` and `decode_failure` counts.
- Re-run `scripts/diagnose-images.mjs` after 24h; compare buckets.

---

## Proposed RLS migration (also NOT applied)

`supabase/proposed-migrations/2026-08-13_products_manager_update_policy.sql`
adds an explicit manager-only UPDATE policy on `products`. The live policies
could NOT be verified with the anon key (`pg_policies` is not exposed and no
write test was performed); the repo snapshot `backups/schema-before.sql:108`
shows `products_manager_all FOR ALL USING (is_manager())`, which already
covers UPDATE if it matches production. Apply the proposed migration only
after confirming the live state with owner credentials — including whether
RLS is actually **enabled and enforced** on the table, which roles each
policy binds to, and what `is_manager()` really does in production:

```sql
-- 1. Is RLS enabled/forced on products at all? (policies are meaningless
--    while relrowsecurity is false)
select relname, relrowsecurity, relforcerowsecurity
from pg_class where oid = 'public.products'::regclass;

-- 2. Every policy, including roles and permissiveness — PostgreSQL ORs all
--    applicable permissive policies together, so ANY extra permissive
--    UPDATE/ALL policy for non-managers defeats the manager-only intent:
select policyname, cmd, roles, permissive, qual, with_check
from pg_policies where schemaname='public' and tablename='products';

-- 3. The deployed definition of the function every policy leans on:
select pg_get_functiondef('public.is_manager()'::regprocedure);
```

Before applying in production, replay the migration in a safe environment
(local `supabase start` or a branch database) and test both directions:
a manager `UPDATE` must succeed, an anon/ordinary-customer `UPDATE` must
fail. Never test by writing to production.

Rollback for the proposed migration is embedded in the file itself; it
records the pre-apply state (RLS enabled? pre-existing policy definition?)
so rollback restores exactly that state, not an assumed one.
