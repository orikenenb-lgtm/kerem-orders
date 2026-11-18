// Deploy-time product-photo mirror. See lib/imageMirror.ts for the why.
//
//   node scripts/mirror-images.mjs
//
// 1. Reads the PUBLIC product list (catalog_public — the same anon RPC the
//    public /view catalogue and the /p/ pages already use; nothing private).
// 2. For each photo, keeps the cached copy in .pimg-cache/ (restored between
//    deploys by actions/cache) or downloads it ONCE from the existing
//    rivhit-img proxy — the exact URL the browser would use — so the static
//    file is byte-for-byte the proxy's own output (EXIF fix and saved rotation
//    included). Nothing is re-encoded here.
// 3. Copies the photos of the current products to public/pimg/480/ and writes
//    their keys to lib/imageMirror.data.ts.
//
// Gentle on the proxy: 2 requests at a time, bounded retries on 5xx/546, a
// total time budget, and only NEW photos (plus a small batch of the oldest
// copies, refreshed after REFRESH_DAYS) are requested on a normal deploy.
//
// NEVER fails the deploy: on any problem it logs a warning and writes the list
// of whatever photos it does have (possibly none) — every photo without a
// static copy keeps using the proxy exactly as before.
//
// Env (all optional):
//   MIRROR_BUDGET_SEC   total download time budget          (default 600)
//   MIRROR_CONCURRENCY  parallel downloads                   (default 2)
//   MIRROR_REFRESH_DAYS refresh copies older than this       (default 30)
//   MIRROR_REFRESH_MAX  at most this many refreshes per run  (default 40)
//   MIRROR_SAMPLE=N     only the first N products, write nothing (CI smoke test)
//   KEREM_PUBLIC_PRODUCTS_FIXTURE  read products from a JSON file (local tests)
//   MIRROR_PROXY_BASE   override the proxy origin (local tests only)

import { mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync, readdirSync, unlinkSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// MIRROR_ROOT: tests only — run against a temp copy instead of landing/.
const ROOT = process.env.MIRROR_ROOT || join(dirname(fileURLToPath(import.meta.url)), "..");
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://mcdchalyzeqjkkgfeznd.supabase.co";
// Public, browser-shipped publishable key (same fallback as lib/supabaseClient.ts).
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_ie1SyncNyRabOTCWTxt8pw_AsESY6F9";
const WIDTH = 480;
const RIVHIT_PREFIX = "https://api.rivhit.co.il/online/FileService.svc/getItemPic/";

// ---- keys and URLs: must match lib/imageMirror.ts and lib/images.ts --------
// (tests/imageMirror.test.mjs asserts both on a table of links)
export function normRot(rot) {
  const deg = Number(rot);
  return Number.isFinite(deg) ? ((Math.round(deg) % 360) + 360) % 360 : 0;
}
export function mirrorKeyFor(pictureLink, rot = 0) {
  const link = (pictureLink || "").trim();
  if (!link.startsWith(RIVHIT_PREFIX)) return "";
  const m = /^([0-9]{1,20})\/([A-Za-z0-9]{1,64})$/.exec(link.slice(RIVHIT_PREFIX.length));
  if (!m) return "";
  const r = normRot(rot);
  return `${m[1]}_${m[2]}${r ? `_r${r}` : ""}`;
}
export function proxyUrlFor(pictureLink, rot = 0, base = SUPABASE_URL) {
  const r = normRot(rot);
  return `${base}/functions/v1/rivhit-img?u=${encodeURIComponent(pictureLink)}&w=${WIDTH}&v=2${r ? `&rot=${r}` : ""}`;
}
/** A downloaded body is accepted only if it really is a JPEG of a sane size. */
export function isGoodJpeg(buf, contentType) {
  return (
    /^image\/jpeg\b/i.test(contentType || "") &&
    buf.length >= 2_000 &&
    buf.length <= 900_000 &&
    buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
  );
}

// ---- product list ------------------------------------------------------------
async function rpc(name, body) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      last = e;
      if (attempt < 3) await sleep(2000 * attempt);
    }
  }
  throw new Error(`${name} failed 3 times (${last?.message ?? last})`);
}
async function publicProducts() {
  const fixture = process.env.KEREM_PUBLIC_PRODUCTS_FIXTURE;
  if (fixture) return JSON.parse(readFileSync(fixture, "utf8")).products;
  const byId = new Map();
  let total = 0;
  for (let pass = 1; pass <= 3; pass++) {
    for (let off = 0; ; off += 60) {
      const rows = await rpc("catalog_public", { q: null, cat: "all", lim: 60, off });
      for (const r of rows) {
        total = Math.max(total, Number(r.total) || 0);
        byId.set(r.id, { id: r.id, picture_link: r.picture_link, rotation_override: r.rotation_override ?? null });
      }
      if (rows.length < 60 || off > 20_000) break;
    }
    if (byId.size >= total) break;
  }
  return [...byId.values()];
}

// ---- download ----------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function download(url, deadline) {
  let lastErr = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (Date.now() > deadline) return { ok: false, err: "budget" };
    const t0 = Date.now();
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(25_000) });
      const buf = Buffer.from(await r.arrayBuffer());
      if (r.ok && isGoodJpeg(buf, r.headers.get("content-type"))) return { ok: true, buf, ms: Date.now() - t0 };
      lastErr = r.ok ? "not-a-jpeg" : `http-${r.status}`;
      // A 200 that is not a JPEG, or a 4xx other than 429, will not get better
      // by retrying — only 5xx/546/429 and network errors are retried.
      if (r.ok || (r.status >= 400 && r.status < 500 && r.status !== 429)) break;
    } catch (e) {
      lastErr = e?.name === "TimeoutError" ? "timeout" : "network";
    }
    if (attempt < 3) await sleep(3000 * attempt);
  }
  return { ok: false, err: lastErr };
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

// ---- main ----------------------------------------------------------------------
export async function main() {
  const budgetSec = Number(process.env.MIRROR_BUDGET_SEC || 600);
  const conc = Math.max(1, Number(process.env.MIRROR_CONCURRENCY || 2));
  const refreshDays = Number(process.env.MIRROR_REFRESH_DAYS || 30);
  const refreshMax = Number(process.env.MIRROR_REFRESH_MAX || 40);
  const sample = Number(process.env.MIRROR_SAMPLE || 0);
  const proxyBase = process.env.MIRROR_PROXY_BASE || SUPABASE_URL;
  const cacheDir = join(ROOT, ".pimg-cache", String(WIDTH));
  const outDir = join(ROOT, "public", "pimg", String(WIDTH));
  const dataFile = join(ROOT, "lib", "imageMirror.data.ts");
  const deadline = Date.now() + budgetSec * 1000;

  let products = await publicProducts();
  if (sample) products = products.slice(0, sample);

  // key → { link, rot } for every public product whose photo can be mirrored
  const wanted = new Map();
  let notMirrorable = 0;
  for (const p of products) {
    const key = mirrorKeyFor(p.picture_link, p.rotation_override);
    if (!key) { notMirrorable++; continue; }
    wanted.set(key, { link: p.picture_link.trim(), rot: p.rotation_override });
  }

  mkdirSync(cacheDir, { recursive: true });
  const indexFile = join(cacheDir, "index.json");
  let index = {};
  try { index = JSON.parse(readFileSync(indexFile, "utf8")); } catch { index = {}; }
  const now = Date.now();
  const cached = (k) => !sample && index[k] && existsSync(join(cacheDir, `${k}.jpg`));

  const fresh = [...wanted.keys()].filter((k) => !cached(k));
  const stale = [...wanted.keys()]
    .filter((k) => cached(k) && now - Date.parse(index[k].at) > refreshDays * 86_400_000)
    .sort((a, b) => Date.parse(index[a].at) - Date.parse(index[b].at))
    .slice(0, refreshMax);

  const times = [];
  const errors = {};
  let got = 0, refreshed = 0, bytes = 0;
  await pool([...fresh, ...stale], conc, async (key) => {
    const { link, rot } = wanted.get(key);
    const res = await download(proxyUrlFor(link, rot, proxyBase), deadline);
    if (!res.ok) { errors[res.err] = (errors[res.err] || 0) + 1; return; }
    times.push(res.ms);
    bytes += res.buf.length;
    if (sample) { got++; return; }
    writeFileSync(join(cacheDir, `${key}.jpg`), res.buf);
    if (index[key]) refreshed++; else got++;
    index[key] = { at: new Date().toISOString(), bytes: res.buf.length };
  });

  const stats = {
    products: products.length,
    mirrorable: wanted.size,
    notMirrorable,
    alreadyCached: wanted.size - fresh.length,
    downloaded: got,
    refreshed,
    failed: errors,
    downloadMs: { p50: pct(times, 50), p95: pct(times, 95), max: pct(times, 100) },
    downloadedKB: Math.round(bytes / 1024),
  };

  if (sample) {
    console.log(`mirror-images (sample ${sample}, nothing written): ${JSON.stringify(stats)}`);
    return stats;
  }

  // Forget cache entries for products that are gone; keep the rest.
  for (const k of Object.keys(index)) {
    if (!wanted.has(k)) {
      delete index[k];
      try { unlinkSync(join(cacheDir, `${k}.jpg`)); } catch { /* already gone */ }
    }
  }
  writeFileSync(indexFile, JSON.stringify(index));

  // Publish exactly the photos we hold for current products.
  mkdirSync(outDir, { recursive: true });
  for (const f of readdirSync(outDir)) unlinkSync(join(outDir, f));
  const published = [];
  for (const k of [...wanted.keys()].sort()) {
    const src = join(cacheDir, `${k}.jpg`);
    if (index[k] && existsSync(src) && statSync(src).size > 0) {
      copyFileSync(src, join(outDir, `${k}.jpg`));
      published.push(k);
    }
  }
  writeDataFile(dataFile, published);
  console.log(`mirror-images: ${published.length} of ${wanted.size} photos published as static files. ${JSON.stringify(stats)}`);
  return { ...stats, published: published.length };
}

export function writeDataFile(dataFile, keys) {
  const head = readFileSync(dataFile, "utf8").split("\n").filter((l) => l.startsWith("//")).join("\n");
  writeFileSync(dataFile, `${head}\nexport const MIRRORED_480: string = ${JSON.stringify(keys.join(","))};\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((e) => {
    // Never block a deploy: the site simply keeps using the proxy for photos.
    console.warn(`::warning::mirror-images skipped (${e?.message ?? e}) — photos keep loading through the proxy`);
  });
}
