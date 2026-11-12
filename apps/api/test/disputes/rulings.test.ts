// Plan 4 Task 12: the staff ruling routes. A ruling is proposed with a security-key tap bound to its
// exact content (`ruling` intent, step `propose`), published at once under the large-trade limit,
// or held for a senior moderator's or the owner's tapped approval at or above it; a send-back
// returns it to the proposer. Every decided state goes through `withDispute`, so the liens (Task 25)
// and the reviews' erasure on an overturn follow by themselves.
// NEEDS_TASK_14: nothing moves the escrow's coins yet; the ruling stops at published (or final).
import { createHash, randomUUID } from 'node:crypto';
import { type AccountAction, type KeyTapIntent, type RulingOutcome } from '@x2f/staff';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../../src/app.js';
import { startDispute } from '../../src/disputes/store.js';
import { loadDispute } from '../../src/disputes/store.js';
import { buildStaffApi } from '../../src/staff/app.js';
import { NO_MODERATION } from '../../src/disputes/moderationClient.js';
import { STAFF_ORIGIN, StaffBrowser, insertSession, seedStaff, seedTap } from '../helpers/staffApp.js';
import { tradeApp } from '../helpers/tradeApp.js';
import { AMOUNT, driveTo, seedTrade } from '../helpers/trades.js';

let traderApp: FastifyInstance;
let staffApp: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let newTrader: Awaited<ReturnType<typeof tradeApp>>['trader'];

const START = new Date('2026-11-13T12:00:00Z');
const MIN = 60_000;
const H = 60 * MIN;
const at = (ms: number) => new Date(START.getTime() + ms);
const REASON = "The seller's bank statement shows the payment arrived on time, in full.";
const EVIDENCE = ['The trade chat', "The seller's bank statement"];

beforeAll(async () => {
  const t = await tradeApp();
  ({ app: traderApp, deps, setNow } = t);
  newTrader = t.trader;
  staffApp = await buildStaffApi({ ...deps, staffOrigin: STAFF_ORIGIN, moderation: NO_MODERATION, traderEvents: traderApp.events });
});
afterAll(async () => {
  await staffApp.close();
  await traderApp.close();
});

const errorOf = (res: { body: string }) => (res.body === '' ? undefined : (JSON.parse(res.body) as { error?: string }).error);
const url = (code: string, tail = '') => `/staff/v1/disputes/${code}${tail}`;
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const NONE: AccountAction = { kind: 'none' };

async function staff(role: 'mod' | 'senior' | 'owner') {
  const s = await seedStaff(deps, { role });
  const b = new StaffBrowser(staffApp).withSession((await insertSession(deps, s.id, 'staff')).token);
  return { id: s.id, b };
}

/** A trade with a dispute opened now: on the escrow, or after a refund. */
async function disputed(o: { afterRefund?: boolean } = {}) {
  setNow(START);
  const seller = await newTrader();
  const buyer = await newTrader();
  const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
  const t = await driveTo(deps, trade, 'paid');
  const client = await deps.db.connect();
  try {
    await client.query('begin');
    await startDispute(client, t, { openedBy: 'buyer', reason: 'paid', note: '', afterRefund: o.afterRefund ?? false, now: START, prices: null });
    await client.query('commit');
  } finally {
    client.release();
  }
  return { seller, buyer, code: t.code };
}

function intent(code: string, step: 'propose' | 'approve', o: { rulingId: string; round?: 1 | 2 | undefined; outcome: RulingOutcome; accountAction?: AccountAction | undefined; reason?: string | undefined }): KeyTapIntent {
  return {
    kind: 'ruling', step, rulingId: o.rulingId, code, round: o.round ?? 1, outcome: o.outcome,
    accountAction: o.accountAction ?? NONE, amountAtomic: AMOUNT.toString(), reasonSha256: sha(o.reason ?? REASON),
  };
}

/** Proposes through the route with a fresh tap made for exactly this ruling (or for `tapFor`). */
async function propose(who: { id: string; b: StaffBrowser }, code: string, o: { outcome: RulingOutcome; round?: 1 | 2; reason?: string; accountAction?: AccountAction; tapFor?: Partial<Parameters<typeof intent>[2]> }) {
  const rulingId = randomUUID();
  const reason = o.reason ?? REASON;
  const tapId = await seedTap(deps, who.id, intent(code, 'propose', { rulingId, round: o.round, outcome: o.outcome, reason, accountAction: o.accountAction, ...o.tapFor }));
  const res = await who.b.post(url(code, '/rulings'), { rulingId, outcome: o.outcome, accountAction: o.accountAction ?? NONE, reason, evidence: EVIDENCE, tapId });
  return { res, rulingId, tapId };
}

async function approve(who: { id: string; b: StaffBrowser }, code: string, rulingId: string, o: { outcome: RulingOutcome; round?: 1 | 2; reason?: string }) {
  const tapId = await seedTap(deps, who.id, intent(code, 'approve', { rulingId, round: o.round, outcome: o.outcome, reason: o.reason }));
  return who.b.post(url(code, `/rulings/${rulingId}/approve`), { tapId });
}

async function take(who: { b: StaffBrowser }, code: string) {
  const res = await who.b.post(url(code, '/take'), {});
  expect(res.statusCode, res.body).toBe(200);
}

async function actions(code: string): Promise<string[]> {
  const { rows } = await deps.db.query<{ action: string }>(`select action from activity_log where trade_code = $1 and action like 'ruling.%' order by id`, [code]);
  return rows.map((r) => r.action);
}

async function published(code: string) {
  const { rows } = await deps.db.query('select round, outcome, reason, evidence, moderator_name, ruled_at, appeal_until from dispute_rulings where code = $1 order by round', [code]);
  return rows;
}

async function withLimit<T>(usd: number, fn: () => Promise<T>): Promise<T> {
  await deps.db.query('update settings set large_trade_limit_usd = $1', [usd]);
  try {
    return await fn();
  } finally {
    await deps.db.query('update settings set large_trade_limit_usd = 1000');
  }
}

describe('a proposal under the large-trade limit', () => {
  it('publishes at once: the 48-hour appeal window opens, the traders see the ruling, everything is logged', async () => {
    const { buyer, code } = await disputed();
    setNow(at(H));
    const mod = await staff('mod');
    await take(mod, code);
    const { res, rulingId } = await propose(mod, code, { outcome: 'release-to-buyer' });
    expect(res.statusCode, res.body).toBe(200);
    const d = (await loadDispute(deps.db, code))!;
    expect(d).toMatchObject({ status: 'published', round: 1, publishedAt: at(H), appealEndsAt: at(49 * H), ruling: { id: rulingId, outcome: 'release-to-buyer', proposer: mod.id, approver: null } });
    expect(await published(code)).toEqual([
      expect.objectContaining({ round: 1, outcome: 'release-to-buyer', reason: REASON, evidence: EVIDENCE, ruled_at: at(H), appeal_until: at(49 * H) }),
    ]);
    expect(await actions(code)).toEqual(['ruling.proposed', 'ruling.published']);
    expect(buyer.id).toBeTruthy();
    expect((await buyer.browser.post('/t/login', { accountId: buyer.id })).statusCode).toBe(200);
    expect((await buyer.browser.get(`/v1/trades/${code}/dispute`)).json()).toMatchObject({ status: 'ruled', ruling: { outcome: 'release-to-buyer', reason: REASON } });
  });

  it('a tap made for another outcome, another reason or another person is tap-invalid, and nothing is written', async () => {
    const mod = await staff('mod');
    const other = await staff('mod');
    const { code } = await disputed();
    await take(mod, code);
    const wrongOutcome = await propose(mod, code, { outcome: 'refund-to-seller', tapFor: { outcome: 'release-to-buyer' } });
    expect({ status: wrongOutcome.res.statusCode, error: errorOf(wrongOutcome.res) }).toEqual({ status: 403, error: 'tap-invalid' });
    const wrongReason = await propose(mod, code, { outcome: 'refund-to-seller', tapFor: { reason: `${REASON} Extra.` } });
    expect(errorOf(wrongReason.res)).toBe('tap-invalid');
    // Another moderator's tap is not this one's.
    const rulingId = randomUUID();
    const tapId = await seedTap(deps, other.id, intent(code, 'propose', { rulingId, outcome: 'refund-to-seller' }));
    const theirs = await mod.b.post(url(code, '/rulings'), { rulingId, outcome: 'refund-to-seller', accountAction: NONE, reason: REASON, evidence: EVIDENCE, tapId });
    expect(errorOf(theirs)).toBe('tap-invalid');
    expect((await loadDispute(deps.db, code))!).toMatchObject({ status: 'open', ruling: null });
    expect(await actions(code)).toEqual([]);
    expect(await published(code)).toEqual([]);
  });

  it('a refused proposal leaves its tap unused: the same tap then proposes the ruling it was made for', async () => {
    const mod = await staff('mod');
    const { code } = await disputed();
    await take(mod, code);
    const rulingId = randomUUID();
    const tapId = await seedTap(deps, mod.id, intent(code, 'propose', { rulingId, outcome: 'release-to-buyer' }));
    const bad = await mod.b.post(url(code, '/rulings'), { rulingId, outcome: 'refund-to-seller', accountAction: NONE, reason: REASON, evidence: EVIDENCE, tapId });
    expect(errorOf(bad)).toBe('tap-invalid');
    const good = await mod.b.post(url(code, '/rulings'), { rulingId, outcome: 'release-to-buyer', accountAction: NONE, reason: REASON, evidence: EVIDENCE, tapId });
    expect(good.statusCode, good.body).toBe(200);
    // Used once: it cannot publish a second ruling.
    const again = await mod.b.post(url(code, '/rulings'), { rulingId: randomUUID(), outcome: 'release-to-buyer', accountAction: NONE, reason: REASON, evidence: EVIDENCE, tapId });
    expect(again.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('a reason under 40 characters is reason-too-short; a bad body is 400', async () => {
    const mod = await staff('mod');
    const { code } = await disputed();
    await take(mod, code);
    const short = await propose(mod, code, { outcome: 'release-to-buyer', reason: 'x'.repeat(39) });
    expect({ status: short.res.statusCode, error: errorOf(short.res) }).toEqual({ status: 400, error: 'reason-too-short' });
    for (const bad of [
      { outcome: 'release-to-buyer', accountAction: NONE, reason: REASON, evidence: EVIDENCE },
      { rulingId: randomUUID(), outcome: 'pay-me', accountAction: NONE, reason: REASON, evidence: EVIDENCE, tapId: randomUUID() },
      { rulingId: randomUUID(), outcome: 'release-to-buyer', accountAction: NONE, reason: REASON, evidence: 'chat', tapId: randomUUID() },
      { rulingId: randomUUID(), outcome: 'release-to-buyer', accountAction: NONE, reason: REASON, evidence: [''], tapId: randomUUID() },
      { rulingId: randomUUID(), outcome: 'release-to-buyer', accountAction: NONE, reason: REASON, evidence: EVIDENCE, tapId: randomUUID(), extra: 1 },
    ]) {
      expect((await mod.b.post(url(code, '/rulings'), bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
  });

  it('only the assignee proposes; an outcome that does not fit the dispute is wrong-state', async () => {
    const mod = await staff('mod');
    const other = await staff('mod');
    const { code } = await disputed();
    await take(mod, code);
    const notMine = await propose(other, code, { outcome: 'release-to-buyer' });
    expect({ status: notMine.res.statusCode, error: errorOf(notMine.res) }).toEqual({ status: 403, error: 'forbidden-case' });
    const misfit = await propose(mod, code, { outcome: 'seller-sends-xmr' });
    expect({ status: misfit.res.statusCode, error: errorOf(misfit.res) }).toEqual({ status: 409, error: 'wrong-state' });
  });

  it('an account action on the ruling card is refused: a freeze is its own act (D-015), bans are not built (Task 27)', async () => {
    const mod = await staff('mod');
    const { code } = await disputed();
    await take(mod, code);
    for (const accountAction of [{ kind: 'freeze' }, { kind: 'trade-ban', until: null, reasonCode: 'terms' }] as AccountAction[]) {
      const r = await propose(mod, code, { outcome: 'release-to-buyer', accountAction });
      expect({ status: r.res.statusCode, error: errorOf(r.res) }, accountAction.kind).toEqual({ status: 409, error: 'account-action-unavailable' });
    }
    expect(await actions(code)).toEqual([]);
  });

  it('a seller-sends-xmr ruling after a refund puts its lien on the seller at once (Task 25 through withDispute)', async () => {
    const mod = await staff('mod');
    const { seller, code } = await disputed({ afterRefund: true });
    await take(mod, code);
    const { res } = await propose(mod, code, { outcome: 'seller-sends-xmr' });
    expect(res.statusCode, res.body).toBe(200);
    const { rows } = await deps.db.query(`select debtor_account_id::text as debtor, status from liens where from_code = $1`, [code]);
    expect(rows).toEqual([{ debtor: seller.id, status: 'active' }]);
  });
});

describe('at or above the large-trade limit: two people', () => {
  it('waits for approval; the proposer, a moderator and an unknown ruling cannot approve; the owner publishes', async () => {
    await withLimit(300, async () => {
      const senior = await staff('senior');
      const mod = await staff('mod');
      const owner = await staff('owner');
      const { code } = await disputed();
      setNow(at(H));
      await take(senior, code);
      const { res, rulingId } = await propose(senior, code, { outcome: 'refund-to-seller' });
      expect(res.statusCode, res.body).toBe(200);
      expect((await loadDispute(deps.db, code))!).toMatchObject({ status: 'awaiting-approval', publishedAt: null });
      expect(await published(code)).toEqual([]);

      const self = await approve(senior, code, rulingId, { outcome: 'refund-to-seller' });
      expect({ status: self.statusCode, error: errorOf(self) }).toEqual({ status: 409, error: 'same-person' });
      const byMod = await approve(mod, code, rulingId, { outcome: 'refund-to-seller' });
      expect({ status: byMod.statusCode, error: errorOf(byMod) }).toEqual({ status: 403, error: 'forbidden' });
      const unknown = await approve(owner, code, randomUUID(), { outcome: 'refund-to-seller' });
      expect({ status: unknown.statusCode, error: errorOf(unknown) }).toEqual({ status: 409, error: 'wrong-state' });
      // The approval tap binds the same content: a tap for another outcome is refused.
      const mismatch = await approve(owner, code, rulingId, { outcome: 'release-to-buyer' });
      expect(errorOf(mismatch)).toBe('tap-invalid');

      setNow(at(2 * H));
      const ok = await approve(owner, code, rulingId, { outcome: 'refund-to-seller' });
      expect(ok.statusCode, ok.body).toBe(200);
      expect((await loadDispute(deps.db, code))!).toMatchObject({ status: 'published', ruling: { approver: owner.id }, appealEndsAt: at(50 * H) });
      expect(await published(code)).toEqual([expect.objectContaining({ round: 1, outcome: 'refund-to-seller', reason: REASON, appeal_until: at(50 * H) })]);
      expect(await actions(code)).toEqual(['ruling.proposed', 'ruling.approved', 'ruling.published']);
    });
  });

  it('a send-back returns the case to its proposer with the note; they may propose again', async () => {
    await withLimit(300, async () => {
      const mod = await staff('mod');
      const senior = await staff('senior');
      const { code } = await disputed();
      await take(mod, code);
      const { rulingId } = await propose(mod, code, { outcome: 'refund-to-seller' });
      const back = await senior.b.post(url(code, `/rulings/${rulingId}/send-back`), { note: 'Ask the buyer for the bank reference first.' });
      expect(back.statusCode, back.body).toBe(200);
      expect((await loadDispute(deps.db, code))!).toMatchObject({ status: 'open', ruling: null, assignee: mod.id });
      const case_ = (await mod.b.get(url(code))).json() as { ruling: { sentBack: unknown } };
      expect(case_.ruling.sentBack).toMatchObject({ rulingId, note: 'Ask the buyer for the bank reference first.' });
      expect(await actions(code)).toEqual(['ruling.proposed', 'ruling.sent-back']);
      const again = await propose(mod, code, { outcome: 'release-to-buyer' });
      expect(again.res.statusCode, again.res.body).toBe(200);
      // A moderator cannot send back.
      const mod2 = await staff('mod');
      expect((await mod2.b.post(url(code, `/rulings/${again.rulingId}/send-back`), { note: 'No.' })).statusCode).toBe(403);
    });
  });
});

describe('the appeal round', () => {
  async function appealed() {
    const mod = await staff('mod');
    const x = await disputed();
    setNow(at(H));
    await take(mod, x.code);
    expect((await propose(mod, x.code, { outcome: 'release-to-buyer' })).res.statusCode).toBe(200);
    setNow(at(2 * H));
    expect((await x.seller.browser.post('/t/login', { accountId: x.seller.id })).statusCode).toBe(200);
    const res = await x.seller.browser.post(`/v1/trades/${x.code}/appeal`, { why: 'The moderator missed my bank statement.' });
    expect(res.statusCode, res.body).toBe(200);
    return { ...x, mod };
  }

  it('the ruling routes add no reviewer list: GET …/appeal-reviewers is the appeals\' owner-only route (lead Q3)', async () => {
    const { code } = await appealed();
    const senior = await staff('senior');
    const res = await senior.b.get(url(code, '/appeal-reviewers'));
    expect({ status: res.statusCode, error: errorOf(res) }).toEqual({ status: 403, error: 'forbidden' });
  });

  it('an uninvolved senior overturns: final, overturned, round 2 published, the receiver of the coins liened (D-006)', async () => {
    const { code, buyer } = await appealed();
    const senior = await staff('senior');
    setNow(at(3 * H));
    await take(senior, code);
    const { res } = await propose(senior, code, { outcome: 'refund-to-seller', round: 2 });
    expect(res.statusCode, res.body).toBe(200);
    expect((await loadDispute(deps.db, code))!).toMatchObject({ round: 2, overturned: true });
    expect((await published(code)).map((r) => [r.round, r.outcome, r.appeal_until])).toEqual([[1, 'release-to-buyer', at(49 * H)], [2, 'refund-to-seller', null]]);
    expect(await actions(code)).toEqual(['ruling.proposed', 'ruling.published', 'ruling.proposed', 'ruling.published', 'ruling.final']);
    const { rows } = await deps.db.query<{ detail: string }>(`select detail from activity_log where trade_code = $1 and action = 'ruling.final'`, [code]);
    expect(JSON.parse(rows[0]!.detail)).toMatchObject({ round: 2, overturned: true });
    const liens = await deps.db.query(`select debtor_account_id::text as debtor, cause from liens where from_code = $1`, [code]);
    expect(liens.rows).toEqual([{ debtor: buyer.id, cause: 'overturned' }]);
  });

  it('the round-1 moderator can take no part (R37)', async () => {
    const { code, mod } = await appealed();
    const r = await propose(mod, code, { outcome: 'refund-to-seller', round: 2 });
    expect(r.res.statusCode).toBe(403);
  });
});

// Lead call Q1 (12 Nov): no ruling is proposed, approved or sent back while maintenance pauses the
// dispute (the freeze route's gate, `paused_since`) or during the emergency stop
// (`site_flags.trading_paused`). Refused before the tap, so nothing is written and the tap stays unused.
describe('maintenance and the emergency stop', () => {
  // `maintenance`: the timer has marked the dispute paused. `maintenance-before-tick` (lead follow-up
  // to Q1): the site's maintenance switch is on and the timer has not run yet, so `paused_since` is unset.
  async function paused<T>(how: Pause, code: string, fn: () => Promise<T>): Promise<T> {
    if (how === 'maintenance') await deps.db.query('update disputes set paused_since = $2 where code = $1', [code, at(H)]);
    else if (how === 'maintenance-before-tick') await deps.db.query("update site_flags set maintenance_since = $1, maintenance_kind = 'unplanned'", [at(H)]);
    else await deps.db.query('update site_flags set trading_paused = true, stopped_at = $1', [at(H)]);
    try {
      if (how === 'maintenance-before-tick') expect((await deps.db.query('select paused_since from disputes where code = $1', [code])).rows).toEqual([{ paused_since: null }]);
      return await fn();
    } finally {
      await deps.db.query('update disputes set paused_since = null where code = $1', [code]);
      await deps.db.query('update site_flags set trading_paused = false, stopped_at = null, maintenance_since = null, maintenance_kind = null');
    }
  }
  type Pause = 'maintenance' | 'maintenance-before-tick' | 'stop';
  const REFUSAL = { maintenance: 'dispute-paused', 'maintenance-before-tick': 'dispute-paused', stop: 'trading-paused' } as const;

  for (const how of ['maintenance', 'maintenance-before-tick', 'stop'] as const) {
    it(`${how}: a proposal is refused with 409 ${REFUSAL[how]}, nothing is written and the tap stays unused`, async () => {
      const mod = await staff('mod');
      const { code } = await disputed();
      setNow(at(H));
      await take(mod, code);
      const rulingId = randomUUID();
      const tapId = await seedTap(deps, mod.id, intent(code, 'propose', { rulingId, outcome: 'release-to-buyer' }));
      const body = { rulingId, outcome: 'release-to-buyer', accountAction: NONE, reason: REASON, evidence: EVIDENCE, tapId };
      const res = await paused(how, code, () => mod.b.post(url(code, '/rulings'), body));
      expect({ status: res.statusCode, error: errorOf(res) }).toEqual({ status: 409, error: REFUSAL[how] });
      expect((await loadDispute(deps.db, code))!).toMatchObject({ status: 'open', ruling: null });
      expect(await actions(code)).toEqual([]);
      expect((await deps.db.query('select 1 from ruling_drafts where code = $1', [code])).rows).toEqual([]);
      const after = await mod.b.post(url(code, '/rulings'), body);
      expect(after.statusCode, after.body).toBe(200);
    });

    it(`${how}: an approval and a send-back are refused with 409 ${REFUSAL[how]}; the proposal still waits`, async () => {
      await withLimit(300, async () => {
        const mod = await staff('mod');
        const senior = await staff('senior');
        const { code } = await disputed();
        setNow(at(H));
        await take(mod, code);
        const { res, rulingId } = await propose(mod, code, { outcome: 'refund-to-seller' });
        expect(res.statusCode, res.body).toBe(200);
        const tapId = await seedTap(deps, senior.id, intent(code, 'approve', { rulingId, outcome: 'refund-to-seller' }));
        const [ok, back] = await paused(how, code, async () => [
          await senior.b.post(url(code, `/rulings/${rulingId}/approve`), { tapId }),
          await senior.b.post(url(code, `/rulings/${rulingId}/send-back`), { note: 'Ask for the bank reference.' }),
        ]);
        expect({ status: ok!.statusCode, error: errorOf(ok!) }).toEqual({ status: 409, error: REFUSAL[how] });
        expect({ status: back!.statusCode, error: errorOf(back!) }).toEqual({ status: 409, error: REFUSAL[how] });
        expect((await loadDispute(deps.db, code))!).toMatchObject({ status: 'awaiting-approval', ruling: { id: rulingId } });
        expect(await actions(code)).toEqual(['ruling.proposed']);
        const later = await senior.b.post(url(code, `/rulings/${rulingId}/approve`), { tapId });
        expect(later.statusCode, later.body).toBe(200);
      });
    });
  }
});
