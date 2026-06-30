// Build the Rivhit product image URL through our caching proxy edge function.
const SUPA =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://mcdchalyzeqjkkgfeznd.supabase.co";

export function rivhitImg(pictureLink: string): string {
  if (!pictureLink) return "";
  return `${SUPA}/functions/v1/rivhit-img?u=${encodeURIComponent(pictureLink)}`;
}
