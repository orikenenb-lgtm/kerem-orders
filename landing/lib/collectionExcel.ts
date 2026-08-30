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

/** Fetch one product image and normalize it to a SQUARE 240x240 PNG, the
 *  photo centered on white with its own proportions kept. Square on purpose:
 *  the picture is anchored to fill its cell with a tl+br anchor (see below),
 *  and a square source means filling the box can never stretch the photo.
 *  Canvas also converts whatever the proxy served (JPEG or WebP — exceljs
 *  embeds only png/jpeg/gif). An 8-second timeout per image so one stuck
 *  thumbnail cannot stall a 241-product export; any failure returns null —
 *  a missing picture must never sink the file. */
async function fetchAsPng(url: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    const SIDE = 240;
    const scale = Math.min(SIDE / Math.max(bitmap.width, 1), SIDE / Math.max(bitmap.height, 1), 1);
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = SIDE;
    canvas.height = SIDE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    // White ground: catalogue photos assume it, and PNG transparency renders
    // as black in some Excel viewers.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, SIDE, SIDE);
    ctx.drawImage(bitmap, (SIDE - w) / 2, (SIDE - h) / 2, w, h);
    bitmap.close();
    const png = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    return png ? await png.arrayBuffer() : null;
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
  });

  ws.columns = [
    { header: "תמונה", key: "img", width: 14 },
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
  const pngs = new Array<ArrayBuffer | null>(rows.length).fill(null);
  let done = 0;
  // 10 at a time: measured against a cold proxy this roughly halves a
  // 241-product export versus 6, while staying under the edge function's own
  // in-flight bound (which fast-rejects when saturated — a rejection here
  // would surface as a missing image, the exact opposite of faster).
  const BATCH = 10;
  for (let i = 0; i < rows.length; i += BATCH) {
    await Promise.all(rows.slice(i, i + BATCH).map(async (r, j) => {
      if (r.imageUrl) pngs[i + j] = await fetchAsPng(r.imageUrl);
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
    row.height = 58;
    row.alignment = { vertical: "middle", wrapText: true };
    row.getCell("barcode").numFmt = "@";
    if (r.price != null) row.getCell("price").numFmt = "0.00";

    const png = pngs[i];
    if (png) {
      const imgId = wb.addImage({ buffer: png, extension: "png" });
      // tl+br BOTH inside the תמונה column, so the picture is clamped to its
      // own cell's rectangle. The earlier tl+ext (pixel offset) anchor is
      // exactly the form Excel misplaces on right-to-left sheets — pictures
      // drifted over the text columns and the owner reported "you can't see
      // everything". A cell-bounded anchor follows the cell wherever the
      // sheet direction puts it. The source PNG is square, so filling the
      // near-square box cannot stretch the photo.
      // exceljs's TS type for a tl+br range demands the full internal Anchor
      // shape, but the documented public form is plain {col,row} — cast.
      ws.addImage(imgId, {
        tl: { col: 0.06, row: row.number - 1 + 0.06 } as unknown as ExcelJS.Anchor,
        br: { col: 0.94, row: row.number - 0.06 } as unknown as ExcelJS.Anchor,
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
