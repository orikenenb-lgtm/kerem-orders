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
-- ===========================================================================
-- PREFLIGHT — run with owner credentials BEFORE applying, and SAVE the
-- output (it is the input to the rollback below):
--
--   -- (a) Is RLS enabled/forced at all? Policies are inert while
--   --     relrowsecurity is false — and if it IS false, applying this
--   --     migration flips enforcement on, which is a behavior change.
--   select relrowsecurity, relforcerowsecurity
--   from pg_class where oid = 'public.products'::regclass;
--
--   -- (b) ALL policies incl. roles + permissiveness. PostgreSQL ORs every
--   --     applicable PERMISSIVE policy together: if any permissive
--   --     UPDATE/ALL policy applies to non-managers, this migration does
--   --     NOT block them — that policy must be removed/replaced first.
--   select policyname, cmd, roles, permissive, qual, with_check
--   from pg_policies where schemaname='public' and tablename='products';
--
--   -- (c) What is_manager() actually is in production:
--   select pg_get_functiondef('public.is_manager()'::regprocedure);
--
-- Then replay this file in a SAFE environment (local `supabase start` or a
-- branch DB) and verify: manager UPDATE succeeds, anon/customer UPDATE
-- fails. Never verify by writing to production.
--
-- NOTE: RLS is row-scoped. It cannot restrict WHICH COLUMNS a manager
-- updates — column-level protection belongs in triggers like the ones in
-- supabase/security-hardening.sql.
-- ===========================================================================

alter table public.products enable row level security;

drop policy if exists products_manager_update on public.products;
create policy products_manager_update
  on public.products
  for update
  to authenticated
  using (public.is_manager())
  with check (public.is_manager());

-- ---------------------------------------------------------------------------
-- ROLLBACK (exact — restore the PRE-APPLY state captured by the preflight,
-- not an assumed one):
--
-- 1. Always:
--
--   drop policy if exists products_manager_update on public.products;
--
-- 2. Only if preflight (a) showed relrowsecurity = false (i.e. THIS
--    migration is what enabled RLS):
--
--   alter table public.products disable row level security;
--
-- 3. Only if preflight (b) showed a PRE-EXISTING products_manager_update
--    policy (this migration dropped and recreated it): recreate it from the
--    saved preflight output — cmd, roles, permissive, qual, with_check must
--    all match the saved definition, e.g.:
--
--   create policy products_manager_update on public.products
--     for update to <saved roles>
--     using (<saved qual>) with check (<saved with_check>);
--
-- 4. If products_manager_all was dropped in favor of granular policies (NOT
--    part of this migration), restore it too:
--
--   create policy products_manager_all on public.products
--     for all to public using (public.is_manager()) with check (public.is_manager());
--
-- Validate after rollback: re-run preflight (a)+(b) and diff against the
-- saved pre-apply output — they must be identical.
-- ---------------------------------------------------------------------------
