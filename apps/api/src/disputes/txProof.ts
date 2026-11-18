import { randomBytes } from 'node:crypto';
import { isTxKey } from '@x2f/escrow';
import { MoneroNetworkType, MoneroWalletConfig, MoneroWalletFull } from 'monero-ts';
import type { Config } from '../config.js';
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
}

/**
 * The production check. The tx's block comes from monerod's own `/get_transactions` (plain fetch,
 * pruned: only the block height and timestamp are read); the payment itself from monero-ts
 * `checkTxKey` on a throwaway in-memory wallet (random keys, never synced, never funded) connected to
 * the same node: wallet2's `check_tx_key` needs only the daemon, the tx key and the address.
 *
 * NEEDS_REGTEST_TX_PROOF (Plan 4 Task 12 step 3): `checkTxKey`'s `isGood`, `receivedAmount` and
 * `numConfirmations` are exercised on regtest only through the escrow's `proveTx`
 * (packages/escrow/src/monero.ts); this wallet's own regtest run is not written yet.
 *
 * The key is checked to be a list of reduced scalars first (`isTxKey`): anything else aborts
 * monero-ts's WebAssembly and breaks every later call. One check at a time.
 */
export function moneroTxProofCheck(o: MoneroTxProofOptions): TxProofCheck {
  const base = o.url.replace(/\/+$/, '');
  const fetch = o.fetch ?? globalThis.fetch;
  const timeoutMs = o.timeoutMs ?? 15_000;
  const slots = new Semaphore(1, 32);
  let wallet: Promise<MoneroWalletFull> | undefined;

  const walletOf = (): Promise<MoneroWalletFull> => {
    wallet ??= MoneroWalletFull.createWallet(
      new MoneroWalletConfig({
        networkType: NETWORKS[o.network],
        ...(o.regtest ? { regtest: true } : {}),
        password: randomBytes(24).toString('hex'),
        server: { uri: base, timeoutMs },
        proxyToWorker: false,
      }),
    );
    wallet.catch(() => {
      wallet = undefined;
    });
    return wallet;
  };

  const timed = async <T>(p: Promise<T>): Promise<T> => {
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

  return (a) =>
    slots.run(async () => {
      if (!TX_HASH.test(a.txHash) || !isTxKey(a.txKey) || typeof a.address !== 'string' || a.address === '') return null;
      const b = await block(a.txHash);
      if (b === null) return null;
      let w: MoneroWalletFull;
      try {
        w = await timed(walletOf());
      } catch {
        throw new TxProofUnavailable();
      }
      let c: Awaited<ReturnType<MoneroWalletFull['checkTxKey']>>;
      try {
        c = await timed(w.checkTxKey(a.txHash, a.txKey, a.address));
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
    });
}
