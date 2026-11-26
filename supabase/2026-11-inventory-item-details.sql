-- Stock count: edit PRICE and DESCRIPTION from the item screen (additive).
--
-- Rivhit is the source of truth: rivhit-sync copies sale_nis -> products.price
-- and item_extended_description -> products.description every 15 minutes.
-- So, exactly like name / barcode / sku, the site never edits these locally:
-- a request row is recorded here, inventory-sync writes it to Rivhit with
-- Item.Update (full record), reads it back, and only then updates the site.
--
-- What this adds (nothing existing is altered or dropped):
--   * 4 nullable columns on product_edit_requests (old/new price, old/new
--     description). Existing rows and the existing RPC are unaffected.
--   * inv_item_details(product_id)      manager-only read of price + description
--   * inv_request_item_edit_v2(...)     v1 + p_new_price + p_new_description.
--     inv_request_item_edit (v1) stays exactly as it is.
--
-- Rules:
--   * price: null = unchanged; else > 0 and <= 100000, at most 2 decimals.
--     (0 is refused: rivhit-sync drops items with sale_nis <= 0 from the site.)
--   * description: null = unchanged; else trimmed, 1..500 chars (Rivhit's
--     documented length). Clearing is not supported by Rivhit's API.
--
-- ROLLBACK (only if never used; removes the edit history of price/description):
--   drop function if exists public.inv_request_item_edit_v2(uuid, text, text, text, numeric, text);
--   drop function if exists public.inv_item_details(uuid);
--   alter table public.product_edit_requests
--     drop column if exists old_price, drop column if exists new_price,
--     drop column if exists old_description, drop column if exists new_description;

alter table public.product_edit_requests
  add column if not exists old_price       numeric(12,2),
  add column if not exists new_price       numeric(12,2),
  add column if not exists old_description text,
  add column if not exists new_description text;

create or replace function public.inv_item_details(p_product_id uuid)
returns table (product_id uuid, price numeric, description text)
language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if not public.is_manager() then raise exception 'להנהלה בלבד'; end if;
  return query
    select p.id, p.price, coalesce(p.description, '')
    from public.products p
    where p.id = p_product_id;
end;
$$;
revoke all on function public.inv_item_details(uuid) from public, anon;
grant execute on function public.inv_item_details(uuid) to authenticated;

create or replace function public.inv_request_item_edit_v2(
  p_product_id uuid, p_new_name text, p_new_barcode text, p_new_sku text,
  p_new_price numeric default null, p_new_description text default null
)
returns uuid
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_prod    public.products%rowtype;
  v_name    text;
  v_barcode text;
  v_sku     text;
  v_price   numeric(12,2);
  v_desc    text;
  v_dup     text;
  v_open    uuid;
  v_id      uuid;
begin
  if not public.is_manager() then raise exception 'להנהלה בלבד'; end if;

  select * into v_prod from public.products p where p.id = p_product_id;
  if not found then raise exception 'INV_NOT_FOUND'; end if;
  if not coalesce(v_prod.is_active, false) or v_prod.rivhit_id is null then
    raise exception 'INV_PRODUCT_UNAVAILABLE';
  end if;

  -- Name: null = unchanged; otherwise trimmed, 1-100 chars.
  if p_new_name is null then
    v_name := v_prod.name;
  else
    v_name := btrim(p_new_name);
    if length(v_name) < 1 or length(v_name) > 100 then raise exception 'INV_BAD_INPUT:name'; end if;
  end if;

  -- Barcode: null = unchanged, '' = clear, else 1-15 of [0-9A-Za-z-].
  if p_new_barcode is null then
    v_barcode := v_prod.barcode;
  else
    v_barcode := btrim(p_new_barcode);
    if v_barcode <> '' and v_barcode !~ '^[0-9A-Za-z-]{1,15}$' then raise exception 'INV_BAD_CODE'; end if;
  end if;

  -- Sku: null = unchanged, '' is refused (the scan code cannot be cleared).
  if p_new_sku is null then
    v_sku := v_prod.sku;
  else
    v_sku := btrim(p_new_sku);
    if v_sku = '' then raise exception 'INV_BAD_INPUT:sku'; end if;
    if v_sku !~ '^[0-9A-Za-z-]{1,15}$' then raise exception 'INV_BAD_CODE'; end if;
  end if;

  -- Price: null = unchanged; > 0, <= 100000, at most 2 decimals.
  if p_new_price is null then
    v_price := v_prod.price;
  else
    if p_new_price <= 0 or p_new_price > 100000 or p_new_price <> round(p_new_price, 2) then
      raise exception 'INV_BAD_INPUT:price';
    end if;
    v_price := p_new_price;
  end if;

  -- Description: null = unchanged; else trimmed 1-500 chars.
  if p_new_description is null then
    v_desc := coalesce(v_prod.description, '');
  else
    v_desc := btrim(p_new_description);
    if length(v_desc) < 1 or length(v_desc) > 500 then raise exception 'INV_BAD_INPUT:description'; end if;
  end if;

  if v_name is not distinct from v_prod.name
     and coalesce(v_barcode, '') = coalesce(v_prod.barcode, '')
     and coalesce(v_sku, '') = coalesce(v_prod.sku, '')
     and v_price is not distinct from v_prod.price
     and v_desc = coalesce(v_prod.description, '') then
    raise exception 'INV_NO_CHANGE';
  end if;

  -- A NEW code must not already identify another active product (as v1).
  if coalesce(v_barcode, '') <> '' and coalesce(v_barcode, '') <> coalesce(v_prod.barcode, '') then
    select p.name into v_dup from public.products p
    where p.id <> p_product_id and p.is_active and (p.sku = v_barcode or p.barcode = v_barcode)
    order by p.name limit 1;
    if found then raise exception 'INV_DUPLICATE_CODE:%', coalesce(v_dup, ''); end if;
    select p.name into v_dup from public.product_edit_requests r join public.products p on p.id = r.product_id
    where r.product_id <> p_product_id and r.status in ('pending', 'in_progress', 'unknown')
      and (r.new_barcode = v_barcode or r.new_sku = v_barcode)
    order by p.name limit 1;
    if found then raise exception 'INV_DUPLICATE_CODE:%', coalesce(v_dup, ''); end if;
  end if;
  if coalesce(v_sku, '') <> coalesce(v_prod.sku, '') then
    select p.name into v_dup from public.products p
    where p.id <> p_product_id and p.is_active and (p.sku = v_sku or p.barcode = v_sku)
    order by p.name limit 1;
    if found then raise exception 'INV_DUPLICATE_CODE:%', coalesce(v_dup, ''); end if;
    select p.name into v_dup from public.product_edit_requests r join public.products p on p.id = r.product_id
    where r.product_id <> p_product_id and r.status in ('pending', 'in_progress', 'unknown')
      and (r.new_barcode = v_sku or r.new_sku = v_sku)
    order by p.name limit 1;
    if found then raise exception 'INV_DUPLICATE_CODE:%', coalesce(v_dup, ''); end if;
  end if;

  select r.id into v_open from public.product_edit_requests r
  where r.product_id = p_product_id and r.status in ('pending', 'in_progress', 'unknown')
  limit 1;
  if v_open is not null then raise exception 'INV_EDIT_PENDING:%', v_open; end if;

  begin
    insert into public.product_edit_requests
      (product_id, rivhit_id, old_name, new_name, old_barcode, new_barcode, old_sku, new_sku,
       old_price, new_price, old_description, new_description, requested_by)
    values
      (p_product_id, v_prod.rivhit_id, v_prod.name, v_name, v_prod.barcode, v_barcode, v_prod.sku, v_sku,
       v_prod.price, v_price, coalesce(v_prod.description, ''), v_desc, auth.uid())
    returning id into v_id;
  exception when unique_violation then
    select r.id into v_open from public.product_edit_requests r
    where r.product_id = p_product_id and r.status in ('pending', 'in_progress', 'unknown')
    limit 1;
    raise exception 'INV_EDIT_PENDING:%', v_open;
  end;

  perform public.inv_log(null, p_product_id, 'item_edit_requested', jsonb_build_object(
    'request_id', v_id,
    'old', jsonb_build_object('name', v_prod.name, 'barcode', v_prod.barcode, 'sku', v_prod.sku,
                              'price', v_prod.price, 'description', coalesce(v_prod.description, '')),
    'new', jsonb_build_object('name', v_name, 'barcode', v_barcode, 'sku', v_sku,
                              'price', v_price, 'description', v_desc)));
  return v_id;
end;
$$;
revoke all on function public.inv_request_item_edit_v2(uuid, text, text, text, numeric, text) from public, anon;
grant execute on function public.inv_request_item_edit_v2(uuid, text, text, text, numeric, text) to authenticated;
