# Image pipeline — findings and plan

Status: **diagnosis COMPLETE (run 2026-08-13 from an unblocked machine) and
client-side fix implemented on this branch.** No Supabase change, no write to
`rotation_override` / `orient_human_ok`.

## 0. Measured diagnosis (read-only, full catalog)

Probed **all 980 active products** exposed by the public `catalog_public` RPC
(anon key; read-only — image GETs plus the read-only catalog RPC), through
the proxy (`w=480`, saved `rot`) and directly:

| bucket                          | count | share |
|---------------------------------|------:|------:|
| proxy-ok + source-ok            |   969 | 98.9% |
| **proxy-FAIL + source-ok**      |   **8** |  0.8% |
| invalid-or-empty-url            |     3 |  0.3% |
| proxy-ok + source-problem       |     0 |     — |
| both-FAIL                       |     0 |     — |

Every one of the 8 proxy failures returned **HTTP 546
`WORKER_RESOURCE_LIMIT`** ("Function failed due to not having enough compute
resources") in 1.5–6.6 s, and **every one of their source images is a
3.1–3.5 MB original that loads fine directly** (200, real JPEG). 27 further
requests were slow (>5 s) but succeeded. No hotlink blocking, no redirects,
no HTML-instead-of-image, no timeouts were observed anywhere in the catalog.

Two additional facts settle the earlier open hypotheses:

- **Failures are intermittent per-image cold-decode failures, not steady
  state:** a product that failed with 546 in one sequential run succeeded in
  a later run (its variant had been produced meanwhile) — which is why a
  single delayed retry genuinely helps.
- **Concurrency alone does not break cached variants:** a 12-request burst
  against already-cached variants returned 12/12 OK. The historical
  "whole screen of bears" events came from screens requesting *uncached*
  variants in bulk — `/admin/images-review` still requested a unique
  `w=360&rot=<draft>` server-rotated variant per card per click, forcing a
  full ~3 MB decode each time (fixed on this branch: CSS preview, shared
  cached variant).

**Root cause:** the `rivhit-img` edge function exhausts its compute budget
decoding heavy (≳3 MB) originals whenever the requested variant is not yet
cached; the resized-variant pipeline works for the other 98.9%.

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

## 2. What was NOT yet proven at the time (now settled by §0)

Two competing hypotheses remained open at the time this section was written:

1. `rivhit-img` fails on particular photos (size / format / decode).
2. `rivhit-img` fails only under concurrency (worker exhaustion).
3. Some `products.picture_link` values are themselves dead, non-HTTPS, or do
   not return an image.

Earlier edge logs did show `WORKER_ERROR` 500s at ~250 ms, and a 12-request
burst later returned 200s — but those two observations were taken against
**different product sets**, so they do not prove either hypothesis. Treat the
"memory exhaustion" explanation as **unconfirmed**.

---

## 3. Why the diagnosis could not be run from the ORIGINAL environment
(historical — since completed from a local machine, see §0)

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
**read-only** (image GETs plus one read-only product query — a REST `SELECT`,
or the public `catalog_public` RPC when only the anon key is available); it
never writes.

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

## 6. Implemented on this branch (client side only)

Built directly on the measured distribution above — the `proxy-FAIL +
source-ok` bucket is real (8 products, all heavy originals), so the direct
fallback stage is justified as a TEMPORARY safety net:

- `lib/imageFallback.ts` — pure, unit-tested fallback state machine
  (proxy → one delayed retry → direct HTTPS original → placeholder; bounded,
  ≤3 network attempts, zero attempts for empty/non-HTTPS links).
- `app/components/ProductImage.tsx` — the ONE shared image component, now
  used by the catalog, the public catalog + preview modal, the product page
  (main + related), the cart drawer, the admin catalog list and both admin
  fixing screens. Accessible placeholder (`role="img"`,
  "תמונת המוצר אינה זמינה"), timer cleanup on unmount, error reset on
  product change, no technical details shown to customers.
- `/admin/fix-images` — a photo that did not actually load can no longer be
  rotated, saved or marked "תקין" (it cannot advance the progress bar);
  the manager sees the failure stage plus נסה שוב / פתח מקור מרווחית /
  העתק קישור, and a "רק תמונות שלא נטענו" filter collects the failures.
- `/admin/images-review` — no longer requests per-angle server-rotated
  `w=360` variants (the decode-storm trigger); previews rotate locally in
  CSS over the shared cached `w=480` variant, with the same failed-image
  guards. The AI scan now stops when the screen unmounts.
- `tests/imageFallback.test.mjs` — 17 unit tests for the chain.

Still owner-blocked (unchanged): vendoring the edge-function sources into
Git (§1) and the server-side hardening + pre-generated variants (§5).

---

## 7. Follow-up branch (fix/edge-functions-source-and-image-hardening)

### 7.1 Diagnostic rerun (2026-08-13, later the same day, read-only)

980 products again: **1** proxy failure this run (a product that had not been
probed before — "מכונית משוגעת סטיצ 36 יח", 546 `WORKER_RESOURCE_LIMIT`,
3.4 MB original loads fine directly), **3** empty links (same products as
before), 77 slow (>5 s) requests. The 8 products that failed in the morning
run now pass — their variants were generated meanwhile and the CDN keeps
them. This is exactly the cold-decode-of-heavy-originals pattern: the failure
population is "whichever heavy originals happen to be uncached right now".

### 7.2 The 3 products with no image link (owner action: add a photo in Rivhit)

| product id | name | picture_link |
|---|---|---|
| `50ccf16c-8fe5-4cfb-842e-3f28e3f1d47e` | דמפלינג חלק מיוחד 1/12 ק 144 | (ריק) |
| `23b51ea6-9175-4b57-b657-2cc32562d529` | דמפלינג נידו צבעוני 1/12 ק 144 | (ריק) |
| `596d013c-88a8-4b2f-8315-ee7f3ffb68ec` | דמפלינג צבעוני מיוחד 1/12  ק 144 | (ריק) |

(SKU/ברקוד אינם נגישים דרך ה־RPC הציבורי — RLS מסתיר את הטבלה מ־anon; המנהל
יכול לאתר לפי השם במסך הקטלוג.) No product was modified; no image invented.

### 7.3 Edge-function source recovery — blocker documented

Exhaustive search (full git-history object scan, all 30 remote branches, all
tags, GitHub tags API) confirms **zero** edge-function source anywhere in
Git. The Supabase CLI (v2.114) is installed but has **no stored credentials**
on this machine; `supabase functions download` therefore requires a one-time
owner `supabase login`. The exact export procedure is in
`docs/edge-functions-runbook.md` Step 0-1. A clearly-labeled PROPOSED
hardened implementation (built to the live function's probed contract) now
lives in `supabase/functions/rivhit-img/` with 26 unit tests.

### 7.4 Product-update permissions — NOT VERIFIED

`pg_policies` is not exposed to the anon key (404) and write-testing against
production is forbidden, so the live `products` UPDATE policy is **not
verified**. The repo reference snapshot (`backups/schema-before.sql:108`)
shows `products_manager_all FOR ALL USING (is_manager())` — if production
matches, only managers can write. A redundant-but-explicit manager-only
UPDATE policy is prepared (NOT applied) in
`supabase/proposed-migrations/2026-08-13_products_manager_update_policy.sql`
with rollback SQL and a verification query for the owner.
