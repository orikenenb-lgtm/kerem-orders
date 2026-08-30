-- Customer catalogues ("קטלוגים ללקוחות") — the SQL layer, as deployed.
--
-- This file mirrors the live project (mcdchalyzeqjkkgfeznd); it exists so the
-- pricing rule a customer link applies can be read here and not only in the
-- database. Change it here AND apply it there.
--
-- The price chain, most specific wins:
--   1. collection_products.price_override — an EXACT price for one product in
--      one collection. The collection discount does NOT stack on it: the
--      manager who types 10 must see 10 in the link, not 10-minus-discount.
--   2. price_overrides (user_id null)     — the manager's global price.
--   3. products.price                     — the Rivhit list price.
--   Collections with discount_percent > 0 apply it to (2)/(3) only.
--
-- collection_products.price_override:
--   numeric, null = no custom price;
--   check: null or 0 <= price <= 999999 (the UI additionally refuses <= 0 —
--   clearing is done by saving an empty field, never by typing 0).
--
-- Writes go through plain RLS (collection_products_manager_all: manager role
-- only, ALL commands). Reads by customers go ONLY through the SECURITY DEFINER
-- RPC below — anon never touches the tables.

alter table public.collection_products
  add column if not exists price_override numeric
  check (price_override is null or (price_override >= 0 and price_override <= 999999));

create or replace function public.catalog_collection(cslug text, q text default null::text, lim integer default 24, off integer default 0)
 returns table(id uuid, name text, category text, picture_link text, in_stock boolean, rotation_override smallint, price numeric, list_price numeric, discount_percent numeric, collection_name text, show_prices boolean, total bigint)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with c as (
    select col.id, col.name, col.show_prices, col.discount_percent
    from public.collections col
    where col.slug = cslug and col.is_active
  ),
  base as (
    select p.id, p.name, p.category, p.picture_link, p.in_stock,
           p.rotation_override,
           -- a manager-set global price replaces the Rivhit list price first…
           coalesce((select po.price from public.price_overrides po
                      where po.product_id = p.id and po.user_id is null), p.price) as list_price,
           cp.price_override as col_price,
           cp.sort_order, c.name as collection_name, c.show_prices, c.discount_percent
    from c
    join public.collection_products cp on cp.collection_id = c.id
    join public.products p on p.id = cp.product_id
    where p.is_active
      and (q is null or q = '' or p.name ilike '%' || q || '%'
           or p.sku ilike '%' || q || '%' or p.barcode ilike '%' || q || '%')
  ),
  page as (
    select b.id, b.name, b.category, b.picture_link, b.in_stock,
           b.rotation_override,
           case when b.show_prices then
             case
               -- An exact per-product price for this collection wins over
               -- everything, discount included. Rounded to agorot like all
               -- other money in the system.
               when b.col_price is not null then round(b.col_price * 100) / 100
               -- …otherwise the collection's discount comes off the list
               -- price, rounded to agorot exactly the way applyDiscount /
               -- validate_order_item round.
               else greatest(
                 case when b.list_price > 0 then 0.01 else 0 end,
                 round(b.list_price * (100 - b.discount_percent)) / 100
               )
             end
           else null end as price,
           -- 2026-08-24, owner: a customer must see ONLY the custom price,
           -- never the one it replaced. For override rows the replaced price
           -- never leaves the database; discount rows keep it so the
           -- strikethrough can present the discount.
           case when b.show_prices and b.col_price is null then b.list_price else null end as list_price,
           b.discount_percent,
           b.collection_name, b.show_prices,
           count(*) over () as total,
           0 as ord1, b.sort_order as ord2
    from base b
    order by b.sort_order, b.name
    limit greatest(lim, 0)
    offset greatest(off, 0)
  ),
  unioned as (
    select * from page
    union all
    -- Header-only row: the catalogue is real, it just has nothing to show.
    -- Only on the first page — a later page legitimately runs out of rows.
    select null::uuid, null::text, null::text, null::text, null::boolean,
           null::smallint, null::numeric, null::numeric,
           c.discount_percent, c.name, c.show_prices, 0::bigint,
           1 as ord1, 0 as ord2
    from c
    where greatest(off, 0) = 0 and not exists (select 1 from base)
  )
  select u.id, u.name, u.category, u.picture_link, u.in_stock, u.rotation_override,
         u.price, u.list_price, u.discount_percent, u.collection_name, u.show_prices, u.total
  from unioned u
  order by u.ord1, u.ord2, u.name
$function$;
