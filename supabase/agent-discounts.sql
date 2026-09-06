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
