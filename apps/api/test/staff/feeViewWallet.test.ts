// Plan 4 Task 9: the fee wallet through its view-only key. The key comes from the environment only,
// never prints (JSON, string, inspect, a logged config) and never reaches an error message; the
// wallet must be view-only and be X2F_FEE_WALLET before it is read. No Monero network: the monero-ts
// wallet is a stand-in (`open`).
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { FeeViewWalletError, ViewKey, feeViewWallet, feeViewWalletFromEnv, type FeeViewWalletConfig, type ViewWalletHandle } from '../../src/staff/feeViewWallet.js';
import { fakeAddress } from '../helpers/trades.js';

// A valid scalar (reduced, non-zero): 0x01 followed by zeros, little-endian.
const KEY = '01' + '00'.repeat(31);
const ADDR = fakeAddress();
const MONEROD = 'http://127.0.0.1:18081';
const base = { feeWallet: ADDR, monerod: MONEROD, network: 'mainnet' as const };

describe('feeViewWalletFromEnv', () => {
  it('unset: none; set: the address, the key (redacted), the node and the restore height', () => {
    expect(feeViewWalletFromEnv({}, base)).toBeNull();
    expect(feeViewWalletFromEnv({ X2F_FEE_WALLET_VIEW_KEY: '  ' }, base)).toBeNull();
    const c = feeViewWalletFromEnv({ X2F_FEE_WALLET_VIEW_KEY: KEY.toUpperCase(), X2F_FEE_WALLET_RESTORE_HEIGHT: '3100000' }, base)!;
    expect(c).toMatchObject({ address: ADDR, restoreHeight: 3_100_000, monerod: MONEROD, network: 'mainnet' });
    expect(c.viewKey.reveal()).toBe(KEY);
    expect(feeViewWalletFromEnv({ X2F_FEE_WALLET_VIEW_KEY: KEY }, base)!.restoreHeight).toBe(0);
  });

  it('the key never prints: not in JSON, a string, inspect or a logged config', () => {
    const c = feeViewWalletFromEnv({ X2F_FEE_WALLET_VIEW_KEY: KEY }, base)!;
    expect(JSON.stringify(c)).not.toContain(KEY);
    expect(JSON.stringify(c)).toContain('[redacted]');
    expect(String(c.viewKey)).toBe('[redacted]');
    expect(`${c.viewKey}`).not.toContain(KEY);
    expect(inspect(c, { depth: 5, showHidden: true })).not.toContain(KEY);
    expect(Object.keys(c.viewKey)).toEqual([]);
  });

  it('refuses a malformed key, a missing fee wallet or node and a bad height, never echoing the key', () => {
    const order = 'edd3f55c1a631258d69cf7a2def9de1400000000000000000000000000000010'; // the group order: not reduced
    const cases: Array<[Record<string, string>, typeof base | Record<string, unknown>, RegExp]> = [
      [{ X2F_FEE_WALLET_VIEW_KEY: 'abc' }, base, /X2F_FEE_WALLET_VIEW_KEY is malformed/],
      [{ X2F_FEE_WALLET_VIEW_KEY: '00'.repeat(32) }, base, /X2F_FEE_WALLET_VIEW_KEY is malformed/],
      [{ X2F_FEE_WALLET_VIEW_KEY: order }, base, /X2F_FEE_WALLET_VIEW_KEY is malformed/],
      [{ X2F_FEE_WALLET_VIEW_KEY: KEY }, { ...base, feeWallet: null }, /X2F_FEE_WALLET is required/],
      [{ X2F_FEE_WALLET_VIEW_KEY: KEY }, { ...base, monerod: null }, /X2F_MONEROD_URL is required/],
      [{ X2F_FEE_WALLET_VIEW_KEY: KEY, X2F_FEE_WALLET_RESTORE_HEIGHT: '-1' }, base, /RESTORE_HEIGHT is malformed/],
      [{ X2F_FEE_WALLET_VIEW_KEY: KEY, X2F_FEE_WALLET_RESTORE_HEIGHT: '1e6' }, base, /RESTORE_HEIGHT is malformed/],
    ];
    for (const [env, a, re] of cases) {
      let msg = '';
      try {
        feeViewWalletFromEnv(env, a as typeof base);
      } catch (e) {
        msg = (e as Error).message;
      }
      expect(msg, JSON.stringify(env)).toMatch(re);
      expect(msg).not.toContain(KEY);
      if (env.X2F_FEE_WALLET_VIEW_KEY) expect(msg).not.toContain(env.X2F_FEE_WALLET_VIEW_KEY);
    }
  });
});

/** A stand-in monero-ts wallet: each transfer as [tx hash, amount, block timestamp (s) or null in the pool]. */
function fakeWallet(o: { viewOnly?: boolean; address?: string; transfers?: Array<[string | undefined, bigint, number | null]>; syncFails?: boolean } = {}) {
  const calls: string[] = [];
  const w: ViewWalletHandle = {
    isViewOnly: async () => (calls.push('isViewOnly'), o.viewOnly ?? true),
    getPrimaryAddress: async () => (calls.push('getPrimaryAddress'), o.address ?? ADDR),
    sync: async () => {
      calls.push('sync');
      if (o.syncFails) throw new Error(`could not reach ${MONEROD} with key ${KEY}`);
    },
    getIncomingTransfers: async (q) => {
      calls.push(`getIncomingTransfers:${JSON.stringify(q)}`);
      return (o.transfers ?? []).map(([hash, amount, ts]) => ({
        getAmount: () => amount,
        getTx: () => ({ getHash: () => hash, getIsConfirmed: () => ts !== null, getBlock: () => (ts === null ? undefined : { getTimestamp: () => ts }) }),
      }));
    },
  };
  return { w, calls };
}

const cfg = (): FeeViewWalletConfig => feeViewWalletFromEnv({ X2F_FEE_WALLET_VIEW_KEY: KEY, X2F_FEE_WALLET_RESTORE_HEIGHT: '10' }, base)!;
const errorOf = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as Error);

describe('feeViewWallet', () => {
  it('syncs, then lists the confirmed incoming transfers with their block time; opens the wallet once', async () => {
    const h1 = 'aa'.repeat(32);
    const h2 = 'bb'.repeat(32);
    const { w, calls } = fakeWallet({ transfers: [[h1, 5n, 1_793_000_000], [h2, 7n, null]] });
    const opened: FeeViewWalletConfig[] = [];
    const src = feeViewWallet(cfg(), { open: async (c) => (opened.push(c), w) });
    expect(await src.incoming()).toEqual([{ txHash: h1, at: new Date(1_793_000_000_000), atomic: 5n }]);
    await src.incoming();
    expect(opened).toHaveLength(1);
    expect(opened[0]!.restoreHeight).toBe(10);
    expect(calls.slice(0, 4)).toEqual(['isViewOnly', 'getPrimaryAddress', 'sync', 'getIncomingTransfers:{"txQuery":{"isConfirmed":true}}']);
  });

  it('refuses a wallet that could spend, or that is not X2F_FEE_WALLET, and tries to open again next time', async () => {
    const spend = feeViewWallet(cfg(), { open: async () => fakeWallet({ viewOnly: false }).w });
    expect(await errorOf(spend.incoming())).toMatchObject({ name: 'FeeViewWalletError', step: 'not-view-only' });
    const other = feeViewWallet(cfg(), { open: async () => fakeWallet({ address: fakeAddress() }).w });
    expect(await errorOf(other.incoming())).toMatchObject({ step: 'wrong-wallet' });
    let n = 0;
    const flaky = feeViewWallet(cfg(), {
      open: async () => {
        if (n++ === 0) throw new Error(`bad key ${KEY}`);
        return fakeWallet().w;
      },
    });
    const e = await errorOf(flaky.incoming());
    expect(e).toBeInstanceOf(FeeViewWalletError);
    expect(e!.message).not.toContain(KEY);
    await expect(flaky.incoming()).resolves.toEqual([]);
  });

  it('a failure is a fixed message: never the key or the node', async () => {
    const src = feeViewWallet(cfg(), { open: async () => fakeWallet({ syncFails: true }).w });
    const e = await errorOf(src.incoming());
    expect(e).toMatchObject({ step: 'sync', message: 'fee view wallet: sync failed' });
    expect(inspect(e)).not.toContain(KEY);
    expect(inspect(e)).not.toContain(MONEROD);
    const bad = feeViewWallet(cfg(), { open: async () => fakeWallet({ transfers: [[undefined, 5n, 1_793_000_000]] }).w });
    expect(await errorOf(bad.incoming())).toMatchObject({ step: 'read' });
  });

  it('ViewKey is a holder whose only way out is reveal()', () => {
    const k = new ViewKey(KEY);
    expect(k.reveal()).toBe(KEY);
    expect(JSON.stringify({ k })).toBe('{"k":"[redacted]"}');
  });
});
