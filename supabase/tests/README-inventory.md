# Stock-count migration tests

Tests for `supabase/2026-11-inventory-count.sql`. They are plain SQL with no
pgTAP, and they run on a **local** PostgreSQL only. Never point them at Supabase
staging or production.

| File | What it is |
| --- | --- |
| `inventory-prod-replica.sql` | A minimal replica of the production objects the migration depends on: `profiles` with its RLS and `trg_protect_privileged_cols`, `is_manager()`, `products` with its RLS, and Supabase's default privileges that grant every new table and function to `anon` and `authenticated` by name. It also creates the platform stand-ins (`anon`/`authenticated`/`service_role` roles, `auth.uid()`) when they are missing. It refuses to run where Supabase roles exist. |
| `inventory-count.test.sql` | The test script. It loads the replica, applies the migration **twice**, runs every check, then applies the migration a **third** time with data in place. |

## Run

You need PostgreSQL 14 or later and `psql`. The script uses `\ir`, so run it
from any directory and it still finds the migration by its relative path.

```bash
PSQL="psql -h /var/lib/postgresql/kerem-test -p 5499 -U postgres"   # adjust to your server

$PSQL -d postgres -c 'drop database if exists kerem_inv_test' \
                  -c 'create database kerem_inv_test template kerem_base'
$PSQL -d kerem_inv_test -X -v ON_ERROR_STOP=1 -f supabase/tests/inventory-count.test.sql
```

If you do not have the `kerem_base` template, use `create database kerem_inv_test`
on its own. The replica creates the Supabase stand-ins itself, and needs only
the `pgcrypto` extension to be available.

## Reading the result

- Each check prints `NOTICE:  PASS: <what was proven>`. Checks that expect an
  error also print the actual error in brackets, for example
  `[INV_CONFLICT:8:2]`.
- The first failure stops the run with `ERROR:  FAIL: <check>` and psql exit
  code 3.
- A full success ends with `ALL INVENTORY TESTS PASSED` and exit code 0.

## How a request is simulated

```sql
begin;
set local role authenticated;                                    -- or anon / service_role
set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select * from public.inv_lookup('7290000000011');
commit;
```

The fixtures are:

- **Users:** managers `aaaaaaaa-…-0001` and `…-0002`, a customer
  `cccccccc-…-0001` and an agent `dddddddd-…-0001`.
- **Products:** nine products `11111111-…-000N`. They cover leading zeros,
  UPC-12 and EAN-13 codes, a shared sku, an inactive product, one with no
  `rivhit_id`, and one with a barcode.

The tests use the helpers `t.ok`, `t.throws` and `t.rows`. They live in a
throwaway `t` schema that exists only in the test database.
