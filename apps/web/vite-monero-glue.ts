import type { Plugin } from 'vite';

/**
 * monero-ts's WebAssembly glue (monero-ts/dist/monero.js) reads its HTTP client, as
 * `const HttpClient=this.HttpClient;…`, in the two functions an in-process wallet sends daemon
 * requests with (`js_send_json_request`, `js_send_binary_request`). In this ES module bundle `this`
 * is undefined there, so an in-process wallet could never sync: a resumed regtest wallet, which is
 * every trader's escrow wallet after a page reload on the regtest demo (10 Nov; monero-ts 0.11.16
 * drops the regtest flag when its worker reopens wallet data, so @x2f/escrow opens it in-process).
 * Rewritten here to `globalThis.`, where @x2f/escrow's `useFetchForInProcessWallets` puts its fetch
 * client and monero-ts puts LibraryUtils and GenUtils. Wallets in monero-ts's own prebuilt worker
 * (stagenet, mainnet, every new wallet) never run this copy of the glue.
 */
export const MONERO_GLUE_PLUGIN = 'x2f-monero-glue';

const READS = 'const HttpClient=this.HttpClient;const LibraryUtils=this.LibraryUtils;const GenUtils=this.GenUtils;';
const GLOBAL_READS = 'const HttpClient=globalThis.HttpClient;const LibraryUtils=globalThis.LibraryUtils;const GenUtils=globalThis.GenUtils;';

/** The glue with its two HTTP functions reading globalThis; throws unless exactly those two match. */
export function patchMoneroGlue(code: string): string {
  const parts = code.split(READS);
  if (parts.length !== 3) {
    throw new Error(`monero-ts glue: expected 2 HTTP client reads to rewrite, found ${parts.length - 1} (was monero-ts upgraded? see apps/web/vite-monero-glue.ts)`);
  }
  return parts.join(GLOBAL_READS);
}

const GLUE_ID = /[\\/]monero-ts[\\/]dist[\\/]monero\.js$/;

export function moneroGlue(): Plugin {
  return {
    name: MONERO_GLUE_PLUGIN,
    enforce: 'pre',
    transform(code, id) {
      if (!GLUE_ID.test(id.split('?')[0]!)) return null;
      return { code: patchMoneroGlue(code), map: null };
    },
  };
}
