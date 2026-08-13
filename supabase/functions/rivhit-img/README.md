# rivhit-img — hardened image proxy (PROPOSED, NOT DEPLOYED)

## Provenance — read this first

**This directory does NOT contain the currently deployed function's source.**

The functions `rivhit-img`, `rivhit-sync`, `rivhit-push`, `signup` and
`detect-orientation` were deployed to the Supabase project without ever being
committed to Git. An exhaustive search (full git history object scan, all 30
remote branches, all tags) found **zero** edge-function source anywhere —
see `docs/image-pipeline-findings.md` §1.

Recovering the exact deployed source requires the **owner** to authenticate
the Supabase CLI once:

```bash
npx supabase login                       # interactive browser auth (owner only)
npx supabase link --project-ref mcdchalyzeqjkkgfeznd
npx supabase functions download rivhit-img
npx supabase functions download rivhit-sync
npx supabase functions download rivhit-push
npx supabase functions download signup
npx supabase functions download detect-orientation
```

Then check every downloaded file for embedded secrets **before** committing
(replace any literal secret with a `Deno.env.get(...)` reference and note the
sanitization in the commit message).

This machine has no Supabase CLI credentials (`~/.supabase` contains only
telemetry), so the download could not be performed during this task.

## What this directory IS

A **proposed replacement** implementation, written to the live function's
*observable contract*, which was probed read-only against production on
2026-08-13 (9 requests):

| observed behavior | kept here |
|---|---|
| `GET ?u=<enc>&w=480&v=2[&rot=N]` → `image/jpeg`, `Cache-Control: public, max-age=2592000, immutable` | ✔ identical |
| `rot` = extra **clockwise** degrees applied after the EXIF fix; each (u,w,v,rot) tuple is its own cache entry | ✔ identical (direction must be re-verified on a sample before cut-over — runbook step 4) |
| `w=0`/absent → untouched original passthrough | ✔ identical |
| `meta=1` → `application/json` `{"size":n,"orientation":n}`, `no-store`, reads only ~256 KB | ✔ same shape; `size` caps at 262400 for larger files (matches the deployed cap observed live) |
| invalid `u` (missing / non-https / foreign host / non-getItemPic path) → HTTP 400 (deployed body: text `bad url`) | ✔ same status; body upgraded to sanitized JSON `{error,reason}` — the client only checks status + magic bytes |
| `Access-Control-Allow-Origin: *` on all responses incl. errors and `OPTIONS` | ✔ identical |

Hardening **added** (superset — measured root cause was `WORKER_RESOURCE_LIMIT`
546s while cold-decoding 3.1–3.5 MB originals; 8/980 products on 2026-08-13,
1/980 on the rerun):

- strict allowlist: `https:` + host `api.rivhit.co.il` + path prefix
  `/online/FileService.svc/getItemPic/`, no credentials, no odd ports
  (blocks SSRF to localhost / private ranges / metadata services by
  construction — only the allow-listed DNS name can ever be fetched)
- manual redirect handling, each hop re-validated, max 3
- 15 s upstream timeout; upstream status / Content-Type checked pre-decode
- streamed 8 MB byte cap + header-sniffed 40 MP pixel cap **before** decode
- bounded concurrent decodes (2) that fail fast with `resource_limit`
  instead of dying mid-decode; in-flight dedup shares one decode per variant
- 60 s negative cache on errors (deployed errors are uncached)
- structured sanitized JSON errors; privacy-safe JSON logs (no full URLs)

Pure logic lives in `lib.ts` and is unit-tested by
`landing/tests/rivhitImgProxy.test.mjs` (runs in `npm test` / CI — no Deno
needed). `index.ts` is the thin Deno entry.

## Deployment

**Do not deploy without the owner.** The full procedure, validation steps and
rollback are in `docs/edge-functions-runbook.md`. The critical constraint: the
deployed source must be exported and committed FIRST so there is a rollback
artifact; without it there is no safe way back.
