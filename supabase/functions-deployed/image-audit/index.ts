import { createClient } from 'jsr:@supabase/supabase-js@2'

// Audits every active product image's EXIF orientation into public.image_audit.
// Manager JWT or shared sync secret required. Gentle concurrency + one retry
// so Rivhit doesn't rate-limit; re-processes prior failures (http_status<>200).
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const PROXY = 'https://mcdchalyzeqjkkgfeznd.supabase.co/functions/v1/rivhit-img'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function fetchOrientation(link: string): Promise<{ o: number | null; s: number }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await fetch(`${PROXY}?meta=1&u=${encodeURIComponent(link)}`, { signal: AbortSignal.timeout(25000) })
      if (resp.ok) return { o: Number((await resp.json()).orientation) || null, s: resp.status }
      if (resp.status !== 502) return { o: null, s: resp.status }
    } catch { /* retry */ }
    await sleep(500)
  }
  return { o: null, s: -1 }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* */ }

  let allowed = false
  const { data: secret } = await admin.rpc('_get_sync_secret')
  if (secret && typeof body.key === 'string' && body.key === secret) allowed = true
  if (!allowed) {
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    if (jwt) {
      const { data: u } = await admin.auth.getUser(jwt)
      if (u?.user?.id) {
        const { data: prof } = await admin.from('profiles').select('role').eq('id', u.user.id).maybeSingle()
        if (prof?.role === 'manager') allowed = true
      }
    }
  }
  if (!allowed) return json({ error: 'unauthorized' }, 401)

  const limit = Math.min(Math.max(Number(body.limit) || 120, 1), 400)
  const CONC = 4

  const { data: rows, error } = await admin
    .from('products').select('id,picture_link')
    .eq('is_active', true).like('picture_link', 'https://api.rivhit.co.il/%').order('id')
  if (error) return json({ error: error.message }, 400)
  // "done" = audited WITH a good status; failures are retried.
  const { data: ok } = await admin.from('image_audit').select('product_id').eq('http_status', 200)
  const okSet = new Set((ok ?? []).map((d: { product_id: string }) => d.product_id))
  const todo = (rows ?? []).filter((r: { id: string }) => !okSet.has(r.id)).slice(0, limit)

  let processed = 0
  for (let i = 0; i < todo.length; i += CONC) {
    const slice = todo.slice(i, i + CONC)
    await Promise.all(slice.map(async (r: { id: string; picture_link: string }) => {
      const { o, s } = await fetchOrientation(r.picture_link)
      await admin.from('image_audit').upsert(
        { product_id: r.id, picture_link: r.picture_link, orientation: o, http_status: s, checked_at: new Date().toISOString() },
        { onConflict: 'product_id' })
      processed++
    }))
    await sleep(150) // breathe between waves so Rivhit doesn't throttle
  }

  const { count: total } = await admin.from('products').select('id', { count: 'exact', head: true })
    .eq('is_active', true).like('picture_link', 'https://api.rivhit.co.il/%')
  const { count: good } = await admin.from('image_audit').select('product_id', { count: 'exact', head: true }).eq('http_status', 200)
  return json({ processed, good, total, remaining: (total ?? 0) - (good ?? 0) })
})
