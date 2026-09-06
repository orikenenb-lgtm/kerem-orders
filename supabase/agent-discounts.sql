-- Sales-agent role with a PER-AGENT discount ceiling, enforced in the database.
--
-- This file mirrors what is DEPLOYED on the production project
-- (mcdchalyzeqjkkgfeznd) as migration
-- `agent_role_with_per_agent_discount_ceiling`, and on kerem-staging, where it
-- was rehearsed first. Keep the two in step: this file is the readable record,
-- the migration is the thing that ran.
--
-- Shape of the rule
-- -----------------
-- The owner marks a person as an agent and gives them a ceiling (default 15%).
-- That agent may then set a CUSTOMER's fixed discount, never above their own
-- ceiling. Managers keep no ceiling. Everything else an agent might reach is
-- closed: they cannot raise their own ceiling, cannot change anyone's role,
-- cannot discount another agent or a manager, and cannot write discount_percent
-- directly — the profiles trigger reverts it.
--
-- Why the ceiling is here and not in the browser
-- ---------------------------------------------
-- A number checked only in React is a suggestion. set_customer_discount() is
-- SECURITY DEFINER and applies the ceiling server-side, so a hand-written API
-- call from a console meets exactly the same refusal as the button does.
--
-- Two things kerem-staging caught that would have failed in production:
--   1. profiles_role_check listed only customer|manager, so an agent could not
--      be created at all.
--   2. profiles_discount_percent_check is `>= 0 AND < 100`, so a manager
--      setting exactly 100 would have passed the RPC and then been rejected by
--      the table. The RPC now matches the column exactly.

alter table public.profiles
  add column if not exists max_discount_percent numeric not null default 15;

alter table public.profiles drop constraint if exists profiles_max_discount_percent_range;
alter table public.profiles
  add constraint profiles_max_discount_percent_range
  check (max_discount_percent >= 0 and max_discount_percent <= 100);

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role = any (array['customer'::text, 'manager'::text, 'agent'::text]));

-- Deliberately separate from is_manager(): an agent never inherits a manager's
-- powers, so every manager-only screen and policy keeps checking is_manager().
create or replace function public.is_agent()
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'agent');
$$;
grant execute on function public.is_agent() to authenticated, anon;

-- Who changed whose discount, from what, when.
create table if not exists public.discount_changes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  changed_by uuid references public.profiles(id) on delete set null,
  old_percent numeric,
  new_percent numeric not null,
  created_at timestamptz not null default now()
);
alter table public.discount_changes enable row level security;
drop policy if exists discount_changes_select on public.discount_changes;
create policy discount_changes_select on public.discount_changes
  for select using (is_manager() or changed_by = auth.uid());

create or replace function public.set_customer_discount(p_customer uuid, p_percent numeric)
returns numeric
language plpgsql security definer set search_path to 'public'
as $$
declare
  caller_role text; caller_cap numeric; target_role text; old_pct numeric;
begin
  if auth.uid() is null then raise exception 'לא מחוברים למערכת'; end if;

  select role, coalesce(max_discount_percent, 0) into caller_role, caller_cap
  from public.profiles where id = auth.uid();

  if p_percent is null or p_percent < 0 then
    raise exception 'ההנחה חייבת להיות אפס או יותר';
  end if;
  if p_percent >= 100 then
    raise exception 'ההנחה חייבת להיות קטנה מ-100 אחוז';
  end if;

  select role, coalesce(discount_percent, 0) into target_role, old_pct
  from public.profiles where id = p_customer;

  if target_role is null then raise exception 'הלקוח לא נמצא'; end if;
  if target_role <> 'customer' then
    raise exception 'אפשר להגדיר הנחה ללקוח בלבד';
  end if;

  if caller_role = 'agent' then
    if p_percent > caller_cap then
      raise exception 'ההנחה המקסימלית שלך היא % אחוז', caller_cap;
    end if;
  elsif caller_role <> 'manager' then
    raise exception 'אין לך הרשאה לשנות הנחות';
  end if;

  perform set_config('app.discount_rpc', '1', true);
  update public.profiles set discount_percent = p_percent where id = p_customer;
  perform set_config('app.discount_rpc', '', true);

  insert into public.discount_changes (customer_id, changed_by, old_percent, new_percent)
  values (p_customer, auth.uid(), old_pct, p_percent);

  return p_percent;
end;
$$;
revoke all on function public.set_customer_discount(uuid, numeric) from public;
grant execute on function public.set_customer_discount(uuid, numeric) to authenticated;

-- The EXISTING guard, taught about the new column. A SECOND trigger was written
-- first and then removed: two guards on one table fire in name order, and this
-- one reverts while that one raised — and the profile screens save whole rows,
-- so a raising guard would have started rejecting ordinary "save my address"
-- writes that work today. Revert-don't-raise is deliberate; keep it.
create or replace function public.protect_privileged_profile_cols()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    return new; -- server context (service role / SQL editor / edge functions)
  end if;
  if exists (select 1 from public.profiles where id = actor and role = 'manager') then
    return new; -- managers may set these
  end if;
  if tg_op = 'INSERT' then
    new.role := 'customer';
    new.discount_percent := 0;
    new.rivhit_customer_id := null;
    new.max_discount_percent := 15;
  else
    new.role := old.role;
    new.rivhit_customer_id := old.rivhit_customer_id;
    new.max_discount_percent := old.max_discount_percent;
    if coalesce(current_setting('app.discount_rpc', true), '') <> '1' then
      new.discount_percent := old.discount_percent;
    end if;
  end if;
  return new;
end
$function$;

-- An agent must be able to read the customers they sell to. Extended, not
-- replaced: the existing clauses are preserved verbatim, and the agent clause is
-- narrowed to customer rows so agents cannot read managers or each other.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (
    (id = auth.uid())
    or is_manager()
    or (is_agent() and role = 'customer')
  );

-- ---------------------------------------------------------------------------
-- A manual hide that OUTRANKS the Rivhit sync.
-- Deployed to production as migration `manual_hide_overrides_rivhit_sync`,
-- rehearsed on kerem-staging first (11/11, including "a full sync cannot
-- resurrect a hidden product").
--
-- Why it is needed, with the evidence: the owner's Rivhit group picker lists 22
-- groups. The site was serving 24 categories, and cross-referencing the group
-- ids showed FIVE that Rivhit no longer lists — 40 חדש 1 (45 products), 29
-- מוצרי אופניים (31), 23 סביבונים (15), 30 עגלות בובה (10) and 24 עצמאות (7).
-- עגלות בובה existed TWICE: the current group 43 and the deleted group 30, so
-- the chip row merged 32 live products with 10 stale ones under one name.
--
-- The sync is not at fault: those groups and their items are STILL returned by
-- Rivhit's Item.Groups and Item.List (if the group were gone the category would
-- be written as an empty string, and it is not). What was deleted was a price
-- list selection, not the item master — so no automatic rule can tell the
-- difference, and the owner needs a switch of his own.
--
-- Every customer-facing query and every catalogue RPC already filters on
-- is_active, so forcing is_active = false from a trigger hides a product on the
-- catalogue, the search, the chips, the product page, the price lists and the
-- collections at once — with no front-end change and no edge-function redeploy.
-- The sync keeps writing is_active = true; the trigger keeps turning it off.
-- Nothing is deleted, and un-hiding restores the product in the same statement.

alter table public.products
  add column if not exists hidden_manually boolean not null default false;

create or replace function public.apply_manual_hide()
returns trigger language plpgsql
as $$
begin
  if new.hidden_manually then
    new.is_active := false;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_apply_manual_hide on public.products;
create trigger trg_apply_manual_hide
  before insert or update on public.products
  for each row execute function public.apply_manual_hide();

create or replace function public.set_product_hidden(p_product uuid, p_hidden boolean)
returns boolean language plpgsql security definer set search_path to 'public'
as $$
begin
  if not is_manager() then raise exception 'להנהלה בלבד'; end if;
  update public.products
     set hidden_manually = p_hidden,
         is_active = case when p_hidden then false else true end
   where id = p_product;
  return p_hidden;
end;
$$;

create or replace function public.set_category_hidden(p_category text, p_hidden boolean)
returns integer language plpgsql security definer set search_path to 'public'
as $$
declare n integer;
begin
  if not is_manager() then raise exception 'להנהלה בלבד'; end if;
  update public.products
     set hidden_manually = p_hidden,
         is_active = case when p_hidden then false else true end
   where coalesce(category,'') = coalesce(p_category,'');
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.hidden_products()
returns table(id uuid, name text, category text, sku text, price numeric)
language sql stable security definer set search_path to 'public'
as $$
  select p.id, p.name, p.category, p.sku, p.price
  from public.products p
  where p.hidden_manually
  order by p.category nulls last, p.name
$$;

revoke all on function public.set_product_hidden(uuid, boolean) from public;
revoke all on function public.set_category_hidden(text, boolean) from public;
revoke all on function public.hidden_products() from public;
grant execute on function public.set_product_hidden(uuid, boolean) to authenticated;
grant execute on function public.set_category_hidden(text, boolean) to authenticated;
grant execute on function public.hidden_products() to authenticated;

-- ---------------------------------------------------------------------------
-- Owner-controlled Rivhit GROUP visibility — the permanent fix.
-- Deployed to production as `owner_controlled_group_visibility`, rehearsed on
-- kerem-staging first (8/8).
--
-- WHAT THE RIVHIT API ACTUALLY OFFERS, measured on 2026-09-06 with a temporary
-- read-only probe (since retired):
--   * Item.List returns 8,954 items, 7,410 of them priced. The DB holds exactly
--     7,410 — the sync is faithful and holds nothing stale.
--   * An item carries 21 fields: item_id, item_name, item_extended_description,
--     item_part_num, barcode, item_group_id, storage_id, quantity, cost_nis,
--     sale_nis, currency_id, cost_mtc, sale_mtc, picture_link, exempt_vat,
--     avitem, location, is_serial, sapak, item_name_en, item_order.
--     THERE IS NO deleted / inactive / discontinued FLAG.
--   * Item.Groups returns 44 groups — including 999 ניגמרים, 9999 לא פעילים,
--     31 מסמכים כרם and 1000-1006 — not the 22 the owner's price-list screen
--     shows. Every "deleted" category is still there, with priced items in it.
--
-- So Rivhit cannot tell us what the owner stopped selling, and no amount of
-- cleverness in the sync will change that. The owner decides, once, and the
-- decision outlives every sync.
--
-- 999 and 9999 are seeded hidden. Neither has an active product today (999
-- holds 6,260 inactive rows, 9999 holds 1), so this changes nothing now and
-- stops a future price edit from leaking Rivhit's own housekeeping onto a shop
-- front.

create table if not exists public.catalog_hidden_groups (
  group_id  integer primary key,
  note      text,
  hidden_by uuid references public.profiles(id) on delete set null,
  hidden_at timestamptz not null default now()
);
alter table public.catalog_hidden_groups enable row level security;
drop policy if exists catalog_hidden_groups_select on public.catalog_hidden_groups;
create policy catalog_hidden_groups_select on public.catalog_hidden_groups
  for select using (is_manager());

-- Supersedes the earlier apply_manual_hide(): now covers per-product AND
-- per-group hiding, still as one BEFORE trigger on products.
create or replace function public.apply_manual_hide()
returns trigger language plpgsql
as $$
begin
  if new.hidden_manually
     or (new.group_id is not null
         and exists (select 1 from public.catalog_hidden_groups g where g.group_id = new.group_id))
  then
    new.is_active := false;
  end if;
  return new;
end;
$$;

create or replace function public.set_group_hidden(p_group integer, p_hidden boolean)
returns integer language plpgsql security definer set search_path to 'public'
as $$
declare n integer;
begin
  if not is_manager() then raise exception 'להנהלה בלבד'; end if;
  if p_hidden then
    insert into public.catalog_hidden_groups (group_id, hidden_by)
    values (p_group, auth.uid())
    on conflict (group_id) do update set hidden_by = excluded.hidden_by, hidden_at = now();
    update public.products set is_active = false where group_id = p_group;
  else
    delete from public.catalog_hidden_groups where group_id = p_group;
    update public.products
       set is_active = true
     where group_id = p_group
       and not hidden_manually
       and updated_at >= (now() - interval '2 hours');
  end if;
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.catalog_groups()
returns table(group_id integer, name text, products bigint, active bigint, hidden boolean)
language sql stable security definer set search_path to 'public'
as $$
  select p.group_id,
         coalesce(max(p.category) filter (where coalesce(p.category,'') <> ''), '—') as name,
         count(*)::bigint, count(*) filter (where p.is_active)::bigint,
         (h.group_id is not null)
  from public.products p
  left join public.catalog_hidden_groups h on h.group_id = p.group_id
  where p.group_id is not null
  group by p.group_id, h.group_id
  order by count(*) filter (where p.is_active) desc, p.group_id
$$;

revoke all on function public.set_group_hidden(integer, boolean) from public;
revoke all on function public.catalog_groups() from public;
grant execute on function public.set_group_hidden(integer, boolean) to authenticated;
grant execute on function public.catalog_groups() to authenticated;

insert into public.catalog_hidden_groups (group_id, note) values
  (999,  'ניגמרים — קבוצת המלאי שנגמר ברווחית'),
  (9999, 'לא פעילים — קבוצת הפריטים שהושבתו ברווחית')
on conflict (group_id) do nothing;

-- ---------------------------------------------------------------------------
-- Hardening found by a full security sweep (Supabase advisor + live ACL check),
-- deployed as `harden_manager_only_rpcs_against_anon`. Rehearsed on staging 6/6.
--
-- `revoke all ... from public` was NOT enough. Supabase grants EXECUTE to the
-- anon and authenticated ROLES by name, so revoking from `public` leaves those
-- grants standing. Every function added this week was callable by anon.
--
--   * The set_* functions already refused anon internally, so nothing could be
--     changed — but they should never have been callable.
--   * hidden_products() and catalog_groups() had NO internal check and are
--     SECURITY DEFINER: an anonymous GET on /rest/v1/rpc/hidden_products
--     returned hidden product names, SKUs and prices. A real leak, introduced
--     by me, closed two ways — revoked from anon AND now checking is_manager().
--   * apply_manual_hide() had no pinned search_path.
--
-- Verified afterwards on production: anon_can_call = false on all six, and the
-- public catalogue (catalog_public / catalog_public_categories) still works for
-- a logged-out visitor, which is the thing that must NOT break.
