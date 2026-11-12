import type { FastifyInstance } from 'fastify';
import { rulingFee, type RulingOutcome } from '@x2f/staff';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { disputeOutcomeSql, REVERSAL_OUTCOMES, SALE_OUTCOMES } from '../src/traders/finalOutcome.js';
import { appealDirect, publishRuling } from './helpers/disputes.js';
import { tradeApp } from './helpers/tradeApp.js';
import { driveTo, seedTrade } from './helpers/trades.js';

// R-011 / R-012 (owner Q40, Q41): feedback and totals follow the final binding outcome. For one
// round, a "sale" is the same thing as a ruling where the poster pays X2F's 1% (owner g63, @x2f/staff
// rulingFee): the trade completes; a reversal is a ruling that charges nothing. The two rules part on
// an appeal that overturns a ruling whose coins already moved: a fee lien, but a reputation reversal.

let app: FastifyInstance;
let deps: Deps;
let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];
let setNow: (d: Date) => void;

beforeAll(async () => {
  ({ app, deps, trader, setNow } = await tradeApp());
  setNow(new Date('2026-10-17T12:00:00Z'));
});
afterAll(async () => {
  await app.close();
});

describe('final outcome: sale and reversal against the fee split', () => {
  it('for one round, every ruling outcome is exactly one of sale or reversal, as rulingFee splits them', () => {
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

  it('round 1 releases to the buyer, the appeal refunds the seller: a fee lien (poster pays), but reversed for feedback and totals (D-006)', async () => {
    const seller = await trader();
    const buyer = await trader();
    const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
    await driveTo(deps, trade, 'secured');
    expect((await seller.browser.post(`/v1/trades/${trade.code}/dispute`, { reason: 'paid', note: '' })).statusCode).toBe(200);
    const outcome = async () =>
      (await deps.db.query<{ o: string | null }>(`select ${disputeOutcomeSql('t')} as o from trades t where t.code = $1`, [trade.code])).rows[0]!.o;
    expect(await outcome()).toBe('pending');
    await publishRuling(deps, trade.code, { outcome: 'release-to-buyer' });
    await appealDirect(deps, trade.code, 'seller');
    expect(await outcome()).toBe('pending');
    const d = await publishRuling(deps, trade.code, { outcome: 'refund-to-seller' });
    expect(rulingFee(d)).toBe('poster-pays');
    expect(await outcome()).toBe('reversed');
  });
});
