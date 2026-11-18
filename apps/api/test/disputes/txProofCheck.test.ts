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

/** Each checkTxKey call: the wallet it ran on, and the answer it waits for. */
const calls: Array<{ txHash: string; wallet: number; answer: Deferred<unknown> }> = [];
/** Every wallet created (in order): how many calls run on it now, and how often it was closed. */
const wallets: Array<{ running: number; closed: number }> = [];
/** Two calls ran on one wallet at the same time. */
let overlapped = false;

vi.mock('monero-ts', () => {
  class MoneroWalletConfig {
    constructor(readonly o: unknown) {}
  }
  const createWallet = async () => {
    const id = wallets.length;
    const state = { running: 0, closed: 0 };
    wallets.push(state);
    return {
      checkTxKey(txHash: string) {
        if (state.running > 0) overlapped = true;
        state.running++;
        const answer = deferred<unknown>();
        calls.push({ txHash, wallet: id, answer });
        return answer.promise.finally(() => state.running--);
      },
      async close() {
        state.closed++;
      },
    };
  };
  return {
    MoneroNetworkType: { MAINNET: 0, TESTNET: 1, STAGENET: 2 },
    MoneroWalletConfig,
    MoneroWalletFull: { createWallet },
  };
});

const { moneroTxProofCheck, TxProofUnavailable, TX_PROOF_MAX_ABANDONED } = await import('../../src/disputes/txProof.js');
const { ApiError } = await import('../../src/errors.js');

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
  wallets.length = 0;
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

describe('moneroTxProofCheck watchdog (re-review m3 follow-up): a call that never settles', () => {
  const address = '4' + 'B'.repeat(94);
  const mk = (onStuck = vi.fn()) => ({
    onStuck,
    check: moneroTxProofCheck({ url: 'http://node.invalid', network: 'mainnet', fetch: fetchOk, timeoutMs: 30, stuckAfterMs: 120, onStuck }),
  });

  it('holds the slot until stuckAfterMs, then abandons the wallet (closed in the background) and the next check runs on a fresh one; the owner hook fires once', async () => {
    const { check, onStuck } = mk();
    await expect(check({ txHash: hash('1'), txKey: KEY, address })).rejects.toBeInstanceOf(TxProofUnavailable);
    const next = check({ txHash: hash('2'), txKey: KEY, address });
    await new Promise((r) => setTimeout(r, 40));
    // Still inside the grace period: the stuck call keeps its wallet and the slot.
    expect(calls).toHaveLength(1);
    expect(onStuck).not.toHaveBeenCalled();
    await until(() => calls.length === 2);
    expect(calls.map((c) => c.wallet)).toEqual([0, 1]);
    await until(() => wallets[0]!.closed === 1);
    expect(onStuck).toHaveBeenCalledTimes(1);
    calls[1]!.answer.resolve(good(7n));
    await expect(next).resolves.toMatchObject({ receivedAtomic: 7n });
    expect(overlapped).toBe(false);
    // The abandoned call settling late changes nothing.
    calls[0]!.answer.resolve(good(5n));
    expect(onStuck).toHaveBeenCalledTimes(1);
  });

  it(`after ${3} abandoned wallets it stops making new ones and answers 503 busy until a restart; one alert for the whole episode`, async () => {
    expect(TX_PROOF_MAX_ABANDONED).toBe(3);
    const { check, onStuck } = mk();
    for (let i = 0; i < TX_PROOF_MAX_ABANDONED; i++) {
      await expect(check({ txHash: hash(String(i + 1)), txKey: KEY, address })).rejects.toBeInstanceOf(TxProofUnavailable);
      await until(() => wallets[i]?.closed === 1);
    }
    expect(wallets).toHaveLength(TX_PROOF_MAX_ABANDONED);
    for (const h of ['a', 'b']) {
      const r = check({ txHash: hash(h), txKey: KEY, address });
      await expect(r).rejects.toBeInstanceOf(ApiError);
      await expect(r).rejects.toMatchObject({ status: 503, code: 'busy' });
    }
    expect(wallets).toHaveLength(TX_PROOF_MAX_ABANDONED);
    expect(calls).toHaveLength(TX_PROOF_MAX_ABANDONED);
    expect(onStuck).toHaveBeenCalledTimes(1);
  });

  it('a check that finishes in time ends the episode: the next stuck call alerts again', async () => {
    const { check, onStuck } = mk();
    await expect(check({ txHash: hash('1'), txKey: KEY, address })).rejects.toBeInstanceOf(TxProofUnavailable);
    await until(() => wallets[0]?.closed === 1);
    expect(onStuck).toHaveBeenCalledTimes(1);
    const ok = check({ txHash: hash('2'), txKey: KEY, address });
    await until(() => calls.length === 2);
    calls[1]!.answer.resolve(good(1n));
    await expect(ok).resolves.toMatchObject({ receivedAtomic: 1n });
    await expect(check({ txHash: hash('3'), txKey: KEY, address })).rejects.toBeInstanceOf(TxProofUnavailable);
    await until(() => onStuck.mock.calls.length === 2);
  });
});

describe('moneroTxProofCheck watchdog, re-review w1: the abandoned count decays, and reaching the cap alerts', () => {
  const address = '4' + 'B'.repeat(94);
  let now = Date.parse('2026-11-18T12:00:00Z');
  const H = 3_600_000;
  const mk = () => {
    const onStuck = vi.fn();
    const onStopped = vi.fn();
    const check = moneroTxProofCheck({
      url: 'http://node.invalid', network: 'mainnet', fetch: fetchOk, timeoutMs: 30, stuckAfterMs: 120, onStuck, onStopped, clock: () => new Date(now),
    });
    return { check, onStuck, onStopped };
  };
  /** One check whose wallet call never settles: abandoned by the watchdog. */
  const stall = async (check: ReturnType<typeof mk>['check'], h: string) => {
    const n = wallets.length;
    await expect(check({ txHash: hash(h), txKey: KEY, address })).rejects.toBeInstanceOf(TxProofUnavailable);
    await until(() => wallets[n]?.closed === 1);
  };
  /** One check that finishes in time. */
  const healthy = async (check: ReturnType<typeof mk>['check'], h: string) => {
    const n = calls.length;
    const r = check({ txHash: hash(h), txKey: KEY, address });
    await until(() => calls.length === n + 1);
    calls[n]!.answer.resolve(good(1n));
    await expect(r).resolves.toMatchObject({ receivedAtomic: 1n });
  };

  it('24 h of healthy checks after the last abandoned wallet reset the count: three more stalls are needed to stop', async () => {
    const { check, onStopped } = mk();
    await stall(check, '1');
    await stall(check, '2');
    now += 24 * H;
    await healthy(check, '3');
    await stall(check, '4');
    await stall(check, '5');
    // Without the reset this would be the fourth abandoned wallet, past the cap: still checking.
    await healthy(check, '6');
    expect(onStopped).not.toHaveBeenCalled();
  });

  it('a healthy check inside 24 h resets nothing: the third stall reaches the cap; tx-proof-check-stopped fires once, there', async () => {
    const { check, onStuck, onStopped } = mk();
    await stall(check, '1');
    await stall(check, '2');
    expect(onStopped).not.toHaveBeenCalled();
    now += 24 * H - 60_000;
    await healthy(check, '3');
    await stall(check, '4');
    expect(onStopped).toHaveBeenCalledTimes(1);
    await expect(check({ txHash: hash('5'), txKey: KEY, address })).rejects.toMatchObject({ status: 503, code: 'busy' });
    // Healthy time passing changes nothing once stopped: only a restart.
    now += 48 * H;
    await expect(check({ txHash: hash('6'), txKey: KEY, address })).rejects.toMatchObject({ status: 503, code: 'busy' });
    expect(onStopped).toHaveBeenCalledTimes(1);
    // The healthy check ended the first episode, so the stall after it alerted again.
    expect(onStuck).toHaveBeenCalledTimes(2);
  });
});
