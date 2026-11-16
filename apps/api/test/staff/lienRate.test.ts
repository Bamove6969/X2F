// Lien recovery (owner 16 Nov 2026, docs/lien-recovery.md), rule 3: the rate defaults to 50%; a
// moderator may propose another with a required reason; a senior moderator (or the owner) approves
// it with a key tap, or rejects it; never the proposer; until approved the current rate applies.
// Also the trader's own view (`GET /v1/account/liens`). Real Postgres.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../../src/app.js';
import { seedAccount } from '../helpers/accounts.js';
import { SESSION_COOKIE, StaffBrowser, TRADER_ORIGIN, errorOf, insertSession, logEntries, seedStaff, seedTap, staffApps } from '../helpers/staffApp.js';
import { XMR } from '../helpers/trades.js';

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

async function lien(amount = 2n * XMR): Promise<{ id: string; debtor: string; creditor: string }> {
  const debtor = await seedAccount(deps, { loginName: `d${Math.random().toString(36).slice(2, 10)}` });
  const creditor = await seedAccount(deps, { loginName: `c${Math.random().toString(36).slice(2, 10)}` });
  const { rows } = await deps.db.query<{ id: string }>(
    `insert into liens (debtor_account_id, creditor_account_id, amount_atomic, from_code, dispute_seq, round, cause, created_at, changed_at)
     values ($1, $2, $3, gen_random_uuid()::text, 1, 1, 'restitution', $4, $4) returning id::text`,
    [debtor, creditor, amount.toString(), T0],
  );
  return { id: rows[0]!.id, debtor, creditor };
}
const rate = async (id: string) => (await deps.db.query<{ r: number }>('select recovery_rate_bps as r from liens where id = $1', [id])).rows[0]!.r;

describe('rate change requests', () => {
  it('defaults to 50%; a change needs a reason; it waits for a senior and the default applies meanwhile', async () => {
    const l = await lien();
    expect(await rate(l.id)).toBe(5000);
    expect(errorOf(await mod.post(`/staff/v1/liens/${l.id}/rate`, { rateBps: 2500, reason: '' }))).toBe('bad-request');
    expect(errorOf(await mod.post(`/staff/v1/liens/${l.id}/rate`, { rateBps: 2500 }))).toBe('bad-request');
    expect(errorOf(await mod.post(`/staff/v1/liens/${l.id}/rate`, { rateBps: 0, reason: 'x' }))).toBe('bad-request');
    const res = await mod.post(`/staff/v1/liens/${l.id}/rate`, { rateBps: 2500, reason: 'Proceeds are their only income' });
    expect(res.statusCode, res.body).toBe(201);
    const req = (res.json() as { id: string }).id;
    expect(await rate(l.id)).toBe(5000);
    // One pending request per lien.
    expect(errorOf(await mod.post(`/staff/v1/liens/${l.id}/rate`, { rateBps: 3000, reason: 'Another' }))).toBe('request-pending');
    const view = (await mod.get(`/staff/v1/liens/${l.id}`)).json() as { lien: { rateBps: number; remainingAtomic: string }; rateRequests: { status: string; reason: string }[] };
    expect(view.lien).toMatchObject({ rateBps: 5000, remainingAtomic: (2n * XMR).toString() });
    expect(view.rateRequests).toMatchObject([{ status: 'pending', reason: 'Proceeds are their only income' }]);

    // The senior approves with a tap bound to exactly this request and rate.
    const wrongTap = await seedTap(deps, seniorId, { kind: 'lien-rate', lienId: l.id, requestId: req, rateBps: 3000 });
    expect(errorOf(await senior.post(`/staff/v1/liens/${l.id}/rate/${req}/approve`, { tapId: wrongTap }))).toBe('tap-invalid');
    const tap = await seedTap(deps, seniorId, { kind: 'lien-rate', lienId: l.id, requestId: req, rateBps: 2500 });
    const ok = await senior.post(`/staff/v1/liens/${l.id}/rate/${req}/approve`, { tapId: tap });
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
    const own = (await senior.post(`/staff/v1/liens/${l.id}/rate`, { rateBps: 7000, reason: 'Large debt' })).json() as { id: string };
    const tap = await seedTap(deps, seniorId, { kind: 'lien-rate', lienId: l.id, requestId: own.id, rateBps: 7000 });
    expect(errorOf(await senior.post(`/staff/v1/liens/${l.id}/rate/${own.id}/approve`, { tapId: tap }))).toBe('forbidden');
    expect(errorOf(await senior.post(`/staff/v1/liens/${l.id}/rate/${own.id}/reject`, {}))).toBe('forbidden');
    const owner = await seedStaff(deps, { role: 'owner' });
    const ob = new StaffBrowser(app).withSession((await insertSession(deps, owner.id, 'staff')).token);
    expect((await ob.post(`/staff/v1/liens/${l.id}/rate/${own.id}/reject`, {})).statusCode).toBe(200);
    expect(await rate(l.id)).toBe(5000);
  });

  it('a lien that is over takes no request', async () => {
    const l = await lien();
    await deps.db.query(`update liens set status = 'void', changed_at = $2, lifted_at = $2 where id = $1`, [l.id, T0]);
    expect(errorOf(await mod.post(`/staff/v1/liens/${l.id}/rate`, { rateBps: 2500, reason: 'x' }))).toBe('wrong-state');
  });
});

describe('GET /v1/account/liens (rules 1-3: what the debtor owes and the creditor receives)', () => {
  it('the debtor sees owed, recovered, remaining and the rate; the creditor sees recoveries arriving; no ids or addresses', async () => {
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
      expect.objectContaining({ id: l.id, amountAtomic: (2n * XMR).toString(), recoveredAtomic: (XMR / 2n).toString(), remainingAtomic: ((3n * XMR) / 2n).toString(), rateBps: 5000, defaultRateBps: 5000, status: 'active' }),
    ]);
    expect(JSON.stringify(d)).not.toContain(l.creditor);
    const c = await as(l.creditor);
    expect(c.owes).toEqual([]);
    expect(c.owedTo).toEqual([expect.objectContaining({ id: l.id, recoveries: [{ amountAtomic: (XMR / 2n).toString(), at: T0.toISOString() }] })]);
    expect(JSON.stringify(c)).not.toContain(l.debtor);
  });
});
