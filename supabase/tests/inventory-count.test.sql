-- ============================================================================
-- Tests for supabase/2026-11-inventory-count.sql (plain SQL, no pgTAP).
-- LOCAL TEST DATABASE ONLY. See supabase/tests/README-inventory.md.
--
-- Every check prints "NOTICE:  PASS: ..." or aborts with "FAIL: ...".
-- Run with ON_ERROR_STOP so the first failure stops the run with exit code 3.
-- A request is simulated with:
--   begin; set local role authenticated; set local request.jwt.claim.sub = '<uuid>'; ... commit;
-- ============================================================================
\set ON_ERROR_STOP on
\set QUIET on
-- Query results are not needed; PASS/FAIL arrive as notices/errors (stderr).
\o /dev/null
set client_min_messages to warning;   -- hide 'already exists, skipping' while loading

-- ---------------------------------------------------------------------------
-- 0. The production replica, then a fingerprint of the existing objects.
-- ---------------------------------------------------------------------------
\ir inventory-prod-replica.sql

drop schema if exists t cascade;
create schema t;
grant usage on schema t to anon, authenticated, service_role;

create function t.pass(label text) returns void language plpgsql as $$
begin raise notice 'PASS: %', label; end $$;

create function t.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', label; end if;
  perform t.pass(label);
end $$;

-- Runs sql and expects an error whose message is LIKE pattern.
create function t.throws(sql text, pattern text, label text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if sqlerrm like pattern then
      perform t.pass(label || '  [' || sqlerrm || ']');
      return;
    end if;
    raise exception 'FAIL: % -- expected error like "%", got "%"', label, pattern, sqlerrm;
  end;
  raise exception 'FAIL: % -- expected error like "%", but it succeeded', label, pattern;
end $$;

-- Rows a statement returns (as the current role).
create function t.rows(sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute 'select count(*) from (' || sql || ') s' into n;
  return n;
end $$;

-- What the migration must not change: existing columns, policies, triggers,
-- grants and function bodies of profiles/products/is_manager.
create function t.existing_fingerprint() returns text language sql as $$
  select md5(concat_ws('#',
    (select string_agg(table_name || '.' || column_name || ':' || data_type || ':' || coalesce(column_default, ''), ',' order by table_name, column_name)
       from information_schema.columns where table_schema = 'public' and table_name in ('profiles', 'products')),
    (select string_agg(tablename || '.' || policyname || ':' || cmd || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), ',' order by tablename, policyname)
       from pg_policies where schemaname = 'public' and tablename in ('profiles', 'products')),
    (select string_agg(tgname, ',' order by tgname) from pg_trigger
       where tgrelid in ('public.profiles'::regclass, 'public.products'::regclass) and not tgisinternal),
    (select string_agg(grantee || ':' || table_name || ':' || privilege_type, ',' order by grantee, table_name, privilege_type)
       from information_schema.role_table_grants where table_schema = 'public' and table_name in ('profiles', 'products')),
    (select string_agg(pg_get_functiondef(p.oid), ',' order by p.proname) from pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.proname in ('is_manager', 'protect_privileged_profile_cols')),
    (select string_agg(p.proname || ':' || coalesce(array_to_string(p.proacl, ' '), ''), ',' order by p.proname) from pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.proname in ('is_manager', 'protect_privileged_profile_cols'))
  ));
$$;

select set_config('t.fp_before', t.existing_fingerprint(), false);

-- ---------------------------------------------------------------------------
-- 1. The migration, TWICE (idempotency).
-- ---------------------------------------------------------------------------
\ir ../2026-11-inventory-count.sql
\ir ../2026-11-inventory-count.sql
set client_min_messages to notice;

select t.ok(t.existing_fingerprint() = current_setting('t.fp_before'),
  'migration (x2) leaves profiles/products/is_manager columns, policies, triggers, grants untouched');
select t.ok((select count(*) from public.inventory_settings) = 1
            and (select rivhit_writes_enabled = false and doc_type_in = 11 and doc_type_out = 10
                        and highlight_abs_diff = 20 and rivhit_last_name = 'ספירת מלאי'
                 from public.inventory_settings where id = 1),
  'idempotent: exactly one settings row, with the contract defaults');
select t.ok((select count(*) from pg_policies where schemaname = 'public'
             and tablename in ('inventory_settings', 'inventory_counts', 'inventory_count_lines', 'inventory_events', 'product_edit_requests')) = 5
            and (select bool_and(cmd = 'SELECT' and roles = '{authenticated}') from pg_policies where schemaname = 'public'
             and tablename in ('inventory_settings', 'inventory_counts', 'inventory_count_lines', 'inventory_events', 'product_edit_requests')),
  'idempotent: one manager SELECT policy per table, no write policies');
select t.ok((select bool_and(c.relrowsecurity) from pg_class c
             where c.oid in ('public.inventory_settings'::regclass, 'public.inventory_counts'::regclass,
                             'public.inventory_count_lines'::regclass, 'public.inventory_events'::regclass,
                             'public.product_edit_requests'::regclass)),
  'RLS enabled on all five inventory tables');
select t.ok((select bool_and(p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=public')
             from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'inv\_%'),
  'every inv_* function is SECURITY DEFINER with search_path=public');
select t.ok((select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'inv\_%') = 11,
  'idempotent: no duplicate inv_* overloads (11 functions)');
select t.ok(not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'inv\_%'
                        and (has_function_privilege('anon', p.oid, 'execute'))),
  'no inv_* function is executable by anon (despite Supabase default privileges)');
select t.ok((select count(*) from information_schema.columns where table_schema = 'public'
              and ((table_name = 'inventory_count_lines' and column_name in ('rivhit_baseline_qty', 'rivhit_baseline_at'))
                or (table_name = 'product_edit_requests' and column_name = 'rivhit_before' and data_type = 'jsonb'))) = 3,
  'addendum R3/R6 columns exist: rivhit_baseline_qty, rivhit_baseline_at, rivhit_before jsonb');
select t.ok((select pg_get_constraintdef(oid) like '%skipped%' from pg_constraint
             where conname = 'inventory_count_lines_sync_status_check'),
  'addendum R2: sync_status CHECK accepts skipped');
select t.ok((select pg_get_constraintdef(oid) like '%cancelled%' from pg_constraint
             where conname = 'product_edit_requests_status_check')
            and (select pg_get_indexdef(indexrelid) like '%pending%in_progress%unknown%'
                        and pg_get_indexdef(indexrelid) not like '%cancelled%' and pg_get_indexdef(indexrelid) not like '%failed%'
                 from pg_index where indexrelid = 'public.product_edit_requests_one_open_idx'::regclass),
  'edit request status CHECK accepts cancelled; one-open index covers only pending/in_progress/unknown');
select t.ok(not has_function_privilege('authenticated', 'public.inv_log(uuid,uuid,text,jsonb)', 'execute'),
  'internal inv_log() is not executable by authenticated');
select t.ok((select bool_and(not has_table_privilege('authenticated', c.oid, 'insert')
                         and not has_table_privilege('authenticated', c.oid, 'update')
                         and not has_table_privilege('authenticated', c.oid, 'delete')
                         and has_table_privilege('authenticated', c.oid, 'select')
                         and not has_table_privilege('anon', c.oid, 'select'))
             from pg_class c where c.relnamespace = 'public'::regnamespace
               and c.relname in ('inventory_settings', 'inventory_counts', 'inventory_count_lines', 'inventory_events', 'product_edit_requests')),
  'grants: authenticated SELECT only, anon nothing, on all five tables');

-- ---------------------------------------------------------------------------
-- 2. Fixtures (as postgres: users, roles, products).
-- ---------------------------------------------------------------------------
-- m1, m2 managers; cu customer; ag agent.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'm1@test'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'm2@test'),
  ('cccccccc-0000-0000-0000-000000000001', 'cu@test'),
  ('dddddddd-0000-0000-0000-000000000001', 'ag@test');
insert into public.profiles (id, role, full_name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'manager',  'Manager One'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'manager',  'Manager Two'),
  ('cccccccc-0000-0000-0000-000000000001', 'customer', 'Customer'),
  ('dddddddd-0000-0000-0000-000000000001', 'agent',    'Agent');

insert into public.products (id, name, sku, barcode, rivhit_id, stock_quantity, is_active, updated_at) values
  ('11111111-0000-0000-0000-000000000001', 'Alpha',     '7290000000011', null,   101, 10, true,  '2026-11-01 08:00+00'),
  ('11111111-0000-0000-0000-000000000002', 'Beta',      '0012345678905', null,   102,  5, true,  '2026-11-01 08:00+00'),
  ('11111111-0000-0000-0000-000000000003', 'Gamma',     '123456789012',  null,   103,  3, true,  '2026-11-01 08:00+00'),
  ('11111111-0000-0000-0000-000000000004', 'Delta A',   '7290000000099', null,   104, 40, true,  '2026-11-01 08:00+00'),
  ('11111111-0000-0000-0000-000000000005', 'Delta B',   '7290000000099', null,   105, 41, true,  '2026-11-01 08:00+00'),
  ('11111111-0000-0000-0000-000000000006', 'Inactive',  '7290000000066', null,   106,  6, false, '2026-11-01 08:00+00'),
  ('11111111-0000-0000-0000-000000000007', 'NoRivhit',  '7290000000077', null,  null,  7, true,  '2026-11-01 08:00+00'),
  ('11111111-0000-0000-0000-000000000008', 'Epsilon',   '00777',         'BC-8', 108,  0, true,  '2026-11-01 08:00+00'),
  ('11111111-0000-0000-0000-000000000009', 'Zeta',      'AB-12',         null,   109,  9, true,  '2026-11-01 08:00+00');

select set_config('t.products_hash', (select md5(string_agg(p::text, '|' order by p.id)) from public.products p), false);

-- ---------------------------------------------------------------------------
-- 3. Guest (anon): no table, no RPC.
-- ---------------------------------------------------------------------------
begin;
set local role anon;
select t.throws($$select * from public.inventory_settings$$,    '%permission denied%', 'anon cannot select inventory_settings');
select t.throws($$select * from public.inventory_counts$$,      '%permission denied%', 'anon cannot select inventory_counts');
select t.throws($$select * from public.inventory_count_lines$$, '%permission denied%', 'anon cannot select inventory_count_lines');
select t.throws($$select * from public.inventory_events$$,      '%permission denied%', 'anon cannot select inventory_events');
select t.throws($$select * from public.product_edit_requests$$, '%permission denied%', 'anon cannot select product_edit_requests');
select t.throws($$select * from public.inv_lookup('7290000000011')$$, '%permission denied%', 'anon cannot execute inv_lookup');
select t.throws($$select * from public.inv_search('Alpha')$$,         '%permission denied%', 'anon cannot execute inv_search');
select t.throws($$select public.inv_open_count(null, null, null)$$,   '%permission denied%', 'anon cannot execute inv_open_count');
select t.throws($$select * from public.inv_save_line(gen_random_uuid(), '11111111-0000-0000-0000-000000000001', 1, null, null)$$,
  '%permission denied%', 'anon cannot execute inv_save_line');
select t.throws($$select public.inv_delete_line(gen_random_uuid(), '11111111-0000-0000-0000-000000000001', 1)$$,
  '%permission denied%', 'anon cannot execute inv_delete_line');
select t.throws($$select public.inv_approve(gen_random_uuid(), 1)$$, '%permission denied%', 'anon cannot execute inv_approve');
select t.throws($$select public.inv_cancel(gen_random_uuid(), 1)$$,  '%permission denied%', 'anon cannot execute inv_cancel');
select t.throws($$select public.inv_request_item_edit('11111111-0000-0000-0000-000000000009', 'x', null, null)$$,
  '%permission denied%', 'anon cannot execute inv_request_item_edit');
select t.throws($$select public.inv_resolve_line(gen_random_uuid(), 'note')$$, '%permission denied%', 'anon cannot execute inv_resolve_line');
select t.throws($$select public.inv_close_item_edit(gen_random_uuid(), 'note')$$, '%permission denied%', 'anon cannot execute inv_close_item_edit');
select t.throws($$select public.inv_log(null, null, 'x', '{}')$$, '%permission denied%', 'anon cannot execute inv_log');
commit;

-- ---------------------------------------------------------------------------
-- 4. Manager: open counts.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select set_config('t.c1', public.inv_open_count(null, 'מחסן ראשי', '  ספירה ראשונה  ')::text, false);
select t.ok((select status = 'draft' and version = 1 and created_by = 'aaaaaaaa-0000-0000-0000-000000000001'
                    and note = 'ספירה ראשונה' and storage_id is null
             from public.inventory_counts where id = current_setting('t.c1')::uuid),
  'manager opens a count: draft, version 1, created_by = auth.uid(), note trimmed');
select t.throws($$select public.inv_open_count(null, 'x', null)$$, 'INV_ACTIVE_EXISTS:' || current_setting('t.c1'),
  'second active count for the same storage -> INV_ACTIVE_EXISTS:<id>');
select t.throws($$select public.inv_open_count(0, 'x', null)$$, 'INV_ACTIVE_EXISTS:%',
  'storage 0 and null are the same storage (coalesce) -> INV_ACTIVE_EXISTS');
select t.throws($$select public.inv_open_count(9, 'x', repeat('n', 501))$$, 'INV_BAD_INPUT:note',
  'note longer than 500 chars refused');
select set_config('t.c2', public.inv_open_count(7, 'מחסן 7', null)::text, false);
select t.ok(current_setting('t.c2') <> current_setting('t.c1'), 'a different storage may have its own active count');
commit;

-- ---------------------------------------------------------------------------
-- 5. Manager: lookup and search.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select t.ok((select array_agg(name) from public.inv_lookup('7290000000011')) = array['Alpha'], 'lookup: exact sku');
select t.ok((select array_agg(name) from public.inv_lookup('  7290000000011 ')) = array['Alpha'], 'lookup: code is trimmed');
select t.ok((select array_agg(sku) from public.inv_lookup('0012345678905')) = array['0012345678905'],
  'lookup: keeps leading zeros (returns sku 0012345678905 as text)');
select t.ok(t.rows($$select * from public.inv_lookup('12345678905')$$) = 0,
  'lookup: no numeric matching (12345678905 does not find 0012345678905)');
select t.ok((select array_agg(name) from public.inv_lookup('012345678905')) = array['Beta'],
  'lookup: UPC-12 scan finds the stored EAN-13 (0 || code)');
select t.ok((select array_agg(name) from public.inv_lookup('0123456789012')) = array['Gamma'],
  'lookup: EAN-13 scan starting 0 finds the stored UPC-12 (substr)');
select t.ok((select array_agg(name order by name) from public.inv_lookup('7290000000099')) = array['Delta A', 'Delta B'],
  'lookup: duplicate sku returns several rows (ordered by name)');
select t.ok((select array_agg(name) from public.inv_lookup('BC-8')) = array['Epsilon'], 'lookup: exact barcode match');
select t.ok(t.rows($$select * from public.inv_lookup('9999999999999')$$) = 0, 'lookup: unknown code -> 0 rows');
select t.ok(t.rows($$select * from public.inv_lookup('7290000000066')$$) = 0, 'lookup: inactive product not returned');
select t.ok(t.rows($$select * from public.inv_lookup('7290000000077')$$) = 0, 'lookup: product without rivhit_id not returned');
select t.throws($$select * from public.inv_lookup('729 0000')$$,     'INV_BAD_CODE', 'lookup: space inside code rejected');
select t.throws($$select * from public.inv_lookup('1'';drop')$$,     'INV_BAD_CODE', 'lookup: quote/semicolon rejected');
select t.throws($$select * from public.inv_lookup('72%')$$,          'INV_BAD_CODE', 'lookup: wildcard % rejected');
select t.throws($$select * from public.inv_lookup('')$$,             'INV_BAD_CODE', 'lookup: empty code rejected');
select t.throws($$select * from public.inv_lookup(null)$$,           'INV_BAD_CODE', 'lookup: null code rejected');
select t.throws($$select * from public.inv_lookup(repeat('1', 33))$$, 'INV_BAD_CODE', 'lookup: 33 chars rejected');
select t.ok(t.rows($$select * from public.inv_lookup(repeat('1', 32))$$) = 0, 'lookup: 32 chars accepted');
select t.ok((select array_agg(name order by name) from public.inv_search('delta')) = array['Delta A', 'Delta B'],
  'search: case-insensitive name match');
select t.ok((select array_agg(name order by name) from public.inv_search('7290000')) = array['Alpha', 'Delta A', 'Delta B'],
  'search: partial sku, only active products with rivhit_id');
select t.ok(t.rows($$select * from public.inv_search('Al_ha')$$) = 0, 'search: _ is not a wildcard (sanitized)');
select t.ok(t.rows($$select * from public.inv_search('%')$$) = 0, 'search: % alone -> empty query -> 0 rows');
select t.ok(t.rows($$select * from public.inv_search(null)$$) = 0, 'search: null -> 0 rows');
select t.ok((select array_agg(name) from public.inv_search('bc-8')) = array['Epsilon'], 'search: barcode match');
-- Reviewer probe: a temp table named like ours must not shadow public.* inside the SECURITY DEFINER functions.
create temp table products (id uuid, name text, sku text, barcode text, is_active boolean, rivhit_id int);
insert into pg_temp.products values (gen_random_uuid(), 'Shadow', '7290000000011', null, true, 1);
create temp table inventory_counts (id uuid, storage_id int, status text);
select t.ok((select array_agg(name) from public.inv_lookup('7290000000011')) = array['Alpha']
            and (select array_agg(name order by name) from public.inv_search('delta')) = array['Delta A', 'Delta B'],
  'temp tables named products/inventory_counts do not shadow public.* inside the RPCs');
select t.throws($$select public.inv_open_count(null, 'x', null)$$, 'INV_ACTIVE_EXISTS:' || current_setting('t.c1'),
  'inv_open_count still sees the real inventory_counts with a shadowing temp table');
rollback;

-- ---------------------------------------------------------------------------
-- 6. Manager: save lines.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select t.ok(r.version = 1 and r.counted_qty = 7 and r.baseline_qty = 10 and r.line_id is not null,
  'save new line: version 1, counted 7, baseline 10 (from products)')
  from public.inv_save_line(current_setting('t.c1')::uuid, '11111111-0000-0000-0000-000000000001', 7, null, '7290000000011') r;
select t.ok((select counted_by = 'aaaaaaaa-0000-0000-0000-000000000001' and baseline_at = '2026-11-01 08:00+00'
                    and rivhit_id = 101 and product_name = 'Alpha' and code_scanned = '7290000000011'
                    and sync_status = 'pending' and counted_at is not null
             from public.inventory_count_lines where count_id = current_setting('t.c1')::uuid
               and product_id = '11111111-0000-0000-0000-000000000001'),
  'line: counted_by = auth.uid(), baseline_at = products.updated_at, rivhit_id/name snapshot');
select t.ok((select stock_quantity from public.products where id = '11111111-0000-0000-0000-000000000001') = 10,
  'draft save does NOT change products.stock_quantity');
select t.ok((select version from public.inventory_counts where id = current_setting('t.c1')::uuid) = 2, 'R4: saving a line bumps the COUNT version (1 -> 2)');
select t.ok((select rivhit_baseline_qty is null and rivhit_baseline_at is null from public.inventory_count_lines
             where count_id = current_setting('t.c1')::uuid and product_id = '11111111-0000-0000-0000-000000000001'),
  'R3: a new line has no Rivhit baseline yet');
select t.throws($$select * from public.inv_save_line(p_count_id => current_setting('t.c1')::uuid,
    p_product_id => '11111111-0000-0000-0000-000000000003', p_counted => 1, p_expected_version => null,
    p_code => null, p_baseline_qty => 999)$$,
  '%does not exist%', 'no parameter can set the baseline (p_baseline_qty does not exist)');
select t.throws($$select * from public.inv_save_line(p_count_id => current_setting('t.c1')::uuid,
    p_product_id => '11111111-0000-0000-0000-000000000003', p_counted => 1, p_expected_version => null,
    p_code => null, p_counted_by => 'aaaaaaaa-0000-0000-0000-000000000002')$$,
  '%does not exist%', 'no parameter can spoof counted_by (p_counted_by does not exist)');
select t.ok(r.version = 1 and r.counted_qty = 0 and r.baseline_qty = 5, 'counted 0 is allowed')
  from public.inv_save_line(current_setting('t.c1')::uuid, '11111111-0000-0000-0000-000000000002', 0, null, null) r;
select t.ok(r.counted_qty = 10000000, 'counted 10,000,000 (the maximum) is allowed')
  from public.inv_save_line(current_setting('t.c1')::uuid, '11111111-0000-0000-0000-000000000003', 10000000, null, '0123456789012') r;
select t.throws($$select * from public.inv_save_line(current_setting('t.c1')::uuid, '11111111-0000-0000-0000-000000000004', -1, null, null)$$,
  'INV_BAD_QTY', 'negative count rejected');
select t.throws($$select * from public.inv_save_line(current_setting('t.c1')::uuid, '11111111-0000-0000-0000-000000000004', 10000001, null, null)$$,
  'INV_BAD_QTY', 'count > 10,000,000 rejected');
select t.throws($$select * from public.inv_save_line(current_setting('t.c1')::uuid, '11111111-0000-0000-0000-000000000004', null, null, null)$$,
  'INV_BAD_QTY', 'null count rejected');
select t.throws($$select * from public.inv_save_line(current_setting('t.c1')::uuid, '11111111-0000-0000-0000-000000000004', 1, null, 'bad code!')$$,
  'INV_BAD_CODE', 'save: invalid scanned code rejected');
select t.throws($$select * from public.inv_save_line(current_setting('t.c1')::uuid, '11111111-0000-0000-0000-000000000006', 1, null, null)$$,
  'INV_PRODUCT_UNAVAILABLE', 'save: inactive product refused');
select t.throws($$select * from public.inv_save_line(current_setting('t.c1')::uuid, '11111111-0000-0000-0000-000000000007', 1, null, null)$$,
  'INV_PRODUCT_UNAVAILABLE', 'save: product without rivhit_id refused');
select t.throws($$select * from public.inv_save_line(current_setting('t.c1')::uuid, gen_random_uuid(), 1, null, null)$$,
  'INV_NOT_FOUND', 'save: unknown product refused');
select t.throws($$select * from public.inv_save_line(gen_random_uuid(), '11111111-0000-0000-0000-000000000004', 1, null, null)$$,
  'INV_NOT_FOUND', 'save: unknown count refused');
commit;

-- rivhit-sync overwrites the book stock between two saves (as postgres).
update public.products set stock_quantity = 12, updated_at = '2026-11-24 10:00+00'
where id = '11111111-0000-0000-0000-000000000001';
select set_config('t.products_hash', (select md5(string_agg(p::text, '|' order by p.id)) from public.products p), false);

-- The edge function's capture_baseline stores the Rivhit baseline (service role).
begin;
set local role service_role;
update public.inventory_count_lines set rivhit_baseline_qty = 12, rivhit_baseline_at = now()
 where count_id = current_setting('t.c1')::uuid and product_id = '11111111-0000-0000-0000-000000000001';
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select t.ok((select version from public.inventory_counts where id = current_setting('t.c1')::uuid) = 4, 'refused saves did not bump the count version (3 saves -> version 4)');
select t.ok(r.version = 2 and r.counted_qty = 8 and r.baseline_qty = 12,
  'every save re-snapshots the baseline from products (10 -> 12) and bumps version to 2')
  from public.inv_save_line(current_setting('t.c1')::uuid, '11111111-0000-0000-0000-000000000001', 8, 1, null) r;
select t.ok((select baseline_at = '2026-11-24 10:00+00' and code_scanned = '7290000000011'
             from public.inventory_count_lines where count_id = current_setting('t.c1')::uuid
               and product_id = '11111111-0000-0000-0000-000000000001'),
  'baseline_at re-snapshotted; code_scanned kept when p_code is null');
select t.ok((select rivhit_baseline_qty is null and rivhit_baseline_at is null from public.inventory_count_lines
             where count_id = current_setting('t.c1')::uuid and product_id = '11111111-0000-0000-0000-000000000001'),
  'R3: every inv_save_line clears rivhit_baseline_qty / rivhit_baseline_at (captured 12 -> null)');
-- m1 adds Delta A, used below for the double-insert race.
select t.ok(r.version = 1, 'manager 1 adds Delta A')
  from public.inv_save_line(current_setting('t.c1')::uuid, '11111111-0000-0000-0000-000000000004', 3, null, null) r;
commit;

-- ---------------------------------------------------------------------------
-- 7. Optimistic concurrency: manager 2 with stale state.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000002';
select t.throws($$select * from public.inv_save_line(current_setting('t.c1')::uuid, '11111111-0000-0000-0000-000000000001', 9, 1, null)$$,
  'INV_CONFLICT:8:2', 'manager 2 saves with stale version 1 -> INV_CONFLICT:<qty 8>:<version 2>');
select t.throws($$select * from public.inv_save_line(current_setting('t.c1')::uuid, '11111111-0000-0000-0000-000000000004', 5, null, null)$$,
  'INV_CONFLICT%', 'new-line double insert (manager 2 also adds Delta A) -> INV_CONFLICT');
select t.ok(r.version = 3 and r.counted_qty = 9, 'manager 2 saves with the current version -> version 3')
  from public.inv_save_line(current_setting('t.c1')::uuid, '11111111-0000-0000-0000-000000000001', 9, 2, null) r;
select t.ok((select counted_by = 'aaaaaaaa-0000-0000-0000-000000000002' from public.inventory_count_lines
             where count_id = current_setting('t.c1')::uuid and product_id = '11111111-0000-0000-0000-000000000001'),
  'counted_by follows auth.uid() (now manager 2)');
select t.ok((select actor = 'aaaaaaaa-0000-0000-0000-000000000002'
                    and (detail->'before'->>'counted_qty')::int = 8 and (detail->'after'->>'counted_qty')::int = 9
             from public.inventory_events where kind = 'line_saved'
               and product_id = '11111111-0000-0000-0000-000000000001' order by id desc limit 1),
  'line_saved event: actor = manager 2, before 8 / after 9');
select t.ok((select counted_qty = 3 and version = 1 and counted_by = 'aaaaaaaa-0000-0000-0000-000000000001'
             from public.inventory_count_lines where count_id = current_setting('t.c1')::uuid
               and product_id = '11111111-0000-0000-0000-000000000004'),
  'the refused double insert left manager 1''s line intact');
commit;

-- ---------------------------------------------------------------------------
-- 8. Delete a line.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select t.throws($$select public.inv_delete_line(current_setting('t.c1')::uuid, '11111111-0000-0000-0000-000000000004', 7)$$,
  'INV_CONFLICT:3:1', 'delete with wrong version -> INV_CONFLICT:<qty>:<version>');
select public.inv_delete_line(current_setting('t.c1')::uuid, '11111111-0000-0000-0000-000000000004', 1);
select t.ok(t.rows($$select 1 from public.inventory_count_lines where count_id = current_setting('t.c1')::uuid
                     and product_id = '11111111-0000-0000-0000-000000000004'$$) = 0, 'delete line with current version');
select t.throws($$select public.inv_delete_line(current_setting('t.c1')::uuid, '11111111-0000-0000-0000-000000000004', 1)$$,
  'INV_CONFLICT', 'deleting an already deleted line -> INV_CONFLICT');
select t.throws($$select * from public.inv_save_line(current_setting('t.c1')::uuid, '11111111-0000-0000-0000-000000000004', 4, 1, null)$$,
  'INV_CONFLICT', 'saving with a version for a line someone deleted -> INV_CONFLICT');
select t.ok((select actor = 'aaaaaaaa-0000-0000-0000-000000000001' and (detail->>'counted_qty')::int = 3
             from public.inventory_events where kind = 'line_deleted' order by id desc limit 1),
  'line_deleted event with actor = manager 1');
select t.ok((select version from public.inventory_counts where id = current_setting('t.c1')::uuid) = 8, 'R4: deleting a line bumps the count version (7 -> 8)');
commit;

-- ---------------------------------------------------------------------------
-- 9. Approve.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select t.throws($$select public.inv_approve(current_setting('t.c2')::uuid, 1)$$, 'INV_EMPTY', 'approve needs at least one line');
select t.throws($$select public.inv_approve(current_setting('t.c1')::uuid, 1)$$, 'INV_CONFLICT:draft:8',
  'approve with wrong version -> INV_CONFLICT:<status>:<version>');
select t.throws($$select public.inv_approve(current_setting('t.c1')::uuid, 7)$$, 'INV_CONFLICT:draft:8',
  'R4: approve with the version rendered before the last line change -> INV_CONFLICT (list changed)');
select t.ok(public.inv_approve(current_setting('t.c1')::uuid, 8) = 'approved', 'approve returns ''approved''');
select t.ok((select status = 'approved' and version = 9 and approved_by = 'aaaaaaaa-0000-0000-0000-000000000001'
                    and approved_at is not null from public.inventory_counts where id = current_setting('t.c1')::uuid),
  'count is approved, approved_by = auth.uid(), version 9');
select t.throws($$select public.inv_approve(current_setting('t.c1')::uuid, 9)$$, 'INV_CONFLICT:approved:9',
  'double approve -> INV_CONFLICT:approved:9');
select t.throws($$select * from public.inv_save_line(current_setting('t.c1')::uuid, '11111111-0000-0000-0000-000000000002', 1, 1, null)$$,
  'INV_NOT_DRAFT:approved', 'saving a line on an approved count refused');
select t.throws($$select * from public.inv_save_line(current_setting('t.c1')::uuid, '11111111-0000-0000-0000-000000000008', 1, null, null)$$,
  'INV_NOT_DRAFT:approved', 'adding a line to an approved count refused');
select t.throws($$select public.inv_delete_line(current_setting('t.c1')::uuid, '11111111-0000-0000-0000-000000000002', 1)$$,
  'INV_NOT_DRAFT:approved', 'deleting a line on an approved count refused');
select t.throws($$select public.inv_cancel(current_setting('t.c1')::uuid, 9)$$, 'INV_CONFLICT:approved:9',
  'cancel only from draft (approved -> INV_CONFLICT)');
select t.ok((select (detail->>'lines')::int = 3 and (detail->>'total_counted')::int = 10000009
                    and actor = 'aaaaaaaa-0000-0000-0000-000000000001'
             from public.inventory_events where kind = 'count_approved' and count_id = current_setting('t.c1')::uuid),
  'count_approved event with a line summary and actor = manager 1');
commit;

select t.ok((select md5(string_agg(p::text, '|' order by p.id)) from public.products p) = current_setting('t.products_hash'),
  'after saves and approve, products table is byte-for-byte unchanged (stock_quantity untouched)');
select t.ok((select stock_quantity = 0 and name = 'Epsilon' from public.products where id = '11111111-0000-0000-0000-000000000008'),
  'uncounted product untouched');

-- ---------------------------------------------------------------------------
-- 10. Service role (the edge function) writes sync columns.
-- ---------------------------------------------------------------------------
begin;
set local role service_role;
do $$
declare n int;
begin
  update public.inventory_count_lines
     set sync_status = 'in_progress', sync_ref = coalesce(sync_ref, gen_random_uuid()), attempts = attempts + 1
   where count_id = current_setting('t.c1')::uuid and sync_status = 'pending';
  get diagnostics n = row_count;
  perform t.ok(n = 3, 'service_role claims lines: pending -> in_progress, sync_ref + attempts persisted');
end $$;
update public.inventory_count_lines set sync_status = 'changed', last_error = 'stock moved', rivhit_before_qty = 15
 where count_id = current_setting('t.c1')::uuid and product_id = '11111111-0000-0000-0000-000000000001';
update public.inventory_count_lines set sync_status = 'done', rivhit_doc_number = 'SIM-1', synced_at = now()
 where count_id = current_setting('t.c1')::uuid and product_id = '11111111-0000-0000-0000-000000000002';
update public.inventory_counts set status = 'needs_attention', mode = 'simulation', version = version + 1
 where id = current_setting('t.c1')::uuid;
insert into public.inventory_events (actor, count_id, kind, detail)
values (null, current_setting('t.c1')::uuid, 'sync_rollup', '{"status":"needs_attention"}');
do $$
declare v bigint; n int;
begin
  insert into public.inventory_events (kind) values ('tmp') returning id into v;
  update public.inventory_events set detail = '{"x":1}' where id = v;
  delete from public.inventory_events where id = v;
  get diagnostics n = row_count;
  perform t.ok(n = 1, 'service_role can insert/update/delete events');
end $$;
select t.ok((select sync_status = 'changed' and sync_ref is not null and attempts = 1
             from public.inventory_count_lines where count_id = current_setting('t.c1')::uuid
               and product_id = '11111111-0000-0000-0000-000000000001'),
  'service_role set the line to changed (sync_ref kept)');
commit;

-- The stock moved in Rivhit and rivhit-sync brought it in.
update public.products set stock_quantity = 15, updated_at = '2026-11-24 11:00+00'
where id = '11111111-0000-0000-0000-000000000001';
select set_config('t.products_hash', (select md5(string_agg(p::text, '|' order by p.id)) from public.products p), false);

-- ---------------------------------------------------------------------------
-- 11. Recount of a 'changed' line in a needs_attention count.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select t.throws($$select * from public.inv_save_line(current_setting('t.c1')::uuid, '11111111-0000-0000-0000-000000000001', 14, 2, null)$$,
  'INV_CONFLICT:9:3', 'recount still needs the current version');
select t.ok(r.version = 4 and r.counted_qty = 14 and r.baseline_qty = 15,
  'recount of a changed line allowed; new baseline 15 from products')
  from public.inv_save_line(current_setting('t.c1')::uuid, '11111111-0000-0000-0000-000000000001', 14, 3, null) r;
select t.ok((select sync_status = 'pending' and sync_ref is null and last_error is null
             from public.inventory_count_lines where count_id = current_setting('t.c1')::uuid
               and product_id = '11111111-0000-0000-0000-000000000001'),
  'recount resets sync_status = pending, sync_ref = null, last_error = null');
select t.ok((select (detail->>'recount')::boolean and actor = 'aaaaaaaa-0000-0000-0000-000000000001'
             from public.inventory_events where kind = 'line_saved' order by id desc limit 1),
  'recount logged as line_saved with recount = true');
select t.throws($$select * from public.inv_save_line(current_setting('t.c1')::uuid, '11111111-0000-0000-0000-000000000001', 13, 4, null)$$,
  'INV_NOT_DRAFT:needs_attention', 'after the recount the line is pending again: no further edits');
select t.throws($$select * from public.inv_save_line(current_setting('t.c1')::uuid, '11111111-0000-0000-0000-000000000002', 1, 1, null)$$,
  'INV_NOT_DRAFT:needs_attention', 'recount refused for a line that is not changed (done)');
select t.throws($$select * from public.inv_save_line(current_setting('t.c1')::uuid, '11111111-0000-0000-0000-000000000003', 1, 1, null)$$,
  'INV_NOT_DRAFT:needs_attention', 'recount refused for an in_progress line');
select t.throws($$select * from public.inv_save_line(current_setting('t.c1')::uuid, '11111111-0000-0000-0000-000000000008', 1, null, null)$$,
  'INV_NOT_DRAFT:needs_attention', 'no new lines in a needs_attention count');
select t.throws($$select public.inv_delete_line(current_setting('t.c1')::uuid, '11111111-0000-0000-0000-000000000001', 4)$$,
  'INV_NOT_DRAFT:needs_attention', 'no deletes in a needs_attention count');
select t.ok((select version from public.inventory_counts where id = current_setting('t.c1')::uuid) = 11, 'R4: the recount bumped the count version (10 -> 11)');
select t.throws($$select public.inv_cancel(current_setting('t.c1')::uuid, 11)$$, 'INV_CONFLICT:needs_attention:11',
  'cancel refused for needs_attention');
commit;

-- ---------------------------------------------------------------------------
-- 12. Cancel.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000002';
select t.throws($$select public.inv_cancel(current_setting('t.c2')::uuid, 9)$$, 'INV_CONFLICT:draft:1', 'cancel with wrong version refused');
select public.inv_cancel(current_setting('t.c2')::uuid, 1);
select t.ok((select status = 'cancelled' and finished_at is not null and version = 2
             from public.inventory_counts where id = current_setting('t.c2')::uuid), 'cancel a draft -> cancelled');
select t.ok((select actor = 'aaaaaaaa-0000-0000-0000-000000000002' from public.inventory_events
             where kind = 'count_cancelled' and count_id = current_setting('t.c2')::uuid), 'count_cancelled event, actor = manager 2');
select t.throws($$select public.inv_cancel(current_setting('t.c2')::uuid, 2)$$, 'INV_CONFLICT:cancelled:2', 'cancel twice refused');
select set_config('t.c3', public.inv_open_count(7, 'מחסן 7', null)::text, false);
select t.ok(current_setting('t.c3') <> current_setting('t.c2'), 'a cancelled count frees its storage for a new count');
select t.throws($$select public.inv_open_count(null, null, null)$$, 'INV_ACTIVE_EXISTS:%',
  'a needs_attention count still blocks a new count for its storage');
commit;

-- ---------------------------------------------------------------------------
-- 12b. R2: resolve stuck lines (inv_resolve_line) so a count can always close.
-- ---------------------------------------------------------------------------
-- Reviewer probe 3: a needs_attention count whose only line failed.
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select set_config('t.c9', public.inv_open_count(99, 'probe', 'probe 3')::text, false);
select set_config('t.l9', (select line_id::text from public.inv_save_line(current_setting('t.c9')::uuid,
  '11111111-0000-0000-0000-000000000009', 7, null, null)), false);
select t.ok(public.inv_approve(current_setting('t.c9')::uuid, 2) = 'approved', 'probe 3: count approved');
commit;
begin;
set local role service_role;
update public.inventory_count_lines set sync_status = 'failed', last_error = '-24 item not exists'
 where count_id = current_setting('t.c9')::uuid;
update public.inventory_counts set status = 'needs_attention', version = version + 1 where id = current_setting('t.c9')::uuid;
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select t.throws($$select public.inv_cancel(current_setting('t.c9')::uuid, 4)$$, 'INV_CONFLICT:needs_attention:4',
  'probe 3: a needs_attention count cannot be cancelled');
select t.throws($$select public.inv_open_count(99, null, 'next month')$$, 'INV_ACTIVE_EXISTS:' || current_setting('t.c9'),
  'probe 3: it blocks a new count for its storage');
select t.throws($$select * from public.inv_save_line(current_setting('t.c9')::uuid, '11111111-0000-0000-0000-000000000009', 9, 1, null)$$,
  'INV_NOT_DRAFT:needs_attention', 'probe 3: a failed line cannot be recounted');
select t.throws($$select public.inv_resolve_line(current_setting('t.l9')::uuid, 'ab')$$, 'INV_BAD_INPUT:note',
  'resolve: note shorter than 3 chars refused');
select t.throws($$select public.inv_resolve_line(current_setting('t.l9')::uuid, '   ')$$, 'INV_BAD_INPUT:note',
  'resolve: blank note refused');
select t.throws($$select public.inv_resolve_line(current_setting('t.l9')::uuid, null)$$, 'INV_BAD_INPUT:note',
  'resolve: missing note refused');
select t.throws($$select public.inv_resolve_line(current_setting('t.l9')::uuid, repeat('x', 501))$$, 'INV_BAD_INPUT:note',
  'resolve: note longer than 500 chars refused');
select t.throws($$select public.inv_resolve_line(gen_random_uuid(), 'note')$$, 'INV_NOT_FOUND', 'resolve: unknown line refused');
select t.ok(public.inv_resolve_line(current_setting('t.l9')::uuid, '  הפריט נמחק ברווחית  ') = 'done',
  'probe 3: resolving the failed line returns done (every line done/no_change/skipped)');
select t.ok((select c.status = 'done' and c.finished_at is not null and c.version = 5 and l.sync_status = 'skipped'
                    and l.last_error = '-24 item not exists'
             from public.inventory_counts c join public.inventory_count_lines l on l.count_id = c.id
             where c.id = current_setting('t.c9')::uuid),
  'probe 3: count done + finished_at, version bumped (R4), line skipped, last_error kept');
select t.ok((select actor = 'aaaaaaaa-0000-0000-0000-000000000001' and detail->>'before_status' = 'failed'
                    and detail->>'note' = 'הפריט נמחק ברווחית' and detail ? 'sync_ref' and detail ? 'rivhit_doc_number'
             from public.inventory_events where kind = 'line_skipped' and count_id = current_setting('t.c9')::uuid),
  'line_skipped event: actor, before_status, trimmed note, sync_ref, rivhit_doc_number');
select t.throws($$select public.inv_resolve_line(current_setting('t.l9')::uuid, 'again')$$, 'INV_NOT_RESOLVABLE:done:skipped',
  'resolve: a skipped line in a done count cannot be resolved again');
select t.ok(public.inv_open_count(99, 'probe', 'next month') is not null, 'probe 3: after closing, a new count can be opened');
commit;

-- Count 1: lines P1 pending (recounted), P2 done, P3 in_progress.
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000002';
select t.throws(format($$select public.inv_resolve_line(%L, 'note')$$, (select id from public.inventory_count_lines
    where count_id = current_setting('t.c1')::uuid and product_id = '11111111-0000-0000-0000-000000000001')),
  'INV_NOT_RESOLVABLE:needs_attention:pending', 'resolve refused for a pending line');
select t.throws(format($$select public.inv_resolve_line(%L, 'note')$$, (select id from public.inventory_count_lines
    where count_id = current_setting('t.c1')::uuid and product_id = '11111111-0000-0000-0000-000000000002')),
  'INV_NOT_RESOLVABLE:needs_attention:done', 'resolve refused for a done line');
select t.throws(format($$select public.inv_resolve_line(%L, 'note')$$, (select id from public.inventory_count_lines
    where count_id = current_setting('t.c1')::uuid and product_id = '11111111-0000-0000-0000-000000000003')),
  'INV_NOT_RESOLVABLE:needs_attention:in_progress', 'resolve refused for an in_progress line (the sync owns it)');
commit;
-- A failed line in a DRAFT count (storage 7) is not resolvable.
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select set_config('t.l3', (select line_id::text from public.inv_save_line(current_setting('t.c3')::uuid,
  '11111111-0000-0000-0000-000000000008', 1, null, null)), false);
commit;
begin;
set local role service_role;
update public.inventory_count_lines set sync_status = 'failed' where id = current_setting('t.l3')::uuid;
-- Count 1 after a sync pass: P1 changed again, P3 unknown with a document number.
update public.inventory_count_lines set sync_status = 'changed', last_error = 'stock moved'
 where count_id = current_setting('t.c1')::uuid and product_id = '11111111-0000-0000-0000-000000000001';
update public.inventory_count_lines set sync_status = 'unknown', rivhit_doc_number = 'SIM-3', last_error = 'timeout'
 where count_id = current_setting('t.c1')::uuid and product_id = '11111111-0000-0000-0000-000000000003';
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000002';
select t.throws($$select public.inv_resolve_line(current_setting('t.l3')::uuid, 'note')$$, 'INV_NOT_RESOLVABLE:draft:failed',
  'resolve refused outside needs_attention (draft count)');
select t.ok(public.inv_resolve_line((select id from public.inventory_count_lines where count_id = current_setting('t.c1')::uuid
              and product_id = '11111111-0000-0000-0000-000000000001'), 'נספר שוב בחודש הבא') = 'needs_attention',
  'resolve a changed line while another line is unknown -> count stays needs_attention');
select t.ok((select version from public.inventory_counts where id = current_setting('t.c1')::uuid) = 12, 'R4: inv_resolve_line bumps the count version (11 -> 12)');
select t.ok(public.inv_resolve_line((select id from public.inventory_count_lines where count_id = current_setting('t.c1')::uuid
              and product_id = '11111111-0000-0000-0000-000000000003'), 'בדקתי ברווחית, התעודה קיימת') = 'done',
  'resolve the last unknown line -> count done');
select t.ok((select sync_status = 'skipped' and sync_ref is not null and rivhit_doc_number = 'SIM-3'
             from public.inventory_count_lines where count_id = current_setting('t.c1')::uuid
               and product_id = '11111111-0000-0000-0000-000000000003'),
  'resolve keeps sync_ref and document fields untouched');
select t.ok((select status = 'done' and finished_at is not null and version = 13 from public.inventory_counts
             where id = current_setting('t.c1')::uuid), 'count 1 rolled up to done (P1 skipped, P2 done, P3 skipped)');
select t.ok((select count(*) = 2 and bool_and(actor = 'aaaaaaaa-0000-0000-0000-000000000002')
                    and bool_or(detail->>'rivhit_doc_number' = 'SIM-3' and detail->>'before_status' = 'unknown')
             from public.inventory_events where kind = 'line_skipped' and count_id = current_setting('t.c1')::uuid),
  'line_skipped events for count 1 with actor = manager 2 and the unknown line''s document number');
select t.ok(public.inv_open_count(null, 'מחסן ראשי', 'next month') is not null,
  'after count 1 is closed through resolve, a new count can be opened for its storage');
commit;

-- ---------------------------------------------------------------------------
-- 13. Item edit requests.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select t.throws($$select public.inv_request_item_edit('11111111-0000-0000-0000-000000000009', '', null, null)$$,
  'INV_BAD_INPUT:name', 'edit: empty name refused');
select t.throws($$select public.inv_request_item_edit('11111111-0000-0000-0000-000000000009', '   ', null, null)$$,
  'INV_BAD_INPUT:name', 'edit: blank name refused (trimmed)');
select t.throws($$select public.inv_request_item_edit('11111111-0000-0000-0000-000000000009', repeat('א', 101), null, null)$$,
  'INV_BAD_INPUT:name', 'edit: name of 101 chars refused');
select t.throws($$select public.inv_request_item_edit('11111111-0000-0000-0000-000000000009', null, 'AB 12', null)$$,
  'INV_BAD_CODE', 'edit: barcode with a space refused');
select t.throws($$select public.inv_request_item_edit('11111111-0000-0000-0000-000000000009', null, repeat('1', 16), null)$$,
  'INV_BAD_CODE', 'edit: barcode of 16 chars refused (max 15)');
select t.throws($$select public.inv_request_item_edit('11111111-0000-0000-0000-000000000009', null, null, 'ab_12')$$,
  'INV_BAD_CODE', 'edit: sku with _ refused');
select t.throws($$select public.inv_request_item_edit('11111111-0000-0000-0000-000000000009', null, null, '')$$,
  'INV_BAD_INPUT:sku', 'edit: sku cannot be cleared');
select t.throws($$select public.inv_request_item_edit('11111111-0000-0000-0000-000000000009', null, null, null)$$,
  'INV_NO_CHANGE', 'edit: nothing given -> INV_NO_CHANGE');
select t.throws($$select public.inv_request_item_edit('11111111-0000-0000-0000-000000000009', ' Zeta ', '', 'AB-12')$$,
  'INV_NO_CHANGE', 'edit: same name/sku and clearing an empty barcode -> INV_NO_CHANGE');
select t.throws($$select public.inv_request_item_edit('11111111-0000-0000-0000-000000000009', null, null, '7290000000011')$$,
  'INV_DUPLICATE_CODE:Alpha', 'edit: new sku equal to another active product''s sku -> INV_DUPLICATE_CODE:<name>');
select t.throws($$select public.inv_request_item_edit('11111111-0000-0000-0000-000000000009', null, 'BC-8', null)$$,
  'INV_DUPLICATE_CODE:Epsilon', 'edit: new barcode equal to another active product''s barcode -> INV_DUPLICATE_CODE');
select t.throws($$select public.inv_request_item_edit('11111111-0000-0000-0000-000000000009', null, '7290000000099', null)$$,
  'INV_DUPLICATE_CODE:Delta A', 'edit: new barcode equal to another product''s sku -> INV_DUPLICATE_CODE');
select t.throws($$select public.inv_request_item_edit('11111111-0000-0000-0000-000000000006', 'x', null, null)$$,
  'INV_PRODUCT_UNAVAILABLE', 'edit: inactive product refused');
select t.ok(public.inv_request_item_edit('11111111-0000-0000-0000-000000000004', 'Delta A (new)', null, null) is not null,
  'edit: name-only change allowed even though the unchanged sku is shared');
select set_config('t.r1', public.inv_request_item_edit('11111111-0000-0000-0000-000000000009', '  Zeta 2 ', '123456789012345', null)::text, false);
select t.ok((select status = 'pending' and rivhit_id = 109 and old_name = 'Zeta' and new_name = 'Zeta 2'
                    and old_barcode is null and new_barcode = '123456789012345'
                    and old_sku = 'AB-12' and new_sku = 'AB-12' and attempts = 0
                    and requested_by = 'aaaaaaaa-0000-0000-0000-000000000001'
             from public.product_edit_requests where id = current_setting('t.r1')::uuid),
  'edit request stored: pending, old/new values (unchanged sku copied), requested_by = auth.uid()');
select t.throws($$select public.inv_request_item_edit('11111111-0000-0000-0000-000000000009', 'Zeta 3', null, null)$$,
  'INV_EDIT_PENDING:' || current_setting('t.r1'), 'edit: one open request per product -> INV_EDIT_PENDING:<id>');
select t.ok((select actor = 'aaaaaaaa-0000-0000-0000-000000000001' and detail->'new'->>'name' = 'Zeta 2'
             from public.inventory_events where kind = 'item_edit_requested'
               and product_id = '11111111-0000-0000-0000-000000000009'),
  'item_edit_requested event with actor = manager 1');
commit;

select t.ok((select md5(string_agg(p::text, '|' order by p.id)) from public.products p) = current_setting('t.products_hash'),
  'edit requests, recount and cancel left products unchanged');

begin;
set local role service_role;
update public.product_edit_requests set status = 'done', finished_at = now() where id = current_setting('t.r1')::uuid;
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select t.ok(public.inv_request_item_edit('11111111-0000-0000-0000-000000000009', null, null, 'AB-13') is not null,
  'edit: a new request is allowed once the previous one is done');
-- R5, reviewer probe 1: the same new code on two products through open requests.
select set_config('t.r8', public.inv_request_item_edit('11111111-0000-0000-0000-000000000008', null, 'DUPX1', null)::text, false);
select t.throws($$select public.inv_request_item_edit('11111111-0000-0000-0000-000000000002', null, 'DUPX1', null)$$,
  'INV_DUPLICATE_CODE:Epsilon', 'R5: new barcode already requested for another product -> INV_DUPLICATE_CODE');
select t.throws($$select public.inv_request_item_edit('11111111-0000-0000-0000-000000000002', null, null, 'DUPX1')$$,
  'INV_DUPLICATE_CODE:Epsilon', 'R5: new sku equal to another open request''s new barcode -> INV_DUPLICATE_CODE');
select t.throws($$select public.inv_request_item_edit('11111111-0000-0000-0000-000000000002', null, 'AB-13', null)$$,
  'INV_DUPLICATE_CODE:Zeta', 'R5: new barcode equal to another open request''s new sku -> INV_DUPLICATE_CODE');
commit;
begin;
set local role service_role;
update public.product_edit_requests set status = 'failed', last_error = 'INV_DUPLICATE_CODE',
       rivhit_before = '{"item_id":108,"item_name":"Epsilon","barcode":"BC-8"}'::jsonb
 where id = current_setting('t.r8')::uuid;
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select t.ok((select rivhit_before->>'item_name' = 'Epsilon' from public.product_edit_requests where id = current_setting('t.r8')::uuid),
  'R6: service role stores the Rivhit snapshot in rivhit_before (jsonb); manager can read it');
select set_config('t.r2', public.inv_request_item_edit('11111111-0000-0000-0000-000000000002', null, 'DUPX1', null)::text, false);
select t.ok(current_setting('t.r2') <> '', 'R5: a failed (closed) request no longer reserves its code');
commit;

-- ---------------------------------------------------------------------------
-- 13b. Closing a stuck/waiting edit request (inv_close_item_edit).
-- ---------------------------------------------------------------------------
-- Beta's DUPX1 request gets stuck in unknown; Delta A's is being processed.
begin;
set local role service_role;
update public.product_edit_requests set status = 'unknown', attempts = 1, last_error = 'read-back mismatch: barcode'
 where id = current_setting('t.r2')::uuid;
update public.product_edit_requests set status = 'in_progress', attempts = 1
 where product_id = '11111111-0000-0000-0000-000000000004' and status = 'pending';
commit;
select set_config('t.products_hash', (select md5(string_agg(p::text, '|' order by p.id)) from public.products p), false);

begin;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000002';
select t.throws($$select public.inv_request_item_edit('11111111-0000-0000-0000-000000000008', null, 'DUPX1', null)$$,
  'INV_DUPLICATE_CODE:Beta', 'an unknown request still reserves its code');
select t.throws($$select public.inv_request_item_edit('11111111-0000-0000-0000-000000000002', 'Beta 2', null, null)$$,
  'INV_EDIT_PENDING:' || current_setting('t.r2'), 'an unknown request still blocks a new request for its product');
select t.throws($$select public.inv_close_item_edit(current_setting('t.r2')::uuid, 'ab')$$, 'INV_BAD_INPUT:note',
  'close edit: note shorter than 3 chars refused');
select t.throws($$select public.inv_close_item_edit(current_setting('t.r2')::uuid, null)$$, 'INV_BAD_INPUT:note',
  'close edit: missing note refused');
select t.throws($$select public.inv_close_item_edit(current_setting('t.r2')::uuid, repeat('x', 501))$$, 'INV_BAD_INPUT:note',
  'close edit: note longer than 500 chars refused');
select t.throws($$select public.inv_close_item_edit(gen_random_uuid(), 'note')$$, 'INV_NOT_FOUND', 'close edit: unknown request refused');
select t.throws($$select public.inv_close_item_edit(current_setting('t.r1')::uuid, 'note')$$, 'INV_NOT_RESOLVABLE:done',
  'close edit: done request refused');
select t.throws(format($$select public.inv_close_item_edit(%L, 'note')$$, (select id from public.product_edit_requests
    where product_id = '11111111-0000-0000-0000-000000000004')), 'INV_NOT_RESOLVABLE:in_progress',
  'close edit: in_progress request refused (the engine owns it)');
select public.inv_close_item_edit(current_setting('t.r2')::uuid, '  בדקתי ברווחית, לא עודכן  ');
select t.ok((select status = 'cancelled' and finished_at is not null and new_barcode = 'DUPX1' and attempts = 1
                    and last_error = 'read-back mismatch: barcode' and old_name = 'Beta'
             from public.product_edit_requests where id = current_setting('t.r2')::uuid),
  'close edit: unknown -> cancelled, finished_at set, every other field kept');
select t.ok((select actor = 'aaaaaaaa-0000-0000-0000-000000000002' and detail->>'before_status' = 'unknown'
                    and detail->>'note' = 'בדקתי ברווחית, לא עודכן' and detail->>'last_error' = 'read-back mismatch: barcode'
                    and product_id = '11111111-0000-0000-0000-000000000002'
             from public.inventory_events where kind = 'item_edit_cancelled' and detail->>'request_id' = current_setting('t.r2')),
  'item_edit_cancelled event: actor, before_status, trimmed note, last_error');
select t.throws($$select public.inv_close_item_edit(current_setting('t.r2')::uuid, 'again')$$, 'INV_NOT_RESOLVABLE:cancelled',
  'close edit: cancelled request refused');
select t.ok(public.inv_request_item_edit('11111111-0000-0000-0000-000000000008', null, 'DUPX1', null) is not null,
  'after cancel the code is no longer reserved (another product may request it)');
select t.ok(public.inv_request_item_edit('11111111-0000-0000-0000-000000000002', 'Beta 2', null, null) is not null,
  'after cancel a new request for the same product can be created');
select public.inv_close_item_edit(current_setting('t.r8')::uuid, 'duplicate, closed');
select t.ok((select status = 'cancelled' and rivhit_before is not null from public.product_edit_requests
                 where id = current_setting('t.r8')::uuid),
  'close edit: failed request -> cancelled (rivhit_before kept)');
select set_config('t.r9', (select id::text from public.product_edit_requests
  where product_id = '11111111-0000-0000-0000-000000000009' and status = 'pending'), false);
select public.inv_close_item_edit(current_setting('t.r9')::uuid, 'no longer needed');
select t.ok((select status = 'cancelled' and new_sku = 'AB-13' from public.product_edit_requests where id = current_setting('t.r9')::uuid),
  'close edit: pending request -> cancelled');
select t.ok(public.inv_request_item_edit('11111111-0000-0000-0000-000000000009', 'Zeta 4', null, null) is not null,
  'after closing a pending request the product can be edited again');
commit;
select t.ok((select md5(string_agg(p::text, '|' order by p.id)) from public.products p) = current_setting('t.products_hash'),
  'closing edit requests left products unchanged');

-- ---------------------------------------------------------------------------
-- 14. Manager cannot write the tables directly; events are append-only.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select t.throws($$insert into public.inventory_counts (created_by) values (auth.uid())$$, '%permission denied%',
  'manager cannot INSERT inventory_counts directly');
select t.throws($$update public.inventory_counts set status = 'done'$$, '%permission denied%', 'manager cannot UPDATE inventory_counts directly');
select t.throws($$update public.inventory_count_lines set counted_qty = 1$$, '%permission denied%', 'manager cannot UPDATE lines directly');
select t.throws($$delete from public.inventory_count_lines$$, '%permission denied%', 'manager cannot DELETE lines directly');
select t.throws($$insert into public.inventory_events (kind) values ('fake')$$, '%permission denied%', 'manager cannot INSERT events directly');
select t.throws($$update public.inventory_events set actor = null$$, '%permission denied%', 'manager cannot UPDATE events');
select t.throws($$delete from public.inventory_events$$, '%permission denied%', 'manager cannot DELETE events');
select t.throws($$update public.inventory_settings set rivhit_writes_enabled = true$$, '%permission denied%', 'manager cannot UPDATE settings directly');
select t.throws($$update public.product_edit_requests set status = 'done'$$, '%permission denied%', 'manager cannot UPDATE edit requests directly');
select t.throws($$select public.inv_log(null, null, 'fake', '{}')$$, '%permission denied%', 'manager cannot call the internal inv_log()');
select t.ok(t.rows('select 1 from public.inventory_settings') = 1 and t.rows('select 1 from public.inventory_counts') = 6
            and t.rows('select 1 from public.inventory_count_lines') = 5 and t.rows('select 1 from public.product_edit_requests') = 8,
  'manager SELECTs all inventory tables');
commit;

-- ---------------------------------------------------------------------------
-- 15. Events: kinds and actors.
-- ---------------------------------------------------------------------------
select t.ok((select array_agg(distinct kind order by kind) from public.inventory_events)
            = array['count_approved', 'count_cancelled', 'count_opened', 'item_edit_cancelled', 'item_edit_requested', 'line_deleted', 'line_saved', 'line_skipped', 'sync_rollup'],
  'inventory_events has every kind (count_opened, line_saved, line_deleted, count_approved, count_cancelled, item_edit_requested, line_skipped, item_edit_cancelled)');
select t.ok(not exists (select 1 from public.inventory_events where kind <> 'sync_rollup'
                        and (actor is null or actor not in ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002'))),
  'every RPC event has actor = the calling manager (none null, none spoofed)');
select t.ok(not exists (select 1 from public.inventory_count_lines l
                        where l.counted_by <> (select e.actor from public.inventory_events e
                                               where e.kind = 'line_saved' and (e.detail->>'line_id')::uuid = l.id
                                               order by e.id desc limit 1)),
  'each line''s counted_by equals the actor of its last line_saved event');

-- ---------------------------------------------------------------------------
-- 16. Customer and agent: refused everywhere, see nothing.
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000001';
update public.profiles set role = 'manager' where id = auth.uid();
select t.ok((select role from public.profiles where id = auth.uid()) = 'customer',
  'customer updating own role to manager: role stays customer (trg_protect_privileged_cols)');
select t.ok(not public.is_manager(), 'customer is still not a manager');
commit;

-- The same checks for the customer and the agent (run as the current role).
create function t.refused_checks(who text) returns void language plpgsql as $f$
declare
  c1 text := current_setting('t.c1');
  tbl text;
begin
  perform t.throws($$select * from public.inv_lookup('7290000000011')$$, 'להנהלה בלבד', who || ' refused by inv_lookup');
  perform t.throws($$select * from public.inv_search('Alpha')$$,         'להנהלה בלבד', who || ' refused by inv_search');
  perform t.throws($$select public.inv_open_count(55, 'x', null)$$,      'להנהלה בלבד', who || ' refused by inv_open_count');
  perform t.throws(format($$select * from public.inv_save_line(%L, '11111111-0000-0000-0000-000000000008', 1, null, null)$$, c1),
    'להנהלה בלבד', who || ' refused by inv_save_line');
  perform t.throws(format($$select public.inv_delete_line(%L, '11111111-0000-0000-0000-000000000002', 1)$$, c1),
    'להנהלה בלבד', who || ' refused by inv_delete_line');
  perform t.throws(format($$select public.inv_approve(%L, 1)$$, current_setting('t.c3')), 'להנהלה בלבד', who || ' refused by inv_approve');
  perform t.throws(format($$select public.inv_cancel(%L, 1)$$, current_setting('t.c3')),  'להנהלה בלבד', who || ' refused by inv_cancel');
  perform t.throws($$select public.inv_request_item_edit('11111111-0000-0000-0000-000000000008', 'x', null, null)$$,
    'להנהלה בלבד', who || ' refused by inv_request_item_edit');
  perform t.throws(format($$select public.inv_resolve_line(%L, 'note')$$, current_setting('t.l9')),
    'להנהלה בלבד', who || ' refused by inv_resolve_line');
  perform t.throws(format($$select public.inv_close_item_edit(%L, 'note')$$, current_setting('t.r1')),
    'להנהלה בלבד', who || ' refused by inv_close_item_edit');
  perform t.throws($$select public.inv_log(null, null, 'x', '{}')$$, '%permission denied%', who || ' cannot call inv_log');
  foreach tbl in array array['inventory_settings', 'inventory_counts', 'inventory_count_lines', 'inventory_events', 'product_edit_requests'] loop
    perform t.ok(t.rows('select 1 from public.' || tbl) = 0, who || ' sees 0 rows in ' || tbl || ' (rows exist)');
  end loop;
  perform t.throws($$insert into public.inventory_counts (created_by) values (auth.uid())$$, '%permission denied%', who || ' cannot INSERT inventory_counts');
  perform t.throws($$insert into public.inventory_count_lines (count_id, product_id, rivhit_id, product_name, counted_qty, baseline_qty, counted_by, counted_at)
                     values (gen_random_uuid(), gen_random_uuid(), 1, 'x', 1, 1, auth.uid(), now())$$, '%permission denied%', who || ' cannot INSERT lines');
  perform t.throws($$insert into public.inventory_events (kind) values ('x')$$, '%permission denied%', who || ' cannot INSERT events');
  perform t.throws($$insert into public.product_edit_requests (product_id, rivhit_id, requested_by) values (gen_random_uuid(), 1, auth.uid())$$,
    '%permission denied%', who || ' cannot INSERT edit requests');
  perform t.throws($$update public.inventory_counts set status = 'done'$$, '%permission denied%', who || ' cannot UPDATE inventory_counts');
  perform t.throws($$update public.inventory_count_lines set counted_qty = 1$$, '%permission denied%', who || ' cannot UPDATE lines');
  perform t.throws($$update public.inventory_settings set rivhit_writes_enabled = true$$, '%permission denied%', who || ' cannot UPDATE settings');
  perform t.throws($$update public.inventory_events set actor = null$$, '%permission denied%', who || ' cannot UPDATE events');
  perform t.throws($$delete from public.inventory_count_lines$$, '%permission denied%', who || ' cannot DELETE lines');
  perform t.throws($$delete from public.inventory_counts$$, '%permission denied%', who || ' cannot DELETE inventory_counts');
  perform t.throws($$delete from public.inventory_events$$, '%permission denied%', who || ' cannot DELETE events');
  perform t.throws($$delete from public.product_edit_requests$$, '%permission denied%', who || ' cannot DELETE edit requests');
end $f$;

begin;
set local role authenticated;
set local request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000001';
select t.refused_checks('customer (after trying to self-promote)');
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = 'dddddddd-0000-0000-0000-000000000001';
select t.refused_checks('agent');
commit;

-- ---------------------------------------------------------------------------
-- 17. Re-run the migration a third time, now WITH data.
-- ---------------------------------------------------------------------------
select set_config('t.data_fp', (select md5(concat_ws('#',
  (select string_agg(c::text, '|' order by c.id) from public.inventory_counts c),
  (select string_agg(l::text, '|' order by l.id) from public.inventory_count_lines l),
  (select string_agg(e::text, '|' order by e.id) from public.inventory_events e),
  (select string_agg(r::text, '|' order by r.id) from public.product_edit_requests r),
  (select string_agg(s::text, '|') from public.inventory_settings s)))), false);
set client_min_messages to warning;
\ir ../2026-11-inventory-count.sql
set client_min_messages to notice;
select t.ok((select md5(concat_ws('#',
  (select string_agg(c::text, '|' order by c.id) from public.inventory_counts c),
  (select string_agg(l::text, '|' order by l.id) from public.inventory_count_lines l),
  (select string_agg(e::text, '|' order by e.id) from public.inventory_events e),
  (select string_agg(r::text, '|' order by r.id) from public.product_edit_requests r),
  (select string_agg(s::text, '|') from public.inventory_settings s)))) = current_setting('t.data_fp'),
  'migration re-run on a database with data: every row preserved');
select t.ok(t.existing_fingerprint() = current_setting('t.fp_before'), 'existing objects still untouched after the third run');

\o
\echo 'ALL INVENTORY TESTS PASSED'
