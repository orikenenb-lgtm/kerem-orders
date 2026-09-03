// Regression test for lib/collectionExcel.ts — run with `npm test` (plain node).
//
// collectionExcel.ts is TypeScript that imports the real `exceljs` package, so
// the same on-the-fly transpile trick as pricing.test.mjs is used, but the
// transpiled .mjs is written INSIDE landing/ (a temp dir under tests/) rather
// than os.tmpdir(): `import ExcelJS from "exceljs"` is a bare specifier that
// only resolves when node can walk up to landing/node_modules. The temp dir is
// removed at the end so the working tree stays clean.
//
// Only buildCollectionWorkbook() is exercised, and only with rows whose
// imageUrl is "" — the image path (fetchAsPng) needs a browser (fetch, canvas,
// createImageBitmap) and hits the network, neither of which belongs in a unit
// test. With no images the worksheet's structure is fully deterministic.
import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "../node_modules/typescript/lib/typescript.js";

const here = dirname(fileURLToPath(import.meta.url));
// Under tests/ (not os.tmpdir) so the bare `exceljs` import resolves against
// landing/node_modules via node's upward module lookup.
const tmp = mkdtempSync(join(here, "excel-"));

let n = 0;
const at = async (name, fn) => { await fn(); n++; console.log("✓", name); };

try {
  const src = readFileSync(join(here, "..", "lib", "collectionExcel.ts"), "utf8");
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const modPath = join(tmp, "collectionExcel.mjs");
  writeFileSync(modPath, js);
  const { buildCollectionWorkbook } = await import(pathToFileURL(modPath).href);

  const EXPECTED_HEADERS = ["תמונה", "תיאור פריט", "ברקוד", "מחיר", "מחיר רשת"];

  // A small catalogue of image-free rows, one of which has a null barcode.
  const rows = [
    { name: "כדור קפיצה", barcode: "7290000000001", price: 12.5, imageUrl: "" },
    { name: "בלון פרחים", barcode: null, price: null, imageUrl: "" },
    { name: "סליים ירוק", barcode: "7290000000002", price: 3.9, imageUrl: "" },
  ];

  await at("build resolves without any network fetch for image-free rows", async () => {
    const { workbook, imagesFailed } = await buildCollectionWorkbook("קטלוג בדיקה", rows);
    assert.ok(workbook, "a workbook is returned");
    // No imageUrl anywhere → nothing could have failed.
    assert.equal(imagesFailed, 0);
  });

  await at("(a) the sheet has exactly the 5 spec columns, in order", async () => {
    const { workbook } = await buildCollectionWorkbook("קטלוג בדיקה", rows);
    const ws = workbook.worksheets[0];
    assert.ok(ws, "a worksheet exists");
    assert.equal(ws.columnCount, 5, "exactly five columns");
    // Header row (row 1) carries the five names, right-to-left order as authored.
    const head = ws.getRow(1);
    const headers = [1, 2, 3, 4, 5].map((c) => head.getCell(c).value);
    assert.deepEqual(headers, EXPECTED_HEADERS);
    // …and the column definitions agree with the header cells.
    assert.deepEqual(ws.columns.map((c) => c.header), EXPECTED_HEADERS);
  });

  await at("(b) the view is right-to-left with a frozen header row (ySplit 1)", async () => {
    const { workbook } = await buildCollectionWorkbook("קטלוג בדיקה", rows);
    const ws = workbook.worksheets[0];
    assert.ok(Array.isArray(ws.views) && ws.views.length >= 1, "a view is configured");
    const view = ws.views[0];
    assert.equal(view.rightToLeft, true, "sheet reads right-to-left like the site");
    assert.equal(view.state, "frozen", "the header is frozen, not merely split");
    assert.equal(view.ySplit, 1, "exactly the header row (1) stays pinned");
  });

  await at("(c) a null barcode produces an empty cell and never throws", async () => {
    const { workbook } = await buildCollectionWorkbook("קטלוג בדיקה", rows);
    const ws = workbook.worksheets[0];
    // Row 3 is the data row for the null-barcode product (row 1 is the header).
    const cell = ws.getRow(3).getCell(3);
    const v = cell.value;
    assert.ok(v === null || v === "" || v === undefined, `null barcode → empty cell, got ${JSON.stringify(v)}`);
    // The barcode column is forced to text format so a scanned number keeps its
    // leading zeros — assert that survives even for the empty cell.
    assert.equal(cell.numFmt, "@");
    // A populated barcode two rows up is present and text-formatted.
    const filled = ws.getRow(2).getCell(3);
    assert.equal(filled.value, "7290000000001");
    assert.equal(filled.numFmt, "@");
  });

  await at("(d) zero rows still yields a valid, serializable workbook", async () => {
    const { workbook, imagesFailed } = await buildCollectionWorkbook("ריק", []);
    const ws = workbook.worksheets[0];
    assert.ok(ws, "a worksheet exists even with no products");
    assert.equal(ws.columnCount, 5, "the header columns are still laid out");
    assert.deepEqual(ws.getRow(1).values.slice(1, 6), EXPECTED_HEADERS);
    assert.equal(imagesFailed, 0);
    // The real proof a workbook is valid: it serializes to an .xlsx buffer.
    const buf = await workbook.xlsx.writeBuffer();
    assert.ok(buf && buf.byteLength > 0, "the empty catalogue writes a real file");
  });

  await at("the sheet name is trimmed to Excel's rules and never empty", async () => {
    // Illegal characters (: \\ / ? * [ ]) are replaced and the name is capped
    // at 31 chars; a name that reduces to nothing falls back to קטלוג.
    const { workbook } = await buildCollectionWorkbook("a/b:c*[d]?", []);
    const name = workbook.worksheets[0].name;
    assert.ok(!/[:\\/?*\[\]]/.test(name), `sheet name must be Excel-legal, got "${name}"`);
    assert.ok(name.length > 0 && name.length <= 31);
    const fallback = await buildCollectionWorkbook("", []);
    assert.equal(fallback.workbook.worksheets[0].name, "קטלוג");
  });

  console.log(`\n${n} collectionExcel tests passed`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
