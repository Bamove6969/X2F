import { describe, expect, test } from 'vitest';
import { TIMER_LOOP_MS, TIMERS, apply, newTrade, timerEvents as decide, type Trade, type TradeEvent } from '../src/index.js';

const MIN = 60_000;
const T0 = new Date('2026-10-18T12:00:00.000Z');
const at = (min: number, ms = 0) => new Date(T0.getTime() + min * MIN + ms);
const FUNDS = 1_262_500_000_000n;

function takeArgs() {
  return {
    code: 'ABCD2345EFGH6789',
    offerId: 'offer-1',
    poster: 'seller' as const,
    sellerId: 'acct-s',
    buyerId: 'acct-b',
    methodId: 'revolut',
    amountAtomic: 1_250_000_000_000n,
    lockedRate: { currency: 'USD', centsPerXmr: 33000n },
    confirmWindowMin: 120,
    minFiatCents: 10_000n,
    maxFiatCents: 50_000n,
  };
}

function taken(code = 'ABCD2345EFGH6789'): Trade {
  return newTrade(
    {
      code,
      offerId: 'offer-1',
      poster: 'seller',
      sellerId: 'acct-s',
      buyerId: 'acct-b',
      methodId: 'revolut',
      amountAtomic: 1_250_000_000_000n,
      lockedRate: { currency: 'USD', centsPerXmr: 33000n },
      confirmWindowMin: 120,
      minFiatCents: 10_000n,
      maxFiatCents: 50_000n,
    },
    T0,
  );
}

const sys = (t: Trade, e: TradeEvent, now: Date) => apply(t, e, 'system', now);

/** The events only, without their times, for the simple cases (every event but pause is at `now`). */
const timerEvents = (trades: Trade[], since: Date | null, now: Date) => decide(trades, since, now).events.map(({ code, event }) => ({ code, event }));

/** setup-done at 1 min, funded and unlocked at 2 min: secured with payBy = 2 + 90 min. */
function secured(code?: string): Trade {
  let t = sys(taken(code), { type: 'setup-done', escrowAddress: '4escrow' }, at(1));
  t = sys(t, { type: 'chain', receivedAtomic: FUNDS, unlockedAtomic: FUNDS, confirmations: 12 }, at(2));
  expect(t.state).toBe('secured');
  return t;
}

/** Run the loop's decisions through `apply`, the way the API loop will (one pass). */
function pass(trades: Trade[], maintenanceSince: Date | null, now: Date): Trade[] {
  const byCode = new Map(trades.map((t) => [t.code, t]));
  const { events, skipped } = decide(trades, maintenanceSince, now);
  expect(skipped).toEqual([]);
  for (const { code, event, at: when } of events) {
    byCode.set(code, sys(byCode.get(code)!, event, when));
  }
  return [...byCode.values()];
}

describe('timer loop decisions (Task 9, pure)', () => {
  test('runs every 5 s', () => {
    expect(TIMER_LOOP_MS).toBe(5_000);
  });

  test('ticks a trade whose deadline has passed, strictly after it', () => {
    const t = taken(); // setupBy = 60 min (owner Q11)
    expect(timerEvents([t], null, at(60))).toEqual([]);
    expect(timerEvents([t], null, at(60, 1))).toEqual([{ code: t.code, event: { type: 'tick' } }]);
    expect(pass([t], null, at(60, 1))[0]!.state).toBe('cancelled');
  });

  test('does not tick a passed deadline when the tick would change nothing', () => {
    // secured past payBy: the seller extends or requests a refund; a tick does nothing there.
    const t = secured();
    expect(timerEvents([t], null, at(200))).toEqual([]);
  });

  test('never ticks a closed trade', () => {
    const t = pass([taken()], null, at(61))[0]!;
    expect(t.state).toBe('cancelled');
    expect(timerEvents([t], null, at(500))).toEqual([]);
  });

  test('a short-funded trade lapses at fundBy', () => {
    let t = sys(taken(), { type: 'setup-done', escrowAddress: '4escrow' }, at(1)); // fundBy = 31 min
    t = sys(t, { type: 'chain', receivedAtomic: FUNDS - 100_000_000_000n, unlockedAtomic: 0n, confirmations: 1 }, at(5));
    expect(pass([t], null, at(31))[0]!.state).toBe('funding');
    expect(pass([t], null, at(31, 1))[0]!.state).toBe('lapsed');
  });

  test('maintenance pauses every open trade once and ticks nothing meanwhile', () => {
    const open = taken('ABCD2345EFGH6789');
    const closed = pass([taken('ZZZZ2345EFGH6789')], null, at(61))[0]!;
    const since = at(10);
    expect(timerEvents([open, closed], since, at(10))).toEqual([{ code: open.code, event: { type: 'pause' } }]);
    const [paused] = pass([open], since, at(10));
    expect(paused!.pausedAt).toEqual(at(10));
    // past setupBy (60) while paused: no tick, no second pause
    expect(timerEvents([paused!], since, at(80))).toEqual([]);
  });

  test("a buyer's cancel waiting for the seller's Confirm cancel: paused by maintenance, and closed by a tick 48 h after it became available (owner 2026-10-29)", () => {
    let t = apply(secured(), { type: 'buyer-cancel' }, 'buyer', at(10));
    t = sys(t, { type: 'settled', kind: 'buyer-cancel', txHash: 'aa'.repeat(32) }, at(20));
    expect(t.closedAt).toEqual(at(20));
    // Not yet available: nothing to tick; but maintenance still pauses it (its timer is coming).
    expect(timerEvents([t], null, at(100))).toEqual([]);
    expect(timerEvents([t], at(30), at(30))).toEqual([{ code: t.code, event: { type: 'pause' } }]);
    t = sys(t, { type: 'return-confirmed', confirmations: 10 }, at(40));
    expect(timerEvents([t], null, at(40 + 48 * 60))).toEqual([]);
    expect(timerEvents([t], null, at(40 + 48 * 60, 1))).toEqual([{ code: t.code, event: { type: 'tick' } }]);
    expect(pass([t], null, at(40 + 48 * 60, 1))[0]!.cancelConfirmedAt).toEqual(at(40 + 48 * 60, 1));
    // Once confirmed it is an ordinary closed trade again: no pause, no tick.
    const done = pass([t], null, at(40 + 48 * 60, 1))[0]!;
    expect(timerEvents([done], at(50 * 60), at(50 * 60))).toEqual([]);
  });

  test('clearing maintenance resumes every paused trade', () => {
    const paused = sys(taken(), { type: 'pause' }, at(10));
    expect(timerEvents([paused], null, at(30))).toEqual([{ code: paused.code, event: { type: 'resume' } }]);
    const [resumed] = pass([paused], null, at(30));
    expect(resumed!.pausedAt).toBeNull();
    expect(resumed!.setupBy).toEqual(at(80)); // 60 + 20 min pause
  });

  test('lead review 8 Nov C2 (owner G7): a held trade is never resumed or ticked; maintenance still pauses it', () => {
    const paused = sys(taken(), { type: 'pause' }, at(10));
    const held = new Set([paused.code]);
    expect(decide([paused], null, at(30), held).events).toEqual([]);
    const open = secured('HELD2345EFGH6789');
    expect(decide([open], null, at(24 * 60), new Set([open.code])).events).toEqual([]);
    expect(decide([open], at(5), at(6), new Set([open.code])).events.map((e) => e.event)).toEqual([{ type: 'pause' }]);
  });

  // J-14 (owner D-059): a trade of an account locked by a "My account has been compromised" ticket
  // is paused at once and stays paused (all timers stop) until staff unlock the account, whatever
  // maintenance does.
  test('a locked trade (its account is locked) is paused, never resumed, never ticked, and resumes once it is no longer locked', () => {
    const open = secured();
    const locked = new Set([open.code]);
    const none = new Set<string>();
    expect(decide([open], null, at(5), none, locked).events).toEqual([{ code: open.code, event: { type: 'pause' }, at: at(5) }]);
    const paused = sys(open, { type: 'pause' }, at(5));
    // Maintenance off: an ordinary paused trade would resume; a held one does not.
    expect(decide([paused], null, at(200), none, locked).events).toEqual([]);
    // Maintenance on, then off again: still nothing for the held trade, even far past payBy.
    expect(decide([paused], at(100), at(300), none, locked).events).toEqual([]);
    expect(decide([paused], null, at(400), none, locked).events).toEqual([]);
    // Unlocked (no longer held): it resumes and its deadlines move by the whole pause.
    expect(decide([paused], null, at(400)).events).toEqual([{ code: paused.code, event: { type: 'resume' }, at: at(400) }]);
    const resumed = sys(paused, { type: 'resume' }, at(400));
    expect(resumed.payBy).toEqual(at(2 + TIMERS.payMin + 395));
    // A closed trade has no timer, held or not.
    // Past the setup window (setupMin, 60 since J-04): the request lapses and closes.
    const closed = sys(taken('ZZZZ2345EFGH6789'), { type: 'tick' }, at(TIMERS.setupMin + 1));
    expect(closed.closedAt).not.toBeNull();
    expect(decide([closed], null, at(TIMERS.setupMin + 2), none, new Set([closed.code])).events).toEqual([]);
  });

  test('maintenance on for 20 min moves payBy by 20 min and no tick fires meanwhile', () => {
    let trades = [secured()];
    const payBy = trades[0]!.payBy!;
    const since = at(30);
    for (let ms = since.getTime(); ms <= since.getTime() + 20 * MIN; ms += TIMER_LOOP_MS) {
      const now = new Date(ms);
      const events = timerEvents(trades, since, now);
      expect(events.every((e) => e.event.type === 'pause')).toBe(true);
      trades = pass(trades, since, now);
    }
    trades = pass(trades, null, at(50));
    expect(trades[0]!.payBy).toEqual(new Date(payBy.getTime() + 20 * MIN));
  });

  test('a lapse with funds that nobody refunded escalates after lapseCosignMin, strictly', () => {
    let t = sys(taken(), { type: 'setup-done', escrowAddress: '4escrow' }, at(1));
    t = sys(t, { type: 'chain', receivedAtomic: 5n, unlockedAtomic: 0n, confirmations: 0 }, at(2));
    t = sys(t, { type: 'tick' }, at(31, 1));
    expect(t.state).toBe('lapsed');
    const lapsedAt = t.lapsedAt!;
    const edge = new Date(lapsedAt.getTime() + TIMERS.lapseCosignMin * MIN);
    expect(timerEvents([t], null, edge)).toEqual([]);
    const after = new Date(edge.getTime() + 1);
    expect(timerEvents([t], null, after)).toEqual([{ code: t.code, event: { type: 'escalate' } }]);
    expect(pass([t], null, after)[0]!.state).toBe('disputed');
  });

  test('a lapse with nothing received never escalates', () => {
    let t = sys(taken(), { type: 'setup-done', escrowAddress: '4escrow' }, at(1));
    t = sys(t, { type: 'tick' }, at(31, 1));
    expect(t.state).toBe('lapsed');
    expect(timerEvents([t], null, at(500))).toEqual([]);
  });

  test('a paused lapse does not escalate; after resume the co-sign window has moved', () => {
    let t = sys(taken(), { type: 'setup-done', escrowAddress: '4escrow' }, at(1));
    t = sys(t, { type: 'chain', receivedAtomic: 5n, unlockedAtomic: 0n, confirmations: 0 }, at(2));
    t = sys(t, { type: 'tick' }, at(32)); // lapsedAt = 32
    t = sys(t, { type: 'pause' }, at(40));
    expect(timerEvents([t], at(40), at(100))).toEqual([]);
    t = sys(t, { type: 'resume' }, at(100)); // 60 min pause: window now ends at 32 + 30 + 60 = 122
    expect(timerEvents([t], null, at(122))).toEqual([]);
    expect(timerEvents([t], null, at(122, 1))).toEqual([{ code: t.code, event: { type: 'escalate' } }]);
  });

  test('every event but pause is at the loop clock', () => {
    const t = taken();
    expect(decide([t], null, at(60, 1)).events).toEqual([{ code: t.code, event: { type: 'tick' }, at: at(60, 1) }]);
    const paused = sys(t, { type: 'pause' }, at(5));
    expect(decide([paused], null, at(9)).events[0]!.at).toEqual(at(9));
  });

  test('pause is at maintenance_since, so a loop that was down still shifts deadlines by the whole maintenance', () => {
    const t = secured(); // payBy = 92 min
    const since = at(30);
    // the loop first sees the flag 10 min late, at 40, and maintenance ends at 50
    const { events } = decide([t], since, at(40));
    expect(events).toEqual([{ code: t.code, event: { type: 'pause' }, at: since }]);
    const [after] = pass(pass([t], since, at(40)), null, at(50));
    expect(after!.payBy).toEqual(at(92 + 20));
  });

  test('a trade taken during maintenance is paused from its take, not before it', () => {
    const t = newTrade({ ...takeArgs(), code: 'QQQQ2345EFGH6789' }, at(35));
    const { events } = decide([t], at(30), at(40));
    expect(events).toEqual([{ code: t.code, event: { type: 'pause' }, at: at(35) }]);
  });

  test('a flag set in the future pauses at the loop clock', () => {
    const t = taken();
    expect(decide([t], at(60), at(10)).events).toEqual([{ code: t.code, event: { type: 'pause' }, at: at(10) }]);
  });

  test('one bad trade is skipped and surfaced; the rest of the pass still runs', () => {
    // settling past settleBy with no settleFrom: the machine refuses the tick
    const broken: Trade = { ...secured('BROK2345EFGH6789'), state: 'settling', settling: 'release', settleFrom: null, settleBy: at(3) };
    const good = taken('GOOD2345EFGH6789');
    const r = decide([broken, good], null, at(61));
    expect(r.events).toEqual([{ code: good.code, event: { type: 'tick' }, at: at(61) }]);
    expect(r.skipped).toEqual([{ code: broken.code, reason: 'wrong-state' }]);
  });

  test('a claimed release is never reverted by the signing window (Task 9 I/O, lead decision b)', () => {
    const settling = apply(secured(), { type: 'release-started' }, 'seller', at(10)); // settleBy at 25
    expect(timerEvents([settling], null, at(26))).toEqual([{ code: settling.code, event: { type: 'tick' } }]);
    const claimed = sys(settling, { type: 'release-claimed' }, at(12));
    for (const m of [26, 60, 10 + 6 * 60 + 1]) expect(timerEvents([claimed], null, at(m))).toEqual([]);
    expect(pass([claimed], null, at(30))[0]!.state).toBe('settling');
  });

  test('a bad clock is refused', () => {
    expect(() => timerEvents([taken()], null, new Date(Number.NaN))).toThrow(RangeError);
    expect(() => timerEvents([taken()], new Date(Number.NaN), at(1))).toThrow(RangeError);
  });
});
