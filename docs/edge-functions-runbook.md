# Edge Functions — deployment & rollback runbook

Status: **owner-gated. Nothing here is executed by CI or by merging this PR.**
Deploying an Edge Function is a manual, one-function-at-a-time operation that
only the owner performs, with the gates below all green.

Project ref: `mcdchalyzeqjkkgfeznd` (already public in this repo).

## Active-function inventory — discover it, don't assume it

Do **not** assume a fixed count. The active inventory is whatever the platform
reports; list it before any deploy or rollback:

```bash
npx supabase functions list --project-ref mcdchalyzeqjkkgfeznd
```

As of the last check there were **11** active functions (`rivhit-img`,
`rivhit-sync`, `rivhit-push`, `signup`, `detect-orientation`, `image-audit`,
`image-thumbs`, and four retired `rivhit-probe-*` stubs that return `410`).
Re-run the command each time — treat its output as the source of truth.

## Rollback artifact (kept OUTSIDE this repo)

The byte-exact deployed sources are archived privately by the owner, **outside
Git** (a checksummed archive on the owner's private storage). They are
deliberately **not** committed here: a public repo must not carry exact
production function source. That private archive — not any path inside this
repo — is what a rollback redeploys.

> There is intentionally **no** `supabase/functions-deployed/` directory in
> this branch. Any rollback command that does
> `git checkout <sha> -- supabase/functions/rivhit-img` is **WRONG** — that
> path holds the *proposed replacement*, not the deployed source, so it would
> "roll back" to the new code. Always restore from the private archive.

---

## rivhit-img — deployment

### Pre-deploy gates (all green, or stop)

- Clean tree; CI green on the exact SHA; `(cd landing && npm test)` green
  (there is no root `package.json`).
- Local serve check (needs Docker) — `npx supabase functions serve rivhit-img`
  and probe with **GET** (the function answers `HEAD` with 405):
  ```bash
  curl -s -o /dev/null --max-time 20 \
    -w "status=%{http_code} type=%{content_type} bytes=%{size_download}\n" \
    "http://127.0.0.1:54321/functions/v1/rivhit-img?u=<enc getItemPic URL>&w=480&v=2"
  # expect: status=200 type=image/jpeg bytes>0
  ```
  Also verify: `&rot=90` → 200 rotated clockwise; `?u=https://example.com/` → 400;
  missing `u` → 400; `&meta=1` → 200 JSON `{"size":…,"orientation":…}` `no-store`;
  a burst of many distinct `w`/`rot`/`v` values → controlled `resource_limit`
  (429) responses under saturation, never a crash.
- `supabase/config.toml` pins `[functions.rivhit-img] verify_jwt = false`.

### Deploy (only rivhit-img)

```bash
# Record the current deployed version + config FIRST (rollback needs it):
npx supabase functions list --project-ref mcdchalyzeqjkkgfeznd   # note rivhit-img version
# Deploy. --no-verify-jwt is belt-and-braces with config.toml so public <img>
# access is preserved even if the config file is ever ignored:
npx supabase functions deploy rivhit-img --project-ref mcdchalyzeqjkkgfeznd --no-verify-jwt
```

Never deploy any other function in the same operation.

### Post-deploy smoke test

```bash
# 1. known-good cached product — GET, must stay 200 image/jpeg (NO auth header):
curl -s -o /dev/null --max-time 20 \
  -w "status=%{http_code} type=%{content_type} bytes=%{size_download}\n" \
  "https://mcdchalyzeqjkkgfeznd.supabase.co/functions/v1/rivhit-img?u=<enc>&w=480&v=2"
# expect: status=200 type=image/jpeg bytes>0  — proves unauthenticated access works.
# 2. rot=90 product — orientation matches the pre-deploy screenshot (low risk:
#    pipeline mirrors deployed v11). If wrong, roll back.
# 3. invalid u → 400 quickly.
# 4. read-only 60-product sample sweep:
SUPABASE_KEY=<anon publishable key> node scripts/diagnose-images.mjs --limit 60
```

Only if clean, run the full 980 sweep and compare against the **latest**
baseline in `docs/image-pipeline-findings.md` §7 (1 proxy failure / 980).
Two gates, both required:
- **success:** proxy failures ≤ 1/980 (a `resource_limit` JSON counts as a failure);
- **error-format:** any failures are sanitized JSON `{error,reason}` (no raw 546).

Roll back immediately if: broad placeholder regression, valid Rivhit sources
rejected, resource-limit failures increase, latency rises materially, the
function returns HTML/secrets, rot=90 renders wrong, or unauthenticated `<img>`
access breaks.

### rivhit-img — exact rollback (from the private archive, never from Git)

1. `npx supabase functions list …` — record the current (bad) version.
2. Verify the private archive's checksum against the recorded `MANIFEST.sha256`.
3. Create a TEMP workspace **outside** this repo:
   `mkdir -p "$TMP/deploy/supabase/functions/rivhit-img"`.
4. Copy the exact v11 source from the private archive into
   `"$TMP/deploy/supabase/functions/rivhit-img/index.ts"`.
5. Add a `config.toml` in `"$TMP/deploy/supabase/"` with
   `[functions.rivhit-img] verify_jwt = false` (preserve public access).
6. `cd "$TMP/deploy" && npx supabase functions deploy rivhit-img --project-ref mcdchalyzeqjkkgfeznd --no-verify-jwt`.
7. Re-run the post-deploy smoke test; confirm version and unauthenticated access.
8. Remove only `"$TMP"` after success. **Never** modify or delete the private archive.

---

## signup — deployment (separate, higher-priority security track)

The deployed `signup` has security weaknesses (auto-confirm, email-based
manager promotion). A secure **proposed** replacement is in
`supabase/functions/signup/` (clearly labeled proposed; it is NOT the deployed
source). Deploy it only after: exporting+checksumming the current deployed
`signup` privately, recording its version and `verify_jwt` state, local serve
tests, and verifying normal registration + email verification + existing-user
login **without creating a production test customer**. Same one-function-at-a-
time discipline; rollback restores the private pre-deploy `signup` snapshot via
the temp-workspace procedure above.

---

## RLS

Read-only only. The repo snapshot shows `products` has RLS enabled and a
manager-only `FOR ALL` policy (`is_manager()`), so the previously-proposed
extra UPDATE policy is redundant and has been **removed** from this branch. Do
not apply any RLS/policy/grant/schema change here; verify the live state with
owner credentials (queries in `docs/security-notes.md`) before considering any.
