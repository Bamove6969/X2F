// Plan 5 Task 13: copies the self-hosted OCR files from the pinned packages (tesseract.js 7.0.0,
// tesseract.js-core 7.0.0, @tesseract.js-data/eng 1.0.0) into apps/web/public/ocr/ (git-ignored,
// rebuilt), and checks every file against tools/ocr-assets.sha256. That manifest was computed from
// the pinned npm tarballs themselves, not from node_modules, so it proves something about
// node_modules. Changing a pin means regenerating the manifest in the same commit.
//
// Every vite build runs this (apps/web/vite.config.ts `ocrAssets`); a file that differs fails the
// build. Run by hand from the repo root: npx tsx tools/copy-ocr-assets.ts [--check]
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
export const OCR_MANIFEST = join(REPO, 'tools', 'ocr-assets.sha256');
export const OCR_OUT_DIR = join(REPO, 'apps', 'web', 'public', 'ocr');

/**
 * The served files and where each comes from (review 2026-10-24). With `corePath` a directory,
 * tesseract.js 7 picks relaxed SIMD, then SIMD, then plain, each `-lstm` for the LSTM-only engine;
 * the `.wasm.js` files carry their WASM inline. The model is the LSTM-only `4.0.0_best_int`.
 */
export const OCR_ASSETS: ReadonlyArray<{ from: string; to: string }> = [
  { from: 'tesseract.js/dist/worker.min.js', to: 'worker.min.js' },
  { from: 'tesseract.js-core/tesseract-core-lstm.wasm.js', to: 'tesseract-core-lstm.wasm.js' },
  { from: 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js', to: 'tesseract-core-simd-lstm.wasm.js' },
  { from: 'tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', to: 'tesseract-core-relaxedsimd-lstm.wasm.js' },
  { from: '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', to: 'eng.traineddata.gz' },
];

const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

/** The manifest as served name → SHA-256 (`sha256sum` format: "<hex>  <name>"). */
export async function readManifest(path = OCR_MANIFEST): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  for (const raw of (await readFile(path, 'utf8')).split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const match = /^([0-9a-f]{64}) {2}([A-Za-z0-9._-]+)$/.exec(line);
    if (!match) throw new Error(`ocr-assets: bad manifest line: ${line}`);
    m.set(match[2]!, match[1]!);
  }
  return m;
}

/** Throws unless `outDir` holds exactly the manifest's files, each with its SHA-256. */
export async function verifyOcrAssets(outDir = OCR_OUT_DIR, manifest?: Map<string, string>): Promise<void> {
  const m = manifest ?? (await readManifest());
  const present = new Set(await readdir(outDir).catch(() => [] as string[]));
  for (const [name, hash] of m) {
    if (!present.has(name)) throw new Error(`ocr-assets: ${name} is missing from ${outDir}`);
    if (sha256(await readFile(join(outDir, name))) !== hash) throw new Error(`ocr-assets: ${name} does not match tools/ocr-assets.sha256`);
  }
  for (const name of present) if (!m.has(name)) throw new Error(`ocr-assets: ${name} in ${outDir} is not in tools/ocr-assets.sha256`);
}

/**
 * Checks every source file against the manifest before writing anything, then writes only what is
 * missing or different (through a temporary file and a rename, so parallel builds never see half a
 * file), and finally verifies the whole folder.
 */
export async function copyOcrAssets(o: { nodeModules?: string; outDir?: string } = {}): Promise<void> {
  const nodeModules = o.nodeModules ?? join(REPO, 'node_modules');
  const outDir = o.outDir ?? OCR_OUT_DIR;
  const m = await readManifest();
  const sources = await Promise.all(
    OCR_ASSETS.map(async (a) => {
      const bytes = await readFile(join(nodeModules, a.from));
      if (sha256(bytes) !== m.get(a.to)) throw new Error(`ocr-assets: ${a.from} (served as ${a.to}) does not match tools/ocr-assets.sha256`);
      return { ...a, bytes };
    }),
  );
  await mkdir(outDir, { recursive: true });
  for (const s of sources) {
    const dest = join(outDir, s.to);
    const current = await readFile(dest).catch(() => null);
    if (current !== null && sha256(current) === m.get(s.to)) continue;
    const tmp = `${dest}.${process.pid}.tmp`;
    await writeFile(tmp, s.bytes);
    await rename(tmp, dest).catch(async (e: unknown) => {
      await rm(tmp, { force: true });
      throw e;
    });
  }
  await verifyOcrAssets(outDir, m);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) await verifyOcrAssets();
  else await copyOcrAssets();
}
