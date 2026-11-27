// Plan 4 Task 20: moderator performance from the data that already exists: the disputes, their
// published rulings, the appeals (an overturned round 2 counts against round 1's proposer) and
// the activity log (who sent each round's first reply). Owner only (spec 6.6, perm `perf.read`);
// the answers name staff and numbers, never a trade or a trader. The maths is
// packages/staff/test/metrics.test.ts; this checks the rows the API builds. Real Postgres.
import { randomUUID } from 'node:crypto';
import { applyDispute, type Actor, type Dispute, type RulingOutcome, type StaffRole } from '@x2f/staff';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../../src/app.js';
import { withTx } from '../../src/auth/liveSession.js';
import { DISPUTE_DEFAULTS } from '../../src/disputes/settings.js';
import { startDispute, withDispute } from '../../src/disputes/store.js';
import { appendLog } from '../../src/log/append.js';
import { seedAccount } from '../helpers/accounts.js';
import { appealDirect } from '../helpers/disputes.js';
import { StaffBrowser, errorOf, insertSession, seedStaff, staffApps, uniqueName } from '../helpers/staffApp.js';
import { driveTo, seedTrade } from '../helpers/trades.js';

const MIN = 60_000;
const H = 60 * MIN;
const T0 = new Date('2026-11-11T08:00:00Z'); // a Wednesday
const S = { appealWindowH: DISPUTE_DEFAULTS.appealWindowH, firstResponseH: DISPUTE_DEFAULTS.firstResponseH };

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let close: () => Promise<void>;
const at = (ms: number) => setNow(new Date(T0.getTime() + ms));

interface Who {
  id: string;
  role: StaffRole;
}
let owner: Who;
let senior: Who;
let mod: Who;
let idle: Who;
let helper: Who;
const traders: string[] = [];
const codes: string[] = [];

const actorOf = (w: Who): Actor => ({ kind: 'staff', id: w.id, role: w.role });

/** A paid trade in dispute, opened by the buyer now. */
async function disputed(): Promise<string> {
  const sellerName = uniqueName('s');
  const buyerName = uniqueName('b');
  const seller = await seedAccount(deps, { loginName: sellerName });
  const buyer = await seedAccount(deps, { loginName: buyerName });
  traders.push(seller, buyer, sellerName, buyerName);
  const { trade } = await seedTrade(deps, { sellerId: seller, buyerId: buyer, poster: 'seller' });
  const t = await driveTo(deps, trade, 'paid');
  await withTx(deps.db, async (c) => {
    await c.query("update trades set state = 'disputed' where code = $1", [t.code]);
    await startDispute(c, t, { openedBy: 'buyer', reason: 'paid', note: '', afterRefund: false, now: deps.clock(), prices: null });
  });
  codes.push(t.code);
  return t.code;
}

const step = (code: string, fn: (d: Dispute, now: Date, client: Parameters<Parameters<typeof withDispute>[2]>[1]) => Promise<Dispute> | Dispute) =>
  withDispute(deps, { code }, async (d, client, now) => fn(d, now, client));

const assign = (code: string, w: Who) => step(code, (d, now) => applyDispute(d, { type: 'assign', staffId: w.id, role: w.role }, actorOf(w), now, S));

/** A staff chat message, as the messages route records it: the log entry, then the machine's reply. */
const reply = (code: string, w: Who) =>
  step(code, async (d, now, client) => {
    await appendLog(client, { at: now, actor: actorOf(w), tradeCode: code, action: 'chat.message-sent', detail: { envelopeId: randomUUID() } });
    return applyDispute(d, { type: 'reply' }, actorOf(w), now, S);
  });

/** A proposal published at once (below the limit, no account action), with its draft as the ruling routes keep it. */
const rule = (code: string, w: Who, outcome: RulingOutcome) =>
  step(code, async (d, now, client) => {
    const id = randomUUID();
    const next = applyDispute(d, { type: 'propose', gate: { usdCents: d.usdCents, limitUsdCents: d.limitUsdCents }, ruling: { id, outcome, accountAction: { kind: 'none' }, proposer: w.id } }, actorOf(w), now, S);
    await client.query(
      `insert into ruling_drafts (ruling_id, code, seq, round, reason, evidence, proposer, proposed_at, status, decided_by, decided_at)
       values ($1, $2, $3, $4, $5, '[]', $6, $7, 'published', $6, $7)`,
      [id, code, d.seq, d.round, 'The payment proof matches the trade amount and the account name given.', w.id, now],
    );
    return next;
  });

beforeAll(async () => {
  ({ app, deps, setNow, close } = await staffApps());
  at(0);
  const seed = async (role: StaffRole): Promise<Who> => ({ id: (await seedStaff(deps, { role })).id, role });
  owner = await seed('owner');
  senior = await seed('senior');
  mod = await seed('mod');
  idle = await seed('mod');
  helper = await seed('helper');

  // A: the mod replies after 30 min and rules at 2 h; the seller appeals at 6 h and an
  // uninvolved senior replies 20 min later and overrules it at 8 h.
  const a = await disputed();
  at(10 * MIN);
  await assign(a, mod);
  at(30 * MIN);
  await reply(a, mod);
  at(2 * H);
  await rule(a, mod, 'release-to-buyer');
  // B: opened at 1 h; the mod replies after 50 min and rules at 5 h; never appealed.
  at(1 * H);
  const b = await disputed();
  await assign(b, mod);
  at(1 * H + 50 * MIN);
  await reply(b, mod);
  at(5 * H);
  await rule(b, mod, 'release-to-buyer');
  at(6 * H);
  await appealDirect(deps, a, 'seller');
  await assign(a, senior);
  at(6 * H + 20 * MIN);
  await reply(a, senior);
  at(8 * H);
  await rule(a, senior, 'refund-to-seller');
  // C: open, assigned to the mod, no reply yet.
  at(9 * H);
  const c = await disputed();
  await assign(c, mod);
  at(10 * H);
});
afterAll(async () => close());

const browser = async (w: Who) => new StaffBrowser(app).withSession((await insertSession(deps, w.id, 'staff')).token);

interface PersonRow {
  id: string;
  name: string;
  role: string;
  cases: number;
  firstReplyMin: number | null;
  rulingMin: number | null;
  overturned: number;
  withinDeadlinePct: number | null;
  open: number;
  payableCases: number;
  appeals: number;
  appealsWithinGoalPct: number | null;
}

describe('GET /staff/v1/performance', () => {
  it('builds each person\'s figures from the disputes, rulings, appeals and the activity log', async () => {
    const res = await (await browser(owner)).get('/staff/v1/performance?period=30d');
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { period: string; firstResponseH: number; people: PersonRow[] };
    expect(body.period).toBe('30d');
    expect(body.firstResponseH).toBe(DISPUTE_DEFAULTS.firstResponseH);
    const of = (w: Who) => body.people.find((p) => p.id === w.id)!;

    expect(of(mod)).toMatchObject({
      role: 'mod', cases: 2, firstReplyMin: 40, rulingMin: 180, overturned: 1, payableCases: 1, withinDeadlinePct: 100, open: 1, appeals: 0,
    });
    // The appeal is the senior's, never a case: it is not overturned or payable, and has its own goal.
    expect(of(senior)).toMatchObject({ role: 'senior', cases: 0, firstReplyMin: 20, overturned: 0, payableCases: 0, appeals: 1, appealsWithinGoalPct: 100, open: 0 });
    // Nothing yet: zero counts, null typical times and shares.
    expect(of(idle)).toMatchObject({ cases: 0, firstReplyMin: null, rulingMin: null, withinDeadlinePct: null, open: 0 });
    expect(of(owner).role).toBe('owner');
    // Only those who can handle disputes, in the board's order: senior moderators, moderators, the owner.
    expect(body.people.some((p) => p.id === helper.id)).toBe(false);
    const roles = body.people.map((p) => p.role);
    expect(roles).toEqual([...roles].sort((x, y) => ['senior', 'mod', 'owner'].indexOf(x) - ['senior', 'mod', 'owner'].indexOf(y)));
  });

  it('names no trade and no trader', async () => {
    const owners = await browser(owner);
    const bodies = [(await owners.get('/staff/v1/performance?period=all')).body, (await owners.get(`/staff/v1/performance/${mod.id}/weeks`)).body];
    for (const body of bodies) {
      for (const code of codes) {
        expect(body).not.toContain(code);
        expect(body).not.toContain(code.replace(/-/g, ''));
      }
      for (const t of traders) expect(body).not.toContain(t);
    }
  });

  it('defaults to 30 days, takes 90d and all, and refuses any other period', async () => {
    const owners = await browser(owner);
    expect((await owners.get('/staff/v1/performance')).json()).toMatchObject({ period: '30d' });
    for (const p of ['90d', 'all']) expect((await owners.get(`/staff/v1/performance?period=${p}`)).json()).toMatchObject({ period: p });
    const bad = await owners.get('/staff/v1/performance?period=7d');
    expect(bad.statusCode).toBe(400);
    expect(errorOf(bad)).toBe('bad-request');
  });

  it('is the owner\'s only (spec 6.6): a senior moderator, a moderator and a helper are forbidden, even for their own row', async () => {
    for (const w of [senior, mod, helper]) {
      const b = await browser(w);
      for (const url of ['/staff/v1/performance', `/staff/v1/performance/${w.id}/weeks`]) {
        const res = await b.get(url);
        expect(res.statusCode, `${w.role} ${url}`).toBe(403);
        expect(errorOf(res)).toBe('forbidden');
      }
    }
  });
});

describe('GET /staff/v1/performance/:id/weeks', () => {
  it('gives the last 8 weeks from Monday UTC, with the figures over those weeks', async () => {
    const res = await (await browser(owner)).get(`/staff/v1/performance/${mod.id}/weeks`);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { name: string; firstResponseH: number; from: string; summary: PersonRow; weeks: { weekOf: string; start: string; cases: number; firstReplyMin: number | null }[] };
    expect(body.weeks).toHaveLength(8);
    expect(body.weeks.at(-1)).toEqual({ weekOf: 'Nov 9', start: '2026-11-09T00:00:00.000Z', cases: 2, firstReplyMin: 40 });
    expect(body.weeks.slice(0, 7).every((w) => w.cases === 0 && w.firstReplyMin === null)).toBe(true);
    expect(body.from).toBe('2026-09-21T00:00:00.000Z');
    expect(body.summary).toMatchObject({ cases: 2, overturned: 1, withinDeadlinePct: 100 });
  });

  it('is 404 for anyone who does not handle disputes, or no one', async () => {
    const owners = await browser(owner);
    for (const id of [helper.id, randomUUID(), 'not-a-uuid']) {
      const res = await owners.get(`/staff/v1/performance/${id}/weeks`);
      expect(res.statusCode, id).toBe(404);
    }
  });
});
