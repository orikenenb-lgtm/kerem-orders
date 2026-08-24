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

-- 2026-08-24, owner's follow-up: "כן תעביר גם את לא פעילים לאותו כלל."
-- The Rivhit group "לא פעילים" is id 9999; the sync's hardcoded fallback
-- excludes only 999 and the name does not match נגמר — which is exactly how
-- one product leaked onto the live site under a category named "not active".
-- The sync keeps upserting that product with is_active:true every 15 minutes,
-- and this BEFORE trigger overrules it to false on that same write — so it
-- stays dark without touching the sync function at all.
create or replace function public.hide_discontinued_products()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Two spellings of the same intent: a group whose name contains נגמר/ניגמר
  -- ("running out"), or one containing לא פעיל ("not active").
  if new.category is not null
     and (new.category ~ 'נ[י]?גמר' or new.category like '%לא פעיל%') then
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

-- Backfill for anything already in such a category (the נגמרים pass found 0;
-- the לא פעילים pass found exactly one — בובה בן מדברת, rivhit 537).
update public.products set is_active = false, in_stock = false
 where (category ~ 'נ[י]?גמר' or category like '%לא פעיל%') and is_active;
