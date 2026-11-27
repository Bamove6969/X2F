// Plan 4 Task 24, the owner's appeal rules on top of Task 10's appeal route:
// - D-005: a File appeal button on the completed-trades list and on the trade page, gone at the
//   deadline. The API side: the trade view's `appealUntil`, set only while this viewer may still
//   file (a published round-1 ruling, no appeal yet, before `appealEndsAt`), so any list or page
//   can show the button from the trade alone.
// - D-010: one appeal only, filed within 48 h of the ruling, decided within ~48 h, final.
// - D-011 (lead default, 28 Oct): no eligible reviewer (every senior moderator and the owner was
//   involved in round 1, or there is none): the appeal waits, the owner is alerted, the trader is told.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deps } from '../../src/app.js';
import { buildStaffApi } from '../../src/staff/app.js';
import { NO_MODERATION } from '../../src/disputes/moderationClient.js';
import { disputeTimerJob } from '../../src/disputes/timers.js';
import { appendLog } from '../../src/log/append.js';
import { rolesToAbilities } from '../../src/team/abilities.js';
import { makeVendor, seedAccount } from '../helpers/accounts.js';
import { publishRuling } from '../helpers/disputes.js';
import { STAFF_ORIGIN, StaffBrowser, insertSession, seedStaff } from '../helpers/staffApp.js';
import { Browser } from '../helpers/totp.js';
import { driveTo, seedTrade } from '../helpers/trades.js';
import { tradeApp } from '../helpers/tradeApp.js';

let app: FastifyInstance;
let staffApp: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];
let ownerId: string;

const START = new Date('2026-11-02T12:00:00Z');
const MIN = 60_000;
const H = 60 * MIN;
const at = (ms: number) => new Date(START.getTime() + ms);
const iso = (ms: number) => at(ms).toISOString();
const WHY = 'The moderator missed my bank statement.';

beforeAll(async () => {
  ({ app, deps, trader, setNow } = await tradeApp());
  staffApp = await buildStaffApi({ ...deps, staffOrigin: STAFF_ORIGIN, moderation: NO_MODERATION, traderEvents: app.events });
  setNow(START);
  ownerId = (await seedStaff(deps, { role: 'owner' })).id;
});
afterAll(async () => {
  await staffApp.close();
  await app.close();
});

// Every test starts with no senior moderator able to review: the ones earlier tests seeded are
// switched off (the owner can never be switched off; tests that need the owner ineligible make
// them involved in round 1).
beforeEach(async () => {
  await deps.db.query(`update staff_members set switched_off_at = $1 where role <> 'owner' and switched_off_at is null`, [START]);
  // These tests count the owner's pushes from the dispute timer. Auto-assign (owner 26 Nov 2026,
  // test/disputes/autoAssign.test.ts) would hand the earlier tests' pooled cases to a senior on
  // shift and alert on them; it is switched off here so only the no-reviewer alert is counted.
  await deps.db.query('update settings set auto_assign_on = false');
});

const tradeOf = (code: string) => `/v1/trades/${code}`;
const disputeOf = (code: string) => `/v1/trades/${code}/dispute`;
const appealOf = (code: string) => `/v1/trades/${code}/appeal`;

async function relogin(...who: { id: string; browser: Browser }[]) {
  for (const w of who) expect((await w.browser.post('/t/login', { accountId: w.id })).statusCode).toBe(200);
}

/** A staff member's log entry on the trade (any entry counts as involvement in round 1, R37). */
async function involve(code: string, id: string, role: 'mod' | 'senior' | 'owner') {
  const client = await deps.db.connect();
  try {
    await client.query('begin');
    await appendLog(client, { at: deps.clock(), actor: { kind: 'staff', id, role }, tradeCode: code, action: 'case.opened', detail: {} });
    await client.query('commit');
  } finally {
    client.release();
  }
}

/**
 * A trade the buyer disputed at START (marked paid one confirm window earlier) and a moderator
 * ruled at START + 1 h, so the appeal window ends at START + 49 h. `seller` may be a given account.
 */
async function ruled(o: { seller?: { id: string; browser: Browser }; outcome?: 'release-to-buyer' | 'refund-to-seller' } = {}) {
  setNow(new Date(START.getTime() - 120 * MIN));
  const seller = o.seller ?? (await trader());
  const buyer = await trader();
  const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
  const t = await driveTo(deps, trade, 'paid');
  setNow(START);
  await relogin(seller, buyer);
  expect((await buyer.browser.post(disputeOf(t.code), { reason: 'paid', note: '' })).statusCode).toBe(200);
  setNow(at(H));
  const modId = (await seedStaff(deps, { role: 'mod' })).id;
  await involve(t.code, modId, 'mod');
  await publishRuling(deps, t.code, { outcome: o.outcome ?? 'release-to-buyer', staffId: modId });
  return { seller, buyer, code: t.code, modId };
}

const appealUntil = async (b: Browser, code: string) => {
  const res = await b.get(tradeOf(code));
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { appealUntil?: unknown }).appealUntil;
};

async function ownerAlerts(code: string) {
  const { rows } = await deps.db.query<{ detail: { trade?: string } }>(
    `select detail from alerts where account_id = $1 and kind = 'appeal-no-reviewer' order by created_at`,
    [ownerId],
  );
  return rows.filter((r) => r.detail.trade === code);
}

async function staff(role: 'mod' | 'senior' | 'owner', id?: string) {
  const s = id ?? (await seedStaff(deps, { role })).id;
  const { token } = await insertSession(deps, s, 'staff');
  return { id: s, b: new StaffBrowser(staffApp).withSession(token) };
}

describe('D-005: the trade view says until when this viewer may file an appeal', () => {
  it('is null before a ruling, the window end for both sides once ruled, still there at 47 h 59 min and gone at 48 h', async () => {
    setNow(new Date(START.getTime() - 120 * MIN));
    const seller = await trader();
    const buyer = await trader();
    const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
    const t = await driveTo(deps, trade, 'paid');
    setNow(START);
    await relogin(seller, buyer);
    expect(await appealUntil(buyer.browser, t.code)).toBeNull();
    expect((await buyer.browser.post(disputeOf(t.code), { reason: 'paid', note: '' })).statusCode).toBe(200);
    expect(await appealUntil(buyer.browser, t.code)).toBeNull();
    setNow(at(H));
    await publishRuling(deps, t.code, { outcome: 'release-to-buyer' });
    expect(await appealUntil(buyer.browser, t.code)).toBe(iso(49 * H));
    expect(await appealUntil(seller.browser, t.code)).toBe(iso(49 * H));
    // The ruling at START + 1 h: 47 h 59 min after it the button is still there; at 48 h it is gone.
    setNow(at(48 * H + 59 * MIN));
    await relogin(seller, buyer);
    expect(await appealUntil(buyer.browser, t.code)).toBe(iso(49 * H));
    setNow(at(49 * H));
    expect(await appealUntil(buyer.browser, t.code)).toBeNull();
    expect(await appealUntil(seller.browser, t.code)).toBeNull();
  });

  it('is null for both sides once either side has appealed (one appeal only)', async () => {
    const { seller, buyer, code } = await ruled();
    setNow(at(2 * H));
    await relogin(seller, buyer);
    expect((await seller.browser.post(appealOf(code), { why: WHY })).statusCode).toBe(200);
    expect(await appealUntil(seller.browser, code)).toBeNull();
    expect(await appealUntil(buyer.browser, code)).toBeNull();
  });

  // Review S1 (lead call 12 Nov): the button opens the dispute page, which needs Answer the
  // moderator, so the deadline goes only to a member holding both boxes; an appeal-only member's
  // POST answers 204 with no dispute view (it cannot read that view through GET either).
  it('a team member sees it only with both the File an appeal and the Answer the moderator boxes', async () => {
    setNow(new Date(START.getTime() - 120 * MIN));
    const team = await trader();
    await makeVendor(deps, team.id);
    const { code } = await ruled({ seller: team });
    let n = 0;
    const member = async (abilities: string[]) => {
      const loginId = await seedAccount(deps, { loginName: `apmember${++n}x`, kind: 'member' });
      const name = `ApMember${n}`;
      await deps.db.query(
        `insert into team_members (account_id, trade_tag, display_key, abilities, invite_expires_at, member_account_id, joined_at, created_at)
         values ($1, $2, $3, $4, $5, $6, $5, $5)`,
        [team.id, name, name.toLowerCase(), abilities, deps.clock(), loginId],
      );
      const browser = new Browser(app);
      expect((await browser.post('/t/login', { accountId: loginId })).statusCode).toBe(200);
      return browser;
    };
    const withBox = await member(rolesToAbilities(['trades']));
    const noBox = await member(rolesToAbilities(['trades']).filter((a) => a !== 'disputes-appeal'));
    const appealOnly = await member(rolesToAbilities(['trades']).filter((a) => a !== 'disputes-answer'));
    expect(await appealUntil(withBox, code)).toBe(iso(49 * H));
    expect(await appealUntil(noBox, code)).toBeNull();
    expect(await appealUntil(appealOnly, code)).toBeNull();
    expect((await noBox.post(appealOf(code), { why: WHY })).statusCode).toBe(403);
    expect((await appealOnly.get(disputeOf(code))).statusCode).toBe(403);
    const res = await appealOnly.post(appealOf(code), { why: WHY });
    expect(res.statusCode, res.body).toBe(204);
    expect(res.body).toBe('');
    expect((await withBox.get(disputeOf(code))).json()).toMatchObject({ status: 'appealed', appeal: { by: 'seller' } });
  });
});

describe('D-010: one appeal, within 48 hours of the ruling, decided within ~48 hours, final', () => {
  it('the appeal round is due 48 hours after the appeal (its goal is its deadline) and its ruling is final', async () => {
    const { seller, buyer, code } = await ruled();
    setNow(at(5 * H));
    await relogin(seller, buyer);
    const v = (await seller.browser.post(appealOf(code), { why: WHY })).json() as Record<string, unknown>;
    expect(v).toMatchObject({ status: 'appealed', round: 2, dueAt: iso(53 * H), goalAt: iso(53 * H), appeal: { by: 'seller', at: iso(5 * H) } });
    // The other side cannot appeal too.
    expect((await buyer.browser.post(appealOf(code), { why: WHY })).json()).toMatchObject({ error: 'wrong-state' });
    await seedStaff(deps, { role: 'senior' });
    setNow(at(6 * H));
    await publishRuling(deps, code, { outcome: 'refund-to-seller' });
    await relogin(seller, buyer);
    const fin = (await buyer.browser.get(disputeOf(code))).json() as Record<string, unknown>;
    expect(fin).toMatchObject({ status: 'final', round: 2, ruling: { round: 2, appealUntil: null } });
    expect(await appealUntil(buyer.browser, code)).toBeNull();
    expect((await buyer.browser.post(appealOf(code), { why: WHY })).json()).toMatchObject({ error: 'wrong-state' });
  });
});

describe('D-011: no eligible reviewer', () => {
  it('every senior and the owner involved: the appeal waits, the owner is alerted once (in-app and push), both traders are told', async () => {
    const { seller, buyer, code } = await ruled();
    const senior = (await seedStaff(deps, { role: 'senior' })).id;
    await involve(code, senior, 'senior');
    await involve(code, ownerId, 'owner');
    const push = vi.spyOn(app.push, 'send');
    try {
      setNow(at(2 * H));
      await relogin(seller, buyer);
      const res = await buyer.browser.post(appealOf(code), { why: WHY });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toMatchObject({ status: 'appealed', appealWaiting: true });
      expect((await seller.browser.get(disputeOf(code))).json()).toMatchObject({ status: 'appealed', appealWaiting: true });
      expect(await ownerAlerts(code)).toEqual([{ detail: { trade: code } }]);
      expect(push.mock.calls).toContainEqual([ownerId, 'alert']);
      // The case stays in the queue: no involved person may take it.
      const s = await staff('senior', senior);
      expect((await s.b.post(`/staff/v1/disputes/${code}/take`)).statusCode).toBe(403);
    } finally {
      push.mockRestore();
    }
  });

  it('a fresh senior moderator added later ends the wait for the traders and the queue mark', async () => {
    const { seller, buyer, code } = await ruled();
    await involve(code, ownerId, 'owner');
    setNow(at(2 * H));
    await relogin(seller, buyer);
    expect((await buyer.browser.post(appealOf(code), { why: WHY })).json()).toMatchObject({ appealWaiting: true });
    const owner = await staff('owner', ownerId);
    // The owner was involved here, so the reviewer list refuses them (review M1); the queue marks the case.
    const queue = (await owner.b.get('/staff/v1/disputes')).json() as { rows: Array<{ code: string; noReviewer?: boolean }> };
    expect(queue.rows.find((r) => r.code === code)).toMatchObject({ noReviewer: true });

    const fresh = await staff('senior');
    expect((await buyer.browser.get(disputeOf(code))).json()).toMatchObject({ appealWaiting: false });
    const after = (await owner.b.get('/staff/v1/disputes')).json() as { rows: Array<{ code: string; noReviewer?: boolean }> };
    expect(after.rows.find((r) => r.code === code)).toMatchObject({ noReviewer: false });
    expect((await fresh.b.post(`/staff/v1/disputes/${code}/take`)).statusCode).toBe(200);
    // Taken by an eligible reviewer: nobody waits any more.
    expect((await buyer.browser.get(disputeOf(code))).json()).toMatchObject({ appealWaiting: false });
  });

  it('an uninvolved reviewer at filing: no owner alert and nobody is told to wait', async () => {
    const { seller, buyer, code } = await ruled();
    await seedStaff(deps, { role: 'senior' });
    setNow(at(2 * H));
    await relogin(seller, buyer);
    expect((await buyer.browser.post(appealOf(code), { why: WHY })).json()).toMatchObject({ status: 'appealed', appealWaiting: false });
    expect(await ownerAlerts(code)).toEqual([]);
  });

  it('a switched-off senior and an ordinary moderator are no reviewers; round 1 has no appealWaiting', async () => {
    const { seller, buyer, code } = await ruled();
    await involve(code, ownerId, 'owner');
    await seedStaff(deps, { role: 'senior', switchedOff: true });
    await seedStaff(deps, { role: 'mod' });
    expect((await buyer.browser.get(disputeOf(code))).json()).toMatchObject({ status: 'ruled', appealWaiting: false });
    setNow(at(2 * H));
    await relogin(seller, buyer);
    expect((await buyer.browser.post(appealOf(code), { why: WHY })).json()).toMatchObject({ appealWaiting: true });
    expect(await ownerAlerts(code)).toHaveLength(1);
  });

  // Lead call (12 Nov): a reviewer who drops away after the appeal was filed (switched off, removed,
  // disabled) leaves it reviewer-less; the dispute timer then alerts the owner once (in-app and push)
  // per transition into that state, never on every pass.
  it('the timer re-alerts the owner once per transition into no reviewer, and not again while it lasts', async () => {
    const { seller, buyer, code } = await ruled();
    await involve(code, ownerId, 'owner');
    const senior = (await seedStaff(deps, { role: 'senior' })).id;
    setNow(at(2 * H));
    await relogin(seller, buyer);
    expect((await buyer.browser.post(appealOf(code), { why: WHY })).json()).toMatchObject({ appealWaiting: false });
    const push = { send: vi.fn(async () => true) };
    const tick = () => disputeTimerJob(undefined, push).run(deps.db, deps.clock());
    await tick();
    expect(await ownerAlerts(code)).toEqual([]);
    // The only eligible reviewer is switched off: one alert and one push, however many passes run.
    await deps.db.query('update staff_members set switched_off_at = $2 where account_id = $1', [senior, deps.clock()]);
    await tick();
    await tick();
    expect(await ownerAlerts(code)).toEqual([{ detail: { trade: code } }]);
    expect(push.send.mock.calls).toEqual([[ownerId, 'alert']]);
    expect((await buyer.browser.get(disputeOf(code))).json()).toMatchObject({ appealWaiting: true });
    // Back on: no alert. Off again: a new transition, so one more alert and push.
    await deps.db.query('update staff_members set switched_off_at = null where account_id = $1', [senior]);
    await tick();
    expect(await ownerAlerts(code)).toHaveLength(1);
    await deps.db.query('update staff_members set switched_off_at = $2 where account_id = $1', [senior, deps.clock()]);
    await tick();
    await tick();
    expect(await ownerAlerts(code)).toHaveLength(2);
    expect(push.send.mock.calls).toEqual([[ownerId, 'alert'], [ownerId, 'alert']]);
  });

  it('an appeal already reviewer-less at filing is not alerted again by the timer; one whose reviewer took it and was then switched off is', async () => {
    const { seller, buyer, code } = await ruled();
    await involve(code, ownerId, 'owner');
    setNow(at(2 * H));
    await relogin(seller, buyer);
    expect((await buyer.browser.post(appealOf(code), { why: WHY })).json()).toMatchObject({ appealWaiting: true });
    const push = { send: vi.fn(async () => true) };
    await disputeTimerJob(undefined, push).run(deps.db, deps.clock());
    expect(await ownerAlerts(code)).toHaveLength(1);
    expect(push.send).not.toHaveBeenCalled();

    const other = await ruled();
    setNow(at(2 * H));
    await relogin(other.seller, other.buyer);
    await involve(other.code, ownerId, 'owner');
    const fresh = await staff('senior');
    expect((await other.buyer.browser.post(appealOf(other.code), { why: WHY })).statusCode).toBe(200);
    expect((await fresh.b.post(`/staff/v1/disputes/${other.code}/take`)).statusCode).toBe(200);
    // Taken by the only eligible reviewer: nobody waits.
    expect((await other.buyer.browser.get(disputeOf(other.code))).json()).toMatchObject({ appealWaiting: false });
    await disputeTimerJob(undefined, push).run(deps.db, deps.clock());
    expect(await ownerAlerts(other.code)).toEqual([]);
    // The assignee switched off can decide nothing: the appeal waits again, alerted once.
    await deps.db.query('update staff_members set switched_off_at = $2 where account_id = $1', [fresh.id, deps.clock()]);
    await disputeTimerJob(undefined, push).run(deps.db, deps.clock());
    await disputeTimerJob(undefined, push).run(deps.db, deps.clock());
    expect(await ownerAlerts(other.code)).toHaveLength(1);
    expect(push.send.mock.calls).toEqual([[ownerId, 'alert']]);
    expect((await other.buyer.browser.get(disputeOf(other.code))).json()).toMatchObject({ appealWaiting: true });
  });

  // Review M1 (lead call 12 Nov): the reviewer list is the owner's alone (the owner acts on D-011),
  // an involved caller is refused whatever their role, and a read is never logged (R37 counts any
  // log entry on the trade as involvement).
  it('the reviewer list is owner-only, refuses an involved caller, and is never logged', async () => {
    const { seller, buyer, code } = await ruled();
    const involvedSenior = await staff('senior');
    await involve(code, involvedSenior.id, 'senior');
    await involve(code, ownerId, 'owner');
    setNow(at(2 * H));
    await relogin(seller, buyer);
    expect((await buyer.browser.post(appealOf(code), { why: WHY })).statusCode).toBe(200);
    const url = `/staff/v1/disputes/${code}/appeal-reviewers`;
    const mod = await staff('mod');
    const freshSenior = await staff('senior');
    expect((await mod.b.get(url)).statusCode).toBe(403);
    expect((await freshSenior.b.get(url)).statusCode).toBe(403);
    expect((await involvedSenior.b.get(url)).statusCode).toBe(403);
    const logCount = async () =>
      Number((await deps.db.query<{ n: string }>('select count(*) as n from activity_log where trade_code = $1', [code])).rows[0]!.n);
    const before = await logCount();
    // The owner was involved in round 1: refused too.
    const owner = await staff('owner', ownerId);
    const res = await owner.b.get(url);
    expect({ status: res.statusCode, error: (res.json() as { error?: string }).error }).toEqual({ status: 403, error: 'forbidden-case' });
    expect(await logCount()).toBe(before);

    // An uninvolved owner reads it, unlogged, and stays uninvolved. One senior was involved in this
    // case's round 1 (R37): the list names exactly the owner and the fresh senior, never that one.
    const other = await ruled();
    await involve(other.code, involvedSenior.id, 'senior');
    setNow(at(2 * H));
    await relogin(other.seller, other.buyer);
    expect((await other.buyer.browser.post(appealOf(other.code), { why: WHY })).statusCode).toBe(200);
    const n = Number((await deps.db.query<{ n: string }>('select count(*) as n from activity_log where trade_code = $1', [other.code])).rows[0]!.n);
    const ok = await owner.b.get(`/staff/v1/disputes/${other.code}/appeal-reviewers`);
    expect(ok.statusCode, ok.body).toBe(200);
    const nameOf = async (id: string) =>
      (await deps.db.query<{ trade_tag: string }>('select trade_tag from accounts where id = $1', [id])).rows[0]!.trade_tag;
    const body = ok.json() as { reviewers: Array<{ name: string }>; waiting: boolean };
    expect(body.waiting).toBe(false);
    expect(body.reviewers.map((r) => r.name).sort()).toEqual([await nameOf(ownerId), await nameOf(freshSenior.id)].sort());
    expect(body.reviewers.map((r) => r.name)).not.toContain(await nameOf(involvedSenior.id));
    expect(Number((await deps.db.query<{ n: string }>('select count(*) as n from activity_log where trade_code = $1', [other.code])).rows[0]!.n)).toBe(n);
  });
});
