// Plan 5 Task 13: the self-hosted OCR behind the proof blur, end to end in Chromium on a
// fixtures-mode build served by the API's own serveWeb (the real page CSP, and the worker CSP on
// /ocr/*). The receipts are real raster images rendered from made-up data
// (e2e/fixtures/proofs/make.ts), with their ground truth.
//
// Proven here: the engine runs in a dedicated worker loaded from /ocr/worker.min.js (never a blob:
// worker); every request, page and worker alike, goes to this origin only; no CSP violation is
// reported; Chromium loads the relaxed-SIMD core; the automatic regions cover every card, IBAN, email
// and phone, and the names after a label, and never the trade amount or code; and a model that is
// blocked, missing or never arrives fails closed (`ocrOk: false`, no regions, no error) within 31 s.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page, type Request } from '@playwright/test';
import type { FastifyInstance } from 'fastify';
import type { ProofLabResult } from '../src/fixtures/index.js';
import type { GroundTruth } from './fixtures/proofs/make.js';
import { startFixtures } from './fixtures-serve.js';

const PORT = 4337;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const PROOFS = fileURLToPath(new URL('./fixtures/proofs/', import.meta.url));
/** Every card, IBAN, email and phone is covered; names after a label in at least 90 % (DETECT_MIN_RECALL_NAMES). */
const ALWAYS: ReadonlySet<string> = new Set(['card', 'iban', 'email', 'phone']);
const DETECT_MIN_RECALL_NAMES = 0.9;

let server: FastifyInstance;
test.beforeAll(async () => {
  test.setTimeout(300_000);
  server = await startFixtures(PORT, 'dist-fixtures-ocr');
});
test.afterAll(async () => {
  await server?.close();
});

interface Watch {
  requests: string[];
  workers: string[];
  violations: string[];
  errors: string[];
}

/** Opens the fixture app and records every request (page and worker), worker, CSP report and page error. */
async function open(page: Page): Promise<Watch> {
  const w: Watch = { requests: [], workers: [], violations: [], errors: [] };
  page.context().on('request', (r: Request) => w.requests.push(r.url()));
  page.on('worker', (wk) => w.workers.push(wk.url()));
  page.on('pageerror', (e) => w.errors.push(String(e)));
  page.on('console', (msg) => {
    if (/Content.Security.Policy|Refused to/i.test(msg.text())) w.violations.push(msg.text());
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => console.error(`Refused to: CSP ${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}`));
  });
  await page.goto(`${ORIGIN}/`);
  await expect(page.locator('html[data-fixture-mode="on"]')).toHaveCount(1);
  return w;
}

async function lab(page: Page, file: string): Promise<{ gt: GroundTruth; out: ProofLabResult }> {
  const gt = JSON.parse(await readFile(join(PROOFS, `${file}.json`), 'utf8')) as GroundTruth;
  const b64 = (await readFile(join(PROOFS, file))).toString('base64');
  const mime = file.endsWith('.jpg') ? 'image/jpeg' : 'image/png';
  const out = await page.evaluate(async ([b, m, k]) => window.__x2fProofLab!(b, m, k), [b64, mime, gt.keep] as const);
  return { gt, out };
}

type B = { x0: number; y0: number; x1: number; y1: number };
/** The glyph band of a laid-out span: its DOM box less the line's leading (20 % top and bottom). */
const band = (b: B): B => {
  const pad = (b.y1 - b.y0) * 0.2;
  return { x0: b.x0 + 1, y0: b.y0 + pad, x1: b.x1 - 1, y1: b.y1 - pad };
};
/** The share of `b`'s area under any of `rs`, counted on a 1-pixel grid. */
function covered(b: B, rs: readonly B[]): number {
  let hit = 0;
  let all = 0;
  for (let y = Math.floor(b.y0); y < Math.ceil(b.y1); y++) {
    for (let x = Math.floor(b.x0); x < Math.ceil(b.x1); x++) {
      all++;
      if (rs.some((r) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1)) hit++;
    }
  }
  return all === 0 ? 1 : hit / all;
}
const touches = (b: B, rs: readonly B[]) => covered(b, rs) > 0;

test.describe('on-device OCR for the proof blur', () => {
  test('the receipts: every card, IBAN, email and phone covered, the amount and code never, all from this origin in a worker', async ({ page }) => {
    test.setTimeout(240_000);
    const w = await open(page);
    const files = JSON.parse(await readFile(join(PROOFS, 'index.json'), 'utf8')) as string[];
    const names: Record<string, { hit: number; all: number }> = {};
    for (const file of files) {
      const { gt, out } = await lab(page, file);
      expect(out.ocrOk, file).toBe(true);
      expect([out.width, out.height], file).toEqual([gt.width, gt.height]);
      for (const mk of gt.marks) {
        const share = covered(band(mk), out.auto);
        if (ALWAYS.has(mk.kind)) expect(share, `${file}: ${mk.kind} "${mk.text}" (words: ${out.words.join(' ')})`).toBeGreaterThanOrEqual(0.98);
        if (mk.kind === 'amount' || mk.kind === 'code') expect(touches(band(mk), out.auto), `${file}: ${mk.kind} "${mk.text}" must stay visible`).toBe(false);
        if (mk.kind === 'name') {
          const n = (names[gt.name] ??= { hit: 0, all: 0 });
          n.all++;
          if (share >= 0.98) n.hit++;
        }
      }
      // Where the amount and the code are is found too (the own-blur warning needs them).
      expect(out.amount.length, `${file}: amount found`).toBeGreaterThan(0);
      expect(out.memo.length, `${file}: code found`).toBeGreaterThan(0);
    }
    const labelled = names.labelled!;
    expect(labelled.hit / labelled.all).toBeGreaterThanOrEqual(DETECT_MIN_RECALL_NAMES);
    // Names that follow no label (Zelle, Cash App, Wise style; an avatar caption) are measured, not
    // promised: the number goes to docs/security/plan-5-review.md (review 2026-10-24).
    for (const [layout, n] of Object.entries(names)) test.info().annotations.push({ type: 'name-recall', description: `${layout}: ${n.hit}/${n.all}` });

    // One dedicated worker, from this origin's /ocr/, never a blob: worker.
    expect(w.workers).toEqual([`${ORIGIN}/ocr/worker.min.js`]);
    // Every request, page and worker alike, to this origin only.
    expect(w.requests.filter((u) => !u.startsWith(`${ORIGIN}/`) && !u.startsWith('data:'))).toEqual([]);
    // Chromium supports relaxed SIMD: exactly that core, plus the worker and the model, each once.
    const ocr = w.requests.filter((u) => u.startsWith(`${ORIGIN}/ocr/`)).map((u) => u.slice(ORIGIN.length)).sort();
    expect(ocr).toEqual(['/ocr/eng.traineddata.gz', '/ocr/tesseract-core-relaxedsimd-lstm.wasm.js', '/ocr/worker.min.js']);
    expect(w.violations).toEqual([]);
    expect(w.errors).toEqual([]);
  });

  test('every /ocr/ file is served with the worker CSP', async ({ request }) => {
    for (const f of ['worker.min.js', 'tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js', 'eng.traineddata.gz']) {
      const res = await request.get(`${ORIGIN}/ocr/${f}`);
      expect(res.status(), f).toBe(200);
      expect(res.headers()['content-security-policy'], f).toBe("default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'");
    }
  });

  for (const [what, how] of [
    ['the model is blocked', 'abort'],
    ['the relaxed-SIMD core is missing (a wrong asset list)', '404-core'],
  ] as const) {
    test(`${what}: "couldn't check automatically" (ocrOk false, no regions, no error)`, async ({ page }) => {
      test.setTimeout(120_000);
      if (how === 'abort') await page.route('**/ocr/eng.traineddata.gz', (r) => r.abort());
      else await page.route('**/ocr/tesseract-core-relaxedsimd-lstm.wasm.js', (r) => r.fulfill({ status: 404, body: 'not found' }));
      const w = await open(page);
      const { out } = await lab(page, 'bank-labelled.png');
      expect(out).toMatchObject({ ocrOk: false, auto: [], amount: [], memo: [], words: [] });
      expect(out.ms).toBeLessThan(31_000);
      expect(w.errors).toEqual([]);
      expect(w.requests.filter((u) => !u.startsWith(`${ORIGIN}/`) && !u.startsWith('data:'))).toEqual([]);
    });
  }

  test('a model that never arrives: gives up at the 30-second timeout, no regions, no error', async ({ page }) => {
    test.setTimeout(120_000);
    await page.route('**/ocr/eng.traineddata.gz', () => undefined);
    const w = await open(page);
    const { out } = await lab(page, 'bank-labelled.png');
    expect(out).toMatchObject({ ocrOk: false, auto: [] });
    expect(out.ms).toBeGreaterThanOrEqual(29_000);
    expect(out.ms).toBeLessThan(31_000);
    expect(w.errors).toEqual([]);
  });
});
