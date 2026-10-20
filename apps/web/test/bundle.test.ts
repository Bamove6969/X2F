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

async function bundleText(dir: string): Promise<string> {
  const files = await readdir(dir, { recursive: true, withFileTypes: true });
  const parts = await Promise.all(
    files.filter((f) => f.isFile() && /\.(js|css|html)$/.test(f.name)).map((f) => readFile(join(f.parentPath, f.name), 'utf8')),
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

  it('a fixtures-mode build does include fixture mode (the check bites)', { timeout: 200_000 }, async () => {
    const text = (await bundleText(await build('fixtures'))).toLowerCase();
    expect(text).toContain('fixture');
  });

  it('inlines nothing the CSP would block: no inline scripts or styles, no data: fonts', { timeout: 200_000 }, async () => {
    const dir = await build('production');
    const html = await readFile(join(dir, 'index.html'), 'utf8');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(html).not.toMatch(/<style|\sstyle=/);
    expect(await bundleText(dir)).not.toMatch(/url\(\s*["']?data:font|data:font\/woff/);
  });
});
