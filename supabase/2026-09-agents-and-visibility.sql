-- ============================================================================
-- September 2026: sales agents, catalogue visibility, and the sync watchdog.
--
-- THIS FILE IS THE FINAL STATE, NOT A DIARY. Every object appears EXACTLY ONCE,
-- in the form that is deployed. Running it top to bottom is safe and idempotent.
--
-- It used to be a chronological append-log, and that was a real hazard: earlier
-- sections still held superseded bodies of hidden_products() and
-- catalog_groups() WITHOUT their is_manager() check, so re-running the file
-- would have silently reverted two security fixes made later in the same file.
-- A mirror that can undo production is worse than no mirror. Hence this rewrite.
--
-- Deployed to production (mcdchalyzeqjkkgfeznd) as these migrations, each one
-- rehearsed on kerem-staging first:
--   agent_role_with_per_agent_discount_ceiling
--   manual_hide_overrides_rivhit_sync
--   owner_controlled_group_visibility
--   harden_manager_only_rpcs_against_anon
--   products_select_must_respect_is_active
--   rivhit_audit_runs_and_schedule
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. SALES AGENTS, with a ceiling enforced by the database
-- ---------------------------------------------------------------------------
-- The owner marks a person as an agent and gives them a ceiling (default 15%).
-- That agent may set a CUSTOMER's fixed discount, never above their own
-- ceiling. Managers have no ceiling. A number checked only in React is a
-- suggestion; set_customer_discount() is SECURITY DEFINER, so a hand-written
-- API call meets exactly the same refusal as the button.
--
-- Two things kerem-staging caught that would have failed in production:
--   1. profiles_role_check listed only customer|manager, so an agent could not
--      be created at all.
--   2. profiles_discount_percent_check is `>= 0 AND < 100`, so a manager
--      setting exactly 100 would pass the RPC and then be refused by the table.

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

-- Who changed whose discount, from what, when. An agent handing out money is
-- exactly what needs a trail.
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
  -- Mirrors profiles_discount_percent_check exactly, so the RPC and the table
  -- can never disagree about what is allowed.
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
revoke execute on function public.set_customer_discount(uuid, numeric) from anon;
grant execute on function public.set_customer_discount(uuid, numeric) to authenticated;

-- The EXISTING guard, taught about the new column. Its revert-don't-raise
-- behaviour is deliberate and must be preserved: the profile screens save whole
-- rows, so a raising guard would start rejecting ordinary "save my address"
-- writes that work today. A second, raising guard was written and then removed
-- for exactly this reason — two guards fire in name order and fight.
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
    -- An agent's ceiling is the owner's to set, never the agent's. Without this
    -- an agent could raise their own cap and then "legitimately" grant anything.
    new.max_discount_percent := old.max_discount_percent;
    -- Discounts move only through set_customer_discount(), which raises this
    -- transaction-local flag around its own write. A client cannot set it.
    if coalesce(current_setting('app.discount_rpc', true), '') <> '1' then
      new.discount_percent := old.discount_percent;
    end if;
  end if;
  return new;
end
$function$;

-- An agent must read the customers they sell to. Extended, not replaced: the
-- existing clauses are preserved verbatim and the agent clause is narrowed to
-- customer rows, so agents cannot read managers or each other.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (
    (id = auth.uid())
    or is_manager()
    or (is_agent() and role = 'customer')
  );


-- ---------------------------------------------------------------------------
-- 2. CATALOGUE VISIBILITY: the owner outranks the Rivhit sync
-- ---------------------------------------------------------------------------
-- Established by probing the live Rivhit API (read-only, aggregates only):
--   * Item.List returns 8,954 items, 7,410 priced. The DB holds exactly 7,410 —
--     the sync is faithful and holds nothing stale.
--   * An item carries 21 fields and NONE is a deleted/inactive/discontinued
--     flag. Rivhit cannot tell us what the owner stopped selling.
--   * Item.Groups returns 44 groups, not the 22 his price-list screen shows.
--     The "deleted" categories are all still there, with priced items.
-- So no cleverer sync can fix this. The owner decides, once, and the decision
-- outlives every sync — enforced by a BEFORE trigger, so the edge function
-- needs no change: the sync writes is_active = true every 15 minutes and the
-- trigger turns it straight back off.

alter table public.products
  add column if not exists hidden_manually boolean not null default false;

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

create or replace function public.apply_manual_hide()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  -- Off the site if the owner hid THIS product, or hid the whole Rivhit group
  -- it belongs to. Checked on every write, so no sync can undo it, and a
  -- product that arrives INTO a hidden group later never appears either.
  if new.hidden_manually
     or (new.group_id is not null
         and exists (select 1 from public.catalog_hidden_groups g where g.group_id = new.group_id))
  then
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
         -- On un-hide, bring it back now. If Rivhit has genuinely dropped it,
         -- the next sync sweeps it out again — which is correct.
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
    -- Restore only what the last sync confirmed, and never a product the owner
    -- hid one-by-one on purpose.
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

-- The two READERS carry their own is_manager() check as well as the grant.
-- They shipped without one, and because Supabase grants EXECUTE to the anon and
-- authenticated ROLES by name (so `revoke ... from public` does nothing), an
-- anonymous request to /rest/v1/rpc/hidden_products returned hidden product
-- names, SKUs and prices. Belt and braces, deliberately.
create or replace function public.hidden_products()
returns table(id uuid, name text, category text, sku text, price numeric)
language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if not is_manager() then raise exception 'להנהלה בלבד'; end if;
  return query
    select p.id, p.name, p.category, p.sku, p.price
    from public.products p
    where p.hidden_manually
    order by p.category nulls last, p.name;
end;
$$;

create or replace function public.catalog_groups()
returns table(group_id integer, name text, products bigint, active bigint, hidden boolean)
language plpgsql stable security definer set search_path to 'public'
as $$
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
    order by count(*) filter (where p.is_active) desc, p.group_id;
end;
$$;

revoke execute on function public.hidden_products()                        from anon, public;
revoke execute on function public.catalog_groups()                         from anon, public;
revoke execute on function public.set_product_hidden(uuid, boolean)        from anon, public;
revoke execute on function public.set_category_hidden(text, boolean)       from anon, public;
revoke execute on function public.set_group_hidden(integer, boolean)       from anon, public;
grant  execute on function public.hidden_products()                        to authenticated;
grant  execute on function public.catalog_groups()                         to authenticated;
grant  execute on function public.set_product_hidden(uuid, boolean)        to authenticated;
grant  execute on function public.set_category_hidden(text, boolean)       to authenticated;
grant  execute on function public.set_group_hidden(integer, boolean)       to authenticated;

-- Rivhit's own housekeeping groups, which have no business on a shop front.
-- Neither had an active product when this was seeded (999 holds 6,260 inactive
-- rows, 9999 holds 1), so it changed nothing then and stops a future price edit
-- from leaking them onto the site.
insert into public.catalog_hidden_groups (group_id, note) values
  (999,  'ניגמרים — קבוצת המלאי שנגמר ברווחית'),
  (9999, 'לא פעילים — קבוצת הפריטים שהושבתו ברווחית')
on conflict (group_id) do nothing;


-- ---------------------------------------------------------------------------
-- 3. RLS: a SELECT on products must respect is_active
-- ---------------------------------------------------------------------------
-- The policy was `auth.uid() IS NOT NULL`: no is_active term, no RESTRICTIVE
-- policy to narrow it. Every catalogue RPC filters is_active and a logged-out
-- visitor saw nothing, so the hide feature looked airtight — but PostgREST
-- exposes the TABLE as well as the functions, and
--     GET /rest/v1/products?is_active=eq.false&select=*
-- with any customer's token returned all 6,437 inactive rows, including the
-- 6,261 hidden through catalog_hidden_groups, with name, מק״ט, ברקוד, price,
-- stock and picture. Reproduced on staging (5 rows → 0) before being applied
-- here; on production the same query went 6,437 → 0.
--
-- Managers keep full access through products_manager_all, untouched. The one
-- app path that reads inactive rows on purpose — the cart reconcile — already
-- treats a MISSING row exactly like an inactive one, so it is unaffected.
drop policy if exists products_select_auth on public.products;
create policy products_select_auth on public.products
  for select using (is_active or is_manager());


-- ---------------------------------------------------------------------------
-- 4. THE SYNC WATCHDOG
-- ---------------------------------------------------------------------------
-- A sync that reports "done" has only told you it finished. The rivhit-audit
-- edge function is the separate check that the SITE EQUALS RIVHIT: it pulls
-- every item and group, applies exactly the sync's own filter rules, and
-- compares field by field — name, price, מק״ט, ברקוד, category, group, stock —
-- in three directions (missing here, extra here, field disagrees). Products the
-- owner hid on purpose are excluded from drift; they are his decision.
--
-- It NEVER repairs anything. A watchdog that silently edits the live catalogue
-- turns a bad reading into a bad shop.
--
-- First full run, 2026-09-06: 8,954 items · 974 sellable · 973 live · 1 hidden
-- on purpose · missing 0 · extra 0 · field differences 0 · in_sync TRUE.

create table if not exists public.rivhit_audit_runs (
  id          uuid primary key default gen_random_uuid(),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null check (status in ('in_sync','drift','error')),
  differences integer,
  summary     jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists rivhit_audit_runs_created_idx
  on public.rivhit_audit_runs (created_at desc);
alter table public.rivhit_audit_runs enable row level security;
drop policy if exists rivhit_audit_runs_select on public.rivhit_audit_runs;
create policy rivhit_audit_runs_select on public.rivhit_audit_runs
  for select using (is_manager());

create or replace function public.latest_sync_audit()
returns table(checked_at timestamptz, status text, differences integer, summary jsonb)
language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if not is_manager() then raise exception 'להנהלה בלבד'; end if;
  return query
    select r.finished_at, r.status, r.differences, r.summary
    from public.rivhit_audit_runs r order by r.created_at desc limit 1;
end;
$$;
revoke execute on function public.latest_sync_audit() from anon, public;
grant execute on function public.latest_sync_audit() to authenticated;

-- Scheduled by cron (see cron.job): 'rivhit-audit-hourly' at minute 8, clear of
-- the :00/:15/:30/:45 sync, and 'rivhit-audit-prune' keeping 90 days.
