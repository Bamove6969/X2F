import { createECDH, randomBytes } from 'node:crypto';
import { newTradeCode } from '@x2f/core';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deps } from '../src/app.js';
import type { PushCall, PushTransport } from '../src/push/send.js';
import { loadTrade } from '../src/trades/store.js';
import { driveTo, seedTrade } from './helpers/trades.js';
import { tradeApp } from './helpers/tradeApp.js';

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];
const calls: PushCall[] = [];
let status = 201;
/** When set, the fake push service answers only once this resolves (a slow round-trip). */
let gate: Promise<void> | null = null;
const fakeTransport: PushTransport = async (call) => {
  calls.push(call);
  if (gate) await gate;
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
  gate = null;
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

/** A secured trade whose pay window has passed, so the seller may cancel (no nudge: optional, owner 8 Nov). */
async function refundable() {
  const seller = await trader();
  const buyer = await trader();
  const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
  const t = await driveTo(deps, trade, 'secured');
  setNow(new Date(t.payBy!.getTime() + 60_000));
  return { seller, buyer, t };
}

const errorOf = (res: { json(): unknown }) => (res.json() as { error?: string }).error;
const cancel = (b: { browser: { post(u: string, body: unknown): Promise<{ statusCode: number; json(): unknown }> } }, code: string) =>
  b.browser.post(`/v1/trades/${code}/events`, { type: 'request-refund' });
const markPaid = (b: { browser: { post(u: string, body: unknown): Promise<{ statusCode: number; json(): unknown }> } }, code: string, cents: bigint) =>
  b.browser.post(`/v1/trades/${code}/events`, { type: 'mark-paid', fiatCents: String(cents) });

describe("the seller's cancel after the time to pay (owner 8 Nov, p6-1, p9-2, p9-4)", () => {
  it('starts the refund at once with no nudge and no final alert; the buyer gets the ordinary trade event and push', async () => {
    const { seller, buyer, t } = await refundable();
    await buyer.browser.post('/v1/account/push', subscription());
    const publish = vi.spyOn(app.events, 'publish');
    const res = await cancel(seller, t.code);
    expect(res.statusCode).toBe(200);
    const v = res.json() as { state: string; settling: string | null; nextDeadline: string | null; sellerNudgedAt: string | null };
    expect(v.state).toBe('settling');
    expect(v.settling).toBe('auto-refund');
    expect(v.sellerNudgedAt).toBeNull();
    expect(v.nextDeadline).toBeNull(); // nothing reverts the cancel
    expect('finalAlertAt' in v).toBe(false);
    expect('finalAlertSeenAt' in v).toBe(false);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(publish.mock.calls.map(([id, ev]) => [id, ev])).toEqual([
      [seller.id, { type: 'trade', code: t.code, state: 'settling' }],
      [buyer.id, { type: 'trade', code: t.code, state: 'settling' }],
    ]);
    const { rows } = await deps.db.query<{ final_alert_at: Date | null; final_alert_delivered: boolean | null }>(
      'select final_alert_at, final_alert_delivered from trades where code = $1', [t.code],
    );
    expect(rows[0]).toEqual({ final_alert_at: null, final_alert_delivered: null });
  });

  it('is refused before the time to pay is over (409 too-early), and the final-alert receipt route is gone (404)', async () => {
    const { seller, buyer, t } = await refundable();
    setNow(new Date(t.payBy!.getTime() - 1));
    const early = await cancel(seller, t.code);
    expect(early.statusCode).toBe(409);
    expect(errorOf(early)).toBe('too-early');
    setNow(new Date(t.payBy!.getTime() + 60_000));
    expect((await cancel(seller, t.code)).statusCode).toBe(200);
    expect((await buyer.browser.post(`/v1/trades/${t.code}/final-alert-seen`, {})).statusCode).toBe(404);
  });

  it("Cancel first: the buyer's I've paid right after is refused (409 wrong-state), the refund goes on", async () => {
    const { seller, buyer, t } = await refundable();
    expect((await cancel(seller, t.code)).statusCode).toBe(200);
    const res = await markPaid(buyer, t.code, t.fiatCents);
    expect(res.statusCode).toBe(409);
    expect(errorOf(res)).toBe('wrong-state');
    const after = (await loadTrade(deps.db, t.code))!;
    expect(after.state).toBe('settling');
    expect(after.settling).toBe('auto-refund');
    expect(after.paidAt).toBeNull();
  });

  it("I've paid first, late (after the time to pay, p9-2): the seller's Cancel right after is refused (409 wrong-state)", async () => {
    const { seller, buyer, t } = await refundable();
    expect((await markPaid(buyer, t.code, t.fiatCents)).statusCode).toBe(200);
    const res = await cancel(seller, t.code);
    expect(res.statusCode).toBe(409);
    expect(errorOf(res)).toBe('wrong-state');
    const after = (await loadTrade(deps.db, t.code))!;
    expect(after.state).toBe('paid');
    expect(after.settling).toBeNull();
  });

  it('both taps at the same moment: exactly one wins in the trade row and the trade agrees with the winner', async () => {
    for (let i = 0; i < 6; i++) {
      const { seller, buyer, t } = await refundable();
      const [c, p] = i % 2 === 0
        ? await Promise.all([cancel(seller, t.code), markPaid(buyer, t.code, t.fiatCents)])
        : await Promise.all([markPaid(buyer, t.code, t.fiatCents), cancel(seller, t.code)]).then(([a, b]) => [b, a] as const);
      const codes = [c.statusCode, p.statusCode].sort();
      expect(codes).toEqual([200, 409]);
      const loser = c.statusCode === 409 ? c : p;
      expect(errorOf(loser)).toBe('wrong-state');
      const after = (await loadTrade(deps.db, t.code))!;
      if (c.statusCode === 200) {
        expect(after.state).toBe('settling');
        expect(after.settling).toBe('auto-refund');
        expect(after.paidAt).toBeNull();
      } else {
        expect(after.state).toBe('paid');
        expect(after.settling).toBeNull();
      }
      const ev = await deps.db.query<{ event: { type: string } }>('select event from trade_events where code = $1 order by at, id', [t.code]);
      const types = ev.rows.map((r) => r.event.type);
      expect(types.filter((x) => x === 'request-refund' || x === 'mark-paid')).toHaveLength(1);
    }
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
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(publish.mock.calls.map(([id, ev]) => [id, ev])).toEqual([
      [seller.id, { type: 'trade', code: t.code, state: 'paid' }],
      [buyer.id, { type: 'trade', code: t.code, state: 'paid' }],
    ]);
    expect(calls).toHaveLength(1);
    const { rows } = await deps.db.query<{ endpoint: string }>('select endpoint from push_subscriptions where account_id = $1', [seller.id]);
    expect(calls[0]!.subscription.endpoint).toBe(rows[0]!.endpoint);
  });
});

describe("delivery runs after the actor's response (review 2026-10-27, minor 8)", () => {
  it("the actor's response does not wait on the push round-trip", async () => {
    const { seller, buyer, t } = await refundable();
    await buyer.browser.post('/v1/account/push', subscription());
    let released = false;
    gate = new Promise<void>((r) => {
      // Were delivery awaited inside the request, the response could only arrive after this.
      setTimeout(() => {
        released = true;
        r();
      }, 400);
    });
    const res = await seller.browser.post(`/v1/trades/${t.code}/events`, { type: 'request-refund' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { state: string }).state).toBe('settling');
    expect(released).toBe(false);
    // The push still goes out, after the response.
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await gate;
  });
});
