import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { runDisputeTimers } from '../src/disputes/timers.js';
import { applyEvent } from '../src/trades/store.js';
import { publishRuling } from './helpers/disputes.js';
import { tradeApp } from './helpers/tradeApp.js';
import { driveTo, seedTrade } from './helpers/trades.js';

// Review of wip/lead-reputation, M1 (12 Nov 2026): a decided dispute's save now erases a reversed
// trade's reviews and moves both parties' running totals (R-011, R-012). Those locks must be taken in
// the same order as a trade event (trade row, then the dispute and the totals rows) and before the
// site-wide log lock (log/append.ts N3), or a ruling finalised by the timer deadlocks with a trade
// event that touches the same rows. Each test holds a trade event open at the point where it owns
// the contested lock, starts the dispute timer, then lets the event go: both must finish.
// Real Postgres.

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];

const START = new Date('2026-10-17T12:00:00Z');
const DAY = 86_400_000;
const tx = () => randomBytes(32).toString('hex');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  ({ app, deps, trader, setNow } = await tradeApp());
});
afterAll(async () => {
  await app.close();
});

/** A trade the seller disputed while secured, with round 1 published (its appeal window open). */
async function ruled(sellerId: string, seller: Awaited<ReturnType<typeof trader>>, buyerId: string, outcome: 'release-to-buyer' | 'refund-to-seller') {
  const { trade } = await seedTrade(deps, { sellerId, buyerId, poster: 'seller' });
  await driveTo(deps, trade, 'secured');
  expect((await seller.browser.post(`/v1/trades/${trade.code}/dispute`, { reason: 'paid', note: '' })).statusCode).toBe(200);
  await publishRuling(deps, trade.code, { outcome });
  return trade.code;
}

function gate() {
  let open!: () => void;
  let entered!: () => void;
  const opened = new Promise<void>((r) => { open = r; });
  const inside = new Promise<void>((r) => { entered = r; });
  return { open, entered, opened, inside };
}

describe('a ruling finalised by the timer and a trade event never deadlock (M1)', () => {
  it('the same seller releases another trade while the timer makes this one final (totals row vs log lock)', async () => {
    setNow(START);
    const seller = await trader();
    const b1 = await trader();
    const b2 = await trader();
    const a = await ruled(seller.id, seller, b1.id, 'release-to-buyer');
    const { trade: b } = await seedTrade(deps, { sellerId: seller.id, buyerId: b2.id, poster: 'seller' });
    await driveTo(deps, b, 'settling');
    setNow(new Date(START.getTime() + 3 * DAY));
    const g = gate();
    // The release holds trade B and the seller's totals row (countTradeTotals ran), not yet the log lock.
    const release = applyEvent(deps, b.code, { type: 'settled', kind: 'release', txHash: tx() }, 'system', async () => {
      g.entered();
      await g.opened;
    });
    await g.inside;
    const timers = runDisputeTimers({ db: deps.db, clock: deps.clock });
    await sleep(400);
    g.open();
    const [r1, r2] = await Promise.allSettled([release, timers]);
    expect(r1.status, r1.status === 'rejected' ? String(r1.reason) : '').toBe('fulfilled');
    expect(r2.status, r2.status === 'rejected' ? String((r2.reason as AggregateError).errors ?? r2.reason) : '').toBe('fulfilled');
    expect((await deps.db.query<{ status: string }>('select status from disputes where code = $1', [a])).rows[0]!.status).toBe('final');
    // Both trades are in the seller's totals: A as a decided sale, B as a release.
    const { rows } = await deps.db.query<{ n: string }>(
      `select count(*) as n from trade_totals_counted where kind = 'completed' and trade_code = any($1)`, [[a, b.code]],
    );
    expect(rows[0]!.n).toBe('2');
  });

  it('a trade event that locks the trade, then its dispute (the settle path), while the timer makes it final', async () => {
    setNow(START);
    const seller = await trader();
    const buyer = await trader();
    const c = await ruled(seller.id, seller, buyer.id, 'refund-to-seller');
    setNow(new Date(START.getTime() + 3 * DAY));
    const g = gate();
    // As internal/routes.ts's settle callback: trade row first, then the dispute row `for update`.
    const event = applyEvent(deps, c, { type: 'tick' }, 'system', undefined, async (client) => {
      g.entered();
      await g.opened;
      await client.query('select 1 from disputes where code = $1 for update', [c]);
      return 'stop';
    });
    await g.inside;
    const timers = runDisputeTimers({ db: deps.db, clock: deps.clock });
    await sleep(400);
    g.open();
    const [r1, r2] = await Promise.allSettled([event, timers]);
    expect(r1.status, r1.status === 'rejected' ? String(r1.reason) : '').toBe('fulfilled');
    expect(r2.status, r2.status === 'rejected' ? String((r2.reason as AggregateError).errors ?? r2.reason) : '').toBe('fulfilled');
    expect((await deps.db.query<{ status: string }>('select status from disputes where code = $1', [c])).rows[0]!.status).toBe('final');
  });
});
