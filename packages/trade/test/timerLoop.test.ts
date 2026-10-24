import { describe, expect, test } from 'vitest';
import { TIMER_LOOP_MS, TIMERS, apply, newTrade, timerEvents, type Trade, type TradeEvent } from '../src/index.js';

const MIN = 60_000;
const T0 = new Date('2026-10-18T12:00:00.000Z');
const at = (min: number, ms = 0) => new Date(T0.getTime() + min * MIN + ms);
const FUNDS = 1_262_500_000_000n;

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
  for (const { code, event } of timerEvents(trades, maintenanceSince, now)) {
    byCode.set(code, sys(byCode.get(code)!, event, now));
  }
  return [...byCode.values()];
}

describe('timer loop decisions (Task 9, pure)', () => {
  test('runs every 5 s', () => {
    expect(TIMER_LOOP_MS).toBe(5_000);
  });

  test('ticks a trade whose deadline has passed, strictly after it', () => {
    const t = taken(); // setupBy = 15 min
    expect(timerEvents([t], null, at(15))).toEqual([]);
    expect(timerEvents([t], null, at(15, 1))).toEqual([{ code: t.code, event: { type: 'tick' } }]);
    expect(pass([t], null, at(15, 1))[0]!.state).toBe('cancelled');
  });

  test('does not tick a passed deadline when the tick would change nothing', () => {
    // secured past payBy: the seller extends or requests a refund; a tick does nothing there.
    const t = secured();
    expect(timerEvents([t], null, at(200))).toEqual([]);
  });

  test('never ticks a closed trade', () => {
    const t = pass([taken()], null, at(16))[0]!;
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
    const closed = pass([taken('ZZZZ2345EFGH6789')], null, at(16))[0]!;
    const since = at(10);
    expect(timerEvents([open, closed], since, at(10))).toEqual([{ code: open.code, event: { type: 'pause' } }]);
    const [paused] = pass([open], since, at(10));
    expect(paused!.pausedAt).toEqual(at(10));
    // past setupBy while paused: no tick, no second pause
    expect(timerEvents([paused!], since, at(40))).toEqual([]);
  });

  test('clearing maintenance resumes every paused trade', () => {
    const paused = sys(taken(), { type: 'pause' }, at(10));
    expect(timerEvents([paused], null, at(30))).toEqual([{ code: paused.code, event: { type: 'resume' } }]);
    const [resumed] = pass([paused], null, at(30));
    expect(resumed!.pausedAt).toBeNull();
    expect(resumed!.setupBy).toEqual(at(35)); // 15 + 20 min pause
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

  test('a bad clock is refused', () => {
    expect(() => timerEvents([taken()], null, new Date(Number.NaN))).toThrow(RangeError);
    expect(() => timerEvents([taken()], new Date(Number.NaN), at(1))).toThrow(RangeError);
  });
});
