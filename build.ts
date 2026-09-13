/**
 * build.ts - Herramienta de build (uso local o en CI).
 *
 * Lee imagenes desde /images-source, genera:
 *   - /docs/thumbs/<nombre>.jpg  (miniatura ~300px, JPEG liviano)
 *   - /docs/images/<nombre>.jpg  (alta calidad, JPEG optimizado, max 2048px)
 *   - /docs/catalog.json         (metadata: nombre, thumbnail, imagen, dimensiones)
 *
 * Ejecutar: node build.ts   (Node >= 22.6 con TypeScript nativo)  o  pnpm build
 */
import { readdir, mkdir, writeFile, rm, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import sharp from "sharp";

const ROOT = import.meta.dirname;
const SOURCE_DIR = join(ROOT, "images-source");
const DOCS_DIR = join(ROOT, "docs");
const THUMBS_DIR = join(DOCS_DIR, "thumbs");
const IMAGES_DIR = join(DOCS_DIR, "images");
const CATALOG_PATH = join(DOCS_DIR, "catalog.json");

// El iPad mini 1 tiene 512 MB de RAM y un limite de canvas ~ 3 megapixeles en
// iOS 9. 1600px de lado mayor rinde bien y mantiene buena calidad en pantalla
// de 1024x768.
const MAX_HQ_SIDE = 1600;
const THUMB_SIDE = 300;
const HQ_QUALITY = 82;
const THUMB_QUALITY = 70;

const SUPPORTED = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".tif", ".tiff", ".avif", ".heic", ".heif"]);

interface CatalogEntry {
  id: string;
  name: string;
  thumb: string;
  image: string;
  width: number;
  height: number;
  thumbWidth: number;
  thumbHeight: number;
}

interface Catalog {
  generatedAt: string;
  count: number;
  images: CatalogEntry[];
}

function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "imagen";
}

function humanName(fileBase: string): string {
  const s = fileBase.replace(/[-_]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function ensureDirs(): Promise<void> {
  await mkdir(SOURCE_DIR, { recursive: true });
  // Regeneramos las salidas por completo para que no queden huerfanos.
  await rm(THUMBS_DIR, { recursive: true, force: true });
  await rm(IMAGES_DIR, { recursive: true, force: true });
  await mkdir(THUMBS_DIR, { recursive: true });
  await mkdir(IMAGES_DIR, { recursive: true });
}

async function listSources(): Promise<string[]> {
  const entries = await readdir(SOURCE_DIR, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && SUPPORTED.has(extname(e.name).toLowerCase()) && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, "es"));
}

async function processImage(file: string, usedIds: Set<string>): Promise<CatalogEntry> {
  const base = basename(file, extname(file));
  let id = slugify(base);
  let n = 2;
  while (usedIds.has(id)) id = `${slugify(base)}-${n++}`;
  usedIds.add(id);

  const src = join(SOURCE_DIR, file);
  const hqOut = join(IMAGES_DIR, `${id}.jpg`);
  const thumbOut = join(THUMBS_DIR, `${id}.jpg`);

  // rotate() sin argumentos aplica la orientacion EXIF y luego la descarta.
  const hq = sharp(src).rotate().resize({
    width: MAX_HQ_SIDE,
    height: MAX_HQ_SIDE,
    fit: "inside",
    withoutEnlargement: true,
  });
  const hqInfo = await hq
    .clone()
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: HQ_QUALITY, mozjpeg: true, progressive: false, chromaSubsampling: "4:2:0" })
    .toFile(hqOut);

  const thumbInfo = await sharp(hqOut)
    .resize({ width: THUMB_SIDE, height: THUMB_SIDE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: THUMB_QUALITY, mozjpeg: true })
    .toFile(thumbOut);

  const hqSize = (await stat(hqOut)).size;
  const thSize = (await stat(thumbOut)).size;
  console.log(
    `  ${file} -> ${id}.jpg  ${hqInfo.width}x${hqInfo.height} (${(hqSize / 1024).toFixed(0)} KB) | thumb ${thumbInfo.width}x${thumbInfo.height} (${(thSize / 1024).toFixed(0)} KB)`,
  );

  return {
    id,
    name: humanName(base),
    thumb: `thumbs/${id}.jpg`,
    image: `images/${id}.jpg`,
    width: hqInfo.width,
    height: hqInfo.height,
    thumbWidth: thumbInfo.width,
    thumbHeight: thumbInfo.height,
  };
}

async function main(): Promise<void> {
  console.log("SimpleJigsaw build");
  console.log(`  fuente : ${SOURCE_DIR}`);
  console.log(`  salida : ${DOCS_DIR}`);
  await ensureDirs();

  const files = await listSources();
  if (files.length === 0) {
    console.warn("  (aviso) No hay imagenes en images-source/. Se genera un catalogo vacio.");
  }

  const usedIds = new Set<string>();
  const images: CatalogEntry[] = [];
  for (const file of files) {
    try {
      images.push(await processImage(file, usedIds));
    } catch (err) {
      console.error(`  ERROR procesando ${file}:`, (err as Error).message);
      process.exitCode = 1;
    }
  }

  const catalog: Catalog = {
    generatedAt: new Date().toISOString(),
    count: images.length,
    images,
  };
  await writeFile(CATALOG_PATH, JSON.stringify(catalog, null, 2) + "\n", "utf8");
  console.log(`  catalog.json: ${images.length} imagen(es)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
