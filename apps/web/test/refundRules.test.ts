// The refund screens' timing and guard rules (Task 25). They are the @x2f/trade state machine's
// own decisions, asked of a trade rebuilt from the API's view; nothing here re-implements a rule.
// The cross-checks run the real machine on a real Trade, serialize it with the API's own
// toTradeView, and require the screen's answer to match the machine's at every minute around
// each deadline.
import { autoRefundDecision } from '@x2f/escrow';
import { TIMERS, TradeRuleError, apply, newTrade, type Trade, type TradeEvent } from '@x2f/trade';
import { describe, expect, it } from 'vitest';
import { toTradeView, type TraderSummary } from '../../api/src/trades/view.js';
import {
  canExtend,
  canMarkPaid,
  canRequestRefund,
  isSellerCancel,
  refusalFor,
  sellerRefundOpen,
} from '../src/screens/trade/refundRules.js';

const MIN = 60_000;
const T0 = new Date('2026-10-25T12:00:00.000Z');
const at = (min: number, ms = 0) => new Date(T0.getTime() + min * MIN + ms);
const AMOUNT = 1_250_000_000_000n;
const FUNDS = 1_262_500_000_000n;

const BUYER = 'acct-b';
const SELLER = 'acct-s';
const PEER: TraderSummary = { tradeTag: 'mira.k', completedTrades: 3, online: true, lastSeenAt: null, typicalMinutes: null, positivePct: null, badges: [], featuredBadges: 0, stage: 'graduated', tradedOverXmr: null, imported: [], disputes: { won: 0, lost: 0 } };

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

/** The seller nudged the buyer at minute 20: a record only (owner 8 Nov, p6-1: nudges are optional). */
const nudged = (t: Trade, min = 20): Trade => ({ ...t, sellerNudgedAt: at(min) });

/** The view one side gets, at server time `now`. */
const viewOf = (t: Trade, who: 'seller' | 'buyer', now: Date) =>
  toTradeView(t, who === 'seller' ? SELLER : BUYER, now, { counterparty: PEER, profile: null, sellerWalletApp: null });

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

  it('owner 8 Nov (p6-1): after the time to pay Cancel is available at once, with or without a nudge', () => {
    const t = secured();
    const before = new Date(t.payBy!.getTime());
    expect(sellerRefundOpen(viewOf(t, 'seller', before), before.getTime())).toBe(false);
    const late = new Date(t.payBy!.getTime() + 1);
    for (const x of [t, nudged(t), nudged(t, 5)]) {
      const v = viewOf(x, 'seller', late);
      expect(sellerRefundOpen(v, late.getTime())).toBe(true);
      expect(canRequestRefund(v, late)).toBe(true);
    }
    expect(viewOf(t, 'seller', late).sellerNudgedAt).toBeNull();
    // The buyer never gets the seller's Cancel.
    expect(canRequestRefund(viewOf(t, 'buyer', late), late)).toBe(false);
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

describe("the time to pay is not a hard end, and the seller's cancel is final (owner 8 Nov, p9-2, p9-4)", () => {
  it("I've paid stays possible after payBy until the seller cancels, as apply() says; never after the cancel", () => {
    const t = secured();
    const payBy = t.payBy!.getTime();
    const e: TradeEvent = { type: 'mark-paid', fiatCents: t.fiatCents };
    for (const ms of [-MIN, 0, 1, 30 * MIN, 600 * MIN]) {
      const now = new Date(payBy + ms);
      const v = viewOf(t, 'buyer', now);
      expect(refusalFor(v, e, 'buyer', now)).toBe(machine(t, e, 'buyer', now));
      expect(canMarkPaid(v, now)).toBe(true);
    }
    const asked = new Date(payBy + 5 * MIN);
    const c = apply(t, { type: 'request-refund' }, 'seller', asked);
    for (const ms of [0, 1, MIN, 600 * MIN]) {
      const now = new Date(asked.getTime() + ms);
      const v = viewOf(c, 'buyer', now);
      expect(refusalFor(v, e, 'buyer', now)).toBe('wrong-state');
      expect(canMarkPaid(v, now)).toBe(false);
    }
    // Once I've paid is in, the seller's Cancel is gone (and the refund screen with it).
    const p = apply(t, e, 'buyer', asked);
    expect(canRequestRefund(viewOf(p, 'seller', asked), asked)).toBe(false);
    expect(sellerRefundOpen(viewOf(p, 'seller', asked), asked.getTime())).toBe(false);
  });

  it("isSellerCancel: the seller's cancel settling or refunded, never another settlement", () => {
    const t = secured();
    const asked = new Date(t.payBy!.getTime() + 1);
    const c = apply(t, { type: 'request-refund' }, 'seller', asked);
    for (const who of ['seller', 'buyer'] as const) expect(isSellerCancel(viewOf(c, who, asked))).toBe(true);
    const r = apply(c, { type: 'settled', kind: 'auto-refund', txHash: 'ab'.repeat(32) }, 'system', asked);
    expect(isSellerCancel(viewOf(r, 'seller', asked))).toBe(true);
    const bc = apply(t, { type: 'buyer-cancel' }, 'buyer', asked);
    expect(isSellerCancel(viewOf(bc, 'seller', asked))).toBe(false);
    expect(isSellerCancel(viewOf(t, 'seller', asked))).toBe(false);
  });
});

describe('no refund before the time to pay is over (autoRefundDecision, spec 3.3)', () => {
  it('the screen asks for the refund only after payBy, and the guard agrees from that instant', () => {
    const t = secured();
    const payBy = t.payBy!;
    // The earliest moment the screen lets the seller ask is just after payBy (server clock).
    const asked = new Date(payBy.getTime() + 1);
    expect(canRequestRefund(viewOf(t, 'seller', asked), asked)).toBe(true);
    expect(canRequestRefund(viewOf(t, 'seller', payBy), payBy)).toBe(false);
    const r = apply(t, { type: 'request-refund' }, 'seller', asked);
    expect(r.state).toBe('settling');
    const proposed = [{ address: '4seller', amountAtomic: FUNDS }];
    const facts = (now: Date) => ({ paymentDeadline: r.payBy!, markedPaidAt: r.paidAt, now, recordedRefundAddress: '4seller', proposed });
    expect(autoRefundDecision(facts(payBy))).toEqual({ ok: false, reason: 'window-open' });
    expect(autoRefundDecision(facts(asked))).toEqual({ ok: true });
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

  it('a view without releaseClaimedAt (an older API) still answers: the claim is never read here', () => {
    const t = secured();
    const full = viewOf(t, 'seller', at(200));
    const v: Partial<typeof full> = { ...full };
    delete v.releaseClaimedAt;
    const old = v as typeof full;
    expect(() => refusalFor(old, { type: 'extend' }, 'seller', at(200))).not.toThrow();
    expect(sellerRefundOpen(old, at(200).getTime())).toBe(sellerRefundOpen(full, at(200).getTime()));
    expect(canExtend(old, at(200))).toBe(canExtend(full, at(200)));
    expect(canRequestRefund(old, at(200))).toBe(canRequestRefund(full, at(200)));
    expect(canRequestRefund(old, at(200))).toBe(true);
  });
});
