import { LibraryUtils, MoneroNetworkType, MoneroUtils } from 'monero-ts';
import type { AddressValidator } from '../app.js';
import type { Config } from '../config.js';

const NETWORKS: Record<Config['moneroNetwork'], MoneroNetworkType> = {
  mainnet: MoneroNetworkType.MAINNET,
  stagenet: MoneroNetworkType.STAGENET,
  testnet: MoneroNetworkType.TESTNET,
};

/** Standard addresses and subaddresses are 95 characters; integrated addresses (with a payment ID) 106. */
const STANDARD_LENGTH = 95;
const INTEGRATED_LENGTH = 106;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

/**
 * Checks Monero receive addresses for `network` with monero-ts (`MoneroUtils.isValidAddress`: the
 * checksum, the keys and the network byte). Anything that is not 95 or 106 base58 characters is
 * `invalid` before monero-ts sees it. A valid 106-character address is `integrated`: those are
 * refused because Plan 1's `cosign` refuses payment-ID extras. Resolves once the WebAssembly keys
 * module has loaded, so a broken install fails at startup rather than on the first request.
 */
export async function moneroAddressValidator(network: Config['moneroNetwork']): Promise<AddressValidator> {
  const type = NETWORKS[network];
  await LibraryUtils.loadWasmModule();
  return {
    async check(address) {
      if (typeof address !== 'string') return 'invalid';
      if (address.length !== STANDARD_LENGTH && address.length !== INTEGRATED_LENGTH) return 'invalid';
      if (!BASE58.test(address)) return 'invalid';
      if (!(await MoneroUtils.isValidAddress(address, type))) return 'invalid';
      return address.length === INTEGRATED_LENGTH ? 'integrated' : 'ok';
    },
  };
}
