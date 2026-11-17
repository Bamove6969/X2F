// A fake Monero chain and an in-memory relay for three REAL escrow parties (`runParty`), so the
// moderation watcher's proof can be tested over the real party protocol without regtest.
import type { Role } from '@x2f/core';
import { EscrowError, MAX_NETWORK_FEE, feeBearers, networkFeeShares, type EscrowEngine, type Incoming, type Outgoing, type Payout, type Transport } from '@x2f/escrow';
import type { Envelope } from '@x2f/protocol';

/** The tx on the fake chain that spends the escrow. */
export interface ChainTx {
  hash: string;
  height: number | null;
  key: string;
  payouts: Payout[];
  feeAtomic: bigint;
}

/**
 * Setup converges in one exchange. A release is built, signed and submitted as the Monero engine
 * does: the co-signer's submit puts the tx in the pool, `mine()` puts it in a block. The submitter's
 * and the builder's wallets show the sweep (the builder holds the key images after the export
 * round); the mod's only once it imported a trade party's post-release info (wallet2 computes the
 * key images then). `daemonDown`: those roles' daemon lookups (txStatus, txSeen) fail with
 * 'daemon-unavailable', as every one did in the web app before the fix of 8 Nov (monero-ts's
 * in-process HTTP client cannot send in the browser bundle); their wallets still work.
 * `daemonHang`: those roles' daemon lookups never answer at all (no reply, no error); `lookups`
 * counts every lookup each role started.
 */
export interface FakeChain {
  height: number;
  funded: { txHash: string; amountAtomic: bigint; height: number }[];
  sweep: ChainTx | null;
  shows: Record<Role, boolean>;
  daemonDown: Set<Role>;
  daemonHang: Set<Role>;
  lookups: Record<Role, number>;
  fund(amountAtomic: bigint): void;
  mine(n?: number): void;
  engine(role: Role): EscrowEngine;
}

export const NET_FEE = 30_000_000n;
export const SWEEP_HASH = 'f'.repeat(64);
const SWEEP_KEY = 'a1'.repeat(32);

export function fakeChain(): FakeChain {
  let exported = 0;
  const c: FakeChain = {
    height: 100,
    funded: [],
    sweep: null,
    shows: { buyer: false, seller: false, mod: false },
    daemonDown: new Set(),
    daemonHang: new Set(),
    lookups: { buyer: 0, seller: 0, mod: 0 },
    fund(amountAtomic) {
      c.funded.push({ txHash: String(c.funded.length + 1).repeat(64), amountAtomic, height: c.height });
    },
    mine(n = 1) {
      c.height += n;
      if (c.sweep && c.sweep.height === null) c.sweep.height = c.height - 1;
    },
    engine(role) {
      const total = (): bigint => c.funded.reduce((s, f) => s + f.amountAtomic, 0n);
      const spentHere = (): boolean => c.sweep !== null && c.sweep.height !== null && c.shows[role];
      const daemon = async (): Promise<void> => {
        c.lookups[role] += 1;
        if (c.daemonHang.has(role)) await new Promise<never>(() => {}); // never settles
        if (c.daemonDown.has(role)) throw new EscrowError('daemon-unavailable', 'tx lookup failed: o.default.Agent is not a constructor');
      };
      const session = {
        prepare: async () => `prep-${role}`,
        make: async () => `make-${role}`,
        exchange: async () => ({ hex: '', ready: true }),
        address: async () => '5'.padEnd(95, 'M'),
        sync: async () => {
          if (spentHere()) return { balance: 0n, unlocked: 0n };
          const unlocked = c.funded.filter((f) => c.height - f.height >= 10).reduce((s, f) => s + f.amountAtomic, 0n);
          return { balance: total(), unlocked };
        },
        incoming: async (): Promise<Incoming[]> =>
          c.funded.map((f) => ({ txHash: f.txHash, amountAtomic: f.amountAtomic, height: f.height, confirmations: c.height - f.height, unlocked: c.height - f.height >= 10 })),
        chainHeight: async () => c.height,
        outgoing: async (): Promise<Outgoing[]> => (c.sweep && c.shows[role] ? [{ txHash: c.sweep.hash, height: c.sweep.height, spentAtomic: total() }] : []),
        txKey: async (h: string) => (c.sweep?.hash === h && role !== 'mod' ? c.sweep.key : null),
        proveTx: async (h: string, key: string, addresses: string[]) => {
          const tx = c.sweep;
          if (!tx || tx.hash !== h || tx.key !== key) return null;
          // As a real tx: each fee-bearing output arrives short by its wallet2 share (owner 16 Nov).
          const shares = networkFeeShares(tx.feeAtomic, feeBearers(tx.payouts));
          const received = addresses.map((a) => tx.payouts.reduce((s, p, j) => (p.address === a ? s + p.amountAtomic - shares[j]! : s), 0n));
          return { inBlock: tx.height !== null, feeAtomic: tx.feeAtomic, received, spendsEscrow: c.shows[role] };
        },
        exportState: async () => {
          exported += 1;
          return exported.toString(16).padStart(8, '0');
        },
        importState: async () => {
          if (role === 'mod' && c.sweep !== null) c.shows.mod = true;
        },
        buildRelease: async (payouts: Payout[]) => ({ txSet: `set:${payouts.map((p) => `${p.address}=${p.amountAtomic}${p.bearsNetworkFee === true ? '*' : ''}`).join(',')}`, payouts, txKey: SWEEP_KEY }),
        checkRelease: async () => MAX_NETWORK_FEE,
        signRelease: async (txSet: string) => ({ signedHex: `signed:${txSet}`, txHash: SWEEP_HASH }),
        submit: async (signedHex: string) => {
          const payouts = signedHex.replace(/^signed:set:/, '').split(',').map((s) => {
            const [address, amount] = s.split('=');
            const bears = amount!.endsWith('*');
            return { address: address!, amountAtomic: BigInt(bears ? amount!.slice(0, -1) : amount!), ...(bears ? { bearsNetworkFee: true } : {}) };
          });
          c.sweep ??= { hash: SWEEP_HASH, height: null, key: SWEEP_KEY, payouts, feeAtomic: NET_FEE };
          c.shows.buyer = c.shows.seller = true;
          return c.sweep.hash;
        },
        txStatus: async (h: string) => {
          await daemon();
          return c.sweep?.hash !== h ? 'none' : c.sweep.height === null ? 'pool' : 'block';
        },
        txSeen: async (h: string) => {
          await daemon();
          return c.sweep?.hash === h && c.sweep.height !== null;
        },
        spentBy: async (h: string) => c.sweep?.hash === h && spentHere(),
        save: async () => ({ v: 1 as const, keys: 'k', cache: 'c' }),
        close: async () => undefined,
      };
      return { create: async () => session, resume: async () => session } as unknown as EscrowEngine;
    },
  };
  return c;
}

/** An in-memory relay for one escrow channel: every frame reaches the other roles (open() drops what is not sealed to them). */
export function memoryRelay(): { transport(role: Role): Transport } {
  const boxes = new Map<Role, { frames: unknown[]; waiter: ((f: unknown) => void) | null; closed: boolean }>();
  const box = (r: Role) => {
    let b = boxes.get(r);
    if (!b) boxes.set(r, (b = { frames: [], waiter: null, closed: false }));
    return b;
  };
  return {
    transport(role) {
      const mine = box(role);
      return {
        send: (e: Envelope) => {
          for (const r of ['buyer', 'seller', 'mod'] as const) {
            const b = box(r);
            if (r === role || b.closed) continue;
            const f = structuredClone(e);
            if (b.waiter) {
              const w = b.waiter;
              b.waiter = null;
              w(f);
            } else b.frames.push(f);
          }
        },
        next: () => (mine.frames.length > 0 ? Promise.resolve(mine.frames.shift()) : new Promise((resolve) => (mine.waiter = resolve))),
        onReconnect: () => {},
        close: () => {
          mine.closed = true;
        },
      };
    },
  };
}
