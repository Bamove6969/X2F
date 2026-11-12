import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const WEB = fileURLToPath(new URL('..', import.meta.url));
const VITE = join(WEB, 'node_modules', 'vite', 'bin', 'vite.js');
const FORBIDDEN = ['satoshi_ghost', 'mira.k', 'fixture'];
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
 * 13) are third-party code checked byte for byte against tools/ocr-assets.sha256 instead.
 */
async function bundleText(dir: string): Promise<string> {
  const files = await readdir(dir, { recursive: true, withFileTypes: true });
  const parts = await Promise.all(
    files
      .filter((f) => f.isFile() && /\.(js|css|html)$/.test(f.name) && f.parentPath !== join(dir, 'ocr'))
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
    for (const word of FORBIDDEN) expect(text, word).not.toContain(word);
  });

  it('a staging (or any other non-fixtures) build mode leaves fixture mode out too', { timeout: 200_000 }, async () => {
    const text = (await bundleText(await build('staging'))).toLowerCase();
    for (const word of FORBIDDEN) expect(text, word).not.toContain(word);
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
    for (const internal of ['Legacy model requested', 'regeneratorRuntime', 'wasm-feature-detect', '/ocr/worker.min.js']) expect(entryText, internal).not.toContain(internal);
  });

  it('no CDN default reaches the bundle; the OCR core and model are served from /ocr/, never bundled', { timeout: 200_000 }, async () => {
    const dir = await build('production');
    const text = await bundleText(dir);
    expect(text).not.toMatch(/jsdelivr|unpkg\.com/);
    expect((await readdir(join(dir, 'assets'))).filter((f) => /traineddata|tesseract-core|worker\.min/.test(f))).toEqual([]);
    expect((await readdir(join(dir, 'ocr'))).sort()).toEqual(
      ['eng.traineddata.gz', 'tesseract-core-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'worker.min.js'],
    );
  });

  it('inlines nothing the CSP would block: no inline scripts or styles, no data: fonts', { timeout: 200_000 }, async () => {
    const dir = await build('production');
    const html = await readFile(join(dir, 'index.html'), 'utf8');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(html).not.toMatch(/<style|\sstyle=/);
    expect(await bundleText(dir)).not.toMatch(/url\(\s*["']?data:font|data:font\/woff/);
  });
});
