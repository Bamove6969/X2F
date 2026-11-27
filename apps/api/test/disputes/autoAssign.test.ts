// Owner decision (Jess, 26 Nov 2026), "Pool first, auto-assign if untaken": cases wait in the pool;
// one nobody takes within the owner's setting (lead default 15 minutes) goes, on the dispute timer's
// pass, to the least-busy moderator on shift. Seniors and the owner can still reassign.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deps } from '../../src/app.js';
import { AUTO_ASSIGN_LOCK_KEY } from '../../src/disputes/autoAssign.js';
import { NO_MODERATION } from '../../src/disputes/moderationClient.js';
import { disputeTimerJob } from '../../src/disputes/timers.js';
import { appendLog } from '../../src/log/append.js';
import { buildStaffApi } from '../../src/staff/app.js';
import { publishRuling } from '../helpers/disputes.js';
import { STAFF_ORIGIN, StaffBrowser, insertSession, seedStaff } from '../helpers/staffApp.js';
import { tradeApp } from '../helpers/tradeApp.js';
import { Browser } from '../helpers/totp.js';
import { driveTo, seedTrade } from '../helpers/trades.js';

let app: FastifyInstance;
let staffApp: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];
let ownerId: string;

const START = new Date('2026-11-27T12:00:00Z');
const MIN = 60_000;
const H = 60 * MIN;
let base = START.getTime();
const at = (ms: number) => new Date(base + ms);
const push = { send: vi.fn(async () => true) };
const tick = () => disputeTimerJob(undefined, push).run(deps.db, deps.clock());

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

// Each test starts on its own day with nobody on shift, every earlier case out of the pool (paused)
// and the default settings.
beforeEach(async () => {
  base += 3 * 24 * H;
  setNow(at(0));
  await deps.db.query(`update sessions set revoked_at = $1 where app = 'staff' and revoked_at is null`, [at(0)]);
  await deps.db.query(`update disputes set paused_since = $1 where status <> 'closed' and paused_since is null`, [at(0)]);
  await deps.db.query('update settings set auto_assign_min = 15, auto_assign_on = true');
  push.send.mockClear();
});

/** A dispute the buyer opened at `at(when)`: in the pool, its first reply due 4 hours later. */
async function openCase(when = 0): Promise<{ code: string; seller: string; buyer: string }> {
  setNow(at(when - 2 * H));
  const s = await trader();
  const b = await trader();
  const { trade } = await seedTrade(deps, { sellerId: s.id, buyerId: b.id, poster: 'seller' });
  const t = await driveTo(deps, trade, 'paid');
  setNow(at(when));
  expect((await b.browser.post('/t/login', { accountId: b.id })).statusCode).toBe(200);
  const res = await b.browser.post(`/v1/trades/${t.code}/dispute`, { reason: 'paid', note: '' });
  expect(res.statusCode, res.body).toBe(200);
  return { code: t.code, seller: s.id, buyer: b.id };
}

/** A staff member clocked in now (a live staff session, whose shift migration 420's trigger opens). */
async function onShift(role: 'mod' | 'senior' | 'owner' | 'helper', id?: string) {
  const sid = id ?? (await seedStaff(deps, { role })).id;
  const { token, sessionId } = await insertSession(deps, sid, 'staff');
  return { id: sid, sessionId, b: new StaffBrowser(staffApp).withSession(token) };
}

const row = async (code: string) =>
  (await deps.db.query<{ assignee: string | null; auto_assigned: boolean; assigned_at: Date | null; pooled_at: Date | null; pool_alert_round: number | null }>(
    `select assignee::text as assignee, auto_assigned, assigned_at, pooled_at, pool_alert_round from disputes where code = $1 order by seq desc limit 1`,
    [code],
  )).rows[0]!;

const assignedLog = async (code: string) =>
  (await deps.db.query<{ actor_kind: string; actor_id: string | null; detail: string }>(
    `select actor_kind, actor_id::text as actor_id, detail from activity_log where trade_code = $1 and action = 'dispute.assigned' order by id`,
    [code],
  )).rows.map((r) => ({ actor: r.actor_kind, actorId: r.actor_id, detail: JSON.parse(r.detail) as Record<string, unknown> }));

const alertsOf = async (accountId: string, kind: string) =>
  (await deps.db.query<{ detail: Record<string, unknown> }>(`select detail from alerts where account_id = $1 and kind = $2 order by created_at, id`, [accountId, kind])).rows.map((r) => r.detail);

describe('auto-assign: the pool time', () => {
  it('a case untaken for 15 minutes goes to the moderator on shift, logged as automatic, with an alert and a push', async () => {
    const { code } = await openCase();
    const mod = await onShift('mod');
    // The owner on shift too, idle: never auto-assigned (lead default).
    await onShift('owner', ownerId);
    setNow(at(14 * MIN + 59_000));
    await tick();
    expect((await row(code)).assignee).toBeNull();
    // The queue says when it will be assigned.
    const q1 = (await mod.b.get('/staff/v1/disputes?filter=free')).json() as { rows: { code: string; autoAssignAt: string | null }[]; settings: { autoAssign: unknown } };
    expect(q1.settings.autoAssign).toEqual({ on: true, minutes: 15 });
    expect(q1.rows.find((r) => r.code === code)?.autoAssignAt).toBe(at(15 * MIN).toISOString());

    setNow(at(15 * MIN));
    await tick();
    const r = await row(code);
    expect(r).toMatchObject({ assignee: mod.id, auto_assigned: true });
    expect(r.assigned_at?.toISOString()).toBe(at(15 * MIN).toISOString());
    const log = await assignedLog(code);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actor: 'system', actorId: null, detail: { staffId: mod.id, auto: true } });
    expect(await alertsOf(mod.id, 'dispute-auto-assigned')).toEqual([{ trade: code }]);
    expect(push.send.mock.calls).toEqual([[mod.id, 'alert']]);

    // "Assigned to you automatically": the queue row and the case view.
    const q2 = (await mod.b.get('/staff/v1/disputes?filter=mine')).json() as { rows: { code: string; autoAssigned: boolean; autoAssignAt: string | null }[] };
    expect(q2.rows.find((x) => x.code === code)).toMatchObject({ autoAssigned: true, autoAssignAt: null });
    const c = (await mod.b.get(`/staff/v1/disputes/${code}`)).json() as { assignedToYou: boolean; autoAssigned: boolean; taken: { auto: boolean; at: string } | null };
    expect(c).toMatchObject({ assignedToYou: true, autoAssigned: true, taken: { auto: true, at: at(15 * MIN).toISOString() } });

    // Another pass changes nothing.
    await tick();
    expect(await assignedLog(code)).toHaveLength(1);
  });

  it("follows the owner's setting, and does nothing while it is off", async () => {
    const owner0 = await onShift('owner', ownerId);
    const bad = await owner0.b.send('PUT', '/staff/v1/settings', { autoAssignMin: 0 });
    expect(bad.statusCode).toBe(400);
    expect((await owner0.b.send('PUT', '/staff/v1/settings', { autoAssignMin: 1441 })).statusCode).toBe(400);
    expect((await owner0.b.send('PUT', '/staff/v1/settings', { autoAssignOn: 'yes' })).statusCode).toBe(400);
    const ok = await owner0.b.send('PUT', '/staff/v1/settings', { autoAssignMin: 30, autoAssignOn: false });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ autoAssignMin: 30, autoAssignOn: false });
    const changes = (await deps.db.query<{ detail: string }>(
      `select detail from activity_log where action = 'settings.changed' and at = $1 order by id`, [deps.clock()],
    )).rows.map((x) => JSON.parse(x.detail) as unknown);
    expect(changes).toEqual([{ field: 'autoAssignMin', from: 15, to: 30 }, { field: 'autoAssignOn', from: true, to: false }]);
    await deps.db.query(`update sessions set revoked_at = $1 where id = $2`, [deps.clock(), owner0.sessionId]);

    const { code } = await openCase();
    const mod = await onShift('mod');
    setNow(at(31 * MIN));
    await tick();
    expect((await row(code)).assignee).toBeNull();
    const q = (await mod.b.get('/staff/v1/disputes?filter=free')).json() as { rows: { code: string; autoAssignAt: string | null }[] };
    expect(q.rows.find((r) => r.code === code)?.autoAssignAt).toBeNull();
    // Off, a case past its reply deadline alerts nobody either.
    setNow(at(4 * H + MIN));
    await deps.db.query('update sessions set expires_at = $2 where id = $1', [mod.sessionId, at(5 * H)]);
    await tick();
    expect((await alertsOf(ownerId, 'dispute-unassigned-overdue')).filter((d) => d.trade === code)).toEqual([]);
    await deps.db.query('update settings set auto_assign_on = true');
    await tick();
    expect((await row(code)).assignee).toBe(mod.id);
    // Assigned before the alert step ran: no alert.
    expect((await alertsOf(ownerId, 'dispute-unassigned-overdue')).filter((d) => d.trade === code)).toEqual([]);
  });
});

describe('auto-assign: who gets it', () => {
  it('the fewest open cases first; ties go to the least recently assigned, then the id', async () => {
    const a = await onShift('mod');
    const b = await onShift('mod');
    // `a` already works a case it took: `b` is less busy.
    const first = await openCase();
    expect((await a.b.post(`/staff/v1/disputes/${first.code}/take`)).statusCode).toBe(200);
    const second = await openCase();
    setNow(at(15 * MIN));
    await tick();
    expect((await row(second.code)).assignee).toBe(b.id);
    // Now one each; `a` was assigned at 0, `b` at 15 min: `a` is the least recently assigned.
    const third = await openCase(15 * MIN);
    setNow(at(30 * MIN));
    await tick();
    expect((await row(third.code)).assignee).toBe(a.id);
    // `a` has two now, `b` one: `b`.
    const fourth = await openCase(30 * MIN);
    setNow(at(45 * MIN));
    await tick();
    expect((await row(fourth.code)).assignee).toBe(b.id);
  });

  it('two never-assigned people tie on load and time: the lower id wins', async () => {
    const x = await onShift('mod');
    const y = await onShift('mod');
    const { code } = await openCase();
    setNow(at(15 * MIN));
    await tick();
    expect((await row(code)).assignee).toBe([x.id, y.id].sort()[0]);
  });

  it('never the owner, nor someone off shift, switched off, removed, locked, disabled or a helper', async () => {
    const { code } = await openCase();
    await onShift('owner', ownerId);
    await onShift('helper');
    const off = await onShift('mod');
    await deps.db.query('update staff_members set switched_off_at = $2 where account_id = $1', [off.id, deps.clock()]);
    const removed = await onShift('mod');
    await deps.db.query('update staff_members set removed_at = $2, switched_off_at = $2 where account_id = $1', [removed.id, deps.clock()]);
    const locked = await onShift('mod');
    await deps.db.query('insert into account_locks (account_id, locked_at, set_disabled) values ($1, $2, false)', [locked.id, deps.clock()]);
    const disabled = await onShift('mod');
    await deps.db.query('update accounts set disabled_at = $2 where id = $1', [disabled.id, deps.clock()]);
    // Clocked out (the session revoked, the shift ended) and a session that ran out.
    const out = await onShift('mod');
    await deps.db.query('update sessions set revoked_at = $2 where id = $1', [out.sessionId, deps.clock()]);
    const expired = await onShift('mod');
    await deps.db.query('update sessions set expires_at = $2 where id = $1', [expired.sessionId, at(10 * MIN)]);
    setNow(at(15 * MIN));
    await tick();
    expect((await row(code)).assignee).toBeNull();
    const mod = await onShift('mod');
    await tick();
    expect((await row(code)).assignee).toBe(mod.id);
  });

  it("an appeal goes only to a senior who had no part in round 1, from the appeal's time", async () => {
    const { code, buyer } = await openCase();
    const ruler = await onShift('mod');
    const involvedSenior = await onShift('senior');
    setNow(at(5 * MIN));
    await publishRuling(deps, code, { outcome: 'release-to-buyer', staffId: ruler.id });
    const client = await deps.db.connect();
    try {
      await client.query('begin');
      await appendLog(client, { at: deps.clock(), actor: { kind: 'staff', id: involvedSenior.id, role: 'senior' }, tradeCode: code, action: 'case.opened', detail: {} });
      await client.query('commit');
    } finally {
      client.release();
    }
    await deps.db.query(`update disputes set seen = array_append(seen, $2::uuid) where code = $1`, [code, involvedSenior.id]);
    // The owner (on shift) is never auto-assigned: only a fresh senior gets it.
    await onShift('owner', ownerId);
    setNow(at(H));
    const bb = new Browser(app);
    expect((await bb.post('/t/login', { accountId: buyer })).statusCode).toBe(200);
    const res = await bb.post(`/v1/trades/${code}/appeal`, { why: 'The moderator missed my bank statement.' });
    expect(res.statusCode, res.body).toBe(200);
    const r = await row(code);
    expect(r.assignee).toBeNull();
    expect(r.pooled_at?.toISOString()).toBe(at(H).toISOString());
    // 15 minutes after the appeal, not after the opening: nobody eligible yet.
    setNow(at(H + 15 * MIN));
    await tick();
    expect((await row(code)).assignee).toBeNull();
    const fresh = await onShift('senior');
    await tick();
    expect((await row(code)).assignee).toBe(fresh.id);
    expect((await assignedLog(code)).at(-1)).toMatchObject({ actor: 'system', detail: { staffId: fresh.id, auto: true } });
  });
});

describe('auto-assign: nobody on shift', () => {
  it('the case stays in the pool; past its reply deadline the owner and the seniors are alerted once; a clock-in assigns the oldest first', async () => {
    const older = await openCase();
    const newer = await openCase(MIN);
    const senior = (await seedStaff(deps, { role: 'senior' })).id;
    setNow(at(3 * H));
    await tick();
    expect((await row(older.code)).assignee).toBeNull();
    expect(await alertsOf(ownerId, 'dispute-unassigned-overdue')).not.toContainEqual({ trade: older.code, round: 1 });
    // The reply deadline (4 hours) passes: one alert each, once.
    setNow(at(4 * H + MIN));
    await tick();
    await tick();
    expect((await alertsOf(ownerId, 'dispute-unassigned-overdue')).filter((d) => d.trade === older.code)).toEqual([{ trade: older.code, round: 1 }]);
    expect((await alertsOf(senior, 'dispute-unassigned-overdue')).filter((d) => d.trade === older.code)).toEqual([{ trade: older.code, round: 1 }]);
    expect((await row(older.code)).pool_alert_round).toBe(1);
    expect(push.send.mock.calls).toContainEqual([ownerId, 'alert']);
    expect(push.send.mock.calls).toContainEqual([senior, 'alert']);
    // A moderator clocks in: the next pass hands both out, the older one first (to the least busy then).
    const mod = await onShift('mod');
    await tick();
    expect((await row(older.code)).assignee).toBe(mod.id);
    const order = (await deps.db.query<{ trade_code: string }>(
      `select trade_code from activity_log where action = 'dispute.assigned' and trade_code = any($1::text[]) order by id`,
      [[older.code, newer.code]],
    )).rows.map((x) => x.trade_code);
    expect(order).toEqual([older.code, newer.code]);
  });

  it("a moderator's cases stay with them when they clock out", async () => {
    const { code } = await openCase();
    const mod = await onShift('mod');
    setNow(at(15 * MIN));
    await tick();
    expect((await row(code)).assignee).toBe(mod.id);
    await deps.db.query('update sessions set revoked_at = $2 where id = $1', [mod.sessionId, deps.clock()]);
    await onShift('mod');
    setNow(at(H));
    await tick();
    expect((await row(code)).assignee).toBe(mod.id);
  });

  it('a switched-off moderator\'s case goes back to the pool and waits the full time again', async () => {
    const { code } = await openCase();
    const mod = await onShift('mod');
    setNow(at(15 * MIN));
    await tick();
    expect((await row(code)).assignee).toBe(mod.id);
    setNow(at(20 * MIN));
    const owner0 = await onShift('owner', ownerId);
    // The owner switches the moderator off (Task 7): the case goes back to the pool now.
    const res = await owner0.b.post(`/staff/v1/members/${mod.id}/switch-off`, {});
    expect(res.statusCode, res.body).toBe(200);
    expect(await row(code)).toMatchObject({ assignee: null, auto_assigned: false });
    expect((await row(code)).pooled_at?.toISOString()).toBe(at(20 * MIN).toISOString());
    await deps.db.query(`update sessions set revoked_at = $1 where id = $2`, [deps.clock(), owner0.sessionId]);
    const other = await onShift('mod');
    setNow(at(34 * MIN));
    await tick();
    expect((await row(code)).assignee).toBeNull();
    setNow(at(35 * MIN));
    await tick();
    expect(await row(code)).toMatchObject({ assignee: other.id, auto_assigned: true });
  });
});

describe('auto-assign: races and reassigning', () => {
  it("a moderator's Take racing the timer never double-assigns", async () => {
    for (let i = 0; i < 4; i++) {
      const { code } = await openCase();
      const taker = await onShift('mod');
      setNow(at(15 * MIN));
      const [res] = await Promise.all([taker.b.post(`/staff/v1/disputes/${code}/take`), tick()]);
      const log = await assignedLog(code);
      expect(log, JSON.stringify(log)).toHaveLength(1);
      const r = await row(code);
      if (res.statusCode === 200) expect(r).toMatchObject({ assignee: taker.id, auto_assigned: false });
      else {
        expect(res.statusCode).toBe(409);
        expect(r.auto_assigned).toBe(true);
      }
      await deps.db.query(`update sessions set revoked_at = $1 where app = 'staff' and revoked_at is null`, [deps.clock()]);
      await deps.db.query(`update disputes set paused_since = $1 where status <> 'closed' and paused_since is null`, [deps.clock()]);
      base += H;
      setNow(at(0));
    }
  });

  it('the timer waits on its advisory lock while another pass holds it', async () => {
    const { code } = await openCase();
    const mod = await onShift('mod');
    setNow(at(15 * MIN));
    const holder = await deps.db.connect();
    try {
      await holder.query('begin');
      await holder.query('select pg_advisory_xact_lock($1)', [AUTO_ASSIGN_LOCK_KEY]);
      const pass = tick();
      await new Promise((r) => setTimeout(r, 150));
      expect((await row(code)).assignee).toBeNull();
      await holder.query('commit');
      await pass;
    } finally {
      holder.release();
    }
    expect((await row(code)).assignee).toBe(mod.id);
  });

  it("a senior's take of an auto-assigned case reassigns it and clears the mark", async () => {
    const { code } = await openCase();
    const mod = await onShift('mod');
    setNow(at(15 * MIN));
    await tick();
    expect((await row(code)).auto_assigned).toBe(true);
    const senior = await onShift('senior');
    expect((await senior.b.post(`/staff/v1/disputes/${code}/take`)).statusCode).toBe(200);
    expect(await row(code)).toMatchObject({ assignee: senior.id, auto_assigned: false });
    const c = (await mod.b.get(`/staff/v1/disputes?filter=all`)).json() as { rows: { code: string; autoAssigned: boolean; mine: boolean }[] };
    expect(c.rows.find((x) => x.code === code)).toMatchObject({ autoAssigned: false, mine: false });
  });
});

// Tests for PR #42 (added after the merge): how the timer spreads cases when several arrive together,
// how the tie-break is ordered, and who is "on shift". The order the code uses
// (autoAssign.ts onShiftCandidates): the fewest open assigned cases (status open, awaiting-approval
// or appealed, latest round only), then the oldest `assigned_at` of any case ever assigned to them
// (never assigned first), then the account id; cases are handed out oldest pool time first, then by
// trade code, one transaction each, so every case sees the load the one before it left.
describe('auto-assign: cases arriving together (PR #42 follow-up tests)', () => {
  const assigneesOf = async (codes: string[]) => Promise.all(codes.map(async (c) => (await row(c)).assignee));

  it('two cases due in the same pass go one to each of two idle moderators, never both to one', async () => {
    const a = await onShift('mod');
    const b = await onShift('mod');
    const one = await openCase();
    const two = await openCase();
    setNow(at(15 * MIN));
    await tick();
    expect(new Set(await assigneesOf([one.code, two.code]))).toEqual(new Set([a.id, b.id]));
    // Same pool time: the lower trade code goes first, to the lower id (both never assigned).
    const [firstCode, secondCode] = [one.code, two.code].sort();
    const [lo, hi] = [a.id, b.id].sort();
    expect((await row(firstCode!)).assignee).toBe(lo);
    expect((await row(secondCode!)).assignee).toBe(hi);
    // Now one each, both assigned at the same instant: a full tie, the lower id gets the next one.
    const three = await openCase(15 * MIN);
    setNow(at(30 * MIN));
    await tick();
    expect((await row(three.code)).assignee).toBe(lo);
  });

  it('three cases and two idle moderators in one pass split 2 and 1, oldest case first', async () => {
    const a = await onShift('mod');
    const b = await onShift('mod');
    const cases = [await openCase(), await openCase(MIN), await openCase(2 * MIN)];
    setNow(at(17 * MIN));
    await tick();
    const got = await assigneesOf(cases.map((c) => c.code));
    expect([a.id, b.id].map((id) => got.filter((x) => x === id).length).sort()).toEqual([1, 2]);
    // The first two go one each; the third to whoever got the first (the less recently assigned).
    expect(got[0]).not.toBe(got[1]);
    expect(got[2]).toBe(got[0]);
  });

  it('two timer passes running at once (two API processes) still split two cases between two moderators', async () => {
    const a = await onShift('mod');
    const b = await onShift('mod');
    const one = await openCase();
    const two = await openCase();
    setNow(at(15 * MIN));
    await Promise.all([tick(), tick()]);
    expect(new Set(await assigneesOf([one.code, two.code]))).toEqual(new Set([a.id, b.id]));
    expect(await assignedLog(one.code)).toHaveLength(1);
    expect(await assignedLog(two.code)).toHaveLength(1);
  });

  it('a busy moderator gets nothing while a less busy one is on shift, even with several cases due', async () => {
    const busy = await onShift('mod');
    const idle = await onShift('mod');
    // `busy` already works two cases it took.
    for (let i = 0; i < 2; i++) {
      const c = await openCase();
      expect((await busy.b.post(`/staff/v1/disputes/${c.code}/take`)).statusCode).toBe(200);
    }
    const one = await openCase();
    const two = await openCase();
    setNow(at(15 * MIN));
    await tick();
    // 2 vs 0: the idle one gets the first; 2 vs 1: and the second.
    expect(await assigneesOf([one.code, two.code])).toEqual([idle.id, idle.id]);
  });
});

describe('auto-assign: what counts as load and as the tie-break (PR #42 follow-up tests)', () => {
  it('a closed case is not load, but it still counts as "last assigned": someone never assigned wins the tie', async () => {
    const veteran = await onShift('mod');
    const fresh = await onShift('mod');
    const old = await openCase();
    expect((await veteran.b.post(`/staff/v1/disputes/${old.code}/take`)).statusCode).toBe(200);
    await deps.db.query(`update disputes set status = 'closed', closed_at = $2 where code = $1`, [old.code, deps.clock()]);
    const next = await openCase(MIN);
    setNow(at(16 * MIN));
    await tick();
    expect((await row(next.code)).assignee).toBe(fresh.id);
    // That one closes too: 0 open each; `veteran` was assigned longer ago, so it goes there.
    await deps.db.query(`update disputes set status = 'closed', closed_at = $2 where code = $1`, [next.code, deps.clock()]);
    const third = await openCase(16 * MIN);
    setNow(at(31 * MIN));
    await tick();
    expect((await row(third.code)).assignee).toBe(veteran.id);
  });

  it('an assigned case awaiting approval or appealed counts as load', async () => {
    for (const status of ['awaiting-approval', 'appealed'] as const) {
      const a = await onShift('mod');
      const b = await onShift('mod');
      // `lo` holds one case in this status; `hi` holds nothing, so it wins despite the higher id.
      const [lo, hi] = [a, b].sort((x, y) => (x.id < y.id ? -1 : 1));
      const held = await openCase();
      expect((await lo!.b.post(`/staff/v1/disputes/${held.code}/take`)).statusCode).toBe(200);
      await deps.db.query('update disputes set status = $2 where code = $1', [held.code, status]);
      const next = await openCase(MIN);
      setNow(at(16 * MIN));
      await tick();
      expect((await row(next.code)).assignee, status).toBe(hi!.id);
      // A fresh day for the next status.
      await deps.db.query(`update sessions set revoked_at = $1 where app = 'staff' and revoked_at is null`, [deps.clock()]);
      await deps.db.query(`update disputes set paused_since = $1 where status <> 'closed' and paused_since is null`, [deps.clock()]);
      base += 24 * H;
      setNow(at(0));
    }
  });
});

describe('auto-assign: off shift is never assigned (PR #42 follow-up tests)', () => {
  it('a moderator whose shift was clocked out while the session row is still live is off shift', async () => {
    const { code } = await openCase();
    const out = await onShift('mod');
    await deps.db.query(`update staff_shifts set ended = 'clock-out', ended_at = $2 where session_id = $1`, [out.sessionId, deps.clock()]);
    setNow(at(15 * MIN));
    await tick();
    expect((await row(code)).assignee).toBeNull();
  });

  it('a moderator signed in only to the trader app is off shift', async () => {
    const { code } = await openCase();
    const mod = (await seedStaff(deps, { role: 'mod' })).id;
    await insertSession(deps, mod, 'trader');
    setNow(at(15 * MIN));
    await tick();
    expect((await row(code)).assignee).toBeNull();
  });

  it('a moderator who clocks out between two passes gets nothing on the second; the new case stays in the pool', async () => {
    const first = await openCase();
    const mod = await onShift('mod');
    setNow(at(15 * MIN));
    await tick();
    expect((await row(first.code)).assignee).toBe(mod.id);
    await deps.db.query('update sessions set revoked_at = $2 where id = $1', [mod.sessionId, deps.clock()]);
    const second = await openCase(15 * MIN);
    setNow(at(H));
    await tick();
    expect((await row(second.code)).assignee).toBeNull();
    // Their earlier case stays theirs (lead default).
    expect((await row(first.code)).assignee).toBe(mod.id);
  });

  it('nobody on shift at all: several overdue cases all stay in the pool, nothing logged or pushed', async () => {
    const cases = [await openCase(), await openCase(), await openCase()];
    // A moderator exists but is not clocked in.
    const idle = (await seedStaff(deps, { role: 'mod' })).id;
    setNow(at(2 * H));
    await tick();
    for (const c of cases) {
      expect((await row(c.code)).assignee).toBeNull();
      expect(await assignedLog(c.code)).toEqual([]);
    }
    expect(await alertsOf(idle, 'dispute-auto-assigned')).toEqual([]);
    expect(push.send.mock.calls.filter((c) => (c as unknown[])[0] === idle)).toEqual([]);
  });

  it("a moderator on shift who is the trade's seller is never assigned that trade's case", async () => {
    const mod = await onShift('mod');
    setNow(at(-2 * H));
    const b = await trader();
    const { trade } = await seedTrade(deps, { sellerId: mod.id, buyerId: b.id, poster: 'seller' });
    const t = await driveTo(deps, trade, 'paid');
    setNow(at(0));
    expect((await b.browser.post('/t/login', { accountId: b.id })).statusCode).toBe(200);
    const res = await b.browser.post(`/v1/trades/${t.code}/dispute`, { reason: 'paid', note: '' });
    expect(res.statusCode, res.body).toBe(200);
    setNow(at(15 * MIN));
    await tick();
    expect((await row(t.code)).assignee).toBeNull();
    const other = await onShift('mod');
    await tick();
    expect((await row(t.code)).assignee).toBe(other.id);
  });
});

describe('auto-assign: round-2 escalation and settings bounds (#42)', () => {
  it('a round-1 overdue alert does not suppress round-2 overdue alert when no eligible senior is on shift', async () => {
    const { code, buyer } = await openCase();
    const senior = (await seedStaff(deps, { role: 'senior' })).id;
    // Round 1 goes past its 4h reply deadline with nobody on shift -> round-1 alert fires.
    setNow(at(4 * H + MIN));
    await tick();
    expect((await row(code)).pool_alert_round).toBe(1);
    expect((await alertsOf(ownerId, 'dispute-unassigned-overdue')).filter((d) => d.trade === code)).toEqual([{ trade: code, round: 1 }]);

    // A moderator handles round 1 and publishes a ruling; buyer appeals.
    const mod = await onShift('mod');
    await publishRuling(deps, code, { outcome: 'release-to-buyer', staffId: mod.id });
    await deps.db.query(`update sessions set revoked_at = $2 where id = $1`, [mod.sessionId, deps.clock()]);
    setNow(at(5 * H));
    const bb = new Browser(app);
    expect((await bb.post('/t/login', { accountId: buyer })).statusCode).toBe(200);
    expect((await bb.post(`/v1/trades/${code}/appeal`, { why: 'Need senior review.' })).statusCode).toBe(200);

    // Round 2 goes past its reply deadline with no senior on shift -> round-2 alert fires once.
    setNow(at(10 * H));
    await tick();
    await tick();
    expect((await row(code)).pool_alert_round).toBe(2);
    expect((await alertsOf(ownerId, 'dispute-unassigned-overdue')).filter((d) => d.trade === code)).toEqual([
      { trade: code, round: 1 },
      { trade: code, round: 2 },
    ]);
    expect((await alertsOf(senior, 'dispute-unassigned-overdue')).filter((d) => d.trade === code)).toEqual([
      { trade: code, round: 1 },
      { trade: code, round: 2 },
    ]);
  });

  it('enforces owner-only access and exact 1..1440 minute boundaries on auto-assign settings', async () => {
    const mod = await onShift('mod');
    const senior = await onShift('senior');
    const owner = await onShift('owner', ownerId);
    expect((await mod.b.send('PUT', '/staff/v1/settings', { autoAssignMin: 10 })).statusCode).toBe(403);
    expect((await senior.b.send('PUT', '/staff/v1/settings', { autoAssignOn: false })).statusCode).toBe(403);
    expect((await owner.b.send('PUT', '/staff/v1/settings', { autoAssignMin: 1 })).statusCode).toBe(200);
    expect((await owner.b.send('PUT', '/staff/v1/settings', { autoAssignMin: 1440 })).statusCode).toBe(200);
    expect((await owner.b.send('PUT', '/staff/v1/settings', { autoAssignMin: 15.5 })).statusCode).toBe(400);
  });
});
