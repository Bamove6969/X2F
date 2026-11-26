import { randomBytes } from 'node:crypto';
import { isScalar } from '@x2f/escrow';
import { MoneroNetworkType, MoneroWalletConfig, MoneroWalletFull } from 'monero-ts';
import type { Config } from '../config.js';
import type { IncomeSource, IncomingTransfer } from './earnings.js';

/**
 * Plan 4 Task 9: X2F's fee wallet (wallet 1, `X2F_FEE_WALLET`) as the server sees it, through its
 * VIEW-ONLY key. The owner's choice: the server holds the private view key, which shows what
 * arrived in the wallet and can never spend it; the spend key stays offline. Used only for the
 * owner's earnings (`earnings.ts`).
 *
 * The key:
 * - comes from `X2F_FEE_WALLET_VIEW_KEY` (64 hex, the wallet's private view key) and nowhere else;
 *   main.ts deletes the variable from the process environment once it is read;
 * - is held in a `ViewKey`, whose JSON, string and inspect forms are `[redacted]`, so a logged
 *   config or error never carries it, and it leaves the object only to open the wallet;
 * - is never in an answer, an error message or a log line here: every failure is a
 *   `FeeViewWalletError` with a fixed message (monero-ts's own message is dropped).
 *
 * The wallet is an in-memory monero-ts `MoneroWalletFull` restored from the address and the view
 * key alone (never saved to disk, a random password), synced against X2F's own node
 * (`X2F_MONEROD_URL`) from `X2F_FEE_WALLET_RESTORE_HEIGHT`. It is checked to be view-only and to be
 * `X2F_FEE_WALLET` before it is read.
 */

/** A private view key that never prints. */
export class ViewKey {
  readonly #hex: string;
  constructor(hex: string) {
    this.#hex = hex;
  }
  /** The key itself, only to open the wallet. */
  reveal(): string {
    return this.#hex;
  }
  toJSON(): string {
    return '[redacted]';
  }
  toString(): string {
    return '[redacted]';
  }
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return 'ViewKey [redacted]';
  }
}

export interface FeeViewWalletConfig {
  /** `X2F_FEE_WALLET`. */
  address: string;
  viewKey: ViewKey;
  /** `X2F_FEE_WALLET_RESTORE_HEIGHT`: the block height to scan from (default 0, the whole chain). */
  restoreHeight: number;
  /** `X2F_MONEROD_URL`. */
  monerod: string;
  network: Config['moneroNetwork'];
}

const HEX64 = /^[0-9a-fA-F]{64}$/;

/**
 * `X2F_FEE_WALLET_VIEW_KEY` unset or empty: no view-only fee wallet (the earnings show the payroll
 * wallet and the books alone). Set: it must be 64 hex characters encoding a valid key, and it needs
 * `X2F_FEE_WALLET` and `X2F_MONEROD_URL`. Errors name the variable, never its value.
 */
export function feeViewWalletFromEnv(
  env: Record<string, string | undefined>,
  a: { feeWallet: string | null | undefined; monerod: string | null; network: Config['moneroNetwork'] },
): FeeViewWalletConfig | null {
  const raw = env.X2F_FEE_WALLET_VIEW_KEY?.trim() ?? '';
  if (raw === '') return null;
  const hex = raw.toLowerCase();
  if (!HEX64.test(raw) || !isScalar(hex)) throw new Error('config: X2F_FEE_WALLET_VIEW_KEY is malformed (the fee wallet\'s private view key, 64 hex characters)');
  if (a.feeWallet == null) throw new Error('config: X2F_FEE_WALLET is required with X2F_FEE_WALLET_VIEW_KEY');
  if (a.monerod === null) throw new Error('config: X2F_MONEROD_URL is required with X2F_FEE_WALLET_VIEW_KEY (the node the view-only wallet syncs from)');
  const h = env.X2F_FEE_WALLET_RESTORE_HEIGHT?.trim() ?? '';
  const restoreHeight = h === '' ? 0 : Number(h);
  if (!/^\d{1,9}$/.test(h === '' ? '0' : h) || !Number.isSafeInteger(restoreHeight)) throw new Error('config: X2F_FEE_WALLET_RESTORE_HEIGHT is malformed (a block height)');
  return { address: a.feeWallet, viewKey: new ViewKey(hex), restoreHeight, monerod: a.monerod, network: a.network };
}

/** A failed read of the view-only wallet. The message is fixed: never the key, the address or the node. */
export class FeeViewWalletError extends Error {
  constructor(readonly step: 'open' | 'not-view-only' | 'wrong-wallet' | 'sync' | 'read') {
    super(`fee view wallet: ${step} failed`);
    this.name = 'FeeViewWalletError';
  }
}

const NETWORKS: Record<Config['moneroNetwork'], MoneroNetworkType> = {
  mainnet: MoneroNetworkType.MAINNET,
  stagenet: MoneroNetworkType.STAGENET,
  testnet: MoneroNetworkType.TESTNET,
};

/** What this module uses of a monero-ts wallet (tests pass a stand-in). */
export interface ViewWalletHandle {
  isViewOnly(): Promise<boolean>;
  getPrimaryAddress(): Promise<string>;
  sync(): Promise<unknown>;
  getIncomingTransfers(query: { txQuery: { isConfirmed: true } }): Promise<
    Array<{ getAmount(): bigint | undefined; getTx(): { getHash(): string | undefined; getIsConfirmed(): boolean | undefined; getBlock(): { getTimestamp(): number | undefined } | undefined } }>
  >;
}

export interface FeeViewWalletOptions {
  /** monerod is regtest (mainnet address format; the regtest test). */
  regtest?: boolean;
  /** Each call to the node (default 30 s). */
  timeoutMs?: number;
  /** Opens the wallet (default: an in-memory monero-ts MoneroWalletFull from the address and the view key). */
  open?: (config: FeeViewWalletConfig) => Promise<ViewWalletHandle>;
}

function openMonero(o: FeeViewWalletOptions): (c: FeeViewWalletConfig) => Promise<ViewWalletHandle> {
  return async (c) =>
    MoneroWalletFull.createWallet(
      new MoneroWalletConfig({
        networkType: NETWORKS[c.network],
        ...(o.regtest ? { regtest: true } : {}),
        primaryAddress: c.address,
        privateViewKey: c.viewKey.reveal(),
        restoreHeight: c.restoreHeight,
        password: randomBytes(24).toString('hex'),
        server: { uri: c.monerod, timeoutMs: o.timeoutMs ?? 30_000 },
        proxyToWorker: false,
      }),
    );
}

/**
 * The fee wallet as an `IncomeSource`: each `incoming()` syncs the view-only wallet to the node's
 * tip and lists every confirmed incoming transfer (each with its block's time). The wallet is
 * opened on the first read and kept; a read that fails to open it tries again next time. One read
 * at a time (the earnings watch never overlaps them).
 */
export function feeViewWallet(config: FeeViewWalletConfig, o: FeeViewWalletOptions = {}): IncomeSource {
  const open = o.open ?? openMonero(o);
  let wallet: Promise<ViewWalletHandle> | null = null;
  const walletOf = (): Promise<ViewWalletHandle> => {
    if (wallet !== null) return wallet;
    const made = (async () => {
      let w: ViewWalletHandle;
      try {
        w = await open(config);
      } catch {
        throw new FeeViewWalletError('open');
      }
      // A wallet that could spend is never what this reads: the key given must be a view key alone.
      if ((await w.isViewOnly().catch(() => false)) !== true) throw new FeeViewWalletError('not-view-only');
      if ((await w.getPrimaryAddress().catch(() => null)) !== config.address) throw new FeeViewWalletError('wrong-wallet');
      return w;
    })();
    wallet = made;
    made.catch(() => {
      if (wallet === made) wallet = null;
    });
    return made;
  };
  return {
    async incoming() {
      const w = await walletOf();
      try {
        await w.sync();
      } catch {
        throw new FeeViewWalletError('sync');
      }
      let list: Awaited<ReturnType<ViewWalletHandle['getIncomingTransfers']>>;
      try {
        list = await w.getIncomingTransfers({ txQuery: { isConfirmed: true } });
      } catch {
        throw new FeeViewWalletError('read');
      }
      const out: IncomingTransfer[] = [];
      for (const t of list) {
        const tx = t.getTx();
        if (tx.getIsConfirmed() !== true) continue;
        const txHash = tx.getHash();
        const atomic = t.getAmount();
        const ts = tx.getBlock()?.getTimestamp();
        if (typeof txHash !== 'string' || typeof atomic !== 'bigint' || typeof ts !== 'number' || !Number.isSafeInteger(ts) || ts <= 0) {
          throw new FeeViewWalletError('read');
        }
        if (atomic <= 0n) continue;
        out.push({ txHash, at: new Date(ts * 1000), atomic });
      }
      return out;
    },
  };
}
