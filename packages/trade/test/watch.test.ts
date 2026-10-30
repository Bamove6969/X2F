import { describe, expect, test } from 'vitest';
import {
  WATCH_CLOSED_DAYS,
  WATCH_INTERVAL_MS,
  newWatchState,
  settleKindFor,
  watchStep,
  type EscrowFunds,
  type SpendEvidence,
  type TradeState,
  type WatchIncoming,
  type WatchState,
} from '../src/index.js';

const T0 = new Date('2026-10-18T12:00:00.000Z');
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
const DAY_MIN = 24 * 60;
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const SETTLE = 'c'.repeat(64);
const LATE = 'd'.repeat(64);
const B2 = 'e'.repeat(64);
const C2 = 'f'.repeat(64);

/** The daemon's height (number of blocks) for these tests; a tx in block h has CHAIN - h confirmations. */
const CHAIN = 1000;

/** An incoming tx with `conf` confirmations at chain height `chain` (0 = in the pool). */
const inc = (txHash: string, amountAtomic: bigint, conf: number, chain = CHAIN): WatchIncoming => ({
  txHash,
  amountAtomic,
  height: conf === 0 ? null : chain - conf,
  unlocked: conf >= 10,
});
/** Wallet facts: by default the balance is every in-block coin (wallet2 leaves the pool out). */
const funds = (incoming: WatchIncoming[], balance?: bigint, unlocked?: bigint, chainHeight = CHAIN): EscrowFunds => {
  const inBlock = incoming.filter((i) => i.height !== null).reduce((s, i) => s + i.amountAtomic, 0n);
  const un = incoming.filter((i) => i.unlocked).reduce((s, i) => s + i.amountAtomic, 0n);
  return { balance: balance ?? inBlock, unlocked: unlocked ?? un, chainHeight, incoming };
};
/** A sweep with `conf` confirmations (0 = in the pool) that spent `sweptAtomic`. */
const sweep = (sweptAtomic: bigint, conf: number, txHash = SETTLE, chain = CHAIN): SpendEvidence => ({
  txHash,
  height: conf === 0 ? null : chain - conf,
  sweptAtomic,
});

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

  test('confirmations come from absolute heights: the same coins read at a later height have more', () => {
    const r1 = step({ f: funds([inc(HASH_A, 1000n, 1)]) });
    const later = funds([inc(HASH_A, 1000n, 1)], undefined, undefined, CHAIN + 4);
    expect(step({ state: r1.state, f: later }).reports).toEqual([{ kind: 'chain', receivedAtomic: 1000n, unlockedAtomic: 0n, confirmations: 5 }]);
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

  test('a pool deposit is not read as spending (wallet2 leaves it out of the balance)', () => {
    const r = step({ f: funds([inc(HASH_A, 1000n, 12), inc(HASH_B, 5n, 0)]) });
    expect(r.reports).toEqual([{ kind: 'chain', receivedAtomic: 1000n, unlockedAtomic: 1000n, confirmations: 0 }]);
  });

  test('a dropped pool deposit changes the reported facts (nothing was spent)', () => {
    const r1 = step({ f: funds([inc(HASH_A, 1000n, 12), inc(HASH_B, 5n, 0)]) });
    const r2 = step({ state: r1.state, f: funds([inc(HASH_A, 1000n, 12)]) });
    expect(r2.reports).toEqual([{ kind: 'chain', receivedAtomic: 1000n, unlockedAtomic: 1000n, confirmations: 12 }]);
  });

  test('a release in the pool is not settled and holds chain reports', () => {
    const r1 = step({ apiState: 'settling', f: funds([inc(HASH_A, 1000n, 12)]) });
    // the wallet already counts the pool spend: balance 0 below what came in
    const r2 = step({ apiState: 'settling', state: r1.state, f: funds([inc(HASH_A, 1000n, 13)], 0n, 0n), spend: sweep(1000n, 0) });
    expect(r2.reports).toEqual([]);
    expect(r2.closeChannels).toBe(false);
    // a spend the wallet sees but nobody has shown yet: still held
    const r3 = step({ apiState: 'settling', state: r1.state, f: funds([inc(HASH_A, 1000n, 13)], 0n, 0n) });
    expect(r3.reports).toEqual([]);
  });

  test('a known spend still in the pool holds chain reports even before the wallet sees it', () => {
    const r1 = step({ apiState: 'settling', f: funds([inc(HASH_A, 1000n, 12)]) });
    const r2 = step({ apiState: 'settling', state: r1.state, f: funds([inc(HASH_A, 1000n, 13)]), spend: sweep(1000n, 0) });
    expect(r2.reports).toEqual([]);
  });

  test('the sweep in a block reports settled once, closes both channels once', () => {
    const r1 = step({ apiState: 'settling', f: funds([inc(HASH_A, 1000n, 12)]) });
    const r2 = step({ apiState: 'settling', state: r1.state, f: funds([inc(HASH_A, 1000n, 13)], 0n, 0n), spend: sweep(1000n, 1), now: at(5) });
    expect(r2.reports).toEqual([{ kind: 'settled', txHash: SETTLE }]);
    expect(r2.closeChannels).toBe(true);
    expect(r2.state.closedAt).toEqual(at(5));
    expect(r2.state.swept).toEqual([HASH_A]);
    const r3 = step({ apiState: 'released', state: r2.state, f: funds([inc(HASH_A, 1000n, 14)], 0n, 0n), spend: sweep(1000n, 2), now: at(6) });
    expect(r3.reports).toEqual([]);
    expect(r3.closeChannels).toBe(false);
    expect(r3.watching).toBe(true);
  });

  test('a malformed spend hash is never reported settled', () => {
    for (const txHash of ['', 'C'.repeat(64), 'c'.repeat(63), `${'c'.repeat(63)}g`]) {
      const r = step({ apiState: 'settling', f: funds([inc(HASH_A, 1000n, 13)], 0n, 0n), spend: sweep(1000n, 1, txHash) });
      expect(r.reports).toEqual([]);
      expect(r.closeChannels).toBe(false);
    }
  });

  test('funds after released → chain with only the late coins, then late-funds once', () => {
    const open = step({ apiState: 'settling', f: funds([inc(HASH_A, 1000n, 12)]) });
    const settled = step({ apiState: 'settling', state: open.state, f: funds([inc(HASH_A, 1000n, 13)], 0n, 0n), spend: sweep(1000n, 1), now: at(5) });
    const late = funds([inc(HASH_A, 1000n, 20), inc(LATE, 7n, 0)], 0n, 0n);
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
    const settled = step({ apiState: 'settling', state: open.state, f: funds([inc(HASH_A, 1000n, 13)]), spend: sweep(1000n, 1) });
    expect(settled.reports).toEqual([{ kind: 'settled', txHash: SETTLE }]);
    expect(step({ apiState: 'released', state: settled.state, f: funds([inc(HASH_A, 1000n, 30)]), now: at(30) }).reports).toEqual([]);
  });

  test('a coin still locked when the sweep was seen in a block was not swept: it is late', () => {
    const open = step({ apiState: 'settling', f: funds([inc(HASH_A, 1000n, 12)]) });
    const settled = step({
      apiState: 'settling',
      state: open.state,
      f: funds([inc(HASH_A, 1000n, 13), inc(LATE, 3n, 1)], 3n, 0n),
      spend: sweep(1000n, 1),
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

  test('a late deposit that unlocked before the close is late', () => {
    const r = step({
      apiState: 'settling',
      f: funds([inc(HASH_A, 1000n, 30), inc(LATE, 7n, 11)], 7n, 7n),
      spend: sweep(1000n, 13),
    });
    expect(r.state.swept).toEqual([HASH_A]);
    expect(r.reports).toEqual([
      { kind: 'settled', txHash: SETTLE },
      { kind: 'chain', receivedAtomic: 7n, unlockedAtomic: 7n, confirmations: 11 },
      { kind: 'late-funds' },
    ]);
  });

  test('a delayed sweep (built early, mined late) takes only what it spent: an old-enough late coin is still late', () => {
    // A at 40 conf; D (13 conf) arrived after the sweep was built; the resubmitted sweep is mined at 1 conf.
    const r = step({ apiState: 'settling', f: funds([inc(HASH_A, 1000n, 40), inc(LATE, 9n, 13)], 9n, 9n), spend: sweep(1000n, 1) });
    expect(r.state.swept).toEqual([HASH_A]);
    expect(r.reports.at(-1)).toEqual({ kind: 'late-funds' });
  });

  test('the swept set does not depend on the height the facts were read at (no race on a stale spend count)', () => {
    const s1 = step({ apiState: 'settling', f: funds([inc(HASH_A, 1000n, 40), inc(LATE, 9n, 13)], 9n, 9n), spend: sweep(1000n, 1) });
    // the same absolute heights read 50 blocks later
    const s2 = step({
      apiState: 'settling',
      f: funds([inc(HASH_A, 1000n, 40), inc(LATE, 9n, 13)], 9n, 9n, CHAIN + 50),
      spend: sweep(1000n, 1),
    });
    expect(s2.state.swept).toEqual(s1.state.swept);
    expect(s1.state.swept).toEqual([HASH_A]);
  });

  test('a normal settle sweeps exactly the oldest-first coins it spent, whole heights only', () => {
    const r = step({
      apiState: 'settling',
      f: funds([inc(HASH_A, 1000n, 30), inc(B2, 20n, 20), inc(C2, 4n, 15)], 4n, 4n),
      spend: sweep(1020n, 10),
    });
    expect(r.state.swept).toEqual([HASH_A, B2]);
    expect(r.reports).toEqual([
      { kind: 'settled', txHash: SETTLE },
      { kind: 'chain', receivedAtomic: 4n, unlockedAtomic: 4n, confirmations: 15 },
      { kind: 'late-funds' },
    ]);
  });

  test('two coins in one block are swept together or not at all', () => {
    const coins = [inc(HASH_A, 600n, 30), inc(B2, 400n, 30)];
    // a sweep claiming only one of them matches no whole-height prefix: nothing is swept
    expect(step({ apiState: 'settling', f: funds(coins, 0n, 0n), spend: sweep(600n, 5) }).state.swept).toEqual([]);
    expect(step({ apiState: 'settling', f: funds(coins, 0n, 0n), spend: sweep(1000n, 5) }).state.swept).toEqual([HASH_A, B2]);
  });

  test('an amount mismatch sweeps nothing: every coin counts as late (escalation)', () => {
    const r = step({ apiState: 'settling', f: funds([inc(HASH_A, 1000n, 30)], 0n, 0n), spend: sweep(999n, 1) });
    expect(r.state.swept).toEqual([]);
    expect(r.reports).toEqual([
      { kind: 'settled', txHash: SETTLE },
      { kind: 'chain', receivedAtomic: 1000n, unlockedAtomic: 1000n, confirmations: 30 },
      { kind: 'late-funds' },
    ]);
  });

  test('a coin 9 blocks older than the sweep cannot have been in it', () => {
    const coins = [inc(HASH_A, 1000n, 20), inc(LATE, 5n, 19)];
    // no prefix of coins at least 10 blocks older sums to 1005
    expect(step({ apiState: 'settling', f: funds(coins, 5n, 5n), spend: sweep(1005n, 10) }).state.swept).toEqual([]);
    expect(step({ apiState: 'settling', f: funds(coins, 5n, 5n), spend: sweep(1000n, 10) }).state.swept).toEqual([HASH_A]);
  });

  test('a close known only from the API sweeps nothing: every coin is unaccounted until the sweep is shown', () => {
    const open = step({ apiState: 'secured', f: funds([inc(HASH_A, 1000n, 30)]) });
    const r = step({ apiState: 'released', state: open.state, f: funds([inc(HASH_A, 1000n, 31)], 0n, 0n), now: at(5) });
    expect(r.reports).toEqual([
      { kind: 'chain', receivedAtomic: 1000n, unlockedAtomic: 1000n, confirmations: 31 },
      { kind: 'late-funds' },
    ]);
    expect(r.closeChannels).toBe(true);
    expect(r.state.swept).toEqual([]);
    // once the sweep is shown, later facts count only the coins it did not take
    const known = step({
      apiState: 'released',
      state: r.state,
      f: funds([inc(HASH_A, 1000n, 32), inc(LATE, 2n, 0)], 0n, 0n),
      spend: sweep(1000n, 2),
      now: at(6),
    });
    expect(known.state.settledTx).toBe(SETTLE);
    // A is now accounted for; LATE is a new late tx, so it escalates on its own
    expect(known.reports).toEqual([{ kind: 'chain', receivedAtomic: 2n, unlockedAtomic: 0n, confirmations: 0 }, { kind: 'late-funds' }]);
    expect(known.state.lateReported).toEqual([HASH_A, LATE]);
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

  test('a second batch of late funds after a ruling escalates again; the first batch does not re-escalate', () => {
    const E = '8'.repeat(64);
    // released: A swept by our own sweep
    const settled = step({ apiState: 'settling', f: funds([inc(HASH_A, 1000n, 30)], 0n, 0n), spend: sweep(1000n, 5), now: at(0) });
    // late D → late-funds → the API escalates (disputed)
    const d = step({ apiState: 'released', state: settled.state, f: funds([inc(HASH_A, 1000n, 31), inc(LATE, 7n, 1)]), now: at(10) });
    expect(d.reports.at(-1)).toEqual({ kind: 'late-funds' });
    const disputed = step({ apiState: 'disputed', state: d.state, f: funds([inc(HASH_A, 1000n, 40), inc(LATE, 7n, 10)]), now: at(20) });
    expect(disputed.reports).toEqual([{ kind: 'chain', receivedAtomic: 7n, unlockedAtomic: 7n, confirmations: 10 }]);
    // a ruling refunds D; this watcher is not shown its sweep, so D stays in the incoming list
    const ruled = step({ apiState: 'refunded', state: disputed.state, f: funds([inc(HASH_A, 1000n, 60), inc(LATE, 7n, 30)], 0n, 0n), now: at(30) });
    expect(ruled.reports.filter((r) => r.kind === 'late-funds')).toEqual([]);
    // late E: escalate again
    const e = step({
      apiState: 'refunded',
      state: ruled.state,
      f: funds([inc(HASH_A, 1000n, 61), inc(LATE, 7n, 31), inc(E, 3n, 0)], 0n, 0n),
      now: at(40),
    });
    expect(e.reports.at(-1)).toEqual({ kind: 'late-funds' });
    expect(e.state.lateReported).toEqual([LATE, E]);
  });

  test('a late coin found while the trade is open again is reported only once it is closed', () => {
    const E = '8'.repeat(64);
    const d = step({ apiState: 'released', f: funds([inc(LATE, 7n, 1)]), now: at(0) });
    expect(d.reports.at(-1)).toEqual({ kind: 'late-funds' });
    // E arrives during the dispute: no second escalation while it is open
    const open = step({ apiState: 'disputed', state: d.state, f: funds([inc(LATE, 7n, 2), inc(E, 3n, 1)]), now: at(5) });
    expect(open.reports.filter((r) => r.kind === 'late-funds')).toEqual([]);
    // closed again with no sweep shown for E: fail closed, escalate
    const closed = step({ apiState: 'refunded', state: open.state, f: funds([inc(LATE, 7n, 3), inc(E, 3n, 2)], 0n, 0n), now: at(10) });
    expect(closed.reports.at(-1)).toEqual({ kind: 'late-funds' });
  });

  test('a ruling sweep that is shown takes its coins: no escalation for them after the re-close', () => {
    const RULING = '9'.repeat(64);
    const E = '8'.repeat(64);
    // our own sweep took A; late D escalates
    const settled = step({ apiState: 'settling', f: funds([inc(HASH_A, 1000n, 60)], 0n, 0n), spend: sweep(1000n, 45), now: at(0) });
    const d = step({ apiState: 'released', state: settled.state, f: funds([inc(HASH_A, 1000n, 60), inc(LATE, 7n, 30)]), now: at(1) });
    expect(d.reports.at(-1)).toEqual({ kind: 'late-funds' });
    const open = step({ apiState: 'disputed', state: d.state, f: funds([inc(HASH_A, 1000n, 61), inc(LATE, 7n, 31), inc(E, 3n, 20)]), now: at(5) });
    // the ruling's sweep (shown) spent D and E: 10 blocks after both
    const ruled = step({
      apiState: 'refunded',
      state: open.state,
      f: funds([inc(HASH_A, 1000n, 70), inc(LATE, 7n, 40), inc(E, 3n, 29)], 0n, 0n),
      spend: sweep(10n, 5, RULING),
      now: at(10),
    });
    expect(ruled.reports.filter((r) => r.kind === 'late-funds')).toEqual([]);
    expect(ruled.state.swept).toEqual([HASH_A, LATE, E]);
    // a ruling sweep whose amount matches nothing takes nothing: E escalates
    const wrong = step({
      apiState: 'refunded',
      state: open.state,
      f: funds([inc(HASH_A, 1000n, 70), inc(LATE, 7n, 40), inc(E, 3n, 29)], 0n, 0n),
      spend: sweep(9n, 5, RULING),
      now: at(10),
    });
    expect(wrong.reports.at(-1)).toEqual({ kind: 'late-funds' });
  });

  test('the 30-day watch counts from the latest close: a long dispute restarts it', () => {
    const d = step({ apiState: 'released', f: funds([inc(LATE, 7n, 1)]), now: at(0) });
    // disputed for 31 days: still watched
    const open = step({ apiState: 'disputed', state: d.state, f: funds([inc(LATE, 7n, 2)]), now: at(31 * DAY_MIN) });
    expect(open.watching).toBe(true);
    // the ruling closes it at day 31: watched on that step and for 30 days after
    const ruled = step({ apiState: 'refunded', state: open.state, f: funds([inc(LATE, 7n, 3)], 0n, 0n), now: at(31 * DAY_MIN + 1) });
    expect(ruled.watching).toBe(true);
    expect(ruled.state.closedAt).toEqual(at(31 * DAY_MIN + 1));
    const day60 = step({ apiState: 'refunded', state: ruled.state, f: funds([inc(LATE, 7n, 3)], 0n, 0n), now: at(61 * DAY_MIN + 1) });
    expect(day60.watching).toBe(true);
    const after = step({ apiState: 'refunded', state: ruled.state, f: funds([inc(LATE, 7n, 3)], 0n, 0n), now: new Date(at(61 * DAY_MIN + 1).getTime() + 1) });
    expect(after.watching).toBe(false);
  });

  test('a short dispute also gets a full 30 days after its own close', () => {
    const d = step({ apiState: 'released', f: funds([inc(LATE, 7n, 1)]), now: at(0) });
    const open = step({ apiState: 'disputed', state: d.state, f: funds([inc(LATE, 7n, 2)]), now: at(25 * DAY_MIN) });
    const ruled = step({ apiState: 'refunded', state: open.state, f: funds([inc(LATE, 7n, 3)], 0n, 0n), now: at(26 * DAY_MIN) });
    expect(step({ apiState: 'refunded', state: ruled.state, f: funds([inc(LATE, 7n, 3)], 0n, 0n), now: at(50 * DAY_MIN) }).watching).toBe(true);
  });

  test('a sweep tx is never counted as a late coin', () => {
    const settled = step({ apiState: 'settling', f: funds([inc(HASH_A, 1000n, 30)], 0n, 0n), spend: sweep(1000n, 5) });
    // a wallet listing the sweep itself among incoming (e.g. a payout back to the escrow's own address)
    const r = step({ apiState: 'released', state: settled.state, f: funds([inc(HASH_A, 1000n, 31), inc(SETTLE, 1n, 6)], 0n, 0n) });
    expect(r.reports).toEqual([]);
  });

  test('closed escrows stay watched for exactly 30 days', () => {
    const r1 = step({ apiState: 'cancelled', f: funds([]), now: at(0) });
    expect(step({ apiState: 'cancelled', state: r1.state, f: funds([]), now: at(30 * DAY_MIN) }).watching).toBe(true);
    const gone = step({ apiState: 'cancelled', state: r1.state, f: funds([]), now: new Date(at(30 * DAY_MIN).getTime() + 1) });
    expect(gone.watching).toBe(false);
    expect(gone.reports).toEqual([]);
  });

  test('a late coin first seen on the step the 30 days run out is reported and keeps the watch (never dropped unseen)', () => {
    const r1 = step({ apiState: 'cancelled', f: funds([]), now: at(0) });
    const last = step({ apiState: 'cancelled', state: r1.state, f: funds([inc(LATE, 50n, 0)]), now: new Date(at(30 * DAY_MIN).getTime() + 1) });
    expect(last.reports).toEqual([{ kind: 'chain', receivedAtomic: 50n, unlockedAtomic: 0n, confirmations: 0 }, { kind: 'late-funds' }]);
    expect(last.watching).toBe(true);
  });

  test('after late-funds the watch holds until the API shows the trade disputed (a stale closed view at day 30 does not drop it)', () => {
    const r1 = step({ apiState: 'cancelled', f: funds([]), now: at(0) });
    const late = step({ apiState: 'cancelled', state: r1.state, f: funds([inc(LATE, 50n, 12)]), now: at(29 * DAY_MIN) });
    expect(late.reports.at(-1)).toEqual({ kind: 'late-funds' });
    // the escalation is not visible yet: the API still lists the trade cancelled after day 30
    const stale = step({ apiState: 'cancelled', state: late.state, f: funds([inc(LATE, 50n, 13)]), now: at(31 * DAY_MIN) });
    expect(stale.watching).toBe(true);
    // a stale open view that is not the dispute does not release the hold either
    const lag = step({ apiState: 'settling', state: stale.state, f: funds([inc(LATE, 50n, 14)]), now: at(31 * DAY_MIN + 1) });
    expect(step({ apiState: 'cancelled', state: lag.state, f: funds([inc(LATE, 50n, 15)]), now: at(70 * DAY_MIN) }).watching).toBe(true);
    // seen disputed, then ruled: the 30 days run from the ruling's close
    const disputed = step({ apiState: 'disputed', state: stale.state, f: funds([inc(LATE, 50n, 14)]), now: at(32 * DAY_MIN) });
    const ruled = step({ apiState: 'refunded', state: disputed.state, f: funds([inc(LATE, 50n, 15)], 0n, 0n), now: at(33 * DAY_MIN) });
    expect(step({ apiState: 'refunded', state: ruled.state, f: funds([inc(LATE, 50n, 15)], 0n, 0n), now: at(63 * DAY_MIN) }).watching).toBe(true);
    expect(step({ apiState: 'refunded', state: ruled.state, f: funds([inc(LATE, 50n, 15)], 0n, 0n), now: at(63 * DAY_MIN + 1) }).watching).toBe(false);
  });

  test('a later sweep shown after the close is a new close: the 30 days restart from it', () => {
    const RULING = '9'.repeat(64);
    const settled = step({ apiState: 'settling', f: funds([inc(HASH_A, 1000n, 60)], 0n, 0n), spend: sweep(1000n, 45), now: at(0) });
    // the watcher never saw the trade open; a ruling's sweep of D is shown at day 20
    const ruled = step({
      apiState: 'refunded',
      state: settled.state,
      f: funds([inc(HASH_A, 1000n, 80), inc(LATE, 7n, 40)], 0n, 0n),
      spend: sweep(7n, 5, RULING),
      now: at(20 * DAY_MIN),
    });
    expect(ruled.state.closedAt).toEqual(at(20 * DAY_MIN));
    expect(step({ apiState: 'refunded', state: ruled.state, f: funds([inc(HASH_A, 1000n, 90), inc(LATE, 7n, 50)], 0n, 0n), now: at(49 * DAY_MIN) }).watching).toBe(true);
  });

  test('a trade escalated by late funds keeps its watcher past 30 days while it is not closed', () => {
    const r1 = step({ apiState: 'released', f: funds([inc(LATE, 50n, 12)]), now: at(0) });
    expect(r1.reports.at(-1)).toEqual({ kind: 'late-funds' });
    const day31 = at(31 * DAY_MIN);
    for (const apiState of ['disputed', 'settling', 'lapsed'] as TradeState[]) {
      expect(step({ apiState, state: r1.state, f: funds([inc(LATE, 50n, 12)]), now: day31 }).watching).toBe(true);
    }
    // closed again at day 31 without the watcher ever seeing the dispute: the escalation is unconfirmed, keep watching
    expect(step({ apiState: 'refunded', state: r1.state, f: funds([inc(LATE, 50n, 12)]), now: day31 }).watching).toBe(true);
  });

  test('a lapse is not a close: chain facts keep flowing (the timer loop escalates it)', () => {
    const r = step({ apiState: 'lapsed', f: funds([inc(HASH_A, 5n, 1)]) });
    expect(r.reports).toEqual([{ kind: 'chain', receivedAtomic: 5n, unlockedAtomic: 0n, confirmations: 1 }]);
    expect(r.closeChannels).toBe(false);
    expect(r.state.closedAt).toBeNull();
  });

  test('bad wallet facts fail closed', () => {
    const bad: EscrowFunds[] = [
      { balance: -1n, unlocked: 0n, chainHeight: CHAIN, incoming: [] },
      { balance: 5n, unlocked: 6n, chainHeight: CHAIN, incoming: [inc(HASH_A, 5n, 1)] },
      { balance: 5n, unlocked: 0n, chainHeight: CHAIN, incoming: [{ ...inc(HASH_A, 5n, 1), height: -1 }] },
      { balance: 5n, unlocked: 0n, chainHeight: CHAIN, incoming: [{ ...inc(HASH_A, 5n, 1), height: 1.5 }] },
      { balance: 5n, unlocked: 0n, chainHeight: CHAIN, incoming: [{ ...inc(HASH_A, 5n, 1), height: CHAIN }] },
      { balance: 5n, unlocked: 0n, chainHeight: CHAIN, incoming: [inc(HASH_A, -5n, 1)] },
      { balance: 10n, unlocked: 0n, chainHeight: CHAIN, incoming: [inc(HASH_A, 5n, 1), inc(HASH_A, 5n, 1)] },
      { balance: 5 as unknown as bigint, unlocked: 0n, chainHeight: CHAIN, incoming: [] },
      { balance: 0n, unlocked: 0n, chainHeight: 1.5, incoming: [] },
    ];
    for (const f of bad) expect(() => step({ f })).toThrow(RangeError);
    expect(() => step({ f: funds([]), now: new Date(Number.NaN) })).toThrow(RangeError);
  });

  test('bad spend facts fail closed', () => {
    for (const height of [-1, 1.5, Number.NaN, CHAIN]) {
      expect(() => step({ f: funds([]), spend: { txHash: SETTLE, height, sweptAtomic: 1n } })).toThrow(RangeError);
    }
    for (const sweptAtomic of [0n, -1n, 5 as unknown as bigint]) {
      for (const height of [null, CHAIN - 1]) {
        expect(() => step({ f: funds([]), spend: { txHash: SETTLE, height, sweptAtomic } })).toThrow(RangeError);
      }
    }
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
  test('funding or securing does not name a kind: a timed-out signing window can return any settlement there', () => {
    expect(settleKindFor({ state: 'funding', settling: null })).toBeNull();
    expect(settleKindFor({ state: 'securing', settling: null })).toBeNull();
  });
  test('anything else cannot be named from the trade alone', () => {
    for (const state of ['secured', 'paid', 'disputed'] as const) {
      expect(settleKindFor({ state, settling: null })).toBeNull();
    }
  });
});
