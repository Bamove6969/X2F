// Task 9 I/O, lead decision (A) of 2026-10-29: after a seller–buyer release, the releasing device
// sends the moderator its post-release multisig info; the moderator imports it, and only then does
// its OWN wallet show the spend (funds().outgoing). Regtest.
import { ROLES } from '@x2f/core';
import { fundedWallet, mine, newTestWallet, startRegtest, type Regtest } from '@x2f/regtest';
import { buildRelay, type Relay } from '@x2f/relay';
import type { MoneroWalletFull } from 'monero-ts';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MoneroMultisigEngine, SPEND_INFO_MAX_HEX, type Outcome } from '../src/index.js';
import { minedWhile, partyKit, type Trade } from './harness.js';

const engine = new MoneroMultisigEngine({ network: 'regtest' });
const XMR = 1_000_000_000_000n;

describe('post-release multisig info shows the moderator a seller-buyer release (regtest)', () => {
  let node: Regtest;
  let relay: Relay;
  let relayUrl: string;
  let funder: MoneroWalletFull;
  let funderAddress: string;
  const kit = partyKit({ relay: () => relay, relayUrl: () => relayUrl, daemonUri: () => node.rpcUri, engine });

  beforeAll(async () => {
    node = await startRegtest();
    funder = await fundedWallet(node.rpcUri);
    funderAddress = await funder.getPrimaryAddress();
    relay = await buildRelay();
    await relay.app.listen({ host: '127.0.0.1', port: 0 });
    const addr = relay.app.server.address();
    relayUrl = `ws://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  });

  afterEach(async () => {
    await kit.stopAll();
  });

  afterAll(async () => {
    await funder?.close();
    await relay?.app.close();
    await node?.stop();
  });

  async function fund(t: Trade, amount: bigint): Promise<string> {
    const addresses = await Promise.all(ROLES.map((r) => t.parties[r].ready()));
    await funder.setDaemonConnection({ uri: node.rpcUri });
    await funder.sync();
    await funder.createTx({ accountIndex: 0, address: addresses[0]!, amount, relay: true });
    await mine(node.rpcUri, 12, funderAddress);
    return addresses[0]!;
  }

  it('the mod sees no spend after a seller-buyer release until it imports the releasing party\'s info; then its wallet shows the sweep', async () => {
    const [t, other] = [await kit.newTrade(), await kit.newTrade()];
    await fund(t, XMR);
    await Promise.all(ROLES.map((r) => other.parties[r].ready()));
    const dest = await newTestWallet(node.rpcUri);
    try {
      const o: Outcome = { kind: 'release', to: [{ address: await dest.getPrimaryAddress(), amountAtomic: XMR }], builder: 'seller', cosigner: 'buyer' };
      // Before any release is done there is nothing to export (the nonces are in use).
      await expect(t.parties.buyer.spendInfo()).rejects.toMatchObject({ code: 'bad-state' });
      const [hash] = await minedWhile(node.rpcUri, funderAddress, Promise.all([t.parties.buyer.settle(o), t.parties.seller.settle(o), t.parties.mod.settle(o)]));
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      await mine(node.rpcUri, 2, funderAddress);

      // The gap: the mod took no part, so its own wallet does not show the spend.
      let f = await t.parties.mod.funds();
      expect(f.outgoing).toEqual([]);

      // Strict input: garbage, wrong size, and another escrow's info are refused and change nothing.
      await expect(t.parties.mod.importSpendInfo('zz')).rejects.toMatchObject({ code: 'bad-spend-info' });
      await expect(t.parties.mod.importSpendInfo('ab'.repeat(SPEND_INFO_MAX_HEX / 2 + 1))).rejects.toMatchObject({ code: 'bad-spend-info' });
      await expect(t.parties.mod.importSpendInfo('00'.repeat(200))).rejects.toMatchObject({ code: 'bad-spend-info' });
      const info = await t.parties.buyer.spendInfo();
      expect(info).toMatch(/^[0-9a-f]+$/);
      expect(await t.parties.buyer.spendInfo()).toBe(info); // exported once, saved
      expect(t.stores.buyer.current()!.spendInfo).toBe(info);
      await expect(other.parties.mod.importSpendInfo(info)).rejects.toMatchObject({ code: 'bad-spend-info' });
      // A tampered byte breaks the info's signature.
      const flipped = info.slice(0, -4) + (info.slice(-4) === '0000' ? '0001' : '0000');
      await expect(t.parties.mod.importSpendInfo(flipped)).rejects.toMatchObject({ code: 'bad-spend-info' });
      f = await t.parties.mod.funds();
      expect(f.outgoing).toEqual([]);

      // The real info: the mod's own wallet now shows the sweep, in its block, spending everything.
      await t.parties.mod.importSpendInfo(info);
      f = await t.parties.mod.funds();
      expect(f.balance).toBe(0n);
      expect(f.outgoing).toHaveLength(1);
      expect(f.outgoing![0]).toMatchObject({ txHash: hash, spentAtomic: XMR });
      expect(typeof f.outgoing![0]!.height).toBe('number');
      // The builder's info shows the same (either releasing device may send it).
      const sellerInfo = await t.parties.seller.spendInfo();
      await t.parties.mod.importSpendInfo(sellerInfo);
      expect((await t.parties.mod.funds()).outgoing!.map((x) => x.txHash)).toEqual([hash]);
    } finally {
      await dest.close();
    }
  });
});
