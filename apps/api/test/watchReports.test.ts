// Plan 3 Task 9: the moderation watcher's reports on the internal listener (setup-done, chain,
// settled, late-funds) and the watch list it reads trade states from.
import { createHash, randomBytes } from 'node:crypto';
import { INTERNAL_AT_HEADER, INTERNAL_SIG_HEADER, internalSignedBytes, type Trade } from '@x2f/trade';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import sodium from 'libsodium-wrappers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { buildInternalListener } from '../src/internal/routes.js';
import { applyEvent, loadTrade } from '../src/trades/store.js';
import { seedAccount } from './helpers/accounts.js';
import { testApp } from './helpers/app.js';
import { driveTo, fakeAddress, seedTrade } from './helpers/trades.js';

let app: FastifyInstance;
let deps: Deps;
let internal: FastifyInstance;
let modSecret: Uint8Array;
let reqSeq = 0;
let n = 0;
const published: Array<{ code: string; type: string }> = [];
const NOW = new Date('2026-10-28T12:00:00Z');

const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex');

async function signed(method: 'GET' | 'POST', path: string, body?: unknown): Promise<LightMyRequestResponse> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const at = NOW.getTime() + ++reqSeq;
  const sig = sodium.crypto_sign_detached(internalSignedBytes({ method, path, at, bodyHash: sha256Hex(payload ?? '') }), modSecret);
  const headers: Record<string, string> = {
    [INTERNAL_AT_HEADER]: String(at),
    [INTERNAL_SIG_HEADER]: sodium.to_base64(sig, sodium.base64_variants.ORIGINAL),
  };
  if (payload !== undefined) headers['content-type'] = 'application/json';
  return internal.inject({ method, url: path, headers, ...(payload === undefined ? {} : { payload }) });
}

const report = (body: unknown) => signed('POST', '/internal/v1/reports', body);

/** A seeded trade; `attested` also stores an attestation row (as Task 8's report would). */
async function trade(attested = true): Promise<Trade> {
  const sellerId = await seedAccount(deps, { loginName: `wr${String(++n).padStart(4, '0')}s` });
  const buyerId = await seedAccount(deps, { loginName: `wr${String(n).padStart(4, '0')}b` });
  const { trade: t } = await seedTrade(deps, { sellerId, buyerId, poster: 'seller' });
  if (attested) {
    await deps.db.query(`insert into trade_attestations (code, attestation, sig, created_at) values ($1, '{}'::jsonb, 'x', now())`, [t.code]);
  }
  return t;
}

beforeAll(async () => {
  await sodium.ready;
  ({ app, deps } = await testApp());
  const kp = sodium.crypto_sign_keypair();
  modSecret = kp.privateKey;
  internal = await buildInternalListener({
    db: deps.db,
    modSigningPublic: sodium.to_hex(kp.publicKey),
    now: () => NOW.getTime(),
    clock: () => NOW,
    publish: (t, e) => {
      published.push({ code: t.code, type: e.type });
    },
  });
});

afterAll(async () => {
  await internal.close();
  await app.close();
});

describe('GET /internal/v1/watch', () => {
  it('lists every attested trade that is open or closed within the last 31 days, with its state', async () => {
    const open = await trade();
    const unattested = await trade(false);
    const old = await trade();
    await deps.db.query(`update trades set state = 'cancelled', closed_at = $2 where code = $1`, [old.code, new Date(NOW.getTime() - 32 * 86_400_000)]);
    const recent = await trade();
    await deps.db.query(`update trades set state = 'cancelled', closed_at = $2 where code = $1`, [recent.code, new Date(NOW.getTime() - 2 * 86_400_000)]);
    const res = await signed('GET', '/internal/v1/watch');
    expect(res.statusCode).toBe(200);
    const trades = (res.json() as { trades: Array<{ trade: string; state: string }> }).trades;
    expect(trades).toContainEqual({ trade: open.code, state: 'setup', settleKind: null, paused: false, finalAlertSeenAt: null, finalAlertAt: null });
    expect(trades).toContainEqual({ trade: recent.code, state: 'cancelled', settleKind: null, paused: false, finalAlertSeenAt: null, finalAlertAt: null });
    expect(trades.map((t) => t.trade)).not.toContain(unattested.code);
    expect(trades.map((t) => t.trade)).not.toContain(old.code);
  });

  it('carries the buyer’s final-alert seen-receipt time only once the receipt is in (Task 10)', async () => {
    const t = await trade();
    await driveTo(deps, t, 'secured');
    await deps.db.query(`update trades set state = 'refund_requested', final_alert_at = $2 where code = $1`, [t.code, NOW]);
    const item = async () =>
      ((await signed('GET', '/internal/v1/watch')).json() as { trades: Array<Record<string, unknown>> }).trades.find((x) => x.trade === t.code);
    expect(await item()).toEqual({ trade: t.code, state: 'refund_requested', settleKind: 'auto-refund', paused: false, finalAlertSeenAt: null, finalAlertAt: NOW.toISOString() });
    // a seen time without the delivered flag is not a receipt (null = false, Task 19 review)
    const seen = new Date(NOW.getTime() + 60_000);
    await deps.db.query(`update trades set final_alert_seen_at = $2 where code = $1`, [t.code, seen]);
    expect(await item()).toEqual({ trade: t.code, state: 'refund_requested', settleKind: 'auto-refund', paused: false, finalAlertSeenAt: null, finalAlertAt: NOW.toISOString() });
    await deps.db.query(`update trades set final_alert_delivered = true where code = $1`, [t.code]);
    expect(await item()).toEqual({ trade: t.code, state: 'refund_requested', settleKind: 'auto-refund', paused: false, finalAlertSeenAt: seen.toISOString(), finalAlertAt: NOW.toISOString() });
    // the API's own final alert as a resume shifted it (Task 10 review I1): the column as stored
    const shifted = new Date(NOW.getTime() + 20 * 60_000);
    await deps.db.query(`update trades set final_alert_at = $2 where code = $1`, [t.code, shifted]);
    expect((await item())?.finalAlertAt).toBe(shifted.toISOString());
  });

  it('names the kind a sweep would settle (settleKindFor) and whether the trade is paused (review I1, M3)', async () => {
    const settling = await trade();
    await deps.db.query(`update trades set state = 'settling', settling = 'release', settle_from = 'paid', paused_at = $2 where code = $1`, [settling.code, NOW]);
    const lapsed = await trade();
    await deps.db.query(`update trades set state = 'lapsed' where code = $1`, [lapsed.code]);
    const res = await signed('GET', '/internal/v1/watch');
    const trades = (res.json() as { trades: unknown[] }).trades;
    expect(trades).toContainEqual({ trade: settling.code, state: 'settling', settleKind: 'release', paused: true, finalAlertSeenAt: null, finalAlertAt: null });
    expect(trades).toContainEqual({ trade: lapsed.code, state: 'lapsed', settleKind: 'lapse-refund', paused: false, finalAlertSeenAt: null, finalAlertAt: null });
  });

  it('refuses an unsigned request', async () => {
    const res = await internal.inject({ method: 'GET', url: '/internal/v1/watch' });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /internal/v1/reports: watcher reports', () => {
  it('setup-done moves an attested trade to funding with the escrow address, and publishes it', async () => {
    const t = await trade();
    const escrowAddress = fakeAddress();
    const res = await report({ kind: 'setup-done', trade: t.code, escrowAddress });
    expect(res.statusCode).toBe(201);
    const after = await loadTrade(deps.db, t.code);
    expect(after).toMatchObject({ state: 'funding', escrowAddress });
    expect(published).toContainEqual({ code: t.code, type: 'setup-done' });
    // Repeating it is refused by the state machine (safe to repeat).
    const again = await report({ kind: 'setup-done', trade: t.code, escrowAddress });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: 'wrong-state' });
  });

  it('refuses any report for a trade that has no attestation (409 not-attested) and an unknown trade (404)', async () => {
    const t = await trade(false);
    const res = await report({ kind: 'setup-done', trade: t.code, escrowAddress: fakeAddress() });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'not-attested' });
    expect((await loadTrade(deps.db, t.code))!.state).toBe('setup');
    const unknown = await report({ kind: 'late-funds', trade: 'ABCD2345EFGH6789' });
    expect([404, 409]).toContain(unknown.statusCode);
  });

  it('chain takes bigints as decimal strings and moves funding to securing', async () => {
    const t = await trade();
    await applyEvent(deps, t.code, { type: 'setup-done', escrowAddress: fakeAddress() }, 'system');
    const res = await report({ kind: 'chain', trade: t.code, receivedAtomic: t.sellerFundsAtomic.toString(), unlockedAtomic: '0', confirmations: 1 });
    expect(res.statusCode).toBe(201);
    expect(await loadTrade(deps.db, t.code)).toMatchObject({ state: 'securing', receivedAtomic: t.sellerFundsAtomic, confirmations: 1 });
  });

  it('refuses malformed reports with 400 and changes nothing', async () => {
    const t = await trade();
    await applyEvent(deps, t.code, { type: 'setup-done', escrowAddress: fakeAddress() }, 'system');
    const bad: unknown[] = [
      { kind: 'chain', trade: t.code, receivedAtomic: 5, unlockedAtomic: '0', confirmations: 1 },
      { kind: 'chain', trade: t.code, receivedAtomic: '05', unlockedAtomic: '0', confirmations: 1 },
      { kind: 'chain', trade: t.code, receivedAtomic: '5', unlockedAtomic: '6', confirmations: 1 },
      { kind: 'chain', trade: t.code, receivedAtomic: '5', unlockedAtomic: '0', confirmations: -1 },
      { kind: 'chain', trade: t.code, receivedAtomic: '5', unlockedAtomic: '0', confirmations: 1, extra: 1 },
      { kind: 'settled', trade: t.code, txHash: 'nothex' },
      { kind: 'setup-done', trade: t.code, escrowAddress: '' },
      { kind: 'late-funds', trade: t.code, kindOf: 'x' },
      { kind: 'spend-unshown', trade: t.code, txHash: 'a'.repeat(64) },
      { kind: 'release-claimed', trade: t.code, from: 'buyer' },
      { kind: 'nope', trade: t.code },
    ];
    for (const b of bad) {
      const res = await report(b);
      expect(res.statusCode, JSON.stringify(b)).toBe(400);
    }
    expect((await loadTrade(deps.db, t.code))!.state).toBe('funding');
  });

  it('settled takes the kind from the trade (settling: release) and records the tx', async () => {
    const t = await trade();
    await driveTo(deps, t, 'settling');
    const txHash = randomBytes(32).toString('hex');
    const res = await report({ kind: 'settled', trade: t.code, txHash });
    expect(res.statusCode).toBe(201);
    expect(await loadTrade(deps.db, t.code)).toMatchObject({ state: 'released', txHash });
  });

  it('settled where the trade alone does not name the kind is refused 409 settle-kind-unknown (the watcher retries)', async () => {
    const t = await trade();
    await driveTo(deps, t, 'secured');
    const res = await report({ kind: 'settled', trade: t.code, txHash: randomBytes(32).toString('hex') });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'settle-kind-unknown' });
    expect((await loadTrade(deps.db, t.code))!.state).toBe('secured');
  });

  it('late-funds after the close escalates the trade to disputed', async () => {
    const t = await trade();
    await driveTo(deps, t, 'released');
    const res = await report({ kind: 'late-funds', trade: t.code });
    expect(res.statusCode).toBe(201);
    expect(await loadTrade(deps.db, t.code)).toMatchObject({ state: 'disputed', closedAt: null });
  });

  it('spend-unshown escalates a settling trade to disputed (Task 9 I/O fallback); outside settling it is wrong-state', async () => {
    const t = await trade();
    await driveTo(deps, t, 'settling');
    const res = await report({ kind: 'spend-unshown', trade: t.code });
    expect(res.statusCode).toBe(201);
    expect(await loadTrade(deps.db, t.code)).toMatchObject({ state: 'disputed', dispute: { by: 'system' }, closedAt: null });
    // repeated: the trade is disputed now, refused wrong-state (the watcher counts that as done)
    const again = await report({ kind: 'spend-unshown', trade: t.code });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: 'wrong-state' });
    const u = await trade();
    await driveTo(deps, u, 'secured');
    const refused = await report({ kind: 'spend-unshown', trade: u.code });
    expect(refused.statusCode).toBe(409);
    expect((await loadTrade(deps.db, u.code))!.state).toBe('secured');
  });

  it('release-claimed records the claim on a settling trade (Task 9 I/O, lead decision b); once; outside settling wrong-state', async () => {
    const t = await trade();
    await driveTo(deps, t, 'settling');
    const res = await report({ kind: 'release-claimed', trade: t.code });
    expect(res.statusCode).toBe(201);
    expect(await loadTrade(deps.db, t.code)).toMatchObject({ state: 'settling', releaseClaimedAt: NOW });
    const again = await report({ kind: 'release-claimed', trade: t.code });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: 'wrong-state' });
    const u = await trade();
    await driveTo(deps, u, 'paid');
    const refused = await report({ kind: 'release-claimed', trade: u.code });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toEqual({ error: 'wrong-state' });
    expect(await loadTrade(deps.db, u.code)).toMatchObject({ state: 'paid', releaseClaimedAt: null });
    const v = await trade(false);
    expect((await report({ kind: 'release-claimed', trade: v.code })).json()).toEqual({ error: 'not-attested' });
  });

  it('alert-unseen, alert-late and refund-unverified escalate a refund_requested trade (Task 10); elsewhere wrong-state', async () => {
    for (const kind of ['alert-unseen', 'alert-late', 'refund-unverified'] as const) {
      const t = await trade();
      await driveTo(deps, t, 'secured');
      await deps.db.query(`update trades set state = 'refund_requested', final_alert_at = $2 where code = $1`, [t.code, NOW]);
      const res = await report({ kind, trade: t.code });
      expect(res.statusCode).toBe(201);
      expect(await loadTrade(deps.db, t.code)).toMatchObject({ state: 'disputed', dispute: { by: 'system' }, closedAt: null });
      expect((await report({ kind, trade: t.code })).json()).toEqual({ error: 'wrong-state' });
      const u = await trade();
      await driveTo(deps, u, 'paid');
      expect((await report({ kind, trade: u.code })).json()).toEqual({ error: 'wrong-state' });
      expect((await report({ kind, trade: u.code, reason: 'x' })).statusCode).toBe(400);
    }
  });
});
