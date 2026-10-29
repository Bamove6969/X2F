import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { COMPLETED_TRADES_SQL, tradeCap } from '../src/traders/stage.js';
import { applyEvent } from '../src/trades/store.js';
import { driveTo, seedTrade } from './helpers/trades.js';
import { tradeApp } from './helpers/tradeApp.js';

// Owner rule R38 (2026-10-29; Plan 3 and Plan 5 Revision 2026-10-29): a settled dispute counts as a
// completed trade for both traders, whoever won, and a lost dispute drops no stage. A moderator's
// refund to the seller settles as `mutual-cancel` (no seller-side settle kind yet), so the trade
// ends `refunded` with `dispute_by` set; COMPLETED_TRADES_SQL counts it (Task 27 round 4, lead).

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];

const START = new Date('2026-10-17T12:00:00Z');
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const at = (ms: number) => new Date(START.getTime() + ms);

beforeAll(async () => {
  ({ app, deps, trader, setNow } = await tradeApp());
});
afterAll(async () => {
  await app.close();
});

async function completed(accountId: string): Promise<number> {
  const { rows } = await deps.db.query<{ n: string }>(`select ${COMPLETED_TRADES_SQL} as n from accounts a where a.id = $1`, [accountId]);
  return Number(rows[0]!.n);
}

async function tradeIn(state: Parameters<typeof driveTo>[2]) {
  setNow(START);
  const seller = await trader();
  const buyer = await trader();
  const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
  const t = await driveTo(deps, trade, state);
  return { seller, buyer, t };
}

/** What Plan 4 writes for a final ruling on the trade's current dispute. */
async function ruleFinal(code: string, outcome: string) {
  const current = `(select max(seq) from disputes where code = $1)`;
  await deps.db.query(
    `insert into dispute_rulings (code, seq, round, outcome, reason, evidence, moderator_name, ruled_at, appeal_until)
     values ($1, ${current}, 2, $2, 'reason', '[]', 'sarah.v', $3, null)`,
    [code, outcome, deps.clock()],
  );
  await deps.db.query(`update disputes set status = 'final' where code = $1 and seq = ${current}`, [code]);
}

describe('completed trades count settled disputes, whoever won (R38)', () => {
  it('(a) a refund-to-seller ruling counts for the buyer who lost and the seller who won', async () => {
    const { seller, buyer, t } = await tradeIn('secured');
    expect((await buyer.browser.post(`/v1/trades/${t.code}/dispute`, { reason: 'paid', note: '' })).statusCode).toBe(200);
    await ruleFinal(t.code, 'refund-to-seller');
    // While the dispute is open the trade is not completed for either side.
    expect(await completed(buyer.id)).toBe(0);
    expect(await completed(seller.id)).toBe(0);
    expect((await applyEvent(deps, t.code, { type: 'settled', kind: 'mutual-cancel', txHash: 'cd'.repeat(32) }, 'system')).state).toBe('refunded');
    expect(await completed(buyer.id)).toBe(1);
    expect(await completed(seller.id)).toBe(1);
  });

  it('(b) a released trade whose late deposit was escalated and refunded still counts for both', async () => {
    const { seller, buyer, t } = await tradeIn('secured');
    await applyEvent(deps, t.code, { type: 'settled', kind: 'release', txHash: 'ef'.repeat(32) }, 'system');
    expect(await completed(buyer.id)).toBe(1);
    setNow(at(3 * 60 * MIN));
    expect((await applyEvent(deps, t.code, { type: 'escalate' }, 'system')).state).toBe('disputed');
    await ruleFinal(t.code, 'refund-to-seller');
    expect((await applyEvent(deps, t.code, { type: 'settled', kind: 'mutual-cancel', txHash: 'aa'.repeat(32) }, 'system')).state).toBe('refunded');
    expect(await completed(buyer.id)).toBe(1);
    expect(await completed(seller.id)).toBe(1);
  });

  it('a refund with no dispute does not count', async () => {
    const { seller, buyer, t } = await tradeIn('secured');
    expect((await applyEvent(deps, t.code, { type: 'settled', kind: 'mutual-cancel', txHash: 'bb'.repeat(32) }, 'system')).state).toBe('refunded');
    expect(await completed(buyer.id)).toBe(0);
    expect(await completed(seller.id)).toBe(0);
  });

  it('a lost dispute drops no stage: four releases and a lost dispute make Building', async () => {
    const { seller, buyer, t } = await tradeIn('secured');
    expect((await seller.browser.post(`/v1/trades/${t.code}/dispute`, { reason: 'paid', note: '' })).statusCode).toBe(200);
    await ruleFinal(t.code, 'release-to-buyer'); // the seller lost
    await applyEvent(deps, t.code, { type: 'settled', kind: 'release', txHash: 'dd'.repeat(32) }, 'system');
    for (let i = 0; i < 4; i++) {
      const other = await trader();
      const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: other.id, poster: 'seller' });
      await deps.db.query(`update trades set state = 'released', closed_at = $2 where code = $1`, [trade.code, deps.clock()]);
    }
    await deps.db.query('update accounts set created_at = $2 where id = $1', [seller.id, new Date(deps.clock().getTime() - 8 * DAY)]);
    expect(await completed(seller.id)).toBe(5);
    expect((await tradeCap(deps.db, seller.id, deps.clock())).stage).toBe('building');
    expect(await completed(buyer.id)).toBe(1);
  });
});
