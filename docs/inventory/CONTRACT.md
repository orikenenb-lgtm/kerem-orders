# Stock count (ספירת מלאי): the contract between teams

Branch `feat/inventory-count-20261124`. This file fixes names and shapes. Change
it only through the orchestrator.

## Verified facts (mapping, 2026-11-24)

- **Products.** `products.id` (uuid) is the stable id. `rivhit_id` (int, unique)
  links to Rivhit.
- **Codes.**
  - The scannable code is in **`sku`**: 795/798 active products have one, all
    numeric, mostly 13 digits (EAN-13), some 12/14/11.
  - `barcode` is empty for almost all products.
  - 17 sku values are shared by 47 active products, so **a scan can match
    several products**.
  - Leading zeros exist, so codes are **text, never numbers**.
- **Stock.**
  - `stock_quantity` (int) is Rivhit's `item.quantity` (book stock, units).
  - `rivhit-sync` **overwrites** name, description, price, sku, barcode and
    stock_quantity every 15 min.
  - Rivhit is the source of truth. A local-only edit of those fields is lost.
  - Orders do not reserve or decrement stock.
- **Warehouses.** None exist on the site. Rivhit has `Storage.List`. The UI shows a
  warehouse choice only when there is more than one.
- **Units.** Counts are entered in **units**. `display_qty` (pack size) is shown
  as a helper only.
- **Managers.** `public.is_manager()` (SECURITY DEFINER). Users cannot raise their
  own role (trigger `trg_protect_privileged_cols`).
- **Rivhit (official docs).**
  - There is NO "set quantity" and no count document.
  - Stock changes only through documents: **type 11 = stock entry (+)** and
    **type 10 = stock out (−)**. `Document.New` items take `{item_id, quantity>0,
    storage_id?}`.
  - `request_reference` + `prevent_duplicates:true` make a resend return error
    **-107 REQUEST_ALREADY_PROCESSED** instead of creating a second document.
  - `send_mail:false` must be set (the default is true). `check_only:true` exists.
  - `Item.Quantity {item_id, storage_id?}` reads the current quantity.
  - `Item.Update {item_id, item_name (required), barcode≤15, item_part_num≤15,
    item_extended_description, sale_nis, cost_nis, …}`. It is undocumented whether
    omitted fields are reset, so **always send the full current record** and
    verify it by reading back.
  - Rate limit: 200/min. Payload limit: 64 KB.
  - Response shape: `{error_code, client_message, data}`. Success is `error_code === 0`.

## Database (migration `supabase/2026-11-inventory-count.sql`, additive only)

The tables have RLS on and **SELECT for managers only**. There are no
INSERT/UPDATE/DELETE policies. Writes go only through the SECURITY DEFINER RPCs
below (each starts `if not public.is_manager() then raise exception 'להנהלה בלבד'`)
or through the service role (edge function).

`revoke all on <table> from anon, authenticated; grant select on <table> to authenticated;`

### `inventory_settings` (singleton id = 1)
`id int pk check (id=1)`, `rivhit_writes_enabled bool not null default false`,
`rivhit_customer_id int null`, `rivhit_last_name text not null default 'ספירת מלאי'`,
`doc_type_in int not null default 11`, `doc_type_out int not null default 10`,
`highlight_abs_diff int not null default 20`, `updated_at`, `updated_by uuid`.
A row is inserted with defaults.

### `inventory_counts`
- **Columns:** `id uuid pk default gen_random_uuid()`, `storage_id int null`,
  `storage_name text null`, `status text not null default 'draft'`
  CHECK in (`draft`, `approved`, `syncing`, `done`, `needs_attention`, `cancelled`),
  `note text`, `created_by uuid not null`, `created_at timestamptz not null default now()`,
  `approved_by uuid`, `approved_at timestamptz`, `finished_at timestamptz`,
  `version int not null default 1`, `mode text null` (`live` | `simulation`,
  set by the sync).
- **One active count per warehouse:** unique index on `coalesce(storage_id, 0)` where
  status in (`draft`, `approved`, `syncing`, `needs_attention`).

### `inventory_count_lines`
- **Identity:** `id uuid pk default gen_random_uuid()`, `count_id uuid not null`
  → `inventory_counts` on delete restrict, `product_id uuid not null` → `products`
  on delete restrict, `rivhit_id int not null`, `product_name text not null`
  (snapshot), `code_scanned text null`.
- **The count:** `counted_qty int not null check (counted_qty >= 0 and counted_qty <= 10000000)`.
- **The baseline:** `baseline_qty int not null` = `products.stock_quantity` at the
  save, and `baseline_at timestamptz` = `products.updated_at` at the save. Both are
  set by the server, never by the client.
- **Audit and versioning:** `counted_by uuid not null`, `counted_at timestamptz not null`,
  `version int not null default 1`.
- **Sync:**
  - `sync_status text not null default 'pending'`, CHECK in (`pending`, `in_progress`,
    `sent`, `done`, `no_change`, `unknown`, `failed`, `changed`).
  - `sync_ref uuid null`: the Rivhit `request_reference`. It is set by the sync
    BEFORE the call and only cleared when it is certain that no document was made.
  - `rivhit_before_qty int`, `delta int`, `rivhit_doc_type int`, `rivhit_doc_number text`,
    `rivhit_after_qty int`, `attempts int not null default 0`, `last_error text`,
    `synced_at timestamptz`.
- `unique (count_id, product_id)`.

### `inventory_events` (append-only history)
`id bigint generated always as identity pk`, `at timestamptz not null default now()`,
`actor uuid null`, `count_id uuid null`, `product_id uuid null`, `kind text not null`,
`detail jsonb not null default '{}'`.

- Written only by the RPCs (`actor = auth.uid()`, never from a parameter) or the
  service role.
- Managers SELECT. No UPDATE/DELETE grants for anyone but the service role.

### `product_edit_requests`
- **Columns:** `id uuid pk default gen_random_uuid()`, `product_id uuid not null`
  → products, `rivhit_id int not null`, `old_name text`, `new_name text`,
  `old_barcode text`, `new_barcode text`, `old_sku text`, `new_sku text`.
- **Status:** `status text not null default 'pending'` CHECK in (`pending`,
  `in_progress`, `done`, `failed`, `unknown`).
- **Audit:** `requested_by uuid not null`, `requested_at timestamptz default now()`,
  `finished_at`, `attempts int default 0`, `last_error text`.
- **One open request per product:** unique index on product_id where status in
  (`pending`, `in_progress`, `unknown`).

### RPCs (`security definer set search_path to 'public'`; `revoke execute … from public, anon; grant execute … to authenticated`)

- **`inv_lookup(p_code text)`** → `setof` (product_id, rivhit_id, name, sku, barcode,
  picture_link, rotation_override, stock_quantity, unit_name, display_qty,
  display_name, is_active, updated_at).
  - Trims the code. Allowed: 1–32 chars of `[0-9A-Za-z-]`.
  - Exact match on `sku` or `barcode`, plus the UPC-A↔EAN-13 variants (12 digits →
    also `'0'||code`; 13 digits starting with `0` → also `substr(code,2)`).
  - Only `is_active and rivhit_id is not null`. Order by name. Limit 20.
- **`inv_search(p_q text)`** → same columns. `ilike` on name/sku/barcode
  (`sanitizeQuery`-like: strip `%_,()`). Active with rivhit_id. Limit 30.
- **`inv_open_count(p_storage_id int, p_storage_name text, p_note text)`** → `uuid`.
  - If an active count exists for that warehouse, raises `INV_ACTIVE_EXISTS:<id>`.
  - Logs event `count_opened`.
- **`inv_save_line(p_count_id uuid, p_product_id uuid, p_counted int, p_expected_version int, p_code text)`**
  → `(line_id uuid, version int, counted_qty int, baseline_qty int, counted_at timestamptz)`.
  - **Count status:** must be `draft`. Also allowed when the count is `needs_attention`
    and this line's sync_status = `changed` (a recount); that resets the line to
    `pending`, `sync_ref` null and `last_error` null.
  - **Product:** active with rivhit_id.
  - **New line:** requires `p_expected_version is null`. On `unique_violation`,
    raise `INV_CONFLICT`.
  - **Existing line:** requires `p_expected_version = version`, else
    `INV_CONFLICT:<current counted_qty>:<current version>`.
  - **Every save** re-snapshots the baseline from products, bumps version, sets
    `counted_by = auth.uid()` and `counted_at = now()`, and logs `line_saved` with
    before/after.
- **`inv_delete_line(p_count_id uuid, p_product_id uuid, p_expected_version int)`** →
  `void`. Draft only. Same version rule. Logs `line_deleted`.
- **`inv_approve(p_count_id uuid, p_expected_version int)`** → `text`, the new status.
  - Only `draft` → `approved`, and the count must have at least 1 line.
  - Version mismatch or an already-approved count raises `INV_CONFLICT:<status>:<version>`.
  - Sets approved_by/at, bumps version, logs `count_approved` with a line summary.
- **`inv_cancel(p_count_id uuid, p_expected_version int)`** → `void`. Draft only.
  Logs `count_cancelled`.
- **`inv_request_item_edit(p_product_id uuid, p_new_name text, p_new_barcode text, p_new_sku text)`**
  → `uuid`.
  - Validates the name: trimmed, 1–100 chars.
  - Validates barcode and sku: null = unchanged, '' = clear (sku cannot be cleared),
    otherwise `^[0-9A-Za-z-]{1,15}$`.
  - At least one field must differ from the current value.
  - New barcode/sku must not equal any *other* active product's sku or barcode:
    `INV_DUPLICATE_CODE:<product name>`.
  - Inserts a `pending` request with old/new values. **Products are NOT changed.**
    Logs `item_edit_requested`.

## Edge function `inventory-sync` (POST, `Authorization: Bearer <user JWT>`)

- **Caller:** must be a manager, checked server-side by reading `profiles.role`
  with the service client. Otherwise 403.
- **Mode.** `live` only if env `INVENTORY_RIVHIT_MODE=live` **and**
  `inventory_settings.rivhit_writes_enabled` **and** `rivhit_customer_id` is set.
  Otherwise `simulation`:
  - a fake Rivhit, NO external calls;
  - **no write to `products`**;
  - document numbers look like `SIM-…`;
  - the count is marked `mode='simulation'`.

**Actions** (body `{action, ...}`):

- **`status`** → `{mode, writes_enabled, configured, storages:[{storage_id, storage_name}]}`.
  Storages come from `Storage.List` in live; in simulation it is one storage.
- **`sync_count {count_id, include_unknown?:bool}`** processes an approved, syncing
  or needs_attention count. Per line:
  1. **Skip** lines in `done` / `no_change`.
  2. **Claim** atomically: `pending` (or `unknown` when `include_unknown`, or `sent`) →
     `in_progress` (conditional update; 0 rows = someone else has it). Persist
     `sync_ref = coalesce(sync_ref, gen_random_uuid())` and attempts+1 BEFORE calling Rivhit.
  3. **A `sent` line** already has a doc number. Go straight to verify + local update,
     with no new document.
  4. **Read current quantity** with `Item.Quantity`.
  5. **If current ≠ baseline_qty** → `changed`: stock moved since the count. The line
     needs a recount; there is no write.
  6. **delta = counted − current.**
     - `0` → `no_change` (local stock is updated to current in live).
     - Otherwise `Document.New` with doc type 11 (delta>0) or 10 (|delta|),
       `send_mail:false`, `prevent_duplicates:true`, `request_reference: sync_ref`,
       `customer_id` and `last_name` from settings, `comments: "ספירת מלאי <count short id>"`,
       and items `[{item_id: rivhit_id, quantity: |delta|, storage_id?}]`.
  7. **Interpreting the result:**
     - success → store the doc number, status `sent`;
     - error -107 → treat as already processed and go to verify;
     - timeout or network error → `unknown`, with no automatic retry;
     - any other error → `failed`, with `last_error` (the Hebrew client_message) and
       sync_ref cleared, because no document was made;
     - rate limit → leave the rest `pending`, stop, and report.
  8. **Verify** with `Item.Quantity`:
     - equal to the expected after-quantity (current + delta) → `done`, then update
       `products.stock_quantity` in live mode only;
     - otherwise → `unknown` with an explanation.
  9. **Roll-up:** all lines `done`/`no_change` → `done` + finished_at; any
     `unknown`/`failed`/`changed` → `needs_attention`; otherwise `syncing`.
     Each step is logged to inventory_events.
- **`apply_item_edit {request_id}`**:
  1. Claim `pending`/`unknown` → `in_progress`.
  2. Read the full current item from Rivhit.
  3. `Item.Update` with ALL current fields, with only name/barcode/item_part_num replaced.
  4. Read it back and compare every field. All equal to the intended values → `done`,
     then update the local products name/barcode/sku (live only). Otherwise `unknown`.

## UI: `/admin/inventory/` (flag `ff_inventory_count`, managers only)

- **Main loop:** "Scan → enter quantity → save and continue".
- **Scanning:** the camera uses the `barcode-detector` ponyfill, lazy-loaded, with
  the wasm self-hosted. It also accepts keyboard-wedge scanners and manual search.
- **Duplicate codes:** several matches show a chooser.
- **Rescanning a counted item:** shows the saved line and asks "replace the total"
  vs "add to it". There is no silent doubling.
- **Unsaved values:** a typed value that is not yet saved is kept in localStorage
  until the server confirms it.
- **Approval screen:** the differences report, highlighting `|diff| ≥ highlight_abs_diff`,
  and one approve button.
- **Statuses:** טיוטה / ממתין לעדכון / מתעדכן / הושלם / דורש טיפול.

## Addendum 1 — after the independent review (binding)

### R1 — a resend never doubles a document
When retrying an `unknown` line, if Rivhit's current quantity already equals
`rivhit_before_qty + delta`, NO document is sent: verify, then `done`. A
document is resent (same ref) only when current = `rivhit_before_qty`.
Anything else stays `unknown`.

### R2 — a stuck count can always be closed, with an audit trail
- Add `skipped` to the line `sync_status` CHECK.
- New RPC `inv_resolve_line(p_line_id uuid, p_note text)` → `text` (the new count status).
  - Manager only, note required (3–500 chars).
  - Allowed only for lines in `failed`, `unknown` or `changed` of a count in
    `needs_attention`.
  - Sets the line to `skipped`, keeps `sync_ref`/doc fields untouched, logs
    `line_skipped` {before_status, note, sync_ref, rivhit_doc_number}.
  - Recomputes the count roll-up: every line in done / no_change / skipped →
    `done` + finished_at; otherwise it stays `needs_attention`.
- The UI must warn: "הפריט לא יעודכן בספירה הזו. אם הסטטוס היה 'דורש בדיקה' — ייתכן שתעודה כבר נוצרה ברווחית; בדקו ברווחית ידנית".
- The engine treats `skipped` as terminal and never touches it.

### R3 — the baseline comes from Rivhit itself
- New line columns: `rivhit_baseline_qty int null` and `rivhit_baseline_at timestamptz null`.
- `inv_save_line` clears both on every save. It keeps `baseline_qty` from products,
  for display only.
- New edge action `capture_baseline {line_id, expected_version}`:
  - Manager only.
  - Works only when line.version = expected_version and the count is `draft` (or
    `needs_attention` with the line `pending` after a recount).
  - Reads `Item.Quantity` (in simulation, `products.stock_quantity`) and stores
    `rivhit_baseline_qty` and `rivhit_baseline_at` with a conditional update on version.
  - Returns `{ok, rivhit_baseline_qty, rivhit_baseline_at}`.
- The UI calls it right after every successful save and shows a small indicator
  "✓ אומת מול רווחית" or "לא אומת — ייבדק באישור".
- **Sync:** the comparison baseline is `rivhit_baseline_qty`. If it is null, the line
  becomes `changed` with last_error "לא נקלטה כמות רווחית בזמן הספירה — ספרו מחדש".
  Never compare against the site copy.

### R4 — approval is tied to what was reviewed
`inv_save_line`, `inv_delete_line` and `inv_resolve_line` also bump
`inventory_counts.version`. The review screen passes the count version it rendered.
On `INV_CONFLICT` it reloads and tells the manager the list changed.

### R5 — no duplicate codes through open requests
`inv_request_item_edit` also checks the `new_barcode`/`new_sku` of OTHER open
requests (pending / in_progress / unknown). The engine re-checks duplicates in
the DB right before `Item.Update`: another active product or another open
request with the same code → `failed` "INV_DUPLICATE_CODE", with no write.

### R6 — the full Rivhit record is protected
- New column `product_edit_requests.rivhit_before jsonb null`.
- On the first attempt the engine stores the COMPLETE item record read from Rivhit
  before the update.
- Read-back compares EVERY field in that snapshot: everything must be equal except
  the intended changes, which must equal the target values. Otherwise → `unknown`
  with the list of differing fields.
- A recheck compares against the stored snapshot, never against current values.

### R7 — editing the SKU when item_part_num is empty
On the site, sku = `item_part_num || barcode`. Compare the old sku with that
effective value. When `item_part_num` is empty, a sku edit sets `item_part_num`.

### R8 — plausibility check
- Counted quantity > max(1000, 10 × displayed record) → explicit confirmation
  "הכמות גבוהה מאוד — לאשר?".
- When a burst ends inside the quantity field, it is not saved silently.

### Other
- `mode` is set on a count only when it is null; otherwise it must match.
- `checkCount` checks status and mode.
- Live sync with `storage_id` null while `Storage.List` returns more than one
  storage → `INV_STORAGE_REQUIRED`, nothing sent.
- History labels show "(סימולציה)" when `detail.mode = 'simulation'`.
- When the backend is not installed (RPC 404 / function missing), the UI shows
  "ספירת המלאי עדיין לא הופעלה בשרת" instead of errors.
