// Tests for supabase/functions/detect-orientation/lib.ts — the rule that
// straightens new product photos from their EXIF tag. Plain node, same
// transpile harness as rivhitExpress.test.mjs.
import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "../node_modules/typescript/lib/typescript.js";

const here = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "orient-"));
const src = readFileSync(join(here, "..", "..", "supabase/functions/detect-orientation/lib.ts"), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
writeFileSync(join(tmp, "orient.mjs"), js);
const O = await import(pathToFileURL(join(tmp, "orient.mjs")).href);

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("✓", name); };

/** A minimal JPEG head: SOI + APP1 Exif with one IFD0 entry (Orientation). */
function jpegWithOrientation(value, little = true) {
  const u16 = (v) => little ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff];
  const u32 = (v) => little ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24] : [v >>> 24, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
  const tiff = [...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8),
    ...u16(1), ...u16(0x0112), ...u16(3), ...u32(1), ...u16(value), 0, 0, ...u32(0)];
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = app1.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 0xff, ...app1, 0xff, 0xda, 0, 2]);
}

t("EXIF tag read in both byte orders; anything else counts as 1", () => {
  for (const v of [1, 3, 6, 8]) {
    assert.equal(O.parseExifOrientation(jpegWithOrientation(v, true)), v, `II ${v}`);
    assert.equal(O.parseExifOrientation(jpegWithOrientation(v, false)), v, `MM ${v}`);
  }
  assert.equal(O.parseExifOrientation(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), 1, "png");
  assert.equal(O.parseExifOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2])), 1, "jpeg without exif");
  assert.equal(O.parseExifOrientation(jpegWithOrientation(6).slice(0, 14)), 1, "cut short");
  assert.equal(O.parseExifOrientation(jpegWithOrientation(9)), 1, "out of range");
});

t("phone held upright (5–8) → 180; everything else → no override", () => {
  for (const v of [5, 6, 7, 8]) assert.equal(O.overrideForExif(v), 180, String(v));
  for (const v of [1, 2, 3, 4, null]) assert.equal(O.overrideForExif(v), null, String(v));
});

// The reason for the 180, kept executable. The index maps are copied by hand
// from imagescript 1.3.0 v2/ops/rotate.mjs; Image.rotate(a) calls
// v2.rotate(360 - a). If this ever fails, the proxy's direction changed and
// every rotation_override must be re-derived — see lib.ts.
t("why 180: the proxy's Image.rotate(90) turns COUNTER-clockwise", () => {
  const v2rot90 = (W, H, x, y) => (H - 1 - y) + x * H;
  const v2rot270 = (W, H, x, y) => y + H * (W - 1 - x);
  const turn = (grid, W, H, deg) => { // imagescript Image.rotate(deg)
    let g = grid, w = W, h = H;
    for (let k = 0; k < ((360 - deg) % 360) / 90; k++) { // compose quarter turns of v2.rotate(90)
      const out = new Array(g.length);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[v2rot90(w, h, x, y)] = g[x + y * w];
      g = out; [w, h] = [h, w];
    }
    return { g: g.join(""), w, h };
  };
  // v2.rotate(270) directly, as Image.rotate(90) calls it:
  const out = new Array(6); const W = 3, H = 2, px = "ABCDEF";
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out[v2rot270(W, H, x, y)] = px[x + y * W];
  assert.equal(out.join(""), "CFBEAD", "ABC/DEF turned 90° counter-clockwise is CF/BE/AD");
  assert.equal(turn(px, 3, 2, 90).g, "CFBEAD", "composed quarter turns agree");
  // A phone photo (EXIF 6) needs 90° CLOCKWISE (= Image.rotate(270)). The
  // proxy calls Image.rotate(90 + override): only override 180 lands there.
  const upright = turn(px, 3, 2, 270).g;
  assert.notEqual(turn(px, 3, 2, (90 + 0) % 360).g, upright, "override 0 → upside down");
  assert.notEqual(turn(px, 3, 2, (90 + 90) % 360).g, upright, "override 90 → sideways");
  assert.equal(turn(px, 3, 2, (90 + 180) % 360).g, upright, "override 180 → upright");
});

const RIV = "https://api.rivhit.co.il/online/FileService.svc/getItemPic/512481045/";
const row = (id, extra = {}) => ({ id, picture_link: RIV + id, rotation_override: null, orient_checked: true, orient_ai_set: false, orient_human_ok: false, orient_attempts: 0, ...extra });

t("candidates: new first, then replaced photos, then never-read ones; others skipped", () => {
  const products = [
    row("u1"), row("n1", { orient_checked: false }), row("ok"), row("r1", { picture_link: RIV + "NEWPIC" }),
    row("x1", { picture_link: "https://evil.example/a.jpg", orient_checked: false }), row("n2", { orient_checked: false }),
  ];
  const audits = [{ product_id: "ok", picture_link: RIV + "ok" }, { product_id: "r1", picture_link: RIV + "r1" }, { product_id: "n1", picture_link: RIV + "n1" }];
  const all = O.pickCandidates(products, audits, 40);
  assert.deepEqual(all.picked.map((c) => `${c.kind}:${c.row.id}`), ["new:n1", "new:n2", "replaced:r1", "unaudited:u1"]);
  assert.equal(all.remaining, 0);
  const two = O.pickCandidates(products, audits, 2);
  assert.deepEqual(two.picked.map((c) => c.row.id), ["n1", "n2"]);
  assert.equal(two.remaining, 2);
});

t("new photo: straightened from its tag, unless a person already chose", () => {
  const nw = (extra) => ({ kind: "new", row: row("p", { orient_checked: false, ...extra }) });
  assert.deepEqual(O.decidePatch(nw(), 6), { rotation_override: 180, orient_ai_set: true, orient_checked: true, orient_verified: true });
  assert.deepEqual(O.decidePatch(nw(), 1), { rotation_override: null, orient_ai_set: false, orient_checked: true, orient_verified: true });
  // the old model's guess is not a person's choice — it gets replaced
  assert.equal(O.decidePatch(nw({ rotation_override: 90, orient_ai_set: true }), 6).rotation_override, 180);
  // a person's choice is kept
  assert.deepEqual(O.decidePatch(nw({ orient_human_ok: true }), 6), { orient_checked: true });
  assert.deepEqual(O.decidePatch(nw({ rotation_override: 90 }), 6), { orient_checked: true });
  // unreadable photo: nothing to straighten, but it leaves the queue
  assert.deepEqual(O.decidePatch(nw(), null), { orient_checked: true });
});

t("replaced photo: the new photo is straightened, the old choice dropped", () => {
  const rp = { kind: "replaced", row: row("p", { rotation_override: 180, orient_human_ok: true }) };
  assert.deepEqual(O.decidePatch(rp, 1), { rotation_override: null, orient_ai_set: false, orient_checked: true, orient_verified: true, orient_human_ok: false });
  assert.equal(O.decidePatch(rp, 8).rotation_override, 180);
  assert.equal(O.decidePatch(rp, null), null, "unreadable new photo: leave the row");
});

t("never-read old product: only recorded, its rotation never touched", () => {
  for (const o of [1, 6, null]) assert.equal(O.decidePatch({ kind: "unaudited", row: row("p", { rotation_override: 90 }) }, o), null);
});

console.log(`\n${n} orientation tests passed`);
