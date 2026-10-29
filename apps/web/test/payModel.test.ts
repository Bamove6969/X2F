import { describe, expect, it } from 'vitest';
import { buyerCancelMode, escrowChip, finishBlock, payBlock, payTimer, sellerCancelMode, timelineSteps, counterpartyLine, showProposal } from '../src/screens/trade/payModel.js';
import type { TradeView } from '../src/screens/trade/payTypes.js';

const T0 = Date.parse('2026-10-25T12:00:00.000Z');
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();

const view = (over: Partial<TradeView> = {}): TradeView =>
  ({
    code: 'K7M2-9QXA-4FTR-8WPN',
    role: 'buyer',
    poster: 'seller',
    state: 'securing',
    counterparty: { displayName: 'satoshi_ghost', completedTrades: 412, online: true, lastSeenAt: null, typicalMinutes: 6, positivePct: 99, badges: [] },
    receivedAtomic: '1250000000000',
    confirmations: 3,
    releasable: false,
    releasableEtaMin: 14,
    extensions: 0,
    cancelProposedBy: null,
    securedAt: null,
    payBy: null,
    paidAt: null,
    serverNow: at(0),
    ...over,
  }) as TradeView;

describe('escrowChip (spec 2.2 step 6, P3-I4)', () => {
  it('amber "Securing escrow" with "3 of 10 · about 14 min" while confirmations come in', () => {
    expect(escrowChip(view())).toEqual({ tone: 'caution', icon: 'shield-clock', label: 'Securing escrow', bar: { confirmations: 3, of: 10, etaMin: 14 } });
  });

  it('amber "Releasable in N min" at 10 confirmations before the coins unlock', () => {
    expect(escrowChip(view({ confirmations: 10, releasableEtaMin: 2 }))).toEqual({
      tone: 'caution',
      icon: 'shield-clock',
      label: 'Releasable in 2 min',
      bar: { confirmations: 10, of: 10, etaMin: 2 },
    });
    expect(escrowChip(view({ confirmations: 12, releasableEtaMin: 2 }))!.bar!.confirmations).toBe(10);
  });

  it('teal "Escrow secured" once secured, and from then on', () => {
    for (const state of ['secured', 'paid', 'refund_requested', 'settling'] as const) {
      expect(escrowChip(view({ state, confirmations: 14, releasable: true, releasableEtaMin: 0 }))).toEqual({
        tone: 'escrow',
        icon: 'shield-check',
        label: 'Escrow secured',
        bar: null,
      });
    }
  });

  it('an unknown ETA works it out from the confirmations (2 min a block)', () => {
    expect(escrowChip(view({ confirmations: 4, releasableEtaMin: null }))!.bar!.etaMin).toBe(12);
  });
});

describe('payTimer (spec 2.2 step 6: the 90 minutes start when the escrow settles)', () => {
  it('not started while securing: 90 min, starting in the ETA', () => {
    expect(payTimer(view(), T0)).toEqual({ started: false, totalMin: 90, startsInMin: 14 });
  });

  it('counts down to payBy once secured, by the server clock, including extensions', () => {
    const v = view({ state: 'secured', securedAt: at(-28), payBy: at(62), releasable: true });
    expect(payTimer(v, T0)).toEqual({ started: true, totalMin: 90, payBy: at(62), leftMin: 62 });
    expect(payTimer({ ...v, extensions: 1, payBy: at(30) }, T0)).toMatchObject({ totalMin: 120, leftMin: 30 });
    expect(payTimer(v, T0 + 70 * 60_000)).toMatchObject({ leftMin: 0 });
  });
});

describe('who may cancel (spec 2.3)', () => {
  it('the buyer: one tap before "I\'ve paid", the warning after', () => {
    expect(buyerCancelMode(view({ state: 'securing' }))).toBe('one-tap');
    expect(buyerCancelMode(view({ state: 'secured' }))).toBe('one-tap');
    expect(buyerCancelMode(view({ state: 'paid', paidAt: at(-1) }))).toBe('warn');
    expect(buyerCancelMode(view({ state: 'settling' }))).toBe('none');
  });

  it('the seller never cancels alone: only propose, or withdraw a standing proposal', () => {
    for (const state of ['funding', 'securing', 'secured', 'paid'] as const) {
      expect(sellerCancelMode(view({ role: 'seller', state }))).toBe('propose');
      expect(sellerCancelMode(view({ role: 'seller', state, cancelProposedBy: 'seller' }))).toBe('proposed');
      expect(sellerCancelMode(view({ role: 'seller', state, cancelProposedBy: 'buyer' }))).toBe('none');
    }
    for (const state of ['setup', 'refund_requested', 'settling', 'released', 'refunded', 'lapsed', 'cancelled', 'disputed'] as const) {
      expect(sellerCancelMode(view({ role: 'seller', state }))).toBe('none');
    }
  });

  it('the buyer sees the seller\'s proposal card only while a mutual cancel can be accepted', () => {
    expect(showProposal(view({ state: 'secured', cancelProposedBy: 'seller' }))).toBe(true);
    expect(showProposal(view({ state: 'secured', cancelProposedBy: null }))).toBe(false);
    expect(showProposal(view({ state: 'settling', cancelProposedBy: 'seller' }))).toBe(false);
    expect(showProposal(view({ role: 'seller', state: 'secured', cancelProposedBy: 'seller' }))).toBe(false);
  });
});

describe('timelineSteps (Desktop board)', () => {
  it('secured: funded done, you pay current, the rest to come', () => {
    expect(timelineSteps(view({ state: 'secured' })).map((s) => [s.key, s.status])).toEqual([
      ['funded', 'done'],
      ['pay', 'current'],
      ['confirm', 'todo'],
      ['released', 'todo'],
    ]);
  });

  it('paid: the seller confirms next; released: every step done', () => {
    expect(timelineSteps(view({ state: 'paid' })).map((s) => s.status)).toEqual(['done', 'done', 'current', 'todo']);
    expect(timelineSteps(view({ state: 'released' })).map((s) => s.status)).toEqual(['done', 'done', 'done', 'done']);
    expect(timelineSteps(view({ state: 'funding' })).map((s) => s.status)).toEqual(['current', 'todo', 'todo', 'todo']);
  });
});

describe('counterpartyLine (Desktop board "412 trades · 99% positive · releases in ~6 min")', () => {
  it('joins what is known and leaves out what is not', () => {
    expect(counterpartyLine(view())).toBe('412 trades · 99% positive · releases in ~6 min');
    expect(counterpartyLine(view({ counterparty: { ...view().counterparty, positivePct: null, typicalMinutes: null } }))).toBe('412 trades');
    expect(counterpartyLine(view({ counterparty: { ...view().counterparty, completedTrades: 1, positivePct: null } }))).toBe('1 trade · releases in ~6 min');
  });

  it('the release time is a seller fact, so a buyer counterparty shows none', () => {
    expect(counterpartyLine(view({ role: 'seller' }))).toBe('412 trades · 99% positive');
  });
});

describe("payBlock: I've paid only on the device's own total (review I1)", () => {
  const e = (over: object = {}) => ({ phase: 'ready' as const, error: null, refusal: null, fiatCents: 41_250n, amountAtomic: 1_250_000_000_000n, ...over });
  const v = (fiatCents: string, amountAtomic = '1250000000000') => ({ fiatCents, amountAtomic });
  it('open when the escrow is ready and the API shows the device total', () => {
    expect(payBlock(v('41250'), e())).toBeNull();
    // amount-out-of-range is the no-amount case (no device total), never a block of its own.
    expect(payBlock(v('41250'), e({ refusal: 'amount-out-of-range' }))).toBeNull();
  });
  it('closed, with the reason, otherwise', () => {
    expect(payBlock(v('41250'), e({ error: 'escrow-failed', phase: 'error' }))).toBe('escrow-stopped');
    expect(payBlock(v('41250'), e({ phase: 'setting-up' }))).toBe('escrow-not-ready');
    expect(payBlock(v('41250'), e({ fiatCents: null }))).toBe('no-amount');
    expect(payBlock(v('43313', '1312500000000'), e())).toBe('amount-differs');
  });
  it('round 2: any other refusal blocks, even with the totals agreeing (I1); the same amount with another total is final (Minor 2)', () => {
    for (const refusal of ['view-mismatch', 'amount-changed', 'attempts-exhausted', 'amount-unknown'] as const) {
      expect(payBlock(v('41250'), e({ refusal }))).toBe('escrow-refused');
    }
    expect(payBlock(v('43313'), e())).toBe('total-wrong');
  });
  it('finishBlock: amount-unknown is what Finish is for; every other refusal blocks it', () => {
    expect(finishBlock(v('41250'), e({ refusal: 'amount-unknown', phase: 'signing' }))).toBeNull();
    expect(finishBlock(v('41250'), e({ refusal: 'view-mismatch' }))).toBe('escrow-refused');
    expect(finishBlock(v('41250'), e({ refusal: 'amount-unknown', error: 'escrow-failed' }))).toBe('escrow-stopped');
    expect(finishBlock(v('43313'), e({ refusal: 'amount-unknown' }))).toBe('total-wrong');
  });
});
