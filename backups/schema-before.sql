-- ============================================================================
-- Kerem Toys — database schema snapshot BEFORE the 2026 upgrade wave.
-- Captured read-only from project mcdchalyzeqjkkgfeznd. This is a REFERENCE
-- backup for rollback context; the live source of truth is Supabase itself,
-- and the branch tag `pre-upgrade-backup` / branch `backup/pre-upgrade-2026`
-- pin the matching code state. Nothing here is executed automatically.
-- ============================================================================

-- ---- Business tables (only the ones the app uses) --------------------------
-- NOTE: the project also contains unrelated tables from other apps sharing the
-- same Supabase project (news, price_cache, setups, trades, wa_*). They are
-- OUT OF SCOPE for this site and must not be touched.

CREATE TABLE public.products (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text DEFAULT ''::text,
  price numeric NOT NULL DEFAULT 0,
  image_url text DEFAULT ''::text,
  emoji text DEFAULT '🧸'::text,
  category text DEFAULT ''::text,
  sku text DEFAULT ''::text,
  in_stock boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  rivhit_id integer,
  group_id integer,
  barcode text DEFAULT ''::text,
  stock_quantity integer DEFAULT 0,
  picture_link text DEFAULT ''::text,
  is_active boolean NOT NULL DEFAULT true,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.orders (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'new'::text,
  total numeric NOT NULL DEFAULT 0,
  note text DEFAULT ''::text,
  contact_name text DEFAULT ''::text,
  contact_phone text DEFAULT ''::text,
  business_name text DEFAULT ''::text,
  created_at timestamptz NOT NULL DEFAULT now(),
  contact_email text DEFAULT ''::text,
  rivhit_doc_id integer,
  rivhit_pushed_at timestamptz,
  rivhit_error text,
  rivhit_doc_link text DEFAULT ''::text
);

CREATE TABLE public.order_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  product_id uuid,
  product_name text NOT NULL,
  unit_price numeric NOT NULL DEFAULT 0,
  quantity integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  product_sku text DEFAULT ''::text
);

CREATE TABLE public.profiles (
  id uuid NOT NULL,
  email text,
  full_name text DEFAULT ''::text,
  business_name text DEFAULT ''::text,
  phone text DEFAULT ''::text,
  role text NOT NULL DEFAULT 'customer'::text,
  created_at timestamptz NOT NULL DEFAULT now(),
  rivhit_customer_id integer,
  vat_number text DEFAULT ''::text,
  discount_percent numeric NOT NULL DEFAULT 0
);

CREATE TABLE public.customers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  rivhit_id integer,
  name text DEFAULT ''::text,
  city text DEFAULT ''::text,
  phone text DEFAULT ''::text,
  email text DEFAULT ''::text,
  price_list_id integer,
  discount_percent numeric DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  updated_at timestamptz DEFAULT now(),
  vat_number text DEFAULT ''::text
);

CREATE TABLE public.site_settings (
  key text NOT NULL,
  value text NOT NULL DEFAULT ''::text
);

CREATE TABLE public.rivhit_sync_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  mode text NOT NULL DEFAULT 'dryrun'::text,
  what text NOT NULL DEFAULT 'both'::text,
  status text NOT NULL DEFAULT 'running'::text,
  summary jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

-- ---- RLS policies (business tables) ----------------------------------------
-- products
CREATE POLICY products_manager_all ON public.products FOR ALL TO public USING (is_manager()) WITH CHECK (is_manager());
CREATE POLICY products_select_auth ON public.products FOR SELECT TO public USING (auth.uid() IS NOT NULL);
-- orders
CREATE POLICY orders_insert_own   ON public.orders FOR INSERT TO public WITH CHECK (user_id = auth.uid());
CREATE POLICY orders_manager_update ON public.orders FOR UPDATE TO public USING (is_manager()) WITH CHECK (is_manager());
CREATE POLICY orders_select        ON public.orders FOR SELECT TO public USING ((user_id = auth.uid()) OR is_manager());
-- order_items
CREATE POLICY order_items_insert_own ON public.order_items FOR INSERT TO public WITH CHECK (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_items.order_id AND o.user_id = auth.uid()));
CREATE POLICY order_items_select     ON public.order_items FOR SELECT TO public USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_items.order_id AND (o.user_id = auth.uid() OR is_manager())));
-- profiles
CREATE POLICY profiles_insert_own    ON public.profiles FOR INSERT TO public WITH CHECK (id = auth.uid());
CREATE POLICY profiles_manager_update ON public.profiles FOR UPDATE TO public USING (is_manager()) WITH CHECK (is_manager());
CREATE POLICY profiles_select        ON public.profiles FOR SELECT TO public USING ((id = auth.uid()) OR is_manager());
CREATE POLICY profiles_update_own    ON public.profiles FOR UPDATE TO public USING (id = auth.uid()) WITH CHECK (id = auth.uid());
-- customers
CREATE POLICY customers_manager_read ON public.customers FOR SELECT TO public USING (is_manager());
-- site_settings
CREATE POLICY anon_read_public_flags   ON public.site_settings FOR SELECT TO anon USING (key = 'prices_include_vat'::text);
CREATE POLICY site_settings_manager_write ON public.site_settings FOR ALL TO public USING (is_manager()) WITH CHECK (is_manager());
CREATE POLICY site_settings_read       ON public.site_settings FOR SELECT TO public USING (auth.uid() IS NOT NULL);
-- rivhit_sync_runs
CREATE POLICY rivhit_runs_manager_read ON public.rivhit_sync_runs FOR SELECT TO public USING (is_manager());

-- ---- Public catalog functions (SECURITY DEFINER, granted to anon/auth) -----
-- catalog_categories()          -> (category, n)               [authenticated]
-- catalog_public(q,cat,lim,off) -> id,name,picture,category,in_stock,rank,total [anon+auth] (no price)
-- catalog_public_prices(...)    -> ...,price,...               [anon+auth]
-- catalog_public_categories()   -> (category, n)               [anon+auth]
-- search_products(q,lim,off)    -> id,name,price,sku,barcode,picture,stock,rank,total [authenticated]
-- is_manager()                  -> boolean (profiles.role = 'manager')
-- (Full bodies captured in the migration history; see supabase/*.sql in repo.)

-- ---- Scheduled jobs (pg_cron) ----------------------------------------------
-- jobid 1 | '0 3 * * *' | POST .../functions/v1/rivhit-sync {"mode":"sync","what":"both"}
--   => Rivhit product+customer sync runs ONCE DAILY at 03:00 UTC.

-- ---- Edge functions (Supabase) ---------------------------------------------
-- signup (verify_jwt=false)      : create+confirm user, profile w/ vat_number, manager promotion
-- rivhit-sync (verify_jwt=false) : daily read-only pull Item.List/Customer.List/Item.Groups; excludes group 999 + /נגמר/; deactivate-not-delete; anti-wipe guard
-- rivhit-push (verify_jwt=false) : create-only Rivhit quote (Document type 6) from an order; VAT->phone->email->name customer match; idempotent via orders.rivhit_doc_id
-- rivhit-img  (verify_jwt=false) : image proxy w/ allowlist + w= edge resize (v4)
-- (probe functions rivhit-probe-* : dev only)
