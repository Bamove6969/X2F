import { MoneroNetworkType, MoneroUtils, createWalletKeys } from 'monero-ts';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AddressValidator } from '../src/app.js';
import { moneroAddressValidator } from '../src/wallets/address.js';

// Real addresses, generated with monero-ts for a throwaway stagenet wallet (no funds, no network).
let primary: string;
let sub: string;
let integrated: string;
let stagenet: AddressValidator;
let mainnet: AddressValidator;

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** The address with one character in the middle swapped for another base58 character. */
function oneCharChanged(address: string): string {
  const i = 40;
  const c = address[i]!;
  const other = BASE58[(BASE58.indexOf(c) + 1) % BASE58.length]!;
  return address.slice(0, i) + other + address.slice(i + 1);
}

beforeAll(async () => {
  const w = await createWalletKeys({ networkType: MoneroNetworkType.STAGENET });
  primary = await w.getPrimaryAddress();
  sub = await w.getAddress(0, 1);
  integrated = (await MoneroUtils.getIntegratedAddress(MoneroNetworkType.STAGENET, primary)).getIntegratedAddress();
  await w.close();
  stagenet = await moneroAddressValidator('stagenet');
  mainnet = await moneroAddressValidator('mainnet');
});

describe('moneroAddressValidator', () => {
  it('accepts a stagenet address on stagenet and refuses it on mainnet', async () => {
    expect(primary).toHaveLength(95);
    expect(await stagenet.check(primary)).toBe('ok');
    expect(await mainnet.check(primary)).toBe('invalid');
  });

  it('refuses an address with one character changed', async () => {
    const changed = oneCharChanged(primary);
    expect(changed).not.toBe(primary);
    expect(changed).toHaveLength(95);
    expect(await stagenet.check(changed)).toBe('invalid');
  });

  it('accepts a subaddress', async () => {
    expect(sub).toHaveLength(95);
    expect(await stagenet.check(sub)).toBe('ok');
  });

  it('reports a valid integrated address as integrated, and only on its own network', async () => {
    expect(integrated).toHaveLength(106);
    expect(await stagenet.check(integrated)).toBe('integrated');
    expect(await mainnet.check(integrated)).toBe('invalid');
    expect(await stagenet.check(oneCharChanged(integrated))).toBe('invalid');
  });

  it('refuses anything that is not a base58 address without throwing', async () => {
    for (const bad of ['', ' ', 'hello', '0'.repeat(95), `${primary} `, `${primary}x`, primary.slice(0, 94), 'x'.repeat(5000)]) {
      expect(await stagenet.check(bad)).toBe('invalid');
    }
  });
});
