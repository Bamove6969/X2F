import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { RETENTION_JOBS } from '../src/retentionJobs.js';
import { startRetention, type RetentionLog } from '../src/retention.js';
import { applyEvent, type TradePublisher } from '../src/trades/store.js';
import { fakeAddress, happyPath, seedTrade } from './helpers/trades.js';
import { tradeApp } from './helpers/tradeApp.js';

let app: FastifyInstance;
let deps: Deps;
let logs: string[];
let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];

// Every publish fails with an error that names the trade, its escrow and its state, so the
// failure log line is the place a leak would show.
const leakyPublish: TradePublisher = (t) => {
  throw new Error(`publish failed for ${t.code} at ${t.escrowAddress ?? 'none'} via /v1/trades/${t.code}`);
};

beforeAll(async () => {
  ({ app, deps, logs, trader } = await tradeApp({ tradePublish: leakyPublish }));
});
afterAll(async () => {
  await app.close();
});

describe('log hygiene over a whole trade (P3-I15)', () => {
  it('never logs a trade code, an address or an IP', async () => {
    const seller = await trader();
    const buyer = await trader();
    const third = await trader();
    const { trade, sides } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
    const escrow = fakeAddress();
    const url = `/v1/trades/${trade.code}`;
    for (const step of happyPath(trade, escrow)) {
      for (const who of [seller, buyer, third]) await who.browser.get(url);
      // Refusals on the way: a system event, a wrong party, a bad body, an outsider.
      await buyer.browser.post(`${url}/events`, { type: 'chain', receivedAtomic: '1' });
      await seller.browser.post(`${url}/events`, { type: 'buyer-cancel' });
      await buyer.browser.post(`${url}/events`, { type: 'mark-paid', fiatCents: 'x' });
      await third.browser.post(`${url}/events`, { type: 'open-dispute' });
      if (step.by === 'system') {
        await applyEvent(deps, trade.code, step.e, 'system');
      } else {
        const who = step.by === 'buyer' ? buyer : seller;
        const body = step.e.type === 'mark-paid' ? { type: step.e.type, fiatCents: step.e.fiatCents.toString() } : { type: step.e.type };
        expect((await who.browser.post(`${url}/events`, body)).statusCode).toBe(200);
      }
    }
    for (const who of [seller, buyer]) await who.browser.get(url);
    await third.browser.get(`/v1/trades/${trade.code.replaceAll('-', '').toLowerCase()}`);

    // The retention scheduler's own lines go to the same check.
    const jobLines: RetentionLog[] = [];
    const stop = startRetention(deps, [...RETENTION_JOBS], 20, (e) => void jobLines.push(e));
    await new Promise((r) => setTimeout(r, 100));
    await stop();
    expect(jobLines.length).toBeGreaterThan(0);

    const text = logs.join('\n') + JSON.stringify(jobLines);
    // The two route-made publish failures were logged, so the check is not vacuous.
    expect(logs.filter((l) => l.includes('trade publish failed'))).toHaveLength(2);
    const compact = trade.code.replaceAll('-', '');
    for (const secret of [trade.code, compact, compact.toLowerCase(), escrow, sides.buyerPayout!, sides.sellerRefund!]) {
      expect(text).not.toContain(secret);
    }
    for (const a of [escrow, sides.buyerPayout!, sides.sellerRefund!]) expect(text).not.toContain(a.slice(0, 20));
    expect(text).not.toMatch(/127\.0\.0\.1|::1|remoteAddress|"ip"|hostname/);
    expect(text).not.toMatch(/\/v1\/trades\/[0-9A-Za-z]/);
  });
});
