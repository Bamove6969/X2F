// Demo, 10 Nov: a trader's page reloaded mid-trade never synced its escrow wallet again (a resumed
// regtest wallet runs in-process in the escrow worker). monero-ts's WebAssembly glue reads its HTTP
// client as `this.HttpClient`, and in the web app's ES module bundle `this` is undefined there: every
// sync failed with "Cannot read properties of undefined (reading 'HttpClient')". The web build
// rewrites those reads to `globalThis.` (where @x2f/escrow puts its fetch client), for the page and
// for the workers, and fails the build if monero-ts's glue ever stops matching.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import viteConfig from '../vite.config.js';
import { MONERO_GLUE_PLUGIN, moneroGlue, patchMoneroGlue } from '../vite-monero-glue.js';

const require = createRequire(import.meta.url);
const gluePath = require.resolve('monero-ts/dist/monero.js');
const glue = readFileSync(gluePath, 'utf8');
const walletPath = require.resolve('monero-ts/dist/src/main/ts/wallet/MoneroWalletFull.js');
const wallet = readFileSync(walletPath, 'utf8');

/** What the plugin makes of a module, as Vite calls it (null: left alone). */
function transformed(code: string, id: string): string | null {
  const t = moneroGlue().transform as (code: string, id: string) => { code: string } | null;
  return t(code, id)?.code ?? null;
}

describe("monero-ts's WebAssembly glue in the web build", () => {
  it("reads its HTTP client from globalThis, never from `this` (undefined in an ES module)", () => {
    expect(glue).toMatch(/this\.HttpClient/); // the shipped glue, as monero-ts 0.11.16 has it
    const out = patchMoneroGlue(glue);
    expect(out).not.toMatch(/this\.(HttpClient|LibraryUtils|GenUtils)\b/);
    expect(out.match(/globalThis\.HttpClient/g)).toHaveLength(2); // the JSON and the binary request
    expect(out.length).toBe(glue.length + 2 * 3 * ('globalThis'.length - 'this'.length));
  });

  it('fails the build when the glue no longer matches (a monero-ts upgrade must be looked at)', () => {
    expect(() => patchMoneroGlue('function js_send_json_request(){const HttpClient=self.HttpClient}')).toThrow(/monero-ts/);
  });

  it("an in-process wallet's save never needs Node's Buffer (the next failure after a reload, 10 Nov)", () => {
    // Demo: after the HTTP fix, the reloaded buyer's party died on its first save with
    // "ReferenceError: Buffer is not defined" in MoneroWalletFull.getDataWasm.
    expect(wallet.match(/Buffer\.from\(view\.buffer\)/g)).toHaveLength(2);
    const out = transformed(wallet, walletPath);
    expect(out).not.toBeNull();
    expect(out).not.toMatch(/\bBuffer\b(?!Loc)/);
    expect(out!.match(/new Uint8Array\(view\.buffer\)/g)).toHaveLength(2);
    expect(transformed(glue, gluePath)).toBe(patchMoneroGlue(glue));
    expect(transformed('export const x = 1;', '/src/other.js')).toBeNull();
    expect(() => transformed('views.push(view.buffer);', walletPath)).toThrow(/monero-ts/);
  });

  it('is in the build for the page and for the workers (the escrow worker is where wallets run)', async () => {
    const config = typeof viteConfig === 'function' ? await viteConfig({ command: 'build', mode: 'production' }) : viteConfig;
    const names = (ps: unknown): string[] => (ps as { name?: string }[]).flat(5).map((p) => p?.name ?? '');
    expect(names(config.plugins)).toContain(MONERO_GLUE_PLUGIN);
    const workerPlugins = config.worker?.plugins;
    expect(typeof workerPlugins).toBe('function');
    expect(names(await (workerPlugins as () => unknown)())).toContain(MONERO_GLUE_PLUGIN);
  });
});
