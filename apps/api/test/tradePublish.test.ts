import { createECDH, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deps } from '../src/app.js';
import type { PushCall, PushTransport } from '../src/push/send.js';
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

describe('trade event delivery (tradeEventPublisher)', () => {
  it('final_alert_delivered is false with no stream and no subscription', async () => {
    const { seller, t } = await refundable();
    expect(await delivered(t.code)).toBeNull();
    const res = await seller.browser.post(`/v1/trades/${t.code}/events`, { type: 'request-refund' });
    expect(res.statusCode).toBe(200);
    expect(await delivered(t.code)).toBe(false);
    expect(calls).toEqual([]);
  });

  it('final_alert_delivered is true when the push service accepts the buyer push, with the generic text', async () => {
    const { seller, buyer, t } = await refundable();
    expect((await buyer.browser.post('/v1/account/push', subscription())).statusCode).toBe(204);
    await seller.browser.post(`/v1/trades/${t.code}/events`, { type: 'request-refund' });
    expect(await delivered(t.code)).toBe(true);
    expect(calls.map((c) => c.payload)).toEqual(['Something changed in a trade on X2F']);
  });

  it('final_alert_delivered stays false when the push service refuses', async () => {
    const { seller, buyer, t } = await refundable();
    await buyer.browser.post('/v1/account/push', subscription());
    status = 500;
    await seller.browser.post(`/v1/trades/${t.code}/events`, { type: 'request-refund' });
    expect(await delivered(t.code)).toBe(false);
  });

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
