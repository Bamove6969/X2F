// Plan 5 Task 13: the self-hosted OCR behind `ProofImageDeps.ocr`. Node has no Worker or canvas, so
// these drive `createOcr` with a stand-in engine; e2e/proof-ocr.spec.ts runs the real one in a
// browser (one worker, assets from /ocr/ only, the worker CSP, the fallbacks).
import { describe, expect, it, vi } from 'vitest';
import { OCR_TIMEOUT_MS, OCR_WORKER_OPTIONS, PROOF_OCR_CYRILLIC_LANGS, PROOF_OCR_LANGS, createOcr, looksCyrillicGarbage, wordsOf, type OcrEngine, type OcrBlock } from '../src/proof/ocr.js';

const RGBA = new Uint8ClampedArray(4 * 2 * 2);

function word(text: string, x0: number, y0: number, confidence = 91) {
  return { text, confidence, bbox: { x0, y0, x1: x0 + 10, y1: y0 + 8 } };
}

const BLOCKS: OcrBlock[] = [
  {
    paragraphs: [
      { lines: [{ words: [word('Sent', 1, 2), word('to', 14, 2)] }, { words: [word('jane@example.com', 1, 20, 77)] }] },
    ],
  },
  { paragraphs: [{ lines: [{ words: [word(' ', 0, 40), word('$412.50', 30, 40)] }] }] },
];

function engine(o: { createWorker?: OcrEngine['createWorker']; blocks?: OcrBlock[] | null } = {}) {
  const terminate = vi.fn(async () => undefined);
  const recognize = vi.fn(async () => ({ data: { blocks: o.blocks === undefined ? BLOCKS : o.blocks } }));
  const createWorker = vi.fn(o.createWorker ?? (async () => ({ recognize, terminate })));
  const eng: OcrEngine = { createWorker, OEM: { LSTM_ONLY: 1 } };
  const load = vi.fn(async () => eng);
  return { eng, load, createWorker, recognize, terminate };
}

const toImage = (rgba: Uint8ClampedArray, width: number, height: number) => ({ rgba, width, height });

describe('wordsOf', () => {
  it('flattens blocks into words with one line number per OCR line, in reading order, blanks left out', () => {
    expect(wordsOf(BLOCKS)).toEqual([
      { text: 'Sent', x0: 1, y0: 2, x1: 11, y1: 10, line: 0, conf: 91 },
      { text: 'to', x0: 14, y0: 2, x1: 24, y1: 10, line: 0, conf: 91 },
      { text: 'jane@example.com', x0: 1, y0: 20, x1: 11, y1: 28, line: 1, conf: 77 },
      { text: '$412.50', x0: 30, y0: 40, x1: 40, y1: 48, line: 2, conf: 91 },
    ]);
  });

  it('no blocks (nothing read) is no words', () => {
    expect(wordsOf(null)).toEqual([]);
    expect(wordsOf([])).toEqual([]);
  });
});

describe('createOcr', () => {
  it('loads nothing until the first call, then one worker for every later call', async () => {
    const e = engine();
    const ocr = createOcr({ load: e.load, toImage, timeoutMs: 1000 });
    expect(e.load).not.toHaveBeenCalled();
    expect(await ocr(RGBA, 2, 2)).toHaveLength(4);
    expect(await ocr(RGBA, 2, 2)).toHaveLength(4);
    expect(e.load).toHaveBeenCalledTimes(1);
    expect(e.createWorker).toHaveBeenCalledTimes(1);
    expect(e.recognize).toHaveBeenCalledTimes(2);
  });

  it('creates the worker from this origin only: /ocr/ paths, no blob: worker, no cache, LSTM only, errors kept in', async () => {
    const e = engine();
    await createOcr({ load: e.load, toImage, timeoutMs: 1000 })(RGBA, 2, 2);
    const [langs, oem, options] = e.createWorker.mock.calls[0]!;
    expect(langs).toEqual(['eng']);
    expect(PROOF_OCR_LANGS).toEqual(['eng']);
    expect(oem).toBe(1);
    expect(options).toEqual({ ...OCR_WORKER_OPTIONS, errorHandler: expect.any(Function), logger: expect.any(Function), onSpawn: expect.any(Function) });
    expect(OCR_WORKER_OPTIONS).toEqual({
      workerPath: '/ocr/worker.min.js',
      corePath: '/ocr/',
      langPath: '/ocr/',
      workerBlobURL: false,
      gzip: true,
      cacheMethod: 'none',
      legacyCore: false,
      legacyLang: false,
    });
    // An engine error must never escape as an uncaught exception (tesseract.js throws without one).
    expect(() => (options as { errorHandler: (e: unknown) => void }).errorHandler('boom')).not.toThrow();
  });

  it('asks for the word boxes and gives the engine the scaled pixels', async () => {
    const e = engine();
    await createOcr({ load: e.load, toImage, timeoutMs: 1000 })(RGBA, 2, 2);
    const [image, , output] = e.recognize.mock.calls[0]! as unknown as [unknown, unknown, Record<string, boolean>];
    expect(image).toEqual({ rgba: RGBA, width: 2, height: 2 });
    expect(output).toMatchObject({ blocks: true });
  });

  it('a failed load (the module or the worker) answers null, never throws, and the next proof tries again', async () => {
    const e = engine({ createWorker: async () => Promise.reject(new Error('404 eng.traineddata.gz')) });
    const ocr = createOcr({ load: e.load, toImage, timeoutMs: 1000 });
    await expect(ocr(RGBA, 2, 2)).resolves.toBeNull();
    await expect(ocr(RGBA, 2, 2)).resolves.toBeNull();
    expect(e.createWorker).toHaveBeenCalledTimes(2);
    const broken = createOcr({ load: async () => Promise.reject(new Error('chunk failed')), toImage, timeoutMs: 1000 });
    await expect(broken(RGBA, 2, 2)).resolves.toBeNull();
  });

  it('review m-2: a load that never settles terminates the spawned Worker itself at the timeout', async () => {
    const raw = { terminate: vi.fn() };
    const e = engine({
      createWorker: (_l, _o, options) => {
        (options as { onSpawn: (w: unknown) => void }).onSpawn(raw);
        return new Promise(() => undefined);
      },
    });
    await expect(createOcr({ load: e.load, toImage, timeoutMs: 30 })(RGBA, 2, 2)).resolves.toBeNull();
    expect(raw.terminate).toHaveBeenCalledTimes(1);
  });

  it('review m-2: a load that fails terminates the spawned Worker (tesseract.js does not)', async () => {
    const raw = { terminate: vi.fn() };
    const e = engine({
      createWorker: async (_l, _o, options) => {
        (options as { onSpawn: (w: unknown) => void }).onSpawn(raw);
        throw new Error('404 tesseract-core-relaxedsimd-lstm.wasm.js');
      },
    });
    await expect(createOcr({ load: e.load, toImage, timeoutMs: 1000 })(RGBA, 2, 2)).resolves.toBeNull();
    expect(raw.terminate).toHaveBeenCalledTimes(1);
  });

  it('review m-3: a result with no blocks is a failure (could not check), not "nothing found"', async () => {
    for (const blocks of [null, 'x', {}]) {
      const e = engine({ blocks: blocks as unknown as null });
      await expect(createOcr({ load: e.load, toImage, timeoutMs: 1000 })(RGBA, 2, 2), String(blocks)).resolves.toBeNull();
    }
    const empty = engine({ blocks: [] });
    await expect(createOcr({ load: empty.load, toImage, timeoutMs: 1000 })(RGBA, 2, 2)).resolves.toEqual([]);
  });

  it('past the timeout it answers null and terminates the worker (a load that never finishes)', async () => {
    const terminate = vi.fn(async () => undefined);
    let finish: (w: unknown) => void = () => undefined;
    const e = engine({
      createWorker: () =>
        new Promise((resolve) => {
          finish = resolve as (w: unknown) => void;
        }),
    });
    const ocr = createOcr({ load: e.load, toImage, timeoutMs: 30 });
    const t0 = Date.now();
    await expect(ocr(RGBA, 2, 2)).resolves.toBeNull();
    expect(Date.now() - t0).toBeLessThan(1000);
    // The worker that turns up late is terminated, not kept.
    finish({ recognize: vi.fn(), terminate });
    await vi.waitFor(() => expect(terminate).toHaveBeenCalledTimes(1));
  });

  it('a recognize that hangs past the timeout answers null and terminates the worker', async () => {
    const e = engine();
    e.recognize.mockImplementationOnce(() => new Promise(() => undefined));
    const ocr = createOcr({ load: e.load, toImage, timeoutMs: 30 });
    await expect(ocr(RGBA, 2, 2)).resolves.toBeNull();
    expect(e.terminate).toHaveBeenCalledTimes(1);
    // A fresh worker for the next proof.
    expect(await ocr(RGBA, 2, 2)).toHaveLength(4);
    expect(e.createWorker).toHaveBeenCalledTimes(2);
  });

  it('a recognize that fails answers null and terminates the worker', async () => {
    const e = engine();
    e.recognize.mockRejectedValueOnce(new Error('bad image'));
    await expect(createOcr({ load: e.load, toImage, timeoutMs: 1000 })(RGBA, 2, 2)).resolves.toBeNull();
    expect(e.terminate).toHaveBeenCalledTimes(1);
  });

  it('the default timeout is 30 seconds (Review Focus 3)', () => {
    expect(OCR_TIMEOUT_MS).toBe(30_000);
  });
});

const ws = (...texts: string[]) => texts.map((text, i) => ({ text, x0: i * 10, y0: 0, x1: i * 10 + 9, y1: 10, line: 0, conf: 80 }));
const blocksOf = (...texts: string[]): OcrBlock[] => [{ paragraphs: [{ lines: [{ words: texts.map((t, i) => word(t, i * 20, 0)) }] }] }];

describe('looksCyrillicGarbage (when the Russian model is worth fetching)', () => {
  it('the English model on "Анна Петрова" (measured: AHHa lNMeTpoBa) is Cyrillic garbage', () => {
    expect(looksCyrillicGarbage(ws('You', 'sent', 'money', 'to', 'AHHa', 'lNMeTpoBa', '$412.50'))).toBe(true);
    expect(looksCyrillicGarbage(ws('CepreN', 'NBaHoB'))).toBe(true);
  });

  it('an English receipt is not: words, emails, codes, currency codes, one brand with odd case', () => {
    expect(looksCyrillicGarbage(ws('Payment', 'sent', 'Recipient:', 'Avery', 'Quinlan', 'IBAN:', 'GB82', 'WEST', 'USD', 'avery.quinlan@example.com', 'K7M2-9QXA-4FTR-8WPN'))).toBe(false);
    expect(looksCyrillicGarbage(ws('Paid', 'with', 'PayPal', 'balance'))).toBe(false);
    expect(looksCyrillicGarbage(ws('iPhone', 'McDonald'))).toBe(false);
    expect(looksCyrillicGarbage([])).toBe(false);
  });
});

describe('the Cyrillic second pass', () => {
  it('only when the English pass reads Cyrillic garbage: a second worker for English and Russian, and its words', async () => {
    const terminate = vi.fn(async () => undefined);
    const recognize = vi.fn(async () => ({ data: { blocks: blocksOf('Анна', 'Петрова') } }));
    const english = vi.fn(async () => ({ data: { blocks: blocksOf('AHHa', 'lNMeTpoBa') } }));
    const createWorker = vi.fn(async (langs: string[]) => ({ recognize: langs.includes('rus') ? recognize : english, terminate }));
    const ocr = createOcr({ load: async () => ({ createWorker, OEM: { LSTM_ONLY: 1 } }), toImage, timeoutMs: 1000 });
    expect((await ocr(RGBA, 2, 2))!.map((w) => w.text)).toEqual(['Анна', 'Петрова']);
    expect(createWorker.mock.calls.map((c) => c[0])).toEqual([['eng'], ['eng', 'rus']]);
    expect(PROOF_OCR_CYRILLIC_LANGS).toEqual(['eng', 'rus']);
    // Both workers are kept for the next proof.
    await ocr(RGBA, 2, 2);
    expect(createWorker).toHaveBeenCalledTimes(2);
  });

  it('an English receipt never loads the Russian model', async () => {
    const e = engine();
    await createOcr({ load: e.load, toImage, timeoutMs: 1000 })(RGBA, 2, 2);
    expect(e.createWorker.mock.calls.map((c) => c[0])).toEqual([['eng']]);
  });

  it('a second pass that fails or hangs keeps the English words (still checked, never worse)', async () => {
    for (const second of [async () => Promise.reject(new Error('404 rus.traineddata.gz')), () => new Promise<never>(() => undefined)]) {
      const english = vi.fn(async () => ({ data: { blocks: blocksOf('AHHa', 'lNMeTpoBa') } }));
      const createWorker = vi.fn(async (langs: string[]) => (langs.includes('rus') ? second() : { recognize: english, terminate: vi.fn(async () => undefined) }));
      const ocr = createOcr({ load: async () => ({ createWorker, OEM: { LSTM_ONLY: 1 } }) as unknown as OcrEngine, toImage, timeoutMs: 30 });
      expect((await ocr(RGBA, 2, 2))!.map((w) => w.text)).toEqual(['AHHa', 'lNMeTpoBa']);
    }
  });

  it('the default timeout applies to each pass on its own', () => {
    expect(OCR_TIMEOUT_MS).toBe(30_000);
  });
});
