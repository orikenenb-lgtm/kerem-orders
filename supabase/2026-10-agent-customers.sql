-- ============================================================================
-- STATUS: DRAFT — NOT APPLIED to staging or production (2026-10-20).
-- The staging apply was cancelled before it ran; both databases were checked
-- afterwards and contain none of the objects below. Apply staging first,
-- run the role-switched RLS tests, then production. Until then the live
-- schema is supabase/2026-09-agents-and-visibility.sql.
-- ============================================================================
-- Agents own their customers — the SQL layer. Mirror of the live project.
-- Rehearsed on staging (ahptrtlnrpmevlpgqeac) first, with role-switched RLS
-- tests in a rolled-back transaction; then applied to production.
--
-- WHAT THE OWNER ASKED (2026-10-20)
-- Each agent has his own user in Rivhit and opens his customers there. On the
-- site a customer belongs to the agent who opened them; the agent can also
-- "pull" a customer to himself; on the SITE an agent sees only his own
-- customers; the manager sees everything and decides each agent's discount
-- ceiling.
--
-- WHAT RIVHIT GIVES US (read-only probe, 2026-10-20)
-- Customer.List carries agent_id on every card (555 cards: 97→268, 548→51,
-- 555→47, 95→18, four more with 1-5, 0 = none for 160). There is no agent
-- list in the API (Agent.List answers 405), so the owner maps "Rivhit agent
-- number → site account" once, on the site.
--
-- HOW ASSIGNMENT WORKS
--   * rivhit   — the customer's Rivhit card has agent N, and N is mapped to a
--                site agent. Applied when the manager links a site account to
--                its Rivhit card, when the card's agent changes in Rivhit
--                (nightly sync), and when the manager maps a number.
--   * pulled   — an agent claimed a customer that had no agent, by exact
--                phone or ח.פ (claim_customer). Never someone else's.
--   * manager  — the manager set it by hand. A manual choice is never
--                overridden by Rivhit until the manager releases it.
-- Every change is logged in agent_assignments (who, from, to, how, when).
--
-- DELIBERATELY NOT DONE: auto-linking a new signup to a Rivhit card by ח.פ.
-- Anyone can type another business's ח.פ at signup; a link pulls that
-- business's Rivhit discount. Linking stays a manager decision (or an agent's,
-- and only to a card of his own — see claim_customer).
--
-- VISIBILITY (RLS)
--   profiles: an agent reads only customers assigned to him (was: all).
--   orders / order_items: an agent reads his customers' orders (read only).
--   discount: set_customer_discount refuses an agent on a customer not his.
--   customers (Rivhit cards): an agent reads his own cards only.
--
-- ROLLBACK (in this order; nothing here deletes or rewrites existing data):
--   drop policy if exists customers_agent_read on public.customers;
--   -- restore the three policies below to their previous USING clauses:
--   --   profiles_select:     (id = auth.uid()) or is_manager() or (is_agent() and role = 'customer')
--   --   orders_select:       (user_id = auth.uid()) or is_manager()
--   --   order_items_select:  exists (select 1 from orders o where o.id = order_items.order_id
--   --                                 and (o.user_id = auth.uid() or is_manager()))
--   -- restore set_customer_discount and protect_privileged_profile_cols from
--   --   supabase/2026-09-agents-and-visibility.sql
--   drop trigger if exists trg_assign_agent_on_link on public.profiles;
--   drop trigger if exists trg_log_agent_assignment on public.profiles;
--   drop trigger if exists trg_reassign_on_card_agent on public.customers;
--   drop function if exists public.assign_agent_on_link(), public.log_agent_assignment(),
--     public.reassign_on_card_agent(), public.agent_for_rivhit_number(integer),
--     public.is_my_customer(uuid), public.my_rivhit_agent_number(),
--     public.set_customer_agent(uuid, uuid), public.release_customer_agent(uuid),
--     public.set_agent_rivhit_number(uuid, integer), public.claim_customer(text);
--   drop table if exists public.agent_assignments;
--   -- the new columns can stay (nullable, unused) or be dropped:
--   -- alter table public.profiles drop column agent_user_id, drop column agent_source,
--   --   drop column agent_assigned_at, drop column rivhit_agent_id;
--   -- alter table public.customers drop column agent_id;

-- ---------------------------------------------------------------- columns
alter table public.customers add column if not exists agent_id integer;
create index if not exists customers_agent_id_idx on public.customers (agent_id);

alter table public.profiles add column if not exists rivhit_agent_id integer;
alter table public.profiles add column if not exists agent_user_id uuid references public.profiles(id) on delete set null;
alter table public.profiles add column if not exists agent_source text;
alter table public.profiles add column if not exists agent_assigned_at timestamptz;
do $$ begin
  alter table public.profiles add constraint profiles_agent_source_check
    check (agent_source is null or agent_source in ('rivhit', 'pulled', 'manager'));
exception when duplicate_object then null; end $$;
create unique index if not exists profiles_rivhit_agent_id_key on public.profiles (rivhit_agent_id) where rivhit_agent_id is not null;
create index if not exists profiles_agent_user_id_idx on public.profiles (agent_user_id);

-- ---------------------------------------------------------------- log
create table if not exists public.agent_assignments (
  id           bigint generated always as identity primary key,
  customer_id  uuid not null references public.profiles(id) on delete cascade,
  from_agent   uuid,
  to_agent     uuid,
  source       text,
  changed_by   uuid,
  changed_at   timestamptz not null default now()
);
create index if not exists agent_assignments_customer_idx on public.agent_assignments (customer_id, changed_at desc);
alter table public.agent_assignments enable row level security;
drop policy if exists agent_assignments_read on public.agent_assignments;
create policy agent_assignments_read on public.agent_assignments
  for select to authenticated
  using ((select public.is_manager()) or to_agent = (select auth.uid()) or from_agent = (select auth.uid()));
revoke all on public.agent_assignments from anon;
grant select on public.agent_assignments to authenticated;

-- ---------------------------------------------------------------- helpers
-- The site account mapped to a Rivhit agent number (agent or manager), or null.
create or replace function public.agent_for_rivhit_number(n integer)
returns uuid language sql stable security definer set search_path to 'public' as $$
  select id from public.profiles
  where n is not null and n > 0 and rivhit_agent_id = n and role in ('agent', 'manager')
  limit 1
$$;
revoke execute on function public.agent_for_rivhit_number(integer) from public, anon, authenticated;

-- Is this profile a customer assigned to the caller? Used by RLS on orders.
create or replace function public.is_my_customer(p uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.profiles where id = p and agent_user_id = auth.uid() and auth.uid() is not null)
$$;
revoke execute on function public.is_my_customer(uuid) from public, anon;
grant execute on function public.is_my_customer(uuid) to authenticated;

create or replace function public.my_rivhit_agent_number()
returns integer language sql stable security definer set search_path to 'public' as $$
  select rivhit_agent_id from public.profiles where id = auth.uid() and role in ('agent', 'manager')
$$;
revoke execute on function public.my_rivhit_agent_number() from public, anon;
grant execute on function public.my_rivhit_agent_number() to authenticated;

-- ---------------------------------------------------------------- protect
-- The existing guard, extended: the four agent columns are the manager's to
-- set (or the server's, or claim_customer's under its transaction-local flag).
create or replace function public.protect_privileged_profile_cols()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
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
    new.rivhit_agent_id := null;
    new.agent_user_id := null;
    new.agent_source := null;
    new.agent_assigned_at := null;
  else
    new.role := old.role;
    new.max_discount_percent := old.max_discount_percent;
    new.rivhit_agent_id := old.rivhit_agent_id;
    -- Discounts move only through set_customer_discount(), which raises this
    -- transaction-local flag around its own write. A client cannot set it.
    if coalesce(current_setting('app.discount_rpc', true), '') <> '1' then
      new.discount_percent := old.discount_percent;
    end if;
    -- Assignment (and the Rivhit link an agent may make for his own card)
    -- moves only through claim_customer(), under its own flag.
    if coalesce(current_setting('app.agent_rpc', true), '') <> '1' then
      new.rivhit_customer_id := old.rivhit_customer_id;
      new.agent_user_id := old.agent_user_id;
      new.agent_source := old.agent_source;
      new.agent_assigned_at := old.agent_assigned_at;
    end if;
  end if;
  return new;
end
$function$;

-- ---------------------------------------------------------------- auto-assign
-- When a profile gets (or changes) its Rivhit card, take the card's agent —
-- unless the manager fixed the agent by hand. Runs AFTER the protect trigger
-- (name order: trg_assign… < trg_protect… would be wrong, hence "zz").
create or replace function public.assign_agent_on_link()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  card_agent integer; target uuid;
begin
  if new.role <> 'customer' or new.rivhit_customer_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.rivhit_customer_id is not distinct from old.rivhit_customer_id then return new; end if;
  if new.agent_source = 'manager' then return new; end if;
  select agent_id into card_agent from public.customers where rivhit_id = new.rivhit_customer_id limit 1;
  target := public.agent_for_rivhit_number(card_agent);
  if target is not null and target is distinct from new.agent_user_id then
    new.agent_user_id := target;
    new.agent_source := 'rivhit';
    new.agent_assigned_at := now();
  end if;
  return new;
end $$;
revoke execute on function public.assign_agent_on_link() from public, anon, authenticated;
drop trigger if exists trg_zz_assign_agent_on_link on public.profiles;
create trigger trg_zz_assign_agent_on_link
  before insert or update of rivhit_customer_id on public.profiles
  for each row execute function public.assign_agent_on_link();

-- When the agent on a Rivhit card changes (nightly sync), follow it — for
-- every site account linked to that card, unless fixed by the manager.
create or replace function public.reassign_on_card_agent()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  target uuid;
begin
  target := public.agent_for_rivhit_number(new.agent_id);
  if target is null then return new; end if;
  update public.profiles
     set agent_user_id = target, agent_source = 'rivhit', agent_assigned_at = now()
   where role = 'customer'
     and rivhit_customer_id = new.rivhit_id
     and coalesce(agent_source, '') <> 'manager'
     and agent_user_id is distinct from target;
  return new;
end $$;
revoke execute on function public.reassign_on_card_agent() from public, anon, authenticated;
drop trigger if exists trg_reassign_on_card_agent on public.customers;
create trigger trg_reassign_on_card_agent
  after insert or update of agent_id on public.customers
  for each row when (new.agent_id is not null and new.agent_id > 0)
  execute function public.reassign_on_card_agent();

-- Every assignment change, however it happened, lands in the log.
create or replace function public.log_agent_assignment()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  insert into public.agent_assignments (customer_id, from_agent, to_agent, source, changed_by)
  values (new.id, old.agent_user_id, new.agent_user_id, new.agent_source, auth.uid());
  return new;
end $$;
revoke execute on function public.log_agent_assignment() from public, anon, authenticated;
drop trigger if exists trg_log_agent_assignment on public.profiles;
create trigger trg_log_agent_assignment
  after update of agent_user_id on public.profiles
  for each row when (old.agent_user_id is distinct from new.agent_user_id)
  execute function public.log_agent_assignment();

-- ---------------------------------------------------------------- manager RPCs
-- Map a Rivhit agent number to a site account (agent or the manager himself),
-- then apply it to every linked customer whose card carries that number and
-- whose agent the manager has not fixed by hand. Returns how many moved.
create or replace function public.set_agent_rivhit_number(p_agent uuid, p_number integer)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare moved integer := 0; r text;
begin
  if not public.is_manager() then raise exception 'להנהלה בלבד'; end if;
  select role into r from public.profiles where id = p_agent;
  if r is null then raise exception 'המשתמש לא נמצא'; end if;
  if r not in ('agent', 'manager') then raise exception 'אפשר לשייך מספר סוכן רק לסוכן או למנהל'; end if;
  if p_number is not null and p_number <= 0 then raise exception 'מספר סוכן חייב להיות חיובי'; end if;
  if p_number is not null and exists (select 1 from public.profiles where rivhit_agent_id = p_number and id <> p_agent) then
    raise exception 'מספר הסוכן % כבר משויך למשתמש אחר', p_number;
  end if;
  update public.profiles set rivhit_agent_id = p_number where id = p_agent;
  if p_number is not null then
    update public.profiles c
       set agent_user_id = p_agent, agent_source = 'rivhit', agent_assigned_at = now()
      from public.customers k
     where c.role = 'customer'
       and c.rivhit_customer_id = k.rivhit_id
       and k.agent_id = p_number
       and coalesce(c.agent_source, '') <> 'manager'
       and c.agent_user_id is distinct from p_agent;
    get diagnostics moved = row_count;
  end if;
  return moved;
end $$;
revoke execute on function public.set_agent_rivhit_number(uuid, integer) from public, anon;
grant execute on function public.set_agent_rivhit_number(uuid, integer) to authenticated;

-- Fix a customer's agent by hand (null = no agent). Rivhit never overrides it.
create or replace function public.set_customer_agent(p_customer uuid, p_agent uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare r text; a text;
begin
  if not public.is_manager() then raise exception 'להנהלה בלבד'; end if;
  select role into r from public.profiles where id = p_customer;
  if r is distinct from 'customer' then raise exception 'אפשר לשייך סוכן ללקוח בלבד'; end if;
  if p_agent is not null then
    select role into a from public.profiles where id = p_agent;
    if a is null or a not in ('agent', 'manager') then raise exception 'הסוכן לא נמצא'; end if;
  end if;
  update public.profiles
     set agent_user_id = p_agent, agent_source = 'manager', agent_assigned_at = now()
   where id = p_customer;
end $$;
revoke execute on function public.set_customer_agent(uuid, uuid) from public, anon;
grant execute on function public.set_customer_agent(uuid, uuid) to authenticated;

-- Undo a manual choice: back to whatever the Rivhit card says (or keep the
-- current agent if the card has none mapped). Returns the agent now in place.
create or replace function public.release_customer_agent(p_customer uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare card_agent integer; target uuid; cur uuid;
begin
  if not public.is_manager() then raise exception 'להנהלה בלבד'; end if;
  select k.agent_id, p.agent_user_id into card_agent, cur
    from public.profiles p left join public.customers k on k.rivhit_id = p.rivhit_customer_id
   where p.id = p_customer and p.role = 'customer';
  if not found then raise exception 'הלקוח לא נמצא'; end if;
  target := public.agent_for_rivhit_number(card_agent);
  update public.profiles
     set agent_user_id = coalesce(target, cur),
         agent_source = case when target is not null then 'rivhit' when cur is not null then 'pulled' else null end,
         agent_assigned_at = now()
   where id = p_customer;
  return coalesce(target, cur);
end $$;
revoke execute on function public.release_customer_agent(uuid) from public, anon;
grant execute on function public.release_customer_agent(uuid) to authenticated;

-- ---------------------------------------------------------------- agent RPC
-- An agent pulls a customer to himself by the customer's exact phone (last 9
-- digits) or ח.פ. Only a customer with NO agent; exactly one match or nothing.
-- If the customer is not yet linked to a Rivhit card and exactly one card OF
-- THIS AGENT has the same ח.פ or phone, the link is made too (that is how the
-- agent brings a customer "from Rivhit into the site"); the discount then
-- comes from that card, as for any link. Returns the customer's name.
create or replace function public.claim_customer(p_query text)
returns text language plpgsql security definer set search_path to 'public' as $$
declare
  me uuid := auth.uid(); my_num integer; q text; n integer;
  cid uuid; cur_agent uuid; linked integer; cvat text; cphone text; cname text;
  card integer; ncards integer; card_disc numeric;
begin
  if me is null or not public.is_agent() then raise exception 'לסוכנים בלבד'; end if;
  q := regexp_replace(coalesce(p_query, ''), '\D', '', 'g');
  if length(q) < 8 then raise exception 'הקלידו טלפון מלא או ח.פ (לפחות 8 ספרות)'; end if;

  select count(*) into n from public.profiles p
   where p.role = 'customer'
     and (regexp_replace(coalesce(p.vat_number, ''), '\D', '', 'g') = q
          or (length(q) >= 9 and right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 9) = right(q, 9)));
  if n = 0 then raise exception 'לא נמצא לקוח רשום באתר עם הפרטים האלה'; end if;
  if n > 1 then raise exception 'נמצאו כמה לקוחות עם הפרטים האלה — פנו למנהל'; end if;

  select p.id, p.agent_user_id, p.rivhit_customer_id,
         regexp_replace(coalesce(p.vat_number, ''), '\D', '', 'g'),
         right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 9),
         coalesce(nullif(p.business_name, ''), nullif(p.full_name, ''), p.email)
    into cid, cur_agent, linked, cvat, cphone, cname
    from public.profiles p
   where p.role = 'customer'
     and (regexp_replace(coalesce(p.vat_number, ''), '\D', '', 'g') = q
          or (length(q) >= 9 and right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 9) = right(q, 9)));

  if cur_agent = me then return cname; end if;
  if cur_agent is not null then raise exception 'הלקוח כבר משויך לסוכן אחר — רק המנהל יכול להעביר'; end if;

  perform set_config('app.agent_rpc', '1', true);
  update public.profiles
     set agent_user_id = me, agent_source = 'pulled', agent_assigned_at = now()
   where id = cid;

  if linked is null then
    select rivhit_agent_id into my_num from public.profiles where id = me;
    if my_num is not null then
      select count(*), min(k.rivhit_id) into ncards, card from public.customers k
       where k.agent_id = my_num and k.is_active
         and ((cvat <> '' and length(cvat) >= 8 and regexp_replace(coalesce(k.vat_number, ''), '\D', '', 'g') = cvat)
              or (length(cphone) = 9 and right(regexp_replace(coalesce(k.phone, ''), '\D', '', 'g'), 9) = cphone));
      if ncards = 1 then
        select coalesce(discount_percent, 0) into card_disc from public.customers where rivhit_id = card;
        perform set_config('app.discount_rpc', '1', true);
        update public.profiles
           set rivhit_customer_id = card, discount_percent = card_disc, agent_source = 'rivhit'
         where id = cid;
        perform set_config('app.discount_rpc', '', true);
      end if;
    end if;
  end if;
  perform set_config('app.agent_rpc', '', true);
  return cname;
end $$;
revoke execute on function public.claim_customer(text) from public, anon;
grant execute on function public.claim_customer(text) to authenticated;

-- ---------------------------------------------------------------- discount
-- Same function, one new rule: an agent may only set the discount of a
-- customer assigned to him.
create or replace function public.set_customer_discount(p_customer uuid, p_percent numeric)
returns numeric language plpgsql security definer set search_path to 'public' as $function$
declare
  caller_role text; caller_cap numeric; target_role text; old_pct numeric; target_agent uuid;
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

  select role, coalesce(discount_percent, 0), agent_user_id into target_role, old_pct, target_agent
  from public.profiles where id = p_customer;

  if target_role is null then raise exception 'הלקוח לא נמצא'; end if;
  if target_role <> 'customer' then
    raise exception 'אפשר להגדיר הנחה ללקוח בלבד';
  end if;

  if caller_role = 'agent' then
    if target_agent is distinct from auth.uid() then
      raise exception 'הלקוח הזה לא משויך אליך';
    end if;
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
$function$;

-- ---------------------------------------------------------------- RLS
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using ((id = auth.uid()) or is_manager()
         or (is_agent() and role = 'customer' and agent_user_id = auth.uid()));

drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders for select
  using ((user_id = auth.uid()) or is_manager() or is_my_customer(user_id));

drop policy if exists order_items_select on public.order_items;
create policy order_items_select on public.order_items for select
  using (exists (select 1 from public.orders o
                  where o.id = order_items.order_id
                    and ((o.user_id = auth.uid()) or is_manager() or is_my_customer(o.user_id))));

drop policy if exists customers_agent_read on public.customers;
create policy customers_agent_read on public.customers for select to authenticated
  using (agent_id is not null and agent_id = (select public.my_rivhit_agent_number()));
