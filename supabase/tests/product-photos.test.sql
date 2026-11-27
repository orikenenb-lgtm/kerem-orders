-- Tests for supabase/2026-11-product-photos.sql. THROWAWAY database only.
--   psql ... -v ON_ERROR_STOP=1 -f supabase/tests/product-photos.test.sql
\set ON_ERROR_STOP 1
\ir inventory-prod-replica.sql
-- Minimal stand-in for Supabase Storage (only what the migration touches).
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
\ir ../2026-11-inventory-count.sql
\ir ../2026-11-product-photos.sql
\ir ../2026-11-product-photos.sql

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'm1@test'),
  ('cccccccc-0000-0000-0000-000000000001', 'cu@test');
insert into public.profiles (id, role, full_name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'manager',  'Manager One'),
  ('cccccccc-0000-0000-0000-000000000001', 'customer', 'Customer');
insert into public.products (id, name, sku, rivhit_id, stock_quantity, is_active, picture_link, updated_at) values
  ('11111111-0000-0000-0000-000000000001', 'WithRivhitPic', 'A1', 101, 1, true, 'https://api.rivhit.co.il/online/FileService.svc/getItemPic/r/1.jpg', now()),
  ('11111111-0000-0000-0000-000000000002', 'NoRivhitPic',   'B1', 102, 1, true, '', now()),
  ('11111111-0000-0000-0000-000000000003', 'Untouched',     'C1', 103, 1, true, 'https://api.rivhit.co.il/online/FileService.svc/getItemPic/r/3.jpg', now());
insert into storage.objects (bucket_id, name) values
  ('product-photos', '11111111-0000-0000-0000-000000000001/1795700000001.jpg'),
  ('product-photos', '11111111-0000-0000-0000-000000000002/1795700000002.jpg');

do $$ begin
  if not exists (select 1 from storage.buckets where id = 'product-photos' and public and allowed_mime_types = array['image/jpeg']) then
    raise exception 'FAIL: bucket';
  end if;
end $$;

-- The trigger is a no-op for products without an upload (a "sync" write).
update public.products set picture_link = 'https://api.rivhit.co.il/online/FileService.svc/getItemPic/r/3b.jpg'
where id = '11111111-0000-0000-0000-000000000003';
do $$ begin
  if (select picture_link from public.products where id = '11111111-0000-0000-0000-000000000003')
     <> 'https://api.rivhit.co.il/online/FileService.svc/getItemPic/r/3b.jpg' then raise exception 'FAIL: untouched product changed'; end if;
end $$;

-- Manager: set photos
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$
declare v text; ok boolean;
  u1 text := 'https://proj.supabase.co/storage/v1/object/public/product-photos/11111111-0000-0000-0000-000000000001/1795700000001.jpg';
  u2 text := 'https://proj.supabase.co/storage/v1/object/public/product-photos/11111111-0000-0000-0000-000000000002/1795700000002.jpg';
begin
  -- replace mode on a product WITH a Rivhit photo → shows the upload
  v := public.inv_set_product_photo('11111111-0000-0000-0000-000000000001', u1, true);
  if v <> u1 then raise exception 'FAIL: replace shows upload (got %)', v; end if;

  -- only-if-missing on a product WITHOUT a Rivhit photo → shows the upload
  v := public.inv_set_product_photo('11111111-0000-0000-0000-000000000002', u2, false);
  if v <> u2 then raise exception 'FAIL: missing-mode shows upload'; end if;

  -- bad urls / missing objects / wrong product folder
  foreach v in array array[
    'https://proj.supabase.co/storage/v1/object/public/product-photos/11111111-0000-0000-0000-000000000001/999.jpg',
    'https://evil.com/storage/v1/object/public/product-photos/11111111-0000-0000-0000-000000000001/1795700000001.jpg',
    u2, 'javascript:alert(1)', ''] loop
    ok := false;
    begin perform public.inv_set_product_photo('11111111-0000-0000-0000-000000000001', v, true);
    exception when others then ok := sqlerrm = 'INV_BAD_INPUT:photo'; end;
    if not ok then raise exception 'FAIL: bad url accepted: %', v; end if;
  end loop;
end $$;
commit;

-- A Rivhit sync rewrites picture_link (what rivhit-sync does every 15 min).
update public.products set picture_link = 'https://api.rivhit.co.il/online/FileService.svc/getItemPic/r/1.jpg'
where id = '11111111-0000-0000-0000-000000000001';
update public.products set picture_link = '' where id = '11111111-0000-0000-0000-000000000002';
do $$ begin
  if (select picture_link from public.products where id = '11111111-0000-0000-0000-000000000001') not like '%/product-photos/%' then
    raise exception 'FAIL: sync overwrote a replace-mode upload'; end if;
  if (select picture_link from public.products where id = '11111111-0000-0000-0000-000000000002') not like '%/product-photos/%' then
    raise exception 'FAIL: sync blanked a missing-mode upload'; end if;
end $$;

-- Rivhit gets its own photo for product 2 → Rivhit wins in missing-mode.
update public.products set picture_link = 'https://api.rivhit.co.il/online/FileService.svc/getItemPic/r/2.jpg'
where id = '11111111-0000-0000-0000-000000000002';
do $$ begin
  if (select picture_link from public.products where id = '11111111-0000-0000-0000-000000000002')
     <> 'https://api.rivhit.co.il/online/FileService.svc/getItemPic/r/2.jpg' then raise exception 'FAIL: rivhit photo should win in missing-mode'; end if;
  if (select rivhit_picture_link from public.product_photos where product_id = '11111111-0000-0000-0000-000000000002')
     <> 'https://api.rivhit.co.il/online/FileService.svc/getItemPic/r/2.jpg' then raise exception 'FAIL: rivhit link remembered'; end if;
end $$;

-- Remove → back to Rivhit's link at once.
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$
declare v text; ok boolean := false;
begin
  v := public.inv_remove_product_photo('11111111-0000-0000-0000-000000000001');
  if v <> 'https://api.rivhit.co.il/online/FileService.svc/getItemPic/r/1.jpg' then raise exception 'FAIL: remove restores rivhit (got %)', v; end if;
  begin perform public.inv_remove_product_photo('11111111-0000-0000-0000-000000000001');
  exception when others then ok := sqlerrm = 'INV_NO_CHANGE'; end;
  if not ok then raise exception 'FAIL: double remove'; end if;
  if (select count(*) from public.inventory_events where kind in ('photo_set', 'photo_removed')) < 3 then raise exception 'FAIL: history'; end if;
end $$;
commit;

-- Customers / anon cannot use it.
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000001';
do $$
declare ok boolean := false;
begin
  begin perform public.inv_set_product_photo('11111111-0000-0000-0000-000000000001',
    'https://proj.supabase.co/storage/v1/object/public/product-photos/11111111-0000-0000-0000-000000000001/1795700000001.jpg', true);
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: customer set photo'; end if;
  if exists (select 1 from public.product_photos) then raise exception 'FAIL: customer reads product_photos'; end if;
end $$;
rollback;
do $$ begin
  if has_function_privilege('anon', 'public.inv_set_product_photo(uuid,text,boolean)', 'execute') then raise exception 'FAIL: anon'; end if;
  if has_function_privilege('authenticated', 'public.product_photo_apply()', 'execute') then raise exception 'FAIL: trigger fn exposed'; end if;
end $$;

select 'ALL PRODUCT-PHOTO CHECKS PASSED' as result;
