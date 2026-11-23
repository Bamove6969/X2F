// Review p4t22 m1 (the probe probe-p4t22-overturn): an appeal overturns round 1 before round 1's
// payout ran. Lead default, owner question OQ2: round 2's outcome pays, and no lien lands on
// someone who received nothing. The coins moved under round 1 only when its payout is the one that
// ran (`executed` names the round that paid); only then does an overturn lien the receiver (D-006).
import { describe, expect, it } from 'vitest';
import { DisputeRuleError, applyDispute, lienSteps, newDispute, rulingFee, type Actor, type Dispute, type RulingOutcome } from '../src/index.js';

const H = 3_600_000;
const T0 = new Date('2027-02-01T10:00:00.000Z');
const at = (h: number) => new Date(T0.getTime() + h * H);
const S = { appealWindowH: 48, firstResponseH: 4 };
const G = { usdCents: 41_250n, limitUsdCents: 100_000n };
const mod: Actor = { kind: 'staff', id: 'mod-1', role: 'mod' };
const senior: Actor = { kind: 'staff', id: 'senior-1', role: 'senior' };
const system: Actor = { kind: 'system' };
const FACTS = { poster: 'seller' as const, amountAtomic: 1_250_000_000_000n, feeAtomic: 12_500_000_000n, liensOn: true };

function rule(code: DisputeRuleError['code'], f: () => unknown) {
  try {
    f();
  } catch (e) {
    expect(e).toBeInstanceOf(DisputeRuleError);
    expect((e as DisputeRuleError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
}

/** Round 1 `release-to-buyer` published, the seller appealed, an uninvolved senior assigned. */
function appealed(): Dispute {
  let d = newDispute({ code: 'K7M2-9QXA-4FTR-8WPN', openedBy: 'buyer', afterRefund: false, usdCents: 41_250n, limitUsdCents: 100_000n, firstResponseH: 4, now: T0 });
  d = applyDispute(d, { type: 'assign', staffId: 'mod-1', role: 'mod' }, mod, at(1), S);
  d = applyDispute(d, { type: 'propose', gate: G, ruling: { id: 'r1', outcome: 'release-to-buyer', accountAction: { kind: 'none' }, proposer: 'mod-1' } }, mod, at(2), S);
  d = applyDispute(d, { type: 'appeal', involved: ['mod-1'] }, { kind: 'trader', side: 'seller' }, at(3), S);
  return applyDispute(d, { type: 'assign', staffId: 'senior-1', role: 'senior' }, senior, at(4), S);
}
const decide = (d: Dispute, outcome: RulingOutcome) =>
  applyDispute(d, { type: 'propose', gate: G, ruling: { id: 'r2', outcome, accountAction: { kind: 'none' }, proposer: 'senior-1' } }, senior, at(5), S);

describe('an overturn before round 1 paid (lead default, owner question OQ2)', () => {
  it('the probe: no lien on the round-1 winner, who received nothing; the dispute waits for round 2 to pay', () => {
    const prev = appealed();
    const next = decide(prev, 'refund-to-seller');
    expect(next.executedAt).toBeNull();
    expect(next.status).toBe('final');
    expect(next.overturned).toBe(true);
    expect(lienSteps(prev, next, FACTS, [])).toEqual([]);
    // The fee follows the ruling that will pay: a full refund carries none.
    expect(rulingFee(next)).toBe('none');
  });

  it("round 2's payout is recorded as round 2's: closed, nothing owed, no lien", () => {
    const final = decide(appealed(), 'refund-to-seller');
    const paid = applyDispute(final, { type: 'executed', round: 2 }, system, at(6), S);
    expect(paid).toMatchObject({ status: 'closed', executedRound: 2 });
    expect(lienSteps(final, paid, FACTS, [])).toEqual([]);
    expect(rulingFee(paid)).toBe('none');
  });

  it("round 1's payout that still ran (it was already handed) liens its receiver once it ran, as before (D-006)", () => {
    const final = decide(appealed(), 'refund-to-seller');
    const paid = applyDispute(final, { type: 'executed', round: 1 }, system, at(6), S);
    expect(paid).toMatchObject({ status: 'closed', executedRound: 1 });
    expect(lienSteps(final, paid, FACTS, [])).toEqual([
      { op: 'place', round: 2, debtor: 'buyer', cause: 'overturned', amountAtomic: FACTS.amountAtomic, feeAtomic: 0n },
    ]);
    expect(rulingFee(paid)).toBe('poster-pays');
  });

  it('round 1 paid before the appeal was decided: the overturn liens its receiver at once, as before', () => {
    const paidFirst = applyDispute(appealed(), { type: 'executed', round: 1 }, system, at(4.5), S);
    const next = decide(paidFirst, 'refund-to-seller');
    expect(next.status).toBe('closed');
    expect(lienSteps(paidFirst, next, FACTS, [])).toContainEqual(expect.objectContaining({ op: 'place', debtor: 'buyer', cause: 'overturned' }));
  });

  it('"Decision stands" before the payout: either round pays the same outcome, no lien', () => {
    const final = decide(appealed(), 'release-to-buyer');
    expect(final.overturned).toBe(false);
    for (const round of [1, 2] as const) {
      const paid = applyDispute(final, { type: 'executed', round }, system, at(6), S);
      expect(lienSteps(final, paid, FACTS, [])).toEqual([]);
    }
  });

  it('round 2 never pays before it is decided, nor twice, nor after a refund', () => {
    const pending = appealed();
    rule('wrong-state', () => applyDispute(pending, { type: 'executed', round: 2 }, system, at(5), S));
    const paid = applyDispute(decide(pending, 'refund-to-seller'), { type: 'executed', round: 2 }, system, at(6), S);
    rule('wrong-state', () => applyDispute(paid, { type: 'executed', round: 1 }, system, at(7), S));
    // Round 1 only, while there is no appeal.
    let d = newDispute({ code: 'K7M2-9QXA-4FTR-8WPN', openedBy: 'buyer', afterRefund: false, usdCents: 41_250n, limitUsdCents: 100_000n, firstResponseH: 4, now: T0 });
    d = applyDispute(d, { type: 'assign', staffId: 'mod-1', role: 'mod' }, mod, at(1), S);
    d = applyDispute(d, { type: 'propose', gate: G, ruling: { id: 'r1', outcome: 'release-to-buyer', accountAction: { kind: 'none' }, proposer: 'mod-1' } }, mod, at(2), S);
    rule('wrong-state', () => applyDispute(d, { type: 'executed', round: 2 }, system, at(3), S));
    expect(applyDispute(d, { type: 'executed', round: 1 }, system, at(3), S).executedRound).toBe(1);
  });
});
