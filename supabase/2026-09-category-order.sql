-- Categories in Rivhit's own order — the SQL layer, as deployed (staging
-- 2026-09-08, then production). Mirror: change here AND apply there.
--
-- A site category IS a Rivhit item group (products.category = group name,
-- products.group_id = its number). The owner and his father see the groups
-- in Rivhit numbered 1, 2, 3 … and asked for the site to show them in exactly
-- that order, everywhere. The three category RPCs used to order busiest-first;
-- now min(group_id) first, count as the tie-break. Body-only CREATE OR
-- REPLACE: same names, signatures, SECURITY DEFINER and search_path, so the
-- existing grants (anon + authenticated on the two catalogue RPCs, the
-- manager check inside catalog_groups) are untouched.
--
-- Every client keeps the server's order (catalog, view/prices, admin browser,
-- images review, hidden page); the collections pricing scope sorts its
-- member categories by the same group_id.
--
-- ROLLBACK: the three previous bodies differed only in their ORDER BY:
--   catalog_categories:        order by count(*) desc
--   catalog_public_categories: order by n desc
--   catalog_groups:            order by count(*) filter (where p.is_active) desc, p.group_id

create or replace function public.catalog_categories()
 returns table(category text, n bigint)
 language sql stable security definer
 set search_path to 'public'
as $function$
  select category, count(*)::bigint
  from public.products
  where is_active and coalesce(category,'') <> ''
  group by category
  order by min(group_id) nulls last, count(*) desc
$function$;

create or replace function public.catalog_public_categories()
 returns table(category text, n bigint)
 language sql stable security definer
 set search_path to 'public'
as $function$
  select p.category, count(*) as n
  from public.products p
  where p.is_active and coalesce(p.category, '') <> ''
  group by p.category
  order by min(p.group_id) nulls last, n desc
$function$;

create or replace function public.catalog_groups()
 returns table(group_id integer, name text, products bigint, active bigint, hidden boolean)
 language plpgsql stable security definer
 set search_path to 'public'
as $function$
begin
  if not is_manager() then raise exception 'להנהלה בלבד'; end if;
  return query
    select p.group_id,
           coalesce(max(p.category) filter (where coalesce(p.category,'') <> ''), '—'),
           count(*)::bigint,
           count(*) filter (where p.is_active)::bigint,
           (h.group_id is not null)
    from public.products p
    left join public.catalog_hidden_groups h on h.group_id = p.group_id
    where p.group_id is not null
    group by p.group_id, h.group_id
    order by p.group_id;
end;
$function$;
