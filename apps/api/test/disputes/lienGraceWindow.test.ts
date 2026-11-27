// Tests for PR #45 (owner 26 Nov 2026, 5:43 and 5:51 PM): the edges of "Collect now" (the share the
// moderator sets) and of "7 days to pay the agreed way": the share's bounds at the ruling and at the
// switch, who may set it, the window's last millisecond and first one after, what the lapse does,
// and the creditor's sign-off in time. Real Postgres, the real routes; the setup follows
// lienGrace.test.ts next to it.
import { createHash, randomUUID } from 'node:crypto';
import { LIEN_GRACE_DAYS, evidenceSha256, type KeyTapIntent } from '@x2f/staff';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../../src/app.js';
import { NO_MODERATION } from '../../src/disputes/moderationClient.js';
import { pickRecovery } from '../../src/disputes/recovery.js';
import { startDispute } from '../../src/disputes/store.js';
import { disputeTimerJob } from '../../src/disputes/timers.js';
import { buildStaffApi } from '../../src/staff/app.js';
import { STAFF_ORIGIN, StaffBrowser, insertSession, seedStaff, seedTap } from '../helpers/staffApp.js';
import { tradeApp } from '../helpers/tradeApp.js';
import { AMOUNT, XMR, driveTo, seedTrade } from '../helpers/trades.js';

const START = new Date('2026-11-26T12:00:00Z');
const DAY = 86_400_000;
const GRACE_END = START.getTime() + LIEN_GRACE_DAYS * DAY;
const REASON = 'The buyer reversed the PayPal payment after the XMR was released to them.';
const EVIDENCE = ['The trade chat', 'PayPal reversal notice'];
const METHOD = 'A new PayPal payment of $120 to the same PayPal account';

let traderApp: FastifyInstance;
let staffApp: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let newTrader: Awaited<ReturnType<typeof tradeApp>>['trader'];

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

async function staff(role: 'mod' | 'senior' | 'helper') {
  const s = await seedStaff(deps, { role });
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
  id: string; status: string; grace_until: Date | null; grace_lapsed_at: Date | null;
  collect_started_at: Date | null; repaid_off_platform_at: Date | null; recovery_rate_bps: number; debtor: string;
}
async function lienOf(code: string): Promise<LienRow> {
  const { rows } = await deps.db.query<LienRow>(
    `select id::text, status, grace_until, grace_lapsed_at, collect_started_at, repaid_off_platform_at, recovery_rate_bps,
            debtor_account_id::text as debtor from liens where from_code = $1`,
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
const unusedTap = async (tapId: string) => expect((await deps.db.query('select used_at from key_taps where id = $1', [tapId])).rows[0]).toEqual({ used_at: null });
const lapsesOf = async (lienId: string) =>
  (await deps.db.query<{ detail: string }>(`select detail from activity_log where action = 'lien.grace-lapsed' order by id`)).rows
    .filter((e) => (JSON.parse(e.detail) as { lienId: string }).lienId === lienId);
const pendingRequests = async (lienId: string) =>
  (await deps.db.query<{ proposed_bps: number; reason: string }>(`select proposed_bps, reason from lien_rate_requests where lien_id = $1 and status = 'pending'`, [lienId])).rows;

describe('the share set with "Collect now" at the ruling', () => {
  it('0%, negative, above 100% or a string are refused (400) and nothing is written; 100% and 0.01% are accepted', async () => {
    for (const bad of [
      { mode: 'collect', rateBps: 0, rateReason: 'x' }, { mode: 'collect', rateBps: 10_001, rateReason: 'x' },
      { mode: 'collect', rateBps: -1, rateReason: 'x' }, { mode: 'collect', rateBps: '5000', rateReason: 'x' },
    ]) {
      const r = await ruled(bad);
      expect(r.res.statusCode, JSON.stringify(bad)).toBe(400);
      await unusedTap(r.tapId);
      expect((await deps.db.query('select 1 from liens where from_code = $1', [r.code])).rowCount).toBe(0);
    }
    const full = await ruled({ mode: 'collect', rateBps: 10_000 });
    expect(full.res.statusCode, full.res.body).toBe(200);
    const lf = await lienOf(full.code);
    expect(lf.recovery_rate_bps).toBe(10_000);
    expect(await pendingRequests(lf.id)).toEqual([]);
    expect(await reserveFor(lf)).toBeGreaterThan(0n);

    const lowest = await ruled({ mode: 'collect', rateBps: 1, rateReason: 'Can afford almost nothing' });
    expect(lowest.res.statusCode, lowest.res.body).toBe(200);
    const ll = await lienOf(lowest.code);
    // 100% applies until a senior approves the lower share.
    expect(ll.recovery_rate_bps).toBe(10_000);
    expect(await pendingRequests(ll.id)).toEqual([{ proposed_bps: 1, reason: 'Can afford almost nothing' }]);
  });
});

describe('the share set with the switch to collecting', () => {
  it('0%, above 100%, a fraction, or under 100% without a reason are refused (400) before the tap is used; 100% starts collecting at once', async () => {
    const r = await ruled({ mode: 'grace', method: METHOD });
    expect(r.res.statusCode, r.res.body).toBe(200);
    const l = await lienOf(r.code);
    for (const body of [{ rateBps: 0, rateReason: 'x' }, { rateBps: 10_001, rateReason: 'x' }, { rateBps: 2_500.5, rateReason: 'x' }, { rateBps: 5_000 }]) {
      const tapId = await seedTap(deps, r.mod.id, { kind: 'lien-collect', lienId: l.id, rateBps: 10_000 });
      const res = await r.mod.b.post(`/staff/v1/liens/${l.id}/collect`, { tapId, ...body });
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      await unusedTap(tapId);
    }
    expect((await lienOf(r.code)).collect_started_at).toBeNull();
    expect(await reserveFor(await lienOf(r.code))).toBe(0n);

    const tapId = await seedTap(deps, r.mod.id, { kind: 'lien-collect', lienId: l.id, rateBps: 10_000 });
    const ok = await r.mod.b.post(`/staff/v1/liens/${l.id}/collect`, { tapId, rateBps: 10_000 });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ mode: 'collect', rateRequest: null });
    expect(await reserveFor(await lienOf(r.code))).toBeGreaterThan(0n);
  });

  it('the lowest share (1 bps) with the switch becomes a pending request; collecting starts at 100% meanwhile', async () => {
    const r = await ruled({ mode: 'grace', method: METHOD });
    const l = await lienOf(r.code);
    const tapId = await seedTap(deps, r.mod.id, { kind: 'lien-collect', lienId: l.id, rateBps: 1 });
    const res = await r.mod.b.post(`/staff/v1/liens/${l.id}/collect`, { tapId, rateBps: 1, rateReason: 'Almost nothing' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ rateRequest: 'pending' });
    const after = await lienOf(r.code);
    expect(after.recovery_rate_bps).toBe(10_000);
    expect(after.collect_started_at).not.toBeNull();
    expect(await pendingRequests(l.id)).toEqual([{ proposed_bps: 1, reason: 'Almost nothing' }]);
  });
});

describe('only a moderator sets it', () => {
  it('a helper (no disputes.handle) is refused the switch; trader sessions never reach the staff routes; a senior may switch', async () => {
    const r = await ruled({ mode: 'grace', method: METHOD });
    const l = await lienOf(r.code);
    const helper = await staff('helper');
    const hTap = await seedTap(deps, helper.id, { kind: 'lien-collect', lienId: l.id, rateBps: 10_000 });
    expect((await helper.b.post(`/staff/v1/liens/${l.id}/collect`, { tapId: hTap })).statusCode).toBe(403);
    await unusedTap(hTap);
    // The debtor and the creditor, with trader sessions, on the staff site.
    for (const t of [r.seller, r.buyer]) {
      const b = new StaffBrowser(staffApp).withSession((await insertSession(deps, t.id, 'trader')).token);
      const res = await b.post(`/staff/v1/liens/${l.id}/collect`, { tapId: randomUUID() });
      expect([401, 403]).toContain(res.statusCode);
    }
    expect((await lienOf(r.code)).collect_started_at).toBeNull();
    // A senior moderator (rulings.approve) may decide it even though another moderator ruled.
    const senior = await staff('senior');
    const ok = await senior.b.post(`/staff/v1/liens/${l.id}/collect`, { tapId: await seedTap(deps, senior.id, { kind: 'lien-collect', lienId: l.id, rateBps: 10_000 }) });
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it('the trader site has no route that sets a share or starts collecting', async () => {
    const r = await ruled({ mode: 'grace', method: METHOD });
    const l = await lienOf(r.code);
    await r.seller.browser.post('/t/login', { accountId: r.seller.id });
    for (const path of [`/v1/account/liens/${l.id}/collect`, `/v1/account/liens/${l.id}/rate`]) {
      const res = await r.seller.browser.post(path, { rateBps: 1, rateReason: 'x' });
      expect(res.statusCode, path).toBeGreaterThanOrEqual(400);
    }
    expect(await lienOf(r.code)).toMatchObject({ collect_started_at: null, recovery_rate_bps: 10_000 });
    expect(await pendingRequests(l.id)).toEqual([]);
  });
});

describe('the 7-day window boundary', () => {
  it('1 ms before the end: no lapse; exactly at the end: lapses once (grace_until <= now)', async () => {
    const r = await ruled({ mode: 'grace', method: METHOD });
    const l = await lienOf(r.code);
    expect(l.grace_until!.getTime()).toBe(GRACE_END);
    setNow(new Date(GRACE_END - 1));
    await tick();
    expect((await lienOf(r.code)).grace_lapsed_at).toBeNull();
    expect(await lapsesOf(l.id)).toHaveLength(0);
    setNow(new Date(GRACE_END));
    await tick();
    expect((await lienOf(r.code)).grace_lapsed_at?.getTime()).toBe(GRACE_END);
    expect(await lapsesOf(l.id)).toHaveLength(1);
    setNow(new Date(GRACE_END + DAY));
    await tick();
    expect(await lapsesOf(l.id)).toHaveLength(1);
  });

  it('on expiry nothing is collected and the debtor sees it lapsed; before it there is nothing to send up; recovery starts only with the switch', async () => {
    const r = await ruled({ mode: 'grace', method: METHOD });
    const l = await lienOf(r.code);
    setNow(new Date(GRACE_END - 1));
    await tick();
    await fresh(r.mod);
    expect(errorOf(await r.mod.b.post(`/staff/v1/liens/${l.id}/escalate`, {}))).toBe('wrong-state');
    setNow(new Date(GRACE_END + 1));
    await tick();
    await fresh(r.mod);
    const lapsed = await lienOf(r.code);
    expect(lapsed).toMatchObject({ status: 'active', collect_started_at: null, repaid_off_platform_at: null });
    expect(lapsed.grace_lapsed_at).not.toBeNull();
    expect(await reserveFor(lapsed)).toBe(0n);
    await r.seller.browser.post('/t/login', { accountId: r.seller.id });
    const view = (await r.seller.browser.get('/v1/account/liens')).json() as { owes: Array<{ id: string; grace: { lapsed: boolean } }> };
    expect(view.owes.find((x) => x.id === l.id)?.grace.lapsed).toBe(true);
    const ok = await r.mod.b.post(`/staff/v1/liens/${l.id}/collect`, { tapId: await seedTap(deps, r.mod.id, { kind: 'lien-collect', lienId: l.id, rateBps: 10_000 }) });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(await reserveFor(await lienOf(r.code))).toBeGreaterThan(0n);
  });
});

describe('paid in time', () => {
  it('the creditor signs off 1 ms before the end: repaid, never lapses, never collects, and the switch is then refused', async () => {
    const r = await ruled({ mode: 'grace', method: METHOD });
    const l = await lienOf(r.code);
    setNow(new Date(GRACE_END - 1));
    await r.buyer.browser.post('/t/login', { accountId: r.buyer.id });
    const ok = await r.buyer.browser.post(`/v1/account/liens/${l.id}/paid`, {});
    expect(ok.statusCode, ok.body).toBe(200);
    const after = await lienOf(r.code);
    expect(after.status).toBe('repaid');
    expect(after.repaid_off_platform_at?.getTime()).toBe(GRACE_END - 1);
    setNow(new Date(GRACE_END + DAY));
    await tick();
    expect((await lienOf(r.code)).grace_lapsed_at).toBeNull();
    expect(await lapsesOf(l.id)).toHaveLength(0);
    expect(await reserveFor(await lienOf(r.code))).toBe(0n);
    await fresh(r.mod);
    const tapId = await seedTap(deps, r.mod.id, { kind: 'lien-collect', lienId: l.id, rateBps: 10_000 });
    expect(errorOf(await r.mod.b.post(`/staff/v1/liens/${l.id}/collect`, { tapId }))).toBe('wrong-state');
    await unusedTap(tapId);
  });

  it('a sign-off just after the end, before the timer ran, still ends it, and the timer then marks no lapse', async () => {
    const r = await ruled({ mode: 'grace', method: METHOD });
    const l = await lienOf(r.code);
    setNow(new Date(GRACE_END + 1));
    await r.buyer.browser.post('/t/login', { accountId: r.buyer.id });
    const ok = await r.buyer.browser.post(`/v1/account/liens/${l.id}/paid`, {});
    expect(ok.statusCode, ok.body).toBe(200);
    await tick();
    expect((await lienOf(r.code)).grace_lapsed_at).toBeNull();
    expect(await lapsesOf(l.id)).toHaveLength(0);
  });
});
