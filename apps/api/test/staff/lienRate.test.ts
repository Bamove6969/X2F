// Lien recovery (owner 16 Nov 2026, docs/lien-recovery.md), rule 3: the rate defaults to 50%; a
// moderator may propose another with a required reason; a senior moderator (or the owner) approves
// it with a key tap, or rejects it; never the proposer; until approved the current rate applies.
// Also the trader's own view (`GET /v1/account/liens`). Real Postgres.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Deps } from '../../src/app.js';
import { seedAccount } from '../helpers/accounts.js';
import { SESSION_COOKIE, StaffBrowser, TRADER_ORIGIN, errorOf, insertSession, logEntries, seedStaff, seedTap, staffApps } from '../helpers/staffApp.js';
import { XMR, seedTrade } from '../helpers/trades.js';

const T0 = new Date('2026-11-16T12:00:00Z');

let app: FastifyInstance;
let trader: FastifyInstance;
let deps: Deps;
let close: () => Promise<void>;
let mod: StaffBrowser;
let modId: string;
let senior: StaffBrowser;
let seniorId: string;

beforeAll(async () => {
  let setNow: (d: Date) => void;
  ({ app, trader, deps, setNow, close } = await staffApps());
  setNow(T0);
  modId = (await seedStaff(deps, { role: 'mod' })).id;
  mod = new StaffBrowser(app).withSession((await insertSession(deps, modId, 'staff')).token);
  seniorId = (await seedStaff(deps, { role: 'senior' })).id;
  senior = new StaffBrowser(app).withSession((await insertSession(deps, seniorId, 'staff')).token);
});
afterAll(async () => close());

async function lien(amount = 2n * XMR, realTrade = false): Promise<{ id: string; debtor: string; creditor: string }> {
  const debtor = await seedAccount(deps, { loginName: `d${Math.random().toString(36).slice(2, 10)}` });
  const creditor = await seedAccount(deps, { loginName: `c${Math.random().toString(36).slice(2, 10)}` });
  const code = realTrade ? (await seedTrade(deps, { sellerId: debtor, buyerId: creditor, poster: 'seller' })).trade.code : null;
  const { rows } = await deps.db.query<{ id: string }>(
    `insert into liens (debtor_account_id, creditor_account_id, amount_atomic, from_code, dispute_seq, round, cause, created_at, changed_at)
     values ($1, $2, $3, coalesce($5, gen_random_uuid()::text), 1, 1, 'restitution', $4, $4) returning id::text`,
    [debtor, creditor, amount.toString(), T0, code],
  );
  return { id: rows[0]!.id, debtor, creditor };
}
const rate = async (id: string) => (await deps.db.query<{ r: number }>('select recovery_rate_bps as r from liens where id = $1', [id])).rows[0]!.r;

describe('rate change requests', () => {
  it('owner 26 Nov 2026: defaults to 100%; a change needs a reason; it waits for a senior and the default applies meanwhile', async () => {
    const l = await lien();
    expect(await rate(l.id)).toBe(10_000);
    expect(errorOf(await mod.post(`/staff/v1/liens/${l.id}/rate`, { rateBps: 2500, reason: '' }))).toBe('bad-request');
    expect(errorOf(await mod.post(`/staff/v1/liens/${l.id}/rate`, { rateBps: 2500 }))).toBe('bad-request');
    expect(errorOf(await mod.post(`/staff/v1/liens/${l.id}/rate`, { rateBps: 0, reason: 'x' }))).toBe('bad-request');
    // Q1 (owner, 26 Nov 2026): at most 100%.
    expect(errorOf(await mod.post(`/staff/v1/liens/${l.id}/rate`, { rateBps: 10_001, reason: 'x' }))).toBe('bad-request');
    const res = await mod.post(`/staff/v1/liens/${l.id}/rate`, { rateBps: 2500, reason: 'Proceeds are their only income' });
    expect(res.statusCode, res.body).toBe(201);
    const req = (res.json() as { id: string }).id;
    expect(await rate(l.id)).toBe(10_000);
    // One pending request per lien.
    expect(errorOf(await mod.post(`/staff/v1/liens/${l.id}/rate`, { rateBps: 3000, reason: 'Another' }))).toBe('request-pending');
    const view = (await mod.get(`/staff/v1/liens/${l.id}`)).json() as { lien: { rateBps: number; remainingAtomic: string }; rateRequests: { status: string; reason: string }[] };
    expect(view.lien).toMatchObject({ rateBps: 10_000, remainingAtomic: (2n * XMR).toString() });
    expect(view.rateRequests).toMatchObject([{ status: 'pending', reason: 'Proceeds are their only income' }]);

    // Owner change 26 Nov 2026 5:53 PM: the senior approves without a key tap (a body with one is refused).
    const tap = await seedTap(deps, seniorId, { kind: 'lien-rate', lienId: l.id, requestId: req, rateBps: 2500 });
    expect(errorOf(await senior.post(`/staff/v1/liens/${l.id}/rate/${req}/approve`, { tapId: tap }))).toBe('bad-request');
    const ok = await senior.post(`/staff/v1/liens/${l.id}/rate/${req}/approve`, {});
    expect(ok.statusCode, ok.body).toBe(200);
    expect(await rate(l.id)).toBe(2500);
    // Decided once.
    expect(errorOf(await senior.post(`/staff/v1/liens/${l.id}/rate/${req}/reject`, {}))).toBe('wrong-state');

    const logged = (await logEntries(deps, 'lien.rate-approved')).map((e) => JSON.parse(e.detail) as Record<string, unknown>);
    expect(logged).toContainEqual({ lienId: l.id, requestId: req, rateBps: 2500 });
    // The reason never goes into the log.
    for (const e of await logEntries(deps, 'lien.rate-proposed')) expect(e.detail).not.toContain('income');
  });

  it('the proposer never decides their own request, even as a senior; a rejection keeps the rate', async () => {
    const l = await lien();
    const own = (await senior.post(`/staff/v1/liens/${l.id}/rate`, { rateBps: 4000, reason: 'Large debt' })).json() as { id: string };
    expect(errorOf(await senior.post(`/staff/v1/liens/${l.id}/rate/${own.id}/approve`, {}))).toBe('forbidden');
    expect(errorOf(await senior.post(`/staff/v1/liens/${l.id}/rate/${own.id}/reject`, {}))).toBe('forbidden');
    const owner = await seedStaff(deps, { role: 'owner' });
    const ob = new StaffBrowser(app).withSession((await insertSession(deps, owner.id, 'staff')).token);
    expect((await ob.post(`/staff/v1/liens/${l.id}/rate/${own.id}/reject`, {})).statusCode).toBe(200);
    expect(await rate(l.id)).toBe(10_000);
  });

  it('a lower rate can be raised back to the 100% default only by a request with a reason and a senior\'s tap', async () => {
    const l = await lien();
    await deps.db.query('update liens set recovery_rate_bps = 2500 where id = $1', [l.id]);
    expect(errorOf(await mod.post(`/staff/v1/liens/${l.id}/rate`, { rateBps: 10_000, reason: '' }))).toBe('bad-request');
    const res = await mod.post(`/staff/v1/liens/${l.id}/rate`, { rateBps: 10_000, reason: 'Hardship over' });
    expect(res.statusCode, res.body).toBe(201);
    const req = (res.json() as { id: string }).id;
    expect((await senior.post(`/staff/v1/liens/${l.id}/rate/${req}/approve`, {})).statusCode).toBe(200);
    expect(await rate(l.id)).toBe(10_000);
  });

  it('a lien that is over takes no request', async () => {
    const l = await lien();
    await deps.db.query(`update liens set status = 'void', changed_at = $2, lifted_at = $2 where id = $1`, [l.id, T0]);
    expect(errorOf(await mod.post(`/staff/v1/liens/${l.id}/rate`, { rateBps: 2500, reason: 'x' }))).toBe('wrong-state');
  });
});

describe('GET /v1/account/liens (rules 1-3: what the debtor owes and the creditor receives)', () => {
  it('the debtor sees owed, recovered, remaining and the rate; the creditor sees totals only (review M4, Q4); no ids or addresses', async () => {
    const l = await lien(2n * XMR);
    await deps.db.query(`insert into lien_recoveries (lien_id, trade_code, amount_atomic, at) values ($1, 'AAAA-BBBB-CCCC-DDDD', $2, $3)`, [l.id, (XMR / 2n).toString(), T0]);
    const as = async (id: string) => {
      const token = (await insertSession(deps, id, 'trader')).token;
      const res = await trader.inject({ method: 'GET', url: '/v1/account/liens', headers: { cookie: `${SESSION_COOKIE}=${token}`, origin: TRADER_ORIGIN } });
      expect(res.statusCode, res.body).toBe(200);
      return res.json() as { owes: Record<string, unknown>[]; owedTo: Record<string, unknown>[] };
    };
    const d = await as(l.debtor);
    expect(d.owedTo).toEqual([]);
    expect(d.owes).toEqual([
      expect.objectContaining({ id: l.id, amountAtomic: (2n * XMR).toString(), recoveredAtomic: (XMR / 2n).toString(), remainingAtomic: ((3n * XMR) / 2n).toString(), rateBps: 10_000, defaultRateBps: 10_000, status: 'active' }),
    ]);
    expect(JSON.stringify(d)).not.toContain(l.creditor);
    const c = await as(l.creditor);
    expect(c.owes).toEqual([]);
    expect(c.owedTo).toEqual([
      { id: l.id, status: 'active', amountAtomic: (2n * XMR).toString(), recoveredAtomic: (XMR / 2n).toString(), remainingAtomic: ((3n * XMR) / 2n).toString(), fromCode: expect.any(String), recoveryAddressSet: false },
    ]);
    // Review M4: never the debtor's individual purchases (no per-trade rows, no times, no rate).
    expect(JSON.stringify(c)).not.toContain(T0.toISOString());
    expect(JSON.stringify(c)).not.toContain('rateBps');
    expect(JSON.stringify(c)).not.toContain(l.debtor);
  });
});

describe('coordinator follow-up 26 Nov 2026: the people who may decide a request are told', () => {
  it('a new request alerts every senior and the owner, never the proposer nor a switched-off senior, in-app once and pushed once', async () => {
    const owner = (await deps.db.query<{ id: string }>("select id::text from accounts where kind = 'owner'")).rows[0]?.id ?? (await seedStaff(deps, { role: 'owner' })).id;
    const off = (await seedStaff(deps, { role: 'senior', switchedOff: true })).id;
    const sent: string[] = [];
    const spy = vi.spyOn(app.push, 'send').mockImplementation(async (who: string) => (sent.push(who), true));
    try {
      const l = await lien();
      const res = await mod.post(`/staff/v1/liens/${l.id}/rate`, { rateBps: 2500, reason: 'Can afford a quarter' });
      expect(res.statusCode, res.body).toBe(201);
      const req = (res.json() as { id: string }).id;
      const { rows } = await deps.db.query<{ account_id: string; detail: Record<string, unknown> }>(
        `select account_id::text, detail from alerts where kind = 'lien-rate-requested' and detail->>'requestId' = $1`, [req],
      );
      const who = rows.map((r) => r.account_id);
      expect(who).toEqual(expect.arrayContaining([seniorId, owner]));
      expect(who).not.toContain(modId);
      expect(who).not.toContain(off);
      expect(new Set(who).size).toBe(who.length);
      const from = (await deps.db.query<{ c: string }>('select from_code as c from liens where id = $1', [l.id])).rows[0]!.c;
      expect(rows[0]!.detail).toEqual({ trade: from, lienId: l.id, requestId: req });
      // Pushed after the commit, once per person and once per request.
      expect(sent).toEqual(expect.arrayContaining([seniorId, owner]));
      expect(sent).not.toContain(modId);
      expect(new Set(sent).size).toBe(sent.length);
      expect((await deps.db.query('select 1 from lien_rate_requests where id = $1 and deciders_pushed_at is not null', [req])).rowCount).toBe(1);
      // A senior's own request never alerts that senior.
      const l2 = await lien();
      const res2 = await senior.post(`/staff/v1/liens/${l2.id}/rate`, { rateBps: 5000, reason: 'Half' });
      const req2 = (res2.json() as { id: string }).id;
      const mine = await deps.db.query(`select 1 from alerts where account_id = $1 and kind = 'lien-rate-requested' and detail->>'requestId' = $2`, [seniorId, req2]);
      expect(mine.rowCount).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('review of feat/lien-grace item 4: opening a request to review it', () => {
  it('is logged once per request and person, on the source trade, even when opened several times at once', async () => {
    // A real source trade, as a ruling's lien has.
    const l = await lien(2n * XMR, true);
    const req = ((await mod.post(`/staff/v1/liens/${l.id}/rate`, { rateBps: 2500, reason: 'A quarter' })).json() as { id: string }).id;
    await Promise.all([1, 2, 3, 4].map(() => senior.get(`/staff/v1/liens/${l.id}`)));
    const from = (await deps.db.query<{ c: string }>('select from_code as c from liens where id = $1', [l.id])).rows[0]!.c;
    const rows = (await deps.db.query<{ trade_code: string | null; detail: string }>(`select trade_code, detail from activity_log where action = 'lien.rate-review-opened'`)).rows
      .filter((e) => (JSON.parse(e.detail) as { requestId: string }).requestId === req);
    expect(rows.map((e) => e.trade_code)).toEqual([from]);
    // The proposer opening it logs nothing (they cannot decide it).
    await mod.get(`/staff/v1/liens/${l.id}`);
    expect((await deps.db.query(`select 1 from activity_log where action = 'lien.rate-review-opened' and actor_id = $1`, [modId])).rowCount).toBe(0);
  });
});
