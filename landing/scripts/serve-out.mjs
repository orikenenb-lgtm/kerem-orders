// Local preview of the static export, emulating GitHub Pages.
//
// `next build` (output: export) emits the site under the /kerem-orders
// basePath, so a plain static server rooted at ./out serves index.html at "/"
// while its assets point at "/kerem-orders/..." and 404. This tiny server
// mounts ./out under that same basePath, mirroring production, and falls back
// to out/404.html (with a 404 status) for unknown paths — exactly like Pages.
//
//   npm run build && npm run serve   # http://localhost:8735/kerem-orders/
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, normalize, extname } from "node:path";

const ROOT = normalize(process.argv[2] || "out");
const BASE = "/kerem-orders";
const PORT = Number(process.env.PORT) || 8735;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".xml": "application/xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".mp4": "video/mp4",
  ".ico": "image/x-icon",
};

async function tryFile(p) {
  try {
    const s = await stat(p);
    if (s.isFile()) return p;
    if (s.isDirectory()) {
      const idx = join(p, "index.html");
      const si = await stat(idx).catch(() => null);
      if (si?.isFile()) return idx;
    }
  } catch { /* not found */ }
  return null;
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  let path = decodeURIComponent(url.pathname);
  if (!path.startsWith(BASE + "/") && path !== BASE) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end(`Serve under ${BASE}/ — this mirrors the GitHub Pages basePath.`);
    return;
  }
  path = path.slice(BASE.length) || "/";
  const fsPath = normalize(join(ROOT, path));
  if (!fsPath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  let file = await tryFile(fsPath);
  if (!file && !extname(fsPath)) file = await tryFile(fsPath + ".html");
  if (file) {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } else {
    const body = await readFile(join(ROOT, "404.html")).catch(() => Buffer.from("404"));
    res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    res.end(body);
  }
}).listen(PORT, () => console.log(`serving ${ROOT} at http://localhost:${PORT}${BASE}/`));
