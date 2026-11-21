// Plan 5 Task 13: copies the self-hosted OCR files from the pinned packages (tesseract.js 7.0.0,
// tesseract.js-core 7.0.0, @tesseract.js-data/eng 1.0.0 and @tesseract.js-data/rus 1.0.0) into apps/web/public/ocr/ (git-ignored,
// rebuilt), and checks every file against tools/ocr-assets.sha256. That manifest was computed from
// the pinned npm tarballs themselves, not from node_modules, so it proves something about
// node_modules. Changing a pin means regenerating the manifest in the same commit.
//
// Every vite build runs this (apps/web/vite.config.ts `ocrAssets`); a file that differs fails the
// build. Run by hand from the repo root: npx tsx tools/copy-ocr-assets.ts [--check]
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyPinned, readPinnedManifest, verifyPinned, type PinnedSet } from './pinned-assets.js';

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
  // The Russian model, for the Cyrillic second pass only (proof/ocr.ts `looksCyrillicGarbage`).
  { from: '@tesseract.js-data/rus/4.0.0_best_int/rus.traineddata.gz', to: 'rus.traineddata.gz' },
];

const OCR_SET: PinnedSet = { label: 'ocr-assets', manifest: OCR_MANIFEST, assets: OCR_ASSETS };

/** The manifest as served name → SHA-256 (`sha256sum` format: "<hex>  <name>"). */
export function readManifest(path = OCR_MANIFEST): Promise<Map<string, string>> {
  return readPinnedManifest({ label: OCR_SET.label, manifest: path });
}

/** Throws unless `outDir` holds exactly the manifest's files, each with its SHA-256. */
export function verifyOcrAssets(outDir = OCR_OUT_DIR, manifest?: Map<string, string>): Promise<void> {
  return verifyPinned(OCR_SET, outDir, manifest);
}

/** Copies and checks the OCR files (tools/pinned-assets.ts `copyPinned`). */
export function copyOcrAssets(o: { nodeModules?: string; outDir?: string } = {}): Promise<void> {
  return copyPinned(OCR_SET, { nodeModules: o.nodeModules ?? join(REPO, 'node_modules'), outDir: o.outDir ?? OCR_OUT_DIR });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) await verifyOcrAssets();
  else await copyOcrAssets();
}
