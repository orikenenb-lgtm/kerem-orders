// Unit + end-to-end tests for the deploy-time photo mirror:
//   lib/imageMirror.ts       (browser side: key, which URL to try first)
//   scripts/mirror-images.mjs (deploy side: download, validate, publish)
// Run with `npm test` (plain node, no deps). The e2e part runs the real script
// against a local fake proxy in a TEMP folder — it never touches the repo,
// Supabase or Rivhit.
import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "../node_modules/typescript/lib/typescript.js";

const here = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "imgmirror-"));
const transpile = (name, replace = (s) => s) => {
  const src = readFileSync(join(here, "..", "lib", `${name}.ts`), "utf8");
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  writeFileSync(join(tmp, `${name}.mjs`), replace(js));
};
transpile("images");
const LINK = "https://api.rivhit.co.il/online/FileService.svc/getItemPic/512481045/jom4r4xl";
const LINK2 = "https://api.rivhit.co.il/online/FileService.svc/getItemPic/512481045/AbC123";
// The browser module, with a known list of shipped photos.
writeFileSync(join(tmp, "imageMirror.data.mjs"), `export const MIRRORED_480 = "512481045_jom4r4xl,512481045_jom4r4xl_r180";\n`);
transpile("imageMirror", (js) => js.replace(/from "\.\/imageMirror\.data"/, 'from "./imageMirror.data.mjs"'));

const { rivhitImg } = await import(pathToFileURL(join(tmp, "images.mjs")).href);
const { mirrorKey, mirrorSrc, MIRROR_WIDTH } = await import(pathToFileURL(join(tmp, "imageMirror.mjs")).href);
const script = await import(pathToFileURL(join(here, "..", "scripts", "mirror-images.mjs")).href);

let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log("✓", name); };

const TABLE = [
  [LINK, 0], [LINK, 180], [LINK, -90], [LINK, 360], [LINK, 90.4], [LINK, null], [LINK2, 270],
  [" " + LINK + " ", 0],
  ["http://api.rivhit.co.il/online/FileService.svc/getItemPic/512481045/jom4r4xl", 0],
  ["https://evil.example/online/FileService.svc/getItemPic/512481045/jom4r4xl", 0],
  ["https://api.rivhit.co.il/online/FileService.svc/getItemPic/512481045/../x", 0],
  ["https://api.rivhit.co.il/online/FileService.svc/getItemPic/512481045/jom4r4xl?x=1", 0],
  ["https://api.rivhit.co.il/online/FileService.svc/getItemPic/512481045/a/b", 0],
  ["https://api.rivhit.co.il@evil.com/online/FileService.svc/getItemPic/1/x", 0],
  ["", 0], [null, 0],
];

await test("keys: plain ids only, rotation normalised like the proxy URL", () => {
  assert.equal(mirrorKey(LINK, 0), "512481045_jom4r4xl");
  assert.equal(mirrorKey(LINK, 180), "512481045_jom4r4xl_r180");
  assert.equal(mirrorKey(LINK, -90), "512481045_jom4r4xl_r270");
  assert.equal(mirrorKey(LINK, 360), "512481045_jom4r4xl");
  assert.equal(mirrorKey(LINK, null), "512481045_jom4r4xl");
  for (const [l] of TABLE.slice(8)) assert.equal(mirrorKey(l, 0), "", `must refuse ${l}`);
});

await test("deploy script derives exactly the same keys as the browser", () => {
  for (const [l, r] of TABLE) assert.equal(script.mirrorKeyFor(l, r), mirrorKey(l, r), `${l} ${r}`);
});

await test("deploy script downloads exactly the URL the browser would load from the proxy", () => {
  for (const [l, r] of TABLE.slice(0, 7)) assert.equal(script.proxyUrlFor(l, r), rivhitImg(l, 480, r), `${l} ${r}`);
});

await test("browser: static copy only for shipped photos at the card width", () => {
  assert.equal(MIRROR_WIDTH, 480);
  assert.equal(mirrorSrc(LINK, 480, 0, "/kerem-orders"), "/kerem-orders/pimg/480/512481045_jom4r4xl.jpg");
  assert.equal(mirrorSrc(LINK, 480, 180, "/kerem-orders"), "/kerem-orders/pimg/480/512481045_jom4r4xl_r180.jpg");
  assert.equal(mirrorSrc(LINK, 480, 90, "/kerem-orders"), "", "a rotation that was not shipped falls back to the proxy");
  assert.equal(mirrorSrc(LINK, 900, 0, "/kerem-orders"), "", "product-page sizes are not mirrored");
  assert.equal(mirrorSrc(LINK2, 480, 270, "/kerem-orders"), "", "a photo that is not in this build falls back");
  assert.equal(mirrorSrc("", 480, 0), "");
});

await test("only real JPEGs of a sane size are accepted", () => {
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(5000)]);
  assert.equal(script.isGoodJpeg(jpg, "image/jpeg"), true);
  assert.equal(script.isGoodJpeg(jpg, "text/html"), false);
  assert.equal(script.isGoodJpeg(Buffer.alloc(5000), "image/jpeg"), false);
  assert.equal(script.isGoodJpeg(jpg.subarray(0, 100), "image/jpeg"), false);
});

await test("end to end: downloads, refuses bad bodies, survives 546, publishes only what it holds", async () => {
  const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(6000, 7)]);
  const hits = {};
  const srv = createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const id = (u.searchParams.get("u") || "").split("/").pop();
    hits[id] = (hits[id] || 0) + 1;
    if (id === "dead") { res.writeHead(546); return res.end("{}"); }
    if (id === "html") { res.writeHead(200, { "content-type": "text/html" }); return res.end("<html>" + "x".repeat(5000)); }
    if (id === "flaky" && hits[id] === 1) { res.writeHead(546); return res.end("{}"); }
    res.writeHead(200, { "content-type": "image/jpeg" });
    res.end(JPG);
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;
  const root = mkdtempSync(join(tmpdir(), "imgmirror-root-"));
  mkdirSync(join(root, "lib"));
  writeFileSync(join(root, "lib", "imageMirror.data.ts"), "// header\nexport const MIRRORED_480: string = \"\";\n");
  const P = (id, rot = null) => ({ id, name: id, category: "c", picture_link: `https://api.rivhit.co.il/online/FileService.svc/getItemPic/512481045/${id}`, rotation_override: rot });
  const fixture = join(root, "fixture.json");
  writeFileSync(fixture, JSON.stringify({ categories: [], products: [P("ok1"), P("ok2", 180), P("dead"), P("html"), P("flaky"), { ...P("x"), picture_link: "" }] }));
  Object.assign(process.env, { MIRROR_ROOT: root, KEREM_PUBLIC_PRODUCTS_FIXTURE: fixture, MIRROR_PROXY_BASE: `http://127.0.0.1:${port}`, MIRROR_BUDGET_SEC: "60" });
  // The script reads MIRROR_ROOT at import time — import a fresh copy.
  const fresh = await import(pathToFileURL(join(here, "..", "scripts", "mirror-images.mjs")).href + "?e2e");
  const stats = await fresh.main();
  srv.close();
  const files = readdirSync(join(root, "public", "pimg", "480")).sort();
  assert.deepEqual(files, ["512481045_flaky.jpg", "512481045_ok1.jpg", "512481045_ok2_r180.jpg"]);
  const data = readFileSync(join(root, "lib", "imageMirror.data.ts"), "utf8");
  assert.match(data, /^\/\/ header/);
  assert.match(data, /MIRRORED_480: string = "512481045_flaky,512481045_ok1,512481045_ok2_r180";/);
  assert.equal(stats.notMirrorable, 1);
  assert.equal(hits.dead, 3, "a dead photo is tried a bounded 3 times, never in a loop");
  assert.equal(hits.html, 1, "a non-image 200 is not retried and never published");
  assert.ok(existsSync(join(root, ".pimg-cache", "480", "index.json")));
  // Second run: everything good is cached — only the two bad ones are asked again.
  for (const k of Object.keys(hits)) delete hits[k];
  const srv2 = createServer((req, res) => { const id = new URL(req.url, "http://x").searchParams.get("u").split("/").pop(); hits[id] = (hits[id] || 0) + 1; res.writeHead(546); res.end(); });
  await new Promise((r) => srv2.listen(port, "127.0.0.1", r));
  await fresh.main();
  srv2.close();
  assert.deepEqual(Object.keys(hits).sort(), ["dead", "html"], "cached photos are not downloaded again");
  assert.deepEqual(readdirSync(join(root, "public", "pimg", "480")).sort(), files, "a failing proxy never removes a photo we already hold");
});

console.log(`\n${n} imageMirror tests passed`);
