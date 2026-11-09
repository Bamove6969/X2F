import { describe, expect, test } from 'vitest';
import { feeFor } from '@x2f/core';
import {
  CLIENT_EVENTS,
  SELLER_CONFIRM_CANCEL_TIMEOUT_H,
  awaitingCancelConfirm,
  amountForFunds,
  payoutsFor,
  SYSTEM_EVENTS,
  TIMERS,
  TradeRuleError,
  apply,
  newTrade,
  nextDeadline,
  releasableEta,
  type Trade,
  type TradeEvent,
  type TradeState,
} from '../src/index.js';

const MIN = 60_000;
const T0 = new Date('2026-10-18T12:00:00.000Z');
const at = (min: number, ms = 0) => new Date(T0.getTime() + min * MIN + ms);
const AMOUNT = 1_250_000_000_000n;
const FUNDS = 1_262_500_000_000n; // poster seller: amount + 1%
const RATE = { currency: 'USD', centsPerXmr: 33000n };

type By = 'buyer' | 'seller' | 'system';

const TAKE = {
  code: 'ABCD2345EFGH6789',
  offerId: 'offer-1',
  sellerId: 'acct-s',
  buyerId: 'acct-b',
  methodId: 'revolut',
  amountAtomic: AMOUNT,
  lockedRate: RATE,
  confirmWindowMin: 120,
  minFiatCents: 10_000n, // $100
  maxFiatCents: 50_000n, // $500; the trade is $412.50
};

function taken(poster: 'seller' | 'buyer' = 'seller'): Trade {
  return newTrade({ ...TAKE, poster }, T0);
}

function rule(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof TradeRuleError) return e.code;
    throw e;
  }
  throw new Error('expected a TradeRuleError');
}

const chain = (received: bigint, unlocked: bigint, confirmations: number): TradeEvent => ({ type: 'chain', receivedAtomic: received, unlockedAtomic: unlocked, confirmations });

/** Run a list of [event, by, minutes] steps from a fresh trade. */
function run(steps: [TradeEvent, By, number][], start: Trade = taken()): Trade {
  return steps.reduce((t, [e, by, min]) => apply(t, e, by, at(min)), start);
}

const funding = (): Trade => run([[{ type: 'setup-done', escrowAddress: '4Escrow' }, 'system', 1]]);
const securing = (): Trade => run([[chain(FUNDS, 0n, 1), 'system', 5]], funding());
/** Secured at minute 30, payBy at minute 120. */
const secured = (): Trade => run([[chain(FUNDS, FUNDS, 10), 'system', 30]], securing());
/** Secured, and the seller nudged the buyer at minute 60 (a record only: nudges are optional, owner 8 Nov). */
const nudged = (t: Trade = secured(), min = 60): Trade => ({ ...t, sellerNudgedAt: at(min) });
/** The seller cancelled at minute 121, after payBy (120): the refund to them settles at once (owner 8 Nov). settleBy 136. */
const sellerCancelled = (t: Trade = secured(), min = 121): Trade => apply(t, { type: 'request-refund' }, 'seller', at(min));
/** Paid at minute 40, confirmBy at minute 160. */
const paid = (): Trade => run([[{ type: 'mark-paid', fiatCents: 41250n }, 'buyer', 40]], secured());
/** Release started at minute 50, settleBy at minute 65. */
const settling = (): Trade => run([[{ type: 'release-started' }, 'seller', 50]], paid());
const refunded = (): Trade => run([[{ type: 'settled', kind: 'buyer-cancel', txHash: 'aa'.repeat(32) }, 'system', 61]], run([[{ type: 'buyer-cancel' }, 'buyer', 45]], secured()));

const sampleEvent: Record<TradeEvent['type'], TradeEvent> = {
  'setup-done': { type: 'setup-done', escrowAddress: '4Escrow' },
  chain: chain(1n, 0n, 0),
  'mark-paid': { type: 'mark-paid', fiatCents: 41250n },
  extend: { type: 'extend' },
  'request-refund': { type: 'request-refund' },
  'buyer-cancel': { type: 'buyer-cancel' },
  'propose-cancel': { type: 'propose-cancel' },
  'accept-cancel': { type: 'accept-cancel' },
  'withdraw-cancel': { type: 'withdraw-cancel' },
  'fund-started': { type: 'fund-started' },
  'walk-away': { type: 'walk-away' },
  'confirm-cancel': { type: 'confirm-cancel', returnConfirmations: 10 },
  'return-confirmed': { type: 'return-confirmed', confirmations: 10 },
  'release-started': { type: 'release-started' },
  settled: { type: 'settled', kind: 'release', txHash: 'aa'.repeat(32) },
  'open-dispute': { type: 'open-dispute' },
  escalate: { type: 'escalate' },
  'release-claimed': { type: 'release-claimed' },
  pause: { type: 'pause' },
  resume: { type: 'resume' },
  tick: { type: 'tick' },
};

describe('constants', () => {
  test('TIMERS', () => {
    expect(TIMERS).toEqual({ setupMin: 15, fundMin: 30, payMin: 90, extendMin: 30, maxExtensions: 2, settleMin: 15, lapseCosignMin: 30, disputeAfterRefundHours: 48 });
  });

  test('every event type is exactly one of system or client', () => {
    const all = Object.keys(sampleEvent).sort();
    expect([...SYSTEM_EVENTS, ...CLIENT_EVENTS].sort()).toEqual(all);
  });
});

describe('system-only events (P3-C2)', () => {
  for (const type of SYSTEM_EVENTS) {
    for (const by of ['buyer', 'seller'] as const) {
      test(`${type} by ${by} → wrong-party`, () => {
        expect(rule(() => apply(secured(), sampleEvent[type], by, at(31)))).toBe('wrong-party');
      });
    }
  }
  for (const type of CLIENT_EVENTS) {
    test(`${type} by system → wrong-party`, () => {
      expect(rule(() => apply(secured(), sampleEvent[type], 'system', at(31)))).toBe('wrong-party');
    });
  }
});

describe('take, setup and funding', () => {
  test('take → setup with setupBy = takenAt + 15 min; amounts and rate fixed at take', () => {
    const t = taken();
    expect(t.state).toBe('setup');
    expect(t.takenAt).toEqual(T0);
    expect(t.setupBy).toEqual(at(15));
    expect(t.feeAtomic).toBe(12_500_000_000n);
    expect(t.sellerFundsAtomic).toBe(FUNDS);
    expect(t.fiatCents).toBe(41250n);
    expect(taken('buyer').sellerFundsAtomic).toBe(AMOUNT);
    expect(t.minFiatCents).toBe(10_000n);
    expect(t.maxFiatCents).toBe(50_000n);
    expect(t.grown).toBeNull();
    expect(t.lapsedAt).toBeNull();
  });

  test('newTrade refuses bad terms', () => {
    const bad = [
      { ...TAKE, poster: 'seller' as const, amountAtomic: 1n }, // fiat total rounds to 0
      { ...TAKE, poster: 'seller' as const, confirmWindowMin: 5761 }, // longer than 4 days (owner F9's slowest types)
      { ...TAKE, poster: 'seller' as const, confirmWindowMin: 0 },
      { ...TAKE, poster: 'seller' as const, minFiatCents: 50_000n }, // $412.50 below the minimum
      { ...TAKE, poster: 'seller' as const, maxFiatCents: 40_000n }, // above the maximum
      { ...TAKE, poster: 'seller' as const, minFiatCents: 0n },
      { ...TAKE, poster: 'seller' as const, sellerId: 'acct-b' },
    ];
    for (const a of bad) expect(() => newTrade(a, T0)).toThrow(RangeError);
    expect(newTrade({ ...TAKE, poster: 'seller', confirmWindowMin: 1440 }, T0).confirmWindowMin).toBe(1440);
    // Owner F9 (7 Nov): slow payment types get 48 h to 4 days before a dispute.
    expect(newTrade({ ...TAKE, poster: 'seller', confirmWindowMin: 5760 }, T0).confirmWindowMin).toBe(5760);
  });

  test('tick past setupBy → cancelled, no penalty', () => {
    const t = apply(taken(), { type: 'tick' }, 'system', at(15, 1));
    expect(t.state).toBe('cancelled');
    expect(t.closedAt).toEqual(at(15, 1));
    expect(apply(taken(), { type: 'tick' }, 'system', at(15)).state).toBe('setup');
  });

  test('setup-done → funding, fundBy = now + 30 min', () => {
    const t = funding();
    expect(t.state).toBe('funding');
    expect(t.escrowAddress).toBe('4Escrow');
    expect(t.fundBy).toEqual(at(31));
    expect(rule(() => apply(t, { type: 'setup-done', escrowAddress: '4Other' }, 'system', at(2)))).toBe('wrong-state');
  });

  test('tick after fundBy with received < sellerFunds → lapsed', () => {
    const part = run([[chain(FUNDS - 1n, 0n, 0), 'system', 10]], funding());
    expect(part.state).toBe('funding');
    expect(apply(part, { type: 'tick' }, 'system', at(31)).state).toBe('funding');
    expect(apply(part, { type: 'tick' }, 'system', at(31, 1)).state).toBe('lapsed');
    const lapsedPart = apply(part, { type: 'tick' }, 'system', at(31, 1));
    expect(lapsedPart.lapsedAt).toEqual(at(31, 1));
    expect(lapsedPart.closedAt).toBeNull(); // coins to refund: still open
    const empty = apply(funding(), { type: 'tick' }, 'system', at(31, 1));
    expect(empty.state).toBe('lapsed');
    expect(empty.lapsedAt).toEqual(at(31, 1));
    expect(empty.closedAt).toEqual(at(31, 1)); // nothing to refund: closed
  });

  test('chain with received ≥ sellerFunds → securing; lockedRate never changes', () => {
    const t = securing();
    expect(t.state).toBe('securing');
    expect(t.fundingSeenAt).toEqual(at(5));
    expect(t.releasable).toBe(false);
    const later = run([
      [chain(FUNDS, FUNDS, 10), 'system', 30],
      [{ type: 'mark-paid', fiatCents: 41250n }, 'buyer', 40],
    ], t);
    expect(later.lockedRate).toEqual(RATE);
    expect(later.fiatCents).toBe(41250n);
  });

  test('a short chain stays in funding and records what arrived', () => {
    const t = run([[chain(FUNDS / 2n, 0n, 0), 'system', 10]], funding());
    expect(t.state).toBe('funding');
    expect(t.receivedAtomic).toBe(FUNDS / 2n);
    expect(t.fundingSeenAt).toBeNull();
  });
});

describe('secured and releasable', () => {
  test('releasable = received > 0 && unlocked === received', () => {
    expect(run([[chain(FUNDS, FUNDS - 1n, 9), 'system', 20]], securing()).releasable).toBe(false);
    const t = secured();
    expect(t.releasable).toBe(true);
    expect(t.state).toBe('secured');
    expect(t.securedAt).toEqual(at(30));
    expect(t.payBy).toEqual(at(120));
    expect(apply(funding(), chain(0n, 0n, 0), 'system', at(2)).releasable).toBe(false);
  });

  test('fully unlocked but short does not secure', () => {
    const t = run([[chain(FUNDS - 1n, FUNDS - 1n, 10), 'system', 20]], funding());
    expect(t.state).toBe('funding');
    expect(t.releasable).toBe(true);
  });

  test('a late surplus clears releasable until it unlocks, with no deadline on the wait', () => {
    const t = run([[chain(FUNDS + 1000n, FUNDS, 0), 'system', 50]], paid());
    expect(t.state).toBe('paid');
    expect(t.releasable).toBe(false);
    expect(rule(() => apply(t, { type: 'release-started' }, 'seller', at(51)))).toBe('not-releasable');
    const later = apply(t, { type: 'tick' }, 'system', at(5000));
    expect(later.state).toBe('paid');
    expect(apply(later, chain(FUNDS + 1000n, FUNDS + 1000n, 10), 'system', at(5001)).releasable).toBe(true);
  });

  test('malformed chain facts are rejected', () => {
    expect(() => apply(funding(), chain(1n, 2n, 0), 'system', at(2))).toThrow(RangeError);
    expect(() => apply(funding(), chain(-1n, 0n, 0), 'system', at(2))).toThrow(RangeError);
    expect(() => apply(funding(), chain(1n, 0n, -1), 'system', at(2))).toThrow(RangeError);
  });
});

describe('mark-paid', () => {
  test('buyer in secured, also after the time to pay: it is not a hard end (owner 8 Nov, p9-2)', () => {
    for (const min of [40, 119, 120, 121, 600]) {
      const t = apply(secured(), { type: 'mark-paid', fiatCents: 41250n }, 'buyer', at(min));
      expect(t.state).toBe('paid');
      expect(t.paidAt).toEqual(at(min));
      expect(t.confirmBy).toEqual(at(min + 120));
    }
  });

  test('refused with too-early while the escrow is still securing, even at 9 of 10 or 10 confirmations not yet unlocked (owner Q12)', () => {
    expect(rule(() => apply(securing(), { type: 'mark-paid', fiatCents: 41250n }, 'buyer', at(10)))).toBe('too-early');
    const nine = apply(securing(), chain(FUNDS, 0n, 9), 'system', at(20));
    expect(nine.state).toBe('securing');
    expect(rule(() => apply(nine, { type: 'mark-paid', fiatCents: 41250n }, 'buyer', at(21)))).toBe('too-early');
    const tenLocked = apply(securing(), chain(FUNDS, 0n, 10), 'system', at(25));
    expect(tenLocked.state).toBe('securing');
    expect(rule(() => apply(tenLocked, { type: 'mark-paid', fiatCents: 41250n }, 'buyer', at(26)))).toBe('too-early');
    // Once all 10 are in and the coins unlock, the trade is secured and the tap goes through.
    const done = apply(tenLocked, chain(FUNDS, FUNDS, 10), 'system', at(30));
    expect(apply(done, { type: 'mark-paid', fiatCents: 41250n }, 'buyer', at(31)).state).toBe('paid');
  });

  test("refused wrong-state once the seller's cancel is in, at once, also while paused (owner 8 Nov: no final warning)", () => {
    const c = sellerCancelled();
    for (const min of [121, 122, 136, 600]) expect(rule(() => apply(c, { type: 'mark-paid', fiatCents: 41250n }, 'buyer', at(min)))).toBe('wrong-state');
    const p = apply(c, { type: 'pause' }, 'system', at(122));
    expect(rule(() => apply(p, { type: 'mark-paid', fiatCents: 41250n }, 'buyer', at(123)))).toBe('wrong-state');
  });

  test('withdraws any open cancel proposal, either side\'s (no cancel after I\'ve paid, Revision 2026-10-29b)', () => {
    const sp = apply(secured(), { type: 'propose-cancel' }, 'seller', at(35));
    expect(apply(sp, { type: 'mark-paid', fiatCents: 41250n }, 'buyer', at(40)).cancelProposedBy).toBeNull();
    const bp = apply(secured(), { type: 'propose-cancel' }, 'buyer', at(35));
    expect(apply(bp, { type: 'mark-paid', fiatCents: 41250n }, 'buyer', at(40)).cancelProposedBy).toBeNull();
  });

  test('refused with total-changed unless it carries the fiat total the trade has now (I-C)', () => {
    expect(rule(() => apply(secured(), { type: 'mark-paid', fiatCents: 41249n }, 'buyer', at(31)))).toBe('total-changed');
    expect(rule(() => apply(secured(), { type: 'mark-paid', fiatCents: 41251n }, 'buyer', at(31)))).toBe('total-changed');
    expect(rule(() => apply(secured(), { type: 'mark-paid', fiatCents: 0n }, 'buyer', at(31)))).toBe('total-changed');
    expect(apply(secured(), { type: 'mark-paid', fiatCents: 41250n }, 'buyer', at(31)).state).toBe('paid');
    for (const bad of [41250, '41250', undefined, null]) {
      expect(() => apply(secured(), { type: 'mark-paid', fiatCents: bad } as unknown as TradeEvent, 'buyer', at(31))).toThrow(RangeError);
    }
  });

  test('reproduced: the trade grows a minute before the tap; the tap with the old total is refused, the new total goes through (I-C)', () => {
    const extra = FUNDS + 10_100_000_000n;
    const grown = apply(secured(), chain(extra, extra, 10), 'system', at(39));
    expect(grown.fiatCents).toBe(41580n);
    expect(rule(() => apply(grown, { type: 'mark-paid', fiatCents: 41250n }, 'buyer', at(40)))).toBe('total-changed');
    const p = apply(grown, { type: 'mark-paid', fiatCents: 41580n }, 'buyer', at(41));
    expect(p.state).toBe('paid');
    expect(p.fiatCents).toBe(41580n);
  });

  test('seller → wrong-party; other states → wrong-state', () => {
    expect(rule(() => apply(secured(), { type: 'mark-paid', fiatCents: 41250n }, 'seller', at(31)))).toBe('wrong-party');
    expect(rule(() => apply(funding(), { type: 'mark-paid', fiatCents: 41250n }, 'buyer', at(2)))).toBe('wrong-state');
    expect(rule(() => apply(paid(), { type: 'mark-paid', fiatCents: 41250n }, 'buyer', at(41)))).toBe('wrong-state');
  });
});

describe('extend', () => {
  test('seller in secured once payBy is reached, at most twice', () => {
    const s = secured();
    expect(rule(() => apply(s, { type: 'extend' }, 'seller', at(119)))).toBe('too-early');
    expect(rule(() => apply(s, { type: 'extend' }, 'buyer', at(120)))).toBe('wrong-party');
    const once = apply(s, { type: 'extend' }, 'seller', at(120));
    expect(once.payBy).toEqual(at(150));
    expect(once.extensions).toBe(1);
    const twice = apply(once, { type: 'extend' }, 'seller', at(151));
    expect(twice.payBy).toEqual(at(181));
    expect(twice.extensions).toBe(2);
    expect(rule(() => apply(twice, { type: 'extend' }, 'seller', at(181)))).toBe('no-extensions-left');
  });

  test('not in paid', () => {
    expect(rule(() => apply(paid(), { type: 'extend' }, 'seller', at(130)))).toBe('wrong-state');
  });
});

describe('request-refund: the seller cancels after the time to pay (owner 8 Nov, p6-1, p9-2, p9-4)', () => {
  test('only strictly after payBy; the refund to the seller settles at once (no final alert)', () => {
    const s = secured(); // payBy 120
    expect(rule(() => apply(s, { type: 'request-refund' }, 'seller', at(120)))).toBe('too-early');
    const t = apply(s, { type: 'request-refund' }, 'seller', at(120, 1));
    expect(t.state).toBe('settling');
    expect(t.settling).toBe('auto-refund');
    expect(t.settleFrom).toBe('secured');
    expect(t.settleBy).toEqual(at(135, 1));
    expect(t.paidAt).toBeNull();
    expect('finalAlertAt' in t).toBe(false);
  });

  test('nudges are optional: no nudge, a nudge before securing, or one after, all the same', () => {
    const s = secured();
    expect(s.sellerNudgedAt).toBeNull();
    for (const t of [s, nudged(s, 20), nudged(s, 60), nudged(s, 130)]) {
      expect(rule(() => apply(t, { type: 'request-refund' }, 'seller', at(119)))).toBe('too-early');
      expect(apply(t, { type: 'request-refund' }, 'seller', at(131)).settling).toBe('auto-refund');
    }
  });

  test('an extension moves the time to pay: the cancel waits for the new payBy', () => {
    const once = apply(secured(), { type: 'extend' }, 'seller', at(120)); // payBy 150
    expect(rule(() => apply(once, { type: 'request-refund' }, 'seller', at(150)))).toBe('too-early');
    expect(apply(once, { type: 'request-refund' }, 'seller', at(150, 1)).state).toBe('settling');
  });

  test('no event sets sellerNudgedAt (only the nudge route writes it)', () => {
    const t = nudged();
    for (const [e, by, min] of [[{ type: 'extend' }, 'seller', 121], [{ type: 'tick' }, 'system', 122], [{ type: 'request-refund' }, 'seller', 123]] as [TradeEvent, By, number][]) {
      expect(apply(t, e, by, at(min)).sellerNudgedAt).toEqual(at(60));
    }
    expect(taken().sellerNudgedAt).toBeNull();
  });

  test("buyer → wrong-party; after I've paid nobody can cancel (paid → wrong-state); twice → wrong-state; paused → wrong-state", () => {
    expect(rule(() => apply(secured(), { type: 'request-refund' }, 'buyer', at(121)))).toBe('wrong-party');
    expect(rule(() => apply(paid(), { type: 'request-refund' }, 'seller', at(121)))).toBe('wrong-state');
    expect(rule(() => apply(paid(), { type: 'request-refund' }, 'seller', at(2000)))).toBe('wrong-state');
    // A late "I've paid" (after payBy) still takes the cancel away.
    const late = apply(secured(), { type: 'mark-paid', fiatCents: 41250n }, 'buyer', at(130));
    expect(rule(() => apply(late, { type: 'request-refund' }, 'seller', at(131)))).toBe('wrong-state');
    expect(rule(() => apply(sellerCancelled(), { type: 'request-refund' }, 'seller', at(122)))).toBe('wrong-state');
    const p = apply(secured(), { type: 'pause' }, 'system', at(125));
    expect(rule(() => apply(p, { type: 'request-refund' }, 'seller', at(126)))).toBe('wrong-state');
    const d = apply(secured(), { type: 'open-dispute' }, 'buyer', at(100));
    expect(rule(() => apply(d, { type: 'request-refund' }, 'seller', at(130)))).toBe('wrong-state');
  });

  test("race: I've paid and Cancel at the same moment; whichever the trade row takes first wins, the other is refused", () => {
    const cancelFirst = sellerCancelled(secured(), 121);
    expect(rule(() => apply(cancelFirst, { type: 'mark-paid', fiatCents: 41250n }, 'buyer', at(121)))).toBe('wrong-state');
    expect(cancelFirst.settling).toBe('auto-refund');
    const paidFirst = apply(secured(), { type: 'mark-paid', fiatCents: 41250n }, 'buyer', at(121));
    expect(rule(() => apply(paidFirst, { type: 'request-refund' }, 'seller', at(121)))).toBe('wrong-state');
    expect(paidFirst.state).toBe('paid');
  });

  test("the seller's cancel is not undone by its signing window (no revert to secured, so no late I've paid)", () => {
    const c = sellerCancelled(); // settleBy 136
    for (const min of [136, 137, 500, 5000]) {
      const t = apply(c, { type: 'tick' }, 'system', at(min));
      expect(t.state).toBe('settling');
      expect(t.settling).toBe('auto-refund');
    }
    expect(nextDeadline(c)).toBeNull();
    expect(rule(() => apply(c, { type: 'buyer-cancel' }, 'buyer', at(122)))).toBe('wrong-state');
    expect(rule(() => apply(c, { type: 'propose-cancel' }, 'buyer', at(122)))).toBe('wrong-state');
    expect(rule(() => apply(c, { type: 'release-started' }, 'seller', at(122)))).toBe('wrong-state');
  });

  test('the trade is refunded when the refund lands; a chain reorg while settling holds the signing clock', () => {
    const c = sellerCancelled();
    const r = apply(c, { type: 'settled', kind: 'auto-refund', txHash: 'cc'.repeat(32) }, 'system', at(140));
    expect(r.state).toBe('refunded');
    expect(r.settling).toBe('auto-refund');
    expect(r.closedAt).toEqual(at(140));
    const locked = apply(c, chain(FUNDS, 0n, 3), 'system', at(125));
    expect(locked.settleBy).toBeNull();
    expect(locked.state).toBe('settling');
  });
});

describe('buyer-cancel', () => {
  test('in setup, or funding with nothing received → cancelled', () => {
    const a = apply(taken(), { type: 'buyer-cancel' }, 'buyer', at(1));
    expect(a.state).toBe('cancelled');
    expect(a.closedAt).toEqual(at(1));
    expect(apply(funding(), { type: 'buyer-cancel' }, 'buyer', at(2)).state).toBe('cancelled');
  });

  test('funding with part received → settling/buyer-cancel, settleBy waits for unlock', () => {
    const part = run([[chain(1000n, 0n, 0), 'system', 3]], funding());
    const t = apply(part, { type: 'buyer-cancel' }, 'buyer', at(4));
    expect(t.state).toBe('settling');
    expect(t.settling).toBe('buyer-cancel');
    expect(t.settleFrom).toBe('funding');
    expect(t.settleBy).toBeNull();
    const unlocked = apply(t, chain(1000n, 1000n, 10), 'system', at(25));
    expect(unlocked.settleBy).toEqual(at(40));
  });

  for (const [name, make] of [
    ['securing', securing],
    ['secured', secured],
  ] as const) {
    test(`in ${name} → settling/buyer-cancel`, () => {
      const before = make();
      const t = apply(before, { type: 'buyer-cancel' }, 'buyer', at(130));
      expect(t.state).toBe('settling');
      expect(t.settling).toBe('buyer-cancel');
      expect(t.settleFrom).toBe(name);
      expect(t.settleBy).toEqual(before.releasable ? at(145) : null);
    });
  }

  test('by the seller → wrong-party in every state', () => {
    const states: Trade[] = [taken(), funding(), securing(), secured(), paid(), settling(), refunded(), run([[{ type: 'tick' }, 'system', 32]], funding())];
    for (const t of states) expect(rule(() => apply(t, { type: 'buyer-cancel' }, 'seller', at(70)))).toBe('wrong-party');
  });

  test("refused in paid: no cancel after I've paid (Revision 2026-10-29b)", () => {
    expect(rule(() => apply(paid(), { type: 'buyer-cancel' }, 'buyer', at(45)))).toBe('wrong-state');
    // Also while paused (the buyer's cancel is otherwise accepted during maintenance).
    const p = apply(paid(), { type: 'pause' }, 'system', at(45));
    expect(rule(() => apply(p, { type: 'buyer-cancel' }, 'buyer', at(46)))).toBe('wrong-state');
    // And after a release's signing window ran out back to paid.
    const back = apply(settling(), { type: 'tick' }, 'system', at(66));
    expect(back.state).toBe('paid');
    expect(rule(() => apply(back, { type: 'buyer-cancel' }, 'buyer', at(67)))).toBe('wrong-state');
  });

  test('not once settling or closed', () => {
    expect(rule(() => apply(settling(), { type: 'buyer-cancel' }, 'buyer', at(51)))).toBe('wrong-state');
    expect(rule(() => apply(refunded(), { type: 'buyer-cancel' }, 'buyer', at(62)))).toBe('wrong-state');
  });
});

describe('a seller cannot end a funded trade alone', () => {
  test("no client event by the seller moves a funded trade to cancelled, refunded or a refund settlement, but for the cancel after the time to pay with no I've paid", () => {
    const starts: Trade[] = [securing(), secured(), paid(), sellerCancelled()];
    for (const start of starts) {
      for (const type of CLIENT_EVENTS) {
        for (const min of [31, 121, 200, 2000]) {
          let next: Trade;
          try {
            next = apply(start, sampleEvent[type], 'seller', at(min));
          } catch (e) {
            if (e instanceof TradeRuleError) continue;
            throw e;
          }
          expect(['cancelled', 'refunded']).not.toContain(next.state);
          if (next.state === 'settling' && next.settling !== 'release') {
            // Owner 8 Nov: the seller's own cancel, only from secured, past payBy, never after "I've paid".
            expect(type).toBe('request-refund');
            expect(next.settling).toBe('auto-refund');
            expect(start.state).toBe('secured');
            expect(start.paidAt).toBeNull();
            expect(min).toBeGreaterThan(120);
          }
        }
      }
    }
  });
});

describe("the seller's walk-away and fund-started (Revision 2026-10-29b)", () => {
  test('walk-away in setup → cancelled', () => {
    const t = apply(taken(), { type: 'walk-away' }, 'seller', at(1));
    expect(t.state).toBe('cancelled');
    expect(t.closedAt).toEqual(at(1));
  });

  test('walk-away in funding before Fund escrow and before any coins → cancelled', () => {
    expect(apply(funding(), { type: 'walk-away' }, 'seller', at(2)).state).toBe('cancelled');
  });

  test('after fund-started → wrong-state', () => {
    const f = apply(funding(), { type: 'fund-started' }, 'seller', at(2));
    expect(f.fundStartedAt).toEqual(at(2));
    expect(f.state).toBe('funding');
    expect(rule(() => apply(f, { type: 'walk-away' }, 'seller', at(3)))).toBe('wrong-state');
  });

  test('after any coins are seen → wrong-state, even without fund-started', () => {
    const part = run([[chain(1000n, 0n, 0), 'system', 3]], funding());
    expect(rule(() => apply(part, { type: 'walk-away' }, 'seller', at(4)))).toBe('wrong-state');
    for (const t of [securing(), secured(), paid(), settling(), refunded()]) {
      expect(rule(() => apply(t, { type: 'walk-away' }, 'seller', at(70)))).toBe('wrong-state');
    }
  });

  test('fund-started twice → wrong-state; only in funding', () => {
    const f = apply(funding(), { type: 'fund-started' }, 'seller', at(2));
    expect(rule(() => apply(f, { type: 'fund-started' }, 'seller', at(3)))).toBe('wrong-state');
    expect(rule(() => apply(taken(), { type: 'fund-started' }, 'seller', at(1)))).toBe('wrong-state');
    expect(rule(() => apply(securing(), { type: 'fund-started' }, 'seller', at(6)))).toBe('wrong-state');
  });

  test('both are the seller\'s only', () => {
    expect(rule(() => apply(funding(), { type: 'walk-away' }, 'buyer', at(2)))).toBe('wrong-party');
    expect(rule(() => apply(funding(), { type: 'fund-started' }, 'buyer', at(2)))).toBe('wrong-party');
  });

  test('fund-started is recorded during maintenance; walk-away is not', () => {
    const p = apply(funding(), { type: 'pause' }, 'system', at(2));
    expect(apply(p, { type: 'fund-started' }, 'seller', at(3)).fundStartedAt).toEqual(at(3));
    expect(rule(() => apply(p, { type: 'walk-away' }, 'seller', at(3)))).toBe('wrong-state');
  });

  test('new trades start with no fund tap', () => {
    expect(taken().fundStartedAt).toBeNull();
  });
});

describe("the seller's Confirm cancel after a buyer's cancel (owner 2026-10-29, option B)", () => {
  const confirm = (n: number): TradeEvent => ({ type: 'confirm-cancel', returnConfirmations: n });

  test('greyed out until the return has 10 confirmations, then it officially cancels', () => {
    const r = refunded(); // buyer-cancel refund settled at minute 61
    expect(r.cancelConfirmedAt).toBeNull();
    expect(rule(() => apply(r, confirm(9), 'seller', at(70)))).toBe('too-early');
    const c = apply(r, confirm(10), 'seller', at(80));
    expect(c.cancelConfirmedAt).toEqual(at(80));
    expect(c.state).toBe('refunded');
    expect(rule(() => apply(c, confirm(12), 'seller', at(81)))).toBe('wrong-state');
  });

  test("the seller's only, and only for a buyer's cancel that has settled", () => {
    expect(rule(() => apply(refunded(), confirm(10), 'buyer', at(80)))).toBe('wrong-party');
    const settlingCancel = apply(secured(), { type: 'buyer-cancel' }, 'buyer', at(45));
    expect(rule(() => apply(settlingCancel, confirm(10), 'seller', at(50)))).toBe('wrong-state');
    const mutual = run(
      [
        [{ type: 'propose-cancel' }, 'buyer', 35],
        [{ type: 'accept-cancel' }, 'seller', 36],
        [{ type: 'settled', kind: 'mutual-cancel', txHash: 'cc'.repeat(32) }, 'system', 40],
      ],
      secured(),
    );
    expect(rule(() => apply(mutual, confirm(10), 'seller', at(80)))).toBe('wrong-state');
    expect(rule(() => apply(taken(), confirm(10), 'seller', at(1)))).toBe('wrong-state');
  });

  test('a bad count is a RangeError, not a rule', () => {
    expect(() => apply(refunded(), confirm(-1), 'seller', at(80))).toThrow(RangeError);
    expect(() => apply(refunded(), confirm(1.5), 'seller', at(80))).toThrow(RangeError);
  });

  test('return-confirmed (system) makes Confirm cancel available once; 48 h later the trade closes as cancelled by itself', () => {
    expect(SELLER_CONFIRM_CANCEL_TIMEOUT_H).toBe(48);
    const r = refunded(); // settled at minute 61
    expect(nextDeadline(r)).toBeNull();
    expect(rule(() => apply(r, { type: 'return-confirmed', confirmations: 10 }, 'seller', at(70)))).toBe('wrong-party');
    expect(rule(() => apply(r, { type: 'return-confirmed', confirmations: 9 }, 'system', at(70)))).toBe('too-early');
    const c = apply(r, { type: 'return-confirmed', confirmations: 10 }, 'system', at(80));
    expect(c.cancelConfirmableAt).toEqual(at(80));
    expect(rule(() => apply(c, { type: 'return-confirmed', confirmations: 11 }, 'system', at(81)))).toBe('wrong-state');
    const due = at(80 + 48 * 60);
    expect(nextDeadline(c)).toEqual(due);
    expect(apply(c, { type: 'tick' }, 'system', due)).toBe(c);
    const closed = apply(c, { type: 'tick' }, 'system', at(80 + 48 * 60, 1));
    expect(closed.cancelConfirmedAt).toEqual(at(80 + 48 * 60, 1));
    expect(closed.state).toBe('refunded');
    expect(nextDeadline(closed)).toBeNull();
    expect(rule(() => apply(closed, confirm(10), 'seller', at(80 + 48 * 60 + 1)))).toBe('wrong-state');
  });

  test('review M1: once the full count is recorded, Confirm cancel no longer depends on a fresh count', () => {
    const c = apply(refunded(), { type: 'return-confirmed', confirmations: 10 }, 'system', at(80));
    expect(apply(c, confirm(0), 'seller', at(90)).cancelConfirmedAt).toEqual(at(90));
  });

  test('review M3: an unconfirmed buyer cancel can be escalated to a moderator whatever the escrow reads', () => {
    const r = apply(refunded(), chain(0n, 0n, 0), 'system', at(70));
    expect(r.receivedAtomic).toBe(0n);
    const d = apply(r, { type: 'escalate' }, 'system', at(71));
    expect(d.state).toBe('disputed');
    expect(d.dispute?.by).toBe('system');
  });

  test('the seller confirming first stops the auto-close', () => {
    const c = apply(refunded(), { type: 'return-confirmed', confirmations: 10 }, 'system', at(80));
    const done = apply(c, confirm(10), 'seller', at(90));
    expect(nextDeadline(done)).toBeNull();
    expect(apply(done, { type: 'tick' }, 'system', at(80 + 49 * 60)).cancelConfirmedAt).toEqual(at(90));
  });

  test('maintenance freezes the 48 hours like every other trade timer', () => {
    const c = apply(refunded(), { type: 'return-confirmed', confirmations: 10 }, 'system', at(80));
    const p = apply(c, { type: 'pause' }, 'system', at(100));
    expect(nextDeadline(p)).toBeNull();
    expect(apply(p, { type: 'tick' }, 'system', at(80 + 50 * 60)).cancelConfirmedAt).toBeNull();
    const resumed = apply(p, { type: 'resume' }, 'system', at(160)); // paused 60 min
    expect(resumed.cancelConfirmableAt).toEqual(at(140));
    expect(nextDeadline(resumed)).toEqual(at(140 + 48 * 60));
    // Recorded during maintenance: the 48 hours count from the pause, so they start at the resume.
    const p2 = apply(refunded(), { type: 'pause' }, 'system', at(70));
    const c2 = apply(p2, { type: 'return-confirmed', confirmations: 10 }, 'system', at(80));
    expect(apply(c2, { type: 'resume' }, 'system', at(130)).cancelConfirmableAt).toEqual(at(130));
  });
});

describe('mutual cancel', () => {
  test('propose by one side, accept by the other → settling/mutual-cancel when releasable', () => {
    const p = apply(secured(), { type: 'propose-cancel' }, 'seller', at(40));
    expect(p.cancelProposedBy).toBe('seller');
    expect(rule(() => apply(p, { type: 'accept-cancel' }, 'seller', at(41)))).toBe('wrong-party');
    const t = apply(p, { type: 'accept-cancel' }, 'buyer', at(41));
    expect(t.state).toBe('settling');
    expect(t.settling).toBe('mutual-cancel');
    expect(t.settleFrom).toBe('secured');
    expect(t.settleBy).toEqual(at(56));
  });

  test('accept when not releasable → not-releasable', () => {
    const p = apply(securing(), { type: 'propose-cancel' }, 'buyer', at(6));
    expect(rule(() => apply(p, { type: 'accept-cancel' }, 'seller', at(7)))).toBe('not-releasable');
  });

  test('accept when nothing was ever received → cancelled', () => {
    const p = apply(funding(), { type: 'propose-cancel' }, 'seller', at(2));
    const t = apply(p, { type: 'accept-cancel' }, 'buyer', at(3));
    expect(t.state).toBe('cancelled');
    expect(t.closedAt).toEqual(at(3));
  });

  test('withdraw by the proposer only; accept with nothing proposed → wrong-state', () => {
    const p = apply(secured(), { type: 'propose-cancel' }, 'buyer', at(35));
    expect(rule(() => apply(p, { type: 'withdraw-cancel' }, 'seller', at(46)))).toBe('wrong-party');
    const w = apply(p, { type: 'withdraw-cancel' }, 'buyer', at(46));
    expect(w.cancelProposedBy).toBeNull();
    expect(rule(() => apply(w, { type: 'accept-cancel' }, 'seller', at(47)))).toBe('wrong-state');
    expect(rule(() => apply(w, { type: 'withdraw-cancel' }, 'buyer', at(47)))).toBe('wrong-state');
  });

  test("propose, accept and withdraw refused in paid: no cancel after I've paid (Revision 2026-10-29b)", () => {
    for (const by of ['buyer', 'seller'] as const) {
      expect(rule(() => apply(paid(), { type: 'propose-cancel' }, by, at(45)))).toBe('wrong-state');
      expect(rule(() => apply(paid(), { type: 'accept-cancel' }, by, at(45)))).toBe('wrong-state');
      expect(rule(() => apply(paid(), { type: 'withdraw-cancel' }, by, at(45)))).toBe('wrong-state');
    }
    // A proposal open at the tap is gone with it, so nothing is left to accept.
    const sp = run([[{ type: 'propose-cancel' }, 'seller', 35], [{ type: 'mark-paid', fiatCents: 41250n }, 'buyer', 40]], secured());
    expect(rule(() => apply(sp, { type: 'accept-cancel' }, 'buyer', at(41)))).toBe('wrong-state');
  });

  test('propose only in funding … secured', () => {
    expect(rule(() => apply(taken(), { type: 'propose-cancel' }, 'buyer', at(1)))).toBe('wrong-state');
    expect(rule(() => apply(settling(), { type: 'propose-cancel' }, 'buyer', at(51)))).toBe('wrong-state');
  });
});

describe('release and settling', () => {
  test('release-started by the seller in secured or paid when releasable', () => {
    const t = settling();
    expect(t.state).toBe('settling');
    expect(t.settling).toBe('release');
    expect(t.settleFrom).toBe('paid');
    expect(t.settleBy).toEqual(at(65));
    expect(apply(secured(), { type: 'release-started' }, 'seller', at(31)).settleFrom).toBe('secured');
    expect(rule(() => apply(paid(), { type: 'release-started' }, 'buyer', at(41)))).toBe('wrong-party');
    expect(rule(() => apply(securing(), { type: 'release-started' }, 'seller', at(6)))).toBe('wrong-state');
  });

  test('tick past settleBy returns to settleFrom', () => {
    expect(apply(settling(), { type: 'tick' }, 'system', at(65)).state).toBe('settling');
    const t = apply(settling(), { type: 'tick' }, 'system', at(65, 1));
    expect(t.state).toBe('paid');
    expect(t.settling).toBeNull();
    expect(t.settleFrom).toBeNull();
    expect(t.settleBy).toBeNull();
  });

  test('a chain that clears releasable clears settleBy; the next releasable chain restarts it', () => {
    const late = apply(settling(), chain(FUNDS + 5n, FUNDS, 0), 'system', at(55));
    expect(late.settleBy).toBeNull();
    expect(late.state).toBe('settling');
    const again = apply(late, chain(FUNDS + 5n, FUNDS + 5n, 10), 'system', at(80));
    expect(again.settleBy).toEqual(at(95));
  });

  test('a late-surplus chain during settling holds settleBy at null for 25 min without returning', () => {
    let t = apply(settling(), chain(FUNDS + 5n, FUNDS, 0), 'system', at(51));
    for (let m = 52; m <= 76; m++) {
      t = apply(t, { type: 'tick' }, 'system', at(m));
      t = apply(t, chain(FUNDS + 5n, FUNDS, Math.floor((m - 51) / 3)), 'system', at(m));
    }
    expect(t.state).toBe('settling');
    expect(t.settleBy).toBeNull();
    expect(t.settleFrom).toBe('paid');
  });

  test('settled → released or refunded, closedAt = now', () => {
    const r = apply(settling(), { type: 'settled', kind: 'release', txHash: 'bb'.repeat(32) }, 'system', at(60));
    expect(r.state).toBe('released');
    expect(r.closedAt).toEqual(at(60));
    expect(r.txHash).toBe('bb'.repeat(32));
    const f = refunded();
    expect(f.state).toBe('refunded');
    expect(f.closedAt).toEqual(at(61));
  });

  test('settled is a chain fact: accepted from every open funded state, kind mapped to the end state', () => {
    const hash = 'bb'.repeat(32);
    const rr = sellerCancelled();
    const lapsed = run([[chain(10n, 10n, 10), 'system', 3], [{ type: 'tick' }, 'system', 32]], funding());
    const disputed = apply(paid(), { type: 'open-dispute' }, 'seller', at(160));
    for (const t of [funding(), securing(), secured(), settling(), disputed, paid(), rr, lapsed]) {
      expect(apply(t, { type: 'settled', kind: 'release', txHash: hash }, 'system', at(200)).state).toBe('released');
      for (const kind of ['mutual-cancel', 'buyer-cancel', 'auto-refund', 'lapse-refund'] as const) {
        const r = apply(t, { type: 'settled', kind, txHash: hash }, 'system', at(200));
        expect(r.state).toBe('refunded');
        expect(r.settling).toBe(kind);
        expect(r.closedAt).toEqual(at(200));
      }
    }
    for (const t of [taken(), refunded()]) {
      expect(rule(() => apply(t, { type: 'settled', kind: 'release', txHash: hash }, 'system', at(200)))).toBe('wrong-state');
    }
  });

  test('reproduced: a buyer-cancel from funding times out back to funding, then its refund lands and is recorded', () => {
    const part = apply(funding(), chain(FUNDS / 2n, FUNDS / 2n, 10), 'system', at(5));
    const bc = apply(part, { type: 'buyer-cancel' }, 'buyer', at(10)); // settleBy 25
    expect(bc.settleFrom).toBe('funding');
    const back = apply(bc, { type: 'tick' }, 'system', at(26));
    expect(back.state).toBe('funding');
    const r = apply(back, { type: 'settled', kind: 'buyer-cancel', txHash: 'bb'.repeat(32) }, 'system', at(28));
    expect(r.state).toBe('refunded');
    expect(r.settling).toBe('buyer-cancel');
    expect(r.txHash).toBe('bb'.repeat(32));
    expect(r.closedAt).toEqual(at(28));
    // A cancel itself can't be disputed (owner 2026-10-29, question 4).
    expect(rule(() => apply(r, { type: 'open-dispute' }, 'buyer', at(60)))).toBe('wrong-state');
  });

  test('reproduced: a buyer-cancel from securing times out back to securing, then its refund lands and is recorded', () => {
    const bc = apply(securing(), { type: 'buyer-cancel' }, 'buyer', at(6)); // not releasable: settleBy waits
    expect(bc.settleFrom).toBe('securing');
    const ready = apply(bc, chain(FUNDS, FUNDS, 10), 'system', at(20)); // settleBy 35
    expect(ready.settleBy).toEqual(at(35));
    const back = apply(ready, { type: 'tick' }, 'system', at(36));
    expect(back.state).toBe('securing');
    const r = apply(back, { type: 'settled', kind: 'buyer-cancel', txHash: 'bb'.repeat(32) }, 'system', at(40));
    expect(r.state).toBe('refunded');
    expect(r.txHash).toBe('bb'.repeat(32));
    expect(r.closedAt).toEqual(at(40));
    expect(rule(() => apply(r, { type: 'open-dispute' }, 'buyer', at(41)))).toBe('wrong-state');
  });

  test('reproduced: a release that lands after settleBy returned the trade to paid is still recorded', () => {
    const back = apply(settling(), { type: 'tick' }, 'system', at(66));
    expect(back.state).toBe('paid');
    expect(apply(back, { type: 'settled', kind: 'release', txHash: 'bb'.repeat(32) }, 'system', at(70)).state).toBe('released');
  });

  test('reproduced: a settlement during a dispute is recorded', () => {
    const d = apply(secured(), { type: 'open-dispute' }, 'seller', at(31));
    expect(apply(d, { type: 'settled', kind: 'auto-refund', txHash: 'bb'.repeat(32) }, 'system', at(40)).state).toBe('refunded');
  });

  test('reproduced: a buyer-cancel that timed out back to secured, then its refund lands', () => {
    const bc = apply(secured(), { type: 'buyer-cancel' }, 'buyer', at(40)); // settleBy 55
    expect(bc.settleFrom).toBe('secured');
    const back = apply(bc, { type: 'tick' }, 'system', at(56));
    expect(back.state).toBe('secured');
    const r = apply(back, { type: 'settled', kind: 'buyer-cancel', txHash: 'bb'.repeat(32) }, 'system', at(60));
    expect(r.state).toBe('refunded');
    expect(r.settling).toBe('buyer-cancel');
    expect(r.closedAt).toEqual(at(60));
  });

  test('reproduced: a release that lands while the trade is disputed is recorded', () => {
    const d = apply(paid(), { type: 'open-dispute' }, 'seller', at(160));
    const r = apply(d, { type: 'settled', kind: 'release', txHash: 'bb'.repeat(32) }, 'system', at(170));
    expect(r.state).toBe('released');
    expect(r.closedAt).toEqual(at(170));
  });

  test("reproduced: the buyer taps I have paid a minute after the seller's cancel; refused, and the refund lands", () => {
    const c = sellerCancelled();
    expect(rule(() => apply(c, { type: 'mark-paid', fiatCents: 41250n }, 'buyer', at(122)))).toBe('wrong-state');
    const r = apply(c, { type: 'settled', kind: 'auto-refund', txHash: 'bb'.repeat(32) }, 'system', at(201));
    expect(r.state).toBe('refunded');
    expect(r.settling).toBe('auto-refund');
    expect(r.paidAt).toBeNull();
  });

  test("auto-refund settles from the seller's cancel; lapse-refund from lapsed", () => {
    const rr = sellerCancelled();
    expect(apply(rr, { type: 'settled', kind: 'auto-refund', txHash: 'cc'.repeat(32) }, 'system', at(140)).state).toBe('refunded');
    const lapsed = run([[chain(10n, 10n, 10), 'system', 3], [{ type: 'tick' }, 'system', 32]], funding());
    expect(lapsed.state).toBe('lapsed');
    expect(apply(lapsed, { type: 'settled', kind: 'lapse-refund', txHash: 'cc'.repeat(32) }, 'system', at(40)).state).toBe('refunded');
  });
});

describe('open-dispute', () => {
  test('the seller in securing or secured', () => {
    expect(apply(securing(), { type: 'open-dispute' }, 'seller', at(6)).state).toBe('disputed');
    const d = apply(secured(), { type: 'open-dispute' }, 'seller', at(31));
    expect(d.dispute).toEqual({ by: 'seller', at: at(31) });
  });

  test("never the buyer before I've paid (design proto review P1): too-early in securing and secured, whatever the time", () => {
    // Nothing has happened yet that a moderator could rule on; before paying the buyer can cancel instead (g67).
    expect(rule(() => apply(securing(), { type: 'open-dispute' }, 'buyer', at(6)))).toBe('too-early');
    for (const min of [31, 119, 121, 600]) expect(rule(() => apply(secured(), { type: 'open-dispute' }, 'buyer', at(min)))).toBe('too-early');
  });

  test("the buyer's wait is the method's window from I've paid (owner F9: 90 min for instant types), paused by maintenance", () => {
    const instant = run(
      [
        [{ type: 'setup-done', escrowAddress: '4Escrow' }, 'system', 1],
        [chain(FUNDS, FUNDS, 10), 'system', 30],
        [{ type: 'mark-paid', fiatCents: 41250n }, 'buyer', 40],
      ],
      newTrade({ ...TAKE, poster: 'seller', confirmWindowMin: 90 }, T0),
    );
    expect(instant.confirmBy).toEqual(at(130));
    expect(rule(() => apply(instant, { type: 'open-dispute' }, 'buyer', at(129, 59_999)))).toBe('too-early');
    expect(apply(instant, { type: 'open-dispute' }, 'buyer', at(130)).state).toBe('disputed');
    // 20 min of maintenance during the wait moves it by 20 min.
    const resumed = run([[{ type: 'pause' }, 'system', 60], [{ type: 'resume' }, 'system', 80]], instant);
    expect(resumed.confirmBy).toEqual(at(150));
    expect(rule(() => apply(resumed, { type: 'open-dispute' }, 'buyer', at(140)))).toBe('too-early');
  });

  test("in paid: either side only from confirmBy, the method's wait from I've paid (owner p9-4)", () => {
    for (const by of ['buyer', 'seller'] as const) {
      expect(rule(() => apply(paid(), { type: 'open-dispute' }, by, at(41)))).toBe('too-early');
      expect(rule(() => apply(paid(), { type: 'open-dispute' }, by, at(159, 59_999)))).toBe('too-early');
      expect(apply(paid(), { type: 'open-dispute' }, by, at(160)).state).toBe('disputed');
    }
  });

  test("the seller's wait in paid moves with maintenance, as the buyer's does", () => {
    const resumed = run([[{ type: 'pause' }, 'system', 50], [{ type: 'resume' }, 'system', 70]], paid());
    expect(resumed.confirmBy).toEqual(at(180));
    expect(rule(() => apply(resumed, { type: 'open-dispute' }, 'seller', at(170)))).toBe('too-early');
    expect(apply(resumed, { type: 'open-dispute' }, 'seller', at(180)).state).toBe('disputed');
  });

  test("the seller's cancel (settling auto-refund): the buyer may dispute at once (owner 8 Nov, p9-2), the seller only after settleBy", () => {
    const c = sellerCancelled(); // 121, settleBy 136
    const d = apply(c, { type: 'open-dispute' }, 'buyer', at(121));
    expect(d.state).toBe('disputed');
    expect(d.dispute).toEqual({ by: 'buyer', at: at(121) });
    expect(d.settling).toBe('auto-refund');
    expect(rule(() => apply(c, { type: 'open-dispute' }, 'seller', at(122)))).toBe('too-early');
    expect(apply(c, { type: 'open-dispute' }, 'seller', at(136, 1)).state).toBe('disputed');
    // Once disputed, a refund that already went out is still recorded (the moderator then decides).
    expect(apply(d, { type: 'settled', kind: 'auto-refund', txHash: 'ee'.repeat(32) }, 'system', at(130)).state).toBe('refunded');
    // A release or a buyer's cancel still settling: no early buyer dispute.
    expect(rule(() => apply(settling(), { type: 'open-dispute' }, 'buyer', at(51)))).toBe('too-early');
    const bc = apply(secured(), { type: 'buyer-cancel' }, 'buyer', at(40));
    expect(rule(() => apply(bc, { type: 'open-dispute' }, 'buyer', at(41)))).toBe('too-early');
  });

  test('in settling only after settleBy', () => {
    expect(rule(() => apply(settling(), { type: 'open-dispute' }, 'buyer', at(65)))).toBe('too-early');
    expect(apply(settling(), { type: 'open-dispute' }, 'seller', at(65, 1)).state).toBe('disputed');
    const waiting = apply(settling(), chain(FUNDS + 5n, FUNDS, 0), 'system', at(55));
    expect(rule(() => apply(waiting, { type: 'open-dispute' }, 'buyer', at(500)))).toBe('too-early');
  });

  test('buyer in refunded within 48 hours (owner 2026-10-29; a no-show refund; a cancel itself can\'t be disputed)', () => {
    // The no-show refund: request-refund at 121, the auto-refund lands at 140; the window counts from it.
    const f = run([[{ type: 'request-refund' }, 'seller', 121], [{ type: 'settled', kind: 'auto-refund', txHash: 'dd'.repeat(32) }, 'system', 140]], secured());
    expect(f.state).toBe('refunded');
    expect(rule(() => apply(f, { type: 'open-dispute' }, 'seller', at(141)))).toBe('wrong-party');
    const hours48 = 48 * 60;
    const d = apply(f, { type: 'open-dispute' }, 'buyer', at(140 + hours48));
    expect(d.state).toBe('disputed');
    expect(d.closedAt).toBeNull();
    expect(rule(() => apply(f, { type: 'open-dispute' }, 'buyer', at(140 + hours48, 1)))).toBe('too-late');
    // A buyer's cancel, or one both agreed to: no dispute (owner 2026-10-29, question 4).
    expect(rule(() => apply(refunded(), { type: 'open-dispute' }, 'buyer', at(62)))).toBe('wrong-state');
    const mutual = run(
      [
        [{ type: 'propose-cancel' }, 'buyer', 35],
        [{ type: 'accept-cancel' }, 'seller', 36],
        [{ type: 'settled', kind: 'mutual-cancel', txHash: 'cc'.repeat(32) }, 'system', 40],
      ],
      secured(),
    );
    expect(rule(() => apply(mutual, { type: 'open-dispute' }, 'buyer', at(41)))).toBe('wrong-state');
  });

  test("review I1: a cancel's refund that lands after I've paid keeps the buyer's dispute (the seller-holds-the-refund scam)", () => {
    // Mutual cancel accepted at 36 (settleBy 51); the seller holds the signed refund back, the window
    // lapses to secured, the buyer pays at 55, then the refund is broadcast.
    const back = run(
      [
        [{ type: 'propose-cancel' }, 'seller', 35],
        [{ type: 'accept-cancel' }, 'buyer', 36],
        [{ type: 'tick' }, 'system', 52],
        [{ type: 'mark-paid', fiatCents: 41250n }, 'buyer', 55],
        [{ type: 'settled', kind: 'mutual-cancel', txHash: 'cc'.repeat(32) }, 'system', 60],
      ],
      secured(),
    );
    expect(back.state).toBe('refunded');
    expect(back.paidAt).toEqual(at(55));
    expect(apply(back, { type: 'open-dispute' }, 'buyer', at(61)).state).toBe('disputed');
    // The same with the buyer's own cancel.
    const bc = run(
      [
        [{ type: 'buyer-cancel' }, 'buyer', 40],
        [{ type: 'tick' }, 'system', 56],
        [{ type: 'mark-paid', fiatCents: 41250n }, 'buyer', 57],
        [{ type: 'settled', kind: 'buyer-cancel', txHash: 'cd'.repeat(32) }, 'system', 60],
      ],
      secured(),
    );
    expect(apply(bc, { type: 'open-dispute' }, 'buyer', at(61)).state).toBe('disputed');
    // Not "awaiting the seller's Confirm cancel": the buyer had paid.
    expect(awaitingCancelConfirm(bc)).toBe(false);
    expect(rule(() => apply(bc, { type: 'return-confirmed', confirmations: 10 }, 'system', at(70)))).toBe('wrong-state');
  });

  test('other states → wrong-state; tick in disputed changes nothing', () => {
    expect(rule(() => apply(funding(), { type: 'open-dispute' }, 'buyer', at(2)))).toBe('wrong-state');
    const d = apply(secured(), { type: 'open-dispute' }, 'seller', at(31));
    expect(apply(d, { type: 'tick' }, 'system', at(10_000))).toEqual(d);
  });
});

describe('release-claimed (Task 9 I/O, lead decision b, 2026-10-29)', () => {
  test('a claimed release stays settling past settleBy; the timer loop has no deadline for it', () => {
    const c = apply(settling(), { type: 'release-claimed' }, 'system', at(55));
    expect(c.state).toBe('settling');
    expect(c.releaseClaimedAt).toEqual(at(55));
    expect(c.settleBy).toEqual(at(65)); // unchanged: a party may still open a dispute after it
    expect(apply(c, { type: 'tick' }, 'system', at(66))).toEqual(c);
    expect(apply(c, { type: 'tick' }, 'system', at(66 + 6 * 60))).toEqual(c);
    expect(nextDeadline(c)).toBeNull();
    // a chain that clears and restores releasable does not bring the revert back
    const again = apply(apply(c, chain(FUNDS + 5n, FUNDS, 0), 'system', at(70)), chain(FUNDS + 5n, FUNDS + 5n, 10), 'system', at(90));
    expect(apply(again, { type: 'tick' }, 'system', at(200)).state).toBe('settling');
    // what ends it: the shown sweep, the 6 h fallback's escalate, or a party's dispute after settleBy
    expect(apply(c, { type: 'settled', kind: 'release', txHash: 'bb'.repeat(32) }, 'system', at(100)).state).toBe('released');
    expect(apply(c, { type: 'escalate' }, 'system', at(55 + 360)).state).toBe('disputed');
    expect(apply(c, { type: 'open-dispute' }, 'buyer', at(65, 1)).state).toBe('disputed');
  });

  test('only from settling, once, and only by the system', () => {
    expect(settling().releaseClaimedAt).toBeNull();
    expect(taken().releaseClaimedAt).toBeNull();
    const c = apply(settling(), { type: 'release-claimed' }, 'system', at(55));
    expect(rule(() => apply(c, { type: 'release-claimed' }, 'system', at(56)))).toBe('wrong-state');
    for (const t of [secured(), paid(), refunded(), apply(settling(), { type: 'tick' }, 'system', at(65, 1))]) {
      expect(rule(() => apply(t, { type: 'release-claimed' }, 'system', at(70)))).toBe('wrong-state');
    }
    expect(rule(() => apply(settling(), { type: 'release-claimed' }, 'seller', at(55)))).toBe('wrong-party');
  });

  test('a new settling episode starts unclaimed', () => {
    // a buyer-cancel settling that reverted, then a new one: never carries an old claim. Since Tasks
    // 38-39 a buyer cannot cancel after "I've paid", so the reverted trade is an unpaid `secured` one.
    const old: Trade = { ...settling(), releaseClaimedAt: at(55) };
    const fresh = apply({ ...old, state: 'secured', paidAt: null, confirmBy: null, settling: null, settleFrom: null, settleBy: null }, { type: 'buyer-cancel' }, 'buyer', at(70));
    expect(fresh.state).toBe('settling');
    expect(fresh.releaseClaimedAt).toBeNull();
  });
});

describe('escalate', () => {
  test('from lapsed with funds, or from released, refunded or cancelled', () => {
    const lapsedFunds = run([[chain(10n, 10n, 10), 'system', 3], [{ type: 'tick' }, 'system', 32]], funding());
    const lapsedEmpty = run([[{ type: 'tick' }, 'system', 32]], funding());
    const released = apply(settling(), { type: 'settled', kind: 'release', txHash: 'bb'.repeat(32) }, 'system', at(60));
    const cancelled = apply(apply(taken(), { type: 'buyer-cancel' }, 'buyer', at(1)), chain(5n, 0n, 0), 'system', at(100));
    for (const t of [lapsedFunds, released, refunded(), cancelled]) {
      const d = apply(t, { type: 'escalate' }, 'system', at(3000));
      expect(d.state).toBe('disputed');
      expect(d.dispute).toEqual({ by: 'system', at: at(3000) });
      expect(d.closedAt).toBeNull(); // a reopened trade is open again (no purge while disputed)
    }
    expect(rule(() => apply(lapsedEmpty, { type: 'escalate' }, 'system', at(40)))).toBe('wrong-state');
    expect(rule(() => apply(apply(taken(), { type: 'buyer-cancel' }, 'buyer', at(1)), { type: 'escalate' }, 'system', at(40)))).toBe('wrong-state');
    const swept = apply(released, chain(0n, 0n, 0), 'system', at(61));
    expect(rule(() => apply(swept, { type: 'escalate' }, 'system', at(62)))).toBe('wrong-state');
    expect(rule(() => apply(secured(), { type: 'escalate' }, 'system', at(40)))).toBe('wrong-state');
  });

  test('from settling with funds: a release the moderator was not shown (Task 9 I/O fallback)', () => {
    const t = settling();
    expect(t.receivedAtomic).toBeGreaterThan(0n);
    const d = apply(t, { type: 'escalate' }, 'system', at(500));
    expect(d.state).toBe('disputed');
    expect(d.dispute).toEqual({ by: 'system', at: at(500) });
    expect(d.closedAt).toBeNull();
    // only the system escalates
    expect(rule(() => apply(t, { type: 'escalate' }, 'buyer', at(500)))).toBe('wrong-party');
    // and only with coins in the escrow
    const empty: Trade = { ...t, receivedAtomic: 0n };
    expect(rule(() => apply(empty, { type: 'escalate' }, 'system', at(40)))).toBe('wrong-state');
  });

  test('a closed trade still records late funds', () => {
    const released = apply(settling(), { type: 'settled', kind: 'release', txHash: 'bb'.repeat(32) }, 'system', at(60));
    const t = apply(released, chain(7n, 0n, 0), 'system', at(70));
    expect(t.state).toBe('released');
    expect(t.receivedAtomic).toBe(7n);
  });
});

describe('pause and resume (P3-I19)', () => {
  test('tick while paused changes nothing; resume shifts every future deadline', () => {
    const s = secured(); // payBy at 120
    const p = apply(s, { type: 'pause' }, 'system', at(100));
    expect(p.pausedAt).toEqual(at(100));
    expect(apply(p, { type: 'tick' }, 'system', at(500))).toEqual(p);
    const r = apply(p, { type: 'resume' }, 'system', at(160));
    expect(r.pausedAt).toBeNull();
    expect(r.payBy).toEqual(at(180));
    expect(r.securedAt).toEqual(at(30));
  });

  test('past deadlines do not move', () => {
    const f = funding(); // setupBy 15 (passed by minute 20), fundBy 31
    const r = apply(apply(f, { type: 'pause' }, 'system', at(20)), { type: 'resume' }, 'system', at(30));
    expect(r.setupBy).toEqual(at(15));
    expect(r.fundBy).toEqual(at(41));
  });

  test('a paused setup does not time out', () => {
    const p = apply(taken(), { type: 'pause' }, 'system', at(10));
    expect(apply(p, { type: 'tick' }, 'system', at(20)).state).toBe('setup');
    const r = apply(p, { type: 'resume' }, 'system', at(20));
    expect(r.setupBy).toEqual(at(25));
    expect(apply(r, { type: 'tick' }, 'system', at(24)).state).toBe('setup');
  });

  test("a pause during the seller's cancel moves its signing window and nothing reverts it", () => {
    const c = sellerCancelled(); // settleBy 136
    const r = apply(apply(c, { type: 'pause' }, 'system', at(130)), { type: 'resume' }, 'system', at(150));
    expect(r.settleBy).toEqual(at(156));
    expect(r.state).toBe('settling');
    expect(r.settling).toBe('auto-refund');
  });

  test('lapsedAt moves with the pause while the lapse co-sign window is open, not after (M1)', () => {
    const lapsed = run([[chain(10n, 10n, 10), 'system', 3], [{ type: 'tick' }, 'system', 32]], funding()); // co-sign window 32 → 62
    expect(lapsed.lapsedAt).toEqual(at(32));
    const open = apply(apply(lapsed, { type: 'pause' }, 'system', at(40)), { type: 'resume' }, 'system', at(60));
    expect(open.lapsedAt).toEqual(at(52));
    const edge = apply(apply(lapsed, { type: 'pause' }, 'system', at(62)), { type: 'resume' }, 'system', at(70));
    expect(edge.lapsedAt).toEqual(at(40));
    const closed = apply(apply(lapsed, { type: 'pause' }, 'system', at(62, 1)), { type: 'resume' }, 'system', at(90));
    expect(closed.lapsedAt).toEqual(at(32));
    const none = apply(apply(secured(), { type: 'pause' }, 'system', at(40)), { type: 'resume' }, 'system', at(60));
    expect(none.lapsedAt).toBeNull();
  });

  test('a deadline that already passed when paused does not move; one exactly at the pause does', () => {
    const f = funding(); // fundBy 31
    const r = apply(apply(f, { type: 'pause' }, 'system', at(31)), { type: 'resume' }, 'system', at(41));
    expect(r.fundBy).toEqual(at(41));
  });

  test('a deadline set during the pause counts from the resume, not the pause', () => {
    const p = apply(secured(), { type: 'pause' }, 'system', at(100));
    const marked = apply(p, { type: 'mark-paid', fiatCents: 41250n }, 'buyer', at(110)); // confirm window 120 min
    expect(marked.paidAt).toEqual(at(110));
    const r = apply(marked, { type: 'resume' }, 'system', at(160));
    expect(r.confirmBy).toEqual(at(280));
    const secP = apply(securing(), { type: 'pause' }, 'system', at(10));
    const sec = apply(secP, chain(FUNDS, FUNDS, 10), 'system', at(20)); // secured during the pause
    expect(sec.securedAt).toEqual(at(20));
    expect(apply(sec, { type: 'resume' }, 'system', at(50)).payBy).toEqual(at(140));
  });

  test('while paused, client events other than mark-paid and buyer-cancel are refused', () => {
    const p = apply(secured(), { type: 'pause' }, 'system', at(130)); // payBy 120 passed
    for (const type of CLIENT_EVENTS) {
      if (type === 'mark-paid' || type === 'buyer-cancel' || type === 'fund-started') continue;
      for (const by of ['buyer', 'seller'] as const) {
        const code = rule(() => apply(p, sampleEvent[type], by, at(131)));
        expect(code === 'wrong-state' || code === 'wrong-party').toBe(true);
      }
    }
    expect(rule(() => apply(p, { type: 'request-refund' }, 'seller', at(131)))).toBe('wrong-state');
    expect(rule(() => apply(p, { type: 'extend' }, 'seller', at(131)))).toBe('wrong-state');
    expect(rule(() => apply(p, { type: 'release-started' }, 'seller', at(131)))).toBe('wrong-state');
    expect(rule(() => apply(p, { type: 'open-dispute' }, 'buyer', at(131)))).toBe('wrong-state');
    expect(rule(() => apply(p, { type: 'propose-cancel' }, 'buyer', at(131)))).toBe('wrong-state');
    expect(apply(p, { type: 'mark-paid', fiatCents: 41250n }, 'buyer', at(131)).state).toBe('paid');
    expect(apply(p, { type: 'buyer-cancel' }, 'buyer', at(131)).state).toBe('settling');
  });

  test('during maintenance the buyer may still mark paid after payBy, and no cancel comes in', () => {
    const p = apply(secured(), { type: 'pause' }, 'system', at(130));
    expect(rule(() => apply(p, { type: 'request-refund' }, 'seller', at(200)))).toBe('wrong-state');
    expect(apply(p, { type: 'mark-paid', fiatCents: 41250n }, 'buyer', at(200)).state).toBe('paid');
  });

  test('pause twice or resume while running → wrong-state', () => {
    const p = apply(secured(), { type: 'pause' }, 'system', at(40));
    expect(rule(() => apply(p, { type: 'pause' }, 'system', at(41)))).toBe('wrong-state');
    expect(rule(() => apply(secured(), { type: 'resume' }, 'system', at(41)))).toBe('wrong-state');
  });
});

describe('clock skew (Review Focus 3)', () => {
  test('a mark-paid 1 ms after a lapsed fundBy is refused, even when the rest of the funds then arrive', () => {
    const part = run([[chain(FUNDS / 2n, FUNDS / 2n, 10), 'system', 10]], funding()); // fundBy 31
    // 1 ms before the server's deadline: still funding, and the rest arriving secures it.
    const early = apply(part, { type: 'tick' }, 'system', at(31, -1));
    expect(early.state).toBe('funding');
    const ok = apply(apply(early, chain(FUNDS, FUNDS, 10), 'system', at(31, -1)), { type: 'mark-paid', fiatCents: 41250n }, 'buyer', at(31, -1));
    expect(ok.state).toBe('paid');
    // 1 ms after: lapsed, late funds do not revive it, and I've paid is refused.
    const lapsed = apply(part, { type: 'tick' }, 'system', at(31, 1));
    expect(lapsed.state).toBe('lapsed');
    const late = apply(lapsed, chain(FUNDS, FUNDS, 10), 'system', at(31, 2));
    expect(late.state).toBe('lapsed');
    expect(rule(() => apply(late, { type: 'mark-paid', fiatCents: 41250n }, 'buyer', at(31, 3)))).toBe('wrong-state');
  });

  test('a seller whose phone is 10 min fast cannot request a refund before the server payBy', () => {
    const s = secured(); // payBy 120 on the server clock
    expect(rule(() => apply(s, { type: 'request-refund' }, 'seller', at(120, -1)))).toBe('too-early');
    expect(rule(() => apply(s, { type: 'request-refund' }, 'seller', at(110)))).toBe('too-early');
    expect(apply(s, { type: 'request-refund' }, 'seller', at(120, 1)).state).toBe('settling');
  });

  test('deadlines are computed from the now passed in, never the device clock', () => {
    // The caller's clock is the only clock: a trade taken at T0 has deadlines relative to T0 however far the real clock is.
    const t = apply(taken(), { type: 'setup-done', escrowAddress: '4Escrow' }, 'system', at(-10));
    expect(t.fundBy).toEqual(at(20));
  });

  test('an invalid now is refused', () => {
    expect(() => apply(secured(), { type: 'tick' }, 'system', new Date(Number.NaN))).toThrow(RangeError);
  });
});

describe('purity', () => {
  test('apply never mutates its input', () => {
    const s = secured();
    const copy = structuredClone(s);
    apply(s, { type: 'mark-paid', fiatCents: 41250n }, 'buyer', at(40));
    apply(s, chain(FUNDS + 1n, FUNDS, 0), 'system', at(40));
    expect(s).toEqual(copy);
  });
});

describe('nextDeadline and releasableEta', () => {
  test('nextDeadline follows the state', () => {
    const cases: [Trade, Date | null][] = [
      [taken(), at(15)],
      [funding(), at(31)],
      [securing(), null],
      [secured(), at(120)],
      [paid(), at(160)],
      [settling(), at(65)],
      [sellerCancelled(), null],
      [refunded(), null],
    ];
    for (const [t, d] of cases) expect(nextDeadline(t)).toEqual(d);
    expect(nextDeadline(apply(secured(), { type: 'pause' }, 'system', at(40)))).toBeNull();
  });

  test('releasableEta in minutes from confirmations', () => {
    expect(releasableEta(funding())).toBeNull();
    expect(releasableEta(securing())).toBe(18); // 9 more blocks × 2 min
    expect(releasableEta(run([[chain(FUNDS, 0n, 4), 'system', 10]], securing()), 60)).toBe(6);
    expect(releasableEta(secured())).toBe(0);
    expect(releasableEta(run([[chain(FUNDS, 0n, 10), 'system', 25]], securing()))).toBe(2);
  });
});

describe('states are all reachable', () => {
  test('every TradeState appears in some test path', () => {
    const seen = new Set<TradeState>([
      taken().state,
      funding().state,
      securing().state,
      secured().state,
      paid().state,
      settling().state,
      apply(settling(), { type: 'settled', kind: 'release', txHash: 'bb'.repeat(32) }, 'system', at(60)).state,
      refunded().state,
      run([[{ type: 'tick' }, 'system', 32]], funding()).state,
      apply(taken(), { type: 'buyer-cancel' }, 'buyer', at(1)).state,
      apply(secured(), { type: 'open-dispute' }, 'seller', at(31)).state,
    ]);
    expect(seen.size).toBe(11);
  });
});

describe('extra XMR (spec 11.1, owner 2026-10-20)', () => {
  const fundingFor = (poster: 'seller' | 'buyer') => run([[{ type: 'setup-done', escrowAddress: '4Escrow' }, 'system', 1]], taken(poster));
  const facts = (t: Trade, balanceAtomic: bigint, kind: 'release' | 'buyer-cancel' = 'release') =>
    payoutsFor({ kind, amountAtomic: t.amountAtomic, feeAtomic: t.feeAtomic, poster: t.poster, sellerFundsAtomic: t.sellerFundsAtomic, balanceAtomic, buyerPayout: 'B', sellerRefund: 'S', feeWallet: 'F' });

  test('seller-poster: before I have paid and within the offer max, the trade grows to what was funded', () => {
    const received = 1_313_131_313_131n;
    const t = apply(fundingFor('seller'), chain(received, received, 10), 'system', at(5));
    const grown = amountForFunds(received, 'seller');
    expect(grown).toBeGreaterThan(AMOUNT);
    expect(t.amountAtomic).toBe(grown);
    expect(t.feeAtomic).toBe(feeFor(grown));
    expect(t.sellerFundsAtomic).toBe(grown + feeFor(grown));
    expect(t.fiatCents).toBe((grown * 33000n * 2n + 1_000_000_000_000n) / 2_000_000_000_000n);
    expect(t.lockedRate).toEqual(RATE);
    expect(t.grown).toEqual({ at: at(5), fromAtomic: AMOUNT, fromFiatCents: 41250n });
    expect(t.state).toBe('secured');
    // Any remainder below one more atomic unit of trade is dust for the seller.
    const ps = facts(t, received);
    expect(ps[0]).toEqual({ address: 'B', amountAtomic: grown });
    expect(ps[1]).toEqual({ address: 'F', amountAtomic: feeFor(grown) });
    const dust = received - grown - feeFor(grown);
    expect(ps.slice(2)).toEqual(dust > 0n ? [{ address: 'S', amountAtomic: dust }] : []);
  });

  test('buyer-poster: the trade grows to exactly what was funded', () => {
    const received = 1_300_000_000_000n;
    const t = apply(fundingFor('buyer'), chain(received, received, 10), 'system', at(5));
    expect(t.amountAtomic).toBe(received);
    expect(t.sellerFundsAtomic).toBe(received);
    expect(t.feeAtomic).toBe(13_000_000_000n);
    expect(t.fiatCents).toBe(42900n);
    expect(facts(t, received)).toEqual([
      { address: 'B', amountAtomic: received - 13_000_000_000n },
      { address: 'F', amountAtomic: 13_000_000_000n },
    ]);
  });

  test('a late surplus while secured (unpaid) also grows the trade once it unlocks, and the fiat total the buyer pays follows', () => {
    const t = apply(secured(), chain(FUNDS + 10_100_000_000n, FUNDS + 10_100_000_000n, 10), 'system', at(50));
    expect(t.amountAtomic).toBe(AMOUNT + 10_000_000_000n);
    expect(t.fiatCents).toBe(41580n);
    expect(t.grown?.at).toEqual(at(50));
    expect(t.releasable).toBe(true);
    const again = apply(t, chain(FUNDS + 20_200_000_000n, FUNDS + 20_200_000_000n, 10), 'system', at(55));
    expect(again.amountAtomic).toBe(AMOUNT + 20_000_000_000n);
    expect(again.grown).toEqual({ at: at(55), fromAtomic: AMOUNT, fromFiatCents: 41250n });
  });

  test('extra XMR that is not yet releasable never grows the trade (I-A)', () => {
    const extra = FUNDS + 10_100_000_000n;
    for (const [received, unlocked, conf] of [[extra, 0n, 0], [extra, FUNDS, 9], [extra, extra - 1n, 9]] as const) {
      const t = apply(secured(), chain(received, unlocked, conf), 'system', at(50));
      expect(t.amountAtomic).toBe(AMOUNT);
      expect(t.sellerFundsAtomic).toBe(FUNDS);
      expect(t.fiatCents).toBe(41250n);
      expect(t.grown).toBeNull();
    }
    const early = apply(fundingFor('buyer'), chain(1_300_000_000_000n, 0n, 1), 'system', at(5));
    expect(early.amountAtomic).toBe(AMOUNT);
    expect(early.state).toBe('securing');
  });

  test('reproduced: a dropped extra after growth shrinks the trade back, so it stays releasable (I-A)', () => {
    const extra = FUNDS + 10_100_000_000n;
    const grown = apply(secured(), chain(extra, extra, 10), 'system', at(50));
    expect(grown.amountAtomic).toBe(AMOUNT + 10_000_000_000n);
    // The extra is double-spent away (a reorg): the escrow is back to the original funding.
    const dropped = apply(grown, chain(FUNDS, FUNDS, 10), 'system', at(55));
    expect(dropped.amountAtomic).toBe(AMOUNT);
    expect(dropped.feeAtomic).toBe(feeFor(AMOUNT));
    expect(dropped.sellerFundsAtomic).toBe(FUNDS);
    expect(dropped.fiatCents).toBe(41250n);
    expect(dropped.grown).toBeNull();
    expect(dropped.releasable).toBe(true);
    expect(dropped.state).toBe('secured');
    const marked = apply(dropped, { type: 'mark-paid', fiatCents: 41250n }, 'buyer', at(56));
    const st = apply(marked, { type: 'release-started' }, 'seller', at(57));
    expect(st.state).toBe('settling');
    expect(payoutsFor({ kind: 'release', amountAtomic: st.amountAtomic, feeAtomic: st.feeAtomic, poster: st.poster, sellerFundsAtomic: st.sellerFundsAtomic, balanceAtomic: FUNDS, buyerPayout: 'B', sellerRefund: 'S', feeWallet: 'F' })).toEqual([
      { address: 'B', amountAtomic: AMOUNT },
      { address: 'F', amountAtomic: feeFor(AMOUNT) },
    ]);
  });

  test('a dropped extra shrinks the trade at once, even before the rest is releasable again (I-A)', () => {
    const two = FUNDS + 20_200_000_000n;
    const grown = apply(secured(), chain(two, two, 10), 'system', at(50));
    expect(grown.amountAtomic).toBe(AMOUNT + 20_000_000_000n);
    // One of the two extras vanishes and the reorg leaves the rest below 10 confirmations.
    const one = FUNDS + 10_100_000_000n;
    const partly = apply(grown, chain(one, 0n, 3), 'system', at(55));
    expect(partly.amountAtomic).toBe(AMOUNT + 10_000_000_000n);
    expect(partly.sellerFundsAtomic).toBeLessThanOrEqual(one);
    expect(partly.grown).toEqual({ at: at(55), fromAtomic: AMOUNT, fromFiatCents: 41250n });
    const gone = apply(partly, chain(FUNDS, 0n, 3), 'system', at(56));
    expect(gone.amountAtomic).toBe(AMOUNT);
    expect(gone.grown).toBeNull();
    expect(apply(gone, chain(FUNDS, FUNDS, 10), 'system', at(80)).releasable).toBe(true);
  });

  test('a grown trade keeps its size while a newer extra is still locked, and grows again once it unlocks (I-A)', () => {
    const one = FUNDS + 10_100_000_000n;
    const two = FUNDS + 20_200_000_000n;
    const grown = apply(secured(), chain(one, one, 10), 'system', at(50));
    const waiting = apply(grown, chain(two, one, 0), 'system', at(52));
    expect(waiting).toEqual({ ...grown, receivedAtomic: two, unlockedAtomic: one, confirmations: 0, releasable: false });
    // A reorg that only re-buries the extra keeps the growth: the coins are still there.
    const reburied = apply(grown, chain(one, FUNDS, 2), 'system', at(53));
    expect(reburied.amountAtomic).toBe(AMOUNT + 10_000_000_000n);
    const again = apply(waiting, chain(two, two, 10), 'system', at(70));
    expect(again.amountAtomic).toBe(AMOUNT + 20_000_000_000n);
    expect(again.grown).toEqual({ at: at(70), fromAtomic: AMOUNT, fromFiatCents: 41250n });
  });

  test('a grown trade whose next extra would pass the offer maximum keeps its growth (I-A recompute)', () => {
    const t = newTrade({ ...TAKE, poster: 'buyer', maxFiatCents: 42900n }, T0);
    const f = apply(t, { type: 'setup-done', escrowAddress: '4E' }, 'system', at(1));
    const g = apply(f, chain(1_300_000_000_000n, 1_300_000_000_000n, 10), 'system', at(2));
    expect(g.amountAtomic).toBe(1_300_000_000_000n);
    const over = apply(g, chain(1_400_000_000_000n, 1_400_000_000_000n, 10), 'system', at(3));
    expect(over.amountAtomic).toBe(1_300_000_000_000n);
    expect(over.grown?.at).toEqual(at(2));
  });

  test('above the offer maximum the amount stays and the surplus goes to the seller', () => {
    const received = 2_000_000_000_000n; // 2 XMR = $660 > $500 max
    const t = apply(fundingFor('buyer'), chain(received, received, 10), 'system', at(5));
    expect(t.amountAtomic).toBe(AMOUNT);
    expect(t.fiatCents).toBe(41250n);
    expect(t.grown).toBeNull();
    expect(facts(t, received)).toEqual([
      { address: 'B', amountAtomic: AMOUNT - 12_500_000_000n },
      { address: 'F', amountAtomic: 12_500_000_000n },
      { address: 'S', amountAtomic: received - AMOUNT },
    ]);
  });

  test('exactly at the offer maximum still grows', () => {
    const t = newTrade({ ...TAKE, poster: 'buyer', maxFiatCents: 42900n }, T0);
    const g = apply(apply(t, { type: 'setup-done', escrowAddress: '4E' }, 'system', at(1)), chain(1_300_000_000_000n, 1_300_000_000_000n, 10), 'system', at(2));
    expect(g.amountAtomic).toBe(1_300_000_000_000n);
    const over = apply(apply(t, { type: 'setup-done', escrowAddress: '4E' }, 'system', at(1)), chain(1_300_020_000_000n, 1_300_020_000_000n, 10), 'system', at(2));
    expect(over.amountAtomic).toBe(AMOUNT);
  });

  test('after I have paid the amount never changes; the surplus goes to the seller', () => {
    const t = apply(paid(), chain(FUNDS + 100_000_000n, FUNDS + 100_000_000n, 10), 'system', at(45));
    expect(t.amountAtomic).toBe(AMOUNT);
    expect(t.fiatCents).toBe(41250n);
    expect(t.grown).toBeNull();
    expect(facts(t, FUNDS + 100_000_000n)[2]).toEqual({ address: 'S', amountAtomic: 100_000_000n });
  });

  test('no growth once a refund or settlement has started', () => {
    const rr = sellerCancelled();
    expect(apply(rr, chain(FUNDS + 100_000_000n, FUNDS + 100_000_000n, 10), 'system', at(125)).amountAtomic).toBe(AMOUNT);
    const st = apply(secured(), { type: 'release-started' }, 'seller', at(40));
    expect(apply(st, chain(FUNDS + 100_000_000n, FUNDS + 100_000_000n, 10), 'system', at(45)).amountAtomic).toBe(AMOUNT);
  });

  test('every refund of a grown trade pays everything to the seller', () => {
    const received = 1_300_000_000_000n;
    const t = apply(fundingFor('buyer'), chain(received, received, 10), 'system', at(5));
    expect(facts(t, received, 'buyer-cancel')).toEqual([{ address: 'S', amountAtomic: received }]);
  });
});
