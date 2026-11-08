import { CLIENT_EVENTS, SYSTEM_EVENTS } from '@x2f/trade';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { loadTrade } from '../src/trades/store.js';
import { FIAT, driveTo, seedTrade } from './helpers/trades.js';
import { tradeApp } from './helpers/tradeApp.js';
import type { Browser } from './helpers/totp.js';

let app: FastifyInstance;
let deps: Deps;
let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];

beforeAll(async () => {
  ({ app, deps, trader } = await tradeApp());
});
afterAll(async () => {
  await app.close();
});

type Who = { id: string; browser: Browser };
const events = (code: string) => `/v1/trades/${code}/events`;
const errorOf = (res: { json(): unknown }) => (res.json() as { error?: string }).error;

/** A trade in `state` with a fresh seller (the poster) and buyer. */
async function tradeIn(state: Parameters<typeof driveTo>[2]) {
  const seller = await trader();
  const buyer = await trader();
  const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
  const t = await driveTo(deps, trade, state);
  return { seller, buyer, t };
}

async function eventCount(code: string): Promise<number> {
  const { rows } = await deps.db.query<{ n: string }>('select count(*) as n from trade_events where code = $1', [code]);
  return Number(rows[0]!.n);
}

describe('POST /v1/trades/:code/events', () => {
  it('refuses every system event from a participant with 400 event-not-allowed and changes nothing (P3-C2)', async () => {
    const { seller, buyer, t } = await tradeIn('funding');
    const before = await loadTrade(deps.db, t.code);
    const n = await eventCount(t.code);
    const bodies: Record<string, Record<string, unknown>> = {
      'setup-done': { escrowAddress: '5abc' },
      chain: { receivedAtomic: '1', unlockedAtomic: '1', confirmations: 10 },
      settled: { kind: 'release', txHash: 'ab'.repeat(32) },
    };
    for (const type of SYSTEM_EVENTS) {
      for (const who of [seller, buyer] as Who[]) {
        const res = await who.browser.post(events(t.code), { type, ...bodies[type] });
        expect(res.statusCode, type).toBe(400);
        expect(errorOf(res), type).toBe('event-not-allowed');
      }
    }
    for (const type of ['nonsense', '', 'constructor', '__proto__']) {
      const res = await buyer.browser.post(events(t.code), { type });
      expect(errorOf(res)).toBe('event-not-allowed');
    }
    expect(await loadTrade(deps.db, t.code)).toEqual(before);
    expect(await eventCount(t.code)).toBe(n);
  });

  it('takes `by` from the session, never the body', async () => {
    const { seller, buyer, t } = await tradeIn('secured');
    const res = await buyer.browser.post(events(t.code), { type: 'mark-paid', fiatCents: FIAT.toString(), by: 'seller' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { state: string; role: string }).state).toBe('paid');
    const { rows } = await deps.db.query<{ by: string; event: unknown }>(
      'select by, event from trade_events where code = $1 order by id desc limit 1', [t.code],
    );
    expect(rows[0]).toEqual({ by: 'buyer', event: { type: 'mark-paid', fiatCents: FIAT.toString() } });

    // The seller cannot pose as the buyer to cancel alone.
    const cancel = await seller.browser.post(events(t.code), { type: 'buyer-cancel', by: 'buyer' });
    expect(cancel.statusCode).toBe(409);
    expect(errorOf(cancel)).toBe('wrong-party');
    expect((await loadTrade(deps.db, t.code))!.state).toBe('paid');
  });

  it('accepts every client event type past the whitelist (the machine decides), except open-dispute', async () => {
    const { buyer, t } = await tradeIn('secured');
    for (const type of CLIENT_EVENTS) {
      // open-dispute goes only through POST /v1/trades/:code/dispute (Task 27), so every dispute has its reason.
      if (type === 'mark-paid' || type === 'buyer-cancel' || type === 'open-dispute') continue;
      const res = await buyer.browser.post(events(t.code), { type });
      expect(res.statusCode, type).not.toBe(400);
    }
  });

  it('mark-paid needs fiatCents as a decimal string, and refuses a total other than the current one', async () => {
    const { buyer, t } = await tradeIn('secured');
    const n = await eventCount(t.code);
    for (const fiatCents of [undefined, 41250, '', '-1', '01', '4.1', '0x10', '1e3', ' 41250', '1'.repeat(19)]) {
      const res = await buyer.browser.post(events(t.code), { type: 'mark-paid', ...(fiatCents === undefined ? {} : { fiatCents }) });
      expect(res.statusCode, String(fiatCents)).toBe(400);
    }
    // The total before a growth (or any other one) is refused and nothing changes.
    const before = await loadTrade(deps.db, t.code);
    const res = await buyer.browser.post(events(t.code), { type: 'mark-paid', fiatCents: (FIAT - 1n).toString() });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res)).toBe('total-changed');
    expect(await loadTrade(deps.db, t.code)).toEqual(before);
    expect(await eventCount(t.code)).toBe(n);
  });

  it("refuses mark-paid with 409 too-early until the escrow is secured, 10 of 10 (owner Q12), and records nothing", async () => {
    const { buyer, t } = await tradeIn('securing');
    const before = await loadTrade(deps.db, t.code);
    const n = await eventCount(t.code);
    const res = await buyer.browser.post(events(t.code), { type: 'mark-paid', fiatCents: FIAT.toString() });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res)).toBe('too-early');
    expect(await loadTrade(deps.db, t.code)).toEqual(before);
    expect(await eventCount(t.code)).toBe(n);
  });

  it('maps every rule refusal to 409 with its code', async () => {
    const { seller, t } = await tradeIn('secured');
    const early = await seller.browser.post(events(t.code), { type: 'extend' });
    expect(early.statusCode).toBe(409);
    expect(errorOf(early)).toBe('too-early'); // before payBy
    const f = await tradeIn('funding');
    const wrong = await f.seller.browser.post(events(f.t.code), { type: 'release-started' });
    expect(wrong.statusCode).toBe(409);
    expect(errorOf(wrong)).toBe('wrong-state');
  });

  it('answers 404 to a non-participant, an unknown and a malformed code, and needs a trader session', async () => {
    const { t } = await tradeIn('secured');
    const other = await trader();
    expect((await other.browser.post(events(t.code), { type: 'propose-cancel' })).statusCode).toBe(404);
    expect((await other.browser.post(events('ZZZZ-ZZZZ-ZZZZ-ZZZZ'), { type: 'propose-cancel' })).statusCode).toBe(404);
    expect((await other.browser.post(events('not-a-code'), { type: 'propose-cancel' })).statusCode).toBe(404);
    const staff = await trader('staff');
    const res = await staff.browser.post(events(t.code), { type: 'propose-cancel' });
    expect(res.statusCode).toBe(403);
    expect(errorOf(res)).toBe('wrong-account-kind');
    const anon = await app.inject({ method: 'POST', url: events(t.code), headers: { origin: 'https://x2f.test' }, payload: { type: 'propose-cancel' } });
    expect(anon.statusCode).toBe(401);
    expect((await loadTrade(deps.db, t.code))!.state).toBe('secured');
  });

  it('accepts a code in any spelling normalizeTradeCode accepts', async () => {
    const { buyer, t } = await tradeIn('secured');
    const res = await buyer.browser.post(events(t.code.toLowerCase().replaceAll('-', '')), { type: 'propose-cancel' });
    expect(res.statusCode).toBe(200);
    expect((await loadTrade(deps.db, t.code))!.cancelProposedBy).toBe('buyer');
  });
});
