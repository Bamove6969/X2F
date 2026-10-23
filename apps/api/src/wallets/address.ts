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
 * One known-good primary address per network (throwaway keys generated with monero-ts, never
 * funded), checked at construction so a wrong network mapping or a broken monero-ts fails startup.
 */
const KNOWN_GOOD: Record<Config['moneroNetwork'], string> = {
  mainnet: '45jbUykptBnFdRdx6S1dYkY8pjefaP2B58TAP6QkBiRXPeMWEJQaN2sjHgyThrvPehRjCgZsLLwhNTZQxLcuW1U97m3N3vS',
  testnet: '9vwJDnyZH3dXkQjSteZK8E6fT5nFuimDB7vJAsWsF7sc3R6CrpDT8oLPpU9oDEYo5zDkBaC4aeCqMjACXjq13LVjH9mUUhq',
  stagenet: '53dxXP3XQ8XG2xyKwxE71xMz3twFhBZXXbgPpuhXe8SgQAaqqWhXfnQRv9mLjhiWrZWZbpm9iJtw3D9Z4geYNMVGLfbcDiA',
};

/**
 * Checks Monero receive addresses for `network` with monero-ts (`MoneroUtils.isValidAddress`: the
 * checksum, the keys and the network byte). Anything that is not 95 or 106 base58 characters is
 * `invalid` before monero-ts sees it. A valid 106-character address is `integrated`: those are
 * refused because Plan 1's `cosign` refuses payment-ID extras. Resolves once the WebAssembly keys
 * module has loaded and the network's known-good address checks `ok` (M2), so a broken install or
 * a wrong network mapping fails at startup rather than on the first request.
 */
export async function moneroAddressValidator(network: Config['moneroNetwork']): Promise<AddressValidator> {
  const type = NETWORKS[network];
  await LibraryUtils.loadWasmModule();
  const validator: AddressValidator = {
    async check(address) {
      if (typeof address !== 'string') return 'invalid';
      if (address.length !== STANDARD_LENGTH && address.length !== INTEGRATED_LENGTH) return 'invalid';
      if (!BASE58.test(address)) return 'invalid';
      if (!(await MoneroUtils.isValidAddress(address, type))) return 'invalid';
      return address.length === INTEGRATED_LENGTH ? 'integrated' : 'ok';
    },
  };
  if ((await validator.check(KNOWN_GOOD[network])) !== 'ok') {
    throw new Error(`monero address validator self-check failed for ${network}`);
  }
  return validator;
}
