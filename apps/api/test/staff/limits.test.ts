// Plan 4 Task 26 (Revision 2026-10-29, owner): no automatic stage drop for a lost dispute. A moderator
// recommends account limits for a habitual offender or an obvious hit-and-run case; a senior
// moderator or the owner, never the one who recommended them, decides with a security-key tap. An
// approved limit lowers the account's cap (`tradeCap`: the lower of the stage's and the limit's).
// Each step writes the activity log; the reason is staff-only.
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../../src/app.js';
import { buildStaffApi } from '../../src/staff/app.js';
import { tradeCap } from '../../src/traders/stage.js';
import { seedAccount } from '../helpers/accounts.js';
import { MODERATION_STUB, STAFF_ORIGIN, StaffBrowser, errorOf, insertSession, logEntries, seedStaff, seedTap } from '../helpers/staffApp.js';
import { tradeApp } from '../helpers/tradeApp.js';
import { driveTo, seedTrade } from '../helpers/trades.js';

const START = new Date('2026-11-20T12:00:00Z');
const MIN = 60_000;
const DAY = 86_400_000;
const REASON = 'Three disputes in a month, each a buyer who never paid and walked away.';

let trader: FastifyInstance;
let staffApp: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let newTrader: Awaited<ReturnType<typeof tradeApp>>['trader'];

beforeAll(async () => {
  const t = await tradeApp();
  ({ app: trader, deps, setNow } = t);
  newTrader = t.trader;
  setNow(START);
  staffApp = await buildStaffApi({ ...deps, staffOrigin: STAFF_ORIGIN, moderation: MODERATION_STUB, traderEvents: trader.events });
});
afterAll(async () => {
  await staffApp.close();
  await trader.close();
});

async function staff(role: 'mod' | 'senior' | 'owner' | 'helper') {
  const s = await seedStaff(deps, { role });
  const { token } = await insertSession(deps, s.id, 'staff');
  return { id: s.id, b: new StaffBrowser(staffApp).withSession(token) };
}
let theOwner: Awaited<ReturnType<typeof staff>> | null = null;
const ownerOnce = async () => (theOwner ??= await staff('owner'));

/** A Graduated trader (40 days old, 25 released trades): no stage cap. */
async function graduated(): Promise<string> {
  const id = await seedAccount(deps, { loginName: `lg${randomUUID().slice(0, 8)}` });
  await deps.db.query('update accounts set created_at = $2 where id = $1', [id, new Date(START.getTime() - 40 * DAY)]);
  await deps.db.query('insert into account_traded_totals (account_id, purged_completed) values ($1, 25)', [id]);
  return id;
}

const recUrl = (accountId: string) => `/staff/v1/accounts/${accountId}/limit-recommendations`;
const decideUrl = (accountId: string, recId: string) => `${recUrl(accountId)}/${recId}/decide`;

async function recommend(b: StaffBrowser, accountId: string, what: { capUsd: number } | { stage: 'starter' | 'building' }): Promise<string> {
  const res = await b.post(recUrl(accountId), { ...what, reason: REASON });
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { id: string }).id;
}

function intent(recId: string, accountId: string, approve: boolean, what: { capUsd?: number; stage?: 'starter' | 'building' }) {
  return { kind: 'account-limit' as const, recId, accountId, approve, capUsd: what.capUsd ?? null, stage: what.stage ?? null };
}

async function decide(who: { id: string; b: StaffBrowser }, accountId: string, recId: string, approve: boolean, what: { capUsd?: number; stage?: 'starter' | 'building' }) {
  const tapId = await seedTap(deps, who.id, intent(recId, accountId, approve, what));
  return who.b.post(decideUrl(accountId, recId), { approve, tapId });
}

describe('recommending account limits (Task 26)', () => {
  it('a moderator recommends a cap with a reason of at least 40 characters; the log has the account and the cap, never the reason', async () => {
    const mod = await staff('mod');
    const acct = await graduated();
    const recId = await recommend(mod.b, acct, { capUsd: 300 });
    const entries = (await logEntries(deps, 'limits.recommended')).map((e) => JSON.parse(e.detail));
    expect(entries).toContainEqual({ recId, accountId: acct, capUsd: 300 });
    expect(JSON.stringify(await logEntries(deps, 'limits.recommended'))).not.toContain('walked away');
    // Nothing changes until a senior moderator or the owner approves.
    expect((await tradeCap(deps.db, acct, deps.clock())).capUsdCents).toBeNull();
  });

  it('refuses a short reason, both a cap and a stage, neither, a bad cap, a non-trader and a second pending one', async () => {
    const mod = await staff('mod');
    const acct = await graduated();
    expect(errorOf(await mod.b.post(recUrl(acct), { capUsd: 300, reason: 'Too short.' }))).toBe('reason-too-short');
    expect(errorOf(await mod.b.post(recUrl(acct), { capUsd: 300, reason: `   ${'x'.repeat(39)}   ` }))).toBe('reason-too-short');
    for (const bad of [
      { capUsd: 300, stage: 'starter', reason: REASON },
      { reason: REASON },
      { capUsd: 0, reason: REASON },
      { capUsd: 12.5, reason: REASON },
      { capUsd: '300', reason: REASON },
      { stage: 'graduated', reason: REASON },
      { capUsd: 300, reason: REASON, extra: 1 },
      { capUsd: 300, reason: 'x'.repeat(2001) },
    ]) {
      expect((await mod.b.post(recUrl(acct), bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
    const staffAcct = (await seedStaff(deps, { role: 'mod' })).id;
    expect((await mod.b.post(recUrl(staffAcct), { capUsd: 300, reason: REASON })).statusCode).toBe(404);
    expect((await mod.b.post(recUrl('nope'), { capUsd: 300, reason: REASON })).statusCode).toBe(404);
    await recommend(mod.b, acct, { stage: 'starter' });
    expect(errorOf(await mod.b.post(recUrl(acct), { capUsd: 300, reason: REASON }))).toBe('wrong-state');
  });

  it('a helper cannot recommend', async () => {
    const helper = await staff('helper');
    expect((await helper.b.post(recUrl(await graduated()), { capUsd: 300, reason: REASON })).statusCode).toBe(403);
  });
});

describe('deciding recommended limits (Task 26)', () => {
  it('the recommender cannot decide, even as a senior moderator', async () => {
    const senior = await staff('senior');
    const acct = await graduated();
    const recId = await recommend(senior.b, acct, { capUsd: 300 });
    expect(errorOf(await decide(senior, acct, recId, true, { capUsd: 300 }))).toBe('same-person');
    expect((await tradeCap(deps.db, acct, deps.clock())).capUsdCents).toBeNull();
  });

  it('a moderator cannot decide', async () => {
    const mod = await staff('mod');
    const other = await staff('mod');
    const acct = await graduated();
    const recId = await recommend(mod.b, acct, { capUsd: 300 });
    expect((await decide(other, acct, recId, true, { capUsd: 300 })).statusCode).toBe(403);
    expect((await tradeCap(deps.db, acct, deps.clock())).capUsdCents).toBeNull();
  });

  it('an approved cap lowers the cap; the trader sees their own cap only; the log has the decision', async () => {
    const mod = await staff('mod');
    const senior = await staff('senior');
    const acct = await graduated();
    const recId = await recommend(mod.b, acct, { capUsd: 300 });
    const res = await decide(senior, acct, recId, true, { capUsd: 300 });
    expect([res.statusCode, res.json()]).toEqual([200, { status: 'approved' }]);
    const cap = await tradeCap(deps.db, acct, deps.clock());
    expect(cap).toEqual({ stage: 'graduated', capUsdCents: 30_000n, maxOpen: null, byLimit: true });
    expect((await logEntries(deps, 'limits.decided')).map((e) => JSON.parse(e.detail))).toContainEqual({ recId, approved: true });
    const row = (await deps.db.query('select account_id, cap_usd, stage, until, set_by from account_limits where recommendation_id = $1', [recId])).rows;
    expect(row).toEqual([{ account_id: acct, cap_usd: 300, stage: null, until: null, set_by: senior.id }]);
    // Decided once.
    expect(errorOf(await decide(await ownerOnce(), acct, recId, false, { capUsd: 300 }))).toBe('wrong-state');
  });

  it('a cap above the stage cap changes nothing: the lower of the two applies', async () => {
    const mod = await staff('mod');
    const owner = await ownerOnce();
    const acct = await seedAccount(deps, { loginName: `ls${randomUUID().slice(0, 8)}` });
    const recId = await recommend(mod.b, acct, { capUsd: 5000 });
    expect((await decide(owner, acct, recId, true, { capUsd: 5000 })).statusCode).toBe(200);
    expect(await tradeCap(deps.db, acct, deps.clock())).toEqual({ stage: 'starter', capUsdCents: 20_000n, maxOpen: 3, byLimit: false });
  });

  it('an approved stage holds the account to that stage', async () => {
    const mod = await staff('mod');
    const owner = await ownerOnce();
    const acct = await graduated();
    const recId = await recommend(mod.b, acct, { stage: 'starter' });
    expect((await decide(owner, acct, recId, true, { stage: 'starter' })).statusCode).toBe(200);
    expect(await tradeCap(deps.db, acct, deps.clock())).toEqual({ stage: 'starter', capUsdCents: 20_000n, maxOpen: 3, byLimit: false });
  });

  it('a declined recommendation sets nothing', async () => {
    const mod = await staff('mod');
    const senior = await staff('senior');
    const acct = await graduated();
    const recId = await recommend(mod.b, acct, { capUsd: 300 });
    const res = await decide(senior, acct, recId, false, { capUsd: 300 });
    expect([res.statusCode, res.json()]).toEqual([200, { status: 'declined' }]);
    expect((await tradeCap(deps.db, acct, deps.clock())).capUsdCents).toBeNull();
    expect((await logEntries(deps, 'limits.decided')).map((e) => JSON.parse(e.detail))).toContainEqual({ recId, approved: false });
    // A new one may be recommended after it.
    await recommend(mod.b, acct, { capUsd: 400 });
  });

  it('the tap must be for exactly this decision', async () => {
    const mod = await staff('mod');
    const senior = await staff('senior');
    const acct = await graduated();
    const recId = await recommend(mod.b, acct, { capUsd: 300 });
    for (const wrong of [intent(recId, acct, false, { capUsd: 300 }), intent(recId, acct, true, { capUsd: 301 }), intent(recId, acct, true, { stage: 'starter' })]) {
      const tapId = await seedTap(deps, senior.id, wrong);
      expect(errorOf(await senior.b.post(decideUrl(acct, recId), { approve: true, tapId })), JSON.stringify(wrong)).toBe('tap-invalid');
    }
    expect(errorOf(await senior.b.post(decideUrl(acct, recId), { approve: true, tapId: randomUUID() }))).toBe('tap-invalid');
    expect((await senior.b.post(decideUrl(acct, recId), { approve: 'yes', tapId: randomUUID() })).statusCode).toBe(400);
    // The recommendation must belong to the account named.
    expect((await decide(senior, await graduated(), recId, true, { capUsd: 300 })).statusCode).toBe(404);
    expect((await tradeCap(deps.db, acct, deps.clock())).capUsdCents).toBeNull();
  });

  it('a senior moderator lists the waiting recommendations with the reason; a moderator cannot', async () => {
    const mod = await staff('mod');
    const senior = await staff('senior');
    const acct = await graduated();
    const recId = await recommend(mod.b, acct, { capUsd: 250 });
    const res = await senior.b.get('/staff/v1/limit-recommendations');
    expect(res.statusCode, res.body).toBe(200);
    const list = (res.json() as { recommendations: Array<Record<string, unknown>> }).recommendations;
    const mine = list.find((r) => r.id === recId);
    expect(mine).toMatchObject({ id: recId, accountId: acct, capUsd: 250, stage: null, reason: REASON, code: null, currentStage: 'graduated', mine: false });
    expect(typeof mine!.displayName).toBe('string');
    expect(typeof mine!.recommendedBy).toBe('string');
    expect((await mod.b.get('/staff/v1/limit-recommendations')).statusCode).toBe(403);
    // Decided ones leave the list.
    await decide(senior, acct, recId, false, { capUsd: 250 });
    const after = ((await senior.b.get('/staff/v1/limit-recommendations')).json() as { recommendations: Array<{ id: string }> }).recommendations;
    expect(after.map((r) => r.id)).not.toContain(recId);
  });
});

describe('recommending limits from a case (ModCase)', () => {
  /** A trade the buyer disputed; the buyer's confirm window has passed. */
  async function disputed() {
    setNow(new Date(START.getTime() - 120 * MIN));
    const seller = await newTrader();
    const buyer = await newTrader();
    const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
    const t = await driveTo(deps, trade, 'paid');
    setNow(START);
    for (const p of [seller, buyer]) expect((await p.browser.post('/t/login', { accountId: p.id })).statusCode).toBe(200);
    const res = await buyer.browser.post(`/v1/trades/${t.code}/dispute`, { reason: 'paid', note: '' });
    expect(res.statusCode, res.body).toBe(200);
    return { seller, buyer, code: t.code };
  }

  it('the case names the side; the log entry is on the case; the waiting list shows the case', async () => {
    const senior = await staff('senior');
    const { seller, code } = await disputed();
    const res = await senior.b.post(`/staff/v1/disputes/${code}/limit-recommendations`, { side: 'seller', stage: 'building', reason: REASON });
    expect(res.statusCode, res.body).toBe(201);
    const recId = (res.json() as { id: string }).id;
    const { rows } = await deps.db.query<{ detail: string }>(`select detail from activity_log where trade_code = $1 and action = 'limits.recommended'`, [code]);
    expect(rows.map((r) => JSON.parse(r.detail))).toEqual([{ recId, accountId: seller.id, stage: 'building' }]);
    const owner = await ownerOnce();
    const list = ((await owner.b.get('/staff/v1/limit-recommendations')).json() as { recommendations: Array<Record<string, unknown>> }).recommendations;
    expect(list.find((r) => r.id === recId)).toMatchObject({ accountId: seller.id, code, stage: 'building', capUsd: null });
  });

  it('a moderator not on the case cannot; a bad side is 400', async () => {
    const mod = await staff('mod');
    const { code } = await disputed();
    expect(errorOf(await mod.b.post(`/staff/v1/disputes/${code}/limit-recommendations`, { side: 'buyer', capUsd: 100, reason: REASON }))).toBe('forbidden-case');
    const senior = await staff('senior');
    expect((await senior.b.post(`/staff/v1/disputes/${code}/limit-recommendations`, { side: 'both', capUsd: 100, reason: REASON })).statusCode).toBe(400);
  });
});

describe('a lost dispute alone changes nothing (R38, Task 26)', () => {
  it('a settled dispute the buyer lost leaves their stage and cap as they were, and sets no limit', async () => {
    setNow(START);
    const seller = await newTrader();
    const buyer = await newTrader();
    await deps.db.query('update accounts set created_at = $2 where id = $1', [buyer.id, new Date(START.getTime() - 40 * DAY)]);
    await deps.db.query('insert into account_traded_totals (account_id, purged_completed) values ($1, 25)', [buyer.id]);
    const before = await tradeCap(deps.db, buyer.id, deps.clock());
    const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
    const t = await driveTo(deps, trade, 'secured');
    await deps.db.query(`update trades set state = 'refunded', dispute_by = 'buyer', dispute_at = $2, closed_at = $2 where code = $1`, [t.code, deps.clock()]);
    expect(await tradeCap(deps.db, buyer.id, deps.clock())).toEqual(before);
    expect(before).toEqual({ stage: 'graduated', capUsdCents: null, maxOpen: null, byLimit: false });
    expect((await deps.db.query('select 1 from account_limits where account_id = $1', [buyer.id])).rows).toEqual([]);
  });
});
