import { rulingFee, type RulingOutcome } from '@x2f/staff';
import { describe, expect, it } from 'vitest';
import { REVERSAL_OUTCOMES, SALE_OUTCOMES } from '../src/traders/finalOutcome.js';

// R-011 / R-012 (owner Q40, Q41): feedback and totals follow the final binding outcome. A "sale" is
// the same thing as a ruling where the poster pays X2F's 1% (owner g63, @x2f/staff rulingFee): the
// trade completes; a reversal is a ruling that charges nothing (all funds back where they came from).
describe('final outcome: sale and reversal match the fee split', () => {
  it('every ruling outcome is exactly one of sale or reversal, as rulingFee splits them', () => {
    const all: RulingOutcome[] = ['release-to-buyer', 'refund-to-seller', 'seller-sends-xmr', 'seller-returns-fiat', 'no-action'];
    expect([...SALE_OUTCOMES, ...REVERSAL_OUTCOMES].sort()).toEqual([...all].sort());
    for (const outcome of all) {
      const fee = rulingFee({
        status: 'final',
        round: 1,
        ruling: { id: 'r', outcome, accountAction: { kind: 'none' }, proposer: 'p', approver: null, needsSecond: false },
        round1: null,
      });
      expect(fee === 'poster-pays', outcome).toBe((SALE_OUTCOMES as readonly string[]).includes(outcome));
    }
  });
});
