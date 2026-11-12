import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { LOST_DISPUTES_SQL } from '../src/traders/summary.js';
import { appealDirect, publishRuling } from './helpers/disputes.js';
import { tradeApp } from './helpers/tradeApp.js';
import { driveTo, seedTrade } from './helpers/trades.js';

// R-011 / R-012 (owner Q40, Q41) and the J-21 review (F1, 12 Nov 2026): a trader's dispute record
// follows the final outcome. While an appeal is pending, round 1 is not final, so the dispute counts
// neither as lost nor (J-21's public count, when it lands) as won; once the appeal is decided, its
// round 2 counts. One shared predicate (traders/finalOutcome.ts rulingCountsSql). Real Postgres.

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];

beforeAll(async () => {
  ({ app, deps, trader, setNow } = await tradeApp());
  setNow(new Date('2026-10-17T12:00:00Z'));
});
afterAll(async () => {
  await app.close();
});

const lost = async (id: string) =>
  Number((await deps.db.query<{ n: string }>(`select ${LOST_DISPUTES_SQL} as n from accounts a where a.id = $1`, [id])).rows[0]!.n);

describe('lost disputes leave out a dispute whose appeal is pending (J-21 F1)', () => {
  it('round 1 counts; appealed it counts for nobody; round 2 decides', async () => {
    const seller = await trader();
    const buyer = await trader();
    const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
    await driveTo(deps, trade, 'secured');
    expect((await seller.browser.post(`/v1/trades/${trade.code}/dispute`, { reason: 'paid', note: '' })).statusCode).toBe(200);
    await publishRuling(deps, trade.code, { outcome: 'release-to-buyer' });
    expect([await lost(seller.id), await lost(buyer.id)]).toEqual([1, 0]);
    await appealDirect(deps, trade.code, 'seller');
    expect([await lost(seller.id), await lost(buyer.id)]).toEqual([0, 0]);
    await publishRuling(deps, trade.code, { outcome: 'refund-to-seller' });
    expect([await lost(seller.id), await lost(buyer.id)]).toEqual([0, 1]);
  });
});
