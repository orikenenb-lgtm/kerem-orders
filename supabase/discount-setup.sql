-- ============================================================
-- הפעלת הנחה קבועה ללקוחות (per-customer fixed discount)
-- ============================================================
-- מה זה עושה: מוסיף עמודת discount_percent לטבלת profiles (ההנחה
-- שהלקוח מקבל באתר) ולטבלת customers (ההנחה כפי שתסונכרן מרווחית
-- בעתיד). בטוח להריץ כמה פעמים (IF NOT EXISTS בכל שלב), לא משנה
-- ולא מוחק שום נתון קיים, ולא נוגע בהרשאות (RLS) בשום צורה.
--
-- איך מריצים: Supabase Dashboard → SQL Editor → הדבק הכול → Run.
-- עד שמריצים — האתר מתנהג בדיוק כמו היום (הפיצ'ר רדום).
-- ============================================================

-- 1) ההנחה שחשבון האתר מקבל בפועל (המנהל קובע במסך "לקוחות").
alter table public.profiles
  add column if not exists discount_percent numeric not null default 0;

-- 2) ההנחה כפי שמופיעה ברווחית (יתמלא ע"י הסנכרון בהמשך; לא חובה עכשיו).
alter table public.customers
  add column if not exists discount_percent numeric not null default 0;

-- 3) גבולות שפיות: 0 עד 99 אחוז.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_discount_percent_range'
  ) then
    alter table public.profiles
      add constraint profiles_discount_percent_range
      check (discount_percent >= 0 and discount_percent < 100);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'customers_discount_percent_range'
  ) then
    alter table public.customers
      add constraint customers_discount_percent_range
      check (discount_percent >= 0 and discount_percent < 100);
  end if;
end $$;

comment on column public.profiles.discount_percent is
  'הנחה קבועה באחוזים (0-99) שהלקוח רואה ומקבל בכל המחירים באתר. 0 = אין הנחה.';
comment on column public.customers.discount_percent is
  'הנחה קבועה כפי שמסונכרנת מרווחית (Customer.List). 0 = אין הנחה.';

-- 4) הגנה קשיחה: רק מנהל (או תהליך שרת) רשאי לקבוע/לשנות הנחה.
--    בלי זה, אם מדיניות ה-RLS מתירה ללקוח לעדכן את השורה של עצמו —
--    לקוח היה יכול לקבוע לעצמו הנחה דרך ה-API. הטריגר חוסם זאת
--    בשקט (משאיר את הערך הקודם), בלי לשבור שום זרימה קיימת:
--    - self-heal של לקוח מוסיף שורה בלי discount_percent → נשאר 0 ✓
--    - עדכוני מנהל (קישור רווחית / קביעת הנחה) → מותר ✓
--    - פונקציות Edge / SQL Editor (auth.uid() ריק) → מותר ✓
create or replace function public.protect_discount_percent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
begin
  -- הקשר שרת (SQL Editor / service role / Edge Function) — מותר.
  if actor is null then
    return new;
  end if;
  -- מנהל — מותר.
  if exists (select 1 from public.profiles where id = actor and role = 'manager') then
    return new;
  end if;
  -- לקוח: ההנחה אינה בשליטתו — משאירים את הערך הקודם בשקט.
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

-- אימות: אמור להחזיר שתי שורות (profiles + customers).
select table_name, column_name, column_default
from information_schema.columns
where column_name = 'discount_percent'
  and table_schema = 'public'
order by table_name;
