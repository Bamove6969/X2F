// Review m3 (ruling compliance, 18 Nov): a monero-ts call that timed out keeps running on the one
// in-memory wallet, so the next check must not start on that wallet until it settles. monero-ts is
// a stand-in here: the real wallet is exercised on regtest (test/regtest/txProof.regtest.test.ts).
import { afterEach, describe, expect, it, vi } from 'vitest';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(v: T): void;
  reject(e: unknown): void;
}
const deferred = <T>(): Deferred<T> => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
  return { promise, resolve, reject };
};

/** Each checkTxKey call: when it started, and the answer it waits for. */
const calls: Array<{ txHash: string; answer: Deferred<unknown> }> = [];
let running = 0;
let overlapped = false;

vi.mock('monero-ts', () => {
  class MoneroWalletConfig {
    constructor(readonly o: unknown) {}
  }
  const wallet = {
    checkTxKey(txHash: string) {
      if (running > 0) overlapped = true;
      running++;
      const answer = deferred<unknown>();
      calls.push({ txHash, answer });
      return answer.promise.finally(() => running--);
    },
  };
  return {
    MoneroNetworkType: { MAINNET: 0, TESTNET: 1, STAGENET: 2 },
    MoneroWalletConfig,
    MoneroWalletFull: { createWallet: async () => wallet },
  };
});

const { moneroTxProofCheck, TxProofUnavailable } = await import('../../src/disputes/txProof.js');

const hash = (c: string) => c.repeat(64);
const KEY = 'a'.repeat(62) + '05';
const fetchOk: typeof globalThis.fetch = async (_url, init) => {
  const { txs_hashes } = JSON.parse(String(init!.body)) as { txs_hashes: string[] };
  return new Response(JSON.stringify({ status: 'OK', txs: [{ tx_hash: txs_hashes[0], in_pool: false, block_timestamp: 1_800_000_000 }] }), { status: 200 });
};
const good = (amount: bigint) => ({
  getIsGood: () => true,
  getReceivedAmount: () => amount,
  getInTxPool: () => false,
  getNumConfirmations: () => 12,
});
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(cond()).toBe(true);
};

afterEach(() => {
  calls.length = 0;
  running = 0;
  overlapped = false;
});

describe('moneroTxProofCheck (review m3): a timed-out wallet call never overlaps the next check', () => {
  it('the caller gets TxProofUnavailable at the timeout, but the next check waits for the stuck call to settle before it uses the wallet', async () => {
    const check = moneroTxProofCheck({ url: 'http://node.invalid', network: 'mainnet', fetch: fetchOk, timeoutMs: 40 });
    const address = '4' + 'B'.repeat(94);
    const first = check({ txHash: hash('1'), txKey: KEY, address });
    await expect(first).rejects.toBeInstanceOf(TxProofUnavailable);
    expect(calls.map((c) => c.txHash)).toEqual([hash('1')]);
    // The first call is still running on the wallet: the next check must not reach checkTxKey yet.
    const second = check({ txHash: hash('2'), txKey: KEY, address });
    await new Promise((r) => setTimeout(r, 120));
    expect(calls.map((c) => c.txHash)).toEqual([hash('1')]);
    expect(overlapped).toBe(false);
    // The stuck call settles (late, its answer unused): the second check runs and is answered.
    calls[0]!.answer.resolve(good(5n));
    await until(() => calls.length === 2);
    calls[1]!.answer.resolve(good(7n));
    await expect(second).resolves.toMatchObject({ good: true, receivedAtomic: 7n, confirmations: 12 });
    expect(overlapped).toBe(false);
  });

  it('a stuck call that fails when it settles frees the wallet just the same', async () => {
    const check = moneroTxProofCheck({ url: 'http://node.invalid', network: 'mainnet', fetch: fetchOk, timeoutMs: 40 });
    const address = '4' + 'B'.repeat(94);
    await expect(check({ txHash: hash('3'), txKey: KEY, address })).rejects.toBeInstanceOf(TxProofUnavailable);
    const next = check({ txHash: hash('4'), txKey: KEY, address });
    await new Promise((r) => setTimeout(r, 60));
    expect(calls).toHaveLength(1);
    calls[0]!.answer.reject(new Error('late failure'));
    await until(() => calls.length === 2);
    calls[1]!.answer.resolve(good(9n));
    await expect(next).resolves.toMatchObject({ receivedAtomic: 9n });
    expect(overlapped).toBe(false);
  });
});
