-- "מה שעובר ברווחית לנגמרים — כאילו נמחק מהמערכת. לא למחוק."
-- (Owner's explicit request, 2026-08-24.)
--
-- Mirror of migration hide_discontinued_category_products, as deployed on
-- project mcdchalyzeqjkkgfeznd. Change here AND there.
--
-- HOW THE WHOLE MECHANISM WORKS — two independent lines of defense:
--
-- 1. The rivhit-sync edge function (deployed v17, source not in this repo):
--      const EXCLUDE_NAME = /נ[י]?גמר/
--    It fetches Rivhit's Item.Groups, excludes every group whose name matches
--    (so "נגמרים", "ניגמרים", "מוצרים נגמרים" all count), never upserts their
--    items, and its end-of-run sweep marks every product it did not touch
--    is_active=false. So a product moved to the נגמרים group in Rivhit goes
--    dark on the site within one sync cycle (15 minutes) — data intact.
--
-- 2. This trigger: any write that lands a product row whose CATEGORY TEXT
--    matches the same pattern — a sync run where Item.Groups failed and the
--    group slipped through by name, a manual edit, a future import — is
--    forced inactive at the database itself.
--
-- Nothing is ever deleted. Every public read path filters is_active
-- (catalog, search, collections RPC, public price list, product page by
-- direct link, order validation trigger) — each verified against the live
-- definitions. The category itself disappears from every category list
-- because catalog_categories / catalog_public_categories count only active
-- products.
--
-- Recovery: moving the product OUT of the group in Rivhit brings it back on
-- the next sync (the sync writes is_active=true for every sellable item; the
-- trigger only ever forces false, it never re-activates by itself).

create or replace function public.hide_discontinued_products()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Same pattern the sync uses, so the two lines of defense can never
  -- disagree about what "discontinued" means.
  if new.category is not null and new.category ~ 'נ[י]?גמר' then
    new.is_active := false;
    new.in_stock := false;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_hide_discontinued on public.products;
create trigger trg_hide_discontinued
  before insert or update on public.products
  for each row execute function public.hide_discontinued_products();

-- Backfill for anything already in such a category (0 rows on deploy day).
update public.products set is_active = false
 where category ~ 'נ[י]?גמר' and is_active;
