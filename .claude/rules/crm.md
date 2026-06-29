# CRM Module — Additive-Only Architecture

The CRM is layered on top of the live Kerem Orders system. The order system must keep working untouched at all times.

## Naming
- Every new object is prefixed `crm_`: tables, columns, indexes, constraints, API routes (a `crm` router in `app/routers/`, mounted under `/crm/...`), Next.js components (`Crm*`), and files (under a `crm/` folder or named `crm_*`).

## Database
- **Additive only.** CREATE new `crm_` tables and columns. NEVER ALTER, RENAME, or DROP existing tables or columns.
- If CRM needs data from an existing table, READ it — don't change its schema. Foreign keys go FROM `crm_` tables TO existing IDs, never the reverse.
- Enable Supabase RLS on every new `crm_` table.
- Use the `db-migrator` sub-agent for all schema changes.

## Feature flags
- All CRM features sit behind a flag, OFF by default (a backend setting in `app/config.py`, mirrored to the landing).
- With the flag off, the app must behave exactly as before — no new routes, no UI, no queries firing.

## Code isolation
- Don't edit existing business logic to make CRM work. Add new modules: new routers in `app/routers/`, new services in `app/services/`, new `Crm*` components in `landing/`.
- Shared utilities: import them read-only; don't change their signatures.

## Stop conditions
- If a task appears to require touching existing (non-`crm_`) schema or logic — STOP and ask. Propose an additive alternative instead.
