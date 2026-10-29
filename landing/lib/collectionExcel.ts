// Excel export of a customer catalogue — manager only.
//
// The owner's spec, verbatim in spirit: one click turns the collection he is
// editing into an .xlsx with a PICTURE of each item, its description, the
// full barcode, the price, and one deliberately EMPTY column named
// "מחיר רשת" for him to fill in by hand while negotiating with a chain.
//
// Import this module dynamically (`await import(...)`) — it pulls exceljs
// (~1MB), which only a manager clicking ייצוא should ever download.

import ExcelJS from "exceljs";

export type ExcelRow = {
  name: string;
  barcode: string | null;
  price: number | null;
  /** Full proxy URL, already carrying the rotation fix — or "" for no image. */
  imageUrl: string;
};

// The picture cell is a SQUARE of about 173 px, and the picture fills it
// exactly (see the anchor below). Excel sizes a column in characters
// (≈ 7 px each + 5 px) and a row in points (4/3 px each), so these two
// numbers are the same square in Excel's own units.
const IMG_COL_CHARS = 24; // ≈ 173 px
const IMG_ROW_PT = 130; //   ≈ 173 px
/** Pixels of the embedded picture: twice the cell, so it stays sharp when
 *  the sheet is zoomed or printed. */
const IMG_SIDE = 360;

/** Fetch one product image and normalize it to a SQUARE IMG_SIDE JPEG, the
 *  photo centered on white with its own proportions kept and a small white
 *  margin. Square on purpose: the picture fills its square cell, so it can
 *  never be stretched. Canvas also converts whatever the proxy served (JPEG
 *  or WebP — exceljs embeds only png/jpeg/gif); JPEG keeps a 241-product file
 *  at a few MB where a PNG of the same photos would be several times that.
 *  The proxy URL already carries the orientation fix and the manual rotation,
 *  exactly what the site shows. An 8-second timeout per image so one stuck
 *  thumbnail cannot stall the export; any failure returns null — a missing
 *  picture must never sink the file. */
async function fetchAsJpeg(url: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    const SIDE = IMG_SIDE;
    const BOX = Math.round(SIDE * 0.92);
    const scale = Math.min(BOX / Math.max(bitmap.width, 1), BOX / Math.max(bitmap.height, 1));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = SIDE;
    canvas.height = SIDE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    // White ground: catalogue photos assume it.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, SIDE, SIDE);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, (SIDE - w) / 2, (SIDE - h) / 2, w, h);
    bitmap.close();
    const jpg = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.88));
    return jpg ? await jpg.arrayBuffer() : null;
  } catch {
    return null;
  }
}

/** Build the workbook. Exposed separately from the download so a Node test
 *  can build a sheet (rows without images) and read it back. */
export async function buildCollectionWorkbook(
  collectionName: string,
  rows: ExcelRow[],
  onProgress?: (done: number, total: number) => void,
  // Injectable for the Node test, which has no canvas; the site always uses
  // the browser path.
  fetchImage: (url: string) => Promise<ArrayBuffer | null> = fetchAsJpeg,
): Promise<{ workbook: ExcelJS.Workbook; imagesFailed: number }> {
  const wb = new ExcelJS.Workbook();
  // The sheet carries the catalogue's name — trimmed to Excel's rules
  // (31 chars, no : \ / ? * [ ]) — so a manager juggling three chains knows
  // which file is which from the tab itself.
  const sheetName = (collectionName || "קטלוג").replace(/[:\\/?*\[\]]+/g, " ").trim().slice(0, 31) || "קטלוג";
  const ws = wb.addWorksheet(sheetName, {
    // Right-to-left like the site, and the header row frozen so scrolling 241
    // products never loses the column names.
    views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }],
    // Printed, all five columns fit the page width (as many pages long as it
    // takes) — with the bigger pictures the price columns used to fall onto
    // a second sheet of paper.
    pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  ws.columns = [
    { header: "תמונה", key: "img", width: IMG_COL_CHARS },
    { header: "תיאור פריט", key: "name", width: 48 },
    { header: "ברקוד", key: "barcode", width: 18 },
    { header: "מחיר", key: "price", width: 11 },
    { header: "מחיר רשת", key: "net", width: 13 },
  ];
  const head = ws.getRow(1);
  head.font = { bold: true, size: 12 };
  head.alignment = { horizontal: "center", vertical: "middle" };
  head.height = 22;

  // Images first, in small batches — one slow thumbnail must not serialize
  // fifty others, and fifty at once would hammer the proxy.
  const pngs = new Array<ArrayBuffer | null>(rows.length).fill(null); // JPEG bytes
  let done = 0;
  // 10 at a time: measured against a cold proxy this roughly halves a
  // 241-product export versus 6, while staying under the edge function's own
  // in-flight bound (which fast-rejects when saturated — a rejection here
  // would surface as a missing image, the exact opposite of faster).
  const BATCH = 10;
  for (let i = 0; i < rows.length; i += BATCH) {
    await Promise.all(rows.slice(i, i + BATCH).map(async (r, j) => {
      if (r.imageUrl) pngs[i + j] = await fetchImage(r.imageUrl);
      done++;
      onProgress?.(done, rows.length);
    }));
  }

  rows.forEach((r, i) => {
    const row = ws.addRow({
      img: "",
      name: r.name,
      // As TEXT, always: Excel turns a long numeric barcode into 7.29e+12
      // and strips leading zeros — which is how a "full barcode" stops
      // scanning at the warehouse.
      barcode: r.barcode || "",
      price: r.price,
      net: "",
    });
    row.height = IMG_ROW_PT;
    row.alignment = { vertical: "middle", wrapText: true };
    row.getCell("barcode").numFmt = "@";
    if (r.price != null) row.getCell("price").numFmt = "0.00";

    const img = pngs[i];
    if (img) {
      const imgId = wb.addImage({ buffer: img, extension: "jpeg" });
      // The picture fills its own cell EXACTLY: from the cell's corner to the
      // next cell's corner, whole numbers only. Fractions (the 0.06 → 0.94
      // margin this used before) are turned into offsets by exceljs with the
      // wrong units — it counts a column as width×10000 EMU where Excel uses
      // ≈ width×66,700 — so the "94% of the cell" picture came out 13 px wide
      // inside a 103 px cell: a thin strip pushed against the side. The owner
      // reported exactly that ("ממש קטנות והולכות לצד"). Whole-cell corners
      // carry zero offsets, so there is nothing to convert. The margin now
      // lives inside the picture itself (fetchAsJpeg), and a cell-bounded
      // twoCellAnchor still follows its cell on the right-to-left sheet.
      // The corners are given in exceljs's NATIVE form (col/row + offset,
      // 0-based): the {col,row} form makes exceljs measure the row below the
      // corner, and getRow() creates that row — an empty row was being
      // inserted under every picture, pushing every later product down.
      ws.addImage(imgId, {
        tl: { nativeCol: 0, nativeColOff: 0, nativeRow: row.number - 1, nativeRowOff: 0 } as unknown as ExcelJS.Anchor,
        br: { nativeCol: 1, nativeColOff: 0, nativeRow: row.number, nativeRowOff: 0 } as unknown as ExcelJS.Anchor,
        editAs: "oneCell",
      });
    }
  });

  return { workbook: wb, imagesFailed: rows.filter((r, i) => r.imageUrl && !pngs[i]).length };
}

/** One-click path used by the admin screen: build and hand the file over. */
export async function exportCollectionExcel(
  collectionName: string,
  rows: ExcelRow[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ imagesFailed: number }> {
  const { workbook: wb, imagesFailed } = await buildCollectionWorkbook(collectionName, rows, onProgress);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  // Keep the catalogue's real name in the filename; strip only what a
  // filesystem refuses.
  a.download = `קטלוג-${(collectionName || "ללא-שם").replace(/[\\/:*?"<>|]+/g, " ").trim()}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  return { imagesFailed };
}
