-- ============================================================
-- הפעלת הנחה קבועה ללקוחות (per-customer fixed discount)
-- ============================================================
-- ✅ כבר הורץ על מסד הנתונים בפרודקשן (migration: customer_fixed_discounts).
--    הקובץ נשמר לתיעוד/שחזור. בטוח להריץ שוב — הכול idempotent, לא מוחק
--    נתונים ולא נוגע בהרשאות RLS.
--
-- מה זה עושה:
--   1. עמודת discount_percent ל-profiles ול-customers (0-99, ברירת מחדל 0).
--   2. טריגר הגנה: רק מנהל/שרת יכול לשנות הנחה — לקוח לא יכול לקבוע לעצמו.
--   3. סנכרון אוטומטי: הנחה שמסונכרנת מרווחית ל-customers עוברת מיד
--      לפרופיל המקושר; וגם נמשכת ברגע שמנהל מקשר חשבון ללקוח רווחית.
--   4. מילוי ראשוני של ההנחות הקיימות לפרופילים המקושרים.
-- ============================================================

-- 1) עמודות ההנחה.
alter table public.profiles
  add column if not exists discount_percent numeric not null default 0;
alter table public.customers
  add column if not exists discount_percent numeric not null default 0;

-- 2) גבולות שפיות: 0 עד 99 אחוז.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_discount_percent_range') then
    alter table public.profiles
      add constraint profiles_discount_percent_range
      check (discount_percent >= 0 and discount_percent < 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'customers_discount_percent_range') then
    alter table public.customers
      add constraint customers_discount_percent_range
      check (coalesce(discount_percent, 0) >= 0 and coalesce(discount_percent, 0) < 100);
  end if;
end $$;

comment on column public.profiles.discount_percent is
  'הנחה קבועה באחוזים (0-99) שהלקוח רואה ומקבל בכל המחירים באתר. 0 = אין הנחה. מתעדכן אוטומטית מרווחית ללקוח מקושר.';
comment on column public.customers.discount_percent is
  'הנחה קבועה כפי שמסונכרנת מרווחית (Customer.List). 0 = אין הנחה.';

-- 3) הגנה קשיחה: רק מנהל או הקשר שרת רשאים לשנות הנחה.
create or replace function public.protect_discount_percent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    return new; -- SQL editor / service role / edge functions
  end if;
  if exists (select 1 from public.profiles where id = actor and role = 'manager') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.discount_percent := 0;
  else
    new.discount_percent := old.discount_percent;
  end if;
  return new;
end $$;

revoke execute on function public.protect_discount_percent() from public, anon, authenticated;

drop trigger if exists trg_protect_discount_percent on public.profiles;
create trigger trg_protect_discount_percent
  before insert or update of discount_percent on public.profiles
  for each row execute function public.protect_discount_percent();

-- 4) סנכרון אוטומטי מרווחית: customers.discount_percent → הפרופיל המקושר.
create or replace function public.propagate_customer_discount()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.rivhit_id is not null then
    update public.profiles
    set discount_percent = coalesce(new.discount_percent, 0)
    where rivhit_customer_id = new.rivhit_id
      and discount_percent is distinct from coalesce(new.discount_percent, 0);
  end if;
  return new;
end $$;

revoke execute on function public.propagate_customer_discount() from public, anon, authenticated;

drop trigger if exists trg_propagate_customer_discount on public.customers;
create trigger trg_propagate_customer_discount
  after insert or update of discount_percent on public.customers
  for each row execute function public.propagate_customer_discount();

-- 5) משיכת ההנחה ברגע שמנהל מקשר חשבון אתר ללקוח רווחית.
create or replace function public.pull_discount_on_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  d numeric;
begin
  if new.rivhit_customer_id is not null
     and new.rivhit_customer_id is distinct from old.rivhit_customer_id then
    select coalesce(discount_percent, 0) into d
    from public.customers where rivhit_id = new.rivhit_customer_id
    limit 1;
    if found then
      new.discount_percent := coalesce(d, 0);
    end if;
  end if;
  return new;
end $$;

revoke execute on function public.pull_discount_on_link() from public, anon, authenticated;

drop trigger if exists trg_pull_discount_on_link on public.profiles;
create trigger trg_pull_discount_on_link
  before update of rivhit_customer_id on public.profiles
  for each row execute function public.pull_discount_on_link();

-- 6) מילוי ראשוני: ההנחות הקיימות מרווחית → הפרופילים המקושרים.
update public.profiles p
set discount_percent = coalesce(c.discount_percent, 0)
from public.customers c
where p.rivhit_customer_id = c.rivhit_id
  and p.discount_percent is distinct from coalesce(c.discount_percent, 0);

-- אימות.
select table_name, column_name, column_default
from information_schema.columns
where column_name = 'discount_percent' and table_schema = 'public'
order by table_name;
