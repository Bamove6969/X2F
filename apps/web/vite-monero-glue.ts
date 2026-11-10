import type { Plugin } from 'vite';

/**
 * Two Node-isms in monero-ts 0.11.16 that only an IN-PROCESS wallet reaches, rewritten for this ES
 * module bundle. The only in-process wallet is a resumed regtest one (monero-ts drops the regtest
 * flag when its worker reopens wallet data, so @x2f/escrow opens it in-process): every trader's
 * escrow wallet after a page reload on the regtest demo (10 Nov). Wallets in monero-ts's own
 * prebuilt worker (stagenet, mainnet, every new wallet) never run these copies.
 *
 * - monero-ts/dist/monero.js (the WebAssembly glue) reads its HTTP client as
 *   `const HttpClient=this.HttpClient;…` in the two functions that send daemon requests
 *   (`js_send_json_request`, `js_send_binary_request`). `this` is undefined there in an ES module,
 *   so the wallet could never sync. Read from `globalThis.` instead, where @x2f/escrow's
 *   `useFetchForInProcessWallets` puts its fetch client and monero-ts puts LibraryUtils and GenUtils.
 * - MoneroWalletFull.getDataWasm (every save) wraps the wallet's bytes in Node's `Buffer`, which a
 *   browser does not have. A Uint8Array of the same bytes instead (what @x2f/escrow's save reads).
 *
 * Each rewrite must match exactly as often as expected, or the build fails: a monero-ts upgrade
 * has to be looked at again.
 */
export const MONERO_GLUE_PLUGIN = 'x2f-monero-glue';

interface Rewrite {
  file: RegExp;
  from: string;
  to: string;
  times: number;
}

const REWRITES: Rewrite[] = [
  {
    file: /[\\/]monero-ts[\\/]dist[\\/]monero\.js$/,
    from: 'const HttpClient=this.HttpClient;const LibraryUtils=this.LibraryUtils;const GenUtils=this.GenUtils;',
    to: 'const HttpClient=globalThis.HttpClient;const LibraryUtils=globalThis.LibraryUtils;const GenUtils=globalThis.GenUtils;',
    times: 2,
  },
  {
    file: /[\\/]monero-ts[\\/]dist[\\/]src[\\/]main[\\/]ts[\\/]wallet[\\/]MoneroWalletFull\.js$/,
    from: 'Buffer.from(view.buffer)',
    to: 'new Uint8Array(view.buffer)',
    times: 2,
  },
];

function apply(code: string, r: Rewrite): string {
  const parts = code.split(r.from);
  if (parts.length !== r.times + 1) {
    throw new Error(`monero-ts rewrite: expected ${r.times} of "${r.from.slice(0, 40)}…", found ${parts.length - 1} (was monero-ts upgraded? see apps/web/vite-monero-glue.ts)`);
  }
  return parts.join(r.to);
}

/** The WebAssembly glue with its two HTTP functions reading globalThis. */
export function patchMoneroGlue(code: string): string {
  return apply(code, REWRITES[0]!);
}

export function moneroGlue(): Plugin {
  return {
    name: MONERO_GLUE_PLUGIN,
    enforce: 'pre',
    transform(code, id) {
      const path = id.split('?')[0]!;
      const r = REWRITES.find((x) => x.file.test(path));
      return r ? { code: apply(code, r), map: null } : null;
    },
  };
}
