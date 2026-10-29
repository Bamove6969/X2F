import { fundedWallet, mine, newTestWallet, startRegtest, type Regtest } from '@x2f/regtest';
import { feeFor } from '@x2f/core';
import { MoneroDestination, MoneroTxConfig, type MoneroWalletFull } from 'monero-ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EscrowError, MoneroMultisigEngine, type MoneroMultisigSession, type Payout } from '../src/index.js';

const XMR = 1_000_000_000_000n;
const MAX_NET_FEE = XMR / 100n;
const engine = new MoneroMultisigEngine({ network: 'regtest' });

interface Escrow {
  buyer: MoneroMultisigSession;
  seller: MoneroMultisigSession;
  mod: MoneroMultisigSession;
  address: string;
  messageRounds: number;
}

/** Run setup the way three separate apps would: each round uses only the others' hex. */
async function setupEscrow(rpcUri: string): Promise<Escrow> {
  const parties = await Promise.all([0, 1, 2].map(() => engine.create({ daemonUri: rpcUri, password: 'test' })));
  const others = (hex: string[], i: number): string[] => hex.filter((_, j) => j !== i);
  const prepared = await Promise.all(parties.map((p) => p.prepare()));
  let hex = await Promise.all(parties.map((p, i) => p.make(others(prepared, i))));
  let messageRounds = 2;
  for (;;) {
    const results = await Promise.all(parties.map((p, i) => p.exchange(others(hex, i))));
    messageRounds++;
    if (results.every((r) => r.ready)) break;
    if (messageRounds > 6) throw new Error('multisig did not converge');
    hex = results.map((r) => r.hex);
  }
  const addresses = await Promise.all(parties.map((p) => p.address()));
  expect(new Set(addresses).size).toBe(1);
  const [buyer, seller, mod] = parties as [MoneroMultisigSession, MoneroMultisigSession, MoneroMultisigSession];
  return { buyer, seller, mod, address: addresses[0]!, messageRounds };
}

async function fund(rpcUri: string, funder: MoneroWalletFull, e: Escrow, amount: bigint): Promise<void> {
  await funder.setDaemonConnection({ uri: rpcUri });
  await funder.sync();
  await funder.createTx({ accountIndex: 0, address: e.address, amount, relay: true });
  await mine(rpcUri, 12, await funder.getPrimaryAddress());
  for (const p of [e.buyer, e.seller, e.mod]) await p.sync();
}

/** The two signers swap multisig state, each importing the other's in one call. */
async function pair(a: MoneroMultisigSession, b: MoneroMultisigSession): Promise<void> {
  const [ha, hb] = [await a.exportState(), await b.exportState()];
  await a.importState([hb]);
  await b.importState([ha]);
}

/** A hostile builder: any destinations, network fee off output 0, never relayed. */
async function rawSet(builder: MoneroMultisigSession, outs: Payout[]): Promise<string> {
  const txs = await builder.wallet.createTxs(new MoneroTxConfig({
    accountIndex: 0,
    destinations: outs.map((o) => new MoneroDestination(o.address, o.amountAtomic)),
    subtractFeeFrom: [0],
    relay: false,
  }));
  return txs[0]!.getTxSet().getMultisigTxHex();
}

async function received(rpcUri: string, w: MoneroWalletFull): Promise<bigint> {
  await w.setDaemonConnection({ uri: rpcUri });
  await w.sync();
  return w.getBalance();
}

async function expectMismatch(p: Promise<unknown>): Promise<void> {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(EscrowError);
  expect((err as EscrowError).code).toBe('payout-mismatch');
}

describe('MoneroMultisigEngine on regtest', () => {
  let node: Regtest;
  let funder: MoneroWalletFull;
  let buyerWallet: MoneroWalletFull;
  let feeWallet: MoneroWalletFull;
  let attacker: MoneroWalletFull;
  let e: Escrow;
  const amount = 1_250_000_000_000n; // 1.25 XMR, seller posted the ad and funds amount + fee
  let payouts: Payout[];

  beforeAll(async () => {
    node = await startRegtest();
    funder = await fundedWallet(node.rpcUri);
    [buyerWallet, feeWallet, attacker] = await Promise.all([0, 1, 2].map(() => newTestWallet(node.rpcUri))) as [MoneroWalletFull, MoneroWalletFull, MoneroWalletFull];
    e = await setupEscrow(node.rpcUri);
    await fund(node.rpcUri, funder, e, amount);
    const fee = feeFor(amount);
    payouts = [
      { address: await buyerWallet.getPrimaryAddress(), amountAtomic: amount - fee },
      { address: await feeWallet.getPrimaryAddress(), amountAtomic: fee },
    ];
    await pair(e.seller, e.buyer);
  });

  afterAll(async () => {
    for (const w of [funder, buyerWallet, feeWallet, attacker]) await w?.close();
    for (const p of [e?.buyer, e?.seller, e?.mod]) await p?.close();
    await node?.stop();
  });

  it('three parties agree on one escrow address in 4 message rounds', async () => {
    expect(e.messageRounds).toBe(4);
    expect((await e.buyer.sync()).unlocked).toBe(amount);
  });

  it('refuses a release paying an attacker instead of the buyer', async () => {
    const set = await rawSet(e.seller, [{ address: await attacker.getPrimaryAddress(), amountAtomic: payouts[0]!.amountAtomic }, payouts[1]!]);
    await expectMismatch(e.buyer.cosign(set, payouts));
  });

  it('refuses a fee output skimmed by 1 atomic unit', async () => {
    const set = await rawSet(e.seller, [
      { address: payouts[0]!.address, amountAtomic: payouts[0]!.amountAtomic - 1n },
      { address: payouts[1]!.address, amountAtomic: payouts[1]!.amountAtomic + 1n },
    ]);
    await expectMismatch(e.buyer.cosign(set, payouts));
  });

  it('refuses an extra 1-atomic output to an attacker', async () => {
    const set = await rawSet(e.seller, [
      { address: payouts[0]!.address, amountAtomic: payouts[0]!.amountAtomic - 1n },
      payouts[1]!,
      { address: await attacker.getPrimaryAddress(), amountAtomic: 1n },
    ]);
    await expectMismatch(e.buyer.cosign(set, payouts));
  });

  it('refuses a release that leaves change behind', async () => {
    // Payouts[0] is short by 0.1 XMR so the wallet adds a change output; the change check
    // runs before the amount checks, which the message pins.
    const set = await rawSet(e.seller, [
      { address: payouts[0]!.address, amountAtomic: payouts[0]!.amountAtomic - XMR / 10n },
      payouts[1]!,
    ]);
    await expect(e.buyer.cosign(set, payouts)).rejects.toThrow(/change output present/);
  });

  it('buildRelease refuses payouts that do not sweep the escrow', async () => {
    await expect(e.seller.buildRelease([payouts[0]!])).rejects.toThrow(/bad-payouts/);
  });

  it('one key alone cannot spend: the builder cannot co-sign its own set', async () => {
    const { txSet } = await e.seller.buildRelease(payouts);
    const err = await e.seller.cosign(txSet, payouts).then(() => null, (x: unknown) => x);
    // The wallet refuses ("already signed by this private key"), reported as a refused attempt.
    expect((err as EscrowError).code).toBe('payout-mismatch');
    expect(String(err)).toMatch(/already signed/i);
    await mine(node.rpcUri, 1, await funder.getPrimaryAddress());
    expect((await e.buyer.sync()).unlocked).toBe(amount);
    expect(await received(node.rpcUri, buyerWallet)).toBe(0n);
  });

  it('a set built on stale signing data is a refused attempt, not a crash', async () => {
    // The seller builds on the buyer's first export; the buyer then exports again (fresh
    // nonces), so the old set can no longer be signed by the buyer.
    await pair(e.seller, e.buyer);
    const { txSet } = await e.seller.buildRelease(payouts);
    await pair(e.seller, e.buyer);
    const err = await e.buyer.signRelease(txSet, payouts).then(() => null, (x: unknown) => x);
    expect(err).toBeInstanceOf(EscrowError);
    expect((err as EscrowError).code).toBe('payout-mismatch');
    expect(String(err)).toMatch(/wallet refused to sign/);
    await pair(e.seller, e.buyer);
  });

  it('releases with the 1% fee as a second output; the network fee comes off the buyer', async () => {
    const { txSet, payouts: decoded } = await e.seller.buildRelease(payouts);
    expect(decoded).toHaveLength(2);
    const hash = await e.buyer.cosign(txSet, payouts);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    await mine(node.rpcUri, 12, await funder.getPrimaryAddress());
    expect(await received(node.rpcUri, feeWallet)).toBe(feeFor(amount));
    const got = await received(node.rpcUri, buyerWallet);
    expect(got).toBeLessThan(payouts[0]!.amountAtomic);
    expect(got).toBeGreaterThan(payouts[0]!.amountAtomic - MAX_NET_FEE);
    expect(await received(node.rpcUri, attacker)).toBe(0n);
  });

  it('taker pays nothing: a single payout sweeps the escrow, only once fully unlocked', async () => {
    const t = await setupEscrow(node.rpcUri);
    const buyer2 = await newTestWallet(node.rpcUri);
    try {
      await fund(node.rpcUri, funder, t, amount);
      // A top-up that is still locked: no release until all of it can be swept.
      await funder.createTx({ accountIndex: 0, address: t.address, amount: XMR / 100n, relay: true });
      await mine(node.rpcUri, 1, await funder.getPrimaryAddress());
      await t.seller.sync();
      await pair(t.seller, t.buyer);
      const single: Payout[] = [{ address: await buyer2.getPrimaryAddress(), amountAtomic: amount }];
      await expect(t.seller.buildRelease(single)).rejects.toThrow(/not-ready/);
      // Once unlocked, payouts that ignore the surplus are refused; the sweep must cover it.
      await mine(node.rpcUri, 11, await funder.getPrimaryAddress());
      for (const p of [t.buyer, t.seller]) await p.sync();
      await expect(t.seller.buildRelease(single)).rejects.toThrow(/bad-payouts/);
      await pair(t.seller, t.buyer);
      single[0] = { address: single[0]!.address, amountAtomic: amount + XMR / 100n };
      const { txSet } = await t.seller.buildRelease(single);
      await t.buyer.cosign(txSet, single);
      await mine(node.rpcUri, 12, await funder.getPrimaryAddress());
      const got = await received(node.rpcUri, buyer2);
      expect(got).toBeLessThan(single[0]!.amountAtomic);
      expect(got).toBeGreaterThan(single[0]!.amountAtomic - MAX_NET_FEE);
    } finally {
      await buyer2.close();
      for (const p of [t.buyer, t.seller, t.mod]) await p.close();
    }
  });
});
