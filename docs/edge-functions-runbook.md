# Edge Functions — export, deployment and rollback runbook

Status: **NOTHING in this runbook has been executed.** It is the exact
procedure for the owner-approved future deployment of the hardened
`rivhit-img` (`supabase/functions/rivhit-img/`, a PROPOSED implementation —
see its README for provenance). Every step is owner-gated.

Project ref: `mcdchalyzeqjkkgfeznd` · Functions live only in Supabase (not in
Git) as of 2026-08-13: `rivhit-img`, `rivhit-sync`, `rivhit-push`, `signup`,
`detect-orientation`.

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
for f in rivhit-img rivhit-sync rivhit-push signup detect-orientation; do
  npx supabase functions download "$f"
done
```

Then, before committing:

1. Search every downloaded file for embedded secrets (keys, tokens,
   passwords, connection strings). Replace any literal with
   `Deno.env.get("NAME")` and record in the commit message that the committed
   copy is sanitized.
2. Commit to a branch as `deployed-source snapshot <date>` — this snapshot
   **is the rollback artifact**. Keep the proposed implementation in a
   separate directory or commit until cut-over is decided.
3. Record the deployed `rivhit-img` version:
   `npx supabase functions list` (note the version/updated-at for rollback).

**Hard rule: no deployment before this snapshot exists.** Without it there is
no exact way back.

## Step 2 — pre-deployment gates (all must be green)

- Branch: `fix/edge-functions-source-and-image-hardening` (or its merge into
  main), exact commit recorded.
- `git status` clean; CI green; `npm test` green (includes the 26 proxy-lib
  tests and 28 fallback tests).
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
# 1. a known-good cached product (must stay 200 image/jpeg):
curl -sI "https://mcdchalyzeqjkkgfeznd.supabase.co/functions/v1/rivhit-img?u=<enc>&w=480&v=2"
# 2. a rot=90 product — compare orientation with the pre-deploy screenshot;
#    if it rotated the WRONG way, rollback immediately (ImageScript rotation
#    direction was flagged as needing live verification).
# 3. an invalid u — expect 400 within ~100ms.
# 4. run the read-only sweep on a 60-product sample:
SUPABASE_KEY=<anon publishable key> node scripts/diagnose-images.mjs --limit 60
```

Only if the sample is clean, run the full-catalog sweep and compare the
failure buckets against the 2026-08-13 baseline in
`docs/image-pipeline-findings.md` §0 (8/980 → expected ≤ that, plus
`resource_limit` JSON errors replacing raw 546s).

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
after confirming the live state with owner credentials:

```sql
select policyname, cmd, qual, with_check
from pg_policies where schemaname='public' and tablename='products';
```

Rollback for the proposed migration is embedded in the file itself.
