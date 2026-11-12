// Plan 5 Task 13: the OCR files are copied from the pinned packages into apps/web/public/ocr/ and
// checked against tools/ocr-assets.sha256 (computed from the pinned tarballs, not from node_modules).
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { OCR_ASSETS, copyOcrAssets, readManifest, verifyOcrAssets } from '../copy-ocr-assets.js';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const NODE_MODULES = join(REPO, 'node_modules');
const dirs: string[] = [];
const temp = async () => {
  const d = await mkdtemp(join(tmpdir(), 'x2f-ocr-'));
  dirs.push(d);
  return d;
};
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

/** A stand-in node_modules holding just the five source files, so one can be tampered with. */
async function fakeModules(): Promise<string> {
  const d = await temp();
  for (const a of OCR_ASSETS) await cp(join(NODE_MODULES, a.from), join(d, a.from), { recursive: true });
  return d;
}

describe('the manifest', () => {
  it('names exactly the six served files, each with a SHA-256', async () => {
    const m = await readManifest();
    expect([...m.keys()].sort()).toEqual(
      ['eng.traineddata.gz', 'rus.traineddata.gz', 'tesseract-core-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'worker.min.js'].sort(),
    );
    for (const h of m.values()) expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(OCR_ASSETS.map((a) => a.to).sort()).toEqual([...m.keys()].sort());
  });

  it('the model is the LSTM-only 4.0.0_best_int file, and the relaxed-SIMD core is among the cores', () => {
    expect(OCR_ASSETS.find((a) => a.to === 'eng.traineddata.gz')?.from).toBe('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz');
    expect(OCR_ASSETS.map((a) => a.from)).toContain('tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js');
    // The Russian model (a second pass for Cyrillic only), the same LSTM-only 4.0.0_best_int build.
    expect(OCR_ASSETS.find((a) => a.to === 'rus.traineddata.gz')?.from).toBe('@tesseract.js-data/rus/4.0.0_best_int/rus.traineddata.gz');
  });
});

describe('copyOcrAssets', () => {
  it('copies the pinned files, each matching the manifest, and nothing else', async () => {
    const out = await temp();
    await copyOcrAssets({ nodeModules: NODE_MODULES, outDir: out });
    const m = await readManifest();
    expect((await readdir(out)).sort()).toEqual([...m.keys()].sort());
    for (const [name, hash] of m) expect(sha(await readFile(join(out, name))), name).toBe(hash);
    await expect(verifyOcrAssets(out)).resolves.toBeUndefined();
  });

  it('a source file one byte off fails the build, and nothing is left in the output', async () => {
    const mods = await fakeModules();
    const model = join(mods, '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz');
    const bytes = await readFile(model);
    bytes[100] = (bytes[100] ?? 0) ^ 1;
    await writeFile(model, bytes);
    const out = await temp();
    await expect(copyOcrAssets({ nodeModules: mods, outDir: out })).rejects.toThrow(/eng\.traineddata\.gz/);
    expect(await readdir(out)).toEqual([]);
  });

  it('a served file one byte off (public/ocr tampered) fails the check', async () => {
    const out = await temp();
    await copyOcrAssets({ nodeModules: NODE_MODULES, outDir: out });
    const f = join(out, 'eng.traineddata.gz');
    const bytes = await readFile(f);
    bytes[7] = (bytes[7] ?? 0) ^ 0x80;
    await writeFile(f, bytes);
    await expect(verifyOcrAssets(out)).rejects.toThrow(/eng\.traineddata\.gz/);
  });

  it('a missing served file, or an extra one, fails the check', async () => {
    const out = await temp();
    await copyOcrAssets({ nodeModules: NODE_MODULES, outDir: out });
    await rm(join(out, 'tesseract-core-relaxedsimd-lstm.wasm.js'));
    await expect(verifyOcrAssets(out)).rejects.toThrow(/relaxedsimd/);
    const out2 = await temp();
    await copyOcrAssets({ nodeModules: NODE_MODULES, outDir: out2 });
    await writeFile(join(out2, 'tesseract-core.wasm.js'), 'x');
    await expect(verifyOcrAssets(out2)).rejects.toThrow(/tesseract-core\.wasm\.js/);
  });
});
