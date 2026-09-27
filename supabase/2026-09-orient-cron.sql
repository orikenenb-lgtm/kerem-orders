-- New product photos arrive on the site rotated — every 15 minutes, automatically fixed.
--
-- FINDING (2026-09-27). Rivhit product photos come from a phone and a large
-- share are not upright even after the EXIF fix in the rivhit-img proxy:
-- across the catalogue 404 of ~1,000 needed a manual/AI rotation (385 × 180°,
-- 19 × 90°). The AI corrector exists — edge function detect-orientation,
-- mode=scan, Claude Haiku, writes products.rotation_override with
-- orient_ai_set=true — but nothing was RUNNING it: of the 90 products added
-- in the 30 days before this, 0 had been checked, so every new photo stayed
-- as it came until someone opened /admin/images-review. A manual batch of
-- 12 new photos found 10 that needed turning.
--
-- FIX. A pg_cron job calls the scan every 15 minutes (offset from the
-- product sync at :00/:15/:30/:45), up to 40 unchecked photos per run. The
-- run token is read from secret_store inside the SQL and never leaves the
-- database. The scan only touches products that are active, have a picture
-- and orient_checked=false, and never overrides a rotation set by a person.
--
-- ROLLBACK: select cron.unschedule('orient-scan-15m');
-- (Rotations already written stay; they are ordinary rotation_override
-- values, editable per product in /admin/images-review.)

select cron.schedule(
  'orient-scan-15m',
  '5,20,35,50 * * * *',
  $job$
  select net.http_post(
    'https://mcdchalyzeqjkkgfeznd.supabase.co/functions/v1/detect-orientation',
    body := '{"mode":"scan","limit":40}'::jsonb,
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select value from public.secret_store where key='orient_run_token')),
    timeout_milliseconds := 170000);
  $job$
);
