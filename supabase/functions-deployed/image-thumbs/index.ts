import { createClient } from 'jsr:@supabase/supabase-js@2'
import { Image } from 'https://deno.land/x/imagescript@1.3.0/mod.ts'

// Contact-sheet builder for the image review sweep (async: returns a sheet_id,
// finishes in the background, result lands in public.image_sheets).
// v6: accepts an explicit `ids` array so cells that failed to load in an
// earlier sheet can be retried on their own; retries harder per image so the
// failure rate stays low.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const PROXY = 'https://mcdchalyzeqjkkgfeznd.supabase.co/functions/v1/rivhit-img'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function b64(bytes: Uint8Array): string {
  let s = ''
  const CH = 0x8000
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH))
  return btoa(s)
}

async function fetchThumb(link: string, rot: number, cell: number): Promise<Image | null> {
  const rp = rot && [90, 180, 270].includes(rot) ? `&rot=${rot}` : ''
  const url = `${PROXY}?u=${encodeURIComponent(link)}&w=480&v=2${rp}`
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30000) })
      if (r.ok) {
        try {
          let img = await Image.decode(new Uint8Array(await r.arrayBuffer()))
          if (img.width > cell || img.height > cell) {
            img = img.width >= img.height ? img.resize(cell, Image.RESIZE_AUTO) : img.resize(Image.RESIZE_AUTO, cell)
          }
          return img
        } catch { return null }
      }
    } catch { /* retry */ }
    await sleep(700 * (a + 1))
  }
  return null
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

  const offset = Math.max(Number(body.offset) || 0, 0)
  const limit = Math.min(Math.max(Number(body.limit) || 30, 1), 60)
  const cols = Math.min(Math.max(Number(body.cols) || 6, 3), 8)
  const cell = Math.min(Math.max(Number(body.cell) || 120, 60), 200)
  const q = typeof body.q === 'string' && body.q.trim() ? body.q.trim() : null
  const only = body.only === 'o6' ? 6 : body.only === 'o1' ? 1 : null
  const ids = Array.isArray(body.ids) ? (body.ids as string[]).slice(0, 60) : null

  const { data: row, error: insErr } = await admin
    .from('image_sheets')
    .insert({ params: { offset, limit, cols, cell, q, only, ids_count: ids?.length ?? null } })
    .select('id').single()
  if (insErr) return json({ error: insErr.message }, 400)
  const sheetId = row!.id as string

  const work = (async () => {
    try {
      const CONC = 4
      const PAD = 4
      const cs = cell + PAD * 2
      let list: { id: string; name: string; rotation_override: number | null; picture_link: string }[] = []

      if (ids) {
        const { data, error } = await admin
          .from('products').select('id,name,rotation_override,picture_link')
          .in('id', ids)
        if (error) throw new Error(error.message)
        const byId = new Map((data ?? []).map((r) => [r.id, r]))
        list = ids.map((i) => byId.get(i)).filter(Boolean) as typeof list
      } else {
        let query = admin
          .from('products').select('id,name,rotation_override,picture_link')
          .eq('is_active', true).like('picture_link', 'https://api.rivhit.co.il/%')
        if (q) query = query.ilike('name', `%${q}%`)
        const { data: all, error } = await query.order('id')
        if (error) throw new Error(error.message)
        let l = all ?? []
        if (only !== null) {
          const { data: aud } = await admin.from('image_audit').select('product_id').eq('orientation', only)
          const set = new Set((aud ?? []).map((a: { product_id: string }) => a.product_id))
          l = l.filter((r: { id: string }) => set.has(r.id))
        }
        list = l.slice(offset, offset + limit)
      }

      const thumbs: (Image | null)[] = new Array(list.length).fill(null)
      for (let i = 0; i < list.length; i += CONC) {
        const slice = list.slice(i, i + CONC)
        const part = await Promise.all(slice.map((r) => fetchThumb(r.picture_link, r.rotation_override ?? 0, cell)))
        for (let k = 0; k < part.length; k++) thumbs[i + k] = part[k]
      }

      const rowsN = Math.max(1, Math.ceil(list.length / cols))
      const sheet = new Image(cols * cs, rowsN * cs)
      sheet.fill(0xf2f2f2ff)
      for (let idx = 0; idx < list.length; idx++) {
        const gx = (idx % cols) * cs
        const gy = Math.floor(idx / cols) * cs
        const tint = ((idx % cols) + Math.floor(idx / cols)) % 2 === 0 ? 0xffffffff : 0xeaeaeaff
        for (let yy = 0; yy < cs; yy++) for (let xx = 0; xx < cs; xx++) sheet.setPixelAt(gx + xx + 1, gy + yy + 1, tint)
        const t = thumbs[idx]
        if (t) {
          const ox = gx + PAD + Math.floor((cell - t.width) / 2)
          const oy = gy + PAD + Math.floor((cell - t.height) / 2)
          sheet.composite(t, Math.max(gx, ox), Math.max(gy, oy))
        }
      }
      const jpeg = await sheet.encodeJPEG(72)
      await admin.from('image_sheets').update({
        status: 'done',
        b64: b64(jpeg),
        cells: {
          total_filtered: list.length, cols,
          items: list.map((r, k) => ({ cell: k, id: r.id, name: r.name, rot: r.rotation_override ?? 0, ok: !!thumbs[k] })),
        },
      }).eq('id', sheetId)
    } catch (e) {
      await admin.from('image_sheets').update({ status: 'error', error: String((e as Error)?.message ?? e) }).eq('id', sheetId)
    }
  })()
  // @ts-ignore
  EdgeRuntime.waitUntil(work)
  return json({ sheet_id: sheetId })
})
