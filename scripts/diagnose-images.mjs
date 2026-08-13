#!/usr/bin/env node
// READ-ONLY diagnostic for the product-image pipeline.
//
// Answers, with evidence rather than guesswork, which of these is true:
//   (1) rivhit-img fails on certain photos (size/format), or
//   (2) rivhit-img only fails under concurrency (worker exhaustion), or
//   (3) some products.picture_link values are themselves dead/invalid.
//
// It is strictly READ-ONLY: image GETs plus one read-only product query (a
// REST SELECT, or with an anon key a POST to the read-only catalog_public
// RPC). It never writes to the database, never touches rotation_override /
// orient_human_ok, and never deploys anything.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/diagnose-images.mjs [--limit 60] [--burst 12]
//
// Works with the PUBLIC anon/publishable key too (SUPABASE_KEY=sb_publishable_…):
// RLS blocks anon SELECT on products, so in that case products are read through
// the public catalog_public RPC instead (same data the /view page shows).
//
// Output: a per-product table, a numeric+percentage summary by failure class,
// and report files (JSON + CSV) under ./image-diagnostics/.

import { writeFileSync, mkdirSync } from "node:fs";

const SUPABASE_URL = (process.env.SUPABASE_URL || "https://mcdchalyzeqjkkgfeznd.supabase.co").replace(/\/$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || "";
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? Number(process.argv[i + 1]) : dflt;
};
const LIMIT = arg("limit", 60);
const BURST = arg("burst", 12);
const TIMEOUT_MS = 30000;

if (!KEY) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY). Read-only SELECT is all it is used for.");
  process.exit(2);
}

const proxyUrl = (link, w = 480, rot = 0) => {
  const size = w > 0 ? `&w=${w}&v=2` : "";
  const norm = Number.isFinite(Number(rot)) ? ((Math.round(Number(rot)) % 360) + 360) % 360 : 0;
  const r = norm ? `&rot=${norm}` : "";
  return `${SUPABASE_URL}/functions/v1/rivhit-img?u=${encodeURIComponent(link)}${size}${r}`;
};

// One GET, fully classified. Never throws.
async function probe(url) {
  const started = Date.now();
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { redirect: "manual", signal: ctl.signal });
    const ctype = res.headers.get("content-type") || "";
    const clen = Number(res.headers.get("content-length") || 0);
    const sbErr = res.headers.get("x-sb-error-code") || res.headers.get("sb_error_code") || "";
    // Read a small prefix to tell a real image from an HTML error page.
    let head = new Uint8Array();
    let bytes = 0;
    try {
      const buf = await res.arrayBuffer();
      bytes = buf.byteLength;
      head = new Uint8Array(buf.slice(0, 4));
    } catch { /* body unreadable */ }
    const isJpeg = head[0] === 0xff && head[1] === 0xd8;
    const isPng = head[0] === 0x89 && head[1] === 0x50;
    const isGif = head[0] === 0x47 && head[1] === 0x49;
    const isWebp = head[0] === 0x52 && head[1] === 0x49;
    const realImage = res.ok && (isJpeg || isPng || isGif || isWebp);
    let kind = "ok-image";
    if (!res.ok) kind = res.status >= 300 && res.status < 400 ? "redirect" : `http-${res.status}`;
    else if (!realImage) kind = /html/i.test(ctype) ? "html-not-image" : `non-image(${ctype || "?"})`;
    return {
      ok: realImage, status: res.status, ctype, contentLength: clen || bytes,
      bytes, ms: Date.now() - started, kind, sbErr, https: url.startsWith("https://"),
    };
  } catch (e) {
    const msg = String(e?.name === "AbortError" ? "timeout" : e?.message ?? e);
    return { ok: false, status: 0, ctype: "", contentLength: 0, bytes: 0, ms: Date.now() - started, kind: msg, sbErr: "", https: url.startsWith("https://") };
  } finally {
    clearTimeout(t);
  }
}

async function loadProducts() {
  const cols = "id,name,sku,barcode,picture_link,rotation_override";
  const url = `${SUPABASE_URL}/rest/v1/products?select=${cols}&is_active=eq.true&order=id.asc&limit=${LIMIT}`;
  const res = await fetch(url, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  if (!res.ok) throw new Error(`products query failed: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  if (rows.length > 0) return rows;
  // Anon key: RLS hides the table — fall back to the public catalog RPC
  // (pages of ≤50; the RPC caps larger requests).
  const out = [];
  while (out.length < LIMIT) {
    const page = await fetch(`${SUPABASE_URL}/rest/v1/rpc/catalog_public`, {
      method: "POST",
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ q: null, cat: null, lim: 50, off: out.length }),
    });
    if (!page.ok) throw new Error(`catalog_public failed: ${page.status} ${await page.text()}`);
    const batch = await page.json();
    if (!batch.length) break;
    out.push(...batch);
    if (batch.length < 50) break;
  }
  return out.slice(0, LIMIT);
}

// Bucket names match the classification requested by the owner.
function classify(proxy, direct, link) {
  if (!link || !/^https:\/\//i.test(link)) return "invalid-or-empty-url";
  if (proxy.ok && direct.ok) return "proxy-ok + source-ok";
  if (!proxy.ok && direct.ok) return "proxy-FAIL + source-ok";
  if (proxy.ok && !direct.ok) return "proxy-ok + source-problem";
  return "both-FAIL";
}

const pct = (n, total) => (total ? ((n / total) * 100).toFixed(1) : "0.0") + "%";

async function main() {
  console.log(`Reading up to ${LIMIT} active products (read-only)…`);
  const products = await loadProducts();
  console.log(`Got ${products.length}.\n`);

  // ---- PASS 1: strictly sequential. Isolates PER-IMAGE failures from load. ----
  console.log("PASS 1 — sequential (1 request at a time): isolates per-image faults");
  const rows = [];
  for (const p of products) {
    const link = p.picture_link || "";
    const validHttps = /^https:\/\//i.test(link);
    // Probe the exact variant the site requests for this product (saved rot
    // included) — a rotated variant is a distinct cache entry with its own
    // cold-decode risk.
    const proxy = validHttps ? await probe(proxyUrl(link, 480, p.rotation_override ?? 0)) : { ok: false, status: 0, ctype: "", contentLength: 0, ms: 0, kind: "skipped-invalid-url", https: false };
    const direct = validHttps ? await probe(link) : { ok: false, status: 0, ctype: "", contentLength: 0, ms: 0, kind: "skipped-invalid-url", https: false };
    const bucket = classify(proxy, direct, link);
    rows.push({
      id: p.id, name: p.name, sku: p.sku ?? "", barcode: p.barcode ?? "",
      rotation_override: p.rotation_override ?? 0,
      picture_link: link, https: validHttps, bucket,
      proxy_status: proxy.status, proxy_ctype: proxy.ctype, proxy_len: proxy.contentLength, proxy_kind: proxy.kind, proxy_ms: proxy.ms,
      direct_status: direct.status, direct_ctype: direct.ctype, direct_len: direct.contentLength, direct_kind: direct.kind, direct_ms: direct.ms,
    });
    process.stdout.write(bucket.startsWith("proxy-ok + source-ok") ? "." : "x");
  }
  console.log("\n");

  // ---- PASS 2: burst. Proves/refutes the concurrency (worker-exhaustion) theory. ----
  const burstSample = rows.filter((r) => r.https).slice(0, BURST);
  console.log(`PASS 2 — burst of ${burstSample.length} simultaneous proxy requests: tests the concurrency theory`);
  const burst = await Promise.all(burstSample.map((r) => probe(proxyUrl(r.picture_link, 480, r.rotation_override ?? 0))));
  const burstOk = burst.filter((b) => b.ok).length;
  const burstFail = burst.length - burstOk;
  // Same URLs succeeded sequentially?
  const seqOkForSame = burstSample.filter((r) => r.proxy_status === 200 && r.proxy_kind === "ok-image").length;

  // ---- SUMMARY ----
  const buckets = {};
  for (const r of rows) buckets[r.bucket] = (buckets[r.bucket] || 0) + 1;
  const total = rows.length;

  console.log("\n================ SUMMARY ================");
  console.log(`sampled: ${total} active products\n`);
  for (const [k, v] of Object.entries(buckets).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(28)} ${String(v).padStart(4)}  ${pct(v, total)}`);
  }
  console.log("\n---- concurrency test ----");
  console.log(`  sequential OK for these URLs : ${seqOkForSame}/${burstSample.length}`);
  console.log(`  burst OK                     : ${burstOk}/${burst.length}`);
  console.log(`  burst FAILED                 : ${burstFail}  ${pct(burstFail, burst.length)}`);
  console.log(
    burstFail > 0 && seqOkForSame > burstOk
      ? "  => CONCURRENCY is a real factor: the same URLs pass alone and fail in a burst."
      : "  => no concurrency failure observed — but note pass 1 already WARMED these variants," +
        "\n     so this only proves cached variants survive a burst; it cannot clear cold-decode concurrency."
  );

  const failKinds = {};
  for (const r of rows) if (r.proxy_kind !== "ok-image") failKinds[r.proxy_kind] = (failKinds[r.proxy_kind] || 0) + 1;
  if (Object.keys(failKinds).length) {
    console.log("\n---- proxy failure kinds ----");
    for (const [k, v] of Object.entries(failKinds).sort((a, b) => b[1] - a[1])) console.log(`  ${String(k).padEnd(28)} ${v}`);
  }

  mkdirSync("image-diagnostics", { recursive: true });
  writeFileSync("image-diagnostics/report.json", JSON.stringify({ generatedAt: new Date().toISOString(), total, buckets, burst: { ok: burstOk, fail: burstFail, seqOkForSame }, failKinds, rows }, null, 2));
  const cols = Object.keys(rows[0] ?? { id: "" });
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
  writeFileSync("image-diagnostics/report.csv", csv);
  console.log("\nWrote image-diagnostics/report.json and report.csv");
}

main().catch((e) => { console.error(e); process.exit(1); });
