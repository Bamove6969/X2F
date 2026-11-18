// Plan 4 Task 12, step 3 (NEEDS_REGTEST_TX_PROOF): the API's real payment-proof check
// (disputes/txProof.ts `moneroTxProofCheck`: monero-ts checkTxKey on a throwaway in-memory wallet,
// and monerod's own /get_transactions for the block) on a real regtest chain, judged as the route
// judges it (comply.ts `judgeProof` against the trade's XMR and the dispute's opening). A correct
// payment is accepted at 10 confirmations; one atomic unit short is refused; the wrong address is
// refused; a key that does not fit is refused; a tx still in the pool waits.
import { fundedWallet, mine, newTestWallet, startRegtest, type Regtest } from '@x2f/regtest';
import type { MoneroWalletFull } from 'monero-ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COMPLY_CONFIRMATIONS, judgeProof } from '../../src/disputes/comply.js';
import { moneroTxProofCheck, type TxProofCheck } from '../../src/disputes/txProof.js';

/** The trade's XMR the ruling orders (0.5 XMR). */
const AMOUNT = 500_000_000_000n;

describe("the seller's payment proof on regtest (moneroTxProofCheck)", () => {
  let node: Regtest;
  let seller: MoneroWalletFull;
  let buyer: MoneroWalletFull;
  let other: MoneroWalletFull;
  let check: TxProofCheck;
  /** The dispute opened before any of these payments. */
  const openedAt = new Date(Date.now() - 3_600_000);

  /** The seller pays `to` exactly `amount`; returns the tx hash and its key. */
  async function pay(to: string, amount: bigint): Promise<{ txHash: string; txKey: string }> {
    const tx = await seller.createTx({ accountIndex: 0, address: to, amount, relay: true });
    const txHash = tx.getHash();
    const txKey = await seller.getTxKey(txHash);
    return { txHash, txKey };
  }

  beforeAll(async () => {
    node = await startRegtest();
    seller = await fundedWallet(node.rpcUri);
    buyer = await newTestWallet(node.rpcUri);
    other = await newTestWallet(node.rpcUri);
    check = moneroTxProofCheck({ url: node.rpcUri, network: 'mainnet', regtest: true });
  });

  afterAll(async () => {
    for (const w of [seller, buyer, other]) await w?.close();
    await node?.stop();
  });

  it('a correct payment waits in the pool, then is accepted at 10 confirmations; the wrong address and a wrong key are refused', async () => {
    const to = await buyer.getPrimaryAddress();
    const paid = await pay(to, AMOUNT);

    const pooled = await check({ ...paid, address: to });
    expect(pooled).toMatchObject({ good: true, receivedAtomic: AMOUNT, confirmations: 0, blockTimestamp: null });
    expect(judgeProof(pooled, AMOUNT, openedAt)).toBe('pending');

    await mine(node.rpcUri, COMPLY_CONFIRMATIONS, await other.getPrimaryAddress());
    const deep = await check({ ...paid, address: to });
    expect(deep).not.toBeNull();
    expect(deep!.good).toBe(true);
    expect(deep!.receivedAtomic).toBe(AMOUNT);
    expect(deep!.confirmations).toBeGreaterThanOrEqual(COMPLY_CONFIRMATIONS);
    expect(deep!.blockTimestamp).toBeInstanceOf(Date);
    expect(judgeProof(deep, AMOUNT, openedAt)).toBe('accepted');
    // A tx mined before the dispute opened is a replay.
    expect(judgeProof(deep, AMOUNT, new Date(deep!.blockTimestamp!.getTime() + 1000))).toBe('replayed');

    // The same tx, asked about another address: that address received nothing.
    const elsewhere = await check({ ...paid, address: await other.getPrimaryAddress() });
    expect(elsewhere === null || elsewhere.receivedAtomic === 0n).toBe(true);
    expect(judgeProof(elsewhere, AMOUNT, openedAt)).toBe('invalid');

    // A key of another tx does not fit this one.
    const second = await pay(to, AMOUNT);
    await mine(node.rpcUri, COMPLY_CONFIRMATIONS, await other.getPrimaryAddress());
    const wrongKey = await check({ txHash: paid.txHash, txKey: second.txKey, address: to });
    expect(judgeProof(wrongKey, AMOUNT, openedAt)).toBe('invalid');
  });

  it('a payment one atomic unit short is refused', async () => {
    const to = await buyer.getPrimaryAddress();
    await seller.sync();
    const short = await pay(to, AMOUNT - 1n);
    await mine(node.rpcUri, COMPLY_CONFIRMATIONS, await other.getPrimaryAddress());
    const r = await check({ ...short, address: to });
    expect(r).toMatchObject({ good: true, receivedAtomic: AMOUNT - 1n });
    expect(judgeProof(r, AMOUNT, openedAt)).toBe('invalid');
  });

  it('an unknown tx answers null, and a key that is not a reduced scalar never reaches monero-ts', async () => {
    const to = await buyer.getPrimaryAddress();
    expect(await check({ txHash: 'ab'.repeat(32), txKey: 'cd'.repeat(31) + '05', address: to })).toBeNull();
    expect(await check({ txHash: 'ab'.repeat(32), txKey: 'f'.repeat(64), address: to })).toBeNull();
    // The wallet still answers after that (a bad key would have aborted its WebAssembly).
    const ok = await pay(to, AMOUNT);
    await mine(node.rpcUri, COMPLY_CONFIRMATIONS, await other.getPrimaryAddress());
    expect(judgeProof(await check({ ...ok, address: to }), AMOUNT, openedAt)).toBe('accepted');
  });
});
