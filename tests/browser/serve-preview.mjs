/*
 * Vista previa del panel con Firebase simulado (no toca el proyecto real).
 *
 *   node tests/browser/serve-preview.mjs        (desde la raíz del repositorio)
 *   http://localhost:8790/             → como directivo
 *   http://localhost:8790/?rol=docente → como docente
 *
 * Sirve los archivos del repositorio y, en index.html, añade mock-data.js y un import map que
 * reemplaza las URL de Firebase (gstatic.com) por mock-firebase.js.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const PORT = Number(process.env.PORT || 8790);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".json": "application/json"
};
const FIREBASE = ["app", "auth", "database", "functions"].map((name) =>
  "https://www.gstatic.com/firebasejs/12.19.0/firebase-" + name + ".js");
const IMPORT_MAP = '<script type="importmap">' + JSON.stringify({
  imports: Object.fromEntries(FIREBASE.map((url) => [url, "/tests/browser/mock-firebase.js"]))
}) + "</script>";

createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  const path = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) {
    response.writeHead(403).end();
    return;
  }
  try {
    let body = await readFile(file);
    if (path === "/index.html") {
      body = body.toString("utf8").replace("</title>", "</title>\n  " + IMPORT_MAP + '\n  <script src="/tests/browser/mock-data.js"></script>');
    }
    response.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    response.end(body);
  } catch (error) {
    response.writeHead(404).end("No encontrado");
  }
}).listen(PORT, () => console.log("Vista previa con Firebase simulado en http://localhost:" + PORT));
