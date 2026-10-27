import { createECDH, randomBytes } from 'node:crypto';
import { newTradeCode } from '@x2f/core';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deps } from '../src/app.js';
import type { PushCall, PushTransport } from '../src/push/send.js';
import { applyEvent, loadTrade } from '../src/trades/store.js';
import { driveTo, seedTrade } from './helpers/trades.js';
import { tradeApp } from './helpers/tradeApp.js';

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];
const calls: PushCall[] = [];
let status = 201;
const fakeTransport: PushTransport = async (call) => {
  calls.push(call);
  return { statusCode: status };
};

beforeAll(async () => {
  ({ app, deps, setNow, trader } = await tradeApp({ pushTransport: fakeTransport }));
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  calls.length = 0;
  status = 201;
  vi.restoreAllMocks();
});

function subscription() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/${randomBytes(12).toString('base64url')}`,
    keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') },
  };
}

/** A secured trade whose pay window has passed, so the seller may request a refund. */
async function refundable() {
  const seller = await trader();
  const buyer = await trader();
  const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
  const t = await driveTo(deps, trade, 'secured');
  setNow(new Date(t.payBy!.getTime() + 60_000));
  return { seller, buyer, t };
}

const delivered = async (code: string) =>
  (await deps.db.query<{ d: boolean | null }>('select final_alert_delivered as d from trades where code = $1', [code])).rows[0]!.d;

const seen = (code: string) => `/v1/trades/${code}/final-alert-seen`;
const errorOf = (res: { json(): unknown }) => (res.json() as { error?: string }).error;

describe('final alert: only the seen-receipt sets final_alert_delivered (P3-I13)', () => {
  it('stays unset (not seen) with no stream and no subscription', async () => {
    const { seller, t } = await refundable();
    expect(await delivered(t.code)).toBeNull();
    const res = await seller.browser.post(`/v1/trades/${t.code}/events`, { type: 'request-refund' });
    expect(res.statusCode).toBe(200);
    expect(await delivered(t.code)).toBeNull();
    expect(calls).toEqual([]);
  });

  it('a push service answering 201 alone never sets it; the push has the generic text', async () => {
    const { seller, buyer, t } = await refundable();
    expect((await buyer.browser.post('/v1/account/push', subscription())).statusCode).toBe(204);
    await seller.browser.post(`/v1/trades/${t.code}/events`, { type: 'request-refund' });
    expect(calls.map((c) => c.payload)).toEqual(['Something changed in a trade on X2F']);
    expect(await delivered(t.code)).toBeNull();
  });

  it('an open stream alone never sets it, and a dead stream with no receipt stays unset', async () => {
    const { seller, buyer, t } = await refundable();
    const live: string[] = [];
    const detachLive = app.events.attach(buyer.id, { send: (d) => void live.push(d), close: () => undefined })!;
    const detachDead = app.events.attach(buyer.id, { send: () => { throw new Error('gone'); }, close: () => undefined })!;
    try {
      await seller.browser.post(`/v1/trades/${t.code}/events`, { type: 'request-refund' });
      expect(live.join('')).toContain('refund_requested');
      expect(await delivered(t.code)).toBeNull();
    } finally {
      detachLive();
      detachDead();
    }
  });

  it("the buyer's receipt sets it true, and is idempotent", async () => {
    const { seller, buyer, t } = await refundable();
    await seller.browser.post(`/v1/trades/${t.code}/events`, { type: 'request-refund' });
    expect((await buyer.browser.post(seen(t.code), {})).statusCode).toBe(204);
    expect(await delivered(t.code)).toBe(true);
    expect((await buyer.browser.post(seen(t.code), {})).statusCode).toBe(204);
    expect(await delivered(t.code)).toBe(true);
  });

  it('the seller cannot set it (409 wrong-party)', async () => {
    const { seller, t } = await refundable();
    await seller.browser.post(`/v1/trades/${t.code}/events`, { type: 'request-refund' });
    const res = await seller.browser.post(seen(t.code), {});
    expect(res.statusCode).toBe(409);
    expect(errorOf(res)).toBe('wrong-party');
    expect(await delivered(t.code)).toBeNull();
  });

  it('before a refund is requested the receipt is refused (409 wrong-state)', async () => {
    const { buyer, t } = await refundable();
    const res = await buyer.browser.post(seen(t.code), {});
    expect(res.statusCode).toBe(409);
    expect(errorOf(res)).toBe('wrong-state');
    expect(await delivered(t.code)).toBeNull();
  });

  it("an unknown code gets the same answer as someone else's trade", async () => {
    const { seller, t } = await refundable();
    await seller.browser.post(`/v1/trades/${t.code}/events`, { type: 'request-refund' });
    const stranger = await trader();
    const notYours = await stranger.browser.post(seen(t.code), {});
    const unknown = await stranger.browser.post(seen(newTradeCode()), {});
    const malformed = await stranger.browser.post(seen('nonsense'), {});
    for (const res of [notYours, unknown, malformed]) {
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not-found' });
    }
    expect(await delivered(t.code)).toBeNull();
  });

  it('a mark-paid committing between the receipt\'s read and its write leaves the trade unflagged (review 2026-10-27, minor 5)', async () => {
    const { seller, buyer, t } = await refundable();
    await seller.browser.post(`/v1/trades/${t.code}/events`, { type: 'request-refund' });
    // Right after the route has read the trade (still refund_requested), the buyer's mark-paid commits.
    const real = deps.db.query.bind(deps.db);
    let raced = false;
    vi.spyOn(deps.db, 'query').mockImplementation((async (text: unknown, params?: unknown[]) => {
      const r = await real(text as string, params);
      if (!raced && typeof text === 'string' && text.startsWith('select * from trades where code') && params?.[0] === t.code) {
        raced = true;
        await applyEvent({ db: deps.db, clock: deps.clock }, t.code, { type: 'mark-paid', fiatCents: t.fiatCents }, 'buyer');
      }
      return r;
    }) as never);
    const res = await buyer.browser.post(seen(t.code), {});
    vi.restoreAllMocks();
    expect(raced).toBe(true);
    expect((await loadTrade(deps.db, t.code))!.state).toBe('paid');
    expect(res.statusCode).toBe(409);
    expect(errorOf(res)).toBe('wrong-state');
    expect(await delivered(t.code)).toBeNull();
  });

  it("the service worker's account receipt marks only the caller's refund-requested buyer trades", async () => {
    const a = await refundable();
    const b = await refundable();
    await a.seller.browser.post(`/v1/trades/${a.t.code}/events`, { type: 'request-refund' });
    await b.seller.browser.post(`/v1/trades/${b.t.code}/events`, { type: 'request-refund' });
    // The seller of A calling it marks nothing of A (they are not its buyer).
    expect((await a.seller.browser.post('/v1/account/final-alert-seen', {})).statusCode).toBe(204);
    expect(await delivered(a.t.code)).toBeNull();
    expect((await a.buyer.browser.post('/v1/account/final-alert-seen', {})).statusCode).toBe(204);
    expect(await delivered(a.t.code)).toBe(true);
    expect(await delivered(b.t.code)).toBeNull();
  });
});

describe('trade event delivery (tradeEventPublisher)', () => {
  it('a participant event goes live to both sides and is pushed only to the other side', async () => {
    const { seller, buyer, t } = await refundable();
    await seller.browser.post('/v1/account/push', subscription());
    await buyer.browser.post('/v1/account/push', subscription());
    const publish = vi.spyOn(app.events, 'publish');
    const res = await buyer.browser.post(`/v1/trades/${t.code}/events`, { type: 'mark-paid', fiatCents: String(t.fiatCents) });
    expect(res.statusCode).toBe(200);
    expect(publish.mock.calls.map(([id, ev]) => [id, ev])).toEqual([
      [seller.id, { type: 'trade', code: t.code, state: 'paid' }],
      [buyer.id, { type: 'trade', code: t.code, state: 'paid' }],
    ]);
    expect(calls).toHaveLength(1);
    const { rows } = await deps.db.query<{ endpoint: string }>('select endpoint from push_subscriptions where account_id = $1', [seller.id]);
    expect(calls[0]!.subscription.endpoint).toBe(rows[0]!.endpoint);
  });
});
