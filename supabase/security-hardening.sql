-- ============================================================
-- הקשחת אבטחה — כבר הורץ על הפרודקשן (מתועד כאן לשקיפות/שחזור).
-- כל הבלוקים idempotent ובטוחים להרצה חוזרת.
-- ============================================================
-- רקע: הארכיטקטורה היא static export + Supabase RLS, כך שה-RLS הוא
-- גבול האבטחה האמיתי (בדיקות בצד-לקוח הן UX בלבד). RLS לא יכול להגביל
-- *עמודות*, ולכן נדרשים טריגרים להקפאת שדות רגישים.
--
-- אומת חי מול הפרודקשן:
--   * לקוח שמנסה role='manager' / קישור-רווחית / הנחה עצמית  -> חסום
--   * זיוף מחיר פריט (validate_order_item, enforce_order_rules=on) -> חסום
--   * הזמנה בשם משתמש אחר -> חסום (RLS)
--   * status/total/rivhit_* מזויפים בהזמנת לקוח -> מנוטרלים
--   * קריאת customers / secret_store / הזמנות של אחרים ע"י לקוח -> 0 שורות
-- ============================================================

-- 1) הקפאת עמודות פריבילגיה בפרופיל: רק מנהל/שרת רשאי לשנות
--    role / rivhit_customer_id / discount_percent.
create or replace function public.protect_privileged_profile_cols()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor uuid := auth.uid();
begin
  if actor is null then return new; end if;
  if exists (select 1 from public.profiles where id = actor and role = 'manager') then return new; end if;
  if tg_op = 'INSERT' then
    new.role := 'customer'; new.discount_percent := 0; new.rivhit_customer_id := null;
  else
    new.role := old.role; new.discount_percent := old.discount_percent; new.rivhit_customer_id := old.rivhit_customer_id;
  end if;
  return new;
end $$;
revoke execute on function public.protect_privileged_profile_cols() from public, anon, authenticated;
drop trigger if exists trg_protect_discount_percent on public.profiles;   -- superseded
drop trigger if exists trg_protect_privileged_cols on public.profiles;
create trigger trg_protect_privileged_cols
  before insert or update on public.profiles
  for each row execute function public.protect_privileged_profile_cols();

-- 2) חיטוי הזמנת לקוח: פינון status ל-'new' ואיפוס שדות rivhit_* בהזמנה
--    שנוצרת ע"י לקוח. חוסם גם stored-XSS דרך rivhit_doc_link (המנהל מציג
--    אותו כקישור). מנהל/שרת (rivhit-push) לא מושפעים.
create or replace function public.sanitize_customer_order()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor uuid := auth.uid();
begin
  if actor is null then return new; end if;
  if exists (select 1 from public.profiles where id = actor and role = 'manager') then return new; end if;
  new.status := 'new';
  new.rivhit_doc_id := null; new.rivhit_doc_link := ''; new.rivhit_error := null; new.rivhit_pushed_at := null;
  return new;
end $$;
revoke execute on function public.sanitize_customer_order() from public, anon, authenticated;
drop trigger if exists trg_sanitize_customer_order on public.orders;
create trigger trg_sanitize_customer_order
  before insert on public.orders
  for each row execute function public.sanitize_customer_order();

-- 3) חישוב-מחדש של orders.total מהשורות המאומתות (order_items), כך
--    שהסכום המאוחסן תמיד שווה לסכום האמיתי ולא ניתן לזיוף.
create or replace function public.recompute_order_total()
returns trigger language plpgsql security definer set search_path = public as $$
declare oid uuid := coalesce(new.order_id, old.order_id); s numeric;
begin
  select coalesce(sum(unit_price * quantity), 0) into s from public.order_items where order_id = oid;
  update public.orders set total = s where id = oid;
  return null;
end $$;
revoke execute on function public.recompute_order_total() from public, anon, authenticated;
drop trigger if exists trg_recompute_order_total on public.order_items;
create trigger trg_recompute_order_total
  after insert or update or delete on public.order_items
  for each row execute function public.recompute_order_total();

-- הערה: מחיר-לפריט (order_items.unit_price) כבר נאכף בשרת ע"י
-- validate_order_item (מחשב price*(1-discount) ודוחה אי-התאמה), פעיל כש-
-- site_settings.enforce_order_rules='on'. הקובץ הזה משלים את שאר השדות.
