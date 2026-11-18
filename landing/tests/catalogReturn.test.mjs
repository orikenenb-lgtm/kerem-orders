// Unit tests for lib/catalogReturn.ts — run with `npm test` (plain node).
import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "../node_modules/typescript/lib/typescript.js";

const here = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "catret-"));
const src = readFileSync(join(here, "..", "lib", "catalogReturn.ts"), "utf8");
writeFileSync(join(tmp, "catalogReturn.mjs"), ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText);
const M = await import(pathToFileURL(join(tmp, "catalogReturn.mjs")).href);

let n = 0;
const test = (name, fn) => { fn(); n++; console.log("✓", name); };
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
const VIEW = { uid: "u1", activeCat: "כדורים", input: "כדור", sort: "price_asc", priceBucket: "5-10", pages: 3, anchorId: "p0101", anchorTop: 212.5, scrollY: 4300 };
const NOW = 1_800_000_000_000;

test("round trip: what was saved comes back, stamped with the time", () => {
  const s = mem();
  M.saveCatalogReturn(VIEW, s, NOW);
  assert.deepEqual(M.readCatalogReturn(NOW + 1000, s), { ...VIEW, at: NOW });
});

test("read does not consume (dev double-render safe); clear does", () => {
  const s = mem();
  M.saveCatalogReturn(VIEW, s, NOW);
  assert.ok(M.readCatalogReturn(NOW, s));
  assert.ok(M.readCatalogReturn(NOW, s));
  M.clearCatalogReturn(s);
  assert.equal(M.readCatalogReturn(NOW, s), null);
});

test("expires after 30 minutes; a time in the future is refused", () => {
  const s = mem();
  M.saveCatalogReturn(VIEW, s, NOW);
  assert.ok(M.readCatalogReturn(NOW + M.CATALOG_RETURN_MAX_AGE_MS, s));
  assert.equal(M.readCatalogReturn(NOW + M.CATALOG_RETURN_MAX_AGE_MS + 1, s), null);
  assert.equal(M.readCatalogReturn(NOW - 1, s), null);
});

test("never re-loads more than 10 pages, whatever was stored", () => {
  assert.equal(M.parseCatalogReturn({ ...VIEW, at: NOW, pages: 400 }, NOW).pages, M.CATALOG_RETURN_MAX_PAGES);
  assert.equal(M.parseCatalogReturn({ ...VIEW, at: NOW, pages: 2.9 }, NOW).pages, 2);
});

test("anything malformed or tampered is ignored", () => {
  const bad = [
    null, 5, "x", {},
    { ...VIEW, at: NOW, uid: "" },
    { ...VIEW, at: NOW, sort: "price; drop" },
    { ...VIEW, at: NOW, pages: 0 },
    { ...VIEW, at: NOW, scrollY: -5 },
    { ...VIEW, at: NOW, activeCat: "" },
    { ...VIEW, at: NOW, input: "x".repeat(500) },
    { ...VIEW, at: NOW, anchorTop: Infinity },
    { ...VIEW, at: "yesterday" },
  ];
  for (const b of bad) assert.equal(M.parseCatalogReturn(b, NOW), null, JSON.stringify(b)?.slice(0, 60));
  const s = mem();
  s.setItem(M.CATALOG_RETURN_KEY, "{not json");
  assert.equal(M.readCatalogReturn(NOW, s), null);
});

test("stores view state only — no product rows, prices or cart", () => {
  const s = mem();
  M.saveCatalogReturn({ ...VIEW, price: 9.9, products: [{ id: "x", price: 1 }] }, s, NOW);
  assert.doesNotMatch(s.getItem(M.CATALOG_RETURN_KEY), /price"|products/);
  const back = M.readCatalogReturn(NOW, s);
  assert.deepEqual(Object.keys(back).sort(), ["activeCat", "anchorId", "anchorTop", "at", "input", "pages", "priceBucket", "scrollY", "sort", "uid"]);
});

test("blocked storage: the feature is simply off, nothing throws", () => {
  const boom = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  M.saveCatalogReturn(VIEW, boom, NOW);
  assert.equal(M.readCatalogReturn(NOW, boom), null);
  M.clearCatalogReturn(boom);
  assert.equal(M.readCatalogReturn(NOW, null), null);
});

console.log(`\n${n} catalogReturn tests passed`);
