// The refund screens' timing and guard rules (Task 25). They are the @x2f/trade state machine's
// own decisions, asked of a trade rebuilt from the API's view; nothing here re-implements a rule.
// The cross-checks run the real machine on a real Trade, serialize it with the API's own
// toTradeView, and require the screen's answer to match the machine's at every minute around
// each deadline.
import { autoRefundDecision } from '@x2f/escrow';
import { TIMERS, TradeRuleError, apply, newTrade, nextDeadline, type Trade, type TradeEvent } from '@x2f/trade';
import { describe, expect, it } from 'vitest';
import { toTradeView, type TraderSummary } from '../../api/src/trades/view.js';
import {
  canExtend,
  canMarkPaid,
  canRequestRefund,
  finalAlertEnds,
  refundNeedsNudge,
  refusalFor,
  sellerRefundOpen,
  showFinalAlert,
} from '../src/screens/trade/refundRules.js';

const MIN = 60_000;
const T0 = new Date('2026-10-25T12:00:00.000Z');
const at = (min: number, ms = 0) => new Date(T0.getTime() + min * MIN + ms);
const AMOUNT = 1_250_000_000_000n;
const FUNDS = 1_262_500_000_000n;

const BUYER = 'acct-b';
const SELLER = 'acct-s';
const PEER: TraderSummary = { displayName: 'mira.k', completedTrades: 3, online: true, lastSeenAt: null, typicalMinutes: null, positivePct: null, badges: [], stage: 'graduated', tradedOverXmr: null, imported: [] };

function secured(): Trade {
  let t = newTrade(
    {
      code: 'K7M29QXA4FTR8WPN',
      offerId: 'of-1',
      poster: 'seller',
      sellerId: SELLER,
      buyerId: BUYER,
      methodId: 'ZELLE',
      amountAtomic: AMOUNT,
      lockedRate: { currency: 'USD', centsPerXmr: 33000n },
      confirmWindowMin: 120,
      minFiatCents: 10_000n,
      maxFiatCents: 50_000n,
    },
    T0,
  );
  t = apply(t, { type: 'setup-done', escrowAddress: '4escrow' }, 'system', at(1));
  t = apply(t, { type: 'chain', receivedAtomic: FUNDS, unlockedAtomic: FUNDS, confirmations: 10 }, 'system', at(10));
  expect(t.state).toBe('secured');
  return t;
}

/** Owner G2: the seller nudged the buyer at minute 20 (after securing at 10), so the refund can unlock. */
const nudged = (t: Trade, min = 20): Trade => ({ ...t, sellerNudgedAt: at(min) });

/** The view one side gets, at server time `now`. */
const viewOf = (t: Trade, who: 'seller' | 'buyer', now: Date) =>
  toTradeView(t, who === 'seller' ? SELLER : BUYER, now, { counterparty: PEER, profile: null, sellerWalletApp: null, finalAlertSeenAt: null });

/** The machine's own answer: null when it accepts the event, else its rule code. */
function machine(t: Trade, e: TradeEvent, by: 'seller' | 'buyer', now: Date): string | null {
  try {
    apply(t, e, by, now);
    return null;
  } catch (err) {
    if (err instanceof TradeRuleError) return err.code;
    throw err;
  }
}

describe('the seller no-show screen follows the state machine', () => {
  it('opens only once payBy has passed by the server clock, never before', () => {
    const t = nudged(secured());
    const payBy = t.payBy!;
    expect(payBy.getTime()).toBe(at(10).getTime() + TIMERS.payMin * MIN);
    for (const ms of [-60_000, -1, 0]) {
      const now = new Date(payBy.getTime() + ms);
      expect(sellerRefundOpen(viewOf(t, 'seller', now), now.getTime())).toBe(false);
      expect(canRequestRefund(viewOf(t, 'seller', now), now)).toBe(false);
    }
    const after = new Date(payBy.getTime() + 1);
    expect(sellerRefundOpen(viewOf(t, 'seller', after), after.getTime())).toBe(true);
    expect(canRequestRefund(viewOf(t, 'seller', after), after)).toBe(true);
  });

  it('agrees with apply() for request-refund and extend at every minute around payBy, nudged or not', () => {
    for (const t of [secured(), nudged(secured())]) {
      const payBy = t.payBy!.getTime();
      for (let m = -3; m <= 3; m += 1) {
        for (const ms of [-1, 0, 1]) {
          const now = new Date(payBy + m * MIN + ms);
          const v = viewOf(t, 'seller', now);
          expect(refusalFor(v, { type: 'request-refund' }, 'seller', now)).toBe(machine(t, { type: 'request-refund' }, 'seller', now));
          expect(refusalFor(v, { type: 'extend' }, 'seller', now)).toBe(machine(t, { type: 'extend' }, 'seller', now));
        }
      }
    }
  });

  it('owner G2: after the 90 minutes and before any nudge the screen opens with Cancel locked; the nudge unlocks it', () => {
    const t = secured();
    const before = new Date(t.payBy!.getTime());
    expect(sellerRefundOpen(viewOf(t, 'seller', before), before.getTime())).toBe(false);
    expect(refundNeedsNudge(viewOf(t, 'seller', before), before)).toBe(false);
    const late = new Date(t.payBy!.getTime() + 1);
    const v = viewOf(t, 'seller', late);
    expect(v.sellerNudgedAt).toBeNull();
    expect(sellerRefundOpen(v, late.getTime())).toBe(true);
    expect(canRequestRefund(v, late)).toBe(false);
    expect(refundNeedsNudge(v, late)).toBe(true);
    // Once nudged (the view carries sellerNudgedAt): unlocked, no longer waiting for a nudge.
    const n = viewOf(nudged(t), 'seller', late);
    expect(canRequestRefund(n, late)).toBe(true);
    expect(refundNeedsNudge(n, late)).toBe(false);
    expect(sellerRefundOpen(n, late.getTime())).toBe(true);
    // A nudge before the escrow was secured does not count (the machine's rule).
    const early = viewOf(nudged(t, 5), 'seller', late);
    expect(canRequestRefund(early, late)).toBe(false);
    expect(refundNeedsNudge(early, late)).toBe(true);
    // The buyer never gets the lock either.
    expect(refundNeedsNudge(viewOf(t, 'buyer', late), late)).toBe(false);
  });

  it('the buyer never gets the seller screen, and a paid trade never opens it', () => {
    const t = secured();
    const late = new Date(t.payBy!.getTime() + MIN);
    expect(sellerRefundOpen(viewOf(t, 'buyer', late), late.getTime())).toBe(false);
    const paid = apply(t, { type: 'mark-paid', fiatCents: t.fiatCents }, 'buyer', at(30));
    expect(sellerRefundOpen(viewOf(paid, 'seller', late), late.getTime())).toBe(false);
  });

  it('during maintenance the screen stays closed (the machine refuses wrong-state)', () => {
    const t = secured();
    const late = new Date(t.payBy!.getTime() + MIN);
    const paused = apply(t, { type: 'pause' }, 'system', late);
    expect(refusalFor(viewOf(paused, 'seller', late), { type: 'request-refund' }, 'seller', late)).toBe('wrong-state');
    expect(sellerRefundOpen(viewOf(paused, 'seller', late), late.getTime())).toBe(false);
  });
});

describe('Give 30 more min: at most twice, each only once the window has ended', () => {
  it('extends twice, then never again', () => {
    let t = nudged(secured());
    for (let n = 0; n < TIMERS.maxExtensions; n += 1) {
      const end = new Date(t.payBy!.getTime() + 1);
      expect(canExtend(viewOf(t, 'seller', end), end)).toBe(true);
      t = apply(t, { type: 'extend' }, 'seller', end);
      expect(t.extensions).toBe(n + 1);
      // Right after an extension the window is open again: no refund screen, no extend.
      expect(sellerRefundOpen(viewOf(t, 'seller', end), end.getTime())).toBe(false);
      expect(canExtend(viewOf(t, 'seller', end), end)).toBe(false);
    }
    const end = new Date(t.payBy!.getTime() + 1);
    const v = viewOf(t, 'seller', end);
    expect(refusalFor(v, { type: 'extend' }, 'seller', end)).toBe('no-extensions-left');
    expect(canExtend(v, end)).toBe(false);
    // The refund stays possible after the last extension ends.
    expect(sellerRefundOpen(v, end.getTime())).toBe(true);
  });
});

describe('the buyer final alert follows the state machine', () => {
  it('shows only to the buyer in refund_requested, counting to finalAlertAt + 15 min', () => {
    const t = nudged(secured());
    const asked = new Date(t.payBy!.getTime() + 5 * MIN);
    const r = apply(t, { type: 'request-refund' }, 'seller', asked);
    expect(showFinalAlert(viewOf(r, 'buyer', asked))).toBe(true);
    expect(showFinalAlert(viewOf(r, 'seller', asked))).toBe(false);
    expect(showFinalAlert(viewOf(t, 'buyer', asked))).toBe(false);
    expect(finalAlertEnds(viewOf(r, 'buyer', asked))?.getTime()).toBe(nextDeadline(r)!.getTime());
    expect(finalAlertEnds(viewOf(r, 'buyer', asked))?.getTime()).toBe(asked.getTime() + TIMERS.finalAlertMin * MIN);
  });

  it("I've paid stays possible until the alert ends, as apply() says, then never", () => {
    const t = nudged(secured());
    const asked = new Date(t.payBy!.getTime() + 5 * MIN);
    const r = apply(t, { type: 'request-refund' }, 'seller', asked);
    const end = asked.getTime() + TIMERS.finalAlertMin * MIN;
    for (const ms of [-MIN, -1, 0, 1, MIN]) {
      const now = new Date(end + ms);
      const v = viewOf(r, 'buyer', now);
      const e: TradeEvent = { type: 'mark-paid', fiatCents: r.fiatCents };
      expect(refusalFor(v, e, 'buyer', now)).toBe(machine(r, e, 'buyer', now));
      expect(canMarkPaid(v, now)).toBe(machine(r, e, 'buyer', now) === null);
    }
    expect(canMarkPaid(viewOf(r, 'buyer', new Date(end - 1)), new Date(end - 1))).toBe(true);
    expect(canMarkPaid(viewOf(r, 'buyer', new Date(end)), new Date(end))).toBe(false);
  });
});

describe('no refund before the final alert (autoRefundDecision, spec 3.3)', () => {
  it('the screen asks for the refund only after payBy, so the alert starts after the window and the guard waits 15 min', () => {
    const t = nudged(secured());
    const payBy = t.payBy!;
    // The earliest moment the screen lets the seller ask is just after payBy (server clock).
    const asked = new Date(payBy.getTime() + 1);
    expect(canRequestRefund(viewOf(t, 'seller', asked), asked)).toBe(true);
    const r = apply(t, { type: 'request-refund' }, 'seller', asked);
    expect(r.finalAlertAt!.getTime()).toBeGreaterThan(payBy.getTime());
    const proposed = [{ address: '4seller', amountAtomic: FUNDS }];
    const facts = (now: Date) => ({ paymentDeadline: r.payBy!, markedPaidAt: r.paidAt, finalAlertAt: r.finalAlertAt, now, recordedRefundAddress: '4seller', proposed });
    const end = r.finalAlertAt!.getTime() + TIMERS.finalAlertMin * MIN;
    expect(autoRefundDecision(facts(new Date(end - 1)))).toEqual({ ok: false, reason: 'final-alert-pending' });
    expect(autoRefundDecision(facts(new Date(end)))).toEqual({ ok: true });
    // The buyer's I've paid in the alert is refused at the same instant the guard opens.
    expect(machine(r, { type: 'mark-paid', fiatCents: r.fiatCents }, 'buyer', new Date(end))).toBe('too-late');
  });

  it('before payBy the screen never asks, whatever the device clock says', () => {
    const t = secured();
    const early = new Date(t.payBy!.getTime() - 10 * MIN);
    // The device runs 10 min fast; the screen reads the server clock, which still says "early".
    expect(canRequestRefund(viewOf(t, 'seller', early), early)).toBe(false);
  });
});

describe('the rebuilt trade carries the view faithfully', () => {
  it('refuses a view it cannot read rather than guessing', () => {
    const t = secured();
    const v = viewOf(t, 'seller', at(200));
    expect(() => refusalFor({ ...v, payBy: 'not a date' }, { type: 'extend' }, 'seller', at(200))).toThrow(RangeError);
    expect(() => refusalFor({ ...v, fiatCents: '12.5' }, { type: 'extend' }, 'seller', at(200))).toThrow(RangeError);
  });

  it('an unreadable view keeps every action closed', () => {
    const t = secured();
    const v = { ...viewOf(t, 'seller', at(200)), payBy: 'garbage' };
    expect(sellerRefundOpen(v, at(200).getTime())).toBe(false);
    expect(canExtend(v, at(200))).toBe(false);
    expect(canRequestRefund(v, at(200))).toBe(false);
  });
});
