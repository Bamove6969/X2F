import { feeFor } from '@x2f/core';
import { fundedWallet, mine, newTestWallet, startRegtest, type Regtest } from '@x2f/regtest';
import type { MoneroWalletFull } from 'monero-ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EscrowError, MoneroMultisigEngine, type EscrowSession, type Payout } from '../src/index.js';

const engine = new MoneroMultisigEngine({ network: 'regtest' });
const PASSWORD = 'resume-test';

describe('save and resume on regtest', () => {
  let node: Regtest;
  let funder: MoneroWalletFull;
  let buyerWallet: MoneroWalletFull;
  let feeWallet: MoneroWalletFull;
  const open: EscrowSession[] = [];
  const amount = 1_000_000_000_000n;

  beforeAll(async () => {
    node = await startRegtest();
    funder = await fundedWallet(node.rpcUri);
    buyerWallet = await newTestWallet(node.rpcUri);
    feeWallet = await newTestWallet(node.rpcUri);
  });

  afterAll(async () => {
    for (const s of open) await s.close().catch(() => undefined);
    for (const w of [funder, buyerWallet, feeWallet]) await w?.close();
    await node?.stop();
  });

  it('a resumed buyer keeps its address, balance and can co-sign a release', async () => {
    const opts = { daemonUri: node.rpcUri, password: PASSWORD };
    const parties = await Promise.all([0, 1, 2].map(() => engine.create(opts)));
    open.push(...parties);
    const others = (hex: string[], i: number): string[] => hex.filter((_, j) => j !== i);
    const prepared = await Promise.all(parties.map((p) => p.prepare()));
    let hex = await Promise.all(parties.map((p, i) => p.make(others(prepared, i))));
    for (;;) {
      const r = await Promise.all(parties.map((p, i) => p.exchange(others(hex, i))));
      if (r.every((x) => x.ready)) break;
      hex = r.map((x) => x.hex);
    }
    const buyer0: EscrowSession = parties[0]!;
    const seller: EscrowSession = parties[1]!;
    const address = await seller.address();

    // Save after setup, close, resume: same escrow address.
    const afterSetup = await buyer0.save();
    await buyer0.close();
    open.splice(open.indexOf(buyer0), 1);
    let buyer = await engine.resume(afterSetup, opts);
    open.push(buyer);
    expect(await buyer.address()).toBe(address);

    // Fund, then save after funding and resume: same unlocked balance.
    await funder.setDaemonConnection({ uri: node.rpcUri });
    await funder.sync();
    await funder.createTx({ accountIndex: 0, address, amount, relay: true });
    await mine(node.rpcUri, 12, await funder.getPrimaryAddress());
    const synced = await buyer.sync();
    expect(synced.unlocked).toBe(amount);
    const afterFunding = await buyer.save();
    await buyer.close();
    open.splice(open.indexOf(buyer), 1);
    buyer = await engine.resume(afterFunding, opts);
    open.push(buyer);
    expect(await buyer.sync()).toEqual(synced);

    // The resumed buyer co-signs a release the seller built.
    await seller.sync();
    const [hb, hs] = [await buyer.exportState(), await seller.exportState()];
    await buyer.importState([hs]);
    await seller.importState([hb]);
    const fee = feeFor(amount);
    const payouts: Payout[] = [
      { address: await buyerWallet.getPrimaryAddress(), amountAtomic: amount - fee },
      { address: await feeWallet.getPrimaryAddress(), amountAtomic: fee },
    ];
    const { txSet } = await seller.buildRelease(payouts);
    expect(await buyer.cosign(txSet, payouts)).toMatch(/^[0-9a-f]{64}$/);

    // Resuming with the wrong password fails.
    await expect(engine.resume(afterFunding, { ...opts, password: 'wrong' })).rejects.toThrow();
  });

  it('refuses a malformed saved session', async () => {
    const opts = { daemonUri: node.rpcUri, password: PASSWORD };
    for (const bad of [null, {}, { v: 2, keys: '', cache: '' }, { v: 1, keys: 1, cache: '' }]) {
      const err = await engine.resume(bad as never, opts).then(() => null, (e: unknown) => e);
      expect(err).toBeInstanceOf(EscrowError);
      expect((err as EscrowError).code).toBe('bad-saved-session');
    }
  });
});
