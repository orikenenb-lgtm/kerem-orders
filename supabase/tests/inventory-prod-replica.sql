-- ============================================================================
-- TEST ONLY. A minimal local replica of the production objects that
-- 2026-11-inventory-count.sql depends on, so the migration can be rehearsed on
-- a plain local PostgreSQL. NEVER run this against Supabase (staging or prod):
-- it would replace is_manager(), the profiles trigger and the policies below.
-- A guard at the top refuses to run where Supabase's own roles exist.
--
-- Built from facts verified on production (2026-11-24):
--   * profiles(id, role customer|manager|agent, full_name, ...) with RLS
--     (update own / manager update / select own or manager), table-level
--     INSERT/UPDATE grants for authenticated, and trg_protect_privileged_cols.
--   * is_manager(): sql stable security definer, executable by anon/authenticated.
--   * products(...) with products_manager_all and products_select_auth.
--   * Supabase's default privileges: every new table/function in public is
--     granted to anon, authenticated and service_role BY NAME. This is why the
--     migration must revoke from anon explicitly; the replica reproduces it so
--     the tests would catch a missing revoke.
-- Idempotent: safe to run more than once.
-- ============================================================================

do $$
begin
  if exists (select 1 from pg_roles where rolname in ('supabase_admin', 'supabase_auth_admin')) then
    raise exception 'inventory-prod-replica.sql is for a LOCAL test database only (Supabase roles detected)';
  end if;
end $$;

-- ---- Supabase platform stand-in (same as the shared stub; no-op if present) --
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
create table if not exists auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant execute on all functions in schema auth to anon, authenticated, service_role;
create extension if not exists pgcrypto;

-- Supabase default privileges (objects created by postgres in public).
alter default privileges for role postgres in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;

-- ---- profiles ---------------------------------------------------------------
create table if not exists public.profiles (
  id        uuid primary key references auth.users(id) on delete cascade,
  role      text not null default 'customer',
  full_name text,
  constraint profiles_role_check check (role = any (array['customer'::text, 'manager'::text, 'agent'::text]))
);
alter table public.profiles enable row level security;

create or replace function public.is_manager()
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'manager');
$$;
grant execute on function public.is_manager() to anon, authenticated;

drop policy if exists profiles_select_own_or_manager on public.profiles;
create policy profiles_select_own_or_manager on public.profiles
  for select using (id = auth.uid() or is_manager());
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists profiles_manager_update on public.profiles;
create policy profiles_manager_update on public.profiles
  for update using (is_manager()) with check (is_manager());
grant select, insert, update on public.profiles to authenticated;

create or replace function public.protect_privileged_profile_cols()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
begin
  if auth.uid() is null or public.is_manager() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.role := 'customer';
  else
    new.role := old.role;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_protect_privileged_cols on public.profiles;
create trigger trg_protect_privileged_cols
  before insert or update on public.profiles
  for each row execute function public.protect_privileged_profile_cols();

-- ---- products ---------------------------------------------------------------
create table if not exists public.products (
  id                uuid primary key default gen_random_uuid(),
  name              text,
  description       text,
  price             numeric,
  sku               text,
  barcode           text,
  rivhit_id         integer unique,
  stock_quantity    integer default 0,
  picture_link      text,
  rotation_override smallint,
  is_active         boolean default true,
  hidden_manually   boolean default false,
  unit_name         text default 'יחידה',
  display_qty       integer default 1,
  display_name      text default 'מארז',
  carton_qty        integer,
  updated_at        timestamptz default now(),
  category          text
);
alter table public.products enable row level security;
drop policy if exists products_manager_all on public.products;
create policy products_manager_all on public.products
  for all using (is_manager()) with check (is_manager());
drop policy if exists products_select_auth on public.products;
create policy products_select_auth on public.products
  for select using (is_active or is_manager());
revoke all on public.products from anon, authenticated;
grant select on public.products to anon, authenticated;
