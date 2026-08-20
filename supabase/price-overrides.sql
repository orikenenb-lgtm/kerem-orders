-- public.set_price_override — the only way a manager price reaches the database.
--
-- This file exists because the function did not: it was applied straight to the
-- live project and had no copy anywhere in the repository, so nothing here
-- described the rule that decides what a customer pays. Reading the app told
-- you a price was saved; only the live catalogue told you which rows it wrote.
--
-- It is the mirror of what is deployed on project mcdchalyzeqjkkgfeznd, dumped
-- with pg_get_functiondef. Change it here AND apply it there — a copy that
-- drifts is worse than no copy, because it is believed.
--
-- Two shapes, decided by p_user_ids:
--   NULL       → one GLOBAL price for the product, for everyone (user_id null).
--   uuid[]     → the price applies to exactly these customers and no others.
--
-- The per-customer branch replaces the whole set rather than upserting the ones
-- passed in. That is the fix for a real bug: the screen offers tick boxes, and
-- unticking a customer used to leave his row behind, so he kept the special
-- price while the screen reported the save succeeded. "These customers" has to
-- mean these and only these.
--
-- SECURITY DEFINER, so the is_manager() gate at the top is the whole
-- authorization story — there is no RLS behind it to catch a mistake here.
-- EXECUTE is granted to `authenticated` only; anon must never reach it.

create or replace function public.set_price_override(
  p_product_id uuid,
  p_price numeric,
  p_user_ids uuid[] default null::uuid[]
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_price numeric;
  v_count integer;
begin
  if not public.is_manager() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_price is null or p_price < 0 then
    raise exception 'invalid price' using errcode = '22023';
  end if;
  if not exists (select 1 from public.products where id = p_product_id) then
    raise exception 'unknown product' using errcode = '23503';
  end if;
  v_price := round(p_price, 2);

  if p_user_ids is null then
    delete from public.price_overrides
     where product_id = p_product_id and user_id is null;
    insert into public.price_overrides (product_id, user_id, price, updated_by)
    values (p_product_id, null, v_price, auth.uid());
    return 1;
  end if;

  select count(*) into v_count from unnest(p_user_ids) u where u is not null;
  if v_count = 0 then
    raise exception 'no customers selected' using errcode = '22023';
  end if;

  -- Replace the WHOLE per-customer set, so unticking really removes.
  delete from public.price_overrides
   where product_id = p_product_id and user_id is not null;
  insert into public.price_overrides (product_id, user_id, price, updated_by)
  select p_product_id, u, v_price, auth.uid()
  from unnest(p_user_ids) u
  where u is not null;
  return v_count;
end
$function$;

revoke all on function public.set_price_override(uuid, numeric, uuid[]) from public, anon;
grant execute on function public.set_price_override(uuid, numeric, uuid[]) to authenticated;
