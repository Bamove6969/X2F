import { randomBytes } from 'node:crypto';
import { isTxKey } from '@x2f/escrow';
import { MoneroNetworkType, MoneroWalletConfig, MoneroWalletFull } from 'monero-ts';
import type { Config } from '../config.js';
import { ApiError } from '../errors.js';
import { Semaphore } from '../limits.js';

/**
 * Plan 4 Task 12, after-refund compliance (A6): what one tx provably paid one address, checked on
 * X2F's own Monero node with the tx's secret key (monero `check_tx_key`). The seller of a
 * `seller-sends-xmr` ruling sends the buyer the trade's XMR and submits the tx hash and its key; the
 * API checks them here against the trade's buyer payout address and amount (disputes/comply.ts).
 *
 * - `good`: the key fits the tx (wallet2's `check_tx_key` answered at all with this key).
 * - `receivedAtomic`: what the address received in the tx (0 when it received nothing: a payment to
 *   another address).
 * - `confirmations`: 0 while the tx is in the pool.
 * - `blockTimestamp`: the time of the block that holds it (null while in the pool), from the node.
 *
 * Null: the tx is unknown to the node, the key does not fit, or the address is not one of this
 * network's. Throws `TxProofUnavailable` when the node cannot be asked (the route answers 503).
 */
export interface TxProofResult {
  good: boolean;
  receivedAtomic: bigint;
  confirmations: number;
  blockTimestamp: Date | null;
}

export type TxProofCheck = (a: { txHash: string; txKey: string; address: string }) => Promise<TxProofResult | null>;

/** A failed node call. The message is fixed: it never carries the node's URL, the tx or the key. */
export class TxProofUnavailable extends Error {
  constructor() {
    super('monero node check failed');
    this.name = 'TxProofUnavailable';
  }
}

export const TX_HASH = /^[0-9a-f]{64}$/;

/** No node configured: every check is unavailable (503), never a pass. */
export const noTxProofCheck: TxProofCheck = async () => {
  throw new TxProofUnavailable();
};

const NETWORKS: Record<Config['moneroNetwork'], MoneroNetworkType> = {
  mainnet: MoneroNetworkType.MAINNET,
  stagenet: MoneroNetworkType.STAGENET,
  testnet: MoneroNetworkType.TESTNET,
};

/**
 * The watchdog (re-review m3 follow-up): a check whose monero-ts calls have not all settled this long
 * after it took the slot (the call timeout plus a grace period) gives up on its wallet. The wallet is
 * a throwaway (random keys, never funded, never synced): it is dropped and closed in the background,
 * the slot is freed and the next check builds a fresh one.
 */
export const TX_PROOF_STUCK_AFTER_MS = 5 * 60_000;
/** After this many abandoned wallets no new one is made: every check is 503 `busy` until a restart (a wedged WASM runtime must not leak without bound). */
export const TX_PROOF_MAX_ABANDONED = 3;
/** Re-review w1: a check that finishes in time this long after the last abandoned wallet resets the count (unrelated stalls months apart never add up to the cap). */
export const TX_PROOF_ABANDON_RESET_MS = 24 * 3_600_000;

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;

export interface MoneroTxProofOptions {
  /** X2F's node (X2F_MONEROD_URL, a bare origin). */
  url: string;
  network: Config['moneroNetwork'];
  /** monerod is regtest (mainnet address format). */
  regtest?: boolean;
  fetch?: typeof globalThis.fetch;
  /** Each call to the node (default 15 s). */
  timeoutMs?: number;
  /** The watchdog, from when a check takes the slot (default TX_PROOF_STUCK_AFTER_MS). */
  stuckAfterMs?: number;
  /** Called once per stuck episode, when the first wallet of it is abandoned (main.ts: the owner alert). Must not throw. */
  onStuck?: () => void;
  /** Called once, when the TX_PROOF_MAX_ABANDONED-th wallet is abandoned: from then on every check is 503 until a restart (re-review w1). Must not throw. */
  onStopped?: () => void;
  /** For the count's 24-hour reset only (default the system clock). */
  clock?: () => Date;
}

/**
 * The production check. The tx's block comes from monerod's own `/get_transactions` (plain fetch,
 * pruned: only the block height and timestamp are read); the payment itself from monero-ts
 * `checkTxKey` on a throwaway in-memory wallet (random keys, never synced, never funded) connected to
 * the same node: wallet2's `check_tx_key` needs only the daemon, the tx key and the address.
 *
 * Plan 4 Task 12 step 3 (was NEEDS_REGTEST_TX_PROOF): this check runs against a real regtest
 * monerod in test/regtest/txProof.regtest.test.ts.
 *
 * The key is checked to be a list of reduced scalars first (`isTxKey`): anything else aborts
 * monero-ts's WebAssembly and breaks every later call. One check at a time, on the one wallet: a
 * monero-ts call that timed out keeps running inside the wallet, so the check's slot is held until
 * every call it started has settled, though its caller is answered `TxProofUnavailable` at the
 * timeout (review m3). The next check waits in the queue (32, then 503 `busy`) until then, but
 * never longer than the watchdog (`stuckAfterMs`): a call still running then is abandoned with its
 * wallet. After TX_PROOF_MAX_ABANDONED wallets every check is 503 `busy` until a restart. A stuck
 * episode calls `onStuck` once; it ends when a check that used the wallet finishes in time. Reaching
 * the cap calls `onStopped` once. A check that finishes in time TX_PROOF_ABANDON_RESET_MS or more
 * after the last abandoned wallet resets the count to 0 (re-review w1); once at the cap nothing runs,
 * so only a restart clears it.
 */
export function moneroTxProofCheck(o: MoneroTxProofOptions): TxProofCheck {
  const base = o.url.replace(/\/+$/, '');
  const fetch = o.fetch ?? globalThis.fetch;
  const timeoutMs = o.timeoutMs ?? 15_000;
  const stuckAfterMs = o.stuckAfterMs ?? TX_PROOF_STUCK_AFTER_MS;
  const slots = new Semaphore(1, 32);
  let wallet: Promise<MoneroWalletFull> | undefined;
  let abandoned = 0;
  let stuck = false;
  let lastAbandonAt = 0;
  const clock = o.clock ?? (() => new Date());
  const fire = (f: (() => void) | undefined): void => {
    try {
      f?.();
    } catch {
      // the alert is best effort; the checker goes on
    }
  };

  const walletOf = (): Promise<MoneroWalletFull> => {
    if (wallet !== undefined) return wallet;
    const made = MoneroWalletFull.createWallet(
      new MoneroWalletConfig({
        networkType: NETWORKS[o.network],
        ...(o.regtest ? { regtest: true } : {}),
        password: randomBytes(24).toString('hex'),
        server: { uri: base, timeoutMs },
        proxyToWorker: false,
      }),
    );
    wallet = made;
    made.catch(() => {
      // Only this attempt: never a fresh wallet made after this one was abandoned.
      if (wallet === made) wallet = undefined;
    });
    return made;
  };

  /** The watchdog fired: drop the current wallet, close it in the background, count it. */
  const abandon = (): void => {
    abandoned++;
    lastAbandonAt = clock().getTime();
    const w = wallet;
    wallet = undefined;
    void w?.then((x) => x.close()).catch(() => undefined);
    if (!stuck) {
      stuck = true;
      fire(o.onStuck);
    }
    if (abandoned === TX_PROOF_MAX_ABANDONED) fire(o.onStopped);
  };

  /** A check used the wallet and finished in time: the episode is over; a long healthy stretch clears the count. */
  const healthy = (): void => {
    stuck = false;
    if (abandoned > 0 && clock().getTime() - lastAbandonAt >= TX_PROOF_ABANDON_RESET_MS) abandoned = 0;
  };

  /** `p`, or TxProofUnavailable after timeoutMs; `p` itself goes in `held`, waited out before the slot is freed. */
  const timed = async <T>(p: Promise<T>, held: Promise<unknown>[]): Promise<T> => {
    held.push(p);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([p, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new TxProofUnavailable()), timeoutMs)))]);
    } finally {
      clearTimeout(timer);
    }
  };

  /** The tx's block on the node: null when it does not know the tx. */
  const block = async (txHash: string): Promise<{ inPool: boolean; timestamp: Date | null } | null> => {
    let data: unknown;
    try {
      const res = await fetch(`${base}/get_transactions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ txs_hashes: [txHash], prune: true }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new TxProofUnavailable();
      data = await res.json();
    } catch {
      throw new TxProofUnavailable();
    }
    const got = data as { status?: unknown; txs?: unknown; missed_tx?: unknown } | null;
    if (got === null || typeof got !== 'object' || got.status !== 'OK') throw new TxProofUnavailable();
    const txs = Array.isArray(got.txs) ? (got.txs as unknown[]) : [];
    const tx = txs[0] as { tx_hash?: unknown; in_pool?: unknown; block_timestamp?: unknown } | undefined;
    if (tx === undefined) {
      if (Array.isArray(got.missed_tx) && got.missed_tx.includes(txHash)) return null;
      throw new TxProofUnavailable();
    }
    if (txs.length !== 1 || tx.tx_hash !== txHash) throw new TxProofUnavailable();
    if (tx.in_pool === true) return { inPool: true, timestamp: null };
    if (!isCount(tx.block_timestamp) || tx.block_timestamp === 0) throw new TxProofUnavailable();
    return { inPool: false, timestamp: new Date(tx.block_timestamp * 1000) };
  };

  const checkOne = async (a: { txHash: string; txKey: string; address: string }, held: Promise<unknown>[]): Promise<TxProofResult | null> => {
    if (!TX_HASH.test(a.txHash) || !isTxKey(a.txKey) || typeof a.address !== 'string' || a.address === '') return null;
    const b = await block(a.txHash);
    if (b === null) return null;
    let w: MoneroWalletFull;
    try {
      w = await timed(walletOf(), held);
    } catch {
      throw new TxProofUnavailable();
    }
    let c: Awaited<ReturnType<MoneroWalletFull['checkTxKey']>>;
    try {
      c = await timed(w.checkTxKey(a.txHash, a.txKey, a.address), held);
    } catch (e) {
      if (e instanceof TxProofUnavailable) throw e;
      return null; // a key that does not fit, or an address of another network
    }
    const confirmations = b.inPool || c.getInTxPool() === true ? 0 : c.getNumConfirmations();
    return {
      good: c.getIsGood() === true,
      receivedAtomic: c.getReceivedAmount() ?? 0n,
      confirmations: isCount(confirmations) ? confirmations : 0,
      blockTimestamp: b.inPool ? null : b.timestamp,
    };
  };

  const busy = () => new ApiError(503, 'busy');

  return (a) =>
    new Promise<TxProofResult | null>((resolve, reject) => {
      if (abandoned >= TX_PROOF_MAX_ABANDONED) {
        reject(busy());
        return;
      }
      slots
        .run(async () => {
          // A check that waited in the queue while the last wallet allowed was abandoned.
          if (abandoned >= TX_PROOF_MAX_ABANDONED) throw busy();
          const started = Date.now();
          const held: Promise<unknown>[] = [];
          const answer = checkOne(a, held);
          // The caller has its answer now (at the timeout, at the latest) ...
          answer.then(resolve, reject);
          await answer.catch(() => undefined);
          // ... but the wallet is free for the next check only once every call it started has
          // settled (review m3), or the watchdog gives up on that wallet.
          let timer: ReturnType<typeof setTimeout> | undefined;
          const watchdog = new Promise<'stuck'>((r) => (timer = setTimeout(() => r('stuck'), Math.max(0, stuckAfterMs - (Date.now() - started)))));
          const outcome = await Promise.race([Promise.allSettled(held).then(() => 'settled' as const), watchdog]);
          clearTimeout(timer);
          if (outcome === 'stuck') abandon();
          else if (held.length > 0) healthy();
        })
        // The queue was full (503 `busy`): checkOne never ran.
        .catch(reject);
    });
}
