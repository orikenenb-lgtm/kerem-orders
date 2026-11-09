// PURE helpers for detect-orientation v20 — no Deno APIs, no network.
// Unit-tested from landing/tests/orientation.test.mjs (plain node, same
// transpile harness as the other suites).
//
// ---------------------------------------------------------------------------
// WHY A PHONE PHOTO NEEDS rotation_override = 180 (read before touching
// rivhit-img)
// ---------------------------------------------------------------------------
// rivhit-img straightens a photo from its EXIF Orientation tag with
// imagescript's Image.rotate(deg), passing CLOCKWISE degrees (6 → 90, 8 → 270).
// But imagescript 1.3.0's Image.rotate() turns COUNTER-clockwise: it calls
// v2.rotate(360 - deg), and v2/ops/rotate.mjs rotate270 maps the top-left pixel
// to the bottom-left. So a photo shot with the phone held upright (EXIF 6, or 8
// for the other hand) comes out of the proxy UPSIDE DOWN, and the manual `rot`
// turns the opposite way from its name too.
//
// Measured on production 2026-11-09 (852 active products): every phone photo
// the owner had straightened by hand carries EXIF 6 with rotation_override
// 180 (223 of them). Those 180s are what makes the photos right on the site
// today, and they only work while the proxy stays exactly as it is. Do NOT
// "fix" the rotation direction in rivhit-img without migrating every
// rotation_override in the same step — it would turn all of them upside
// down again. Compensate here instead.
//
// EXIF 3 (upside-down shot) needs no compensation: 180° is the same either
// way. EXIF 5/7 are the mirrored forms of 6/8; the proxy treats them as
// 6/8 and so does this file.

/** EXIF Orientation from the first bytes of a JPEG; 1 when absent or not a
 *  JPEG. Same parser as rivhit-img so both always agree on a photo. */
export function parseExifOrientation(bytes: Uint8Array): number {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1
  let off = 2
  while (off + 4 <= bytes.length) {
    if (bytes[off] !== 0xff) break
    const marker = bytes[off + 1]
    if (marker === 0xda || marker === 0xd9) break
    const size = (bytes[off + 2] << 8) | bytes[off + 3]
    if (size < 2) break
    if (
      marker === 0xe1 && off + 10 <= bytes.length &&
      bytes[off + 4] === 0x45 && bytes[off + 5] === 0x78 &&
      bytes[off + 6] === 0x69 && bytes[off + 7] === 0x66 &&
      bytes[off + 8] === 0 && bytes[off + 9] === 0
    ) {
      const tiff = off + 10
      if (tiff + 8 > bytes.length) return 1
      const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49
      const u16 = (p: number) => little ? bytes[p] | (bytes[p + 1] << 8) : (bytes[p] << 8) | bytes[p + 1]
      const u32 = (p: number) => little
        ? (bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16) | (bytes[p + 3] << 24)) >>> 0
        : ((bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]) >>> 0
      const ifd0 = tiff + u32(tiff + 4)
      if (ifd0 + 2 > bytes.length) return 1
      const n = u16(ifd0)
      for (let i = 0; i < n; i++) {
        const entry = ifd0 + 2 + i * 12
        if (entry + 12 > bytes.length) return 1
        if (u16(entry) === 0x0112) {
          const v = u16(entry + 8)
          return v >= 1 && v <= 8 ? v : 1
        }
      }
      return 1
    }
    off += 2 + size
  }
  return 1
}

/** The rotation_override that makes a photo upright on the site, given its
 *  EXIF tag (see the header: 180 cancels the proxy's wrong-way turn). */
export function overrideForExif(orientation: number | null): number | null {
  return orientation !== null && orientation >= 5 && orientation <= 8 ? 180 : null
}

export type ProductRow = {
  id: string
  picture_link: string
  rotation_override: number | null
  orient_checked: boolean | null
  orient_ai_set: boolean | null
  orient_human_ok: boolean | null
  orient_attempts: number | null
}
export type AuditRow = { product_id: string; picture_link: string }

/** new       — never scanned (orient_checked=false): straighten it.
 *  replaced  — its photo changed since it was last read: straighten the NEW
 *              photo; the old rotation belonged to the old photo.
 *  unaudited — scanned long ago, never read here: record its tag only, so a
 *              later photo change can be noticed. Rotation is not touched. */
export type Kind = 'new' | 'replaced' | 'unaudited'
export type Candidate = { row: ProductRow; kind: Kind }

export const ALLOW_PREFIX = 'https://api.rivhit.co.il/online/FileService.svc/'

/** Which products to read this round, most urgent first. */
export function pickCandidates(products: ProductRow[], audits: AuditRow[], limit: number): { picked: Candidate[]; remaining: number } {
  const audited = new Map(audits.map((a) => [a.product_id, a.picture_link]))
  const buckets: Record<Kind, Candidate[]> = { new: [], replaced: [], unaudited: [] }
  for (const row of products) {
    if (!row.picture_link || !row.picture_link.startsWith(ALLOW_PREFIX)) continue
    const seen = audited.get(row.id)
    if (row.orient_checked === false) buckets.new.push({ row, kind: 'new' })
    else if (seen === undefined) buckets.unaudited.push({ row, kind: 'unaudited' })
    else if (seen !== row.picture_link) buckets.replaced.push({ row, kind: 'replaced' })
  }
  const all = [...buckets.new, ...buckets.replaced, ...buckets.unaudited]
  const n = Math.max(0, Math.floor(limit))
  return { picked: all.slice(0, n), remaining: Math.max(0, all.length - n) }
}

/** A person already chose this photo's rotation (in either admin screen). */
export function humanDecided(row: ProductRow): boolean {
  const rot = Number(row.rotation_override) || 0
  return row.orient_human_ok === true || (rot !== 0 && row.orient_ai_set !== true)
}

/** The products patch after reading a photo's tag, or null for "leave the
 *  product row alone". `orientation` is null when the photo could not be read
 *  (dead link): nothing to straighten, but a new product is still marked
 *  checked so it does not block the queue. */
export function decidePatch(c: Candidate, orientation: number | null): Record<string, unknown> | null {
  if (c.kind === 'unaudited') return null
  if (c.kind === 'new' && humanDecided(c.row)) return { orient_checked: true }
  if (orientation === null) return c.kind === 'new' ? { orient_checked: true } : null
  const rot = overrideForExif(orientation)
  const patch: Record<string, unknown> = {
    rotation_override: rot,
    orient_ai_set: rot !== null,
    orient_checked: true,
    orient_verified: true,
  }
  if (c.kind === 'replaced') patch.orient_human_ok = false
  return patch
}
