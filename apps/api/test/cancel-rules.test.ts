// Plan 3 Task 39 through the events route: no cancel after "I've paid", the seller's walk-away
// before "Fund escrow" (fund-started), and the seller's Confirm cancel after a buyer's cancel,
// accepted only once X2F's own node counts 10 confirmations on the refund (owner 2026-10-29).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { applyEvent, loadTrade } from '../src/trades/store.js';
import { driveTo, seedTrade } from './helpers/trades.js';
import { tradeApp } from './helpers/tradeApp.js';

let app: FastifyInstance;
let deps: Deps;
let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];
/** What X2F's node answers for the refund tx; `asked` records each hash looked up. */
let nodeCount: number | null = 3;
const asked: string[] = [];

beforeAll(async () => {
  ({ app, deps, trader } = await tradeApp({
    txConfirmations: async (hash) => {
      asked.push(hash);
      return nodeCount;
    },
  }));
});
afterAll(async () => {
  await app.close();
});

const events = (code: string) => `/v1/trades/${code}/events`;
const errorOf = (res: { json(): unknown }) => (res.json() as { error?: string }).error;

async function tradeIn(state: Parameters<typeof driveTo>[2]) {
  const seller = await trader();
  const buyer = await trader();
  const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
  const t = await driveTo(deps, trade, state);
  return { seller, buyer, t };
}

describe("no cancel after I've paid (Revision 2026-10-29b)", () => {
  it('refuses buyer-cancel, propose-cancel, accept-cancel and withdraw-cancel in paid with 409 wrong-state', async () => {
    const { seller, buyer, t } = await tradeIn('paid');
    for (const [who, type] of [
      [buyer, 'buyer-cancel'],
      [buyer, 'propose-cancel'],
      [seller, 'propose-cancel'],
      [seller, 'accept-cancel'],
      [buyer, 'withdraw-cancel'],
    ] as const) {
      const res = await who.browser.post(events(t.code), { type });
      expect(res.statusCode, type).toBe(409);
      expect(errorOf(res), type).toBe('wrong-state');
    }
    expect((await loadTrade(deps.db, t.code))!.state).toBe('paid');
  });
});

describe("the seller's walk-away and fund-started", () => {
  it('walk-away before Fund escrow cancels the trade', async () => {
    const { seller, buyer, t } = await tradeIn('funding');
    const wrong = await buyer.browser.post(events(t.code), { type: 'walk-away' });
    expect(errorOf(wrong)).toBe('wrong-party');
    const res = await seller.browser.post(events(t.code), { type: 'walk-away' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { state: string }).state).toBe('cancelled');
  });

  it('after fund-started the walk-away is refused, and the view carries fundStartedAt', async () => {
    const { seller, t } = await tradeIn('funding');
    const f = await seller.browser.post(events(t.code), { type: 'fund-started' });
    expect(f.statusCode).toBe(200);
    expect((f.json() as { fundStartedAt: string | null }).fundStartedAt).not.toBeNull();
    expect((await loadTrade(deps.db, t.code))!.fundStartedAt).toBeInstanceOf(Date);
    const again = await seller.browser.post(events(t.code), { type: 'fund-started' });
    expect(errorOf(again)).toBe('wrong-state');
    const walk = await seller.browser.post(events(t.code), { type: 'walk-away' });
    expect(walk.statusCode).toBe(409);
    expect(errorOf(walk)).toBe('wrong-state');
    expect((await loadTrade(deps.db, t.code))!.state).toBe('funding');
  });
});

describe("the seller's Confirm cancel after a buyer's cancel (owner 2026-10-29)", () => {
  it('greyed out (too-early) until the node counts 10 on the refund; the body cannot claim a count', async () => {
    const { seller, buyer, t } = await tradeIn('secured');
    const cancel = await buyer.browser.post(events(t.code), { type: 'buyer-cancel' });
    expect((cancel.json() as { state: string }).state).toBe('settling');
    const tx = 'ef'.repeat(32);
    await applyEvent(deps, t.code, { type: 'settled', kind: 'buyer-cancel', txHash: tx }, 'system');
    nodeCount = 3;
    const early = await seller.browser.post(events(t.code), { type: 'confirm-cancel', returnConfirmations: 99 });
    expect(early.statusCode).toBe(409);
    expect(errorOf(early)).toBe('too-early');
    expect(asked.at(-1)).toBe(tx);
    nodeCount = null; // the node can't be asked: counts as 0
    expect(errorOf(await seller.browser.post(events(t.code), { type: 'confirm-cancel' }))).toBe('too-early');
    expect(errorOf(await buyer.browser.post(events(t.code), { type: 'confirm-cancel' }))).toBe('wrong-party');
    nodeCount = 10;
    const ok = await seller.browser.post(events(t.code), { type: 'confirm-cancel' });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as { cancelConfirmedAt: string | null }).cancelConfirmedAt).not.toBeNull();
    const { rows } = await deps.db.query<{ event: unknown }>('select event from trade_events where code = $1 order by id desc limit 1', [t.code]);
    expect(rows[0]!.event).toEqual({ type: 'confirm-cancel', returnConfirmations: 10 });
    expect(errorOf(await seller.browser.post(events(t.code), { type: 'confirm-cancel' }))).toBe('wrong-state');
  });
});
