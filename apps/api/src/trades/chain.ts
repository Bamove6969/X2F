import { Semaphore } from '../limits.js';

/**
 * Confirmations of one settlement tx on X2F's own Monero node (spec 2.2 step 10, Task 24): a
 * count, `0` while the tx is in the pool, or null when the node does not know it. Throws when the
 * node cannot be asked; GET /v1/trades/:code/confirmations then answers null.
 */
export type TxConfirmations = (txHash: string) => Promise<number | null>;

/** The default with no node configured: the released screen shows that the count is not known. */
export const noConfirmations: TxConfirmations = async () => null;

const TX_HASH = /^[0-9a-f]{64}$/;

export interface DaemonOptions {
  /** The node's RPC base URL, e.g. http://127.0.0.1:18081 (monerod, --restricted-rpc is fine). */
  url: string;
  fetch?: typeof globalThis.fetch;
  /** Each call to the node (default 15 s, as every daemon call in Plan 3). */
  timeoutMs?: number;
  /** How long an answer is reused, so polling released screens cost the node one lookup (default 10 s). */
  cacheMs?: number;
  /** Answers kept at most (default 1000); the oldest goes first. */
  maxCached?: number;
  /** Lookups at the node at once (default 4), and waiting (default 64; more get 503 `busy`). */
  running?: number;
  queue?: number;
  now?: () => number;
}

/** A failed node call. The message is fixed: it never carries the node's URL or the tx hash. */
class DaemonError extends Error {
  constructor() {
    super('monero node lookup failed');
    this.name = 'DaemonError';
  }
}

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;

/**
 * A TxConfirmations over monerod's plain RPC: `/get_transactions` for the tx's block, and
 * `/get_height` for the chain height; confirmations = height − block height (Monero's own count).
 * Only a 64-hex hash is ever sent; anything else answers null without a call.
 */
export function daemonConfirmations(o: DaemonOptions): TxConfirmations {
  const base = o.url.replace(/\/+$/, '');
  const fetch = o.fetch ?? globalThis.fetch;
  const timeoutMs = o.timeoutMs ?? 15_000;
  const cacheMs = o.cacheMs ?? 10_000;
  const maxCached = o.maxCached ?? 1000;
  const now = o.now ?? Date.now;
  const slots = new Semaphore(o.running ?? 4, o.queue ?? 64);
  const cache = new Map<string, { at: number; value: Promise<number | null> }>();

  const call = async (path: string, body: unknown): Promise<Record<string, unknown>> => {
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new DaemonError();
    }
    if (!res.ok) throw new DaemonError();
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      throw new DaemonError();
    }
    if (data === null || typeof data !== 'object' || (data as { status?: unknown }).status !== 'OK') throw new DaemonError();
    return data as Record<string, unknown>;
  };

  const ask = async (txHash: string): Promise<number | null> => {
    const got = await call('/get_transactions', { txs_hashes: [txHash] });
    const txs = Array.isArray(got.txs) ? (got.txs as unknown[]) : [];
    const tx = txs[0] as { tx_hash?: unknown; in_pool?: unknown; block_height?: unknown } | undefined;
    if (tx === undefined) {
      if (Array.isArray(got.missed_tx) && got.missed_tx.includes(txHash)) return null;
      throw new DaemonError();
    }
    if (txs.length !== 1 || tx.tx_hash !== txHash) throw new DaemonError();
    if (tx.in_pool === true) return 0;
    if (!isCount(tx.block_height)) throw new DaemonError();
    const { height } = await call('/get_height', {});
    if (!isCount(height) || height <= tx.block_height) throw new DaemonError();
    return height - tx.block_height;
  };

  return (txHash) => {
    if (!TX_HASH.test(txHash)) return Promise.resolve(null);
    const t = now();
    const hit = cache.get(txHash);
    if (hit && t - hit.at < cacheMs) return hit.value;
    cache.delete(txHash);
    const value = slots.run(() => ask(txHash));
    cache.set(txHash, { at: t, value });
    // A failed lookup is not kept: the next poll asks again.
    value.catch(() => {
      if (cache.get(txHash)?.value === value) cache.delete(txHash);
    });
    while (cache.size > maxCached) cache.delete(cache.keys().next().value!);
    return value;
  };
}

/**
 * `X2F_MONEROD_URL`: X2F's own node for the released screen's confirmations (unset: the count is
 * not shown). An http(s) origin only, no credentials, path, query or fragment.
 */
export function monerodUrlFromEnv(env: Record<string, string | undefined>): string | null {
  const raw = env.X2F_MONEROD_URL;
  if (raw === undefined || raw === '') return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('config: X2F_MONEROD_URL is not a URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('config: X2F_MONEROD_URL must be http or https');
  if (u.username || u.password || (u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) {
    throw new Error('config: X2F_MONEROD_URL must be a bare origin (no credentials, path, query or fragment)');
  }
  return u.origin;
}
