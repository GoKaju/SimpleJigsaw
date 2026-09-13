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
import { basename, dirname, extname, join } from "node:path";
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

// Categoria por defecto para las imagenes que estan sueltas en la raiz.
const ROOT_CATEGORY = "Otras";

interface CatalogEntry {
  id: string;
  name: string;
  category: string;      // id de la categoria (slug)
  categoryName: string;  // nombre legible (el de la carpeta)
  thumb: string;
  image: string;
  width: number;
  height: number;
  thumbWidth: number;
  thumbHeight: number;
}

interface CatalogCategory {
  id: string;
  name: string;
  count: number;
}

interface Catalog {
  generatedAt: string;
  count: number;
  categories: CatalogCategory[];
  images: CatalogEntry[];
}

interface SourceFile {
  path: string;          // ruta absoluta del archivo original
  file: string;          // nombre del archivo
  categoryName: string;  // nombre de la carpeta (o ROOT_CATEGORY)
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
  // Quita sufijos tipo hash de descargas ("Athenar_488f5cb9" -> "Athenar").
  const s = fileBase
    .replace(/[-_ ]+[0-9a-f]{6,}$/i, (m) => (/[a-f]/i.test(m) ? "" : m))
    .replace(/[-_]+/g, " ")
    .trim() || fileBase;
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

// Cada subcarpeta de images-source es una categoria. Las imagenes sueltas en la
// raiz caen en ROOT_CATEGORY. Solo se mira un nivel de profundidad.
async function listSources(): Promise<SourceFile[]> {
  const entries = await readdir(SOURCE_DIR, { withFileTypes: true });
  const out: SourceFile[] = [];

  function isImage(name: string): boolean {
    return SUPPORTED.has(extname(name).toLowerCase()) && !name.startsWith(".");
  }

  for (const entry of entries) {
    if (entry.isFile() && isImage(entry.name)) {
      out.push({ path: join(SOURCE_DIR, entry.name), file: entry.name, categoryName: ROOT_CATEGORY });
    } else if (entry.isDirectory() && !entry.name.startsWith(".")) {
      const dir = join(SOURCE_DIR, entry.name);
      const inner = await readdir(dir, { withFileTypes: true });
      for (const f of inner) {
        if (f.isFile() && isImage(f.name)) {
          out.push({ path: join(dir, f.name), file: f.name, categoryName: entry.name });
        }
      }
    }
  }

  return out.sort((a, b) =>
    a.categoryName.localeCompare(b.categoryName, "es") || a.file.localeCompare(b.file, "es"),
  );
}

async function processImage(source: SourceFile, usedIds: Set<string>): Promise<CatalogEntry> {
  const base = basename(source.file, extname(source.file));
  const categoryId = slugify(source.categoryName);
  let id = slugify(base);
  let n = 2;
  while (usedIds.has(id)) id = `${slugify(base)}-${n++}`;
  usedIds.add(id);

  // Las salidas replican la estructura de carpetas: docs/images/<categoria>/<id>.jpg
  const src = source.path;
  const hqRel = `images/${categoryId}/${id}.jpg`;
  const thumbRel = `thumbs/${categoryId}/${id}.jpg`;
  const hqOut = join(DOCS_DIR, hqRel);
  const thumbOut = join(DOCS_DIR, thumbRel);
  await mkdir(dirname(hqOut), { recursive: true });
  await mkdir(dirname(thumbOut), { recursive: true });

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
    `    ${source.file} -> ${hqRel}  ${hqInfo.width}x${hqInfo.height} (${(hqSize / 1024).toFixed(0)} KB) | thumb ${thumbInfo.width}x${thumbInfo.height} (${(thSize / 1024).toFixed(0)} KB)`,
  );

  return {
    id,
    name: humanName(base),
    category: categoryId,
    categoryName: source.categoryName,
    thumb: thumbRel,
    image: hqRel,
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
  let currentCategory = "";
  for (const source of files) {
    if (source.categoryName !== currentCategory) {
      currentCategory = source.categoryName;
      console.log(`  [${currentCategory}]`);
    }
    try {
      images.push(await processImage(source, usedIds));
    } catch (err) {
      console.error(`    ERROR procesando ${source.file}:`, (err as Error).message);
      process.exitCode = 1;
    }
  }

  // Categorias en el orden en que aparecen, con su conteo.
  const categories: CatalogCategory[] = [];
  const byId = new Map<string, CatalogCategory>();
  for (const img of images) {
    let cat = byId.get(img.category);
    if (!cat) {
      cat = { id: img.category, name: img.categoryName, count: 0 };
      byId.set(img.category, cat);
      categories.push(cat);
    }
    cat.count++;
  }

  const catalog: Catalog = {
    generatedAt: new Date().toISOString(),
    count: images.length,
    categories,
    images,
  };
  await writeFile(CATALOG_PATH, JSON.stringify(catalog, null, 2) + "\n", "utf8");
  console.log(`  catalog.json: ${images.length} imagen(es) en ${categories.length} categoria(s)`);
  for (const cat of categories) console.log(`    ${cat.name}: ${cat.count}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
