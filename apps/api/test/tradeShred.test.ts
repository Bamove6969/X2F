// Plan 7 Task 2, lead follow-up (the moderation-database purge): when the whole-trade purge deletes a
// trade, it leaves a shred order for the moderation service in the same statement (migration 761),
// as purgeChats does for a chat (123). Moderation pulls the orders on GET /internal/v1/trade-shred,
// checks its OWN records before it destroys anything (the order is only a trigger), and reports
// `{ kind: 'trade-shredded', trade }`, which removes the order.
import { createHash } from 'node:crypto';
import { newTradeCode } from '@x2f/core';
import { INTERNAL_AT_HEADER, INTERNAL_SIG_HEADER, internalSignedBytes } from '@x2f/trade';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import sodium from 'libsodium-wrappers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { buildInternalListener } from '../src/internal/routes.js';
import { purgeTrades } from '../src/retention/tradePurge.js';
import { seedAccount } from './helpers/accounts.js';
import { testConfig } from './helpers/app.js';
import { testDb } from './helpers/db.js';
import { seedTrade } from './helpers/trades.js';

const DAY = 86_400_000;
let now = new Date('2026-06-01T12:00:00Z');
let deps: Pick<Deps, 'db' | 'clock' | 'config'>;
let internal: FastifyInstance;
let modSecret: Uint8Array;
let modPublic: string;
let reqSeq = 0;
let n = 0;

const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex');

async function signed(method: 'GET' | 'POST', path: string, body?: unknown, on: FastifyInstance = internal): Promise<LightMyRequestResponse> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const at = now.getTime() + ++reqSeq;
  const sig = sodium.crypto_sign_detached(internalSignedBytes({ method, path, at, bodyHash: sha256Hex(payload ?? '') }), modSecret);
  const headers: Record<string, string> = { [INTERNAL_AT_HEADER]: String(at), [INTERNAL_SIG_HEADER]: sodium.to_base64(sig, sodium.base64_variants.ORIGINAL) };
  if (payload !== undefined) headers['content-type'] = 'application/json';
  return on.inject({ method, url: path, headers, ...(payload === undefined ? {} : { payload }) });
}

beforeAll(async () => {
  await sodium.ready;
  deps = { db: await testDb(), clock: () => now, config: testConfig() };
  const kp = sodium.crypto_sign_keypair();
  modSecret = kp.privateKey;
  modPublic = sodium.to_hex(kp.publicKey);
  internal = await buildInternalListener({ db: deps.db, modSigningPublic: modPublic, now: () => now.getTime(), clock: () => now });
});
afterAll(async () => {
  await internal.close();
  await deps.db.end();
});

const plus = (t: Date, days: number, ms = 0): Date => new Date(t.getTime() + days * DAY + ms);

/** An undisputed trade set straight to released at `closedAt`. */
async function closed(closedAt: Date): Promise<string> {
  const seller = await seedAccount(deps, { loginName: `tsseller${++n}x` });
  const buyer = await seedAccount(deps, { loginName: `tsbuyer${n}x` });
  now = new Date(closedAt.getTime() - DAY);
  const { code } = await seedTrade(deps, { sellerId: seller, buyerId: buyer, poster: 'seller' });
  await deps.db.query(`update trades set state = 'released', closed_at = $2 where code = $1`, [code, closedAt]);
  return code;
}

const orderRows = async (code: string): Promise<Array<{ trade: string; purged_at: Date }>> =>
  (await deps.db.query<{ trade: string; purged_at: Date }>('select trade, purged_at from trade_shred_orders where trade = $1', [code])).rows;

const orders = async (on: FastifyInstance = internal): Promise<Array<{ trade: string; purgedAt: string }>> => {
  const res = await signed('GET', '/internal/v1/trade-shred', undefined, on);
  expect(res.statusCode).toBe(200);
  return (res.json() as { orders: Array<{ trade: string; purgedAt: string }> }).orders;
};

describe('the purge leaves a trade shred order for moderation (761)', () => {
  it('a purged trade gets exactly one order, written with the delete; a trade that is not due gets none', async () => {
    const t0 = new Date('2026-03-01T00:00:00Z');
    const code = await closed(t0);
    const young = await closed(plus(t0, 10));
    const at = plus(t0, 30, 1);
    await purgeTrades(deps.db, at);
    expect((await deps.db.query('select 1 from trades where code = $1', [code])).rowCount).toBe(0);
    expect(await orderRows(code)).toEqual([{ trade: code, purged_at: at }]);
    expect(await orderRows(young)).toEqual([]);
    // Idempotent: a second pass deletes nothing and writes no second order.
    expect(await purgeTrades(deps.db, at)).toBe(0);
    expect(await orderRows(code)).toHaveLength(1);
  });

  it('x2f_purge may insert an order and read only its key; it may neither read the rest nor delete one', async () => {
    const code = newTradeCode();
    const c = await deps.db.connect();
    try {
      await c.query('begin');
      await c.query('set local role x2f_purge');
      await c.query('insert into trade_shred_orders (trade, purged_at) values ($1, now()) on conflict (trade) do nothing', [code]);
      await c.query('savepoint a');
      await expect(c.query('select purged_at from trade_shred_orders')).rejects.toMatchObject({ code: '42501' });
      await c.query('rollback to savepoint a');
      await expect(c.query('delete from trade_shred_orders where trade = $1', [code])).rejects.toMatchObject({ code: '42501' });
    } finally {
      await c.query('rollback');
      c.release();
    }
  });
});

describe('GET /internal/v1/trade-shred and the trade-shredded report', () => {
  it('a purged trade is on the shred list until moderation reports it shredded; a repeat report is still done', async () => {
    const t0 = new Date('2026-04-01T00:00:00Z');
    const code = await closed(t0);
    const at = plus(t0, 31);
    await purgeTrades(deps.db, at);
    now = plus(at, 0, 1000);
    expect(await orders()).toContainEqual({ trade: code, purgedAt: at.toISOString() });
    const done = await signed('POST', '/internal/v1/reports', { kind: 'trade-shredded', trade: code });
    expect(done.statusCode).toBe(201);
    expect((await orders()).map((o) => o.trade)).not.toContain(code);
    expect(await orderRows(code)).toEqual([]);
    expect((await signed('POST', '/internal/v1/reports', { kind: 'trade-shredded', trade: code })).statusCode).toBe(201);
  });

  it('the least recently served order comes first, so an order moderation holds does not keep the rest waiting', async () => {
    const page = await buildInternalListener({ db: deps.db, modSigningPublic: modPublic, now: () => now.getTime(), clock: () => now, workLimit: 1 });
    try {
      await deps.db.query('delete from trade_shred_orders');
      const t0 = new Date('2026-05-01T00:00:00Z');
      const held = await closed(t0);
      const next = await closed(plus(t0, 5));
      await purgeTrades(deps.db, plus(t0, 32));
      await purgeTrades(deps.db, plus(t0, 40));
      now = plus(t0, 40);
      const served: string[] = [];
      for (let i = 0; i < 3; i++) {
        now = new Date(now.getTime() + 1000);
        served.push(...(await orders(page)).map((o) => o.trade));
      }
      expect(served).toEqual([held, next, held]);
    } finally {
      await page.close();
    }
  });

  it('the list and the report are signed like every internal route, and the report takes exactly { kind, trade }', async () => {
    expect((await internal.inject({ method: 'GET', url: '/internal/v1/trade-shred' })).statusCode).toBe(401);
    expect((await internal.inject({ method: 'POST', url: '/internal/v1/reports', payload: { kind: 'trade-shredded', trade: newTradeCode() } })).statusCode).toBe(401);
    for (const body of [{ kind: 'trade-shredded' }, { kind: 'trade-shredded', trade: 'nope' }, { kind: 'trade-shredded', trade: newTradeCode(), extra: 1 }, { kind: 'trade-shredded', trade: 7 }]) {
      expect((await signed('POST', '/internal/v1/reports', body)).statusCode).toBe(400);
    }
  });

  it('a report never touches a trade that still exists (the order is the only thing it removes)', async () => {
    const live = await closed(new Date('2026-05-20T00:00:00Z'));
    expect((await signed('POST', '/internal/v1/reports', { kind: 'trade-shredded', trade: live })).statusCode).toBe(201);
    expect((await deps.db.query('select 1 from trades where code = $1', [live])).rowCount).toBe(1);
  });
});
