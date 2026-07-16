// Build the Rivhit product image URL through our caching proxy edge function.
const SUPA =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://mcdchalyzeqjkkgfeznd.supabase.co";

// w: resize width applied on the edge (Rivhit originals are ~3MB; at 480px a
// card image is ~30-60KB). All call sites share w=480 so the CDN caches ONE
// variant per product. Pass w=0 for the untouched original.
export function rivhitImg(pictureLink: string, w = 480): string {
  if (!pictureLink) return "";
  const size = w > 0 ? `&w=${w}` : "";
  return `${SUPA}/functions/v1/rivhit-img?u=${encodeURIComponent(pictureLink)}${size}`;
}
