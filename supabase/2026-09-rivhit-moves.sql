-- Recognise when an item changes group in Rivhit — above all, when the owner's
-- father moves it to "ניגמרים" (group 999) — and keep a log of it.
--
-- FINDING (2026-09-27, live data). Items moved to ניגמרים were hidden from
-- customers (the sync drops group 999 and deactivates what it did not write),
-- but the database kept their OLD group: 222 items that Rivhit lists under
-- ניגמרים were still recorded as "מוצרי בנים", "50 אחוז הנחה" and so on, with
-- no record of the move or of when it happened. The site hid them without
-- knowing why, and nobody could see it happen.
--
-- FIX. (1) rivhit-sync v21 writes the item's real Rivhit group onto every
-- product it does not sell, so the database says "ניגמרים" when Rivhit does.
-- (2) This trigger logs every group change of a product — into ניגמרים, back
-- out of it, or between categories — with the time it was detected.
-- (3) A manager-only read (RLS) for the dashboard.
--
-- Nothing is deleted or overwritten here: a new table, a new trigger, one
-- policy. ROLLBACK:
--   drop trigger if exists trg_log_rivhit_move on public.products;
--   drop function if exists public.log_rivhit_move();
--   drop table if exists public.rivhit_moves;   -- the log only

create table if not exists public.rivhit_moves (
  id            bigint generated always as identity primary key,
  product_id    uuid not null references public.products(id) on delete cascade,
  rivhit_id     integer,
  name          text,
  from_group    integer,
  from_category text,
  to_group      integer,
  to_category   text,
  detected_at   timestamptz not null default now(),
  -- true for the one-time catch-up of moves made before this existed, so the
  -- dashboard does not present months-old moves as "today".
  initial       boolean not null default false
);
create index if not exists rivhit_moves_detected_idx on public.rivhit_moves (detected_at desc);
create index if not exists rivhit_moves_product_idx on public.rivhit_moves (product_id);

alter table public.rivhit_moves enable row level security;
drop policy if exists rivhit_moves_manager_read on public.rivhit_moves;
create policy rivhit_moves_manager_read on public.rivhit_moves
  for select to authenticated using ((select public.is_manager()));
revoke all on public.rivhit_moves from anon;
grant select on public.rivhit_moves to authenticated;

create or replace function public.log_rivhit_move()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.rivhit_moves (product_id, rivhit_id, name, from_group, from_category, to_group, to_category)
  values (new.id, new.rivhit_id, new.name, old.group_id, old.category, new.group_id, new.category);
  return new;
end;
$$;
revoke execute on function public.log_rivhit_move() from public, anon, authenticated;

drop trigger if exists trg_log_rivhit_move on public.products;
create trigger trg_log_rivhit_move
  after update of group_id on public.products
  for each row
  when (old.group_id is distinct from new.group_id)
  execute function public.log_rivhit_move();
