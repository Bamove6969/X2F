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

async function build(mode: string, env: Record<string, string> = { VITE_FIXTURES: '1', VITE_X2F_DEMO: '1' }): Promise<string> {
  const out = await mkdtemp(join(tmpdir(), 'x2f-web-build-'));
  dirs.push(out);
  // VITE_FIXTURES=1 and VITE_X2F_DEMO=1 are set on purpose: a production build must leave fixture
  // mode and the demo lab out anyway.
  await run(process.execPath, [VITE, 'build', '--mode', mode, '--outDir', out, '--emptyOutDir', '--logLevel', 'error'], {
    cwd: WEB,
    env: { ...process.env, ...env },
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

  it('a staging (or any other non-fixtures) build mode leaves fixture mode out too', { timeout: 200_000 }, async () => {
    const text = (await bundleText(await build('staging'))).toLowerCase();
    for (const word of FORBIDDEN) expect(text, word).not.toContain(word);
  });

  it('a fixtures-mode build does include fixture mode (the check bites)', { timeout: 200_000 }, async () => {
    const text = (await bundleText(await build('fixtures'))).toLowerCase();
    expect(text).toContain('fixture');
  });

  // The owner's intro proof of concept (/lab/intro, Three.js): demo builds only, and lazy there.
  const THREE_MARK = 'THREE.WebGLRenderer';
  const entryOf = async (dir: string) => {
    const html = await readFile(join(dir, 'index.html'), 'utf8');
    const entry = /<script[^>]*\bsrc="\/(assets\/[^"]+\.js)"/.exec(html)?.[1];
    expect(entry).toBeDefined();
    return { html, entry: entry!, text: await readFile(join(dir, entry!), 'utf8') };
  };

  it('a production build has no demo lab and no Three.js, and the same entry chunk with or without VITE_X2F_DEMO=1', { timeout: 400_000 }, async () => {
    const withFlag = await build('production');
    const text = await bundleText(withFlag);
    expect(text).not.toContain(THREE_MARK);
    expect(text).not.toContain('/lab/intro');
    const without = await build('production', {});
    const a = await entryOf(withFlag);
    const b = await entryOf(without);
    expect(a.entry).toBe(b.entry);
    expect(a.text).toBe(b.text);
  });

  it('a demo build carries the lab, with Three.js in a lazily loaded chunk: never the entry, never preloaded', { timeout: 200_000 }, async () => {
    const dir = await build('demo', { VITE_X2F_DEMO: '1' });
    const { html, entry, text } = await entryOf(dir);
    expect(text).toContain('/lab/intro');
    expect(text).not.toContain(THREE_MARK);
    const chunks = (await readdir(join(dir, 'assets'))).filter((f) => f.endsWith('.js'));
    const withThree: string[] = [];
    for (const f of chunks) if ((await readFile(join(dir, 'assets', f), 'utf8')).includes(THREE_MARK)) withThree.push(`assets/${f}`);
    expect(withThree).toHaveLength(1);
    expect(withThree[0]).not.toBe(entry);
    expect(html).not.toContain(withThree[0]);
  });

  it('inlines nothing the CSP would block: no inline scripts or styles, no data: fonts', { timeout: 200_000 }, async () => {
    const dir = await build('production');
    const html = await readFile(join(dir, 'index.html'), 'utf8');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(html).not.toMatch(/<style|\sstyle=/);
    expect(await bundleText(dir)).not.toMatch(/url\(\s*["']?data:font|data:font\/woff/);
  });
});
