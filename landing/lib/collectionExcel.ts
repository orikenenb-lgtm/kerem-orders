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

type FetchedImage = { buf: ArrayBuffer; width: number; height: number };

/** Fetch one product image and normalize it to PNG via canvas. The proxy can
 *  serve JPEG or WebP depending on the pipeline; exceljs embeds only
 *  png/jpeg/gif, and drawing through a canvas makes the answer always PNG —
 *  whatever arrived. Downscaled to at most 240px on the long edge: the cell
 *  shows ~68px, and embedding full-size pixels only bloats the file. Returns
 *  null on any failure: a missing picture must never sink the whole export. */
async function fetchAsPng(url: string): Promise<FetchedImage | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, 240 / Math.max(bitmap.width, bitmap.height, 1));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    // White ground: catalogue photos assume it, and PNG transparency renders
    // as black in some Excel viewers.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const png = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    return png ? { buf: await png.arrayBuffer(), width: w, height: h } : null;
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
    // The whole sheet reads right-to-left, like the site and like the owner.
    views: [{ rightToLeft: true }],
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
  const pngs = new Array<FetchedImage | null>(rows.length).fill(null);
  let done = 0;
  const BATCH = 6;
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
      const imgId = wb.addImage({ buffer: png.buf, extension: "png" });
      // Fit inside a 68px box KEEPING the photo's own proportions — a forced
      // square stretches every landscape carton and portrait blister pack.
      const fit = 68 / Math.max(png.width, png.height, 1);
      // Anchor inside the תמונה cell of THIS row (0-based col/row).
      ws.addImage(imgId, {
        tl: { col: 0.1, row: row.number - 1 + 0.05 },
        ext: { width: Math.max(1, Math.round(png.width * fit)), height: Math.max(1, Math.round(png.height * fit)) },
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
