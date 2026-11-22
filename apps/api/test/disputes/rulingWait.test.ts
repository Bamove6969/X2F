// Ruling-winner reasons (lead 22 Nov; review-lead-fix-ruling-pay, builder's question 1): the
// moderation process reports why a ruling's payout waits on its winner (`ruling-wait`): the winner's
// party is committed to another outcome, or the winner has not taken part (offline, as far as the
// moderator can tell). The API logs each change (`ruling.payout-waiting`, system) and the staff case
// view shows the current one while the trade is disputed. It changes nothing about the payout.
import { createHash } from 'node:crypto';
import { newTradeCode } from '@x2f/core';
import { INTERNAL_AT_HEADER, INTERNAL_SIG_HEADER, internalSignedBytes, signRulingStatement, type RulingStatement, type Trade } from '@x2f/trade';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import sodium from 'libsodium-wrappers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../../src/app.js';
import { NO_MODERATION } from '../../src/disputes/moderationClient.js';
import { buildInternalListener } from '../../src/internal/routes.js';
import { buildStaffApi } from '../../src/staff/app.js';
import { seedAccount } from '../helpers/accounts.js';
import { testApp } from '../helpers/app.js';
import { publishRuling } from '../helpers/disputes.js';
import { STAFF_ORIGIN, StaffBrowser, insertSession, seedStaff } from '../helpers/staffApp.js';
import { driveTo, fakeAddress, seedTrade } from '../helpers/trades.js';

let app: FastifyInstance;
let staffApp: FastifyInstance;
let deps: Deps;
let internal: FastifyInstance;
let modSecret: Uint8Array;
let reqSeq = 0;
let n = 0;
const NOW = new Date('2026-11-22T12:00:00Z');
const ESCROW = fakeAddress();

const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex');
async function signed(path: string, body: unknown): Promise<LightMyRequestResponse> {
  const payload = JSON.stringify(body);
  const at = NOW.getTime() + ++reqSeq;
  const sig = sodium.crypto_sign_detached(internalSignedBytes({ method: 'POST', path, at, bodyHash: sha256Hex(payload) }), modSecret);
  return internal.inject({
    method: 'POST',
    url: path,
    headers: { [INTERNAL_AT_HEADER]: String(at), [INTERNAL_SIG_HEADER]: sodium.to_base64(sig, sodium.base64_variants.ORIGINAL), 'content-type': 'application/json' },
    payload,
  });
}
const report = (body: unknown) => signed('/internal/v1/reports', body);

beforeAll(async () => {
  await sodium.ready;
  ({ app, deps } = await testApp());
  staffApp = await buildStaffApi({ ...deps, staffOrigin: STAFF_ORIGIN, moderation: NO_MODERATION });
  const kp = sodium.crypto_sign_keypair();
  modSecret = kp.privateKey;
  internal = await buildInternalListener({ db: deps.db, modSigningPublic: sodium.to_hex(kp.publicKey), now: () => NOW.getTime(), clock: () => NOW, publish: () => {} });
});
afterAll(async () => {
  await internal.close();
  await staffApp.close();
  await app.close();
});

async function trade(): Promise<Trade> {
  const sellerId = await seedAccount(deps, { loginName: `rw${String(++n).padStart(4, '0')}s` });
  const buyerId = await seedAccount(deps, { loginName: `rw${String(n).padStart(4, '0')}b` });
  const { trade: t } = await seedTrade(deps, { sellerId, buyerId, poster: 'seller' });
  await deps.db.query(`insert into trade_attestations (code, attestation, sig, created_at) values ($1, '{}'::jsonb, 'x', now())`, [t.code]);
  return t;
}

/** A disputed trade with a published round-1 ruling and, unless `statement` is false, the moderator's signed statement kept. */
async function ruled(o: { statement?: boolean } = {}) {
  const t = await trade();
  await driveTo(deps, t, 'settling', ESCROW);
  expect((await report({ kind: 'spend-unshown', trade: t.code })).statusCode).toBe(201);
  const d = await publishRuling(deps, t.code, { outcome: 'release-to-buyer' });
  if (o.statement !== false) {
    const s: RulingStatement = {
      v: 1, trade: t.code, escrowAddress: ESCROW, round: 1, rulingId: d.ruling!.id, outcome: 'release-to-buyer', winner: 'buyer',
      payouts: [{ address: fakeAddress(), amountAtomic: '1000' }], issuedAt: NOW.toISOString(),
    };
    expect((await report({ kind: 'ruling-statement', trade: t.code, statement: s, sig: await signRulingStatement(s, modSecret) })).statusCode).toBe(201);
  }
  return t;
}

const waits = async (code: string) =>
  (await deps.db.query<{ detail: string; actor_kind: string }>(`select detail, actor_kind from activity_log where trade_code = $1 and action = 'ruling.payout-waiting' order by id`, [code])).rows.map((r) => ({
    actor: r.actor_kind,
    ...(JSON.parse(r.detail) as object),
  }));

const caseView = async (code: string) => {
  const mod = await seedStaff(deps, { role: 'senior' });
  const b = new StaffBrowser(staffApp).withSession((await insertSession(deps, mod.id, 'staff')).token);
  const res = await b.get(`/staff/v1/disputes/${code}`);
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { ruling: { payoutWait: { reason: string; since: string } | null } }).ruling;
};

describe('ruling-wait: why a ruling payout waits on its winner', () => {
  it('each change is logged once by the system and shown on the staff case view; a repeat changes nothing; null clears it', async () => {
    const t = await ruled();
    expect((await caseView(t.code)).payoutWait).toBeNull();
    // Nothing reported yet: a clear is a no-op.
    expect((await report({ kind: 'ruling-wait', trade: t.code, reason: null })).statusCode).toBe(201);
    expect(await waits(t.code)).toEqual([]);
    const r = await report({ kind: 'ruling-wait', trade: t.code, reason: 'winner-committed' });
    expect([r.statusCode, r.json()]).toEqual([201, { ok: true }]);
    expect((await report({ kind: 'ruling-wait', trade: t.code, reason: 'winner-committed' })).statusCode).toBe(201);
    expect(await waits(t.code)).toEqual([{ actor: 'system', reason: 'winner-committed' }]);
    expect((await caseView(t.code)).payoutWait).toEqual({ reason: 'winner-committed', since: NOW.toISOString() });
    expect((await report({ kind: 'ruling-wait', trade: t.code, reason: 'winner-offline' })).statusCode).toBe(201);
    expect((await caseView(t.code)).payoutWait).toEqual({ reason: 'winner-offline', since: NOW.toISOString() });
    expect((await report({ kind: 'ruling-wait', trade: t.code, reason: null })).statusCode).toBe(201);
    expect((await caseView(t.code)).payoutWait).toBeNull();
    expect(await waits(t.code)).toEqual([
      { actor: 'system', reason: 'winner-committed' },
      { actor: 'system', reason: 'winner-offline' },
      { actor: 'system', reason: 'none' },
    ]);
  });

  it('refuses a malformed report (400), an unknown trade (404), a trade not disputed (409) and one with no ruling statement (409)', async () => {
    const t = await ruled();
    for (const bad of [
      { kind: 'ruling-wait', trade: t.code },
      { kind: 'ruling-wait', trade: t.code, reason: 'winner-asleep' },
      { kind: 'ruling-wait', trade: t.code, reason: 'winner-committed', extra: 1 },
      { kind: 'ruling-wait', trade: 42, reason: 'winner-committed' },
    ]) {
      const r = await report(bad);
      expect([r.statusCode, r.json()], JSON.stringify(bad)).toEqual([400, { error: 'bad-body' }]);
    }
    expect((await report({ kind: 'ruling-wait', trade: newTradeCode(), reason: 'winner-offline' })).statusCode).toBe(404);
    const open = await trade();
    await driveTo(deps, open, 'secured', ESCROW);
    expect((await report({ kind: 'ruling-wait', trade: open.code, reason: 'winner-offline' })).json()).toEqual({ error: 'wrong-state' });
    const bare = await ruled({ statement: false });
    expect((await report({ kind: 'ruling-wait', trade: bare.code, reason: 'winner-offline' })).json()).toEqual({ error: 'no-statement' });
    expect(await waits(t.code)).toEqual([]);
    expect(await waits(bare.code)).toEqual([]);
  });

  it('the case view shows no wait once the trade is no longer disputed', async () => {
    const t = await ruled();
    expect((await report({ kind: 'ruling-wait', trade: t.code, reason: 'winner-committed' })).statusCode).toBe(201);
    await deps.db.query("update trades set state = 'released' where code = $1", [t.code]);
    expect((await caseView(t.code)).payoutWait).toBeNull();
  });
});
