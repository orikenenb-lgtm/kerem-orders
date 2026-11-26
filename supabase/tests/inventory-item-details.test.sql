-- Tests for supabase/2026-11-inventory-item-details.sql (price + description).
-- Run on a THROWAWAY database (see README-inventory.md):
--   psql ... -v ON_ERROR_STOP=1 -f supabase/tests/inventory-item-details.test.sql
-- The first failure stops the run with ERROR: FAIL: <check>.

\set ON_ERROR_STOP 1
\ir inventory-prod-replica.sql
\ir ../2026-11-inventory-count.sql
\ir ../2026-11-inventory-item-details.sql
\ir ../2026-11-inventory-item-details.sql

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'm1@test'),
  ('cccccccc-0000-0000-0000-000000000001', 'cu@test');
insert into public.profiles (id, role, full_name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'manager',  'Manager One'),
  ('cccccccc-0000-0000-0000-000000000001', 'customer', 'Customer');
insert into public.products (id, name, sku, barcode, rivhit_id, stock_quantity, is_active, price, description, updated_at) values
  ('11111111-0000-0000-0000-000000000001', 'Alpha', 'A1', null, 101, 10, true, 12.90, null,   now()),
  ('11111111-0000-0000-0000-000000000002', 'Beta',  'B1', null, 102,  5, true,  4.50, 'קיים', now());

-- the old function is untouched and still works
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$
declare v uuid; r record;
begin
  v := public.inv_request_item_edit('11111111-0000-0000-0000-000000000001', 'Alpha 2', null, null);
  select * into r from public.product_edit_requests where id = v;
  if r.new_name <> 'Alpha 2' or r.new_price is not null or r.old_price is not null then raise exception 'FAIL: v1 unchanged'; end if;
end $$;
rollback;

-- details + v2
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$
declare v uuid; r record; d record; ok boolean;
begin
  select * into d from public.inv_item_details('11111111-0000-0000-0000-000000000002');
  if d.price <> 4.50 or d.description <> 'קיים' then raise exception 'FAIL: inv_item_details'; end if;

  v := public.inv_request_item_edit_v2('11111111-0000-0000-0000-000000000001', null, null, null, 14.50, '  רובוט מדבר  ');
  select * into r from public.product_edit_requests where id = v;
  if r.old_price <> 12.90 or r.new_price <> 14.50 then raise exception 'FAIL: price recorded'; end if;
  if r.old_description <> '' or r.new_description <> 'רובוט מדבר' then raise exception 'FAIL: description recorded'; end if;
  if r.new_name <> 'Alpha' or r.new_sku <> 'A1' then raise exception 'FAIL: untouched fields copied'; end if;
  if (select price from public.products where id = '11111111-0000-0000-0000-000000000001') <> 12.90 then
    raise exception 'FAIL: product must not change locally';
  end if;

  -- a second request while one is open → INV_EDIT_PENDING
  ok := false;
  begin perform public.inv_request_item_edit_v2('11111111-0000-0000-0000-000000000001', null, null, null, 15, null);
  exception when others then ok := sqlerrm like 'INV_EDIT_PENDING:%'; end;
  if not ok then raise exception 'FAIL: pending guard'; end if;

  -- bad inputs on the other product
  foreach d.price in array array[0, -1, 100001, 1.234]::numeric[] loop
    ok := false;
    begin perform public.inv_request_item_edit_v2('11111111-0000-0000-0000-000000000002', null, null, null, d.price, null);
    exception when others then ok := sqlerrm = 'INV_BAD_INPUT:price'; end;
    if not ok then raise exception 'FAIL: bad price % accepted', d.price; end if;
  end loop;
  ok := false;
  begin perform public.inv_request_item_edit_v2('11111111-0000-0000-0000-000000000002', null, null, null, null, '   ');
  exception when others then ok := sqlerrm = 'INV_BAD_INPUT:description'; end;
  if not ok then raise exception 'FAIL: empty description accepted'; end if;
  ok := false;
  begin perform public.inv_request_item_edit_v2('11111111-0000-0000-0000-000000000002', null, null, null, null, repeat('x', 501));
  exception when others then ok := sqlerrm = 'INV_BAD_INPUT:description'; end;
  if not ok then raise exception 'FAIL: long description accepted'; end if;
  ok := false;
  begin perform public.inv_request_item_edit_v2('11111111-0000-0000-0000-000000000002', null, null, null, 4.5, 'קיים');
  exception when others then ok := sqlerrm = 'INV_NO_CHANGE'; end;
  if not ok then raise exception 'FAIL: no-change accepted'; end if;
end $$;
rollback;

-- customers and anon are refused
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000001';
do $$
declare ok boolean := false;
begin
  begin perform public.inv_item_details('11111111-0000-0000-0000-000000000001');
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: customer read details'; end if;
  ok := false;
  begin perform public.inv_request_item_edit_v2('11111111-0000-0000-0000-000000000001', null, null, null, 20, null);
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: customer requested edit'; end if;
end $$;
rollback;

do $$
begin
  if has_function_privilege('anon', 'public.inv_item_details(uuid)', 'execute') then raise exception 'FAIL: anon details'; end if;
  if has_function_privilege('anon', 'public.inv_request_item_edit_v2(uuid,text,text,text,numeric,text)', 'execute') then
    raise exception 'FAIL: anon v2';
  end if;
end $$;

select 'ALL ITEM-DETAILS CHECKS PASSED' as result;
