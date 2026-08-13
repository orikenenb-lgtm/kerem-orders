// Build the Rivhit product image URL through our caching proxy edge function.
const SUPA =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://mcdchalyzeqjkkgfeznd.supabase.co";

// w: resize width applied on the edge (Rivhit originals are ~3MB; at 480px a
// card image is ~30-60KB). All call sites share w=480 so the CDN caches ONE
// variant per product. Pass w=0 for the untouched original.
//
// v is a cache-buster for the resized pipeline: v2 = EXIF-orientation fix
// (about half the Rivhit photos carry Orientation=6; the first resize
// pipeline stripped the tag without rotating, serving them sideways — the
// old cached variants must be skipped, not waited out for 30 days).
//
// rot: a MANUAL extra clockwise rotation for photos that are crooked but carry
// no EXIF tag — set from products.rotation_override by the manager in the
// image-fixing screen. It joins the cache key so a corrected image replaces
// the crooked cached one immediately.
//
// ANY angle 0-359 is allowed: the proxy also straightens slightly-tilted
// photos, not just quarter turns. Previously anything other than 90/180/270
// was silently dropped here, so a free-angle rotation looked like it did
// nothing. 90/180/270 still produce the exact same URL as before, so every
// already-cached variant stays valid.
export function rivhitImg(pictureLink: string, w = 480, rot = 0): string {
  if (!pictureLink) return "";
  const size = w > 0 ? `&w=${w}&v=2` : "";
  const deg = Number(rot);
  const norm = Number.isFinite(deg) ? ((Math.round(deg) % 360) + 360) % 360 : 0;
  const r = norm ? `&rot=${norm}` : "";
  return `${SUPA}/functions/v1/rivhit-img?u=${encodeURIComponent(pictureLink)}${size}${r}`;
}
