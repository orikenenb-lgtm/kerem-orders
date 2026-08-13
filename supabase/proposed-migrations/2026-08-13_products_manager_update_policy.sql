-- PROPOSED MIGRATION — NOT APPLIED. Requires owner approval + verification.
--
-- Deliberately placed under supabase/proposed-migrations/ (NOT
-- supabase/migrations/) so no CLI migration flow can ever pick it up by
-- accident.
--
-- Why: the live RLS policies on public.products could not be verified from
-- this environment (pg_policies is not exposed to the anon key, and testing
-- by writing to production data is forbidden). The repo reference snapshot
-- (backups/schema-before.sql:108-109) shows:
--
--   CREATE POLICY products_manager_all  ON public.products FOR ALL
--     TO public USING (is_manager()) WITH CHECK (is_manager());
--   CREATE POLICY products_select_auth  ON public.products FOR SELECT
--     TO public USING (auth.uid() IS NOT NULL);
--
-- If production matches the snapshot, customers cannot UPDATE products and
-- this migration is redundant-but-explicit (RLS policies are OR-combined, so
-- adding it cannot widen access). If production DIFFERS from the snapshot,
-- this restores an explicit manager-only write boundary for the fields the
-- admin screens write (rotation_override, orient_human_ok, packaging).
--
-- BEFORE APPLYING, verify the live state with owner credentials:
--   select policyname, cmd, qual, with_check
--   from pg_policies where schemaname='public' and tablename='products';
--
-- NOTE: RLS is row-scoped. It cannot restrict WHICH COLUMNS a manager
-- updates — column-level protection belongs in triggers like the ones in
-- supabase/security-hardening.sql.

alter table public.products enable row level security;

drop policy if exists products_manager_update on public.products;
create policy products_manager_update
  on public.products
  for update
  to authenticated
  using (public.is_manager())
  with check (public.is_manager());

-- ---------------------------------------------------------------------------
-- ROLLBACK (exact):
--
--   drop policy if exists products_manager_update on public.products;
--
-- If products_manager_all was dropped in favor of granular policies (NOT
-- part of this migration), restore it too:
--
--   create policy products_manager_all on public.products
--     for all to public using (public.is_manager()) with check (public.is_manager());
-- ---------------------------------------------------------------------------
