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
import { expect, test, type Page, type Request, type Route } from '@playwright/test';
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
    test.setTimeout(400_000);
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
      // Where the amount and the code are is found too (the own-blur warning needs them), whenever the
      // OCR read them; a line the OCR missed cannot be covered either, and is recorded.
      const read = out.words.join(' ');
      if (read.includes('412.50')) expect(out.amount.length, `${file}: amount found`).toBeGreaterThan(0);
      else test.info().annotations.push({ type: 'ocr-missed', description: `${file}: the amount` });
      if (read.includes(gt.keep.tradeCode)) expect(out.memo.length, `${file}: code found`).toBeGreaterThan(0);
      else test.info().annotations.push({ type: 'ocr-missed', description: `${file}: the code` });
    }
    // Every measured number goes to docs/security/plan-5-review.md (review 2026-10-24).
    for (const [layout, n] of Object.entries(names)) test.info().annotations.push({ type: 'name-recall', description: `${layout}: ${n.hit}/${n.all}` });
    const labelled = names.labelled!;
    expect(labelled.hit / labelled.all, 'names after a label').toBeGreaterThanOrEqual(DETECT_MIN_RECALL_NAMES);
    // Lead 2026-11-12 (second call): the Cyrillic name is covered too, through the Russian second pass.
    expect(names['top-name-non-latin'], 'the Cyrillic name').toEqual({ hit: 1, all: 1 });
    // Lead 2026-11-12: names with no label (a big line at the top, an avatar caption) in Latin script
    // are held to the same recall. A non-Latin name is measured, not promised (the model is English).
    const unlabelled = { hit: 0, all: 0 };
    for (const layout of ['top-name', 'avatar-caption']) {
      unlabelled.hit += names[layout]?.hit ?? 0;
      unlabelled.all += names[layout]?.all ?? 0;
    }
    expect(unlabelled.all).toBeGreaterThanOrEqual(5);
    expect(unlabelled.hit / unlabelled.all, 'names with no label (Latin script)').toBeGreaterThanOrEqual(DETECT_MIN_RECALL_NAMES);

    // Dedicated workers from this origin's /ocr/ only, never a blob: worker.
    // Every request, page and worker alike, to this origin only.
    expect(w.requests.filter((u) => !u.startsWith(`${ORIGIN}/`) && !u.startsWith('data:'))).toEqual([]);
    // Chromium supports relaxed SIMD: exactly that core, plus the worker and the model, each once.
    const ocr = w.requests.filter((u) => u.startsWith(`${ORIGIN}/ocr/`)).map((u) => u.slice(ORIGIN.length)).sort();
    // The Cyrillic receipt brings a second worker (English and Russian): its core and the English model
    // come again from the HTTP cache or the network, the Russian model once, for that receipt only.
    expect([...new Set(ocr)]).toEqual(['/ocr/eng.traineddata.gz', '/ocr/rus.traineddata.gz', '/ocr/tesseract-core-relaxedsimd-lstm.wasm.js', '/ocr/worker.min.js']);
    expect(ocr.filter((u) => u === '/ocr/rus.traineddata.gz')).toHaveLength(1);
    expect(w.workers).toEqual([`${ORIGIN}/ocr/worker.min.js`, `${ORIGIN}/ocr/worker.min.js`]);
    expect(w.violations).toEqual([]);
    expect(w.errors).toEqual([]);
  });

  test('every /ocr/ file is served with the worker CSP', async ({ request }) => {
    for (const f of ['worker.min.js', 'tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js', 'eng.traineddata.gz', 'rus.traineddata.gz']) {
      const res = await request.get(`${ORIGIN}/ocr/${f}`);
      expect(res.status(), f).toBe(200);
      // Lead call 20 Nov and review M-1: scripts and fetches only under this origin's /ocr/, no nested worker.
      expect(res.headers()['content-security-policy'], f).toBe(`default-src 'none'; script-src ${ORIGIN}/ocr/ 'wasm-unsafe-eval'; connect-src ${ORIGIN}/ocr/; worker-src 'none'`);
    }
  });

  // Lead call 20 Nov and review M-1, m-3 (wip/lead-p5t13-16-ocr): a worker under /ocr/ may load scripts
  // and fetch only under this origin's /ocr/, and start no worker, so one taken over through the OCR
  // engine sends nothing to the API with the trader's cookies. A probe script is served at
  // /ocr/probe.js with the headers the server sends for a real /ocr/ file (its own CSP) and, from inside
  // the worker, tries every way out: fetch, XHR, WebSocket, EventSource, importScripts and a nested
  // Worker, each at its own /v1/probe-<way> path. The control serves the same probe under the old
  // policy ('self' everywhere, no worker-src), so the test shows it can tell the two apart.
  const WAYS = ['fetch', 'xhr', 'ws', 'es', 'import', 'worker'] as const;
  const PROBE = `
    const seen = [];
    self.addEventListener('securitypolicyviolation', (e) => seen.push(e.violatedDirective + ' ' + e.blockedURI));
    const out = {};
    const wsBase = location.origin.replace(/^http/, 'ws');
    const tries = {
      fetch: () => fetch('/v1/probe-fetch', { credentials: 'same-origin' }).then((r) => 'reached ' + r.status, () => 'blocked'),
      xhr: () => new Promise((res) => { const x = new XMLHttpRequest(); x.onload = () => res('reached ' + x.status); x.onerror = () => res('blocked'); try { x.open('GET', '/v1/probe-xhr'); x.send(); } catch { res('blocked'); } }),
      ws: () => new Promise((res) => { try { const s = new WebSocket(wsBase + '/v1/probe-ws'); s.onopen = () => res('reached'); s.onerror = () => res('error'); } catch { res('blocked'); } }),
      es: () => new Promise((res) => { try { const s = new EventSource('/v1/probe-es'); s.onopen = () => res('reached'); s.onerror = () => { s.close(); res('error'); }; } catch { res('blocked'); } }),
      import: () => { try { importScripts('/v1/probe-import'); return 'reached'; } catch (e) { return 'threw ' + e.name; } },
      worker: () => new Promise((res) => { try { const w = new Worker('/v1/probe-worker'); w.onerror = () => res('error'); setTimeout(() => res('constructed'), 300); } catch (e) { res('threw ' + e.name); } }),
    };
    self.onmessage = async () => {
      out.ocr = await fetch('/ocr/eng.traineddata.gz').then((r) => 'reached ' + r.status, () => 'blocked');
      try { importScripts('/ocr/probe-lib.js'); out.ocrImport = self.probeLib === 1 ? 'ran' : 'not run'; } catch (e) { out.ocrImport = 'threw ' + e.name; }
      out.other = await fetch('/ocrx/eng.traineddata.gz').then((r) => 'reached ' + r.status, () => 'blocked');
      for (const k of Object.keys(tries)) out[k] = await tries[k]();
      await new Promise((r) => setTimeout(r, 300));
      postMessage({ out, seen });
    };`;
  for (const [what, csp] of [
    ['the served worker CSP', null],
    ["control: the old policy, 'self' everywhere", "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'"],
  ] as const) {
    test(`inside an /ocr/ worker (${what}): ${csp === null ? 'only /ocr/ is reached; fetch, XHR, WebSocket, EventSource, importScripts and a nested Worker to /v1/ are all blocked' : 'fetch, XHR, EventSource and importScripts reach /v1/, and a nested Worker is made'}`, async ({ page }) => {
      const asIfOcr = async (route: Route, body: string) => {
        const real = await route.fetch({ url: `${ORIGIN}/ocr/worker.min.js` });
        const headers = { ...real.headers() };
        delete headers['content-length'];
        delete headers['etag'];
        if (csp !== null) headers['content-security-policy'] = csp;
        await route.fulfill({ status: 200, headers: { ...headers, 'content-type': 'text/javascript; charset=utf-8' }, body });
      };
      await page.route('**/ocr/probe.js', (r) => asIfOcr(r, PROBE));
      await page.route('**/ocr/probe-lib.js', (r) => asIfOcr(r, 'self.probeLib = 1;'));
      // Reached the server: a request that got an answer. (Playwright reports a request the CSP
      // blocks as started and then failed, for XHR and EventSource; it never finishes.)
      const reached: string[] = [];
      page.context().on('requestfinished', (r) => {
        const m = /\/v1\/probe-([a-z]+)/.exec(r.url());
        if (m) reached.push(m[1]!);
      });
      const sockets: string[] = [];
      page.on('websocket', (ws) => sockets.push(ws.url()));
      await open(page);
      const { out, seen } = await page.evaluate(
        () =>
          new Promise<{ out: Record<string, string>; seen: string[] }>((resolve, reject) => {
            const w = new Worker('/ocr/probe.js');
            w.onmessage = (e) => resolve(e.data);
            w.onerror = (e) => reject(new Error(String(e.message)));
            w.postMessage('go');
          }),
      );
      // Allowed either way: a fetch and a script under /ocr/.
      expect(out.ocr).toBe('reached 200');
      expect(out.ocrImport).toBe('ran');
      if (csp === null) {
        expect(out.other, 'a sibling path').toBe('blocked');
        // Nothing reached the network, and each way was reported as a CSP violation of its own.
        expect(reached).toEqual([]);
        expect(sockets).toEqual([]);
        for (const way of WAYS) expect(seen.some((v) => v.includes(`/v1/probe-${way}`)), `${way}: ${JSON.stringify(out)} ${JSON.stringify(seen)}`).toBe(true);
        expect(out.fetch).toBe('blocked');
        expect(out.xhr).toBe('blocked');
        expect(out.import).toMatch(/^threw /);
        expect(seen.find((v) => v.includes('/v1/probe-import'))).toMatch(/^script-src/);
        expect(seen.find((v) => v.includes('/v1/probe-worker'))).toMatch(/^worker-src/);
      } else {
        // Review M-1's finding, reproduced: under the old policy these go out with the cookies.
        expect(reached).toEqual(expect.arrayContaining(['fetch', 'xhr', 'es', 'import']));
        // The nested Worker is made and asked for (Playwright does not report a worker's own worker's
        // request): no violation, no throw.
        expect(out.worker).not.toMatch(/^threw /);
        expect(seen.filter((v) => v.includes('/v1/probe-'))).toEqual([]);
      }
    });
  }

  test('Latin-script receipts never fetch the Russian model, and one worker does', async ({ page }) => {
    test.setTimeout(240_000);
    const w = await open(page);
    for (const file of ['bank-labelled.png', 'top-name.png', 'wise-style.jpg']) expect((await lab(page, file)).out.ocrOk, file).toBe(true);
    expect(w.requests.filter((u) => u.endsWith('/ocr/rus.traineddata.gz'))).toEqual([]);
    expect(w.workers).toEqual([`${ORIGIN}/ocr/worker.min.js`]);
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
