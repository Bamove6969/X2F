// Plan 4 Task 25 (J-06): which liens and owed fees a dispute's change brings (owner D-006, D-008,
// D-009, D-062, D-063; g63 for who pays the 1%).
import { describe, expect, it } from 'vitest';
import {
  applyDispute,
  lienSteps,
  newDispute,
  type Actor,
  type Dispute,
  type LienFacts,
  type LienRef,
  type RulingOutcome,
} from '../src/index.js';

const H = 3_600_000;
const T0 = new Date('2027-02-01T10:00:00.000Z');
const at = (h: number) => new Date(T0.getTime() + h * H);
const S = { appealWindowH: 48, firstResponseH: 4 };
const mod: Actor = { kind: 'staff', id: 'mod-1', role: 'mod' };
const senior: Actor = { kind: 'staff', id: 'senior-1', role: 'senior' };
const system: Actor = { kind: 'system' };

const A = 1_250_000_000_000n;
const F = 12_500_000_000n;
const sellerPosted: LienFacts = { poster: 'seller', amountAtomic: A, feeAtomic: F };
const buyerPosted: LienFacts = { poster: 'buyer', amountAtomic: A, feeAtomic: F };

function opened(afterRefund: boolean): Dispute {
  return newDispute({ code: 'K7M2-9QXA-4FTR-8WPN', openedBy: 'buyer', afterRefund, usdCents: 41_250n, limitUsdCents: 100_000n, firstResponseH: 4, now: T0 });
}

/** Round 1 assigned and proposed by a moderator (below the limit, no action: published at once). */
function publish(d: Dispute, outcome: RulingOutcome): Dispute {
  const a = applyDispute(d, { type: 'assign', staffId: 'mod-1', role: 'mod' }, mod, at(1), S);
  return applyDispute(a, { type: 'propose', ruling: { id: 'r1', outcome, accountAction: { kind: 'none' }, proposer: 'mod-1' } }, mod, at(2), S);
}

function appeal(d: Dispute, side: 'buyer' | 'seller'): Dispute {
  return applyDispute(d, { type: 'appeal', involved: ['mod-1'] }, { kind: 'trader', side }, at(3), S);
}

/** Round 2 decided by an uninvolved senior. */
function decide(d: Dispute, outcome: RulingOutcome): Dispute {
  const a = applyDispute(d, { type: 'assign', staffId: 'senior-1', role: 'senior' }, senior, at(4), S);
  return applyDispute(a, { type: 'propose', ruling: { id: 'r2', outcome, accountAction: { kind: 'none' }, proposer: 'senior-1' } }, senior, at(5), S);
}

const lien = (o: Partial<LienRef> = {}): LienRef => ({
  id: 'l1',
  round: 1,
  debtor: 'seller',
  cause: 'restitution',
  status: 'active',
  amountAtomic: A,
  feeAtomic: 0n,
  ...o,
});

describe('a round-1 ruling: money moves at once, restitution is liened at once (D-008, D-009)', () => {
  it('an escrow ruling pays in full from the escrow: no lien, whichever way', () => {
    for (const o of ['release-to-buyer', 'refund-to-seller'] as const) {
      const d = opened(false);
      expect(lienSteps(d, publish(d, o), sellerPosted, []), o).toEqual([]);
    }
  });

  it('seller-sends-xmr after a refund: an immediate restitution lien on the seller for the trade XMR', () => {
    const d = opened(true);
    const next = publish(d, 'seller-sends-xmr');
    expect(next.status).toBe('published');
    expect(lienSteps(d, next, buyerPosted, [])).toEqual([
      { op: 'place', round: 1, debtor: 'seller', cause: 'restitution', amountAtomic: A, feeAtomic: 0n },
    ]);
  });

  it('D-063: the lien carries the unpaid 1% only when the seller posted the ad (they owed it)', () => {
    const d = opened(true);
    expect(lienSteps(d, publish(d, 'seller-sends-xmr'), sellerPosted, [])).toEqual([
      { op: 'place', round: 1, debtor: 'seller', cause: 'restitution', amountAtomic: A, feeAtomic: F },
    ]);
  });

  it('no-action after a refund: nothing owed', () => {
    const d = opened(true);
    expect(lienSteps(d, publish(d, 'no-action'), sellerPosted, [])).toEqual([]);
  });

  it('a change that is not a publish brings nothing (assignment, a proposal awaiting approval)', () => {
    const d = opened(true);
    const a = applyDispute(d, { type: 'assign', staffId: 'mod-1', role: 'mod' }, mod, at(1), S);
    expect(lienSteps(d, a, sellerPosted, [])).toEqual([]);
    const waiting = applyDispute(a, { type: 'propose', ruling: { id: 'r1', outcome: 'seller-sends-xmr', accountAction: { kind: 'freeze' }, proposer: 'mod-1' } }, mod, at(2), S);
    expect(waiting.status).toBe('awaiting-approval');
    expect(lienSteps(a, waiting, sellerPosted, [])).toEqual([]);
  });
});

describe('an appeal lifts the lien while it is pending (D-008)', () => {
  it("the debtor's appeal suspends their round-1 lien", () => {
    const p = publish(opened(true), 'seller-sends-xmr');
    expect(lienSteps(p, appeal(p, 'seller'), sellerPosted, [lien()])).toEqual([{ op: 'suspend', id: 'l1' }]);
  });

  it("the other side's appeal (e.g. the person owed says too little was paid) leaves the lien in force", () => {
    const p = publish(opened(true), 'seller-sends-xmr');
    expect(lienSteps(p, appeal(p, 'buyer'), sellerPosted, [lien()])).toEqual([]);
  });

  it('a lien already repaid or void is left alone', () => {
    const p = publish(opened(true), 'seller-sends-xmr');
    expect(lienSteps(p, appeal(p, 'seller'), sellerPosted, [lien({ status: 'repaid' })])).toEqual([]);
  });
});

describe('the appeal decides (D-006, D-008)', () => {
  it('"Decision stands": the suspended lien is active again; a buyer poster now owes the 1% (final, g63)', () => {
    const p = appeal(publish(opened(true), 'seller-sends-xmr'), 'seller');
    expect(lienSteps(p, decide(p, 'seller-sends-xmr'), buyerPosted, [lien({ status: 'suspended' })])).toEqual([
      { op: 'reactivate', id: 'l1' },
      { op: 'fee-owed', side: 'buyer', amountAtomic: F },
    ]);
    // A seller poster's 1% is already in their lien.
    expect(lienSteps(p, decide(p, 'seller-sends-xmr'), sellerPosted, [lien({ status: 'suspended', feeAtomic: F })])).toEqual([{ op: 'reactivate', id: 'l1' }]);
  });

  it('"Decision stands" on a lien that stayed active (the creditor appealed): the lien is unchanged', () => {
    const p = appeal(publish(opened(true), 'seller-sends-xmr'), 'buyer');
    expect(lienSteps(p, decide(p, 'seller-sends-xmr'), sellerPosted, [lien({ feeAtomic: F })])).toEqual([]);
  });

  it('"Decision stands" on no-action after a refund: nothing', () => {
    const p = appeal(publish(opened(true), 'no-action'), 'buyer');
    expect(lienSteps(p, decide(p, 'no-action'), buyerPosted, [])).toEqual([]);
  });

  it('"Decision overruled" after a refund: the restitution lien is void', () => {
    const p = appeal(publish(opened(true), 'seller-sends-xmr'), 'seller');
    expect(lienSteps(p, decide(p, 'no-action'), buyerPosted, [lien({ status: 'suspended' })])).toEqual([{ op: 'void', id: 'l1' }]);
  });

  it('an appeal that orders restitution after a refund: a new restitution lien, the fee owed by a buyer poster from future trades (D-062)', () => {
    const p = appeal(publish(opened(true), 'no-action'), 'buyer');
    expect(lienSteps(p, decide(p, 'seller-sends-xmr'), buyerPosted, [])).toEqual([
      { op: 'place', round: 2, debtor: 'seller', cause: 'restitution', amountAtomic: A, feeAtomic: 0n },
      { op: 'fee-owed', side: 'buyer', amountAtomic: F },
    ]);
    expect(lienSteps(p, decide(p, 'seller-sends-xmr'), sellerPosted, [])).toEqual([
      { op: 'place', round: 2, debtor: 'seller', cause: 'restitution', amountAtomic: A, feeAtomic: F },
    ]);
  });

  it('an escrow ruling that stands: nothing', () => {
    const p = appeal(publish(opened(false), 'release-to-buyer'), 'seller');
    expect(lienSteps(p, decide(p, 'release-to-buyer'), sellerPosted, [])).toEqual([]);
  });

  it('released at round 1, refunded on appeal: the buyer got the coins and is liened for the trade XMR; the fee was paid', () => {
    const p = appeal(publish(opened(false), 'release-to-buyer'), 'seller');
    for (const facts of [sellerPosted, buyerPosted]) {
      expect(lienSteps(p, decide(p, 'refund-to-seller'), facts, []), facts.poster).toEqual([
        { op: 'place', round: 2, debtor: 'buyer', cause: 'overturned', amountAtomic: A, feeAtomic: 0n },
      ]);
    }
  });

  it('refunded at round 1, released on appeal: the seller got the coins; the unpaid 1% goes with whoever posted (D-063, D-062)', () => {
    const p = appeal(publish(opened(false), 'refund-to-seller'), 'buyer');
    expect(lienSteps(p, decide(p, 'release-to-buyer'), sellerPosted, [])).toEqual([
      { op: 'place', round: 2, debtor: 'seller', cause: 'overturned', amountAtomic: A, feeAtomic: F },
    ]);
    expect(lienSteps(p, decide(p, 'release-to-buyer'), buyerPosted, [])).toEqual([
      { op: 'place', round: 2, debtor: 'seller', cause: 'overturned', amountAtomic: A, feeAtomic: 0n },
      { op: 'fee-owed', side: 'buyer', amountAtomic: F },
    ]);
  });

  it('a round-2 proposal awaiting a second approval decides nothing yet', () => {
    const p = appeal(publish(opened(false), 'release-to-buyer'), 'seller');
    const a = applyDispute(p, { type: 'assign', staffId: 'senior-1', role: 'senior' }, senior, at(4), S);
    const waiting = applyDispute(a, { type: 'propose', ruling: { id: 'r2', outcome: 'refund-to-seller', accountAction: { kind: 'freeze' }, proposer: 'senior-1' } }, senior, at(5), S);
    expect(waiting.status).toBe('awaiting-approval');
    expect(lienSteps(a, waiting, sellerPosted, [])).toEqual([]);
  });
});

describe('no appeal: the window closes (D-062)', () => {
  it('seller-sends-xmr on a buyer poster: the buyer owes the 1% once the ruling is final', () => {
    const p = publish(opened(true), 'seller-sends-xmr');
    const closed = applyDispute(p, { type: 'window-closed' }, system, at(60), S);
    expect(lienSteps(p, closed, buyerPosted, [lien()])).toEqual([{ op: 'fee-owed', side: 'buyer', amountAtomic: F }]);
  });

  it('a seller poster: the fee is already in their lien, nothing more', () => {
    const p = publish(opened(true), 'seller-sends-xmr');
    const closed = applyDispute(p, { type: 'window-closed' }, system, at(60), S);
    expect(lienSteps(p, closed, sellerPosted, [lien({ feeAtomic: F })])).toEqual([]);
  });

  it('an escrow ruling or no-action: nothing owed (the escrow carried the fee, or nothing completed)', () => {
    for (const [ar, o] of [[false, 'release-to-buyer'], [false, 'refund-to-seller'], [true, 'no-action']] as const) {
      const p = publish(opened(ar), o);
      expect(lienSteps(p, applyDispute(p, { type: 'window-closed' }, system, at(60), S), buyerPosted, []), o).toEqual([]);
    }
  });
});

describe('the seller pays the XMR and the proof is accepted', () => {
  it('a lien for the XMR alone is repaid', () => {
    const p = publish(opened(true), 'seller-sends-xmr');
    const done = applyDispute(p, { type: 'complied' }, system, at(10), S);
    expect(lienSteps(p, done, buyerPosted, [lien()])).toEqual([{ op: 'repaid', id: 'l1' }]);
  });

  it('after "Decision stands", the round-1 lien is the one repaid', () => {
    const p = appeal(publish(opened(true), 'seller-sends-xmr'), 'seller');
    const stood = decide(p, 'seller-sends-xmr');
    expect(stood.status).toBe('complying');
    const done = applyDispute(stood, { type: 'complied' }, system, at(10), S);
    expect(lienSteps(stood, done, buyerPosted, [lien()])).toEqual([{ op: 'repaid', id: 'l1' }]);
  });

  it('a lien that also carries the unpaid 1% stays (the payment to the buyer did not pay X2F)', () => {
    const p = publish(opened(true), 'seller-sends-xmr');
    const done = applyDispute(p, { type: 'complied' }, system, at(10), S);
    expect(lienSteps(p, done, sellerPosted, [lien({ feeAtomic: F })])).toEqual([]);
  });
});

describe('input checks', () => {
  it('refuses two different disputes', () => {
    const a = opened(true);
    expect(() => lienSteps(a, { ...publish(a, 'seller-sends-xmr'), seq: 2 }, sellerPosted, [])).toThrow(RangeError);
  });

  it('refuses amounts that are not positive, or a fee that is not below the amount', () => {
    const d = opened(true);
    const p = publish(d, 'seller-sends-xmr');
    expect(() => lienSteps(d, p, { ...sellerPosted, amountAtomic: 0n }, [])).toThrow(RangeError);
    expect(() => lienSteps(d, p, { ...sellerPosted, feeAtomic: -1n }, [])).toThrow(RangeError);
    expect(() => lienSteps(d, p, { ...sellerPosted, feeAtomic: A }, [])).toThrow(RangeError);
  });
});
