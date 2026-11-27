// Owner decision, 26 Nov 2026 5:43 PM (docs/lien-recovery.md "Grace: 7 days to pay the agreed way"),
// with the owner's additions of 5:51 PM (the collecting share chosen with "Collect now") and 5:53 PM
// (a lower share is approved by a senior without a key tap, after reading the dispute's chat).
// Real Postgres, the real propose route.
import { createHash, randomUUID } from 'node:crypto';
import { LIEN_GRACE_DAYS, LIEN_LAPSE_ESCALATE_HOURS, LIEN_RATE_REASON_PREFILL, evidenceSha256, type KeyTapIntent } from '@x2f/staff';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../../src/app.js';
import { NO_MODERATION } from '../../src/disputes/moderationClient.js';
import { pushRateDeciders, runLienGraceEscalations } from '../../src/disputes/lienGrace.js';
import { pickRecovery } from '../../src/disputes/recovery.js';
import { appendLog } from '../../src/log/append.js';
import { startDispute } from '../../src/disputes/store.js';
import { disputeTimerJob } from '../../src/disputes/timers.js';
import { parseKeyTapIntent } from '../../src/staff/keyTap.js';
import { buildStaffApi } from '../../src/staff/app.js';
import { STAFF_ORIGIN, StaffBrowser, insertSession, seedStaff, seedTap } from '../helpers/staffApp.js';
import { tradeApp } from '../helpers/tradeApp.js';
import { AMOUNT, XMR, driveTo, seedTrade } from '../helpers/trades.js';

const START = new Date('2026-11-26T12:00:00Z');
const H = 3_600_000;
const DAY = 24 * H;
const REASON = "The buyer reversed the PayPal payment after the XMR was released to them.";
const EVIDENCE = ['The trade chat', 'PayPal reversal notice'];
const METHOD = 'A new PayPal payment of $120 to the same PayPal account';

let traderApp: FastifyInstance;
let staffApp: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let newTrader: Awaited<ReturnType<typeof tradeApp>>['trader'];
let ownerId: string | null = null;

beforeAll(async () => {
  const t = await tradeApp();
  ({ app: traderApp, deps, setNow } = t);
  newTrader = t.trader;
  staffApp = await buildStaffApi({ ...deps, staffOrigin: STAFF_ORIGIN, moderation: NO_MODERATION, traderEvents: traderApp.events });
  await deps.db.query('update site_flags set liens_enabled = true');
});
afterAll(async () => {
  await staffApp.close();
  await traderApp.close();
});

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const errorOf = (res: { body: string }) => (res.body === '' ? undefined : (JSON.parse(res.body) as { error?: string }).error);

async function staff(role: 'mod' | 'senior' | 'owner') {
  const s = role === 'owner' ? { id: (ownerId ??= (await seedStaff(deps, { role })).id) } : await seedStaff(deps, { role });
  return { id: s.id, b: new StaffBrowser(staffApp).withSession((await insertSession(deps, s.id, 'staff')).token) };
}

/** A refunded trade the buyer disputed; the seller is the one a `seller-sends-xmr` ruling liens. */
async function disputed() {
  setNow(START);
  const seller = await newTrader();
  const buyer = await newTrader();
  const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'buyer' });
  const t = await driveTo(deps, trade, 'paid');
  const client = await deps.db.connect();
  try {
    await client.query('begin');
    await startDispute(client, t, { openedBy: 'buyer', reason: 'paid', note: '', afterRefund: true, now: START, prices: null });
    await client.query('commit');
  } finally {
    client.release();
  }
  return { seller, buyer, code: t.code };
}

/** The moderator takes the case and rules `seller-sends-xmr` (a lien on the seller) with `lienPlan`. */
async function ruled(lienPlan?: unknown) {
  const d = await disputed();
  const mod = await staff('mod');
  expect((await mod.b.post(`/staff/v1/disputes/${d.code}/take`, {})).statusCode).toBe(200);
  const rulingId = randomUUID();
  const intent: KeyTapIntent = {
    kind: 'ruling', step: 'propose', rulingId, code: d.code, round: 1, outcome: 'seller-sends-xmr', accountAction: { kind: 'none' },
    amountAtomic: AMOUNT.toString(), reasonSha256: sha(REASON), evidenceSha256: evidenceSha256(EVIDENCE), round1Id: null,
  };
  const tapId = await seedTap(deps, mod.id, intent);
  const res = await mod.b.post(`/staff/v1/disputes/${d.code}/rulings`, {
    rulingId, outcome: 'seller-sends-xmr', accountAction: { kind: 'none' }, reason: REASON, evidence: EVIDENCE, tapId, ...(lienPlan === undefined ? {} : { lienPlan }),
  });
  return { ...d, mod, res, tapId };
}

interface LienRow {
  id: string; status: string; ruled_by: string | null; grace_method: string | null; grace_until: Date | null; grace_lapsed_at: Date | null;
  collect_started_at: Date | null; repaid_off_platform_at: Date | null; recovery_rate_bps: number; debtor: string; creditor: string;
}
async function lienOf(code: string): Promise<LienRow> {
  const { rows } = await deps.db.query<LienRow>(
    `select id::text, status, ruled_by::text, grace_method, grace_until, grace_lapsed_at, collect_started_at, repaid_off_platform_at, recovery_rate_bps,
            debtor_account_id::text as debtor, creditor_account_id::text as creditor from liens where from_code = $1`,
    [code],
  );
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

/** What a 1 XMR buy by the debtor would reserve now (the creditor has a signed address). */
async function reserveFor(l: LienRow): Promise<bigint> {
  await deps.db.query(
    `update liens set creditor_address = $2, creditor_address_statement = '{}'::jsonb, creditor_address_sig = repeat('0', 128) where id = $1 and creditor_address is null and status in ('active', 'suspended')`,
    [l.id, `5${randomUUID().replaceAll('-', '')}`],
  );
  const other = await newTrader();
  const r = await pickRecovery(deps.db, { buyerId: l.debtor, sellerId: other.id, proceedsAtomic: XMR, ownAddresses: [], now: deps.clock() }, false);
  return r?.amountAtomic ?? 0n;
}

/** A fresh staff session after a jump in time (a staff session lasts hours, not days). */
async function fresh(s: { id: string; b: StaffBrowser }): Promise<void> {
  s.b = new StaffBrowser(staffApp).withSession((await insertSession(deps, s.id, 'staff')).token);
}

const tick = () => disputeTimerJob().run(deps.db, deps.clock());
/** The case's logged chat read by staff member `id` on trade `code` at `at` (as POST /staff/v1/disputes/:code/chat logs it). */
async function logAs(id: string, code: string, at: Date): Promise<void> {
  const c = await deps.db.connect();
  try {
    await appendLog(c, { at, actor: { kind: 'staff', id, role: 'senior' }, tradeCode: code, action: 'chat.read', detail: {} });
  } finally {
    c.release();
  }
}
const logsOf = async (action: string) =>
  (await deps.db.query<{ detail: string; actor_kind: string }>('select detail, actor_kind from activity_log where action = $1 order by id', [action])).rows;

describe('the moderator chooses how a ruled lien is paid', () => {
  it('"Collect now" with no choice sent: recovery starts at once at 100%, as before', async () => {
    const r = await ruled();
    expect(r.res.statusCode, r.res.body).toBe(200);
    const l = await lienOf(r.code);
    expect(l).toMatchObject({ status: 'active', grace_method: null, grace_until: null, ruled_by: r.mod.id, recovery_rate_bps: 10_000 });
    expect(await reserveFor(l)).toBeGreaterThan(0n);
  });

  it('"7 days to pay the agreed way": nothing is reserved during the grace; the deadline and method are on the lien and both traders see them', async () => {
    const r = await ruled({ mode: 'grace', method: `  ${METHOD} ` });
    expect(r.res.statusCode, r.res.body).toBe(200);
    const l = await lienOf(r.code);
    expect(l.grace_method).toBe(METHOD);
    expect(l.grace_until!.getTime()).toBe(START.getTime() + LIEN_GRACE_DAYS * DAY);
    expect(await reserveFor(l)).toBe(0n);
    expect((await logsOf('lien.grace-started')).map((e) => JSON.parse(e.detail) as unknown)).toContainEqual({ lienId: l.id, graceUntil: l.grace_until!.toISOString() });
    // The agreed method never goes into the log.
    for (const e of await logsOf('lien.grace-started')) expect(e.detail).not.toContain('PayPal');

    const debtorView = (await r.seller.browser.get('/v1/account/liens')).json() as { owes: Array<{ id: string; grace: unknown }> };
    expect(debtorView.owes.find((x) => x.id === l.id)?.grace).toEqual({ mode: 'grace', method: METHOD, graceUntil: l.grace_until!.toISOString(), lapsed: false, paidOffPlatform: false });
    const creditorView = (await r.buyer.browser.get('/v1/account/liens')).json() as { owedTo: Array<{ id: string; grace: unknown }> };
    expect(creditorView.owedTo.find((x) => x.id === l.id)?.grace).toMatchObject({ mode: 'grace', method: METHOD });
    // The staff case shows it too.
    const view = (await r.mod.b.get(`/staff/v1/disputes/${r.code}`)).json() as { liens: Array<{ id: string; ruledByYou: boolean; grace: { mode: string; method: string } }> };
    expect(view.liens).toEqual([expect.objectContaining({ id: l.id, ruledByYou: true, grace: expect.objectContaining({ mode: 'grace', method: METHOD }) })]);
  });

  it('refuses a malformed plan and writes nothing (the tap stays unused)', async () => {
    for (const bad of [{ mode: 'grace', method: '' }, { mode: 'grace', method: 'x'.repeat(501) }, { mode: 'collect', rateBps: 2500 }, { mode: 'later' }]) {
      const r = await ruled(bad);
      expect(r.res.statusCode).toBe(400);
      expect((await deps.db.query('select used_at from key_taps where id = $1', [r.tapId])).rows[0]).toEqual({ used_at: null });
      expect((await deps.db.query('select 1 from liens where from_code = $1', [r.code])).rowCount).toBe(0);
    }
  });
});

describe('the person owed signs off "I\'ve been paid"', () => {
  it('only the creditor\'s own session: the lien is repaid off the platform, remaining 0, logged, never recovering again', async () => {
    const r = await ruled({ mode: 'grace', method: METHOD });
    const l = await lienOf(r.code);
    setNow(new Date(START.getTime() + 2 * DAY));
    await r.seller.browser.post('/t/login', { accountId: r.seller.id });
    await r.buyer.browser.post('/t/login', { accountId: r.buyer.id });
    // The debtor cannot (and learns nothing).
    expect(errorOf(await r.seller.browser.post(`/v1/account/liens/${l.id}/paid`, {}))).toBe('not-found');
    const ok = await r.buyer.browser.post(`/v1/account/liens/${l.id}/paid`, {});
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ status: 'repaid' });
    const after = await lienOf(r.code);
    expect(after.status).toBe('repaid');
    expect(after.repaid_off_platform_at).not.toBeNull();
    expect(await reserveFor(after)).toBe(0n);
    expect((await logsOf('lien.repaid-off-platform')).map((e) => [e.actor_kind, JSON.parse(e.detail) as unknown])).toContainEqual(['trader', { lienId: l.id }]);
    const view = (await r.buyer.browser.get('/v1/account/liens')).json() as { owedTo: Array<{ id: string; remainingAtomic: string; status: string }> };
    expect(view.owedTo.find((x) => x.id === l.id)).toMatchObject({ status: 'repaid', remainingAtomic: '0' });
    // Once.
    expect(errorOf(await r.buyer.browser.post(`/v1/account/liens/${l.id}/paid`, {}))).toBe('wrong-state');
    // A lap later changes nothing.
    setNow(new Date(START.getTime() + 8 * DAY));
    await tick();
    expect((await lienOf(r.code)).grace_lapsed_at).toBeNull();
  });

  it('is refused on a lien that was never given the grace (recovery handles it)', async () => {
    const r = await ruled();
    const l = await lienOf(r.code);
    await r.buyer.browser.post('/t/login', { accountId: r.buyer.id });
    expect(errorOf(await r.buyer.browser.post(`/v1/account/liens/${l.id}/paid`, {}))).toBe('wrong-state');
  });
});

describe('the 7 days pass without the sign-off', () => {
  it('lapses once: logged, the moderator who ruled is alerted and finds it in their queue; nothing is collected until they switch', async () => {
    const r = await ruled({ mode: 'grace', method: METHOD });
    const l = await lienOf(r.code);
    setNow(new Date(START.getTime() + LIEN_GRACE_DAYS * DAY - 1000));
    await tick();
    expect((await lienOf(r.code)).grace_lapsed_at).toBeNull();
    setNow(new Date(START.getTime() + LIEN_GRACE_DAYS * DAY + 1000));
    await tick();
    await tick();
    await fresh(r.mod);
    expect((await lienOf(r.code)).grace_lapsed_at).not.toBeNull();
    expect((await logsOf('lien.grace-lapsed')).filter((e) => (JSON.parse(e.detail) as { lienId: string }).lienId === l.id)).toHaveLength(1);
    const alerts = await deps.db.query<{ detail: { lienId: string } }>(`select detail from alerts where account_id = $1 and kind = 'lien-grace-lapsed'`, [r.mod.id]);
    expect(alerts.rows.map((a) => a.detail.lienId)).toEqual([l.id]);
    // Lead reading: the lapse alone starts no recovery.
    expect(await reserveFor(await lienOf(r.code))).toBe(0n);
    const queue = (await r.mod.b.get('/staff/v1/disputes?filter=all')).json() as { rows: Array<{ code: string; graceLapsed: boolean }> };
    expect(queue.rows.find((q) => q.code === r.code)?.graceLapsed).toBe(true);
    // Another moderator does not get it.
    const other = await staff('mod');
    expect(((await other.b.get('/staff/v1/disputes?filter=all')).json() as { rows: Array<{ code: string }> }).rows.map((q) => q.code)).not.toContain(r.code);

    // The moderator switches it to collecting with a tap bound to the lien and the share.
    expect(errorOf(await other.b.post(`/staff/v1/liens/${l.id}/collect`, { tapId: await seedTap(deps, other.id, { kind: 'lien-collect', lienId: l.id, rateBps: 10_000 }) }))).toBe('forbidden');
    const wrong = await seedTap(deps, r.mod.id, { kind: 'lien-collect', lienId: l.id, rateBps: 5000 });
    expect(errorOf(await r.mod.b.post(`/staff/v1/liens/${l.id}/collect`, { tapId: wrong }))).toBe('tap-invalid');
    const tapId = await seedTap(deps, r.mod.id, { kind: 'lien-collect', lienId: l.id, rateBps: 10_000 });
    const res = await r.mod.b.post(`/staff/v1/liens/${l.id}/collect`, { tapId });
    expect(res.statusCode, res.body).toBe(200);
    expect(await reserveFor(await lienOf(r.code))).toBeGreaterThan(0n);
    expect((await logsOf('lien.collect-started')).map((e) => JSON.parse(e.detail) as unknown)).toContainEqual({ lienId: l.id, lapsed: true });
    // No longer in the queue; the creditor can no longer sign off (holds may be in flight).
    expect(((await r.mod.b.get('/staff/v1/disputes?filter=all')).json() as { rows: Array<{ code: string; graceLapsed: boolean }> }).rows.find((q) => q.code === r.code)?.graceLapsed ?? false).toBe(false);
    await r.buyer.browser.post('/t/login', { accountId: r.buyer.id });
    expect(errorOf(await r.buyer.browser.post(`/v1/account/liens/${l.id}/paid`, {}))).toBe('wrong-state');
  });

  it('the moderator may instead send it to a senior moderator, whose queue then lists it', async () => {
    await staff('owner');
    const r = await ruled({ mode: 'grace', method: METHOD });
    const l = await lienOf(r.code);
    expect(errorOf(await r.mod.b.post(`/staff/v1/liens/${l.id}/escalate`, {}))).toBe('wrong-state');
    setNow(new Date(START.getTime() + LIEN_GRACE_DAYS * DAY + 1000));
    await tick();
    await fresh(r.mod);
    const res = await r.mod.b.post(`/staff/v1/liens/${l.id}/escalate`, {});
    expect(res.statusCode, res.body).toBe(200);
    const senior = await staff('senior');
    const rows = ((await senior.b.get('/staff/v1/disputes?filter=all')).json() as { rows: Array<{ code: string; graceLapsed: boolean }> }).rows;
    expect(rows.find((q) => q.code === r.code)?.graceLapsed).toBe(true);
    expect((await deps.db.query(`select 1 from alerts where kind = 'lien-grace-escalated' and detail->>'lienId' = $1`, [l.id])).rowCount).toBeGreaterThan(0);
    // A senior switches it with a lower share: the share becomes a pending request for another senior.
    const tapId = await seedTap(deps, senior.id, { kind: 'lien-collect', lienId: l.id, rateBps: 4000 });
    const sw = await senior.b.post(`/staff/v1/liens/${l.id}/collect`, { tapId, rateBps: 4000, rateReason: 'They can pay 40% of each trade' });
    expect(sw.statusCode, sw.body).toBe(200);
    expect(sw.json()).toMatchObject({ rateRequest: 'pending' });
    expect((await lienOf(r.code)).recovery_rate_bps).toBe(10_000);
  });

  // Review of feat/lien-grace items 2 and 6.
  it('a lapse nobody acts on goes to the seniors and the owner by itself after 48 hours: once, alerted and pushed, in their queue', async () => {
    await staff('owner');
    const senior = await staff('senior');
    const r = await ruled({ mode: 'grace', method: METHOD });
    const l = await lienOf(r.code);
    const lapse = START.getTime() + LIEN_GRACE_DAYS * DAY + 1000;
    setNow(new Date(lapse));
    await tick();
    const escalatedAt = async () => (await deps.db.query<{ at: Date | null; by: string | null }>('select grace_escalated_at as at, grace_escalated_by::text as by from liens where id = $1', [l.id])).rows[0]!;
    setNow(new Date(lapse + LIEN_LAPSE_ESCALATE_HOURS * H - 1000));
    await tick();
    expect((await escalatedAt()).at).toBeNull();
    setNow(new Date(lapse + LIEN_LAPSE_ESCALATE_HOURS * H + 1000));
    const sent: string[] = [];
    const push = { send: async (who: string) => (sent.push(who), true) };
    expect(await runLienGraceEscalations({ db: deps.db, clock: deps.clock, push }, [])).toBeGreaterThanOrEqual(1);
    expect(await escalatedAt()).toMatchObject({ by: null });
    expect((await escalatedAt()).at).not.toBeNull();
    expect((await logsOf('lien.grace-escalated')).filter((e) => (JSON.parse(e.detail) as { lienId: string }).lienId === l.id).map((e) => [e.actor_kind, JSON.parse(e.detail) as unknown]))
      .toEqual([['system', { lienId: l.id, auto: true }]]);
    const told = (await deps.db.query<{ a: string }>(`select account_id::text as a from alerts where kind = 'lien-grace-escalated' and detail->>'lienId' = $1`, [l.id])).rows.map((x) => x.a);
    expect(told).toEqual(expect.arrayContaining([senior.id, ownerId!]));
    expect(told).not.toContain(r.mod.id);
    expect(sent).toEqual(expect.arrayContaining([senior.id, ownerId!]));
    // Once.
    expect(await runLienGraceEscalations({ db: deps.db, clock: deps.clock, push }, [])).toBe(0);
    await fresh(senior);
    const rows = ((await senior.b.get('/staff/v1/disputes?filter=all')).json() as { rows: Array<{ code: string; graceLapsed: boolean }> }).rows;
    expect(rows.find((q) => q.code === r.code)?.graceLapsed).toBe(true);
  });

  it('goes to the seniors at once when the moderator who ruled is no longer active staff', async () => {
    const r = await ruled({ mode: 'grace', method: METHOD });
    const l = await lienOf(r.code);
    await deps.db.query('update staff_members set switched_off_at = $2 where account_id = $1', [r.mod.id, deps.clock()]);
    setNow(new Date(START.getTime() + LIEN_GRACE_DAYS * DAY + 1000));
    await tick();
    const row = (await deps.db.query<{ lapsed: Date | null; at: Date | null }>('select grace_lapsed_at as lapsed, grace_escalated_at as at from liens where id = $1', [l.id])).rows[0]!;
    expect(row.lapsed).not.toBeNull();
    expect(row.at).not.toBeNull();
  });

  it('a moderator\'s escalation alerts and pushes the seniors and the owner, never the one who sent it', async () => {
    await staff('owner');
    const senior = await staff('senior');
    const r = await ruled({ mode: 'grace', method: METHOD });
    const l = await lienOf(r.code);
    setNow(new Date(START.getTime() + LIEN_GRACE_DAYS * DAY + 1000));
    await tick();
    await fresh(r.mod);
    expect((await r.mod.b.post(`/staff/v1/liens/${l.id}/escalate`, {})).statusCode).toBe(200);
    const told = (await deps.db.query<{ a: string }>(`select account_id::text as a from alerts where kind = 'lien-grace-escalated' and detail->>'lienId' = $1`, [l.id])).rows.map((x) => x.a);
    expect(told).toEqual(expect.arrayContaining([senior.id, ownerId!]));
    expect(told).not.toContain(r.mod.id);
    expect((await logsOf('lien.grace-escalated')).map((e) => JSON.parse(e.detail) as unknown)).toContainEqual({ lienId: l.id, auto: false });
  });

  it('a moderator may switch a grace lien to collecting early', async () => {
    const r = await ruled({ mode: 'grace', method: METHOD });
    const l = await lienOf(r.code);
    const tapId = await seedTap(deps, r.mod.id, { kind: 'lien-collect', lienId: l.id, rateBps: 10_000 });
    expect((await r.mod.b.post(`/staff/v1/liens/${l.id}/collect`, { tapId })).statusCode).toBe(200);
    expect((await logsOf('lien.collect-started')).map((e) => JSON.parse(e.detail) as unknown)).toContainEqual({ lienId: l.id, lapsed: false });
    // Review item 9: the person owed is told (in-app; pushed when the app has push).
    const told = await deps.db.query<{ detail: unknown }>(`select detail from alerts where account_id = $1 and kind = 'lien-collecting'`, [l.creditor]);
    expect(told.rows.map((x) => x.detail)).toEqual([{ lienId: l.id }]);
    expect((await deps.db.query(`select 1 from alerts where account_id = $1 and kind = 'lien-collecting'`, [l.debtor])).rowCount).toBe(0);
    expect(errorOf(await r.mod.b.post(`/staff/v1/liens/${l.id}/collect`, { tapId: await seedTap(deps, r.mod.id, { kind: 'lien-collect', lienId: l.id, rateBps: 10_000 }) }))).toBe('wrong-state');
  });

  it('parses the lien-collect tap strictly', () => {
    const v = { kind: 'lien-collect', lienId: randomUUID(), rateBps: 10_000 } as const;
    expect(parseKeyTapIntent(v)).toEqual(v);
    for (const bad of [{ kind: 'lien-collect', lienId: v.lienId }, { ...v, rateBps: 0 }, { ...v, rateBps: 10_001 }, { ...v, extra: 1 }]) expect(() => parseKeyTapIntent(bad)).toThrow();
  });
});

describe('owner 5:51 and 5:53 PM: the collecting share chosen with the ruling', () => {
  it('a share under 100% becomes the ruler\'s pending request; a senior approves it without a tap after opening it (logged); never the proposer', async () => {
    const senior = await staff('senior');
    const r = await ruled({ mode: 'collect', rateBps: 2500, rateReason: LIEN_RATE_REASON_PREFILL });
    expect(r.res.statusCode, r.res.body).toBe(200);
    const l = await lienOf(r.code);
    // 100% applies until a senior approves.
    expect(l.recovery_rate_bps).toBe(10_000);
    const req = (await deps.db.query<{ id: string; proposed_by: string; proposed_bps: number; reason: string }>(
      `select id::text, proposed_by::text, proposed_bps, reason from lien_rate_requests where lien_id = $1 and status = 'pending'`, [l.id],
    )).rows[0]!;
    expect(req).toMatchObject({ proposed_by: r.mod.id, proposed_bps: 2500, reason: LIEN_RATE_REASON_PREFILL });
    expect(errorOf(await r.mod.b.post(`/staff/v1/liens/${l.id}/rate/${req.id}/approve`, {}))).toBe('forbidden');
    // Coordinator follow-up 26 Nov 2026: the seniors who may decide it are alerted with the ruling,
    // linked to the lien; never the proposer. The timers push them once.
    const told = async (who: string) => (await deps.db.query<{ detail: unknown }>(
      `select detail from alerts where account_id = $1 and kind = 'lien-rate-requested' and detail->>'requestId' = $2`, [who, req.id],
    )).rows.map((x) => x.detail);
    expect(await told(senior.id)).toEqual([{ trade: r.code, lienId: l.id, requestId: req.id }]);
    expect(await told(r.mod.id)).toEqual([]);
    const sent: string[] = [];
    const push = { send: async (who: string) => (sent.push(who), true) };
    expect(await pushRateDeciders({ db: deps.db, clock: deps.clock, push })).toBeGreaterThanOrEqual(1);
    expect(sent).toContain(senior.id);
    expect(sent).not.toContain(r.mod.id);
    expect(await pushRateDeciders({ db: deps.db, clock: deps.clock, push })).toBe(0);
    const view = (await senior.b.get(`/staff/v1/liens/${l.id}`)).json() as { chat: { code: string; disputeOpen: boolean } };
    expect(view.chat).toEqual({ code: r.code, disputeOpen: true });
    await senior.b.get(`/staff/v1/liens/${l.id}`);
    const opened = (await deps.db.query<{ detail: string; trade_code: string | null }>(`select detail, trade_code from activity_log where action = 'lien.rate-review-opened'`)).rows
      .filter((e) => (JSON.parse(e.detail) as { requestId: string }).requestId === req.id);
    expect(opened.map((e) => e.trade_code)).toEqual([r.code]);
    // Review item 4: while the dispute is open, the senior must have read its chat since the request.
    expect(errorOf(await senior.b.post(`/staff/v1/liens/${l.id}/rate/${req.id}/approve`, {}))).toBe('review-chat-first');
    // A chat read before the request does not count.
    await logAs(senior.id, r.code, new Date(deps.clock().getTime() - DAY));
    expect(errorOf(await senior.b.post(`/staff/v1/liens/${l.id}/rate/${req.id}/approve`, {}))).toBe('review-chat-first');
    // Another senior's read does not count either.
    await logAs((await staff('senior')).id, r.code, deps.clock());
    expect(errorOf(await senior.b.post(`/staff/v1/liens/${l.id}/rate/${req.id}/approve`, {}))).toBe('review-chat-first');
    await logAs(senior.id, r.code, deps.clock());
    const ok = await senior.b.post(`/staff/v1/liens/${l.id}/rate/${req.id}/approve`, {});
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await lienOf(r.code)).recovery_rate_bps).toBe(2500);
  });
});

describe('review of feat/lien-grace: ending a lien as paid off the platform', () => {
  it('staff (the moderator who ruled, with a tap bound to the lien) end a collecting lien; another moderator cannot; the traders see nothing left', async () => {
    const r = await ruled();
    const l = await lienOf(r.code);
    const other = await staff('mod');
    expect(errorOf(await other.b.post(`/staff/v1/liens/${l.id}/paid-off-platform`, { tapId: await seedTap(deps, other.id, { kind: 'lien-paid-off-platform', lienId: l.id }) }))).toBe('forbidden');
    const wrong = await seedTap(deps, r.mod.id, { kind: 'lien-uncollectible', lienId: l.id });
    expect(errorOf(await r.mod.b.post(`/staff/v1/liens/${l.id}/paid-off-platform`, { tapId: wrong }))).toBe('tap-invalid');
    const ok = await r.mod.b.post(`/staff/v1/liens/${l.id}/paid-off-platform`, { tapId: await seedTap(deps, r.mod.id, { kind: 'lien-paid-off-platform', lienId: l.id }) });
    expect(ok.statusCode, ok.body).toBe(200);
    const after = await lienOf(r.code);
    expect(after).toMatchObject({ status: 'repaid' });
    expect(after.repaid_off_platform_at).not.toBeNull();
    expect(await reserveFor(after)).toBe(0n);
    expect((await logsOf('lien.repaid-off-platform')).map((e) => [e.actor_kind, JSON.parse(e.detail) as unknown])).toContainEqual(['staff', { lienId: l.id }]);
    await r.buyer.browser.post('/t/login', { accountId: r.buyer.id });
    const view = (await r.buyer.browser.get('/v1/account/liens')).json() as { owedTo: Array<{ id: string; remainingAtomic: string; paidOffPlatform?: boolean; grace?: unknown }> };
    expect(view.owedTo.find((x) => x.id === l.id)).toMatchObject({ remainingAtomic: '0', paidOffPlatform: true });
    expect(view.owedTo.find((x) => x.id === l.id)).not.toHaveProperty('grace');
    // Once.
    expect(errorOf(await r.mod.b.post(`/staff/v1/liens/${l.id}/paid-off-platform`, { tapId: await seedTap(deps, r.mod.id, { kind: 'lien-paid-off-platform', lienId: l.id }) }))).toBe('wrong-state');
  });

  it('is refused while a recovery that still counts is in flight (lien-recovery-in-flight), and the tap stays unused', async () => {
    const r = await ruled();
    const l = await lienOf(r.code);
    const seller = await newTrader();
    const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: l.debtor, poster: 'seller' });
    await deps.db.query(
      `insert into lien_recovery_holds (lien_id, trade_code, amount_atomic, rate_bps, address, address_statement, address_sig, created_at)
       values ($1, $2, 1000, 10000, '5' || repeat('A', 94), '{}'::jsonb, repeat('0', 128), $3)`,
      [l.id, trade.code, deps.clock()],
    );
    const tapId = await seedTap(deps, r.mod.id, { kind: 'lien-paid-off-platform', lienId: l.id });
    expect(errorOf(await r.mod.b.post(`/staff/v1/liens/${l.id}/paid-off-platform`, { tapId }))).toBe('lien-recovery-in-flight');
    expect((await deps.db.query('select used_at from key_taps where id = $1', [tapId])).rows[0]).toEqual({ used_at: null });
    expect((await lienOf(r.code)).repaid_off_platform_at).toBeNull();
  });

  it('the person owed may still sign off after the lapse, but never while an appeal holds the lien (suspended)', async () => {
    const r = await ruled({ mode: 'grace', method: METHOD });
    const l = await lienOf(r.code);
    setNow(new Date(START.getTime() + LIEN_GRACE_DAYS * DAY + 1000));
    await tick();
    expect((await lienOf(r.code)).grace_lapsed_at).not.toBeNull();
    await r.buyer.browser.post('/t/login', { accountId: r.buyer.id });
    await deps.db.query(`update liens set status = 'suspended', changed_at = $2 where id = $1`, [l.id, deps.clock()]);
    expect(errorOf(await r.buyer.browser.post(`/v1/account/liens/${l.id}/paid`, {}))).toBe('wrong-state');
    await deps.db.query(`update liens set status = 'active', changed_at = $2 where id = $1`, [l.id, deps.clock()]);
    const ok = await r.buyer.browser.post(`/v1/account/liens/${l.id}/paid`, {});
    expect(ok.statusCode, ok.body).toBe(200);
  });
});

describe('review of feat/lien-grace: the switch and the escalation', () => {
  it('a share under 100% with the switch is a pending request; a second switch attempt while one is pending rolls back whole (409 request-pending)', async () => {
    const r = await ruled({ mode: 'grace', method: METHOD });
    const l = await lienOf(r.code);
    // A request already pending (from the propose route) blocks a lower share with the switch.
    await deps.db.query(`insert into lien_rate_requests (lien_id, proposed_bps, reason, proposed_by, proposed_at) values ($1, 5000, 'Half', $2, $3)`, [l.id, r.mod.id, deps.clock()]);
    const tapId = await seedTap(deps, r.mod.id, { kind: 'lien-collect', lienId: l.id, rateBps: 2500 });
    expect(errorOf(await r.mod.b.post(`/staff/v1/liens/${l.id}/collect`, { tapId, rateBps: 2500, rateReason: 'A quarter' }))).toBe('request-pending');
    expect((await lienOf(r.code)).collect_started_at).toBeNull();
    expect((await deps.db.query('select used_at from key_taps where id = $1', [tapId])).rows[0]).toEqual({ used_at: null });
    expect((await logsOf('lien.collect-started')).filter((e) => (JSON.parse(e.detail) as { lienId: string }).lienId === l.id)).toHaveLength(0);
  });

  it('another moderator may neither switch nor send it up (403)', async () => {
    const r = await ruled({ mode: 'grace', method: METHOD });
    const l = await lienOf(r.code);
    setNow(new Date(START.getTime() + LIEN_GRACE_DAYS * DAY + 1000));
    await tick();
    const other = await staff('mod');
    expect(errorOf(await other.b.post(`/staff/v1/liens/${l.id}/escalate`, {}))).toBe('forbidden');
    expect(errorOf(await other.b.post(`/staff/v1/liens/${l.id}/collect`, { tapId: await seedTap(deps, other.id, { kind: 'lien-collect', lienId: l.id, rateBps: 10_000 }) }))).toBe('forbidden');
  });
});

describe('lien grace & collect-now % edge cases (#45)', () => {
  it('fee_atomic > 0: creditor /paid and staff /paid-off-platform keep status active while remainingAtomic is 0 and no further recovery reserves', async () => {
    // Seller-posted ad -> seller-sends-xmr lien carries X2F's 1% fee (fee_atomic > 0).
    async function sellerPostedDispute() {
      setNow(START);
      const seller = await newTrader();
      const buyer = await newTrader();
      const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
      const t = await driveTo(deps, trade, 'paid');
      const client = await deps.db.connect();
      try {
        await client.query('begin');
        await startDispute(client, t, { openedBy: 'buyer', reason: 'paid', note: '', afterRefund: true, now: START, prices: null });
        await client.query('commit');
      } finally {
        client.release();
      }
      const mod = await staff('mod');
      expect((await mod.b.post(`/staff/v1/disputes/${t.code}/take`, {})).statusCode).toBe(200);
      const rulingId = randomUUID();
      const intent: KeyTapIntent = {
        kind: 'ruling', step: 'propose', rulingId, code: t.code, round: 1, outcome: 'seller-sends-xmr', accountAction: { kind: 'none' },
        amountAtomic: AMOUNT.toString(), reasonSha256: sha(REASON), evidenceSha256: evidenceSha256(EVIDENCE), round1Id: null,
      };
      const tapId = await seedTap(deps, mod.id, intent);
      const res = await mod.b.post(`/staff/v1/disputes/${t.code}/rulings`, {
        rulingId, outcome: 'seller-sends-xmr', accountAction: { kind: 'none' }, reason: REASON, evidence: EVIDENCE, tapId,
        lienPlan: { mode: 'grace', method: METHOD },
      });
      expect(res.statusCode, res.body).toBe(200);
      return { seller, buyer, mod, code: t.code, lien: await lienOf(t.code) };
    }

    // Path 1: creditor signs off "I've been paid".
    const d1 = await sellerPostedDispute();
    expect(BigInt((await deps.db.query<{ f: string }>('select fee_atomic::text as f from liens where id = $1', [d1.lien.id])).rows[0]!.f)).toBeGreaterThan(0n);
    await d1.buyer.browser.post('/t/login', { accountId: d1.buyer.id });
    const paid1 = await d1.buyer.browser.post(`/v1/account/liens/${d1.lien.id}/paid`, {});
    expect(paid1.statusCode, paid1.body).toBe(200);
    expect(paid1.json()).toMatchObject({ status: 'active' });
    const after1 = await lienOf(d1.code);
    expect(after1.status).toBe('active');
    expect(after1.repaid_off_platform_at).not.toBeNull();
    expect(await reserveFor(after1)).toBe(0n);
    const view1 = (await d1.buyer.browser.get('/v1/account/liens')).json() as { owedTo: Array<{ id: string; status: string; remainingAtomic: string; paidOffPlatform?: boolean }> };
    expect(view1.owedTo.find((x) => x.id === d1.lien.id)).toMatchObject({ status: 'active', remainingAtomic: '0', paidOffPlatform: true });

    // Path 2: staff marks paid off platform.
    const d2 = await sellerPostedDispute();
    const tapId = await seedTap(deps, d2.mod.id, { kind: 'lien-paid-off-platform', lienId: d2.lien.id });
    const paid2 = await d2.mod.b.post(`/staff/v1/liens/${d2.lien.id}/paid-off-platform`, { tapId });
    expect(paid2.statusCode, paid2.body).toBe(200);
    expect(paid2.json()).toMatchObject({ status: 'active' });
    const after2 = await lienOf(d2.code);
    expect(after2.status).toBe('active');
    expect(after2.repaid_off_platform_at).not.toBeNull();
    expect(await reserveFor(after2)).toBe(0n);
  });

  it('two-person large-trade approval preserves lienPlan (both grace and lower collect-now %) through awaiting-approval', async () => {
    // Drop large-trade limit to $1 so our 1 XMR trade requires a second person (awaiting-approval).
    const prevLimit = (await deps.db.query<{ l: number }>('select large_trade_limit_usd as l from settings')).rows[0]!.l;
    await deps.db.query('update settings set large_trade_limit_usd = 1');
    try {
      const senior = await staff('senior');

      // Case A: grace plan waits in ruling_drafts and applies on senior approve.
      const g = await disputed();
      const modA = await staff('mod');
      expect((await modA.b.post(`/staff/v1/disputes/${g.code}/take`, {})).statusCode).toBe(200);
      const ridA = randomUUID();
      const baseIntentA = {
        kind: 'ruling' as const, rulingId: ridA, code: g.code, round: 1 as const, outcome: 'seller-sends-xmr' as const, accountAction: { kind: 'none' as const },
        amountAtomic: AMOUNT.toString(), reasonSha256: sha(REASON), evidenceSha256: evidenceSha256(EVIDENCE), round1Id: null,
      };
      const propA = await modA.b.post(`/staff/v1/disputes/${g.code}/rulings`, {
        rulingId: ridA, outcome: 'seller-sends-xmr', accountAction: { kind: 'none' }, reason: REASON, evidence: EVIDENCE,
        tapId: await seedTap(deps, modA.id, { ...baseIntentA, step: 'propose' }),
        lienPlan: { mode: 'grace', method: METHOD },
      });
      expect(propA.statusCode, propA.body).toBe(200);
      // Nothing placed yet while awaiting approval.
      expect((await deps.db.query('select 1 from liens where from_code = $1', [g.code])).rowCount).toBe(0);
      const appA = await senior.b.post(`/staff/v1/disputes/${g.code}/rulings/${ridA}/approve`, {
        tapId: await seedTap(deps, senior.id, { ...baseIntentA, step: 'approve' }),
      });
      expect(appA.statusCode, appA.body).toBe(200);
      const lienA = await lienOf(g.code);
      expect(lienA.grace_method).toBe(METHOD);
      expect(lienA.grace_until!.getTime()).toBe(START.getTime() + LIEN_GRACE_DAYS * DAY);
      expect(lienA.ruled_by).toBe(modA.id);

      // Case B: lower collect-now % plan waits in ruling_drafts and creates pending rate request on approve.
      const c = await disputed();
      const modB = await staff('mod');
      expect((await modB.b.post(`/staff/v1/disputes/${c.code}/take`, {})).statusCode).toBe(200);
      const ridB = randomUUID();
      const baseIntentB = {
        kind: 'ruling' as const, rulingId: ridB, code: c.code, round: 1 as const, outcome: 'seller-sends-xmr' as const, accountAction: { kind: 'none' as const },
        amountAtomic: AMOUNT.toString(), reasonSha256: sha(REASON), evidenceSha256: evidenceSha256(EVIDENCE), round1Id: null,
      };
      const propB = await modB.b.post(`/staff/v1/disputes/${c.code}/rulings`, {
        rulingId: ridB, outcome: 'seller-sends-xmr', accountAction: { kind: 'none' }, reason: REASON, evidence: EVIDENCE,
        tapId: await seedTap(deps, modB.id, { ...baseIntentB, step: 'propose' }),
        lienPlan: { mode: 'collect', rateBps: 3000, rateReason: 'Can afford 30%' },
      });
      expect(propB.statusCode, propB.body).toBe(200);
      expect((await deps.db.query('select 1 from liens where from_code = $1', [c.code])).rowCount).toBe(0);
      const appB = await senior.b.post(`/staff/v1/disputes/${c.code}/rulings/${ridB}/approve`, {
        tapId: await seedTap(deps, senior.id, { ...baseIntentB, step: 'approve' }),
      });
      expect(appB.statusCode, appB.body).toBe(200);
      const lienB = await lienOf(c.code);
      expect(lienB.grace_until).toBeNull();
      expect(lienB.recovery_rate_bps).toBe(10_000);
      const req = (await deps.db.query<{ proposed_by: string; proposed_bps: number; reason: string; status: string }>(
        'select proposed_by::text, proposed_bps, reason, status from lien_rate_requests where lien_id = $1',
        [lienB.id],
      )).rows[0]!;
      expect(req).toEqual({ proposed_by: modB.id, proposed_bps: 3000, reason: 'Can afford 30%', status: 'pending' });
    } finally {
      await deps.db.query('update settings set large_trade_limit_usd = $1', [prevLimit]);
    }
  });

  it('concurrent creditor /paid and staff /collect serialize cleanly so exactly one wins', async () => {
    const r = await ruled({ mode: 'grace', method: METHOD });
    const l = await lienOf(r.code);
    await r.buyer.browser.post('/t/login', { accountId: r.buyer.id });
    const tapId = await seedTap(deps, r.mod.id, { kind: 'lien-collect', lienId: l.id, rateBps: 10_000 });
    const [paidRes, collectRes] = await Promise.all([
      r.buyer.browser.post(`/v1/account/liens/${l.id}/paid`, {}),
      r.mod.b.post(`/staff/v1/liens/${l.id}/collect`, { tapId }),
    ]);
    expect([paidRes.statusCode, collectRes.statusCode].sort()).toEqual([200, 409]);
    const loser = paidRes.statusCode === 409 ? paidRes : collectRes;
    expect(errorOf(loser)).toBe('wrong-state');
    const after = await lienOf(r.code);
    // Exactly one transition committed: never both paid-off-platform and collecting.
    expect(Boolean(after.repaid_off_platform_at) !== Boolean(after.collect_started_at)).toBe(true);
  });

  it('creditor /paid enforces auth, owner-device, hold, and input boundaries', async () => {
    const { seedAccount } = await import('../helpers/accounts.js');
    const { Browser } = await import('../helpers/totp.js');

    const r = await ruled({ mode: 'grace', method: METHOD });
    const l = await lienOf(r.code);
    await r.buyer.browser.post('/t/login', { accountId: r.buyer.id });

    // Stranger gets 404 (no existence leak), invalid UUID gets 404, extra body fields get 400.
    const stranger = await newTrader();
    await stranger.browser.post('/t/login', { accountId: stranger.id });
    expect(errorOf(await stranger.browser.post(`/v1/account/liens/${l.id}/paid`, {}))).toBe('not-found');
    expect(errorOf(await r.buyer.browser.post('/v1/account/liens/not-a-uuid/paid', {}))).toBe('not-found');
    expect(errorOf(await r.buyer.browser.post(`/v1/account/liens/${l.id}/paid`, { extra: 1 }))).toBe('bad-request');

    // Team member on the creditor's account cannot sign off (ownerDeviceOnly -> 403 owner-only).
    const memberId = await seedAccount(deps, { loginName: `lgmem${randomUUID().slice(0, 8)}`, kind: 'member' });
    await deps.db.query(
      `insert into team_members (account_id, display_name, display_key, abilities, invite_expires_at, member_account_id, joined_at, created_at)
       values ($1, 'LgMem', $2, $3, $4, $5, $4, $4)`,
      [r.buyer.id, `lgmem${randomUUID().slice(0, 6)}`, ['trades-see-active'], deps.clock(), memberId],
    );
    const mb = new Browser(traderApp);
    expect((await mb.post('/t/login', { accountId: memberId })).statusCode).toBe(200);
    const asMember = await mb.post(`/v1/account/liens/${l.id}/paid`, {});
    expect({ status: asMember.statusCode, error: errorOf(asMember) }).toEqual({ status: 403, error: 'owner-only' });

    // Active account hold blocks creditor sign-off (requireNotHeld -> 403 account-hold).
    await deps.db.query(
      `insert into account_holds (account_id, started_at, hold_until, reason, started_methods) values ($1, $2, $3, 'recovery-code', '{}')`,
      [r.buyer.id, deps.clock(), new Date(deps.clock().getTime() + DAY)],
    );
    const held = await r.buyer.browser.post(`/v1/account/liens/${l.id}/paid`, {});
    expect(held.statusCode).toBe(403);
    expect((await lienOf(r.code)).repaid_off_platform_at).toBeNull();
    await deps.db.query('delete from account_holds where account_id = $1', [r.buyer.id]);

    // Once hold lifts, creditor sign-off succeeds.
    expect((await r.buyer.browser.post(`/v1/account/liens/${l.id}/paid`, {})).statusCode).toBe(200);
  });

  it('POST /collect refuses invalid rateBps / rateReason values without consuming the tap', async () => {
    const r = await ruled({ mode: 'grace', method: METHOD });
    const l = await lienOf(r.code);
    const tapId = await seedTap(deps, r.mod.id, { kind: 'lien-collect', lienId: l.id, rateBps: 10_000 });
    for (const bad of [
      { tapId, rateBps: 0, rateReason: 'zero' },
      { tapId, rateBps: -1, rateReason: 'neg' },
      { tapId, rateBps: 10_001, rateReason: 'over' },
      { tapId, rateBps: 25.5, rateReason: 'float' },
      { tapId, rateBps: 2500 },
      { tapId, rateBps: 2500, rateReason: '   ' },
      { tapId, rateBps: 10_000, rateReason: 'reason not allowed at 100%' },
    ]) {
      const res = await r.mod.b.post(`/staff/v1/liens/${l.id}/collect`, bad);
      expect(res.statusCode).toBe(400);
      expect(errorOf(res)).toBe('bad-request');
    }
    expect((await deps.db.query('select used_at from key_taps where id = $1', [tapId])).rows[0]).toEqual({ used_at: null });
    expect((await lienOf(r.code)).collect_started_at).toBeNull();
  });

  it('a closed dispute lets a senior approve a pending lower share without requiring chat.read', async () => {
    const senior = await staff('senior');
    const r = await ruled({ mode: 'collect', rateBps: 3500, rateReason: 'Can pay 35%' });
    const l = await lienOf(r.code);
    const req = (await deps.db.query<{ id: string }>(`select id::text from lien_rate_requests where lien_id = $1 and status = 'pending'`, [l.id])).rows[0]!;
    // Close the dispute (e.g. after appeal window finishes): chat is shut so no chat.read is required.
    await deps.db.query(`update disputes set status = 'closed', closed_at = $2 where code = $1`, [r.code, deps.clock()]);
    const view = (await senior.b.get(`/staff/v1/liens/${l.id}`)).json() as { chat: { code: string; disputeOpen: boolean } };
    expect(view.chat).toEqual({ code: r.code, disputeOpen: false });
    const ok = await senior.b.post(`/staff/v1/liens/${l.id}/rate/${req.id}/approve`, {});
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await lienOf(r.code)).recovery_rate_bps).toBe(3500);
  });
});
