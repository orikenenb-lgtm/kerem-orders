# Product photo orientation fix — 2026-11-09

Owner's report: "we upload the photos straight and on the site they flip".

## Cause

- `rivhit-img` straightens photos from the EXIF Orientation tag with imagescript's
  `Image.rotate()`, passing clockwise degrees — but that call turns **counter-clockwise**.
  Every upright phone photo (EXIF 6/8) is therefore served upside down unless
  `rotation_override = 180`. 223 products had been fixed by hand exactly that way.
- Since 2026-09-27 the AI scanner (`detect-orientation` v19, cron `orient-scan-15m`)
  guessed the rotation for new photos; it often answered 90, or failed and gave up.
- Measured on all 852 active products (EXIF read from every photo): 25 shown wrong —
  11 upside down, 8 sideways (EXIF 6), 3 marked "OK" but upside down, 3 EXIF-1 photos
  the AI turned sideways. Each one was checked by eye before the fix.

## Fix

1. `detect-orientation` v20 (source in git): reads the EXIF tag, EXIF 5–8 → 180, else none.
   Never overrides a person's choice; re-straightens a replaced photo; verify pass off.
2. One-time data fix of the 25 rows below (guarded: a row changes only if it still
   holds the value recorded here).

## The 25 rows: before → after

| id | product | on site before | rotation before | ai | human_ok | attempts | rotation after |
|---|---|---|---|---|---|---|---|
| `0a63742d-1f1d-49b2-9c72-ae061e60831c` | המבורגר נידו חדש | sideways | 90 | true | false | 0 | 180 |
| `12ace8bb-b14e-4c94-a011-c380457835a2` | צמיד אפרוח | upside down | null | false | false | 0 | 180 |
| `22e21026-71c2-42ac-ab97-cd6e14f0e9ba` | מפריח בלונים פיל | upside down | null | false | false | 0 | 180 |
| `23a92a01-8b4e-41f0-a802-ae0614bc22a1` | שיקשוק קיטי | sideways | 90 | true | false | 2 | 180 |
| `2ee164f7-930a-49e8-bd05-f943a146f5a9` | שיקשוק סטיצ | upside down | null | false | false | 3 | 180 |
| `30084851-77ed-4358-8196-c41903550c9e` | שיקשוק פוקימון | upside down | null | false | false | 3 | 180 |
| `73f99dbd-b727-448c-b83e-4188ddeec5d2` | שיקשוק מריו | upside down | null | false | false | 3 | 180 |
| `771d7f17-6861-484d-9ba0-8ccffde1b690` | מפריח בלונים חד קרן | upside down | null | false | false | 3 | 180 |
| `77f88008-e99c-4173-a420-88a8b8f38343` | ביצה קרח | sideways | 90 | true | false | 2 | 180 |
| `78b45aa2-a076-4ad6-beb2-1887cd98850a` | קופת חיסכון ורודה | sideways | 90 | true | false | 1 | 180 |
| `7ba2b3bb-8b9a-41f1-a15a-ebb70788bcfe` | קופת חיסכון כלב | sideways | 90 | true | false | 0 | 180 |
| `7d43e8d1-ee10-443d-9053-3d045eb16897` | ענבים קרח | upside down | null | false | false | 3 | 180 |
| `90a8d07a-42f1-41b6-b18b-7d4bd0e47a34` | עגבניה קרח | sideways | 90 | true | false | 1 | 180 |
| `96544296-d38b-4928-b0f7-0d9919670e44` | מפריח בלונים מיקי מיני | upside down | null | false | false | 0 | 180 |
| `9fa0c204-6d11-4167-9d88-516933c0434e` | שיקשוק פירות | upside down | null | false | false | 0 | 180 |
| `b154aa28-3956-497c-8700-d2aee0023f81` | מחק מיקי | upside down (marked OK by mistake) | null | false | true | 0 | 180 |
| `c38e0e17-f83c-480b-aac9-83744dd5f7d4` | קלפי כדורגל | upside down (marked OK by mistake) | null | false | true | 0 | 180 |
| `c3946d1d-0287-446f-8ab2-57edfae4924d` | חניון משאית גדול | sideways (EXIF 1, AI turned it) | 90 | true | false | 0 | null |
| `dcab3508-5ce3-4d4d-b7f5-0078aea5d6fa` | מכונית שלט דלתות נפתחות | sideways (EXIF 1, AI turned it) | 90 | true | false | 0 | null |
| `e0435ed8-b434-4140-b4cb-9a7a5b79fc1e` | סט ציפורניים ושיער | upside down | null | false | false | 3 | 180 |
| `e27e1269-657e-4994-9455-818cdc53476b` | סקוושי סטיצ | upside down | null | false | false | 3 | 180 |
| `e8d88871-cef4-4055-9c13-be87bed669f4` | שעון קיטי | upside down (marked OK by mistake) | null | false | true | 0 | 180 |
| `e9c1e977-660b-4eab-bbdd-eeb9245f7140` | מפריח בלונים סטיצ | sideways | 90 | true | false | 1 | 180 |
| `f800ada7-4379-46f5-a698-8aef6d74cd82` | חיילים בשקית גדולה | sideways (EXIF 1, AI turned it) | 90 | true | false | 0 | null |
| `f8def429-e491-4a45-89dc-ee40b96665f8` | קופת חיסכון דובי | sideways | 90 | true | false | 0 | 180 |

## Fix SQL (applied once)

```sql
begin;
update public.products set rotation_override = 180, orient_ai_set = true, orient_human_ok = false, orient_verified = true where id = '0a63742d-1f1d-49b2-9c72-ae061e60831c' and rotation_override = 90 and orient_human_ok = false;
update public.products set rotation_override = 180, orient_ai_set = true, orient_human_ok = false, orient_verified = true where id = '12ace8bb-b14e-4c94-a011-c380457835a2' and rotation_override is null and orient_human_ok = false;
update public.products set rotation_override = 180, orient_ai_set = true, orient_human_ok = false, orient_verified = true where id = '22e21026-71c2-42ac-ab97-cd6e14f0e9ba' and rotation_override is null and orient_human_ok = false;
update public.products set rotation_override = 180, orient_ai_set = true, orient_human_ok = false, orient_verified = true where id = '23a92a01-8b4e-41f0-a802-ae0614bc22a1' and rotation_override = 90 and orient_human_ok = false;
update public.products set rotation_override = 180, orient_ai_set = true, orient_human_ok = false, orient_verified = true where id = '2ee164f7-930a-49e8-bd05-f943a146f5a9' and rotation_override is null and orient_human_ok = false;
update public.products set rotation_override = 180, orient_ai_set = true, orient_human_ok = false, orient_verified = true where id = '30084851-77ed-4358-8196-c41903550c9e' and rotation_override is null and orient_human_ok = false;
update public.products set rotation_override = 180, orient_ai_set = true, orient_human_ok = false, orient_verified = true where id = '73f99dbd-b727-448c-b83e-4188ddeec5d2' and rotation_override is null and orient_human_ok = false;
update public.products set rotation_override = 180, orient_ai_set = true, orient_human_ok = false, orient_verified = true where id = '771d7f17-6861-484d-9ba0-8ccffde1b690' and rotation_override is null and orient_human_ok = false;
update public.products set rotation_override = 180, orient_ai_set = true, orient_human_ok = false, orient_verified = true where id = '77f88008-e99c-4173-a420-88a8b8f38343' and rotation_override = 90 and orient_human_ok = false;
update public.products set rotation_override = 180, orient_ai_set = true, orient_human_ok = false, orient_verified = true where id = '78b45aa2-a076-4ad6-beb2-1887cd98850a' and rotation_override = 90 and orient_human_ok = false;
update public.products set rotation_override = 180, orient_ai_set = true, orient_human_ok = false, orient_verified = true where id = '7ba2b3bb-8b9a-41f1-a15a-ebb70788bcfe' and rotation_override = 90 and orient_human_ok = false;
update public.products set rotation_override = 180, orient_ai_set = true, orient_human_ok = false, orient_verified = true where id = '7d43e8d1-ee10-443d-9053-3d045eb16897' and rotation_override is null and orient_human_ok = false;
update public.products set rotation_override = 180, orient_ai_set = true, orient_human_ok = false, orient_verified = true where id = '90a8d07a-42f1-41b6-b18b-7d4bd0e47a34' and rotation_override = 90 and orient_human_ok = false;
update public.products set rotation_override = 180, orient_ai_set = true, orient_human_ok = false, orient_verified = true where id = '96544296-d38b-4928-b0f7-0d9919670e44' and rotation_override is null and orient_human_ok = false;
update public.products set rotation_override = 180, orient_ai_set = true, orient_human_ok = false, orient_verified = true where id = '9fa0c204-6d11-4167-9d88-516933c0434e' and rotation_override is null and orient_human_ok = false;
update public.products set rotation_override = 180, orient_ai_set = true, orient_human_ok = false, orient_verified = true where id = 'b154aa28-3956-497c-8700-d2aee0023f81' and rotation_override is null and orient_human_ok = true;
update public.products set rotation_override = 180, orient_ai_set = true, orient_human_ok = false, orient_verified = true where id = 'c38e0e17-f83c-480b-aac9-83744dd5f7d4' and rotation_override is null and orient_human_ok = true;
update public.products set rotation_override = null, orient_ai_set = false, orient_human_ok = false, orient_verified = true where id = 'c3946d1d-0287-446f-8ab2-57edfae4924d' and rotation_override = 90 and orient_human_ok = false;
update public.products set rotation_override = null, orient_ai_set = false, orient_human_ok = false, orient_verified = true where id = 'dcab3508-5ce3-4d4d-b7f5-0078aea5d6fa' and rotation_override = 90 and orient_human_ok = false;
update public.products set rotation_override = 180, orient_ai_set = true, orient_human_ok = false, orient_verified = true where id = 'e0435ed8-b434-4140-b4cb-9a7a5b79fc1e' and rotation_override is null and orient_human_ok = false;
update public.products set rotation_override = 180, orient_ai_set = true, orient_human_ok = false, orient_verified = true where id = 'e27e1269-657e-4994-9455-818cdc53476b' and rotation_override is null and orient_human_ok = false;
update public.products set rotation_override = 180, orient_ai_set = true, orient_human_ok = false, orient_verified = true where id = 'e8d88871-cef4-4055-9c13-be87bed669f4' and rotation_override is null and orient_human_ok = true;
update public.products set rotation_override = 180, orient_ai_set = true, orient_human_ok = false, orient_verified = true where id = 'e9c1e977-660b-4eab-bbdd-eeb9245f7140' and rotation_override = 90 and orient_human_ok = false;
update public.products set rotation_override = null, orient_ai_set = false, orient_human_ok = false, orient_verified = true where id = 'f800ada7-4379-46f5-a698-8aef6d74cd82' and rotation_override = 90 and orient_human_ok = false;
update public.products set rotation_override = 180, orient_ai_set = true, orient_human_ok = false, orient_verified = true where id = 'f8def429-e491-4a45-89dc-ee40b96665f8' and rotation_override = 90 and orient_human_ok = false;
commit;
```

## Rollback

Data — restores the 25 rows exactly:

```sql
begin;
update public.products set rotation_override = 90, orient_ai_set = true, orient_human_ok = false, orient_verified = false where id = '0a63742d-1f1d-49b2-9c72-ae061e60831c';
update public.products set rotation_override = null, orient_ai_set = false, orient_human_ok = false, orient_verified = false where id = '12ace8bb-b14e-4c94-a011-c380457835a2';
update public.products set rotation_override = null, orient_ai_set = false, orient_human_ok = false, orient_verified = false where id = '22e21026-71c2-42ac-ab97-cd6e14f0e9ba';
update public.products set rotation_override = 90, orient_ai_set = true, orient_human_ok = false, orient_verified = false where id = '23a92a01-8b4e-41f0-a802-ae0614bc22a1';
update public.products set rotation_override = null, orient_ai_set = false, orient_human_ok = false, orient_verified = false where id = '2ee164f7-930a-49e8-bd05-f943a146f5a9';
update public.products set rotation_override = null, orient_ai_set = false, orient_human_ok = false, orient_verified = false where id = '30084851-77ed-4358-8196-c41903550c9e';
update public.products set rotation_override = null, orient_ai_set = false, orient_human_ok = false, orient_verified = false where id = '73f99dbd-b727-448c-b83e-4188ddeec5d2';
update public.products set rotation_override = null, orient_ai_set = false, orient_human_ok = false, orient_verified = false where id = '771d7f17-6861-484d-9ba0-8ccffde1b690';
update public.products set rotation_override = 90, orient_ai_set = true, orient_human_ok = false, orient_verified = false where id = '77f88008-e99c-4173-a420-88a8b8f38343';
update public.products set rotation_override = 90, orient_ai_set = true, orient_human_ok = false, orient_verified = false where id = '78b45aa2-a076-4ad6-beb2-1887cd98850a';
update public.products set rotation_override = 90, orient_ai_set = true, orient_human_ok = false, orient_verified = false where id = '7ba2b3bb-8b9a-41f1-a15a-ebb70788bcfe';
update public.products set rotation_override = null, orient_ai_set = false, orient_human_ok = false, orient_verified = false where id = '7d43e8d1-ee10-443d-9053-3d045eb16897';
update public.products set rotation_override = 90, orient_ai_set = true, orient_human_ok = false, orient_verified = false where id = '90a8d07a-42f1-41b6-b18b-7d4bd0e47a34';
update public.products set rotation_override = null, orient_ai_set = false, orient_human_ok = false, orient_verified = false where id = '96544296-d38b-4928-b0f7-0d9919670e44';
update public.products set rotation_override = null, orient_ai_set = false, orient_human_ok = false, orient_verified = false where id = '9fa0c204-6d11-4167-9d88-516933c0434e';
update public.products set rotation_override = null, orient_ai_set = false, orient_human_ok = true, orient_verified = false where id = 'b154aa28-3956-497c-8700-d2aee0023f81';
update public.products set rotation_override = null, orient_ai_set = false, orient_human_ok = true, orient_verified = false where id = 'c38e0e17-f83c-480b-aac9-83744dd5f7d4';
update public.products set rotation_override = 90, orient_ai_set = true, orient_human_ok = false, orient_verified = false where id = 'c3946d1d-0287-446f-8ab2-57edfae4924d';
update public.products set rotation_override = 90, orient_ai_set = true, orient_human_ok = false, orient_verified = false where id = 'dcab3508-5ce3-4d4d-b7f5-0078aea5d6fa';
update public.products set rotation_override = null, orient_ai_set = false, orient_human_ok = false, orient_verified = false where id = 'e0435ed8-b434-4140-b4cb-9a7a5b79fc1e';
update public.products set rotation_override = null, orient_ai_set = false, orient_human_ok = false, orient_verified = false where id = 'e27e1269-657e-4994-9455-818cdc53476b';
update public.products set rotation_override = null, orient_ai_set = false, orient_human_ok = true, orient_verified = false where id = 'e8d88871-cef4-4055-9c13-be87bed669f4';
update public.products set rotation_override = 90, orient_ai_set = true, orient_human_ok = false, orient_verified = false where id = 'e9c1e977-660b-4eab-bbdd-eeb9245f7140';
update public.products set rotation_override = 90, orient_ai_set = true, orient_human_ok = false, orient_verified = false where id = 'f800ada7-4379-46f5-a698-8aef6d74cd82';
update public.products set rotation_override = 90, orient_ai_set = true, orient_human_ok = false, orient_verified = false where id = 'f8def429-e491-4a45-89dc-ee40b96665f8';
commit;
```

Function — redeploy `supabase/functions/detect-orientation/index.ts` from commit
`2f7f8de` (v19). Same name, cron and columns; nothing else to undo. v20 also writes
`image_audit` rows (one per product, `product_id` primary key) — harmless to keep.

The first v20 run will also mark product `fc5d9c73-c5e9-4dc0-a291-6799574fc153`
(photo replaced in Rivhit since it was audited) as auto-handled: rotation stays none
(was 0), `orient_human_ok` true → false. Rollback: `update public.products set
rotation_override = 0, orient_human_ok = true where id = 'fc5d9c73-c5e9-4dc0-a291-6799574fc153';`
