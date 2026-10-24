import { describe, expect, test } from 'vitest';
import type { Incoming } from '@x2f/escrow';
import {
  WATCH_CLOSED_DAYS,
  WATCH_INTERVAL_MS,
  newWatchState,
  settleKindFor,
  watchStep,
  type EscrowFunds,
  type SpendEvidence,
  type TradeState,
  type WatchState,
} from '../src/index.js';

const T0 = new Date('2026-10-18T12:00:00.000Z');
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
const DAY_MIN = 24 * 60;
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const SETTLE = 'c'.repeat(64);
const LATE = 'd'.repeat(64);

const inc = (txHash: string, amountAtomic: bigint, confirmations: number): Incoming => ({
  txHash,
  amountAtomic,
  confirmations,
  unlocked: confirmations >= 10,
});
const funds = (incoming: Incoming[], balance?: bigint, unlocked?: bigint): EscrowFunds => {
  const sum = incoming.reduce((s, i) => s + i.amountAtomic, 0n);
  const un = incoming.filter((i) => i.unlocked).reduce((s, i) => s + i.amountAtomic, 0n);
  return { balance: balance ?? sum, unlocked: unlocked ?? un, incoming };
};

function step(o: { state?: WatchState; apiState?: TradeState; f: EscrowFunds; spend?: SpendEvidence | null; now?: Date }) {
  return watchStep({
    trade: { state: o.apiState ?? 'funding' },
    funds: o.f,
    spend: o.spend ?? null,
    state: o.state ?? newWatchState(),
    now: o.now ?? at(0),
  });
}

describe('chain watcher decisions (Task 9, pure)', () => {
  test('polls every 15 s and keeps closed escrows for 30 days', () => {
    expect(WATCH_INTERVAL_MS).toBe(15_000);
    expect(WATCH_CLOSED_DAYS).toBe(30);
  });

  test('reports chain facts: balance, unlocked and the lowest confirmations among incoming', () => {
    const r = step({ f: funds([inc(HASH_A, 900n, 12), inc(HASH_B, 100n, 3)]) });
    expect(r.reports).toEqual([{ kind: 'chain', receivedAtomic: 1000n, unlockedAtomic: 900n, confirmations: 3 }]);
    expect(r.closeChannels).toBe(false);
    expect(r.watching).toBe(true);
  });

  test('an empty escrow reports zero confirmations once, then nothing while unchanged', () => {
    const r1 = step({ f: funds([]) });
    expect(r1.reports).toEqual([{ kind: 'chain', receivedAtomic: 0n, unlockedAtomic: 0n, confirmations: 0 }]);
    expect(step({ state: r1.state, f: funds([]) }).reports).toEqual([]);
  });

  test('reports again only when a fact changes', () => {
    const r1 = step({ f: funds([inc(HASH_A, 1000n, 1)]) });
    expect(step({ state: r1.state, f: funds([inc(HASH_A, 1000n, 1)]) }).reports).toEqual([]);
    expect(step({ state: r1.state, f: funds([inc(HASH_A, 1000n, 2)]) }).reports).toEqual([
      { kind: 'chain', receivedAtomic: 1000n, unlockedAtomic: 0n, confirmations: 2 },
    ]);
  });

  test('a dropped incoming tx shrinks the reported balance (nothing was spent)', () => {
    const r1 = step({ f: funds([inc(HASH_A, 1000n, 12), inc(HASH_B, 5n, 0)]) });
    const r2 = step({ state: r1.state, f: funds([inc(HASH_A, 1000n, 12)]) });
    expect(r2.reports).toEqual([{ kind: 'chain', receivedAtomic: 1000n, unlockedAtomic: 1000n, confirmations: 12 }]);
  });

  test('a release in the pool is not settled and holds chain reports', () => {
    const r1 = step({ apiState: 'settling', f: funds([inc(HASH_A, 1000n, 12)]) });
    // the wallet already counts the pool spend: balance 0 below what came in
    const r2 = step({ apiState: 'settling', state: r1.state, f: funds([inc(HASH_A, 1000n, 13)], 0n, 0n), spend: { txHash: SETTLE, inBlock: false } });
    expect(r2.reports).toEqual([]);
    expect(r2.closeChannels).toBe(false);
    // a spend the wallet sees but nobody has named yet: still held
    const r3 = step({ apiState: 'settling', state: r1.state, f: funds([inc(HASH_A, 1000n, 13)], 0n, 0n) });
    expect(r3.reports).toEqual([]);
  });

  test('a known spend still in the pool holds chain reports even before the wallet sees it', () => {
    const r1 = step({ apiState: 'settling', f: funds([inc(HASH_A, 1000n, 12)]) });
    const r2 = step({ apiState: 'settling', state: r1.state, f: funds([inc(HASH_A, 1000n, 13)]), spend: { txHash: SETTLE, inBlock: false } });
    expect(r2.reports).toEqual([]);
  });

  test('the sweep in a block reports settled once, closes both channels once', () => {
    const r1 = step({ apiState: 'settling', f: funds([inc(HASH_A, 1000n, 12)]) });
    const r2 = step({ apiState: 'settling', state: r1.state, f: funds([inc(HASH_A, 1000n, 13)], 0n, 0n), spend: { txHash: SETTLE, inBlock: true }, now: at(5) });
    expect(r2.reports).toEqual([{ kind: 'settled', txHash: SETTLE }]);
    expect(r2.closeChannels).toBe(true);
    expect(r2.state.closedAt).toEqual(at(5));
    const r3 = step({ apiState: 'released', state: r2.state, f: funds([inc(HASH_A, 1000n, 14)], 0n, 0n), spend: { txHash: SETTLE, inBlock: true }, now: at(6) });
    expect(r3.reports).toEqual([]);
    expect(r3.closeChannels).toBe(false);
    expect(r3.watching).toBe(true);
  });

  test('a malformed spend hash is never reported settled', () => {
    for (const txHash of ['', 'C'.repeat(64), 'c'.repeat(63), `${'c'.repeat(63)}g`]) {
      const r = step({ apiState: 'settling', f: funds([inc(HASH_A, 1000n, 13)], 0n, 0n), spend: { txHash, inBlock: true } });
      expect(r.reports).toEqual([]);
      expect(r.closeChannels).toBe(false);
    }
  });

  test('funds after released → chain with only the late coins, then late-funds once', () => {
    const open = step({ apiState: 'settling', f: funds([inc(HASH_A, 1000n, 12)]) });
    const settled = step({ apiState: 'settling', state: open.state, f: funds([inc(HASH_A, 1000n, 13)], 0n, 0n), spend: { txHash: SETTLE, inBlock: true }, now: at(5) });
    const late = funds([inc(HASH_A, 1000n, 20), inc(LATE, 7n, 0)], 7n, 0n);
    const r = step({ apiState: 'released', state: settled.state, f: late, now: at(60) });
    expect(r.reports).toEqual([
      { kind: 'chain', receivedAtomic: 7n, unlockedAtomic: 0n, confirmations: 0 },
      { kind: 'late-funds' },
    ]);
    const again = step({ apiState: 'disputed', state: r.state, f: late, now: at(61) });
    expect(again.reports).toEqual([]);
  });

  test('late-funds does not trust the balance: a wallet that never saw the sweep is no late payment', () => {
    const open = step({ apiState: 'settling', f: funds([inc(HASH_A, 1000n, 12)]) });
    // this wallet still shows the swept coins (it has no key images for the sweep)
    const settled = step({ apiState: 'settling', state: open.state, f: funds([inc(HASH_A, 1000n, 13)]), spend: { txHash: SETTLE, inBlock: true } });
    expect(settled.reports).toEqual([{ kind: 'settled', txHash: SETTLE }]);
    expect(step({ apiState: 'released', state: settled.state, f: funds([inc(HASH_A, 1000n, 30)]), now: at(30) }).reports).toEqual([]);
  });

  test('a coin still locked when the sweep was seen in a block was not swept: it is late', () => {
    const open = step({ apiState: 'settling', f: funds([inc(HASH_A, 1000n, 12)]) });
    const settled = step({
      apiState: 'settling',
      state: open.state,
      f: funds([inc(HASH_A, 1000n, 13), inc(LATE, 3n, 1)], 3n, 0n),
      spend: { txHash: SETTLE, inBlock: true },
    });
    // settled first, so the API closes the trade before the late coins make it escalate
    expect(settled.reports).toEqual([
      { kind: 'settled', txHash: SETTLE },
      { kind: 'chain', receivedAtomic: 3n, unlockedAtomic: 0n, confirmations: 1 },
      { kind: 'late-funds' },
    ]);
    const r = step({ apiState: 'disputed', state: settled.state, f: funds([inc(HASH_A, 1000n, 14), inc(LATE, 3n, 2)], 3n, 0n) });
    expect(r.reports).toEqual([{ kind: 'chain', receivedAtomic: 3n, unlockedAtomic: 0n, confirmations: 2 }]);
  });

  test('a cancelled trade: close both channels; any coin arriving is late', () => {
    const r1 = step({ apiState: 'cancelled', f: funds([]), now: at(1) });
    expect(r1.reports).toEqual([]);
    expect(r1.closeChannels).toBe(true);
    expect(r1.state.closedAt).toEqual(at(1));
    const r2 = step({ apiState: 'cancelled', state: r1.state, f: funds([inc(LATE, 50n, 0)]), now: at(2) });
    expect(r2.reports).toEqual([{ kind: 'chain', receivedAtomic: 50n, unlockedAtomic: 0n, confirmations: 0 }, { kind: 'late-funds' }]);
    expect(r2.closeChannels).toBe(false);
  });

  test('a cancel the API reports while coins sit in the escrow: those coins are late too', () => {
    const r = step({ apiState: 'cancelled', f: funds([inc(LATE, 50n, 0)]) });
    expect(r.reports).toEqual([{ kind: 'chain', receivedAtomic: 50n, unlockedAtomic: 0n, confirmations: 0 }, { kind: 'late-funds' }]);
    expect(r.closeChannels).toBe(true);
  });

  test('a cancelled trade swept nothing: even an unlocked coin found at the cancel is late', () => {
    const r = step({ apiState: 'cancelled', f: funds([inc(LATE, 50n, 12)]) });
    expect(r.reports).toEqual([{ kind: 'chain', receivedAtomic: 50n, unlockedAtomic: 50n, confirmations: 12 }, { kind: 'late-funds' }]);
  });

  test('closed escrows stay watched for exactly 30 days', () => {
    const r1 = step({ apiState: 'cancelled', f: funds([]), now: at(0) });
    expect(step({ apiState: 'cancelled', state: r1.state, f: funds([]), now: at(30 * DAY_MIN) }).watching).toBe(true);
    const gone = step({ apiState: 'cancelled', state: r1.state, f: funds([inc(LATE, 50n, 0)]), now: new Date(at(30 * DAY_MIN).getTime() + 1) });
    expect(gone.watching).toBe(false);
    expect(gone.reports).toEqual([]);
  });

  test('a lapse is not a close: chain facts keep flowing (the timer loop escalates it)', () => {
    const r = step({ apiState: 'lapsed', f: funds([inc(HASH_A, 5n, 0)]) });
    expect(r.reports).toEqual([{ kind: 'chain', receivedAtomic: 5n, unlockedAtomic: 0n, confirmations: 0 }]);
    expect(r.closeChannels).toBe(false);
    expect(r.state.closedAt).toBeNull();
  });

  test('bad wallet facts fail closed', () => {
    const bad: EscrowFunds[] = [
      { balance: -1n, unlocked: 0n, incoming: [] },
      { balance: 5n, unlocked: 6n, incoming: [inc(HASH_A, 5n, 0)] },
      { balance: 5n, unlocked: 0n, incoming: [inc(HASH_A, 5n, -1)] },
      { balance: 5n, unlocked: 0n, incoming: [inc(HASH_A, 5n, 1.5)] },
      { balance: 5n, unlocked: 0n, incoming: [inc(HASH_A, -5n, 0)] },
      { balance: 10n, unlocked: 0n, incoming: [inc(HASH_A, 5n, 0), inc(HASH_A, 5n, 0)] },
      { balance: 5 as unknown as bigint, unlocked: 0n, incoming: [] },
    ];
    for (const f of bad) expect(() => step({ f })).toThrow(RangeError);
    expect(() => step({ f: funds([]), now: new Date(Number.NaN) })).toThrow(RangeError);
  });

  test('watchStep does not mutate the state it is given', () => {
    const s = newWatchState();
    const copy = structuredClone(s);
    step({ state: s, f: funds([inc(HASH_A, 1000n, 1)]) });
    expect(s).toEqual(copy);
  });
});

describe('settleKindFor', () => {
  test('a settlement in progress names its kind', () => {
    expect(settleKindFor({ state: 'settling', settling: 'buyer-cancel' })).toBe('buyer-cancel');
    expect(settleKindFor({ state: 'settling', settling: 'release' })).toBe('release');
  });
  test('a lapse refund and an auto-refund are named by their state', () => {
    expect(settleKindFor({ state: 'lapsed', settling: null })).toBe('lapse-refund');
    expect(settleKindFor({ state: 'refund_requested', settling: null })).toBe('auto-refund');
  });
  test('anything else cannot be named from the trade alone', () => {
    for (const state of ['funding', 'securing', 'secured', 'paid', 'disputed'] as const) {
      expect(settleKindFor({ state, settling: null })).toBeNull();
    }
  });
});
