# Image pipeline — findings and plan

Status: **diagnosis incomplete — blocked by environment.** No fix has been
applied on this branch. No deploy, no merge, no Supabase change, no write to
`rotation_override` / `orient_human_ok`.

---

## 1. CRITICAL finding (verified)

**The deployed Edge Function source is not in Git.**

- `supabase/` on `main` contains only `discount-setup.sql`,
  `discount-sync-notes.md`, `security-hardening.sql`.
- There is no `supabase/functions/` directory anywhere in the repo.
- A repo-wide code search for `imagescript`, `parseExifOrientation` and
  `FileService.svc` (excluding build output) returns **0 results**.

So `rivhit-img`, `rivhit-sync`, `rivhit-push`, `signup` and
`detect-orientation` exist **only inside the Supabase project**. Consequences:

- Production behaviour cannot be reviewed, diffed, tested or rolled back.
- Nobody can tell from the repo which version is live.
- An edge-function change is invisible to CI and to code review.

**Required regardless of the image bug:** vendor the function sources into
`supabase/functions/<name>/index.ts` and deploy from Git.

---

## 2. What is NOT yet proven

Two competing hypotheses remain open, and the evidence so far does not settle
them:

1. `rivhit-img` fails on particular photos (size / format / decode).
2. `rivhit-img` fails only under concurrency (worker exhaustion).
3. Some `products.picture_link` values are themselves dead, non-HTTPS, or do
   not return an image.

Earlier edge logs did show `WORKER_ERROR` 500s at ~250 ms, and a 12-request
burst later returned 200s — but those two observations were taken against
**different product sets**, so they do not prove either hypothesis. Treat the
"memory exhaustion" explanation as **unconfirmed**.

---

## 3. Why the diagnosis could not be run from this environment

Outbound HTTPS is blocked by the organisation egress policy for both hosts
the diagnosis needs (recorded proxy denials, `connect_rejected`):

- `api.rivhit.co.il:443`
- `mcdchalyzeqjkkgfeznd.supabase.co:443`

The Supabase MCP connection is also down, so read-only SQL and log queries are
unavailable. Producing the requested 40-product table from here would mean
inventing numbers, so it was not done.

---

## 4. Ready-to-run diagnosis

`scripts/diagnose-images.mjs` produces exactly the requested evidence. It is
**read-only** (GET requests and one `SELECT`); it never writes.

```bash
SUPABASE_URL=https://mcdchalyzeqjkkgfeznd.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service key> \
node scripts/diagnose-images.mjs --limit 60 --burst 12
```

Per product it records id, name, SKU, barcode, `picture_link`, whether the URL
is HTTPS, and for **both** the proxy URL and the direct Rivhit URL: HTTP
status, Content-Type, Content-Length, elapsed ms, and whether the body is a
real image (magic-byte check) versus HTML, redirect, timeout or worker error.

It classifies every product into the five requested buckets and prints counts
and percentages:

- `proxy-ok + source-ok`
- `proxy-FAIL + source-ok`
- `proxy-ok + source-problem`
- `both-FAIL`
- `invalid-or-empty-url`

**It also settles hypothesis 1 vs 2.** Pass 1 runs strictly sequentially
(isolating per-image faults); pass 2 re-requests the *same* URLs in a burst.
If URLs that pass alone fail in the burst, concurrency is proven a factor; if
they fail in both, the fault is per-image. Reports are written to
`image-diagnostics/report.json` and `report.csv`.

---

## 5. Plan for the real fix (NOT implemented — needs the data above, and
## owner approval for any Supabase change)

### 5.1 Harden `rivhit-img` before decoding
- Validate upstream `status`, `Content-Type` (must be `image/*`) and
  `Content-Length` **before** decoding.
- Enforce a byte cap and a pixel cap; reject oversized images with a clear
  structured error instead of dying with `WORKER_ERROR`.
- Explicit timeout; decide redirect policy deliberately (currently refused).
- Return a structured JSON error body with a reason code, so the client and
  the logs can distinguish "dead link" from "too large" from "decode failed".
- Keep the long cache for successes; add a **short negative cache** for dead
  links so a broken product does not re-hammer the worker on every page view.

### 5.2 Permanent fix — generate variants once
Decoding a multi-megabyte original on every cold request is the root design
flaw. Instead, generate each variant **once** into Supabase Storage and serve
it from the CDN.

- **Cost:** ~1000 products × a few variants × ~40 KB ≈ tens of MB of storage;
  one-off generation job. Ongoing per-request CPU drops to zero.
- **Risk:** low — additive. The proxy keeps working as the fallback path
  while the bucket fills.
- **Rollback:** stop reading from Storage and fall back to the proxy URL; the
  bucket can be deleted independently. No product data is touched.

### 5.3 Dead links
Where the diagnosis shows `picture_link` itself is broken, no proxy change can
help. Those products need a corrected link or a re-uploaded photo in Rivhit;
the app should show an accessible placeholder and the admin should list them
separately.

---

## 6. Deliberately not done on this branch

Steps 3, 4 and 6 (admin guards, the shared `ProductImage` component, and the
unit tests for the fallback chain) are **not** implemented yet, because the
instruction is to present the numeric diagnosis **before** changing code. They
should be built directly on the measured failure distribution — for example,
the direct-Rivhit fallback currently shipped in `/admin/fix-images` is only
worth keeping if the data shows a meaningful `proxy-FAIL + source-ok` bucket.
