// Plan 3 Task 39 through the events route: no cancel after "I've paid", the seller's walk-away
// before "Fund escrow" (fund-started), and the seller's Confirm cancel after a buyer's cancel,
// accepted only once X2F's own node counts 10 confirmations on the refund (owner 2026-10-29).
import { createECDH, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PushCall } from '../src/push/send.js';
import type { Deps } from '../src/app.js';
import { CANCEL_RETURN_MAX_WAIT_H, watchCancelReturns } from '../src/trades/cancelReturn.js';
import { applyEvent, loadTrade } from '../src/trades/store.js';
import { FIAT, driveTo, seedTrade } from './helpers/trades.js';
import { tradeApp } from './helpers/tradeApp.js';

let app: FastifyInstance;
let deps: Deps;
let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];
/** What X2F's node answers for the refund tx; `asked` records each hash looked up. */
let nodeCount: number | null = 3;
const asked: string[] = [];
const pushes: PushCall[] = [];

beforeAll(async () => {
  ({ app, deps, trader } = await tradeApp({
    pushTransport: async (call) => {
      pushes.push(call);
      return { statusCode: 201 };
    },
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
    // The full count also recorded when the button became available.
    expect((await loadTrade(deps.db, t.code))!.cancelConfirmableAt).toBeInstanceOf(Date);
    expect(errorOf(await seller.browser.post(events(t.code), { type: 'confirm-cancel' }))).toBe('wrong-state');
    // A cancel itself can't be disputed (owner 2026-10-29, question 4).
    const d = await buyer.browser.post(`/v1/trades/${t.code}/dispute`, { reason: 'paid', note: '' });
    expect(d.statusCode).toBe(409);
    expect(errorOf(d)).toBe('wrong-state');
  });
});

describe('the 48-hour auto-close starts when the refund is fully confirmed (owner 2026-10-29)', () => {
  it('watchCancelReturns records the moment once per trade, only with all confirmations', async () => {
    const { buyer, t } = await tradeIn('secured');
    await buyer.browser.post(events(t.code), { type: 'buyer-cancel' });
    await applyEvent(deps, t.code, { type: 'settled', kind: 'buyer-cancel', txHash: 'fa'.repeat(32) }, 'system');
    const lookup = async (hash: string) => (hash === 'fa'.repeat(32) ? nodeCount : null);
    nodeCount = 9;
    expect(await watchCancelReturns(deps, lookup)).toBe(0);
    expect((await loadTrade(deps.db, t.code))!.cancelConfirmableAt).toBeNull();
    nodeCount = 10;
    expect(await watchCancelReturns(deps, lookup)).toBe(1);
    const after = await loadTrade(deps.db, t.code);
    expect(after!.cancelConfirmableAt).toEqual(deps.clock());
    expect(await watchCancelReturns(deps, lookup)).toBe(0);
    const view = await buyer.browser.get(`/v1/trades/${t.code}`);
    expect((view.json() as { cancelConfirmableAt: string | null }).cancelConfirmableAt).toBe(deps.clock().toISOString());
  });

  it('review M1: once the full count is recorded, Confirm cancel works with the node down', async () => {
    const { seller, buyer, t } = await tradeIn('secured');
    await buyer.browser.post(events(t.code), { type: 'buyer-cancel' });
    await applyEvent(deps, t.code, { type: 'settled', kind: 'buyer-cancel', txHash: 'fb'.repeat(32) }, 'system');
    nodeCount = 10;
    expect(await watchCancelReturns(deps, async () => nodeCount)).toBeGreaterThanOrEqual(1);
    nodeCount = null;
    const ok = await seller.browser.post(events(t.code), { type: 'confirm-cancel' });
    expect(ok.statusCode).toBe(200);
  });
});

describe("review I1: a cancel's refund that lands after I've paid keeps the buyer's dispute", () => {
  it('the seller holds the signed refund back until the buyer paid: the buyer can still open a dispute', async () => {
    const { buyer, t } = await tradeIn('secured');
    const cancel = await buyer.browser.post(events(t.code), { type: 'buyer-cancel' });
    expect((cancel.json() as { state: string }).state).toBe('settling');
    // The signing window lapses (the refund is held back): back to secured.
    const later = new Date(deps.clock().getTime() + 16 * 60_000);
    expect((await applyEvent({ ...deps, clock: () => later }, t.code, { type: 'tick' }, 'system')).state).toBe('secured');
    const paid = await buyer.browser.post(events(t.code), { type: 'mark-paid', fiatCents: FIAT.toString() });
    expect((paid.json() as { state: string }).state).toBe('paid');
    await applyEvent(deps, t.code, { type: 'settled', kind: 'buyer-cancel', txHash: 'fc'.repeat(32) }, 'system');
    const d = await buyer.browser.post(`/v1/trades/${t.code}/dispute`, { reason: 'paid', note: '' });
    expect(d.statusCode).toBe(200);
    expect((await loadTrade(deps.db, t.code))!.state).toBe('disputed');
  });
});

describe("review M7: the owner's own notification when Confirm cancel becomes available", () => {
  it('the seller gets "Your input is needed to cancel this trade." once, the buyer no push', async () => {
    const { seller, buyer, t } = await tradeIn('secured');
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    const sub = {
      endpoint: `https://fcm.googleapis.com/fcm/send/${randomBytes(12).toString('base64url')}`,
      keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') },
    };
    expect((await seller.browser.post('/v1/account/push', sub)).statusCode).toBe(204);
    await buyer.browser.post(events(t.code), { type: 'buyer-cancel' });
    await applyEvent(deps, t.code, { type: 'settled', kind: 'buyer-cancel', txHash: 'fd'.repeat(32) }, 'system');
    pushes.length = 0;
    nodeCount = 10;
    expect((await seller.browser.get(`/v1/trades/${t.code}/confirmations`)).statusCode).toBe(200);
    await vi.waitFor(() => expect(pushes.map((c) => c.payload)).toEqual(['Your input is needed to cancel this trade.']));
    expect((await loadTrade(deps.db, t.code))!.cancelConfirmableAt).toBeInstanceOf(Date);
    // Recorded once: asking again sends nothing more.
    await seller.browser.get(`/v1/trades/${t.code}/confirmations`);
    await new Promise((r) => setTimeout(r, 50));
    expect(pushes).toHaveLength(1);
  });
});

describe('review M3: a refund the node never confirms is not polled forever', () => {
  it('after CANCEL_RETURN_MAX_WAIT_H it goes to a moderator (escalate → disputed, with its system dispute)', async () => {
    const { buyer, t } = await tradeIn('secured');
    await buyer.browser.post(events(t.code), { type: 'buyer-cancel' });
    await applyEvent(deps, t.code, { type: 'settled', kind: 'buyer-cancel', txHash: 'fe'.repeat(32) }, 'system');
    const never = async () => null;
    expect(await watchCancelReturns(deps, never)).toBe(0);
    expect((await loadTrade(deps.db, t.code))!.state).toBe('refunded');
    const later = new Date(deps.clock().getTime() + (CANCEL_RETURN_MAX_WAIT_H * 60 + 1) * 60_000);
    await watchCancelReturns({ ...deps, clock: () => later }, never);
    const after = await loadTrade(deps.db, t.code);
    expect(after!.state).toBe('disputed');
    expect(after!.dispute?.by).toBe('system');
  });
});
