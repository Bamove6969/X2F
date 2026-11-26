// D-059 (J-14, ported onto main's tickets): "My account has been compromised", the no-login report
// and the full lockout it starts; the staff routes that read it and lift the lock; the separate
// X2F_TICKET_KEYS ring (migration 861); and team tickets (owner Q69).
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deps } from '../src/app.js';
import { PUBLIC_ROUTES } from '../src/auth/frontDoor.js';
import { hashPassword } from '../src/auth/password.js';
import { keyringBox } from '../src/auth/keystore.js';
import { subkey } from '../src/config.js';
import { COMPROMISED_BUCKET } from '../src/limits.js';
import { MIGRATIONS_DIR } from '../src/db/migrate.js';
import { tradeHeldSql } from '../src/tickets/held.js';
import { LOCK_CAP_PER_HOUR, RELOCK_BAR_DAYS } from '../src/tickets/lock.js';
import { COMPROMISED_PER_NAME_DAILY, afterLocksSettled } from '../src/tickets/compromisedRoutes.js';
import { TICKET_WRITE_GAP_S } from '../src/tickets/traderRoutes.js';
import { openBody, purgeTickets, rewrapTicketSecrets, sealBody } from '../src/tickets/store.js';
import { applyEvent, loadTrade } from '../src/trades/store.js';
import { startTimers } from '../src/trades/timers.js';
import { seedAccount } from './helpers/accounts.js';
import { StaffBrowser, errorOf, insertSession, logEntries, seedStaff, seedTap, staffApps, uniqueName } from './helpers/staffApp.js';
import { Browser, addTestLogin } from './helpers/totp.js';
import { FIAT, driveTo, seedTrade } from './helpers/trades.js';

const T0 = new Date('2026-11-09T10:00:00Z');
const SECRET = 'my-stolen-recovery-code-zebra-71';
const DAY_MS = 86_400_000;

let staffApp: FastifyInstance;
let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let close: () => Promise<void>;
let n = 0;
let ownerId: string | null = null;

beforeAll(async () => {
  const s = await staffApps();
  ({ app: staffApp, trader: app, deps, setNow, close } = s);
  addTestLogin(app, deps);
});
afterAll(async () => close());
beforeEach(() => {
  setNow(T0);
  // The app-wide budgets are in memory; refill them for each test.
  const budgets = (app as unknown as { budgets: { start: { tokens: number }; compromised: { tokens: number } } }).budgets;
  budgets.start.tokens = 120;
  budgets.compromised.tokens = COMPROMISED_BUCKET.capacity;
});
// Review item 4: new locks are capped site wide per hour (LOCK_CAP_PER_HOUR). Every test here runs at
// T0, so the locks of earlier tests are aged past the hour before each one, leaving the cap to the
// test that is about it.
beforeEach(async () => {
  await deps.db.query("update account_locks set locked_at = locked_at - interval '2 hours', unlocked_at = unlocked_at - interval '2 hours', relock_after = relock_after - interval '2 hours' where locked_at > $1", [new Date(T0.getTime() - 3_600_000)]);
});

interface Trader {
  id: string;
  loginName: string;
  b: Browser;
}

async function trader(o: { disabled?: boolean } = {}): Promise<Trader> {
  const loginName = `tk${String(++n).padStart(4, '0')}${randomBytes(3).toString('hex')}`;
  const id = await seedAccount(deps, { loginName, ...(o.disabled ? { disabled: true } : {}) });
  const b = new Browser(app);
  if (!o.disabled) expect((await b.post('/t/login', { accountId: id })).statusCode).toBe(200);
  return { id, loginName, b };
}

/** A joined, logged-in member of `teamId` holding `abilities` (its login account seeded directly, as team.test.ts does). */
async function member(teamId: string, abilities: string[] = ['trades-see-active']): Promise<{ id: string; loginId: string; loginName: string; name: string; b: Browser }> {
  const name = `Member${++n}`;
  const loginName = `mlogin${n}${randomBytes(3).toString('hex')}`;
  const loginId = await seedAccount(deps, { loginName, displayName: `m-${n}-placeholder`, kind: 'member' });
  const now = deps.clock();
  const { rows } = await deps.db.query<{ id: string }>(
    `insert into team_members (account_id, display_name, display_key, abilities, invite_expires_at, member_account_id, joined_at, created_at)
     values ($1, $2, $3, $4, $5, $6, $5, $5) returning id`,
    [teamId, name, name.toLowerCase(), abilities, now, loginId],
  );
  const b = new Browser(app);
  expect((await b.post('/t/login', { accountId: loginId })).statusCode).toBe(200);
  return { id: rows[0]!.id, loginId, loginName, name, b };
}

async function staff(role: 'owner' | 'senior' | 'mod' | 'helper', grants: string[] = []) {
  // There is only ever one owner.
  const s = role === 'owner' && ownerId !== null ? { id: ownerId, loginName: '' } : await seedStaff(deps, { role, grants, loginName: uniqueName(role) });
  if (role === 'owner') ownerId = s.id;
  const { token, sessionId } = await insertSession(deps, s.id, 'staff');
  return { ...s, sessionId, b: new StaffBrowser(staffApp).withSession(token) };
}

/** Sends the form and waits for its after-lock work (J4: it runs after the reply). */
const report = async (body: unknown) => {
  const res = await new Browser(app).post('/v1/tickets/compromised', body);
  await afterLocksSettled();
  return res;
};
const reportId = async (number: number) => (await deps.db.query<{ id: string }>("select id from tickets where kind = 'compromised' and number = $1", [number])).rows[0]!.id;

describe('"My account has been compromised" (D-059): full lockout', () => {
  it('locks the matched account at once: every session refused and revoked, open trades paused, no login name kept', async () => {
    const victim = await trader();
    const other = await trader();
    const { trade } = await seedTrade(deps, { sellerId: victim.id, buyerId: other.id, poster: 'seller' });
    const secured = await driveTo(deps, trade, 'secured');
    const second = (await seedTrade(deps, { sellerId: other.id, buyerId: victim.id, poster: 'seller' })).trade;
    expect((await victim.b.get('/v1/tickets')).statusCode).toBe(200);

    const res = await report({ loginName: victim.loginName.toUpperCase(), methodsLeft: ['recovery-code', 'password'], comment: `They took my phone. ${SECRET}` });
    expect(res.statusCode, res.body).toBe(202);
    expect(Object.keys(res.json()).sort()).toEqual(['moderatorUrl', 'number']);

    // Every session of the account: refused at once, and revoked.
    expect(errorOf(await victim.b.get('/v1/tickets'))).toBe('not-authenticated');
    expect((await deps.db.query('select 1 from sessions where account_id = $1 and revoked_at is null', [victim.id])).rowCount).toBe(0);
    const acct = await deps.db.query<{ disabled_at: Date | null }>('select disabled_at from accounts where id = $1', [victim.id]);
    expect(acct.rows[0]!.disabled_at).toEqual(T0);
    // A new session (the test login skips the finish's `assertNotDisabled`) is refused on every request.
    const again = new Browser(app);
    await again.post('/t/login', { accountId: victim.id });
    expect(errorOf(await again.get('/v1/tickets'))).toBe('account-disabled');
    // Both open trades paused at once, as the seller and as the buyer.
    expect((await loadTrade(deps.db, secured.code))!.pausedAt).toEqual(T0);
    expect((await loadTrade(deps.db, second.code))!.pausedAt).toEqual(T0);
    // The report: the account, the ticked kinds, the sealed comment; never the typed login name.
    const t = await deps.db.query<{ account_id: string; methods_left: string[] }>("select account_id, methods_left from tickets where kind = 'compromised' and account_id = $1", [victim.id]);
    expect(t.rows[0]).toEqual({ account_id: victim.id, methods_left: ['password', 'recovery-code'] });
    const dump = JSON.stringify((await deps.db.query("select t.*, encode(m.body_sealed, 'escape') as m from tickets t left join ticket_messages m on m.ticket_id = t.id where t.kind = 'compromised'")).rows);
    expect(dump.toLowerCase()).not.toContain(victim.loginName.toLowerCase());
    expect(dump).not.toContain('zebra');
    const locked = await logEntries(deps, 'account.locked');
    expect(locked.some((e) => e.actor_kind === 'system' && JSON.stringify(e.detail).includes(victim.id))).toBe(true);
    for (const e of locked) expect(JSON.stringify(e)).not.toContain(SECRET);
    // The report is not one of the account's support tickets (staff's only).
    expect((await deps.db.query("select count(*)::int as n from tickets where account_id = $1 and kind = 'support'", [victim.id])).rows[0]).toEqual({ n: 0 });
  });

  it('a held trade: no trader event moves it (the other party neither); the timer loop keeps it paused through maintenance', async () => {
    const victim = await trader();
    const other = await trader();
    const { trade } = await seedTrade(deps, { sellerId: other.id, buyerId: victim.id, poster: 'seller' });
    await driveTo(deps, trade, 'secured');
    expect((await report({ loginName: victim.loginName, methodsLeft: [], comment: '' })).statusCode).toBe(202);
    // Review item 5: a party is answered as on any paused trade (409 wrong-state), never trade-held.
    await expect(applyEvent({ db: deps.db, clock: deps.clock }, trade.code, { type: 'propose-cancel' }, 'seller')).rejects.toMatchObject({ status: 409, code: 'wrong-state' });
    await expect(applyEvent({ db: deps.db, clock: deps.clock }, trade.code, { type: 'mark-paid', fiatCents: FIAT }, 'buyer')).rejects.toMatchObject({ code: 'wrong-state' });
    // A system resume (a hold's or maintenance's end) is refused too.
    await expect(applyEvent({ db: deps.db, clock: deps.clock }, trade.code, { type: 'resume' }, 'system')).rejects.toMatchObject({ code: 'trade-held' });
    // Maintenance on, then off: an ordinary paused trade would resume; this one stays paused.
    let maintenance: Date | null = new Date(T0.getTime() + 60_000);
    const timers = startTimers({ db: deps.db, clock: deps.clock, intervalMs: 0, maintenanceSince: async () => maintenance });
    setNow(new Date(T0.getTime() + 5 * 60_000));
    await timers.tick();
    maintenance = null;
    setNow(new Date(T0.getTime() + 300 * 60_000));
    const pass = await timers.tick();
    expect(pass.applied.filter((a) => a.code === trade.code)).toEqual([]);
    expect((await loadTrade(deps.db, trade.code))!.pausedAt).toEqual(T0);
    await timers.stop();
  });

  it('answers the same for an unknown name, a malformed one, a staff name and an account already locked, and locks nothing for them', async () => {
    const before = await deps.db.query('select count(*)::int as n from account_locks');
    const unknown = await report({ loginName: 'no-such-person-here', methodsLeft: ['password'], comment: 'help' });
    const malformed = await report({ loginName: '!!', methodsLeft: [], comment: '' });
    const mod = await staff('mod');
    const staffName = await report({ loginName: mod.loginName, methodsLeft: [] });
    for (const r of [unknown, malformed, staffName]) {
      expect(r.statusCode, r.body).toBe(202);
      expect(Object.keys(r.json()).sort()).toEqual(['moderatorUrl', 'number']);
    }
    expect((await deps.db.query('select count(*)::int as n from account_locks')).rows[0]).toEqual(before.rows[0]);
    expect((await deps.db.query<{ disabled_at: Date | null }>('select disabled_at from accounts where id = $1', [mod.id])).rows[0]!.disabled_at).toBeNull();
    const rows = await deps.db.query<{ account_id: string | null }>("select account_id from tickets where kind = 'compromised' and number = any($1::bigint[]) order by number", [
      [unknown.json().number, malformed.json().number, staffName.json().number],
    ]);
    expect(rows.rows.map((r) => r.account_id)).toEqual([null, null, null]);
    const v = await trader();
    await report({ loginName: v.loginName, methodsLeft: [], comment: '' });
    const again = await report({ loginName: v.loginName, methodsLeft: [], comment: '' });
    expect(again.statusCode).toBe(202);
    expect((await deps.db.query('select count(*)::int as n from account_locks where account_id = $1', [v.id])).rows[0]).toEqual({ n: 1 });
  });

  it('is the one ticket route outside the front door: logged out (or on a made-up cookie) it answers the same 202; the ticket reads stay closed', async () => {
    expect(PUBLIC_ROUTES['POST /v1/tickets/compromised']).toBeDefined();
    for (const route of ['POST /v1/tickets', 'GET /v1/tickets', 'GET /v1/tickets/:id', 'POST /v1/tickets/:id/messages', 'POST /v1/tickets/:id/close']) {
      expect(PUBLIC_ROUTES[route], route).toBeUndefined();
    }
    const v = await trader();
    const forged = new Browser(app);
    forged.cookies['__Host-x2f_session'] = 'A'.repeat(43);
    const answers = [
      await new Browser(app).post('/v1/tickets/compromised', { loginName: v.loginName, methodsLeft: [], comment: '' }),
      await new Browser(app).post('/v1/tickets/compromised', { loginName: 'nobody-by-this-name', methodsLeft: [], comment: '' }),
      await forged.post('/v1/tickets/compromised', { loginName: 'nobody-else-either', methodsLeft: [], comment: '' }),
    ];
    await afterLocksSettled();
    for (const r of answers) {
      expect(r.statusCode, r.body).toBe(202);
      expect(Object.keys(r.json()).sort()).toEqual(['moderatorUrl', 'number']);
    }
    expect((await deps.db.query('select count(*)::int as n from account_locks where account_id = $1 and unlocked_at is null', [v.id])).rows[0]).toEqual({ n: 1 });
    for (const url of ['/v1/tickets', '/v1/tickets/00000000-0000-4000-8000-000000000000']) {
      const r = await app.inject({ method: 'GET', url });
      expect(r.statusCode, url).toBe(401);
    }
  });

  it(`refuses a bad body, and more than ${COMPROMISED_PER_NAME_DAILY} reports a day for one typed name`, async () => {
    expect((await report({ loginName: 'x', methodsLeft: ['a-password-value'], comment: '' })).statusCode).toBe(400);
    expect((await report({ loginName: 'x', methodsLeft: ['password', 'password'], comment: '' })).statusCode).toBe(400);
    expect((await report({ loginName: 'x', methodsLeft: [], comment: '', password: 'hunter2' })).statusCode).toBe(400);
    expect((await report({ methodsLeft: [], comment: '' })).statusCode).toBe(400);
    expect((await report({ loginName: 'x', methodsLeft: [], comment: 'a‮b' })).statusCode).toBe(400);
    const name = `flood${randomBytes(3).toString('hex')}`;
    for (let i = 0; i < COMPROMISED_PER_NAME_DAILY; i++) expect((await report({ loginName: name, methodsLeft: [], comment: '' })).statusCode).toBe(202);
    const over = await report({ loginName: name, methodsLeft: [], comment: '' });
    expect(over.statusCode).toBe(429);
    expect(errorOf(over)).toBe('slow-down');
  });

  it("a team member's login: the member is locked out, the team owner is not", async () => {
    const owner = await trader();
    const m = await member(owner.id, ['support-see']);
    expect((await m.b.get('/v1/tickets')).statusCode).toBe(200);
    expect((await report({ loginName: m.loginName, methodsLeft: [], comment: '' })).statusCode).toBe(202);
    expect([401, 403]).toContain((await m.b.get('/v1/tickets')).statusCode);
    expect((await deps.db.query('select 1 from sessions where member_id = $1 and revoked_at is null', [m.id])).rowCount).toBe(0);
    expect((await owner.b.get('/v1/tickets')).statusCode).toBe(200);
    // Staff see a member's login as a member login (its display name is a placeholder nobody sees).
    const senior = await staff('senior');
    const list = (await senior.b.get('/staff/v1/compromised')).json() as { items: Array<{ locked: boolean; displayName: string | null; matched: boolean }> };
    expect(list.items.find((t) => t.matched && t.locked && t.displayName === null)).toBeDefined();
    expect(JSON.stringify(list)).not.toContain('placeholder');
  });

  it('only a senior moderator or the owner, with a key tap, lifts the lock; the report cannot close while locked; trades resume', async () => {
    const victim = await trader();
    const other = await trader();
    const { trade } = await seedTrade(deps, { sellerId: victim.id, buyerId: other.id, poster: 'seller' });
    await driveTo(deps, trade, 'secured');
    const id = await reportId((await report({ loginName: victim.loginName, methodsLeft: ['passkey'], comment: 'Phone stolen' })).json().number);

    const mod = await staff('mod', ['tickets.handle']);
    expect(errorOf(await mod.b.get(`/staff/v1/compromised/${id}`))).toBe('forbidden');
    expect(errorOf(await mod.b.post(`/staff/v1/compromised/${id}/unlock`, { tapId: 'x' }))).toBe('forbidden');
    // A support-ticket helper never sees a report in the ticket queue, nor opens it as a ticket.
    const helper = await staff('helper', ['tickets.handle']);
    expect(((await helper.b.get('/staff/v1/tickets')).json() as { items: Array<{ id: string }> }).items.some((t) => t.id === id)).toBe(false);
    expect((await helper.b.post(`/staff/v1/tickets/${id}/take`)).statusCode).toBe(404);

    const senior = await staff('senior');
    const listed = ((await senior.b.get('/staff/v1/compromised')).json() as { items: Array<{ id: string }> }).items.find((t) => t.id === id);
    expect(listed).toMatchObject({ matched: true, locked: true, methodsLeft: ['passkey'], displayName: `D${victim.loginName}` });
    expect(JSON.stringify(listed)).not.toContain('Phone');
    const view = (await senior.b.get(`/staff/v1/compromised/${id}`)).json();
    expect(view.comment).toBe('Phone stolen');
    expect(view.account).toMatchObject({ id: victim.id, kind: 'trader', lockedAt: T0.toISOString() });
    expect(view.account.openTrades).toEqual([{ code: trade.code, state: 'secured', side: 'seller', paused: true }]);
    expect(errorOf(await senior.b.post(`/staff/v1/compromised/${id}/close`))).toBe('account-locked');

    // No tap, a tap for another account or another report: refused, still locked.
    expect(errorOf(await senior.b.post(`/staff/v1/compromised/${id}/unlock`, {}))).toBe('tap-invalid');
    const wrongTap = await seedTap(deps, senior.id, { kind: 'unlock-account', accountId: other.id, ticketId: id });
    expect(errorOf(await senior.b.post(`/staff/v1/compromised/${id}/unlock`, { tapId: wrongTap }))).toBe('tap-invalid');
    const otherReport = await seedTap(deps, senior.id, { kind: 'unlock-account', accountId: victim.id, ticketId: '00000000-0000-4000-8000-000000000000' });
    expect(errorOf(await senior.b.post(`/staff/v1/compromised/${id}/unlock`, { tapId: otherReport }))).toBe('tap-invalid');
    expect((await deps.db.query('select 1 from account_locks where account_id = $1 and unlocked_at is null', [victim.id])).rowCount).toBe(1);

    setNow(new Date(T0.getTime() + 60 * 60_000));
    const tapId = await seedTap(deps, senior.id, { kind: 'unlock-account', accountId: victim.id, ticketId: id });
    const un = await senior.b.post(`/staff/v1/compromised/${id}/unlock`, { tapId });
    expect(un.statusCode, un.body).toBe(200);
    expect(un.json()).toEqual({ status: 'unlocked' });
    expect((await deps.db.query<{ disabled_at: Date | null }>('select disabled_at from accounts where id = $1', [victim.id])).rows[0]!.disabled_at).toBeNull();
    expect((await logEntries(deps, 'account.unlocked')).some((e) => JSON.stringify(e.detail).includes(victim.id))).toBe(true);
    expect(errorOf(await senior.b.post(`/staff/v1/compromised/${id}/unlock`, { tapId }))).toBe('wrong-state');
    // The timer loop's next pass resumes the trade; its deadlines moved by the hour it was held.
    const before = (await loadTrade(deps.db, trade.code))!;
    const timers = startTimers({ db: deps.db, clock: deps.clock, intervalMs: 0 });
    await timers.tick();
    await timers.stop();
    const after = (await loadTrade(deps.db, trade.code))!;
    expect(after.pausedAt).toBeNull();
    expect(after.payBy!.getTime() - before.payBy!.getTime()).toBe(60 * 60_000);
    const back = new Browser(app);
    await back.post('/t/login', { accountId: victim.id });
    expect((await back.get('/v1/tickets')).statusCode).toBe(200);
    const closed = await senior.b.post(`/staff/v1/compromised/${id}/close`);
    expect(closed.json()).toMatchObject({ id, status: 'closed' });
    expect((await logEntries(deps, 'account.report-closed')).some((e) => JSON.stringify(e.detail).includes(id))).toBe(true);
  });

  it('an account already disabled for another reason stays disabled after the unlock', async () => {
    const shut = await trader({ disabled: true });
    expect((await report({ loginName: shut.loginName, methodsLeft: [], comment: '' })).statusCode).toBe(202);
    const owner = await staff('owner');
    const { rows } = await deps.db.query<{ id: string }>("select id from tickets where kind = 'compromised' and account_id = $1", [shut.id]);
    const tapId = await seedTap(deps, owner.id, { kind: 'unlock-account', accountId: shut.id, ticketId: rows[0]!.id });
    expect((await owner.b.post(`/staff/v1/compromised/${rows[0]!.id}/unlock`, { tapId })).statusCode).toBe(200);
    expect((await deps.db.query<{ disabled_at: Date | null }>('select disabled_at from accounts where id = $1', [shut.id])).rows[0]!.disabled_at).not.toBeNull();
  });

  it('the moderation watch list sees a locked trade as paused from the lock on (J8)', async () => {
    const victim = await trader();
    const other = await trader();
    const { trade } = await seedTrade(deps, { sellerId: victim.id, buyerId: other.id, poster: 'seller' });
    await driveTo(deps, trade, 'secured');
    // The lock alone (before any pause is written): held for every path.
    await deps.db.query('insert into account_locks (account_id, locked_at, set_disabled) values ($1, $2, false)', [victim.id, T0]);
    expect((await deps.db.query(`select ${tradeHeldSql('t')} as held from trades t where t.code = $1`, [trade.code])).rows[0]).toEqual({ held: true });
    await deps.db.query('update account_locks set unlocked_at = $2 where account_id = $1', [victim.id, T0]);
  });
});

describe('J-14 review minors (J4-J7), ported', () => {
  it('J4: the 202 never waits on the after-lock work (a trade row held elsewhere does not delay it); the work still completes after', async () => {
    const victim = await trader();
    const other = await trader();
    const { trade } = await seedTrade(deps, { sellerId: victim.id, buyerId: other.id, poster: 'seller' });
    await driveTo(deps, trade, 'secured');
    const blocker = await deps.db.connect();
    try {
      await blocker.query('begin');
      await blocker.query('select 1 from trades where code = $1 for update', [trade.code]);
      const res = await Promise.race([
        new Browser(app).post('/v1/tickets/compromised', { loginName: victim.loginName, methodsLeft: [], comment: '' }),
        new Promise<'waited'>((r) => setTimeout(() => r('waited'), 3000)),
      ]);
      expect(res === 'waited' ? 'the reply waited on afterLock' : res.statusCode).toBe(202);
      expect((await deps.db.query(`select ${tradeHeldSql('t')} as held from trades t where t.code = $1`, [trade.code])).rows[0]).toEqual({ held: true });
    } finally {
      await blocker.query('rollback');
      blocker.release();
    }
    await afterLocksSettled();
    expect((await loadTrade(deps.db, trade.code))!.pausedAt).toEqual(T0);
    expect((await deps.db.query('select 1 from sessions where account_id = $1 and revoked_at is null', [victim.id])).rowCount).toBe(0);
  });

  it('J5: its own budget, apart from login starts: an empty start bucket does not stop it, and an empty form bucket answers 503 busy without touching login starts', async () => {
    const budgets = (app as unknown as { budgets: { start: { tokens: number }; compromised: { tokens: number } } }).budgets;
    budgets.start.tokens = 0;
    expect((await report({ loginName: 'nobody-j5-a', methodsLeft: [], comment: '' })).statusCode).toBe(202);
    budgets.start.tokens = 5;
    budgets.compromised.tokens = 0;
    const busy = await report({ loginName: 'nobody-j5-b', methodsLeft: [], comment: '' });
    expect(busy.statusCode).toBe(503);
    expect(errorOf(busy)).toBe('busy');
    expect(budgets.start.tokens).toBe(5);
  });

  it('J6: a staff read of a report logs account.report-viewed, ids only', async () => {
    const v = await trader();
    const id = await reportId((await report({ loginName: v.loginName, methodsLeft: [], comment: 'kumquat again' })).json().number);
    const senior = await staff('senior');
    expect((await senior.b.get(`/staff/v1/compromised/${id}`)).statusCode).toBe(200);
    const cv = (await logEntries(deps, 'account.report-viewed')).map((e) => ({ actor: e.actor_kind, detail: JSON.parse(e.detail) as unknown }));
    expect(cv).toContainEqual({ actor: 'staff', detail: { ticketId: id } });
    for (const e of await logEntries(deps, 'account.report-viewed')) expect(JSON.stringify(e)).not.toMatch(/kumquat/);
  });

  it('J7: a real password login and a recovery-code login are refused on a locked account (403 account-disabled), and the code stays unused', async () => {
    const { id, loginName } = await trader();
    const password = 'Correct-Horse-9-locked';
    const { hash, pepperId } = await hashPassword(deps.config, password);
    await deps.db.query('insert into passwords (account_id, hash, pepper_id, updated_at) values ($1, $2, $3, $4)', [id, hash, pepperId, deps.clock()]);
    const owner = new Browser(app);
    expect((await owner.post('/t/login', { accountId: id, firstSession: true })).statusCode).toBe(200);
    const codes = await owner.post('/v1/account/recovery-codes', {});
    expect(codes.statusCode, codes.body).toBe(200);
    const code = (codes.json() as { codes: string[] }).codes[0]!;
    expect((await report({ loginName, methodsLeft: ['password'], comment: '' })).statusCode).toBe(202);
    const pw = await new Browser(app).post('/v1/login/password', { loginName, password, deviceLabel: 'Thief browser' });
    expect({ status: pw.statusCode, error: errorOf(pw) }).toEqual({ status: 403, error: 'account-disabled' });
    const rc = await new Browser(app).post('/v1/login/backup', { loginName, kind: 'recovery-code', code, deviceLabel: 'Thief browser' });
    expect({ status: rc.statusCode, error: errorOf(rc) }).toEqual({ status: 403, error: 'account-disabled' });
    expect((await deps.db.query('select 1 from recovery_codes where account_id = $1 and used_at is not null', [id])).rowCount).toBe(0);
    expect((await deps.db.query('select 1 from sessions where account_id = $1 and revoked_at is null', [id])).rowCount).toBe(0);
  });

  // Review item 5 (lead default, owner question pending; was J2/J7: refused with trade-held): the other
  // trader must not learn of the lock, so their dispute goes in as on any paused trade (owner G7);
  // the dispute is then paused with the trade, and staff with rulings.approve may still rule.
  it("the counterparty's open-dispute on a held trade goes in, as on any paused trade, with nothing that names a lock", async () => {
    const victim = await trader();
    const buyer = await trader();
    const { trade } = await seedTrade(deps, { sellerId: victim.id, buyerId: buyer.id, poster: 'seller' });
    const paid = await driveTo(deps, trade, 'paid');
    expect((await report({ loginName: victim.loginName, methodsLeft: [], comment: '' })).statusCode).toBe(202);
    setNow(new Date(paid.confirmBy!.getTime() + 60_000));
    expect((await buyer.b.post('/t/login', { accountId: buyer.id })).statusCode).toBe(200);
    const res = await buyer.b.post(`/v1/trades/${trade.code}/dispute`, { reason: 'paid', note: '' });
    expect(res.statusCode, res.body).toBe(200);
    expect(JSON.stringify(res.json())).not.toMatch(/lock|compromis|held/i);
    expect((await deps.db.query('select 1 from disputes where code = $1', [trade.code])).rowCount).toBe(1);
  });
});

describe('retention', () => {
  it('a report is never purged while its lock holds; a lifted lock and its report go TICKET_KEEP_DAYS later', async () => {
    const v = await trader();
    const id = await reportId((await report({ loginName: v.loginName, methodsLeft: [], comment: 'x' })).json().number);
    const late = new Date(T0.getTime() + 200 * DAY_MS);
    await purgeTickets.run(deps.db, late);
    expect((await deps.db.query('select 1 from tickets where id = $1', [id])).rowCount).toBe(1);
    await deps.db.query('update account_locks set unlocked_at = $2 where account_id = $1', [v.id, new Date(T0.getTime() + DAY_MS)]);
    await purgeTickets.run(deps.db, late);
    expect((await deps.db.query('select 1 from tickets where id = $1', [id])).rowCount).toBe(0);
    expect((await deps.db.query('select 1 from account_locks where account_id = $1', [v.id])).rowCount).toBe(0);
  });
});

describe('X2F_TICKET_KEYS (J-14 review J6, ported; migration 861)', () => {
  it('seals under the ticket ring, never X2F_SERVER_KEY; opens a format-0 blob from before 861; rewrap moves it and every older key id', async () => {
    const ring = deps.config.ticketKeys;
    const blob = sealBody(deps.config, '00000000-0000-4000-8000-000000000001', 1, 'trader', SECRET);
    expect(blob[0]).toBe(1);
    expect((blob[1]! << 8) | blob[2]!).toBe(ring.current);
    expect(keyringBox(ring).open(blob, 'x2f/ticket-message/00000000-0000-4000-8000-000000000001/1/trader').length).toBeGreaterThan(0);

    // A ticket written before migration 861: format 0 under subkey('ticket-body').
    const v = await trader();
    const opened = await v.b.post('/v1/tickets', { category: 'trades', body: 'an old secret line' });
    expect(opened.statusCode, opened.body).toBe(201);
    const ticketId = opened.json().id as string;
    const legacy = (() => {
      const { createCipheriv } = require('node:crypto') as typeof import('node:crypto');
      const nonce = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', subkey(deps.config, 'ticket-body'), nonce, { authTagLength: 16 });
      c.setAAD(Buffer.from(`x2f/ticket-message/${ticketId}/1/trader`, 'utf8'));
      const body = Buffer.concat([c.update('an old secret line', 'utf8'), c.final()]);
      return Buffer.concat([Buffer.from([0]), nonce, body, c.getAuthTag()]);
    })();
    await deps.db.query('update ticket_messages set body_sealed = $2 where ticket_id = $1 and seq = 1', [ticketId, legacy]);
    expect(openBody(deps.config, ticketId, 1, 'trader', legacy)).toBe('an old secret line');
    expect(((await v.b.get(`/v1/tickets/${ticketId}`)).json() as { messages: Array<{ body: string }> }).messages[0]!.body).toBe('an old secret line');
    const r = await rewrapTicketSecrets({ db: deps.db, config: deps.config });
    expect(r.failed).toBe(0);
    expect(r.rewrapped).toBeGreaterThanOrEqual(1);
    const now = (await deps.db.query<{ body_sealed: Buffer }>('select body_sealed from ticket_messages where ticket_id = $1 and seq = 1', [ticketId])).rows[0]!.body_sealed;
    expect(now[0]).toBe(1);
    expect(openBody(deps.config, ticketId, 1, 'trader', now)).toBe('an old secret line');
    expect(await rewrapTicketSecrets({ db: deps.db, config: deps.config })).toEqual({ rewrapped: 0, failed: 0 });
  });
});

describe('team tickets (owner Q69, J-14 ported)', () => {
  it('a member reads with support-see and writes with support-open; the team shares the tickets; a line names its member to the team only', async () => {
    const lead = await trader();
    const none = await member(lead.id, ['trades-see-active']);
    const reader = await member(lead.id, ['support-see']);
    const writer = await member(lead.id, ['support-see', 'support-open']);
    const opener = await member(lead.id, ['support-open']);
    expect(errorOf(await none.b.get('/v1/tickets'))).toBe('forbidden');
    expect(errorOf(await reader.b.post('/v1/tickets', { category: 'trades', body: 'hi' }))).toBe('forbidden');

    const open = await writer.b.post('/v1/tickets', { category: 'trades', body: 'From the team: where is trade 1?' });
    expect(open.statusCode, open.body).toBe(201);
    const id = open.json().id as string;
    // The lead sees it (the team account's ticket), with the member named.
    const thread = (await lead.b.get(`/v1/tickets/${id}`)).json() as { messages: Array<{ from: string; by: string | null }> };
    expect(thread.messages).toEqual([expect.objectContaining({ from: 'trader', by: writer.name })]);
    expect(((await reader.b.get('/v1/tickets')).json() as { items: Array<{ id: string }> }).items.map((t) => t.id)).toContain(id);
    // Writing to a thread (whose answer is the thread) also needs support-see.
    expect(errorOf(await opener.b.post(`/v1/tickets/${id}/messages`, { body: 'me too' }))).toBe('forbidden');
    // The team log names the member's ticket (never its text).
    const audit = await deps.db.query<{ action: string; detail: unknown }>("select action, detail from team_audit where account_id = $1 and member_id = $2 and action like 'ticket-%'", [lead.id, writer.id]);
    expect(audit.rows).toEqual([{ action: 'ticket-opened', detail: { ticketId: id } }]);
    expect(JSON.stringify(audit.rows)).not.toContain('where is trade');

    // The lead's own line names nobody; the team shares the write gap and the limits.
    setNow(new Date(T0.getTime() + (TICKET_WRITE_GAP_S + 1) * 1000));
    expect((await lead.b.post(`/v1/tickets/${id}/messages`, { body: 'The lead adds a line.' })).statusCode).toBe(200);
    const after = (await writer.b.get(`/v1/tickets/${id}`)).json() as { messages: Array<{ by: string | null }> };
    expect(after.messages.map((m) => m.by ?? null)).toEqual([writer.name, null]);

    // Staff never learn which member wrote a line.
    const helper = await staff('helper', ['tickets.handle']);
    const cased = await helper.b.post(`/staff/v1/tickets/${id}/take`);
    expect(cased.statusCode, cased.body).toBe(200);
    expect(JSON.stringify(cased.json())).not.toContain(writer.name);
  });
});

// Review of feat/lockout (items 1-4, 6): each fix and its lead default (owner question pending).
describe('review of feat/lockout', () => {
  const lockedNow = async (id: string) => (await deps.db.query('select 1 from account_locks where account_id = $1 and unlocked_at is null', [id])).rowCount === 1;
  const skippedOf = async (number: number) =>
    (await deps.db.query<{ lock_skipped: string | null; account_id: string | null }>("select lock_skipped, account_id from tickets where kind = 'compromised' and number = $1", [number])).rows[0]!;
  async function unlock(accountId: string, number: number) {
    const senior = await staff('senior');
    const id = await reportId(number);
    const tapId = await seedTap(deps, senior.id, { kind: 'unlock-account', accountId, ticketId: id });
    const res = await senior.b.post(`/staff/v1/compromised/${id}/unlock`, { tapId });
    expect(res.statusCode, res.body).toBe(200);
    return { senior, id };
  }

  it(`item 1: once staff unlock an account, the form records reports on it but does not lock it again for ${RELOCK_BAR_DAYS} days; the answer is the same`, async () => {
    const v = await trader();
    const first = await report({ loginName: v.loginName, methodsLeft: [], comment: '' });
    expect(await lockedNow(v.id)).toBe(true);
    const { senior } = await unlock(v.id, first.json().number);
    setNow(new Date(T0.getTime() + 60_000));
    const again = await report({ loginName: v.loginName, methodsLeft: ['password'], comment: 'me again' });
    expect(again.statusCode).toBe(202);
    expect(Object.keys(again.json()).sort()).toEqual(['moderatorUrl', 'number']);
    expect(await lockedNow(v.id)).toBe(false);
    expect(await skippedOf(again.json().number)).toEqual({ lock_skipped: 'recent-unlock', account_id: v.id });
    const seen = await senior.b.get(`/staff/v1/compromised/${await reportId(again.json().number)}`);
    expect(seen.json()).toMatchObject({ lockSkipped: 'recent-unlock', account: { id: v.id, lockedAt: null } });
    // Past the bar, the form locks it again.
    setNow(new Date(T0.getTime() + (RELOCK_BAR_DAYS + 1) * DAY_MS));
    const later = await report({ loginName: v.loginName, methodsLeft: [], comment: '' });
    expect(await skippedOf(later.json().number)).toEqual({ lock_skipped: null, account_id: v.id });
    expect(await lockedNow(v.id)).toBe(true);
  });

  it('item 2: the lock revokes every session in its own transaction (no after-reply work needed) and ends their streams; the unlock revokes every session from before it', async () => {
    const v = await trader();
    const extra = await insertSession(deps, v.id, 'trader');
    const closeAccount = vi.spyOn(app.events, 'closeAccount');
    try {
      // The after-lock work is not awaited here: the sessions are already revoked when the reply is sent.
      const res = await new Browser(app).post('/v1/tickets/compromised', { loginName: v.loginName, methodsLeft: [], comment: '' });
      expect(res.statusCode).toBe(202);
      expect((await deps.db.query('select 1 from sessions where account_id = $1 and revoked_at is null', [v.id])).rowCount).toBe(0);
      expect(closeAccount).toHaveBeenCalledWith(v.id);
      await afterLocksSettled();
      // A session that somehow outlived the lock (made live again here by hand) is revoked by the unlock.
      await deps.db.query('update sessions set revoked_at = null where id = $1', [extra.sessionId]);
      await unlock(v.id, res.json().number);
      expect((await deps.db.query<{ revoked_at: Date | null }>('select revoked_at from sessions where id = $1', [extra.sessionId])).rows[0]!.revoked_at).not.toBeNull();
    } finally {
      closeAccount.mockRestore();
    }
  });

  it("item 2: a team member's login: the member's sessions on the team account are revoked in the lock's transaction", async () => {
    const lead = await trader();
    const m = await member(lead.id);
    const res = await new Browser(app).post('/v1/tickets/compromised', { loginName: m.loginName, methodsLeft: [], comment: '' });
    expect(res.statusCode).toBe(202);
    expect((await deps.db.query('select 1 from sessions where member_id = $1 and revoked_at is null', [m.id])).rowCount).toBe(0);
    // The lead's own session stays.
    expect((await deps.db.query('select 1 from sessions where account_id = $1 and member_id is null and revoked_at is null', [lead.id])).rowCount).toBeGreaterThan(0);
    await afterLocksSettled();
  });

  it('item 3: an account whose login name is still its public display name (legacy) is reported but never locked, flagged for staff', async () => {
    const v = await trader();
    await deps.db.query('update accounts set legacy_login_name = true where id = $1', [v.id]);
    const res = await report({ loginName: v.loginName, methodsLeft: [], comment: '' });
    expect(res.statusCode).toBe(202);
    expect(Object.keys(res.json()).sort()).toEqual(['moderatorUrl', 'number']);
    expect(await lockedNow(v.id)).toBe(false);
    expect((await deps.db.query<{ disabled_at: Date | null }>('select disabled_at from accounts where id = $1', [v.id])).rows[0]!.disabled_at).toBeNull();
    expect((await deps.db.query('select 1 from sessions where account_id = $1 and revoked_at is null', [v.id])).rowCount).toBeGreaterThan(0);
    expect(await skippedOf(res.json().number)).toEqual({ lock_skipped: 'legacy-login-name', account_id: v.id });
    const senior = await staff('senior');
    const list = await senior.b.get('/staff/v1/compromised');
    expect((list.json() as { items: Array<{ number: number; lockSkipped: string | null }> }).items.find((i) => i.number === res.json().number)).toMatchObject({ lockSkipped: 'legacy-login-name' });
  });

  it(`item 4: at most ${LOCK_CAP_PER_HOUR} new locks an hour site wide; over it a report is recorded, locks nothing, and the owner is alerted`, async () => {
    await staff('owner');
    const filler = await trader();
    const at = new Date(T0.getTime() - 10 * 60_000);
    for (let i = 0; i < LOCK_CAP_PER_HOUR; i++) {
      await deps.db.query('insert into account_locks (account_id, locked_at, set_disabled, unlocked_at) values ($1, $2, false, $2)', [filler.id, at]);
    }
    try {
      const v = await trader();
      const res = await report({ loginName: v.loginName, methodsLeft: [], comment: '' });
      expect(res.statusCode).toBe(202);
      expect(Object.keys(res.json()).sort()).toEqual(['moderatorUrl', 'number']);
      expect(await lockedNow(v.id)).toBe(false);
      expect(await skippedOf(res.json().number)).toEqual({ lock_skipped: 'lock-cap', account_id: v.id });
      const alert = await deps.db.query<{ detail: unknown }>("select detail from alerts where kind = 'compromised-lock-cap' order by created_at desc limit 1");
      expect(alert.rows[0]?.detail).toEqual({ ticketId: await reportId(res.json().number) });
      // An hour on, the cap has room again.
      setNow(new Date(T0.getTime() + 60 * 60_000));
      const w = await trader();
      await report({ loginName: w.loginName, methodsLeft: [], comment: '' });
      expect(await lockedNow(w.id)).toBe(true);
    } finally {
      await deps.db.query('delete from account_locks where account_id = $1', [filler.id]);
    }
  });

  it('item 4: the accept budget is its own and far larger than the lock cap, so a flood of locks cannot drain it in one go', () => {
    expect(COMPROMISED_BUCKET.capacity).toBeGreaterThan(10 * LOCK_CAP_PER_HOUR);
    expect(COMPROMISED_BUCKET.perMinute * 60).toBeGreaterThan(100 * LOCK_CAP_PER_HOUR);
  });

  it('item 6: migration 861 run a second time changes no row', async () => {
    const v = await trader();
    const opened = await v.b.post('/v1/tickets', { category: 'trades', body: 'run it twice' });
    expect(opened.statusCode, opened.body).toBe(201);
    const id = opened.json().id as string;
    const before = (await deps.db.query<{ body_sealed: Buffer }>('select body_sealed from ticket_messages where ticket_id = $1', [id])).rows[0]!.body_sealed;
    const sql = readFileSync(`${MIGRATIONS_DIR}861_ticket_key_ring.sql`, 'utf8');
    const c = await deps.db.connect();
    try {
      await c.query('begin');
      await c.query(sql);
      const after = (await c.query<{ body_sealed: Buffer }>('select body_sealed from ticket_messages where ticket_id = $1', [id])).rows[0]!.body_sealed;
      expect(after.equals(before)).toBe(true);
    } finally {
      await c.query('rollback');
      c.release();
    }
    expect(((await v.b.get(`/v1/tickets/${id}`)).json() as { messages: Array<{ body: string }> }).messages[0]!.body).toBe('run it twice');
  });
});
