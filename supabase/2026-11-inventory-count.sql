-- ============================================================================
-- November 2026: stock count (ספירת מלאי), manager-only.
-- Binding contract: docs/inventory/CONTRACT.md.
--
-- FINDING (2026-11-24, live data). Stock on the site is Rivhit's book stock
-- (products.stock_quantity, overwritten by rivhit-sync every 15 min). There is
-- no way to record a physical count: managers count on paper, and nothing ties
-- a count to the stock it was compared with, to who counted it, or to the
-- Rivhit document that corrected it. Codes are text (leading zeros exist) and
-- 17 sku values are shared by 47 active products, so a scan can match several.
--
-- FIX. Additive only. Five new tables and ten new RPCs:
--   inventory_settings (singleton), inventory_counts, inventory_count_lines,
--   inventory_events (append-only history), product_edit_requests;
--   inv_lookup, inv_search, inv_open_count, inv_save_line, inv_delete_line,
--   inv_approve, inv_cancel, inv_request_item_edit, inv_resolve_line.
-- ADDENDUM 1 (independent review, 2026-11-24), applied in place so the file
-- stays the final state; every change is also an idempotent ALTER so the file
-- upgrades a database that already ran the first version, keeping its data:
--   R2 sync_status 'skipped' + inv_resolve_line(): a stuck needs_attention count
--      can always be closed, with a note and a line_skipped event.
--   R3 rivhit_baseline_qty / rivhit_baseline_at on lines (set by the edge
--      function's capture_baseline, cleared by every inv_save_line).
--   R4 inv_save_line / inv_delete_line / inv_resolve_line bump the COUNT version,
--      so inv_approve(p_expected_version) approves exactly what was reviewed.
--   R5 inv_request_item_edit also refuses a code that another OPEN request is
--      about to set on another product.
--   R6 product_edit_requests.rivhit_before jsonb (the engine's snapshot).
-- * RLS on every table, SELECT for managers only, NO insert/update/delete
--   policies or grants for anon/authenticated. Writes go through the SECURITY
--   DEFINER RPCs (each starts with is_manager()) or the service role (the
--   inventory-sync edge function).
-- * The baseline (book stock at the save) and every actor (counted_by,
--   created_by, approved_by, requested_by, events.actor) are taken on the
--   server from products / auth.uid(). No parameter can set them.
-- * NOTHING here writes to products. A draft or an approval never changes
--   stock; only the edge function (live mode) does, after Rivhit confirms.
-- * Existing tables and functions are not altered. Re-running the file is
--   safe (create ... if not exists / create or replace / drop policy if exists,
--   the settings row is inserted with on conflict do nothing).
--
-- Error messages the client can rely on (raise exception text):
--   'להנהלה בלבד'                       caller is not a manager
--   INV_BAD_CODE                        code not 1-32 (lookup/scan) or 1-15
--                                       (item edit) chars of [0-9A-Za-z-]
--   INV_BAD_QTY                         counted qty null, < 0 or > 10,000,000
--   INV_BAD_INPUT:<field>               note/storage_name/name too long or empty,
--                                       sku cleared
--   INV_NOT_FOUND                       count / product not found
--   INV_PRODUCT_UNAVAILABLE             product inactive or without rivhit_id
--   INV_ACTIVE_EXISTS:<count id>        an active count exists for the storage
--   INV_NOT_DRAFT:<status>              line change on a count that is not draft
--                                       (and not a permitted recount)
--   INV_CONFLICT                        new line raced / line already deleted
--   INV_CONFLICT:<counted_qty>:<ver>    line version mismatch
--   INV_CONFLICT:<status>:<ver>         count approve/cancel: wrong status/version
--   INV_EMPTY                           approve a count without lines
--   INV_NO_CHANGE                       item edit that changes nothing
--   INV_DUPLICATE_CODE:<product name>   new code used by another active product
--   INV_EDIT_PENDING:<request id>       an open edit request exists for the product
--   INV_NOT_RESOLVABLE:<count status>:<line status>
--                                       inv_resolve_line outside needs_attention or
--                                       on a line not failed/unknown/changed
--
-- ROLLBACK (DATA LOSS: deletes every count, line, event and edit request;
-- products are untouched):
--   drop function if exists public.inv_resolve_line(uuid, text);
--   drop function if exists public.inv_request_item_edit(uuid, text, text, text);
--   drop function if exists public.inv_cancel(uuid, integer);
--   drop function if exists public.inv_approve(uuid, integer);
--   drop function if exists public.inv_delete_line(uuid, uuid, integer);
--   drop function if exists public.inv_save_line(uuid, uuid, integer, integer, text);
--   drop function if exists public.inv_open_count(integer, text, text);
--   drop function if exists public.inv_search(text);
--   drop function if exists public.inv_lookup(text);
--   drop function if exists public.inv_log(uuid, uuid, text, jsonb);
--   drop table if exists public.inventory_events;
--   drop table if exists public.product_edit_requests;
--   drop table if exists public.inventory_count_lines;
--   drop table if exists public.inventory_counts;
--   drop table if exists public.inventory_settings;
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------------

create table if not exists public.inventory_settings (
  id                    integer primary key check (id = 1),
  rivhit_writes_enabled boolean not null default false,
  rivhit_customer_id    integer null,
  rivhit_last_name      text not null default 'ספירת מלאי',
  doc_type_in           integer not null default 11,
  doc_type_out          integer not null default 10,
  highlight_abs_diff    integer not null default 20,
  updated_at            timestamptz not null default now(),
  updated_by            uuid
);
insert into public.inventory_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.inventory_counts (
  id           uuid primary key default gen_random_uuid(),
  storage_id   integer null,
  storage_name text null,
  status       text not null default 'draft',
  note         text,
  created_by   uuid not null,
  created_at   timestamptz not null default now(),
  approved_by  uuid,
  approved_at  timestamptz,
  finished_at  timestamptz,
  version      integer not null default 1,
  mode         text null,
  constraint inventory_counts_status_check
    check (status in ('draft', 'approved', 'syncing', 'done', 'needs_attention', 'cancelled')),
  constraint inventory_counts_mode_check
    check (mode is null or mode in ('live', 'simulation'))
);
-- One active count per warehouse (null storage = the single default storage).
create unique index if not exists inventory_counts_one_active_idx
  on public.inventory_counts ((coalesce(storage_id, 0)))
  where status in ('draft', 'approved', 'syncing', 'needs_attention');
create index if not exists inventory_counts_created_idx
  on public.inventory_counts (created_at desc);

create table if not exists public.inventory_count_lines (
  id                uuid primary key default gen_random_uuid(),
  count_id          uuid not null references public.inventory_counts(id) on delete restrict,
  product_id        uuid not null references public.products(id) on delete restrict,
  rivhit_id         integer not null,
  product_name      text not null,
  code_scanned      text null,
  counted_qty       integer not null,
  baseline_qty      integer not null,
  baseline_at       timestamptz,
  counted_by        uuid not null,
  counted_at        timestamptz not null,
  version           integer not null default 1,
  sync_status       text not null default 'pending',
  sync_ref          uuid null,
  rivhit_before_qty integer,
  delta             integer,
  rivhit_doc_type   integer,
  rivhit_doc_number text,
  rivhit_after_qty  integer,
  attempts          integer not null default 0,
  last_error        text,
  synced_at         timestamptz,
  constraint inventory_count_lines_counted_qty_check
    check (counted_qty >= 0 and counted_qty <= 10000000),
  constraint inventory_count_lines_sync_status_check
    check (sync_status in ('pending', 'in_progress', 'sent', 'done', 'no_change', 'unknown', 'failed', 'changed', 'skipped')),
  constraint inventory_count_lines_count_product_key unique (count_id, product_id)
);
-- Addendum 1, for databases that ran the first version of this file.
-- R2: 'skipped' (terminal, set only by inv_resolve_line).
alter table public.inventory_count_lines drop constraint if exists inventory_count_lines_sync_status_check;
alter table public.inventory_count_lines add constraint inventory_count_lines_sync_status_check
  check (sync_status in ('pending', 'in_progress', 'sent', 'done', 'no_change', 'unknown', 'failed', 'changed', 'skipped'));
-- R3: the baseline read from Rivhit itself (capture_baseline); null = not captured.
alter table public.inventory_count_lines add column if not exists rivhit_baseline_qty integer null;
alter table public.inventory_count_lines add column if not exists rivhit_baseline_at  timestamptz null;
create index if not exists inventory_count_lines_product_idx
  on public.inventory_count_lines (product_id);

create table if not exists public.inventory_events (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor      uuid null,
  count_id   uuid null,
  product_id uuid null,
  kind       text not null,
  detail     jsonb not null default '{}'::jsonb
);
create index if not exists inventory_events_count_idx   on public.inventory_events (count_id, at);
create index if not exists inventory_events_product_idx on public.inventory_events (product_id, at);
create index if not exists inventory_events_at_idx      on public.inventory_events (at desc);

create table if not exists public.product_edit_requests (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references public.products(id),
  rivhit_id    integer not null,
  old_name     text,
  new_name     text,
  old_barcode  text,
  new_barcode  text,
  old_sku      text,
  new_sku      text,
  status       text not null default 'pending',
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  finished_at  timestamptz,
  attempts     integer not null default 0,
  last_error   text,
  constraint product_edit_requests_status_check
    check (status in ('pending', 'in_progress', 'done', 'failed', 'unknown'))
);
-- R6: the complete Rivhit item record read before the first Item.Update.
alter table public.product_edit_requests add column if not exists rivhit_before jsonb null;
-- One open request per product.
create unique index if not exists product_edit_requests_one_open_idx
  on public.product_edit_requests (product_id)
  where status in ('pending', 'in_progress', 'unknown');
create index if not exists product_edit_requests_requested_idx
  on public.product_edit_requests (requested_at desc);


-- ---------------------------------------------------------------------------
-- 2. RLS AND GRANTS: managers read, nobody but the service role writes.
-- ---------------------------------------------------------------------------
-- Supabase grants every new table to anon and authenticated by name, so the
-- revoke must name them; RLS alone would still let a grant-holder try writes.

alter table public.inventory_settings    enable row level security;
alter table public.inventory_counts      enable row level security;
alter table public.inventory_count_lines enable row level security;
alter table public.inventory_events      enable row level security;
alter table public.product_edit_requests enable row level security;

drop policy if exists inventory_settings_manager_read on public.inventory_settings;
create policy inventory_settings_manager_read on public.inventory_settings
  for select to authenticated using ((select public.is_manager()));
drop policy if exists inventory_counts_manager_read on public.inventory_counts;
create policy inventory_counts_manager_read on public.inventory_counts
  for select to authenticated using ((select public.is_manager()));
drop policy if exists inventory_count_lines_manager_read on public.inventory_count_lines;
create policy inventory_count_lines_manager_read on public.inventory_count_lines
  for select to authenticated using ((select public.is_manager()));
drop policy if exists inventory_events_manager_read on public.inventory_events;
create policy inventory_events_manager_read on public.inventory_events
  for select to authenticated using ((select public.is_manager()));
drop policy if exists product_edit_requests_manager_read on public.product_edit_requests;
create policy product_edit_requests_manager_read on public.product_edit_requests
  for select to authenticated using ((select public.is_manager()));

revoke all on public.inventory_settings    from public, anon, authenticated;
revoke all on public.inventory_counts      from public, anon, authenticated;
revoke all on public.inventory_count_lines from public, anon, authenticated;
revoke all on public.inventory_events      from public, anon, authenticated;
revoke all on public.product_edit_requests from public, anon, authenticated;
grant select on public.inventory_settings    to authenticated;
grant select on public.inventory_counts      to authenticated;
grant select on public.inventory_count_lines to authenticated;
grant select on public.inventory_events      to authenticated;
grant select on public.product_edit_requests to authenticated;
-- The edge function (service role, bypasses RLS).
grant select, insert, update, delete on public.inventory_settings    to service_role;
grant select, insert, update, delete on public.inventory_counts      to service_role;
grant select, insert, update, delete on public.inventory_count_lines to service_role;
grant select, insert, update, delete on public.inventory_events      to service_role;
grant select, insert, update, delete on public.product_edit_requests to service_role;


-- ---------------------------------------------------------------------------
-- 3. RPCs
-- ---------------------------------------------------------------------------

-- Internal: append one history row. The actor is ALWAYS auth.uid(). Not
-- callable by clients (no execute for anon/authenticated).
create or replace function public.inv_log(p_count_id uuid, p_product_id uuid, p_kind text, p_detail jsonb)
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  insert into public.inventory_events (actor, count_id, product_id, kind, detail)
  values (auth.uid(), p_count_id, p_product_id, p_kind, coalesce(p_detail, '{}'::jsonb));
end;
$$;
revoke all on function public.inv_log(uuid, uuid, text, jsonb) from public, anon, authenticated;


-- inv_lookup: exact scan match on sku/barcode, with UPC-A <-> EAN-13 variants.
create or replace function public.inv_lookup(p_code text)
returns table (
  product_id uuid, rivhit_id integer, name text, sku text, barcode text,
  picture_link text, rotation_override smallint, stock_quantity integer,
  unit_name text, display_qty integer, display_name text, is_active boolean,
  updated_at timestamptz
)
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_code  text;
  v_codes text[];
begin
  if not public.is_manager() then raise exception 'להנהלה בלבד'; end if;

  v_code := btrim(coalesce(p_code, ''));
  if v_code !~ '^[0-9A-Za-z-]{1,32}$' then raise exception 'INV_BAD_CODE'; end if;

  v_codes := array[v_code];
  if v_code ~ '^[0-9]{12}$' then
    v_codes := v_codes || ('0' || v_code);          -- UPC-A scanned, EAN-13 stored
  elsif v_code ~ '^0[0-9]{12}$' then
    v_codes := v_codes || substr(v_code, 2);        -- EAN-13 scanned, UPC-A stored
  end if;

  return query
    select p.id, p.rivhit_id, p.name, p.sku, p.barcode, p.picture_link,
           p.rotation_override, p.stock_quantity, p.unit_name, p.display_qty,
           p.display_name, p.is_active, p.updated_at
    from public.products p
    where p.is_active and p.rivhit_id is not null
      and (p.sku = any (v_codes) or p.barcode = any (v_codes))
    order by p.name, p.id
    limit 20;
end;
$$;
revoke all on function public.inv_lookup(text) from public, anon;
grant execute on function public.inv_lookup(text) to authenticated;


-- inv_search: manual search by name/sku/barcode (same cleaning as sanitizeQuery).
create or replace function public.inv_search(p_q text)
returns table (
  product_id uuid, rivhit_id integer, name text, sku text, barcode text,
  picture_link text, rotation_override smallint, stock_quantity integer,
  unit_name text, display_qty integer, display_name text, is_active boolean,
  updated_at timestamptz
)
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_q text;
begin
  if not public.is_manager() then raise exception 'להנהלה בלבד'; end if;

  -- sanitizeQuery: , ( ) % _ become spaces; backslash too (the ilike escape).
  v_q := btrim(regexp_replace(regexp_replace(coalesce(p_q, ''), '[,()%_\\]', ' ', 'g'), '\s+', ' ', 'g'));
  v_q := left(v_q, 64);
  if v_q = '' then return; end if;

  return query
    select p.id, p.rivhit_id, p.name, p.sku, p.barcode, p.picture_link,
           p.rotation_override, p.stock_quantity, p.unit_name, p.display_qty,
           p.display_name, p.is_active, p.updated_at
    from public.products p
    where p.is_active and p.rivhit_id is not null
      and (p.name ilike '%' || v_q || '%'
           or p.sku ilike '%' || v_q || '%'
           or p.barcode ilike '%' || v_q || '%')
    order by p.name, p.id
    limit 30;
end;
$$;
revoke all on function public.inv_search(text) from public, anon;
grant execute on function public.inv_search(text) to authenticated;


-- inv_open_count: one active count per storage.
create or replace function public.inv_open_count(p_storage_id integer, p_storage_name text, p_note text)
returns uuid
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_existing uuid;
  v_id       uuid;
  v_name     text := nullif(btrim(coalesce(p_storage_name, '')), '');
  v_note     text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.is_manager() then raise exception 'להנהלה בלבד'; end if;

  if length(v_name) > 100 then raise exception 'INV_BAD_INPUT:storage_name'; end if;
  if length(v_note) > 500 then raise exception 'INV_BAD_INPUT:note'; end if;

  select c.id into v_existing
  from public.inventory_counts c
  where coalesce(c.storage_id, 0) = coalesce(p_storage_id, 0)
    and c.status in ('draft', 'approved', 'syncing', 'needs_attention')
  limit 1;
  if v_existing is not null then
    raise exception 'INV_ACTIVE_EXISTS:%', v_existing;
  end if;

  begin
    insert into public.inventory_counts (storage_id, storage_name, note, created_by)
    values (p_storage_id, v_name, v_note, auth.uid())
    returning id into v_id;
  exception when unique_violation then
    -- Another manager opened one between our check and our insert.
    select c.id into v_existing
    from public.inventory_counts c
    where coalesce(c.storage_id, 0) = coalesce(p_storage_id, 0)
      and c.status in ('draft', 'approved', 'syncing', 'needs_attention')
    limit 1;
    raise exception 'INV_ACTIVE_EXISTS:%', v_existing;
  end;

  perform public.inv_log(v_id, null, 'count_opened',
    jsonb_build_object('storage_id', p_storage_id, 'storage_name', v_name, 'note', v_note));
  return v_id;
end;
$$;
revoke all on function public.inv_open_count(integer, text, text) from public, anon;
grant execute on function public.inv_open_count(integer, text, text) to authenticated;


-- inv_save_line: create or replace one product's counted quantity.
create or replace function public.inv_save_line(
  p_count_id uuid, p_product_id uuid, p_counted integer, p_expected_version integer, p_code text
)
returns table (line_id uuid, version integer, counted_qty integer, baseline_qty integer, counted_at timestamptz)
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_count   public.inventory_counts%rowtype;
  v_prod    public.products%rowtype;
  v_line    public.inventory_count_lines%rowtype;
  v_code    text := nullif(btrim(coalesce(p_code, '')), '');
  v_recount boolean := false;
  v_new     public.inventory_count_lines%rowtype;
begin
  if not public.is_manager() then raise exception 'להנהלה בלבד'; end if;

  if p_counted is null or p_counted < 0 or p_counted > 10000000 then
    raise exception 'INV_BAD_QTY';
  end if;
  if v_code is not null and v_code !~ '^[0-9A-Za-z-]{1,32}$' then
    raise exception 'INV_BAD_CODE';
  end if;

  -- Lock the count: serialises saves against approve/cancel and each other.
  select * into v_count from public.inventory_counts c where c.id = p_count_id for update;
  if not found then raise exception 'INV_NOT_FOUND'; end if;

  select * into v_line from public.inventory_count_lines l
  where l.count_id = p_count_id and l.product_id = p_product_id
  for update;

  if v_count.status = 'draft' then
    null;
  elsif v_count.status = 'needs_attention' and v_line.id is not null and v_line.sync_status = 'changed' then
    v_recount := true;
  else
    raise exception 'INV_NOT_DRAFT:%', v_count.status;
  end if;

  -- The baseline comes from products, here, now. Never from the client.
  select * into v_prod from public.products p where p.id = p_product_id;
  if not found then raise exception 'INV_NOT_FOUND'; end if;
  if not coalesce(v_prod.is_active, false) or v_prod.rivhit_id is null then
    raise exception 'INV_PRODUCT_UNAVAILABLE';
  end if;

  if v_line.id is null then
    if p_expected_version is not null then
      raise exception 'INV_CONFLICT';          -- the line was deleted meanwhile
    end if;
    begin
      insert into public.inventory_count_lines as l
        (count_id, product_id, rivhit_id, product_name, code_scanned, counted_qty,
         baseline_qty, baseline_at, rivhit_baseline_qty, rivhit_baseline_at, counted_by, counted_at, version)
      values
        (p_count_id, p_product_id, v_prod.rivhit_id, coalesce(v_prod.name, ''), v_code, p_counted,
         coalesce(v_prod.stock_quantity, 0), v_prod.updated_at, null, null, auth.uid(), now(), 1)
      returning l.* into v_new;
    exception when unique_violation then
      raise exception 'INV_CONFLICT';
    end;
  else
    if p_expected_version is distinct from v_line.version then
      raise exception 'INV_CONFLICT:%:%', v_line.counted_qty, v_line.version;
    end if;
    update public.inventory_count_lines l set
      rivhit_id    = v_prod.rivhit_id,
      product_name = coalesce(v_prod.name, l.product_name),
      code_scanned = coalesce(v_code, l.code_scanned),
      counted_qty  = p_counted,
      baseline_qty = coalesce(v_prod.stock_quantity, 0),
      baseline_at  = v_prod.updated_at,
      -- R3: a new quantity needs a new Rivhit baseline (capture_baseline).
      rivhit_baseline_qty = null,
      rivhit_baseline_at  = null,
      counted_by   = auth.uid(),
      counted_at   = now(),
      version      = l.version + 1,
      sync_status  = case when v_recount then 'pending' else l.sync_status end,
      sync_ref     = case when v_recount then null else l.sync_ref end,
      last_error   = case when v_recount then null else l.last_error end
    where l.id = v_line.id
    returning l.* into v_new;
  end if;

  -- R4: any change to the lines invalidates an approval screen rendered before it.
  update public.inventory_counts c set version = c.version + 1 where c.id = p_count_id;

  perform public.inv_log(p_count_id, p_product_id, 'line_saved', jsonb_build_object(
    'line_id', v_new.id,
    'recount', v_recount,
    'code', v_code,
    'before', case when v_line.id is null then null else jsonb_build_object(
      'counted_qty', v_line.counted_qty, 'baseline_qty', v_line.baseline_qty,
      'version', v_line.version, 'sync_status', v_line.sync_status) end,
    'after', jsonb_build_object(
      'counted_qty', v_new.counted_qty, 'baseline_qty', v_new.baseline_qty,
      'baseline_at', v_new.baseline_at, 'version', v_new.version)));

  return query select v_new.id, v_new.version, v_new.counted_qty, v_new.baseline_qty, v_new.counted_at;
end;
$$;
revoke all on function public.inv_save_line(uuid, uuid, integer, integer, text) from public, anon;
grant execute on function public.inv_save_line(uuid, uuid, integer, integer, text) to authenticated;


-- inv_delete_line: remove a line from a draft count.
create or replace function public.inv_delete_line(p_count_id uuid, p_product_id uuid, p_expected_version integer)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_count public.inventory_counts%rowtype;
  v_line  public.inventory_count_lines%rowtype;
begin
  if not public.is_manager() then raise exception 'להנהלה בלבד'; end if;

  select * into v_count from public.inventory_counts c where c.id = p_count_id for update;
  if not found then raise exception 'INV_NOT_FOUND'; end if;
  if v_count.status <> 'draft' then raise exception 'INV_NOT_DRAFT:%', v_count.status; end if;

  select * into v_line from public.inventory_count_lines l
  where l.count_id = p_count_id and l.product_id = p_product_id
  for update;
  if not found then raise exception 'INV_CONFLICT'; end if;
  if p_expected_version is distinct from v_line.version then
    raise exception 'INV_CONFLICT:%:%', v_line.counted_qty, v_line.version;
  end if;

  delete from public.inventory_count_lines l where l.id = v_line.id;
  update public.inventory_counts c set version = c.version + 1 where c.id = p_count_id;   -- R4

  perform public.inv_log(p_count_id, p_product_id, 'line_deleted', jsonb_build_object(
    'line_id', v_line.id, 'product_name', v_line.product_name,
    'counted_qty', v_line.counted_qty, 'baseline_qty', v_line.baseline_qty,
    'version', v_line.version));
end;
$$;
revoke all on function public.inv_delete_line(uuid, uuid, integer) from public, anon;
grant execute on function public.inv_delete_line(uuid, uuid, integer) to authenticated;


-- inv_approve: draft -> approved. Does NOT touch stock; the sync does that.
create or replace function public.inv_approve(p_count_id uuid, p_expected_version integer)
returns text
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_count   public.inventory_counts%rowtype;
  v_thr     integer;
  v_summary jsonb;
begin
  if not public.is_manager() then raise exception 'להנהלה בלבד'; end if;

  select * into v_count from public.inventory_counts c where c.id = p_count_id for update;
  if not found then raise exception 'INV_NOT_FOUND'; end if;
  if v_count.status <> 'draft' or p_expected_version is distinct from v_count.version then
    raise exception 'INV_CONFLICT:%:%', v_count.status, v_count.version;
  end if;

  select coalesce((select s.highlight_abs_diff from public.inventory_settings s where s.id = 1), 20)
  into v_thr;

  select jsonb_build_object(
           'lines',          count(*),
           'total_counted',  coalesce(sum(l.counted_qty), 0),
           'total_baseline', coalesce(sum(l.baseline_qty), 0),
           'total_diff',     coalesce(sum(l.counted_qty - l.baseline_qty), 0),
           'lines_with_diff', count(*) filter (where l.counted_qty <> l.baseline_qty),
           'lines_highlighted', count(*) filter (where abs(l.counted_qty - l.baseline_qty) >= v_thr),
           'highlight_abs_diff', v_thr)
  into v_summary
  from public.inventory_count_lines l
  where l.count_id = p_count_id;

  if (v_summary->>'lines')::int < 1 then raise exception 'INV_EMPTY'; end if;

  update public.inventory_counts c set
    status      = 'approved',
    approved_by = auth.uid(),
    approved_at = now(),
    version     = c.version + 1
  where c.id = p_count_id;

  perform public.inv_log(p_count_id, null, 'count_approved', v_summary);
  return 'approved';
end;
$$;
revoke all on function public.inv_approve(uuid, integer) from public, anon;
grant execute on function public.inv_approve(uuid, integer) to authenticated;


-- inv_cancel: draft -> cancelled (frees the storage for a new count).
create or replace function public.inv_cancel(p_count_id uuid, p_expected_version integer)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_count public.inventory_counts%rowtype;
  v_lines integer;
begin
  if not public.is_manager() then raise exception 'להנהלה בלבד'; end if;

  select * into v_count from public.inventory_counts c where c.id = p_count_id for update;
  if not found then raise exception 'INV_NOT_FOUND'; end if;
  if v_count.status <> 'draft' or p_expected_version is distinct from v_count.version then
    raise exception 'INV_CONFLICT:%:%', v_count.status, v_count.version;
  end if;

  select count(*) into v_lines from public.inventory_count_lines l where l.count_id = p_count_id;

  update public.inventory_counts c set
    status      = 'cancelled',
    finished_at = now(),
    version     = c.version + 1
  where c.id = p_count_id;

  perform public.inv_log(p_count_id, null, 'count_cancelled', jsonb_build_object('lines', v_lines));
end;
$$;
revoke all on function public.inv_cancel(uuid, integer) from public, anon;
grant execute on function public.inv_cancel(uuid, integer) to authenticated;


-- inv_request_item_edit: queue a name/barcode/sku change for Rivhit.
-- products is NOT changed here. new_* hold the intended FINAL values
-- (an unchanged field is copied from old_*; a cleared barcode is '').
create or replace function public.inv_request_item_edit(
  p_product_id uuid, p_new_name text, p_new_barcode text, p_new_sku text
)
returns uuid
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_prod    public.products%rowtype;
  v_name    text;
  v_barcode text;
  v_sku     text;
  v_dup     text;
  v_open    uuid;
  v_id      uuid;
begin
  if not public.is_manager() then raise exception 'להנהלה בלבד'; end if;

  select * into v_prod from public.products p where p.id = p_product_id;
  if not found then raise exception 'INV_NOT_FOUND'; end if;
  if not coalesce(v_prod.is_active, false) or v_prod.rivhit_id is null then
    raise exception 'INV_PRODUCT_UNAVAILABLE';
  end if;

  -- Name: null = unchanged; otherwise trimmed, 1-100 chars.
  if p_new_name is null then
    v_name := v_prod.name;
  else
    v_name := btrim(p_new_name);
    if length(v_name) < 1 or length(v_name) > 100 then raise exception 'INV_BAD_INPUT:name'; end if;
  end if;

  -- Barcode: null = unchanged, '' = clear, else 1-15 of [0-9A-Za-z-].
  if p_new_barcode is null then
    v_barcode := v_prod.barcode;
  else
    v_barcode := btrim(p_new_barcode);
    if v_barcode <> '' and v_barcode !~ '^[0-9A-Za-z-]{1,15}$' then raise exception 'INV_BAD_CODE'; end if;
  end if;

  -- Sku: null = unchanged, '' is refused (the scan code cannot be cleared).
  if p_new_sku is null then
    v_sku := v_prod.sku;
  else
    v_sku := btrim(p_new_sku);
    if v_sku = '' then raise exception 'INV_BAD_INPUT:sku'; end if;
    if v_sku !~ '^[0-9A-Za-z-]{1,15}$' then raise exception 'INV_BAD_CODE'; end if;
  end if;

  if v_name is not distinct from v_prod.name
     and coalesce(v_barcode, '') = coalesce(v_prod.barcode, '')
     and coalesce(v_sku, '') = coalesce(v_prod.sku, '') then
    raise exception 'INV_NO_CHANGE';
  end if;

  -- A NEW code must not already identify another active product. Unchanged
  -- codes are not re-checked (17 skus are already shared in production).
  if coalesce(v_barcode, '') <> '' and coalesce(v_barcode, '') <> coalesce(v_prod.barcode, '') then
    select p.name into v_dup from public.products p
    where p.id <> p_product_id and p.is_active and (p.sku = v_barcode or p.barcode = v_barcode)
    order by p.name limit 1;
    if found then raise exception 'INV_DUPLICATE_CODE:%', coalesce(v_dup, ''); end if;
    -- R5: nor be about to be set on another product by an open request.
    select p.name into v_dup from public.product_edit_requests r join public.products p on p.id = r.product_id
    where r.product_id <> p_product_id and r.status in ('pending', 'in_progress', 'unknown')
      and (r.new_barcode = v_barcode or r.new_sku = v_barcode)
    order by p.name limit 1;
    if found then raise exception 'INV_DUPLICATE_CODE:%', coalesce(v_dup, ''); end if;
  end if;
  if coalesce(v_sku, '') <> coalesce(v_prod.sku, '') then
    select p.name into v_dup from public.products p
    where p.id <> p_product_id and p.is_active and (p.sku = v_sku or p.barcode = v_sku)
    order by p.name limit 1;
    if found then raise exception 'INV_DUPLICATE_CODE:%', coalesce(v_dup, ''); end if;
    select p.name into v_dup from public.product_edit_requests r join public.products p on p.id = r.product_id
    where r.product_id <> p_product_id and r.status in ('pending', 'in_progress', 'unknown')
      and (r.new_barcode = v_sku or r.new_sku = v_sku)
    order by p.name limit 1;
    if found then raise exception 'INV_DUPLICATE_CODE:%', coalesce(v_dup, ''); end if;
  end if;

  select r.id into v_open from public.product_edit_requests r
  where r.product_id = p_product_id and r.status in ('pending', 'in_progress', 'unknown')
  limit 1;
  if v_open is not null then raise exception 'INV_EDIT_PENDING:%', v_open; end if;

  begin
    insert into public.product_edit_requests
      (product_id, rivhit_id, old_name, new_name, old_barcode, new_barcode, old_sku, new_sku, requested_by)
    values
      (p_product_id, v_prod.rivhit_id, v_prod.name, v_name, v_prod.barcode, v_barcode, v_prod.sku, v_sku, auth.uid())
    returning id into v_id;
  exception when unique_violation then
    select r.id into v_open from public.product_edit_requests r
    where r.product_id = p_product_id and r.status in ('pending', 'in_progress', 'unknown')
    limit 1;
    raise exception 'INV_EDIT_PENDING:%', v_open;
  end;

  perform public.inv_log(null, p_product_id, 'item_edit_requested', jsonb_build_object(
    'request_id', v_id,
    'old', jsonb_build_object('name', v_prod.name, 'barcode', v_prod.barcode, 'sku', v_prod.sku),
    'new', jsonb_build_object('name', v_name, 'barcode', v_barcode, 'sku', v_sku)));
  return v_id;
end;
$$;
revoke all on function public.inv_request_item_edit(uuid, text, text, text) from public, anon;
grant execute on function public.inv_request_item_edit(uuid, text, text, text) to authenticated;


-- R2 inv_resolve_line: close a stuck line of a needs_attention count with a
-- note. The line becomes 'skipped' (terminal: the sync never touches it), its
-- sync_ref and document fields are kept for the audit, and the count rolls up
-- to 'done' once every line is done / no_change / skipped.
-- WARNING for the UI: for an 'unknown' line a Rivhit document may already
-- exist; the manager must check Rivhit by hand.
create or replace function public.inv_resolve_line(p_line_id uuid, p_note text)
returns text
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_note     text := btrim(coalesce(p_note, ''));
  v_count_id uuid;
  v_count    public.inventory_counts%rowtype;
  v_line     public.inventory_count_lines%rowtype;
  v_status   text;
begin
  if not public.is_manager() then raise exception 'להנהלה בלבד'; end if;

  if length(v_note) < 3 or length(v_note) > 500 then raise exception 'INV_BAD_INPUT:note'; end if;

  select l.count_id into v_count_id from public.inventory_count_lines l where l.id = p_line_id;
  if v_count_id is null then raise exception 'INV_NOT_FOUND'; end if;

  -- Same lock order as the other RPCs: the count, then the line.
  select * into v_count from public.inventory_counts c where c.id = v_count_id for update;
  select * into v_line from public.inventory_count_lines l where l.id = p_line_id for update;
  if not found then raise exception 'INV_NOT_FOUND'; end if;

  if v_count.status <> 'needs_attention' or v_line.sync_status not in ('failed', 'unknown', 'changed') then
    raise exception 'INV_NOT_RESOLVABLE:%:%', v_count.status, v_line.sync_status;
  end if;

  update public.inventory_count_lines l set sync_status = 'skipped' where l.id = p_line_id;

  if exists (select 1 from public.inventory_count_lines l
             where l.count_id = v_count_id and l.sync_status not in ('done', 'no_change', 'skipped')) then
    v_status := 'needs_attention';
    update public.inventory_counts c set version = c.version + 1 where c.id = v_count_id;
  else
    v_status := 'done';
    update public.inventory_counts c set status = 'done', finished_at = now(), version = c.version + 1
    where c.id = v_count_id;
  end if;

  perform public.inv_log(v_count_id, v_line.product_id, 'line_skipped', jsonb_build_object(
    'line_id', p_line_id,
    'before_status', v_line.sync_status,
    'note', v_note,
    'sync_ref', v_line.sync_ref,
    'rivhit_doc_number', v_line.rivhit_doc_number,
    'last_error', v_line.last_error,
    'count_status', v_status,
    'mode', v_count.mode));
  return v_status;
end;
$$;
revoke all on function public.inv_resolve_line(uuid, text) from public, anon;
grant execute on function public.inv_resolve_line(uuid, text) to authenticated;
