/**
 * serve.ts - Servidor estatico minimo para probar /docs en la red local.
 * Uso: node serve.ts [puerto]   (por defecto 8080)
 * Luego abrir http://<ip-de-tu-mac>:8080 en el iPad.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { networkInterfaces } from "node:os";

const DOCS = join(import.meta.dirname, "docs");
const PORT = Number(process.argv[2] ?? 8080);
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};

createServer(async (req, res) => {
  let path = decodeURIComponent((req.url ?? "/").split("?")[0]);
  if (path.endsWith("/")) path += "index.html";
  const file = join(DOCS, normalize(path).replace(/^(\.\.[/\\])+/, ""));
  try {
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("404");
  }
}).listen(PORT, () => {
  const ips = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i!.address);
  console.log(`Sirviendo /docs en:`);
  console.log(`  http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  http://${ip}:${PORT}   <- usar esta en el iPad`);
});
