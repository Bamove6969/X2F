// Owner g63 (7 Nov): who pays the 1% fee after a moderator's ruling.
import { describe, expect, it } from 'vitest';
import { rulingFee, type Dispute, type RulingOutcome } from '../src/index.js';

const draft = (outcome: RulingOutcome) => ({ id: 'r', outcome, accountAction: { kind: 'none' as const }, proposer: 'm1', approver: null, needsSecond: false });
const round1 = (outcome: RulingOutcome) => ({ ...draft(outcome), firstReplyAt: null, involved: ['m1'] });

type Facts = Pick<Dispute, 'status' | 'round' | 'ruling' | 'round1'>;
const r1 = (status: Dispute['status'], outcome: RulingOutcome | null): Facts => ({ status, round: 1, ruling: outcome === null ? null : draft(outcome), round1: null });
const r2 = (status: Dispute['status'], first: RulingOutcome, final: RulingOutcome | null): Facts => ({
  status,
  round: 2,
  ruling: final === null ? null : draft(final),
  round1: round1(first),
});

describe('rulingFee (owner g63)', () => {
  it('no ruling yet: nothing to say', () => {
    expect(rulingFee(r1('open', null))).toBeNull();
    expect(rulingFee(r1('awaiting-approval', 'release-to-buyer'))).toBeNull();
  });

  it('a ruling that moves the trade forward: the trade completes, the poster pays the 1%', () => {
    for (const status of ['published', 'final', 'closed'] as const) expect(rulingFee(r1(status, 'release-to-buyer')), status).toBe('poster-pays');
  });

  it('a full reversal (all funds back to the original parties): no fee', () => {
    for (const status of ['published', 'final', 'closed'] as const) expect(rulingFee(r1(status, 'refund-to-seller')), status).toBe('none');
    expect(rulingFee(r1('closed', 'seller-returns-fiat'))).toBe('none');
    expect(rulingFee(r1('closed', 'no-action'))).toBe('none');
  });

  it('a lien (the seller must send the XMR after a refund): the trade completes, the poster pays', () => {
    expect(rulingFee(r1('published', 'seller-sends-xmr'))).toBe('poster-pays');
    expect(rulingFee(r1('complying', 'seller-sends-xmr'))).toBe('poster-pays');
  });

  it('during an appeal the fee waits on the outcome', () => {
    expect(rulingFee(r2('appealed', 'release-to-buyer', null))).toBe('waits');
    expect(rulingFee(r2('appealed', 'refund-to-seller', null))).toBe('waits');
    expect(rulingFee(r2('awaiting-approval', 'refund-to-seller', 'release-to-buyer'))).toBe('waits');
  });

  it('an appeal that upholds completion: the poster pays; one that upholds a reversal: no fee', () => {
    expect(rulingFee(r2('closed', 'release-to-buyer', 'release-to-buyer'))).toBe('poster-pays');
    expect(rulingFee(r2('final', 'refund-to-seller', 'refund-to-seller'))).toBe('none');
    expect(rulingFee(r2('closed', 'seller-sends-xmr', 'seller-sends-xmr'))).toBe('poster-pays');
  });

  it('an appeal that overturns a ruling whose coins already moved: a lien, so the poster pays', () => {
    // Review p4t22 m1: the coins moved under round 1 when round 1's payout is the one that ran.
    // Released at round 1 (fee taken), reversed on appeal: the buyer owes the XMR back under a lien.
    expect(rulingFee({ ...r2('closed', 'release-to-buyer', 'refund-to-seller'), executedRound: 1 })).toBe('poster-pays');
    // Refunded at round 1, released on appeal: the seller owes the XMR under a lien; the trade completes.
    expect(rulingFee({ ...r2('closed', 'refund-to-seller', 'release-to-buyer'), executedRound: 1 })).toBe('poster-pays');
  });

  it("review p4t22 m1 (OQ2): an overturn before round 1 paid: round 2's own payout, its own fee", () => {
    for (const executedRound of [null, 2] as const) {
      expect(rulingFee({ ...r2('final', 'release-to-buyer', 'refund-to-seller'), executedRound })).toBe('none');
      expect(rulingFee({ ...r2('final', 'refund-to-seller', 'release-to-buyer'), executedRound })).toBe('poster-pays');
    }
  });

  it('after a refund, an appeal decides by its own outcome (a lifted lien is no lien)', () => {
    expect(rulingFee(r2('closed', 'seller-sends-xmr', 'no-action'))).toBe('none');
    expect(rulingFee(r2('complying', 'no-action', 'seller-sends-xmr'))).toBe('poster-pays');
  });
});
