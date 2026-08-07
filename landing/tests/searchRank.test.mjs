// Unit tests for lib/searchRank.ts — run with `npm test` (plain node, no deps).
// Same on-the-fly TS transpile trick as quantity.test.mjs.
import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "../node_modules/typescript/lib/typescript.js";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "lib", "searchRank.ts"), "utf8");
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const tmp = mkdtempSync(join(tmpdir(), "rank-"));
const mod = join(tmp, "searchRank.mjs");
writeFileSync(mod, js);
const { normalizeHe, orderExactFirst } = await import(pathToFileURL(mod).href);

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("✓", name); };

t("normalize folds final letters", () => {
  assert.equal(normalizeHe("סליים"), "סליימ");
  assert.equal(normalizeHe("בלון"), "בלונ");
  assert.equal(normalizeHe("ארנב  קפצן!"), "ארנב קפצנ");
  assert.equal(normalizeHe('כדור "מיוחד"'), "כדור מיוחד");
});

t("exact substring floats above fuzzy", () => {
  const rows = [
    { name: "כדור גומי ברצלונה" },
    { name: "איירפודס לילדים כחול" },
    { name: "מטוס קרב" },
    { name: "אוזניות איירפודס ורוד" },
  ];
  const out = orderExactFirst(rows, "איירפודס").map((r) => r.name);
  assert.deepEqual(out, [
    "איירפודס לילדים כחול",
    "אוזניות איירפודס ורוד",
    "כדור גומי ברצלונה",
    "מטוס קרב",
  ]);
});

t("multi-word query: all words anywhere ranks tier 1", () => {
  const rows = [
    { name: "בובה רכה" },
    { name: "כדור ספוג זוהר" },   // has both words, other order
    { name: "ספוג כדור" },        // exact phrase? normalized contains "ספוג כדור"
  ];
  const out = orderExactFirst(rows, "ספוג כדור").map((r) => r.name);
  // "ספוג כדור" contains the query as substring → tier 0.
  // "כדור ספוג זוהר" has both words → tier 1. "בובה רכה" → tier 2.
  assert.deepEqual(out, ["ספוג כדור", "כדור ספוג זוהר", "בובה רכה"]);
});

t("short query returns rows untouched", () => {
  const rows = [{ name: "ב" }, { name: "א" }];
  assert.deepEqual(orderExactFirst(rows, "א").map((r) => r.name), ["ב", "א"]);
});

t("stable within tiers", () => {
  const rows = [
    { name: "לגו סיטי 1" },
    { name: "לגו סיטי 2" },
    { name: "פאזל" },
    { name: "לגו סיטי 3" },
  ];
  const out = orderExactFirst(rows, "לגו").map((r) => r.name);
  assert.deepEqual(out, ["לגו סיטי 1", "לגו סיטי 2", "לגו סיטי 3", "פאזל"]);
});

t("final-letter difference still matches exactly", () => {
  const rows = [{ name: "בלונים ארוזים" }, { name: "רובוט" }];
  const out = orderExactFirst(rows, "בלונימ").map((r) => r.name);
  assert.equal(out[0], "בלונים ארוזים");
});

t("Latin brand search is case-insensitive", () => {
  // normalizeHe lowercases; the header claims "case ignored" but no Latin
  // test covered it. Mixed HE/EN catalog names (brand lines) are plausible.
  assert.equal(normalizeHe("AirPods!!"), "airpods");
  const rows = [{ name: "פאזל 100 חלקים" }, { name: "LEGO City 60380" }];
  const out = orderExactFirst(rows, "lego").map((r) => r.name);
  assert.equal(out[0], "LEGO City 60380");
});

console.log(`\n${n} searchRank tests passed`);
