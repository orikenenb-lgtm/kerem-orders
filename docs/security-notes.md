# Security notes (public-safe)

This file is deliberately high-level. Detailed, exploit-level findings and the
exact remediation steps for the deployed Edge Functions were shared with the
owner **privately** and are not published in this repository.

## RLS — read-only verification (not applied here)

No RLS/policy/grant/schema/data change is made by this branch. The repo
snapshot (`backups/schema-before.sql`) shows `products` with RLS enabled and a
manager-only `FOR ALL` policy via `is_manager()`, plus an authenticated
`SELECT` policy. If production matches that snapshot, an additional manager-only
UPDATE policy is **redundant**, so the previously-proposed executable migration
has been **removed** from this branch.

Verify the live state with owner credentials before considering any change
(read-only queries):

```sql
-- Is RLS enabled/forced on products?
select relrowsecurity, relforcerowsecurity
from pg_class where oid = 'public.products'::regclass;

-- Every policy, with roles + permissiveness (permissive policies OR together,
-- so any extra permissive UPDATE/ALL policy for non-managers would defeat the
-- manager-only intent):
select policyname, cmd, roles, permissive, qual, with_check
from pg_policies where schemaname='public' and tablename='products';

-- The deployed definition of the gate every policy leans on:
select pg_get_functiondef('public.is_manager()'::regprocedure);
```

Also verify, read-only, that security-sensitive objects are NOT reachable by the
anon/authenticated roles — e.g. any secret-holding table and the Vault-reading
RPCs used by the sync/push functions:

```sql
-- Grants on sensitive tables (expect NO anon/authenticated access):
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema='public' and table_name in ('secret_store','image_audit','image_sheets');

-- Execute grants on the Vault-reading RPCs (expect service_role only):
select p.proname, r.rolname
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
left join lateral aclexplode(p.proacl) a on true
left join pg_roles r on r.oid=a.grantee
where n.nspname='public' and p.proname in ('_get_rivhit_token','_get_sync_secret');
```

## Public image proxy

`rivhit-img` is intentionally unauthenticated (`verify_jwt=false`, pinned in
`supabase/config.toml`) because it is loaded by plain `<img>` tags. Its access
control is the in-code allowlist (host `api.rivhit.co.il`, `getItemPic` path)
plus SSRF, redirect, size, pixel, format, concurrency and sanitized-error
controls. The client-side direct fallback is restricted to the same exact host
and path (`landing/lib/imageFallback.ts`).

## Auth / signup

A secure **proposed** replacement for the deployed `signup` lives in
`supabase/functions/signup/` (clearly labeled proposed; not the deployed
source). It never grants manager by email, never pre-confirms a public signup,
ignores client-supplied role fields, returns account-existence-neutral errors,
and requires a Turnstile token. Deployment is owner-gated
(`docs/edge-functions-runbook.md`).
