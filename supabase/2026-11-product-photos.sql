-- Manager-uploaded product photos (additive).
--
-- Rivhit's API cannot store a photo (Item.Update has no picture field and
-- picture_link is a read-only internal path), so an uploaded photo lives in
-- Supabase Storage and the site points products.picture_link at it.
--
-- Two modes per product, chosen by the manager:
--   replace_rivhit = true   the uploaded photo is shown even when Rivhit has one
--   replace_rivhit = false  shown only while Rivhit has NO photo; the moment
--                           Rivhit gets one, Rivhit's wins again
--
-- How it stays applied: rivhit-sync rewrites products.picture_link from
-- Rivhit every 15 minutes. The BEFORE trigger below (same pattern as the
-- existing trg_apply_manual_hide) re-applies the manager's choice on every
-- write of picture_link, and remembers Rivhit's own link so removing the
-- upload restores it at once. Every screen that reads picture_link (catalog,
-- product page, customer views, manager screens) therefore shows the right
-- photo with no change to any existing RPC.
--
-- What this adds (nothing existing is altered or dropped):
--   * storage bucket product-photos (public read; JPEG only; 2 MB)
--   * storage policies: managers may upload / replace / delete in that bucket
--   * table product_photos (+ RLS: managers read; writes only via the RPCs)
--   * trigger trg_product_photo_apply on products (BEFORE INSERT/UPDATE OF picture_link)
--   * RPCs inv_item_photo, inv_set_product_photo, inv_remove_product_photo
--
-- ROLLBACK (restores every product to Rivhit's link first):
--   update public.products p set picture_link = coalesce(ph.rivhit_picture_link, '')
--     from public.product_photos ph where ph.product_id = p.id and p.picture_link = ph.url;
--   drop trigger if exists trg_product_photo_apply on public.products;
--   drop function if exists public.product_photo_apply();
--   drop function if exists public.inv_item_photo(uuid);
--   drop function if exists public.inv_set_product_photo(uuid, text, boolean);
--   drop function if exists public.inv_remove_product_photo(uuid);
--   drop table if exists public.product_photos;
--   (the bucket and its files can be removed from the Storage dashboard)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-photos', 'product-photos', true, 2097152, array['image/jpeg'])
on conflict (id) do nothing;

drop policy if exists "product photos manager insert" on storage.objects;
create policy "product photos manager insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'product-photos' and public.is_manager());
drop policy if exists "product photos manager update" on storage.objects;
create policy "product photos manager update" on storage.objects
  for update to authenticated
  using (bucket_id = 'product-photos' and public.is_manager())
  with check (bucket_id = 'product-photos' and public.is_manager());
drop policy if exists "product photos manager delete" on storage.objects;
create policy "product photos manager delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'product-photos' and public.is_manager());

create table if not exists public.product_photos (
  product_id          uuid primary key references public.products(id),
  url                 text not null,
  replace_rivhit      boolean not null,
  rivhit_picture_link text,
  created_by          uuid not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
alter table public.product_photos enable row level security;
revoke all on public.product_photos from anon, authenticated;
grant select on public.product_photos to authenticated;
drop policy if exists product_photos_manager_read on public.product_photos;
create policy product_photos_manager_read on public.product_photos
  for select to authenticated using (public.is_manager());

-- Re-applies the manager's choice whenever picture_link is written.
create or replace function public.product_photo_apply()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
declare
  o public.product_photos%rowtype;
  v_in text := coalesce(btrim(NEW.picture_link), '');
begin
  select * into o from public.product_photos ph where ph.product_id = NEW.id;
  if not found then return NEW; end if;
  if v_in <> o.url then
    -- What came in is Rivhit's own link (or '' = Rivhit has no photo).
    if v_in is distinct from coalesce(o.rivhit_picture_link, '') then
      update public.product_photos set rivhit_picture_link = v_in where product_id = NEW.id;
    end if;
    if o.replace_rivhit or v_in = '' then
      NEW.picture_link := o.url;
    end if;
  end if;
  return NEW;
end;
$$;
revoke all on function public.product_photo_apply() from public, anon, authenticated;

drop trigger if exists trg_product_photo_apply on public.products;
create trigger trg_product_photo_apply
  before insert or update of picture_link on public.products
  for each row execute function public.product_photo_apply();

-- Current state for the item screen.
create or replace function public.inv_item_photo(p_product_id uuid)
returns table (url text, replace_rivhit boolean, rivhit_picture_link text, shown_picture_link text)
language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if not public.is_manager() then raise exception 'להנהלה בלבד'; end if;
  return query
    select ph.url, ph.replace_rivhit,
           coalesce(ph.rivhit_picture_link, p.picture_link),
           p.picture_link
    from public.products p
    left join public.product_photos ph on ph.product_id = p.id
    where p.id = p_product_id;
end;
$$;
revoke all on function public.inv_item_photo(uuid) from public, anon;
grant execute on function public.inv_item_photo(uuid) to authenticated;

-- Attach an uploaded file (already in the bucket) to a product.
-- p_url must be exactly https://<project>.supabase.co/storage/v1/object/public/
-- product-photos/<product_id>/<10-16 digits>.jpg and the object must exist.
create or replace function public.inv_set_product_photo(p_product_id uuid, p_url text, p_replace boolean)
returns text
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_prod  public.products%rowtype;
  v_old   public.product_photos%rowtype;
  v_path  text;
  v_url   text := btrim(coalesce(p_url, ''));
  v_rivhit text;
  v_shown text;
begin
  if not public.is_manager() then raise exception 'להנהלה בלבד'; end if;
  if p_replace is null then raise exception 'INV_BAD_INPUT:replace'; end if;

  select * into v_prod from public.products p where p.id = p_product_id for update;
  if not found then raise exception 'INV_NOT_FOUND'; end if;
  if not coalesce(v_prod.is_active, false) then raise exception 'INV_PRODUCT_UNAVAILABLE'; end if;

  if v_url !~ ('^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/product-photos/'
               || p_product_id::text || '/[0-9]{10,16}\.jpg$') then
    raise exception 'INV_BAD_INPUT:photo';
  end if;
  v_path := substring(v_url from '/product-photos/(.*)$');
  if not exists (select 1 from storage.objects o where o.bucket_id = 'product-photos' and o.name = v_path) then
    raise exception 'INV_BAD_INPUT:photo';
  end if;

  select * into v_old from public.product_photos ph where ph.product_id = p_product_id;
  -- Rivhit's own link: the remembered one if a photo is already attached,
  -- otherwise what the product shows now.
  v_rivhit := case when found then coalesce(v_old.rivhit_picture_link, '')
                   else coalesce(btrim(v_prod.picture_link), '') end;

  insert into public.product_photos (product_id, url, replace_rivhit, rivhit_picture_link, created_by)
  values (p_product_id, v_url, p_replace, v_rivhit, auth.uid())
  on conflict (product_id) do update
    set url = excluded.url, replace_rivhit = excluded.replace_rivhit,
        rivhit_picture_link = excluded.rivhit_picture_link,
        created_by = excluded.created_by, updated_at = now();

  -- Write Rivhit's link back; the trigger decides what is shown.
  update public.products p set picture_link = v_rivhit where p.id = p_product_id
  returning p.picture_link into v_shown;

  perform public.inv_log(null, p_product_id, 'photo_set', jsonb_build_object(
    'url', v_url, 'replace_rivhit', p_replace, 'previous_url', v_old.url,
    'rivhit_picture_link', v_rivhit, 'shown', v_shown));
  return v_shown;
end;
$$;
revoke all on function public.inv_set_product_photo(uuid, text, boolean) from public, anon;
grant execute on function public.inv_set_product_photo(uuid, text, boolean) to authenticated;

-- Detach: the product goes back to Rivhit's own photo (or none). The file
-- itself stays in the bucket (history; harmless).
create or replace function public.inv_remove_product_photo(p_product_id uuid)
returns text
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_old   public.product_photos%rowtype;
  v_shown text;
begin
  if not public.is_manager() then raise exception 'להנהלה בלבד'; end if;
  perform 1 from public.products p where p.id = p_product_id for update;
  if not found then raise exception 'INV_NOT_FOUND'; end if;
  select * into v_old from public.product_photos ph where ph.product_id = p_product_id;
  if not found then raise exception 'INV_NO_CHANGE'; end if;

  delete from public.product_photos ph where ph.product_id = p_product_id;
  update public.products p set picture_link = coalesce(v_old.rivhit_picture_link, '')
  where p.id = p_product_id
  returning p.picture_link into v_shown;

  perform public.inv_log(null, p_product_id, 'photo_removed', jsonb_build_object(
    'url', v_old.url, 'replace_rivhit', v_old.replace_rivhit, 'restored', v_shown));
  return v_shown;
end;
$$;
revoke all on function public.inv_remove_product_photo(uuid) from public, anon;
grant execute on function public.inv_remove_product_photo(uuid) to authenticated;
