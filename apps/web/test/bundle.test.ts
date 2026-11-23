import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { ESCROW_WORKER_FILE } from '../../api/src/static/serve.js';
import { ESCROW_WORKER_FILE_NAMES } from '../vite.config.js';

const run = promisify(execFile);
const WEB = fileURLToPath(new URL('..', import.meta.url));
const VITE = join(WEB, 'node_modules', 'vite', 'bin', 'vite.js');
const FORBIDDEN = ['satoshi_ghost', 'mira.k', 'fixture'];

/**
 * The one deliberate exception: the first-trade tour's pretend trade is with satoshi_ghost, the
 * design's example trader (design 12 Nov, docs/design-12nov/tour-stops.md and the intro prototype),
 * drawn by src/tour/FirstTradeStage.tsx without any fixture. The bundle may carry exactly that
 * file's code occurrences of the name, and not one more: fixture data still trips the check.
 */
const TOUR_STAGE = join(WEB, 'src', 'tour', 'FirstTradeStage.tsx');
async function tourOccurrences(word: string): Promise<number> {
  const code = (await readFile(TOUR_STAGE, 'utf8'))
    .split('\n')
    .filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l))
    .join('\n')
    .toLowerCase();
  return code.split(word).length - 1;
}

async function expectNoFixtureData(text: string): Promise<void> {
  for (const word of FORBIDDEN) expect(text.split(word).length - 1, word).toBe(await tourOccurrences(word));
}
const dirs: string[] = [];

async function build(mode: string): Promise<string> {
  const out = await mkdtemp(join(tmpdir(), 'x2f-web-build-'));
  dirs.push(out);
  // VITE_FIXTURES=1 is set on purpose: a production build must leave fixture mode out anyway.
  await run(process.execPath, [VITE, 'build', '--mode', mode, '--outDir', out, '--emptyOutDir', '--logLevel', 'error'], {
    cwd: WEB,
    env: { ...process.env, VITE_FIXTURES: '1' },
    timeout: 180_000,
  });
  return out;
}

/**
 * Our own output: index.html and everything vite built. The copied OCR files (dist/ocr/, Plan 5 Task
 * 13) and monero-ts's wallet worker (dist/monero/) are third-party code checked byte for byte against
 * tools/ocr-assets.sha256 and tools/monero-worker.sha256 instead.
 */
async function bundleText(dir: string): Promise<string> {
  const files = await readdir(dir, { recursive: true, withFileTypes: true });
  const parts = await Promise.all(
    files
      .filter((f) => f.isFile() && /\.(js|css|html)$/.test(f.name) && f.parentPath !== join(dir, 'ocr') && f.parentPath !== join(dir, 'monero'))
      .map((f) => readFile(join(f.parentPath, f.name), 'utf8')),
  );
  return parts.join('\n');
}

afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

describe('production bundle', () => {
  it('contains no fixture data, even with VITE_FIXTURES=1', { timeout: 200_000 }, async () => {
    const text = (await bundleText(await build('production'))).toLowerCase();
    await expectNoFixtureData(text);
  });

  it('a staging (or any other non-fixtures) build mode leaves fixture mode out too', { timeout: 200_000 }, async () => {
    const text = (await bundleText(await build('staging'))).toLowerCase();
    await expectNoFixtureData(text);
  });

  it('a fixtures-mode build does include fixture mode (the check bites)', { timeout: 200_000 }, async () => {
    const text = (await bundleText(await build('fixtures'))).toLowerCase();
    expect(text).toContain('fixture');
  });

  // Plan 5 Task 13: the OCR engine is loaded on demand and its files are served, never bundled.
  it('tesseract.js is a lazily loaded chunk: not in the entry script, not preloaded, but present', { timeout: 200_000 }, async () => {
    const dir = await build('production');
    const html = await readFile(join(dir, 'index.html'), 'utf8');
    const entry = /<script[^>]*\bsrc="\/(assets\/[^"]+\.js)"/.exec(html)?.[1];
    expect(entry).toBeDefined();
    const preloaded = [...html.matchAll(/rel="modulepreload"[^>]*href="\/(assets\/[^"]+)"/g)].map((m) => m[1]!);
    const chunks = (await readdir(join(dir, 'assets'))).filter((f) => f.endsWith('.js'));
    const withEngine: string[] = [];
    for (const f of chunks) if ((await readFile(join(dir, 'assets', f), 'utf8')).includes('Legacy model requested but code missing')) withEngine.push(`assets/${f}`);
    expect(withEngine.length, 'some chunk carries the engine').toBeGreaterThan(0);
    for (const c of withEngine) {
      expect(c).not.toBe(entry);
      expect(preloaded).not.toContain(c);
    }
    // Neither proof/ocr.ts nor the engine is in the entry: both are loaded with the first proof.
    const entryText = await readFile(join(dir, entry!), 'utf8');
    for (const internal of ['createWorker', 'Legacy model requested', 'regeneratorRuntime', 'wasm-feature-detect', '/ocr/worker.min.js']) expect(entryText, internal).not.toContain(internal);
  });

  it('no CDN default reaches the bundle; the OCR core and model are served from /ocr/, never bundled', { timeout: 200_000 }, async () => {
    const dir = await build('production');
    const text = await bundleText(dir);
    expect(text).not.toMatch(/jsdelivr|unpkg\.com/);
    expect((await readdir(join(dir, 'assets'))).filter((f) => /traineddata|tesseract-core|worker\.min/.test(f))).toEqual([]);
    expect((await readdir(join(dir, 'ocr'))).sort()).toEqual(
      ['eng.traineddata.gz', 'rus.traineddata.gz', 'tesseract-core-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'worker.min.js'],
    );
  });

  // Gap 1 (the regtest e2e, demo 8 Nov): monero-ts runs every wallet in its own worker, which the
  // production build never served, so no escrow wallet could start in a real browser.
  it("serves monero-ts's own wallet worker at /monero/monero.worker.js, byte for byte the pinned build, never re-bundled", { timeout: 200_000 }, async () => {
    const dir = await build('production');
    expect(await readdir(join(dir, 'monero'))).toEqual(['monero.worker.js']);
    const pinned = (await readFile(fileURLToPath(new URL('../../../tools/monero-worker.sha256', import.meta.url)), 'utf8'))
      .split('\n').map((l) => /^([0-9a-f]{64}) {2}monero\.worker\.js$/.exec(l.trim())?.[1]).find((h) => h !== undefined);
    expect(pinned).toBe('2e53c27e4518c5e59ae9f6378550cd00c68bb0221d8ee751bd0a12cc39263c3e');
    expect(createHash('sha256').update(await readFile(join(dir, 'monero', 'monero.worker.js'))).digest('hex')).toBe(pinned);
    // Not a second, re-bundled copy under assets/, and our own code points monero-ts at the served file.
    const assets = await readdir(join(dir, 'assets'));
    expect(assets.filter((f) => /monero\.worker/.test(f))).toEqual([]);
    const escrowWorker = assets.filter((f) => ESCROW_WORKER_FILE.test(`/assets/${f}`));
    expect(escrowWorker).toHaveLength(1);
    const workerText = await readFile(join(dir, 'assets', escrowWorker[0]!), 'utf8');
    expect(/["'`]\/monero\/monero\.worker\.js["'`]/.test(workerText), 'the escrow worker names /monero/monero.worker.js').toBe(true);
  });

  // Lead call 20 Nov: the API gives the escrow worker its CSP by file name (serve.ts ESCROW_WORKER_FILE),
  // so the build must emit it under exactly that name, and build no other bundled worker.
  it('emits the escrow worker as exactly assets/escrow-worker-<8-character hash>.js, the only worker the app bundles', { timeout: 200_000 }, async () => {
    expect(ESCROW_WORKER_FILE_NAMES).toBe('assets/escrow-worker-[hash:8].js');
    const dir = await build('production');
    const assets = await readdir(join(dir, 'assets'));
    const workers = assets.filter((f) => ESCROW_WORKER_FILE.test(`/assets/${f}`));
    expect(workers).toHaveLength(1);
    expect(workers[0]).toMatch(/^escrow-worker-[A-Za-z0-9_-]{8}\.js$/);
    expect(assets.filter((f) => /worker/.test(f) && f !== workers[0])).toEqual([]);
    // Every bundled worker the app starts (Vite's `new Worker(new URL(...))`) is that file, and its
    // source is src/escrow/worker.ts (it serves the escrow, the chat and the chat keys).
    const started: string[] = [];
    for (const f of assets.filter((x) => x.endsWith('.js') && x !== workers[0])) {
      for (const m of (await readFile(join(dir, 'assets', f), 'utf8')).matchAll(/new Worker\(new URL\(["'`]([^"'`]+)["'`]/g)) started.push(m[1]!);
    }
    expect(started).toEqual([`/assets/${workers[0]}`]);
    const text = await readFile(join(dir, 'assets', workers[0]!), 'utf8');
    expect(text).toContain('escrow worker: bad VITE_MONERO_NETWORK');
  });

  it('inlines nothing the CSP would block: no inline scripts or styles, no data: fonts', { timeout: 200_000 }, async () => {
    const dir = await build('production');
    const html = await readFile(join(dir, 'index.html'), 'utf8');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(html).not.toMatch(/<style|\sstyle=/);
    expect(await bundleText(dir)).not.toMatch(/url\(\s*["']?data:font|data:font\/woff/);
  });
});
