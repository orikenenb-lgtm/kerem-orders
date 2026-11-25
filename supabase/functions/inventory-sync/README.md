# inventory-sync — stock count → Rivhit (NOT DEPLOYED)

This function writes an approved stock count (ספירת מלאי) and item-detail edits to Rivhit.
The binding spec is `docs/inventory/CONTRACT.md`. The schema is `supabase/2026-11-inventory-count.sql`.

| file | what |
|---|---|
| `engine.ts` | All the logic, pure (no Deno APIs, no network). Unit-tested from node. |
| `rivhit.ts` | `liveRivhit` (the real API, 20 s timeout, about 187 calls/min pacing, result classification) and `simulatedRivhit` (in memory). |
| `db.ts` | The Supabase `Db`. It runs as the service role, and every status change is a conditional update. |
| `index.ts` | `Deno.serve`: CORS, POST only, JWT plus `profiles.role = 'manager'` (otherwise 401/403), the mode decision, and the actions. `deno check index.ts` passes. |

Tests: `cd landing && node tests/inventorySync.test.mjs` (50 tests, no network).

## Environment

| var | meaning |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Standard. Supabase provides them. |
| `INVENTORY_RIVHIT_MODE` | Optional kill switch: `simulation` forces simulation. Unset (or any other value) = follow `inventory_settings`. |
| `INVENTORY_SYNC_BUDGET_MS` | Optional. Default 110000. After this, no new line is claimed and the call returns `stopped:"time_budget"`. The UI calls again to resume. |

The Rivhit token is read with `rpc('_get_rivhit_token')`, the same vault entry as `rivhit-sync`. It is never logged.

## Modes

Live mode needs all of these. Otherwise the function runs in **simulation**.

- `INVENTORY_RIVHIT_MODE` is not `simulation` (unset is fine)
- `inventory_settings.rivhit_writes_enabled = true`
- `inventory_settings.rivhit_customer_id` is set

Simulation uses an in-memory Rivhit seeded from `products.stock_quantity`. It makes no external call, writes nothing to `products`, and its document numbers look like `SIM-11-0001`.

A count keeps the mode of its first sync. A simulated count can never continue live (`INV_MODE_MISMATCH`), because its finished lines would be skipped.

## Actions (POST `{action, ...}`, `Authorization: Bearer <manager JWT>`)

- `status` returns `{mode, writes_enabled, configured, storages}`.
- `sync_count {count_id, include_unknown?, retry_failed?, max_lines?, check_only?}` returns `{count_status, stopped, processed, recovered, by_status, remaining}`.
  - `include_unknown` resends `unknown` lines with the same `sync_ref` and `prevent_duplicates`.
  - `retry_failed` (an extension) retries `failed` lines with a fresh reference. This is safe because a failed line is certain to have no document.
  - `max_lines` limits how many lines one call processes.
  - `check_only` (an extension) sends `Document.New` with `check_only:true` for the first `max_lines` pending lines (default 1). It is read-only and also works on a `draft` count, so it can run before approval.
- `apply_item_edit {request_id}`
- `capture_baseline {line_id, expected_version}` returns `{ok, rivhit_baseline_qty, rivhit_baseline_at}`.
  - The line's `version` must equal `expected_version`.
  - The count must be `draft`, or `needs_attention` with this line `pending` after a recount.
  - Live reads `Item.Quantity`; simulation reads `products.stock_quantity`.
  - It also locks the count's `mode`, with the same set-only-while-null update the sync uses. If the count is already locked to the other mode → `INV_MODE_MISMATCH` and no baseline is written. A count whose baselines were captured in simulation can therefore never be synced live, and the reverse holds too.
  - The write is conditional on `version`.

Errors come back as `{ok:false, error:CODE, message:<Hebrew>}`.

## Design notes

- **One item per document.** Each line succeeds or fails on its own. A resend can only ever repeat its own document. The payload is about 400 B, far under 64 KB, and is checked anyway.
- **Order per line:**
  1. Claim the line, persisting `sync_ref`, `attempts+1` and `synced_at`.
  2. Read `Item.Quantity`.
  3. Persist `rivhit_before_qty`, `delta` and `rivhit_doc_type`.
  4. Call `Document.New`.
  5. On success: line → `sent` with the document number.
  6. Verify with `Item.Quantity`.
  7. Update products (live only).
  8. Line → `done`.
- **Baseline (Addendum R3).** The sync compares Rivhit's current quantity with `rivhit_baseline_qty` only. If it is null → `changed`. `baseline_qty` (the site copy) is display only.
- **Mode and storage.** `mode` is written once, only while null; a lost race → `INV_MODE_MISMATCH`. A live count without a warehouse while `Storage.List` returns more than one storage → `INV_STORAGE_REQUIRED`, and nothing is sent. `check_only` applies the same status, mode and storage checks.
- **`skipped`** (set by `inv_resolve_line`) is terminal. It is never read or sent, and it counts as finished in the roll-up.
- **"A document may exist" is a test, not a guess.** It means `sync_ref`, `delta`, `before` and `doc_type` were all persisted. For such a line (Addendum R1):
  - Rivhit already at `before+delta`: NO resend. Verify, then `done`. Rivhit might not remember the reference.
  - Rivhit still at `before`: resend with the same reference and `prevent_duplicates`.
  - Anything else: stays `unknown`, and no document is sent.
- **Recovery of `in_progress`.**
  - A line claimed more than 10 minutes ago is treated as left behind by a dead run. Edge functions die long before 10 minutes. `synced_at` is the claim time.
  - With a document number, it goes to `sent`, which is only re-verified.
  - Without one, it goes to `unknown`, which only an `include_unknown` run touches, and that run uses the same reference.
  - A newer `in_progress` line is left alone.
- **Errors.**
  - A timeout or network error on `Document.New` makes the line `unknown` and stops the run. Nothing else is tried until the network is back.
  - A rate limit or failed read releases the line to its previous status and stops the run. The remaining lines stay `pending`.
- **Rivhit OK, local update failed.** The line stays `sent`. The next run re-verifies and retries the local write. It never sends a new document. (`rivhit-sync` also rewrites `stock_quantity` within 15 minutes.)
- **apply_item_edit.**
  - It reads the full item via `Item.List` (`filter_fields` item_id).
  - On the first attempt it stores the COMPLETE record in `product_edit_requests.rivhit_before` (R6).
  - It sends `Item.Update` with every documented field of that snapshot. Three are mapped by their documented descriptions: `location→storage_location`, `sapak→supplier_id` and `item_name_en→item_name_english`. Only the fields where `new_*` ≠ `old_*` are replaced.
  - A sku edit always sets `item_part_num`, also when it was empty. The site's sku is `item_part_num || barcode`, and the conflict check compares against that effective value (R7).
  - The first attempt refuses (`failed`) when a changed field in Rivhit is neither old nor new.
  - Right before `Item.Update`, it re-checks the DB for duplicate codes: another active product, or another open request → `failed` `INV_DUPLICATE_CODE:<name>` (R5).
  - Read-back and every recheck compare EVERY snapshot field. Intended fields must equal their targets; all others must be unchanged. A difference → `unknown` with the field names. Only `quantity` is excluded, because sales move it.
- **Events.** Written with `actor = null` (the system) and `detail.triggered_by = <manager uid>`.

## Deploy (do NOT run without the owner)

```
supabase functions deploy inventory-sync --project-ref <ref>      # verify_jwt stays ON
supabase secrets set INVENTORY_RIVHIT_MODE=simulation --project-ref <ref>
```

## First live test: ONE item

Live mode is decided per request. The baseline is captured at SAVE time (`capture_baseline`), and a count keeps the mode of its first sync. So **switch to live BEFORE opening and counting the first live count**. A count whose baselines were captured in simulation is locked to simulation, and live capture or sync of it is refused with `INV_MODE_MISMATCH`.

1. Complete the read-only checks below.
2. Set `rivhit_customer_id` to a dedicated "ספירת מלאי" customer card. With `rivhit_writes_enabled=false`, run a full simulation of a real count and check the differences report. Then cancel it, or let it finish in simulation.
3. **Configure live:** `rivhit_writes_enabled=true` (and `INVENTORY_RIVHIT_MODE` not `simulation`). `status` must return `mode:"live"`.
4. **Count one item.** Open a NEW count. If Rivhit has more than one storage, it must name a warehouse; otherwise the sync refuses with `INV_STORAGE_REQUIRED`. Count **exactly one line**: an item with a small +1 difference. Check that the UI shows "✓ אומת מול רווחית" (the baseline was captured live). **Do NOT approve yet**: approving in the UI starts the sync immediately.
5. **Run check_only on the draft, from the function.** It is read-only: Item.Quantity plus Document.New with `check_only:true`. It writes no line, product, count status or mode, only an event. `<PROJECT_REF>`, `<MANAGER_JWT>` and `<COUNT_ID>` are placeholders: take the JWT from a manager's own logged-in browser session, and never paste a real token into a file or chat.
   ```
   curl -sS -X POST 'https://<PROJECT_REF>.supabase.co/functions/v1/inventory-sync' \
     -H 'Authorization: Bearer <MANAGER_JWT>' \
     -H 'Content-Type: application/json' \
     -d '{"action":"sync_count","count_id":"<COUNT_ID>","check_only":true,"max_lines":1}'
   ```
6. **Inspect the result:**
   - `mode:"live"` and `results[0].outcome:"check_ok"`;
   - `doc_type` is 11 and `delta` is +1;
   - `current` equals the quantity shown in Rivhit.

   Anything else (`changed`, `rivhit_error` with a message, `INV_STORAGE_REQUIRED`, …): stop, fix it, and run check_only again. No document exists yet.
7. **Approve in the UI.** This starts the sync. Then check all of these:
   - the line is `done`;
   - the document type is 11;
   - Rivhit's quantity is +1;
   - the document is in Rivhit with the comment "ספירת מלאי <id>";
   - no email was sent.
8. Repeat with a new one-line count at −1 (type 10).
9. Call sync again on the finished count. It must refuse (`INV_BAD_STATUS:done`) and send nothing.

## Rollback

- **Stop writes immediately:** `update inventory_settings set rivhit_writes_enabled=false`, or set `INVENTORY_RIVHIT_MODE=simulation`. The next request is simulation.
- **Remove the function:** `supabase functions delete inventory-sync`. Nothing else depends on it.
- **Undo a wrong document:** do it in Rivhit by hand, with the opposite document type for the same quantity. The line's `rivhit_doc_number` and `inventory_events` show exactly what was sent.

## Open questions (a read-only check on the real account is needed before live use)

1. Do document types 10 and 11 exist and are they enabled (`Document.TypeList`)? Do they need `price_nis` per item?
2. Which customer card should stock documents use? Does `last_name` overwrite that card's name?
3. What exactly does -107 return? Does `data` include the original `document_number`? (The code accepts either case.) Does a resend with the same reference but a different payload also give -107?
4. Storage ids (`Storage.List`): which storage do `Item.Quantity` and the document use when `storage_id` is omitted? Does the schema's `project_list` or the example's `storage_list` hold the list? (Both are accepted.)
5. What error code or HTTP status does the 200/min rate limit return? Only HTTP 429 and a `RATE_LIMIT` debug message are recognized now.
6. Does `Item.List` honour `filter_fields` with `item_id`? (If not, the full list comes back and the exact id is picked.) Does `Item.Update` accept `barcode:""` to clear a barcode, and does it reset omitted fields?
7. Can `Item.Quantity` return non-integer quantities for any counted item? Such lines go to `failed`.
