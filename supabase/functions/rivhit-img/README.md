# rivhit-img — hardened image proxy (PROPOSED, NOT DEPLOYED)

## Provenance — read this first

**This directory does NOT contain the currently deployed function's source.**

The deployed source (v11) was exported read-only via the official
`supabase functions download` and is kept in the owner's **private, off-Git
archive** — it is deliberately never committed to this public repo. The
transform pipeline in `index.ts` mirrors that deployed v11 exactly
(decode → shrink → EXIF fix → rotate → white composite for free angles →
final resize → JPEG encode); the SSRF/allowlist, resource-bound, format,
concurrency and sanitized-error layers are the hardening this PR adds on top.
Deployment and the exact rollback (from the private archive) are in
`docs/edge-functions-runbook.md`.

## What this directory IS

A **proposed replacement** implementation, written to the live function's
*observable contract*, which was probed read-only against production on
2026-08-13 (9 requests):

| observed behavior | kept here |
|---|---|
| `GET ?u=<enc>&w=480&v=2[&rot=N]` → `image/jpeg`, `Cache-Control: public, max-age=2592000, immutable` | ✔ identical |
| `rot` = extra **clockwise** degrees applied after the EXIF fix; each (u,w,v,rot) tuple is its own cache entry | ✔ identical (direction now matches by construction — the vendored deployed v11 uses the same imagescript@1.3.0 `rotate()` call and EXIF mapping; runbook step 4 still eyeballs one rot=90 sample) |
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
- streamed 8 MB byte cap + header-sniffed 12.6 MP pixel cap **before**
  decode (≈50 MB decoded RGBA — fits the worker budget while clearing a
  standard 4032×3024 phone photo; rejection returns 413 `invalid_dimensions`)
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
