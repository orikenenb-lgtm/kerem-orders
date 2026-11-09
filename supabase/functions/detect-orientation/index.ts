// detect-orientation v20 — straightens product photos from their own EXIF tag.
//
// v8–v19 asked a vision model which way each new photo should turn. The photos
// are fine — the owner shoots them upright — but the image proxy shows every
// phone photo upside down (see lib.ts for the exact mechanism), and the model
// often answered 90 instead of 180, or failed three times and gave up. On
// 2026-11-09, 19 of the newest products were sideways or upside down on the
// site because of it: "we upload them straight and they flip".
//
// The answer is already inside each photo: the phone writes which way it was
// held into the EXIF Orientation tag. v20 reads that tag (the first ≤256 KB of
// the file, straight from Rivhit) and applies one fixed rule — no model, no
// guessing, the same photo always gets the same answer:
//   EXIF 5–8 (phone held upright) → rotation_override 180
//   anything else                 → no override
//
// What it touches (mode=scan, run by cron orient-scan-15m and by the
// "יישור אוטומטי" button in /admin/images-review):
//   new       products never scanned → straightened, unless a person already
//             chose a rotation for them.
//   replaced  products whose photo link changed since it was last read → the
//             new photo is straightened; the old photo's rotation is dropped.
//   unaudited products scanned in the past → only the tag is recorded in
//             image_audit (so a later photo change is noticed). Their rotation
//             is never changed here.
// Every read is recorded in image_audit (product_id, picture_link, orientation,
// http_status).
//
// mode=verify (the old "ask the model again" pass) is switched off: it could
// overwrite a correct rotation with a model's second guess.
//
// Auth is unchanged from v19: service role key, the orient_run_token in
// secret_store (used by the cron), or a signed-in manager.
//
// ROLLBACK: redeploy the v19 source from git (commit 2f7f8de) — same name,
// same cron, same columns.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { decidePatch, parseExifOrientation, pickCandidates, type AuditRow, type Candidate, type ProductRow } from './lib.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const CONCURRENCY = 4
/** A new product whose photo cannot be fetched is retried on the next runs
 *  (every 15 minutes) before it is set aside as checked. */
const MAX_ATTEMPTS = 6
const HEAD_BYTES = 256 * 1024
const PAGE = 1000

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: cors })

/** Read the photo's EXIF tag from the first bytes of the original. A non-2xx
 *  answer is returned as a status with no orientation; a network error or
 *  timeout throws (the product is retried later). */
async function readOrientation(link: string): Promise<{ status: number; orientation: number | null }> {
  const r = await fetch(link, { redirect: 'manual', signal: AbortSignal.timeout(15000) })
  if (r.status < 200 || r.status >= 300) {
    try { await r.body?.cancel() } catch { /* */ }
    return { status: r.status, orientation: null }
  }
  const reader = r.body?.getReader()
  const chunks: Uint8Array[] = []
  let got = 0
  if (reader) {
    while (got < HEAD_BYTES) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value); got += value.byteLength
    }
    try { await reader.cancel() } catch { /* */ }
  }
  const head = new Uint8Array(got)
  let o = 0
  for (const c of chunks) { head.set(c, o); o += c.byteLength }
  return { status: r.status, orientation: parseExifOrientation(head) }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const admin = createClient(SUPABASE_URL, SERVICE_KEY)

  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  let ok = token !== '' && token === SERVICE_KEY
  if (!ok && token) {
    const { data: rt } = await admin.from('secret_store').select('value').eq('key', 'orient_run_token').maybeSingle()
    ok = !!rt && token === (rt as { value: string }).value
  }
  if (!ok && token) {
    const { data: u } = await admin.auth.getUser(token)
    if (u?.user) {
      const { data: prof } = await admin.from('profiles').select('role').eq('id', u.user.id).maybeSingle()
      ok = (prof as { role?: string } | null)?.role === 'manager'
    }
  }
  if (!ok) return json({ error: 'unauthorized' }, 401)

  const url = new URL(req.url)
  let bodyLimit = 0, mode = url.searchParams.get('mode') || 'scan'
  try {
    const b = await req.json() as { limit?: number; mode?: string }
    bodyLimit = Number(b?.limit) || 0
    if (b?.mode) mode = b.mode
  } catch { /* no body */ }
  const limRaw = bodyLimit || Number(url.searchParams.get('limit') || 12)
  const limit = Number.isFinite(limRaw) ? Math.min(Math.max(Math.round(limRaw), 1), 40) : 12

  if (mode === 'verify') {
    return json({ mode, disabled: true, checked: 0, remaining: 0, note: 'verify pass is off since v20; rotations come from the EXIF tag' })
  }

  // Whole catalogue + every audit row (≈ 1,000 each — two small reads), paged
  // so a growing catalogue never silently stops at the API's row cap.
  const products: ProductRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from('products')
      .select('id,picture_link,rotation_override,orient_checked,orient_ai_set,orient_human_ok,orient_attempts')
      .eq('is_active', true).neq('picture_link', '').order('id').range(from, from + PAGE - 1)
    if (error) return json({ error: 'query failed: ' + error.message }, 500)
    products.push(...((data ?? []) as ProductRow[]))
    if (!data || data.length < PAGE) break
  }
  const audits: AuditRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from('image_audit').select('product_id,picture_link').order('product_id').range(from, from + PAGE - 1)
    if (error) return json({ error: 'audit query failed: ' + error.message }, 500)
    audits.push(...((data ?? []) as AuditRow[]))
    if (!data || data.length < PAGE) break
  }

  const { picked, remaining } = pickCandidates(products, audits, limit)
  let checked = 0, flipped = 0, cleared = 0, kept = 0, audited = 0, failed = 0, gaveUp = 0
  let firstErr = ''

  async function handle(c: Candidate) {
    const p = c.row
    try {
      const { status, orientation } = await readOrientation(p.picture_link)
      const patch = decidePatch(c, orientation)
      // Product first, audit second: if the audit write fails, the photo is
      // simply read again next round (every decision here is idempotent).
      if (patch) {
        const { error } = await admin.from('products').update(patch).eq('id', p.id)
        if (error) throw new Error('update failed: ' + error.message)
        if ('rotation_override' in patch) { if (patch.rotation_override === 180) flipped++; else cleared++ } else kept++
      }
      const { error: aErr } = await admin.from('image_audit').upsert(
        { product_id: p.id, picture_link: p.picture_link, orientation, http_status: status, checked_at: new Date().toISOString() },
        { onConflict: 'product_id' },
      )
      if (aErr) throw new Error('audit failed: ' + aErr.message)
      audited++
      checked++
    } catch (e) {
      failed++
      if (!firstErr) firstErr = String((e as Error)?.message ?? e).slice(0, 200)
      if (c.kind === 'new') {
        const attempts = (Number(p.orient_attempts) || 0) + 1
        const patch: Record<string, unknown> = { orient_attempts: attempts }
        if (attempts >= MAX_ATTEMPTS) { patch.orient_checked = true; gaveUp++ }
        await admin.from('products').update(patch).eq('id', p.id)
      }
    }
  }

  const queue = [...picked]
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length > 0) {
      const c = queue.shift()
      if (!c) break
      await handle(c)
    }
  }))

  return json({ mode: 'scan', checked, flipped, cleared, kept, audited, failed, gaveUp, remaining: remaining + failed, model: null, firstErr: firstErr || undefined })
})
