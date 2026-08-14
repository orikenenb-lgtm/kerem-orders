// AI product-image orientation detector (v8).
// mode=scan  (default): find un-scanned images, detect rotation, fix. Marks
//                        AI-written rotations with orient_ai_set=true.
// mode=verify: second pass over ROTATED images — renders each at its CURRENT
//              rotation (via the rivhit-img proxy) and asks the model again.
//              Confirmed upright -> orient_verified=true. Disagreement:
//              AI-set rotations get ONE composed correction (then verified);
//              human-set rotations are NEVER changed — only counted/reported.
// 4-way internal concurrency; bounded retries; conservative throughout.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MODELS = (Deno.env.get('ORIENT_MODEL') ? [Deno.env.get('ORIENT_MODEL')!] : []).concat([
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
  'claude-3-5-sonnet-20241022',
])
const ALLOW_PREFIX = 'https://api.rivhit.co.il/online/FileService.svc/'
const CONCURRENCY = 4
const MAX_ATTEMPTS = 3

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: cors })

function b64FromBytes(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(bin)
}

const PROMPT =
  'This is ONE product photo from a toy wholesale catalog, on a plain background. ' +
  'Decide the clockwise rotation in degrees needed to make the product look upright and ' +
  'correctly oriented to a person. Answer with ONLY one number: 0, 90, 180, or 270. ' +
  'If it already looks upright, or you are not confident, answer 0.'

let activeModel = ''
async function detectRotation(apiKey: string, b64: string, mediaType: string): Promise<number> {
  const tryModels = activeModel ? [activeModel] : MODELS
  let lastErr = ''
  for (const model of tryModels) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model, max_tokens: 8,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
          { type: 'text', text: PROMPT },
        ] }],
      }),
      signal: AbortSignal.timeout(30000),
    })
    if (r.ok) {
      activeModel = model
      const data = await r.json()
      const text: string = data?.content?.[0]?.text ?? ''
      const m = text.match(/\b(0|90|180|270)\b/)
      return m ? Number(m[1]) : 0
    }
    const body = (await r.text()).slice(0, 300)
    lastErr = 'anthropic ' + r.status + ' ' + body
    if (!(r.status === 404 || (r.status === 400 && body.includes('model')))) break
  }
  throw new Error(lastErr || 'no model worked')
}

async function fetchPreviewB64(link: string, rot: number): Promise<{ b64: string; mediaType: string }> {
  const r = rot && [90, 180, 270].includes(rot) ? `&rot=${rot}` : ''
  const prev = `${SUPABASE_URL}/functions/v1/rivhit-img?u=${encodeURIComponent(link)}&w=256&v=2${r}`
  const imgRes = await fetch(prev, { signal: AbortSignal.timeout(20000) })
  if (!imgRes.ok) throw new Error('preview ' + imgRes.status)
  const mediaType = (imgRes.headers.get('content-type') || 'image/jpeg').split(';')[0]
  const bytes = new Uint8Array(await imgRes.arrayBuffer())
  if (bytes.byteLength > 4_500_000) throw new Error('preview too large')
  return { b64: b64FromBytes(bytes), mediaType }
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

  let apiKey = Deno.env.get('ANTHROPIC_API_KEY') || ''
  if (!apiKey) {
    const { data: k } = await admin.from('secret_store').select('value').eq('key', 'anthropic_api_key').maybeSingle()
    apiKey = (k as { value: string } | null)?.value || ''
  }
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY secret not set' }, 400)

  const url = new URL(req.url)
  let bodyLimit = 0, mode = url.searchParams.get('mode') || 'scan'
  try {
    const b = await req.json() as { limit?: number; mode?: string }
    bodyLimit = Number(b?.limit) || 0
    if (b?.mode) mode = b.mode
  } catch { /* no body */ }
  const limRaw = bodyLimit || Number(url.searchParams.get('limit') || 12)
  const limit = Number.isFinite(limRaw) ? Math.min(Math.max(Math.round(limRaw), 1), 40) : 12

  type Row = { id: string; picture_link: string; rotation_override: number | null; orient_attempts: number | null; orient_ai_set: boolean | null }

  let checked = 0, flipped = 0, failed = 0, gaveUp = 0, confirmed = 0, corrected = 0, humanSuspect = 0
  let firstErr = ''

  async function runPool(rows: Row[], fn: (p: Row) => Promise<void>) {
    const queue = [...rows]
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (queue.length > 0) {
        const p = queue.shift()
        if (!p) break
        await fn(p)
      }
    })
    await Promise.all(workers)
  }

  if (mode === 'verify') {
    const { data: rows, error } = await admin
      .from('products')
      .select('id,picture_link,rotation_override,orient_attempts,orient_ai_set')
      .eq('is_active', true).neq('picture_link', '')
      .eq('orient_checked', true).eq('orient_verified', false)
      .not('rotation_override', 'is', null).neq('rotation_override', 0)
      .limit(limit)
    if (error) return json({ error: 'query failed: ' + error.message }, 500)

    await runPool((rows ?? []) as Row[], async (p) => {
      try {
        const rot = Number(p.rotation_override) || 0
        const { b64, mediaType } = await fetchPreviewB64(p.picture_link, rot)
        const second = await detectRotation(apiKey, b64, mediaType)
        if (second === 0) {
          await admin.from('products').update({ orient_verified: true }).eq('id', p.id)
          confirmed++
        } else if (p.orient_ai_set) {
          // one composed correction, then verified either way
          const composed = (rot + second) % 360
          await admin.from('products').update({ rotation_override: composed === 0 ? null : composed, orient_verified: true }).eq('id', p.id)
          corrected++
        } else {
          // human-set rotation the checker doubts — never change; just mark
          // verified so the pass completes, and count it for the report.
          await admin.from('products').update({ orient_verified: true }).eq('id', p.id)
          humanSuspect++
        }
        checked++
      } catch (e) {
        failed++
        if (!firstErr) firstErr = String((e as Error)?.message ?? e).slice(0, 200)
        const attempts = (Number(p.orient_attempts) || 0) + 1
        const patch: Record<string, unknown> = { orient_attempts: attempts }
        if (attempts >= MAX_ATTEMPTS + 3) { patch.orient_verified = true; gaveUp++ }
        await admin.from('products').update(patch).eq('id', p.id)
      }
    })

    const { count: remaining } = await admin
      .from('products').select('id', { count: 'exact', head: true })
      .eq('is_active', true).neq('picture_link', '')
      .eq('orient_checked', true).eq('orient_verified', false)
      .not('rotation_override', 'is', null).neq('rotation_override', 0)
    return json({ mode, checked, confirmed, corrected, humanSuspect, failed, gaveUp, remaining: remaining ?? null, model: activeModel || null, firstErr: firstErr || undefined })
  }

  // ---- mode=scan ----
  const { data: rows, error } = await admin
    .from('products')
    .select('id,picture_link,rotation_override,orient_attempts,orient_ai_set')
    .eq('is_active', true).neq('picture_link', '').eq('orient_checked', false)
    .limit(limit)
  if (error) return json({ error: 'query failed: ' + error.message }, 500)

  await runPool((rows ?? []) as Row[], async (p) => {
    try {
      if (!String(p.picture_link).startsWith(ALLOW_PREFIX)) {
        await admin.from('products').update({ orient_checked: true }).eq('id', p.id); checked++; return
      }
      const { b64, mediaType } = await fetchPreviewB64(p.picture_link, 0)
      const rot = await detectRotation(apiKey, b64, mediaType)
      const patch: Record<string, unknown> = { orient_checked: true }
      if (rot !== 0 && Number(p.rotation_override || 0) === 0) { patch.rotation_override = rot; patch.orient_ai_set = true; flipped++ }
      await admin.from('products').update(patch).eq('id', p.id)
      checked++
    } catch (e) {
      failed++
      if (!firstErr) firstErr = String((e as Error)?.message ?? e).slice(0, 200)
      const attempts = (Number(p.orient_attempts) || 0) + 1
      const patch: Record<string, unknown> = { orient_attempts: attempts }
      if (attempts >= MAX_ATTEMPTS) { patch.orient_checked = true; gaveUp++ }
      await admin.from('products').update(patch).eq('id', p.id)
    }
  })

  const { count: remaining } = await admin
    .from('products').select('id', { count: 'exact', head: true })
    .eq('is_active', true).neq('picture_link', '').eq('orient_checked', false)

  return json({ mode, checked, flipped, failed, gaveUp, remaining: remaining ?? null, model: activeModel || null, firstErr: firstErr || undefined })
})
