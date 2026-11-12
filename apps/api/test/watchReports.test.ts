// Plan 3 Task 9: the moderation watcher's reports on the internal listener (setup-done, chain,
// settled, late-funds) and the watch list it reads trade states from.
import { createHash, randomBytes } from 'node:crypto';
import { newTradeCode } from '@x2f/core';
import { INTERNAL_AT_HEADER, INTERNAL_SIG_HEADER, internalSignedBytes, type Trade } from '@x2f/trade';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import sodium from 'libsodium-wrappers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { buildInternalListener } from '../src/internal/routes.js';
import { loadDispute, startDispute } from '../src/disputes/store.js';
import { runDisputeTimers } from '../src/disputes/timers.js';
import { applyEvent, loadTrade } from '../src/trades/store.js';
import { appealDirect, publishRuling } from './helpers/disputes.js';
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
    expect(trades).toContainEqual({ trade: open.code, chat: null, state: 'setup', settleKind: null, paused: false });
    expect(trades).toContainEqual({ trade: recent.code, chat: null, state: 'cancelled', settleKind: null, paused: false });
    expect(trades.map((t) => t.trade)).not.toContain(unattested.code);
    expect(trades.map((t) => t.trade)).not.toContain(old.code);
  });

  it("shows the seller's cancel as settling/auto-refund, with no final-alert fields (owner 8 Nov; Task 10)", async () => {
    const t = await trade();
    await driveTo(deps, t, 'secured');
    // An old row's retired final-alert columns are never shown.
    await deps.db.query(
      `update trades set state = 'settling', settling = 'auto-refund', settle_from = 'secured', final_alert_at = $2, final_alert_seen_at = $2, final_alert_delivered = true where code = $1`,
      [t.code, NOW],
    );
    const item = async () =>
      ((await signed('GET', '/internal/v1/watch')).json() as { trades: Array<Record<string, unknown>> }).trades.find((x) => x.trade === t.code);
    expect(await item()).toEqual({ trade: t.code, chat: null, state: 'settling', settleKind: 'auto-refund', paused: false });
  });

  it('names the kind a sweep would settle (settleKindFor) and whether the trade is paused (review I1, M3)', async () => {
    const settling = await trade();
    await deps.db.query(`update trades set state = 'settling', settling = 'release', settle_from = 'paid', paused_at = $2 where code = $1`, [settling.code, NOW]);
    const lapsed = await trade();
    await deps.db.query(`update trades set state = 'lapsed' where code = $1`, [lapsed.code]);
    const res = await signed('GET', '/internal/v1/watch');
    const trades = (res.json() as { trades: unknown[] }).trades;
    expect(trades).toContainEqual({ trade: settling.code, chat: null, state: 'settling', settleKind: 'release', paused: true });
    expect(trades).toContainEqual({ trade: lapsed.code, chat: null, state: 'lapsed', settleKind: 'lapse-refund', paused: false });
  });

  it('an open trade shows paused as soon as site maintenance is on, before the timer loop pauses it (owner rule g62)', async () => {
    const open = await trade();
    const closed = await trade();
    await deps.db.query(`update trades set state = 'cancelled', closed_at = $2 where code = $1`, [closed.code, new Date(NOW.getTime() - 86_400_000)]);
    const item = async (code: string) =>
      ((await signed('GET', '/internal/v1/watch')).json() as { trades: Array<Record<string, unknown>> }).trades.find((x) => x.trade === code);
    expect((await item(open.code))?.paused).toBe(false);
    await deps.db.query("update site_flags set maintenance_since = $1, maintenance_kind = 'unplanned'", [NOW]);
    try {
      expect((await item(open.code))?.paused).toBe(true);
      // a closed trade has no timer to stop (and the timer loop never pauses it)
      expect((await item(closed.code))?.paused).toBe(false);
    } finally {
      await deps.db.query('update site_flags set maintenance_since = null, maintenance_kind = null');
    }
    expect((await item(open.code))?.paused).toBe(false);
  });

  it('names the chat linked to each trade, or null (chat shred review I1)', async () => {
    const linked = await trade();
    const alone = await trade();
    const chat = newTradeCode();
    await deps.db.query(
      'insert into chats (code, offer_id, buyer_account_id, seller_account_id, trade_code, created_at) values ($1, $2, $3, $4, $5, $6)',
      [chat, linked.offerId, linked.buyerId, linked.sellerId, linked.code, NOW],
    );
    const trades = ((await signed('GET', '/internal/v1/watch')).json() as { trades: Array<{ trade: string; chat: string | null }> }).trades;
    expect(trades.find((x) => x.trade === linked.code)?.chat).toBe(chat);
    expect(trades.find((x) => x.trade === alone.code)?.chat).toBeNull();
  });

  it('lead review 8 Nov C2: a trade with an open held_trades row shows paused (G7: the moderator decides), its release shows it again', async () => {
    const t = await trade();
    const { rows } = await deps.db.query<{ seller_account_id: string }>('select seller_account_id from trades where code = $1', [t.code]);
    const item = async () =>
      ((await signed('GET', '/internal/v1/watch')).json() as { trades: Array<Record<string, unknown>> }).trades.find((x) => x.trade === t.code);
    expect((await item())?.paused).toBe(false);
    await deps.db.query(`insert into held_trades (code, account_id, action, held_at) values ($1, $2, 'pause', $3)`, [t.code, rows[0]!.seller_account_id, NOW]);
    expect((await item())?.paused).toBe(true);
    await deps.db.query('update held_trades set released_at = $2 where code = $1', [t.code, NOW]);
    expect((await item())?.paused).toBe(false);
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
      { kind: 'settled', trade: t.code, txHash: 'nothex', settleKind: 'release' },
      // Security review 7 Nov, finding 3: the watcher names the kind it counted the sweep for.
      { kind: 'settled', trade: t.code, txHash: 'a'.repeat(64) },
      { kind: 'settled', trade: t.code, txHash: 'a'.repeat(64), settleKind: 'nope' },
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
    const res = await report({ kind: 'settled', trade: t.code, txHash, settleKind: 'release' });
    expect(res.statusCode).toBe(201);
    expect(await loadTrade(deps.db, t.code)).toMatchObject({ state: 'released', txHash });
  });

  it('settled naming another kind than the trade\'s is refused 409 settle-kind-changed (security review 7 Nov, finding 3)', async () => {
    const t = await trade();
    await driveTo(deps, t, 'settling');
    const res = await report({ kind: 'settled', trade: t.code, txHash: randomBytes(32).toString('hex'), settleKind: 'buyer-cancel' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'settle-kind-changed' });
    expect((await loadTrade(deps.db, t.code))!.state).toBe('settling');
  });

  it('a kind that changes while the report waits for the trade\'s lock is refused inside the transaction (finding 3)', async () => {
    const t = await trade();
    await driveTo(deps, t, 'settling');
    const c = await deps.db.connect();
    try {
      await c.query('begin');
      await c.query('select 1 from trades where code = $1 for update', [t.code]);
      const pending = report({ kind: 'settled', trade: t.code, txHash: randomBytes(32).toString('hex'), settleKind: 'release' });
      // The report passed the check before the lock and now waits for the row.
      await expect.poll(async () => (await deps.db.query(`select count(*)::int as n from pg_locks where not granted and locktype in ('transactionid', 'tuple')`)).rows[0].n).toBeGreaterThan(0);
      // Meanwhile the signing window reverted and the buyer cancelled: the trade now settles as buyer-cancel.
      await c.query(`update trades set settling = 'buyer-cancel' where code = $1`, [t.code]);
      await c.query('commit');
      const res = await pending;
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: 'settle-kind-changed' });
    } finally {
      c.release();
    }
    expect(await loadTrade(deps.db, t.code)).toMatchObject({ state: 'settling', settling: 'buyer-cancel', txHash: null });
  });

  it('settled with no kind named (null) is refused 409 settle-kind-unknown (the watcher retries)', async () => {
    const t = await trade();
    await driveTo(deps, t, 'settling');
    const res = await report({ kind: 'settled', trade: t.code, txHash: randomBytes(32).toString('hex'), settleKind: null });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'settle-kind-unknown' });
  });

  it("a buyer's dispute on the seller's cancel: the refund that lands anyway is recorded and the dispute becomes after-refund (review I1, 8 Nov)", async () => {
    const t = await trade();
    const secured = await driveTo(deps, t, 'secured');
    const later = (ms: number) => ({ db: deps.db, clock: () => new Date(secured.payBy!.getTime() + ms) });
    await applyEvent(later(60_000), t.code, { type: 'request-refund' }, 'seller');
    // The buyer disputes at once (p9-2), as the dispute route does: the trade and the row together.
    await applyEvent(later(90_000), t.code, { type: 'open-dispute' }, 'buyer', async (client, prev, _next, now) => {
      await startDispute(client, prev, { openedBy: 'buyer', reason: 'paid', note: '', afterRefund: prev.state === 'refunded', now, prices: null });
    });
    expect(await loadDispute(deps.db, t.code)).toMatchObject({ afterRefund: false });
    // The moderator had already handed the refund out: it lands, and the watcher reports it.
    const watch = await signed('GET', '/internal/v1/watch');
    expect((watch.json() as { trades: { trade: string; settleKind: string | null }[] }).trades.find((x) => x.trade === t.code)?.settleKind).toBe('auto-refund');
    const txHash = randomBytes(32).toString('hex');
    const res = await report({ kind: 'settled', trade: t.code, txHash, settleKind: 'auto-refund' });
    expect(res.statusCode).toBe(201);
    expect(await loadTrade(deps.db, t.code)).toMatchObject({ state: 'disputed', settling: 'auto-refund', txHash, closedAt: null, dispute: { by: 'buyer' } });
    const d = await loadDispute(deps.db, t.code);
    expect(d).toMatchObject({ afterRefund: true, status: 'open' });
    // The after-refund remedy is now on offer: the seller is asked to send the XMR as agreed.
    expect((await publishRuling(deps, t.code, { outcome: 'seller-sends-xmr' })).ruling?.outcome).toBe('seller-sends-xmr');
    // The same report again is a no-op the watcher counts as done; the dispute stays as it is.
    expect((await report({ kind: 'settled', trade: t.code, txHash, settleKind: 'auto-refund' })).statusCode).toBe(201);
    expect(await loadTrade(deps.db, t.code)).toMatchObject({ state: 'disputed', txHash, closedAt: null });
  });

  it("a refund held back until an escrow ruling is published: the case goes to staff, never closes with nothing owed (re-verify 43fbbb2f, R-I1)", async () => {
    const owner = (await deps.db.query<{ id: string }>("select id from accounts where kind = 'owner' and disabled_at is null")).rows[0]?.id
      ?? (await seedAccount(deps, { loginName: 'wrowner1', kind: 'owner' }));
    const t = await trade();
    const secured = await driveTo(deps, t, 'secured');
    const later = (ms: number) => ({ db: deps.db, clock: () => new Date(secured.payBy!.getTime() + ms) });
    await applyEvent(later(60_000), t.code, { type: 'request-refund' }, 'seller');
    await applyEvent(later(90_000), t.code, { type: 'open-dispute' }, 'buyer', async (client, prev, _next, now) => {
      await startDispute(client, prev, { openedBy: 'buyer', reason: 'paid', note: '', afterRefund: prev.state === 'refunded', now, prices: null });
    });
    // The seller's device stalls the refund build; the moderator rules from the escrow first.
    const ruled = await publishRuling(deps, t.code, { outcome: 'release-to-buyer' });
    expect(ruled).toMatchObject({ status: 'published', afterRefund: false });
    // Then the seller sends the set: the refund lands and the watcher reports it.
    const txHash = randomBytes(32).toString('hex');
    const res = await report({ kind: 'settled', trade: t.code, txHash, settleKind: 'auto-refund' });
    expect(res.statusCode).toBe(201);
    expect(await loadTrade(deps.db, t.code)).toMatchObject({ state: 'disputed', settling: 'auto-refund', txHash, closedAt: null });
    // The ruling is not quietly turned into an after-refund one...
    expect(await loadDispute(deps.db, t.code)).toMatchObject({ afterRefund: false, status: 'published' });
    // ...the case is raised for staff to re-rule (the seller sends the XMR): logged and the owner alerted.
    const logged = await deps.db.query<{ detail: string }>(
      `select detail from activity_log where trade_code = $1 and action = 'dispute.refund-after-ruling'`,
      [t.code],
    );
    expect(logged.rows.map((r) => JSON.parse(r.detail))).toEqual([{ seq: ruled.seq, status: 'published' }]);
    const alerts = await deps.db.query<{ detail: Record<string, unknown> }>(
      `select detail from alerts where account_id = $1 and kind = 'dispute-refund-after-ruling'`,
      [owner],
    );
    expect(alerts.rows.map((r) => r.detail)).toEqual([{ trade: t.code, seq: ruled.seq }]);
    // The appeal window ends: the case is final and waits for a person, it does not close.
    const afterWindow = new Date(ruled.appealEndsAt!.getTime() + 1);
    await runDisputeTimers({ db: deps.db, clock: () => afterWindow });
    expect(await loadDispute(deps.db, t.code)).toMatchObject({ status: 'final', afterRefund: false });
    expect((await deps.db.query('select closed_at from disputes where code = $1', [t.code])).rows).toEqual([{ closed_at: null }]);
    // The same report again raises nothing new.
    expect((await report({ kind: 'settled', trade: t.code, txHash, settleKind: 'auto-refund' })).statusCode).toBe(201);
    expect((await deps.db.query(`select 1 from activity_log where trade_code = $1 and action = 'dispute.refund-after-ruling'`, [t.code])).rows).toHaveLength(1);
  });

  it("a dispute on any other settlement is not touched by a refund that lands (only the seller's cancel)", async () => {
    // A release whose spend the moderator never saw: escalated from settling, `settling` stays 'release'.
    const t = await trade();
    await driveTo(deps, t, 'settling');
    expect((await report({ kind: 'spend-unshown', trade: t.code })).statusCode).toBe(201);
    expect(await loadTrade(deps.db, t.code)).toMatchObject({ state: 'disputed', settling: 'release' });
    for (const settleKind of ['auto-refund', 'release'] as const) {
      const res = await report({ kind: 'settled', trade: t.code, txHash: randomBytes(32).toString('hex'), settleKind });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: 'settle-kind-unknown' });
    }
    expect(await loadTrade(deps.db, t.code)).toMatchObject({ state: 'disputed', settling: 'release', txHash: null });
    expect(await loadDispute(deps.db, t.code)).toMatchObject({ afterRefund: false });
  });

  it('settled where the trade alone does not name the kind is refused 409 settle-kind-unknown (the watcher retries)', async () => {
    const t = await trade();
    await driveTo(deps, t, 'secured');
    const res = await report({ kind: 'settled', trade: t.code, txHash: randomBytes(32).toString('hex'), settleKind: 'release' });
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

  it("refund-unverified escalates the seller's cancel (settling/auto-refund, Task 10); elsewhere wrong-state", async () => {
    const t = await trade();
    await driveTo(deps, t, 'secured');
    await deps.db.query(`update trades set state = 'settling', settling = 'auto-refund', settle_from = 'secured' where code = $1`, [t.code]);
    const res = await report({ kind: 'refund-unverified', trade: t.code });
    expect(res.statusCode).toBe(201);
    expect(await loadTrade(deps.db, t.code)).toMatchObject({ state: 'disputed', dispute: { by: 'system' }, closedAt: null });
    expect((await report({ kind: 'refund-unverified', trade: t.code })).json()).toEqual({ error: 'wrong-state' });
    const u = await trade();
    await driveTo(deps, u, 'paid');
    expect((await report({ kind: 'refund-unverified', trade: u.code })).json()).toEqual({ error: 'wrong-state' });
    expect((await report({ kind: 'refund-unverified', trade: u.code, reason: 'x' })).statusCode).toBe(400);
  });

  it('the retired final-alert reports are refused (400): the moderator no longer sends them (owner 8 Nov)', async () => {
    const t = await trade();
    await driveTo(deps, t, 'secured');
    await deps.db.query(`update trades set state = 'settling', settling = 'auto-refund', settle_from = 'secured' where code = $1`, [t.code]);
    for (const kind of ['alert-unseen', 'alert-late']) expect((await report({ kind, trade: t.code })).statusCode).toBe(400);
    expect((await loadTrade(deps.db, t.code))!.state).toBe('settling');
  });
});

// Plan 4 Task 14, R-M2 (NEEDS_PLAN_4_RULING_PAYOUT): the moderation process executed a round-1
// escrow ruling (mod-built, the winner co-signed) and its watcher reports the sweep with the ruling's
// own kind. The API applies it in one transaction: the trade released (dispute-buyer) or refunded
// (dispute-seller), the dispute's `executed` (it closes once final: the appeal window still runs,
// A1 dropped), `ruling.executed` in the log, the fee booked for a release only.
describe('a ruling\'s payout reported by the watcher (Plan 4 Task 14, R-M2)', () => {
  /** An attested trade disputed from settling (the system escalation opens the dispute row), with a round-1 ruling published. */
  async function ruled(outcome: 'release-to-buyer' | 'refund-to-seller' | 'seller-sends-xmr') {
    const t = await trade();
    await driveTo(deps, t, 'settling');
    expect((await report({ kind: 'spend-unshown', trade: t.code })).statusCode).toBe(201);
    // An after-refund ruling needs an after-refund dispute (the API marks one when a refund lands first).
    if (outcome === 'seller-sends-xmr') await deps.db.query('update disputes set after_refund = true where code = $1', [t.code]);
    const d = await publishRuling(deps, t.code, { outcome });
    return { t, d };
  }
  const executedLog = async (code: string) =>
    (await deps.db.query<{ detail: string }>(`select detail from activity_log where trade_code = $1 and action = 'ruling.executed' order by id`, [code])).rows.map((r) => JSON.parse(r.detail));
  const booked = async (code: string) => (await deps.db.query("select 1 from revenue_booked where trade_code = $1 and kind = 'fee'", [code])).rows.length;

  it('release to the buyer: the trade is released, the dispute executed (closed once final), ruling.executed logged, the fee booked', async () => {
    const { t, d } = await ruled('release-to-buyer');
    const txHash = randomBytes(32).toString('hex');
    const res = await report({ kind: 'settled', trade: t.code, txHash, settleKind: 'dispute-buyer' });
    expect([res.statusCode, res.json()]).toEqual([201, { ok: true }]);
    expect(await loadTrade(deps.db, t.code)).toMatchObject({ state: 'released', settling: null, txHash, closedAt: NOW });
    expect(await loadDispute(deps.db, t.code)).toMatchObject({ status: 'published', executedAt: NOW });
    expect(await executedLog(t.code)).toEqual([{ rulingId: d.ruling!.id, txHash }]);
    expect(await booked(t.code)).toBe(1);
    // The appeal window ends: the case is final and, the payout seen, closed.
    await runDisputeTimers({ db: deps.db, clock: () => new Date(d.appealEndsAt!.getTime() + 1) });
    expect(await loadDispute(deps.db, t.code)).toMatchObject({ status: 'closed' });
  });

  it('refund to the seller: the trade is refunded and no fee is booked (a full reversal, owner g63)', async () => {
    const { t, d } = await ruled('refund-to-seller');
    const txHash = randomBytes(32).toString('hex');
    expect((await report({ kind: 'settled', trade: t.code, txHash, settleKind: 'dispute-seller' })).statusCode).toBe(201);
    expect(await loadTrade(deps.db, t.code)).toMatchObject({ state: 'refunded', settling: null, txHash, closedAt: NOW });
    expect(await loadDispute(deps.db, t.code)).toMatchObject({ executedAt: NOW });
    expect(await executedLog(t.code)).toEqual([{ rulingId: d.ruling!.id, txHash }]);
    expect(await booked(t.code)).toBe(0);
  });

  it('the same report again changes nothing; another tx for the paid-out escrow is refused', async () => {
    const { t } = await ruled('release-to-buyer');
    const txHash = randomBytes(32).toString('hex');
    expect((await report({ kind: 'settled', trade: t.code, txHash, settleKind: 'dispute-buyer' })).statusCode).toBe(201);
    const again = await report({ kind: 'settled', trade: t.code, txHash, settleKind: 'dispute-buyer' });
    expect(again.statusCode).toBe(201);
    expect((await executedLog(t.code))).toHaveLength(1);
    expect(await booked(t.code)).toBe(1);
    const other = await report({ kind: 'settled', trade: t.code, txHash: randomBytes(32).toString('hex'), settleKind: 'dispute-buyer' });
    expect([other.statusCode, other.json()]).toEqual([409, { error: 'wrong-state' }]);
    expect(await loadTrade(deps.db, t.code)).toMatchObject({ state: 'released', txHash });
  });

  it('a kind that does not match the published ruling\'s payouts is refused, and nothing changes', async () => {
    const { t } = await ruled('release-to-buyer');
    const res = await report({ kind: 'settled', trade: t.code, txHash: randomBytes(32).toString('hex'), settleKind: 'dispute-seller' });
    expect([res.statusCode, res.json()]).toEqual([409, { error: 'settle-kind-changed' }]);
    expect(await loadTrade(deps.db, t.code)).toMatchObject({ state: 'disputed', txHash: null });
    expect(await loadDispute(deps.db, t.code)).toMatchObject({ executedAt: null });
    expect(await executedLog(t.code)).toEqual([]);
  });

  it('no escrow payout to record: no ruling yet, an after-refund ruling, or a trade not disputed (settle-kind-unknown)', async () => {
    const open = await trade();
    await driveTo(deps, open, 'settling');
    expect((await report({ kind: 'spend-unshown', trade: open.code })).statusCode).toBe(201);
    const afterRefund = await ruled('seller-sends-xmr');
    const settling = await trade();
    await driveTo(deps, settling, 'settling');
    for (const [code, kind] of [[open.code, 'dispute-buyer'], [afterRefund.t.code, 'dispute-buyer'], [settling.code, 'dispute-buyer']] as const) {
      const res = await report({ kind: 'settled', trade: code, txHash: randomBytes(32).toString('hex'), settleKind: kind });
      expect([res.statusCode, res.json()], code).toEqual([409, { error: 'settle-kind-unknown' }]);
    }
    expect(await loadTrade(deps.db, settling.code)).toMatchObject({ state: 'settling', txHash: null });
  });

  it('after an appeal, round 1\'s payout is still recorded against round 1 (Note 2026-10-30 M3); the appeal goes on', async () => {
    const { t, d } = await ruled('release-to-buyer');
    await appealDirect(deps, t.code, 'seller');
    const txHash = randomBytes(32).toString('hex');
    expect((await report({ kind: 'settled', trade: t.code, txHash, settleKind: 'dispute-buyer' })).statusCode).toBe(201);
    expect(await loadTrade(deps.db, t.code)).toMatchObject({ state: 'released', txHash });
    expect(await loadDispute(deps.db, t.code)).toMatchObject({ status: 'appealed', executedAt: NOW });
    expect(await executedLog(t.code)).toEqual([{ rulingId: d.ruling!.id, txHash }]);
  });
});
