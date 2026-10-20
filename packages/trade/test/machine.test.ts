import { describe, expect, test } from 'vitest';
import {
  CLIENT_EVENTS,
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

function taken(poster: 'seller' | 'buyer' = 'seller'): Trade {
  return newTrade(
    { code: 'ABCD2345EFGH6789', offerId: 'offer-1', poster, sellerId: 'acct-s', buyerId: 'acct-b', methodId: 'revolut', amountAtomic: AMOUNT, lockedRate: RATE, confirmWindowMin: 120 },
    T0,
  );
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
/** Paid at minute 40, confirmBy at minute 160. */
const paid = (): Trade => run([[{ type: 'mark-paid' }, 'buyer', 40]], secured());
/** Release started at minute 50, settleBy at minute 65. */
const settling = (): Trade => run([[{ type: 'release-started' }, 'seller', 50]], paid());
const refunded = (): Trade => run([[{ type: 'settled', kind: 'buyer-cancel', txHash: 'aa'.repeat(32) }, 'system', 61]], run([[{ type: 'buyer-cancel' }, 'buyer', 45]], secured()));

const sampleEvent: Record<TradeEvent['type'], TradeEvent> = {
  'setup-done': { type: 'setup-done', escrowAddress: '4Escrow' },
  chain: chain(1n, 0n, 0),
  'mark-paid': { type: 'mark-paid' },
  extend: { type: 'extend' },
  'request-refund': { type: 'request-refund' },
  'buyer-cancel': { type: 'buyer-cancel' },
  'propose-cancel': { type: 'propose-cancel' },
  'accept-cancel': { type: 'accept-cancel' },
  'withdraw-cancel': { type: 'withdraw-cancel' },
  'release-started': { type: 'release-started' },
  settled: { type: 'settled', kind: 'release', txHash: 'aa'.repeat(32) },
  'open-dispute': { type: 'open-dispute' },
  escalate: { type: 'escalate' },
  pause: { type: 'pause' },
  resume: { type: 'resume' },
  tick: { type: 'tick' },
};

describe('constants', () => {
  test('TIMERS', () => {
    expect(TIMERS).toEqual({ setupMin: 15, fundMin: 30, payMin: 90, extendMin: 30, maxExtensions: 2, finalAlertMin: 15, settleMin: 15, lapseCosignMin: 30, disputeAfterRefundDays: 90 });
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
    expect(apply(funding(), { type: 'tick' }, 'system', at(31, 1)).state).toBe('lapsed');
  });

  test('chain with received ≥ sellerFunds → securing; lockedRate never changes', () => {
    const t = securing();
    expect(t.state).toBe('securing');
    expect(t.fundingSeenAt).toEqual(at(5));
    expect(t.releasable).toBe(false);
    const later = run([
      [chain(FUNDS, FUNDS, 10), 'system', 30],
      [{ type: 'mark-paid' }, 'buyer', 40],
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
    const t = run([[chain(FUNDS + 1000n, FUNDS, 0), 'system', 50]], secured());
    expect(t.state).toBe('secured');
    expect(t.releasable).toBe(false);
    expect(rule(() => apply(t, { type: 'release-started' }, 'seller', at(51)))).toBe('not-releasable');
    const later = apply(t, { type: 'tick' }, 'system', at(5000));
    expect(later.state).toBe('secured');
    expect(apply(later, chain(FUNDS + 1000n, FUNDS + 1000n, 10), 'system', at(5001)).releasable).toBe(true);
  });

  test('malformed chain facts are rejected', () => {
    expect(() => apply(funding(), chain(1n, 2n, 0), 'system', at(2))).toThrow(RangeError);
    expect(() => apply(funding(), chain(-1n, 0n, 0), 'system', at(2))).toThrow(RangeError);
    expect(() => apply(funding(), chain(1n, 0n, -1), 'system', at(2))).toThrow(RangeError);
  });
});

describe('mark-paid', () => {
  for (const make of [securing, secured, () => run([[{ type: 'request-refund' }, 'seller', 121]], secured())]) {
    test(`buyer in ${make().state}`, () => {
      const t = apply(make(), { type: 'mark-paid' }, 'buyer', at(122));
      expect(t.state).toBe('paid');
      expect(t.paidAt).toEqual(at(122));
      expect(t.confirmBy).toEqual(at(242));
      expect(t.finalAlertAt).toBeNull();
    });
  }

  test('seller → wrong-party; other states → wrong-state', () => {
    expect(rule(() => apply(secured(), { type: 'mark-paid' }, 'seller', at(31)))).toBe('wrong-party');
    expect(rule(() => apply(funding(), { type: 'mark-paid' }, 'buyer', at(2)))).toBe('wrong-state');
    expect(rule(() => apply(paid(), { type: 'mark-paid' }, 'buyer', at(41)))).toBe('wrong-state');
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

describe('request-refund', () => {
  test('only strictly after payBy; finalAlertAt > payBy', () => {
    const s = secured();
    expect(rule(() => apply(s, { type: 'request-refund' }, 'seller', at(120)))).toBe('too-early');
    const t = apply(s, { type: 'request-refund' }, 'seller', at(120, 1));
    expect(t.state).toBe('refund_requested');
    expect(t.finalAlertAt).toEqual(at(120, 1));
    expect(t.finalAlertAt!.getTime()).toBeGreaterThan(t.payBy!.getTime());
  });

  test('buyer → wrong-party; paid → wrong-state', () => {
    expect(rule(() => apply(secured(), { type: 'request-refund' }, 'buyer', at(121)))).toBe('wrong-party');
    expect(rule(() => apply(paid(), { type: 'request-refund' }, 'seller', at(121)))).toBe('wrong-state');
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
    ['paid', paid],
    ['refund_requested', () => run([[{ type: 'request-refund' }, 'seller', 121]], secured())],
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

  test('not once settling or closed', () => {
    expect(rule(() => apply(settling(), { type: 'buyer-cancel' }, 'buyer', at(51)))).toBe('wrong-state');
    expect(rule(() => apply(refunded(), { type: 'buyer-cancel' }, 'buyer', at(62)))).toBe('wrong-state');
  });
});

describe('a seller cannot end a funded trade alone', () => {
  test('no client event by the seller moves a funded trade to cancelled, refunded or a refund settlement', () => {
    const starts: Trade[] = [securing(), secured(), paid(), run([[{ type: 'request-refund' }, 'seller', 121]], secured())];
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
          if (next.state === 'settling') expect(next.settling).toBe('release');
        }
      }
    }
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
    const p = apply(paid(), { type: 'propose-cancel' }, 'buyer', at(45));
    expect(rule(() => apply(p, { type: 'withdraw-cancel' }, 'seller', at(46)))).toBe('wrong-party');
    const w = apply(p, { type: 'withdraw-cancel' }, 'buyer', at(46));
    expect(w.cancelProposedBy).toBeNull();
    expect(rule(() => apply(w, { type: 'accept-cancel' }, 'seller', at(47)))).toBe('wrong-state');
    expect(rule(() => apply(w, { type: 'withdraw-cancel' }, 'buyer', at(47)))).toBe('wrong-state');
  });

  test('propose only in funding … paid', () => {
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

  test('settled must match what is settling', () => {
    expect(rule(() => apply(settling(), { type: 'settled', kind: 'mutual-cancel', txHash: 'bb'.repeat(32) }, 'system', at(60)))).toBe('wrong-state');
    expect(rule(() => apply(paid(), { type: 'settled', kind: 'release', txHash: 'bb'.repeat(32) }, 'system', at(60)))).toBe('wrong-state');
  });

  test('auto-refund settles from refund_requested; lapse-refund from lapsed', () => {
    const rr = run([[{ type: 'request-refund' }, 'seller', 121]], secured());
    expect(apply(rr, { type: 'settled', kind: 'auto-refund', txHash: 'cc'.repeat(32) }, 'system', at(140)).state).toBe('refunded');
    const lapsed = run([[chain(10n, 10n, 10), 'system', 3], [{ type: 'tick' }, 'system', 32]], funding());
    expect(lapsed.state).toBe('lapsed');
    expect(apply(lapsed, { type: 'settled', kind: 'lapse-refund', txHash: 'cc'.repeat(32) }, 'system', at(40)).state).toBe('refunded');
  });
});

describe('open-dispute', () => {
  test('either side in securing or secured', () => {
    for (const by of ['buyer', 'seller'] as const) {
      expect(apply(securing(), { type: 'open-dispute' }, by, at(6)).state).toBe('disputed');
      const d = apply(secured(), { type: 'open-dispute' }, by, at(31));
      expect(d.dispute).toEqual({ by, at: at(31) });
    }
  });

  test('in paid: the seller any time, the buyer only from confirmBy', () => {
    expect(apply(paid(), { type: 'open-dispute' }, 'seller', at(41)).state).toBe('disputed');
    expect(rule(() => apply(paid(), { type: 'open-dispute' }, 'buyer', at(159)))).toBe('too-early');
    expect(apply(paid(), { type: 'open-dispute' }, 'buyer', at(160)).state).toBe('disputed');
  });

  test('in settling only after settleBy', () => {
    expect(rule(() => apply(settling(), { type: 'open-dispute' }, 'buyer', at(65)))).toBe('too-early');
    expect(apply(settling(), { type: 'open-dispute' }, 'seller', at(65, 1)).state).toBe('disputed');
    const waiting = apply(settling(), chain(FUNDS + 5n, FUNDS, 0), 'system', at(55));
    expect(rule(() => apply(waiting, { type: 'open-dispute' }, 'buyer', at(500)))).toBe('too-early');
  });

  test('buyer in refunded within 90 days', () => {
    const f = refunded();
    expect(rule(() => apply(f, { type: 'open-dispute' }, 'seller', at(62)))).toBe('wrong-party');
    const day = 24 * 60;
    const d = apply(f, { type: 'open-dispute' }, 'buyer', at(61 + 90 * day));
    expect(d.state).toBe('disputed');
    expect(d.closedAt).toBeNull();
    expect(rule(() => apply(f, { type: 'open-dispute' }, 'buyer', at(61 + 90 * day, 1)))).toBe('too-late');
  });

  test('other states → wrong-state; tick in disputed changes nothing', () => {
    expect(rule(() => apply(funding(), { type: 'open-dispute' }, 'buyer', at(2)))).toBe('wrong-state');
    const d = apply(secured(), { type: 'open-dispute' }, 'buyer', at(31));
    expect(apply(d, { type: 'tick' }, 'system', at(10_000))).toEqual(d);
  });
});

describe('escalate', () => {
  test('from lapsed with funds, or from released, refunded or cancelled', () => {
    const lapsedFunds = run([[chain(10n, 10n, 10), 'system', 3], [{ type: 'tick' }, 'system', 32]], funding());
    const lapsedEmpty = run([[{ type: 'tick' }, 'system', 32]], funding());
    const released = apply(settling(), { type: 'settled', kind: 'release', txHash: 'bb'.repeat(32) }, 'system', at(60));
    const cancelled = apply(taken(), { type: 'buyer-cancel' }, 'buyer', at(1));
    for (const t of [lapsedFunds, released, refunded(), cancelled]) {
      const d = apply(t, { type: 'escalate' }, 'system', at(3000));
      expect(d.state).toBe('disputed');
      expect(d.dispute).toEqual({ by: 'system', at: at(3000) });
      expect(d.closedAt).toBeNull(); // a reopened trade is open again (no purge while disputed)
    }
    expect(rule(() => apply(lapsedEmpty, { type: 'escalate' }, 'system', at(40)))).toBe('wrong-state');
    expect(rule(() => apply(secured(), { type: 'escalate' }, 'system', at(40)))).toBe('wrong-state');
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

  test('the final-alert window shifts with the pause', () => {
    const rr = run([[{ type: 'request-refund' }, 'seller', 121]], secured());
    const r = apply(apply(rr, { type: 'pause' }, 'system', at(130)), { type: 'resume' }, 'system', at(150));
    expect(r.finalAlertAt).toEqual(at(141));
    expect(r.finalAlertAt!.getTime()).toBeGreaterThan(r.payBy!.getTime());
  });

  test('pause twice or resume while running → wrong-state', () => {
    const p = apply(secured(), { type: 'pause' }, 'system', at(40));
    expect(rule(() => apply(p, { type: 'pause' }, 'system', at(41)))).toBe('wrong-state');
    expect(rule(() => apply(secured(), { type: 'resume' }, 'system', at(41)))).toBe('wrong-state');
  });
});

describe('clock skew (Review Focus 3)', () => {
  test('a mark-paid 1 ms after a lapsed fundBy is refused', () => {
    const f = funding();
    expect(rule(() => apply(f, { type: 'mark-paid' }, 'buyer', at(31, 1)))).toBe('wrong-state');
    const lapsed = apply(f, { type: 'tick' }, 'system', at(31, 1));
    expect(rule(() => apply(lapsed, { type: 'mark-paid' }, 'buyer', at(31, 1)))).toBe('wrong-state');
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
    apply(s, { type: 'mark-paid' }, 'buyer', at(40));
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
      [run([[{ type: 'request-refund' }, 'seller', 121]], secured()), at(136)],
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
      run([[{ type: 'request-refund' }, 'seller', 121]], secured()).state,
      settling().state,
      apply(settling(), { type: 'settled', kind: 'release', txHash: 'bb'.repeat(32) }, 'system', at(60)).state,
      refunded().state,
      run([[{ type: 'tick' }, 'system', 32]], funding()).state,
      apply(taken(), { type: 'buyer-cancel' }, 'buyer', at(1)).state,
      apply(secured(), { type: 'open-dispute' }, 'buyer', at(31)).state,
    ]);
    expect(seen.size).toBe(12);
  });
});
