// Plan 5 Task 13: the on-device OCR behind the proof blur (`ProofImageDeps.ocr`). PRIVACY-critical.
//
// - Everything stays on this device. tesseract.js runs in one dedicated worker loaded from this
//   origin (`/ocr/worker.min.js`, never a blob: worker), and the worker loads its engine and the
//   English model from `/ocr/` only (tools/copy-ocr-assets.ts copies them from the pinned packages
//   and checks them against tools/ocr-assets.sha256). Every `/ocr/*` response carries the worker's
//   own CSP (apps/api/src/static/serve.ts `OCR_WORKER_CSP`), so even a default that pointed at a CDN
//   could not be fetched; the CDN default is also dropped from the bundle (vite.config.ts).
// - Loaded lazily: tesseract.js is a separate chunk, imported on the first proof, never at start.
// - It never throws. A load that fails or takes longer than OCR_TIMEOUT_MS, a recognition that fails
//   or hangs, and a result with no blocks answer null: the editor then says it could not check the
//   image and starts with no regions (Review Focus 3). A worker that failed or timed out is
//   terminated, even one whose load never settles (review m-2: the vite plugin's `spawnWorker`
//   hands the raw Worker to `onSpawn`); the next proof tries afresh.
// - Nothing here logs: tesseract's logger and error handler are silent.
import type { OcrWord } from '@x2f/proof';

/** P5-A27: Latin script at launch. */
export const PROOF_OCR_LANGS: readonly string[] = ['eng'];
/** Review Focus 3: past this, the proof goes on without automatic regions. */
export const OCR_TIMEOUT_MS = 30_000;

/** Where everything comes from: this origin, no blob: worker, no cache, the LSTM-only core and model. */
export const OCR_WORKER_OPTIONS = Object.freeze({
  workerPath: '/ocr/worker.min.js',
  corePath: '/ocr/',
  langPath: '/ocr/',
  workerBlobURL: false,
  gzip: true,
  cacheMethod: 'none',
  legacyCore: false,
  legacyLang: false,
});

/** The parts of tesseract.js's result this reads (output `{ blocks: true }`). */
export interface OcrBlock {
  paragraphs: Array<{ lines: Array<{ words: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }> }> }>;
}

interface OcrWorker {
  recognize(image: unknown, options: Record<string, unknown>, output: Record<string, boolean>): Promise<{ data: { blocks: OcrBlock[] | null } }>;
  terminate(): Promise<unknown>;
}

/** The slice of the tesseract.js module this uses. */
export interface OcrEngine {
  createWorker(langs: string[], oem: number, options: Record<string, unknown>): Promise<OcrWorker>;
  OEM: { LSTM_ONLY: number };
}

interface Attempt {
  worker: Promise<OcrWorker>;
  /** Terminates the Worker this attempt spawned, whether or not its load ever settled. */
  kill(): void;
}

/** Words in reading order, one `line` number per OCR line across the page; blanks left out. */
export function wordsOf(blocks: readonly OcrBlock[] | null): OcrWord[] {
  const out: OcrWord[] = [];
  let line = 0;
  for (const block of blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const l of para.lines) {
        for (const w of l.words) {
          if (w.text.trim().length === 0) continue;
          out.push({ text: w.text, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1, line, conf: w.confidence });
        }
        line++;
      }
    }
  }
  return out;
}

export interface OcrDeps {
  /** Loads the engine (the lazy `import('tesseract.js')`). */
  load(): Promise<OcrEngine>;
  /** The pixels as an image the engine reads (an OffscreenCanvas in the browser). */
  toImage(rgba: Uint8ClampedArray, width: number, height: number): unknown;
  timeoutMs: number;
}

const silent = (): void => undefined;
const TIMED_OUT = Symbol('timed out');

/** `ProofImageDeps.ocr` over `deps`: one lazily created worker, null (never a throw) on any failure. */
export function createOcr(deps: OcrDeps): (rgba: Uint8ClampedArray, width: number, height: number) => Promise<OcrWord[] | null> {
  let current: Attempt | null = null;

  const start = (): Attempt => {
    let spawned: { terminate(): void } | null = null;
    let killed = false;
    const onSpawn = (w: { terminate(): void }): void => {
      spawned = w;
      if (killed) w.terminate();
    };
    const worker = deps
      .load()
      .then((engine) => engine.createWorker([...PROOF_OCR_LANGS], engine.OEM.LSTM_ONLY, { ...OCR_WORKER_OPTIONS, logger: silent, errorHandler: silent, onSpawn }));
    return {
      worker,
      kill: () => {
        killed = true;
        try {
          (spawned as { terminate(): void } | null)?.terminate();
        } catch {
          // already gone
        }
      },
    };
  };

  /** Drops this attempt and terminates its Worker now, and the tesseract wrapper if it ever turns up. */
  const discard = (a: Attempt): void => {
    if (current === a) current = null;
    a.kill();
    a.worker.then((x) => x.terminate()).catch(silent);
  };

  return async (rgba, width, height) => {
    const a = (current ??= start());
    const w = a.worker;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), deps.timeoutMs);
    });
    try {
      const result = await Promise.race([w.then((x) => x.recognize(deps.toImage(rgba, width, height), {}, { blocks: true, text: false })), deadline]);
      if (result === TIMED_OUT) {
        discard(a);
        return null;
      }
      // Review m-3: no blocks is a result that cannot be read (a changed output), not "nothing found".
      if (!Array.isArray(result.data.blocks)) return null;
      return wordsOf(result.data.blocks);
    } catch {
      discard(a);
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}

/** The pixels on an OffscreenCanvas, which tesseract.js reads as a PNG. */
function canvasOf(rgba: Uint8ClampedArray, width: number, height: number): OffscreenCanvas {
  const c = new OffscreenCanvas(width, height);
  const ctx = c.getContext('2d');
  if (ctx === null) throw new Error('no canvas');
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  return c;
}

/** The browser's OCR: tesseract.js imported on the first proof, as its own chunk. */
export const ocr = createOcr({
  load: async () => {
    const m = (await import('tesseract.js')) as unknown as { default?: OcrEngine } & OcrEngine;
    return m.default ?? m;
  },
  toImage: canvasOf,
  timeoutMs: OCR_TIMEOUT_MS,
});
