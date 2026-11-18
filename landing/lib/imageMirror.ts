// Static copies of product photos, served by GitHub Pages instead of being
// resized again for every visitor.
//
// WHY: every card photo used to come from the rivhit-img edge function, which
// downloads the ~3 MB Rivhit original, decodes and resizes it on EVERY request
// (no shared cache in front of it). Measured on production (function logs,
// 24 h): 5,713 requests for only 834 distinct photos; median 1.6 s per photo,
// p95 6 s, and 27% died with 546 (worker resource limit) — which then cost the
// browser a 1.2 s wait, a retry, and often the full 3 MB original.
//
// WHAT: at deploy time scripts/mirror-images.mjs downloads, ONCE, the exact
// bytes the proxy returns for each public product at w=480 (same EXIF fix,
// same saved rotation — it is the proxy's own output) and ships them as plain
// files under /pimg/480/. The list of photos that really exist in the build is
// written to imageMirror.data.ts, so the browser never asks for a file that
// is not there (no 404s).
//
// FALLBACK: a photo that is not in the list (a product added since the last
// deploy, a changed rotation, a customer-only product, the 900/960 product
// page sizes) — or a static file that fails to load — goes through the
// existing chain unchanged: proxy → one retry → direct original → placeholder
// (lib/imageFallback.ts). So the mirror can only add a faster first try; it can
// never make a photo disappear.
//
// Pure module (no React) — unit-tested in tests/imageMirror.test.mjs, which
// also checks that scripts/mirror-images.mjs derives the same keys and the
// same proxy URLs.

import { MIRRORED_480 } from "./imageMirror.data";

/** The only width that is mirrored: every card / grid / list photo. */
export const MIRROR_WIDTH = 480;

const RIVHIT_PREFIX = "https://api.rivhit.co.il/online/FileService.svc/getItemPic/";

/** Same normalisation as rivhitImg() in lib/images.ts. */
function normRot(rot: number | null | undefined): number {
  const deg = Number(rot);
  return Number.isFinite(deg) ? ((Math.round(deg) % 360) + 360) % 360 : 0;
}

/** Stable, file-name-safe key for (photo, rotation), or "" when the link is
 *  not a plain Rivhit getItemPic URL. The key is built from the link's own
 *  path segments (account/picture id) — no hashing, so two different photos
 *  can never share a file. */
export function mirrorKey(pictureLink: string | null | undefined, rot: number | null | undefined = 0): string {
  const link = (pictureLink || "").trim();
  if (!link.startsWith(RIVHIT_PREFIX)) return "";
  const rest = link.slice(RIVHIT_PREFIX.length);
  const m = /^([0-9]{1,20})\/([A-Za-z0-9]{1,64})$/.exec(rest);
  if (!m) return "";
  const r = normRot(rot);
  return `${m[1]}_${m[2]}${r ? `_r${r}` : ""}`;
}

let available: Set<string> | null = null;
function has(key: string): boolean {
  if (!available) available = new Set(MIRRORED_480 ? MIRRORED_480.split(",") : []);
  return available.has(key);
}

/** URL of the static copy, or "" when there is none for this photo/size. */
export function mirrorSrc(
  pictureLink: string | null | undefined,
  w: number,
  rot: number | null | undefined = 0,
  basePath: string = process.env.NEXT_PUBLIC_BASE_PATH || "",
): string {
  if (w !== MIRROR_WIDTH) return "";
  const key = mirrorKey(pictureLink, rot);
  if (!key || !has(key)) return "";
  return `${basePath}/pimg/${MIRROR_WIDTH}/${key}.jpg`;
}
