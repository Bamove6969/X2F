// Review p4t22 M2: the after-refund "seller sends XMR" ruling, signed by the moderation key. The API
// keeps the moderation process's statement only when it verifies and names the ruling in force,
// and serves it to the traders; the seller's device verifies it again before it shows the pay form.
import { createHash, randomUUID } from 'node:crypto';
import { INTERNAL_AT_HEADER, INTERNAL_SIG_HEADER, internalSignedBytes, signAfterRefundStatement, type AfterRefundStatement, type Trade } from '@x2f/trade';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import sodium from 'libsodium-wrappers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../../src/app.js';
import { buildInternalListener } from '../../src/internal/routes.js';
import { seedAccount } from '../helpers/accounts.js';
import { testApp } from '../helpers/app.js';
import { appealDirect, publishRuling } from '../helpers/disputes.js';
import { insertSession, SESSION_COOKIE } from '../helpers/staffApp.js';
import { driveTo, fakeAddress, seedTrade } from '../helpers/trades.js';

let app: FastifyInstance;
let deps: Deps;
let internal: FastifyInstance;
let modSecret: Uint8Array;
let reqSeq = 0;
let n = 0;
const NOW = new Date('2026-11-23T12:00:00Z');

const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex');
async function report(body: unknown): Promise<LightMyRequestResponse> {
  const payload = JSON.stringify(body);
  const at = NOW.getTime() + ++reqSeq;
  const path = '/internal/v1/reports';
  const sig = sodium.crypto_sign_detached(internalSignedBytes({ method: 'POST', path, at, bodyHash: sha256Hex(payload) }), modSecret);
  return internal.inject({
    method: 'POST',
    url: path,
    headers: { [INTERNAL_AT_HEADER]: String(at), [INTERNAL_SIG_HEADER]: sodium.to_base64(sig, sodium.base64_variants.ORIGINAL), 'content-type': 'application/json' },
    payload,
  });
}

beforeAll(async () => {
  await sodium.ready;
  ({ app, deps } = await testApp());
  const kp = sodium.crypto_sign_keypair();
  modSecret = kp.privateKey;
  internal = await buildInternalListener({ db: deps.db, modSigningPublic: sodium.to_hex(kp.publicKey), now: () => NOW.getTime(), clock: () => NOW, publish: () => {} });
});
afterAll(async () => {
  await internal.close();
  await app.close();
});

async function trade(): Promise<Trade> {
  const sellerId = await seedAccount(deps, { loginName: `ar${String(++n).padStart(4, '0')}s` });
  const buyerId = await seedAccount(deps, { loginName: `ar${String(n).padStart(4, '0')}b` });
  const { trade: t } = await seedTrade(deps, { sellerId, buyerId, poster: 'seller' });
  await deps.db.query(`insert into trade_attestations (code, attestation, sig, created_at) values ($1, '{}'::jsonb, 'x', now())`, [t.code]);
  return t;
}

/** An after-refund dispute with a published round-1 ruling (`seller-sends-xmr` unless given). */
async function ruled(outcome: 'seller-sends-xmr' | 'no-action' = 'seller-sends-xmr') {
  const t = await trade();
  await driveTo(deps, t, 'settling');
  expect((await report({ kind: 'spend-unshown', trade: t.code })).statusCode).toBe(201);
  await deps.db.query('update disputes set after_refund = true where code = $1', [t.code]);
  const d = await publishRuling(deps, t.code, { outcome });
  return { t, rulingId: d.ruling!.id };
}

const statementFor = (code: string, rulingId: string, o: Partial<AfterRefundStatement> = {}): AfterRefundStatement => ({
  v: 1, kind: 'after-refund', trade: code, round: 1, rulingId, outcome: 'seller-sends-xmr', amountAtomic: '1250000000000',
  buyerPayout: fakeAddress(), issuedAt: NOW.toISOString(), ...o,
});
const post = async (code: string, s: AfterRefundStatement, key = modSecret) => report({ kind: 'after-refund-statement', trade: code, statement: s, sig: await signAfterRefundStatement(s, key) });
const traderGet = async (code: string, side: 'buyer' | 'seller') => {
  const { rows } = await deps.db.query<{ id: string }>(`select ${side}_account_id as id from trades where code = $1`, [code]);
  const { token } = await insertSession(deps, rows[0]!.id, 'trader');
  return app.inject({ method: 'GET', url: `/v1/trades/${code}/after-refund-statement`, cookies: { [SESSION_COOKIE]: token } });
};

describe('the after-refund ruling statement (review p4t22 M2)', () => {
  it('kept when signed by the moderation key for the ruling in force, and served to both traders; 204 before', async () => {
    const { t, rulingId } = await ruled();
    expect((await traderGet(t.code, 'seller')).statusCode).toBe(204);
    const s = statementFor(t.code, rulingId);
    const res = await post(t.code, s);
    expect([res.statusCode, res.json()]).toEqual([201, { ok: true }]);
    expect((await post(t.code, s)).statusCode).toBe(201);
    for (const side of ['seller', 'buyer'] as const) {
      const got = await traderGet(t.code, side);
      expect(got.statusCode, side).toBe(200);
      expect((got.json() as { statement: unknown }).statement).toEqual(s);
    }
    // A stranger is not a participant.
    const stranger = await seedAccount(deps, { loginName: `ar${String(++n).padStart(4, '0')}x` });
    const { token } = await insertSession(deps, stranger, 'trader');
    expect((await app.inject({ method: 'GET', url: `/v1/trades/${t.code}/after-refund-statement`, cookies: { [SESSION_COOKIE]: token } })).statusCode).toBe(404);
  });

  it('refuses another key, another trade, a ruling not in force, another outcome or round, and an altered second statement', async () => {
    const { t, rulingId } = await ruled();
    const other = sodium.crypto_sign_keypair();
    expect((await post(t.code, statementFor(t.code, rulingId), other.privateKey)).json()).toEqual({ error: 'bad-statement' });
    const b = await ruled();
    expect((await post(b.t.code, statementFor(t.code, rulingId))).json()).toEqual({ error: 'wrong-trade' });
    expect((await post(t.code, statementFor(t.code, randomUUID()))).json()).toEqual({ error: 'stale-ruling' });
    expect((await post(t.code, statementFor(t.code, rulingId, { round: 2 }))).json()).toEqual({ error: 'stale-ruling' });
    const noAction = await ruled('no-action');
    expect((await post(noAction.t.code, statementFor(noAction.t.code, noAction.rulingId))).json()).toEqual({ error: 'stale-ruling' });
    expect((await post(t.code, statementFor(t.code, rulingId))).statusCode).toBe(201);
    const altered = await post(t.code, statementFor(t.code, rulingId, { amountAtomic: '1' }));
    expect([altered.statusCode, altered.json()]).toEqual([409, { error: 'statement-conflict' }]);
  });

  it('during an appeal round 1 stays in force; once round 2 decides another outcome, round 1\'s statement is no longer served', async () => {
    const { t, rulingId } = await ruled();
    expect((await post(t.code, statementFor(t.code, rulingId))).statusCode).toBe(201);
    await appealDirect(deps, t.code, 'seller');
    expect((await traderGet(t.code, 'seller')).statusCode).toBe(200);
    await publishRuling(deps, t.code, { outcome: 'no-action' });
    expect((await traderGet(t.code, 'seller')).statusCode).toBe(204);
  });

  it('a decided round 2 that orders the payment gets its own statement', async () => {
    const { t } = await ruled('no-action');
    await appealDirect(deps, t.code, 'buyer');
    const d2 = await publishRuling(deps, t.code, { outcome: 'seller-sends-xmr' });
    const s = statementFor(t.code, d2.ruling!.id, { round: 2 });
    expect((await post(t.code, s)).statusCode).toBe(201);
    expect(((await traderGet(t.code, 'seller')).json() as { statement: unknown }).statement).toEqual(s);
  });
});
