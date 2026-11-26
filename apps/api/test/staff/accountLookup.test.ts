// Spec 6.6 "Account actions": the staff Accounts page's lookup, `GET /staff/v1/accounts/lookup?q=`.
// Read-only, senior moderators and the owner only, rate-limited per staff member, only what a case
// already shows of a trader (never login names, keys or wallets), and every lookup logged.
import { randomBytes } from 'node:crypto';
import type { StaffRole } from '@x2f/staff';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../../src/app.js';
import { ACCOUNT_LOOKUP_BUCKET, newBudgets } from '../../src/limits.js';
import { seedAccount } from '../helpers/accounts.js';
import { StaffBrowser, errorOf, insertSession, seedStaff, staffApps } from '../helpers/staffApp.js';
import { seedTrade } from '../helpers/trades.js';

let app: FastifyInstance;
let deps: Deps;
let close: () => Promise<void>;
const NOW = new Date('2026-11-26T12:00:00.000Z');
const HOUR = 3_600_000;

beforeAll(async () => {
  let setNow: (d: Date) => void;
  ({ app, deps, setNow, close } = await staffApps());
  setNow(NOW);
});
afterAll(async () => close());
beforeEach(() => {
  (app as { budgets: unknown }).budgets = newBudgets(deps.clock);
});

let ownerId: string | null = null;
async function as(role: StaffRole): Promise<{ id: string; b: StaffBrowser }> {
  // One owner only (the schema's `one_owner`): later owner sessions are the same account's.
  const s = role === 'owner' ? (ownerId ??= (await seedStaff(deps, { role })).id) : (await seedStaff(deps, { role })).id;
  const { token } = await insertSession(deps, s, 'staff');
  return { id: s, b: new StaffBrowser(app).withSession(token) };
}

async function trader(display?: string): Promise<{ id: string; loginName: string; displayName: string }> {
  const loginName = `lk${randomBytes(4).toString('hex')}`;
  const displayName = display ?? `Lookup${randomBytes(3).toString('hex')}`;
  const id = await seedAccount(deps, { loginName, displayName, kind: 'trader' });
  return { id, loginName, displayName };
}

const lookup = (b: StaffBrowser, q: string) => b.get(`/staff/v1/accounts/lookup?q=${encodeURIComponent(q)}`);

async function lookedUp(actorId: string) {
  const { rows } = await deps.db.query<{ actor_role: string; trade_code: string | null; detail: string }>(
    "select actor_role, trade_code, detail from activity_log where action = 'account.looked-up' and actor_id = $1 order by id",
    [actorId],
  );
  return rows.map((r) => ({ role: r.actor_role, tradeCode: r.trade_code, detail: JSON.parse(r.detail) as Record<string, unknown> }));
}

describe('GET /staff/v1/accounts/lookup', () => {
  it('a moderator and a helper are refused (accounts.ban: senior moderators and the owner); nothing is logged', async () => {
    const t = await trader();
    for (const role of ['mod', 'helper'] as const) {
      const p = await as(role);
      const res = await lookup(p.b, t.displayName);
      expect([res.statusCode, errorOf(res)], role).toEqual([403, 'forbidden']);
      expect(await lookedUp(p.id), role).toEqual([]);
    }
    // No staff session at all.
    const anon = await new StaffBrowser(app).get(`/staff/v1/accounts/lookup?q=${t.displayName}`);
    expect(anon.statusCode).toBe(401);
  });

  it('a senior moderator finds a trader by display name, any case; exactly the case fields and the status, never the login name', async () => {
    const t = await trader();
    const s = await as('senior');
    const res = await lookup(s.b, `  ${t.displayName.toUpperCase()} `);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      accounts: [{
        accountId: t.id,
        displayName: t.displayName,
        matchedBy: 'name',
        side: null,
        completedTrades: 0,
        positivePct: null,
        disputes: { won: 0, lost: 0 },
        stage: expect.any(String),
        status: { bans: [], hold: null, frozen: false, lien: false },
      }],
    });
    expect(res.body).not.toContain(t.loginName);
    expect(await lookedUp(s.id)).toEqual([{ role: 'senior', tradeCode: null, detail: { by: 'name', accountId: t.id } }]);
  });

  it('a trade code (dashes, lower case) finds both sides; the entries carry no trade code', async () => {
    const seller = await trader();
    const buyer = await trader();
    const trade = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
    const o = await as('owner');
    const dashed = trade.code.toLowerCase().replace(/(.{4})(?!$)/g, '$1-');
    const res = await lookup(o.b, dashed);
    expect(res.statusCode, res.body).toBe(200);
    const got = (res.json() as { accounts: Array<{ accountId: string; side: string; matchedBy: string; displayName: string }> }).accounts;
    expect(got.map((a) => [a.side, a.accountId, a.matchedBy, a.displayName])).toEqual([
      ['buyer', buyer.id, 'code', buyer.displayName],
      ['seller', seller.id, 'code', seller.displayName],
    ]);
    const entries = (await lookedUp(o.id)).slice(-2);
    expect(entries).toEqual([
      { role: 'owner', tradeCode: null, detail: { by: 'code', accountId: buyer.id } },
      { role: 'owner', tradeCode: null, detail: { by: 'code', accountId: seller.id } },
    ]);
    expect(JSON.stringify(entries)).not.toContain(trade.code);
  });

  it('shows the bans in force, a running hold, a freeze; staff and the owner are never found', async () => {
    const t = await trader();
    const staffer = await seedStaff(deps, { role: 'mod' });
    const placer = (await seedStaff(deps, { role: 'senior' })).id;
    const until = new Date(NOW.getTime() + 7 * 24 * HOUR);
    const { rows } = await deps.db.query<{ id: string }>(
      `insert into account_bans (id, account_id, kind, rule_id, reason_code, until, note, placed_by, created_at)
       values (gen_random_uuid(), $1, 'trade', 'abuse', 'abuse', $2, 'staff-only note', $3, $4) returning id::text as id`,
      [t.id, until, placer, NOW],
    );
    await deps.db.query(
      `insert into account_holds (account_id, started_at, hold_until, reason, started_methods) values ($1, $2, $3, 'recovery-code', '{}')`,
      [t.id, NOW, new Date(NOW.getTime() + 24 * HOUR)],
    );
    const s = await as('senior');
    const res = await lookup(s.b, t.displayName);
    expect(res.json().accounts[0].status).toEqual({
      bans: [{ id: rows[0]!.id, kind: 'trade', reasonCode: 'abuse', until: until.toISOString(), permanent: false }],
      hold: { until: new Date(NOW.getTime() + 24 * HOUR).toISOString(), reason: 'recovery-code' },
      frozen: false,
      lien: false,
    });
    // The staff note stays on the bans route.
    expect(res.body).not.toContain('staff-only note');
    const staffName = (await deps.db.query<{ n: string }>('select display_name as n from accounts where id = $1', [staffer.id])).rows[0]!.n;
    expect((await lookup(s.b, staffName)).json()).toEqual({ accounts: [] });
    expect((await lookedUp(s.id)).at(-1)).toEqual({ role: 'senior', tradeCode: null, detail: { by: 'name', found: 0 } });
  });

  it('exact matches only: a prefix finds nothing', async () => {
    const t = await trader();
    const s = await as('senior');
    expect((await lookup(s.b, t.displayName.slice(0, -1))).json()).toEqual({ accounts: [] });
  });

  it('a bad query is 400: empty, too long, a second key, repeated', async () => {
    const s = await as('senior');
    for (const url of ['/staff/v1/accounts/lookup', '/staff/v1/accounts/lookup?q=', '/staff/v1/accounts/lookup?q=%20%20', `/staff/v1/accounts/lookup?q=${'a'.repeat(65)}`, '/staff/v1/accounts/lookup?q=a&x=1', '/staff/v1/accounts/lookup?q=a&q=b']) {
      expect((await s.b.get(url)).statusCode, url).toBe(400);
    }
  });

  it('rate-limited per staff member: every try counts; past the bucket 429 slow-down, another member unaffected', async () => {
    const s = await as('senior');
    for (let i = 0; i < ACCOUNT_LOOKUP_BUCKET.capacity; i++) {
      const res = await lookup(s.b, i % 2 === 0 ? `nobody${i}` : '');
      expect(res.statusCode, `try ${i}`).not.toBe(429);
    }
    const over = await lookup(s.b, 'nobody');
    expect([over.statusCode, errorOf(over)]).toEqual([429, 'slow-down']);
    expect((over.json() as { retryAfterSeconds?: number }).retryAfterSeconds).toBeGreaterThan(0);
    const other = await as('owner');
    expect((await lookup(other.b, 'nobody')).statusCode).toBe(200);
  });
});
