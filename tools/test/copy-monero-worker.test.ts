// Gap 1 (the regtest e2e; the demo's browser run, 8 Nov): monero-ts runs every wallet in its own
// worker, which no build served. Every build now copies monero-ts's own prebuilt worker into
// apps/web/public/monero/ and checks it against tools/monero-worker.sha256 (computed from the pinned
// npm tarball, not from node_modules); a file that differs fails the build.
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { MONERO_WORKER_ASSETS, copyMoneroWorker, readMoneroManifest, verifyMoneroWorker } from '../copy-monero-worker.js';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const NODE_MODULES = join(REPO, 'node_modules');
const dirs: string[] = [];
const temp = async () => {
  const d = await mkdtemp(join(tmpdir(), 'x2f-monero-'));
  dirs.push(d);
  return d;
};

afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

describe('the manifest', () => {
  it("names exactly monero-ts 0.11.16's dist/monero.worker.js, with the tarball's SHA-256", async () => {
    const m = await readMoneroManifest();
    expect([...m.entries()]).toEqual([['monero.worker.js', '2e53c27e4518c5e59ae9f6378550cd00c68bb0221d8ee751bd0a12cc39263c3e']]);
    expect(MONERO_WORKER_ASSETS).toEqual([{ from: 'monero-ts/dist/monero.worker.js', to: 'monero.worker.js' }]);
    // The pin the manifest was computed from: a monero-ts upgrade must regenerate it.
    const pkg = JSON.parse(await readFile(join(REPO, 'packages', 'escrow', 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies['monero-ts']).toBe('0.11.16');
    expect(await readFile(join(REPO, 'tools', 'monero-worker.sha256'), 'utf8')).toContain('monero-ts-0.11.16.tgz');
  });
});

describe('copyMoneroWorker', () => {
  it('copies the pinned worker, byte for byte, and nothing else', async () => {
    const out = await temp();
    await copyMoneroWorker({ nodeModules: NODE_MODULES, outDir: out });
    expect(await readdir(out)).toEqual(['monero.worker.js']);
    expect(Buffer.compare(await readFile(join(out, 'monero.worker.js')), await readFile(join(NODE_MODULES, 'monero-ts/dist/monero.worker.js')))).toBe(0);
    await expect(verifyMoneroWorker(out)).resolves.toBeUndefined();
  });

  it('a node_modules worker one byte off fails the build, and nothing is written', async () => {
    const mods = await temp();
    await cp(join(NODE_MODULES, 'monero-ts/dist/monero.worker.js'), join(mods, 'monero-ts/dist/monero.worker.js'), { recursive: true });
    const f = join(mods, 'monero-ts/dist/monero.worker.js');
    const bytes = await readFile(f);
    bytes[1000] = (bytes[1000] ?? 0) ^ 1;
    await writeFile(f, bytes);
    const out = await temp();
    await expect(copyMoneroWorker({ nodeModules: mods, outDir: out })).rejects.toThrow(/monero\.worker\.js.*tools\/monero-worker\.sha256/);
    expect(await readdir(out)).toEqual([]);
  });

  it('a served worker tampered with, missing, or joined by another file fails the check', async () => {
    const out = await temp();
    await copyMoneroWorker({ nodeModules: NODE_MODULES, outDir: out });
    const f = join(out, 'monero.worker.js');
    const bytes = await readFile(f);
    bytes[7] = (bytes[7] ?? 0) ^ 0x80;
    await writeFile(f, bytes);
    await expect(verifyMoneroWorker(out)).rejects.toThrow(/monero\.worker\.js/);
    // copying again repairs it
    await copyMoneroWorker({ nodeModules: NODE_MODULES, outDir: out });
    await expect(verifyMoneroWorker(out)).resolves.toBeUndefined();
    await writeFile(join(out, 'monero.worker.js.map'), '{}');
    await expect(verifyMoneroWorker(out)).rejects.toThrow(/monero\.worker\.js\.map/);
    await rm(join(out, 'monero.worker.js.map'));
    await rm(f);
    await expect(verifyMoneroWorker(out)).rejects.toThrow(/missing/);
  });
});
