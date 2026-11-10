// Plan 4 Task 30 / J-14: support tickets (owner D-055, D-056, D-057) and the "My account has been
// compromised" ticket with its full lockout (D-059).
import { TICKETS_DAILY } from '@x2f/core';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { PUBLIC_ROUTES } from '../src/auth/frontDoor.js';
import { hashPassword } from '../src/auth/password.js';
import { RETENTION_JOBS } from '../src/retentionJobs.js';
import { COMPROMISED_BUCKET } from '../src/limits.js';
import { tradeHeldSql } from '../src/tickets/held.js';
import { COMPROMISED_PER_NAME_DAILY, TICKET_KEEP_DAYS, afterLocksSettled, purgeTickets } from '../src/tickets/traderRoutes.js';
import { applyEvent, loadTrade } from '../src/trades/store.js';
import { startTimers } from '../src/trades/timers.js';
import { seedAccount } from './helpers/accounts.js';
import { StaffBrowser, errorOf, insertSession, logEntries, seedStaff, seedTap, staffApps, uniqueName } from './helpers/staffApp.js';
import { Browser, addTestLogin } from './helpers/totp.js';
import { FIAT, driveTo, seedTrade } from './helpers/trades.js';

const T0 = new Date('2026-11-09T10:00:00Z');
const SECRET = 'my-stolen-recovery-code-zebra-71';

let staffApp: FastifyInstance;
let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let close: () => Promise<void>;
let n = 0;

beforeAll(async () => {
  const s = await staffApps();
  ({ app: staffApp, trader: app, deps, setNow, close } = s);
  addTestLogin(app, deps);
});
afterAll(async () => close());
beforeEach(() => {
  setNow(T0);
  // The app-wide login-start budget is in memory; refill it for each test.
  (app as unknown as { budgets: { start: { tokens: number } } }).budgets.start.tokens = 120;
  // J5: the compromised form's own budget, refilled the same way.
  const own = (app as unknown as { budgets: { compromised?: { tokens: number } } }).budgets.compromised;
  if (own) own.tokens = COMPROMISED_BUCKET.capacity;
});

interface Trader {
  id: string;
  loginName: string;
  b: Browser;
}

async function trader(o: { disabled?: boolean } = {}): Promise<Trader> {
  const loginName = `tk${String(++n).padStart(4, '0')}${Date.now().toString(36)}`;
  const id = await seedAccount(deps, { loginName, ...(o.disabled ? { disabled: true } : {}) });
  const b = new Browser(app);
  if (!o.disabled) expect((await b.post('/t/login', { accountId: id })).statusCode).toBe(200);
  return { id, loginName, b };
}

/** A joined, logged-in member of `teamId` (its login account seeded directly, as team.test.ts does). */
async function member(teamId: string): Promise<{ id: string; loginId: string; loginName: string; name: string; b: Browser }> {
  const name = `Member${++n}`;
  const loginName = `mlogin${n}${Date.now().toString(36)}`;
  const loginId = await seedAccount(deps, { loginName, displayName: `m-${n}-placeholder`, kind: 'member' });
  const now = deps.clock();
  const { rows } = await deps.db.query<{ id: string }>(
    `insert into team_members (account_id, display_name, display_key, abilities, invite_expires_at, member_account_id, joined_at, created_at)
     values ($1, $2, $3, '{trades-see-active}', $4, $5, $4, $4) returning id`,
    [teamId, name, name.toLowerCase(), now, loginId],
  );
  const b = new Browser(app);
  expect((await b.post('/t/login', { accountId: loginId })).statusCode).toBe(200);
  return { id: rows[0]!.id, loginId, loginName, name, b };
}

async function staff(role: 'owner' | 'senior' | 'mod' | 'helper', grants: string[] = []) {
  const s = await seedStaff(deps, { role, grants, loginName: uniqueName(role) });
  const { token, sessionId } = await insertSession(deps, s.id, 'staff');
  return { ...s, sessionId, b: new StaffBrowser(staffApp).withSession(token) };
}

/** Sends the form and waits for its after-lock work (J4: it runs after the reply). */
const report = async (body: unknown) => {
  const res = await new Browser(app).post('/v1/tickets/compromised', body);
  await afterLocksSettled();
  return res;
};
const open = (b: Browser, body = 'I cannot see my trade', category = 'trades') => b.post('/v1/tickets', { category, body });

describe('support tickets: trader side', () => {
  it('opens a ticket, lists and reads only its own, and refuses a category outside the list', async () => {
    const a = await trader();
    const other = await trader();
    const res = await open(a.b);
    expect(res.statusCode, res.body).toBe(201);
    const ticket = res.json().ticket;
    expect(ticket).toMatchObject({ category: 'trades', status: 'open', tradeCode: null, closedAt: null });
    expect(typeof ticket.number).toBe('number');
    expect((await a.b.get('/v1/tickets')).json().tickets.map((t: { id: string }) => t.id)).toEqual([ticket.id]);
    expect((await other.b.get('/v1/tickets')).json().tickets).toEqual([]);
    expect((await other.b.get(`/v1/tickets/${ticket.id}`)).statusCode).toBe(404);
    expect((await other.b.post(`/v1/tickets/${ticket.id}/messages`, { body: 'hi' })).statusCode).toBe(404);
    const thread = (await a.b.get(`/v1/tickets/${ticket.id}`)).json();
    expect(thread.messages).toEqual([{ author: 'trader', memberName: null, body: 'I cannot see my trade', at: T0.toISOString() }]);
    const bad = await other.b.post('/v1/tickets', { category: 'compromised', body: 'x' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: 'bad-request', field: 'category' });
    expect((await other.b.post('/v1/tickets', { category: 'trades', body: '   ' })).statusCode).toBe(400);
    expect((await other.b.post('/v1/tickets', { category: 'trades', body: 'x', extra: 1 })).statusCode).toBe(400);
    expect((await new Browser(app).post('/v1/tickets', { category: 'trades', body: 'x' })).statusCode).toBe(401);
  });

  it('D-055: one open ticket per account until it is resolved ("answered" is still open)', async () => {
    const a = await trader();
    const first = (await open(a.b)).json().ticket;
    const second = await open(a.b, 'again');
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ error: 'ticket-open', number: first.number });
    await deps.db.query("update tickets set status = 'answered' where id = $1", [first.id]);
    expect((await open(a.b, 'again')).statusCode).toBe(409);
    expect((await a.b.post(`/v1/tickets/${first.id}/close`)).json().ticket).toMatchObject({ status: 'closed', closedAt: T0.toISOString() });
    expect((await a.b.post(`/v1/tickets/${first.id}/messages`, { body: 'late' })).json()).toEqual({ error: 'ticket-closed' });
    expect((await open(a.b, 'again')).statusCode).toBe(201);
  });

  it(`D-056/D-057: ${TICKETS_DAILY} tickets a day per account, shared across the team, then 429 with the daily limit until UTC midnight`, async () => {
    const owner = await trader();
    const m = await member(owner.id);
    for (let i = 0; i < TICKETS_DAILY; i++) {
      // Owner and member take turns: one shared count, one shared open ticket.
      const who = i % 2 === 0 ? owner.b : m.b;
      const res = await open(who, `ticket ${i}`);
      expect(res.statusCode, res.body).toBe(201);
      expect((await m.b.post(`/v1/tickets/${res.json().ticket.id}/close`)).statusCode).toBe(200);
    }
    const over = await open(m.b, 'eleventh');
    expect(over.statusCode).toBe(429);
    expect(over.json()).toEqual({ error: 'slow-down', limit: 'daily', retryAfterSeconds: 14 * 3600 });
    expect((await open(owner.b, 'eleventh')).statusCode).toBe(429);
    // The member's tickets are the team's: the owner sees them all, with the member named.
    const list = (await owner.b.get('/v1/tickets')).json().tickets;
    expect(list).toHaveLength(TICKETS_DAILY);
    const byMember = list.find((t: { id: string }) => t.id !== undefined && t.id === list[0].id);
    const thread = (await owner.b.get(`/v1/tickets/${byMember.id}`)).json();
    expect(thread.messages[0].memberName).toBe(m.name);
    // The next UTC day starts a new count.
    setNow(new Date('2026-11-10T00:00:00Z'));
    const fresh = new Browser(app);
    expect((await fresh.post('/t/login', { accountId: owner.id })).statusCode).toBe(200);
    expect((await open(fresh, 'next day')).statusCode).toBe(201);
  });

  it('a parallel burst opens exactly one ticket', async () => {
    const a = await trader();
    const codes = (await Promise.all(Array.from({ length: 6 }, (_, i) => open(a.b, `burst ${i}`)))).map((r) => r.statusCode).sort();
    expect(codes).toEqual([201, 409, 409, 409, 409, 409]);
  });

  it('a trade code must be one of the account own trades', async () => {
    const a = await trader();
    const b = await trader();
    const c = await trader();
    const { code } = await seedTrade(deps, { sellerId: a.id, buyerId: b.id, poster: 'seller' });
    const foreign = await c.b.post('/v1/tickets', { category: 'trades', body: 'x', tradeCode: code });
    expect(foreign.json()).toMatchObject({ error: 'bad-request', field: 'tradeCode' });
    const own = await b.b.post('/v1/tickets', { category: 'trades', body: 'x', tradeCode: code.replace(/-/g, '').toLowerCase() });
    expect(own.statusCode, own.body).toBe(201);
    expect(own.json().ticket.tradeCode).toBe(code);
  });
});

describe('support tickets: staff side', () => {
  it('needs tickets.handle (granted per person); a reply is logged without its text and never names the staff member to the trader', async () => {
    const a = await trader();
    const t = (await open(a.b, 'The secret word is aubergine')).json().ticket;
    const mod = await staff('mod');
    expect(errorOf(await mod.b.get('/staff/v1/tickets'))).toBe('forbidden');
    expect(errorOf(await mod.b.post(`/staff/v1/tickets/${t.id}/messages`, { body: 'x' }))).toBe('forbidden');
    const helper = await staff('helper', ['tickets.handle']);
    const queue = (await helper.b.get('/staff/v1/tickets')).json().tickets;
    expect(queue.find((q: { id: string }) => q.id === t.id)).toMatchObject({ number: t.number, category: 'trades', displayName: `D${a.loginName}` });
    const reply = await helper.b.post(`/staff/v1/tickets/${t.id}/messages`, { body: 'Answer with the word papaya' });
    expect(reply.statusCode, reply.body).toBe(201);
    const staffView = (await helper.b.get(`/staff/v1/tickets/${t.id}`)).json();
    expect(staffView.ticket.status).toBe('answered');
    expect(staffView.messages[1]).toMatchObject({ author: 'staff', body: 'Answer with the word papaya' });
    expect(staffView.messages[1].staffName).toBe(`D${helper.loginName}`);
    const traderView = (await a.b.get(`/v1/tickets/${t.id}`)).json();
    expect(traderView.messages[1]).toEqual({ author: 'staff', memberName: null, body: 'Answer with the word papaya', at: T0.toISOString() });
    expect(JSON.stringify(traderView)).not.toContain(helper.id);
    expect(JSON.stringify(traderView)).not.toContain(helper.loginName);
    // A trader's reply opens it again.
    expect((await a.b.post(`/v1/tickets/${t.id}/messages`, { body: 'thanks' })).statusCode).toBe(201);
    expect((await a.b.get(`/v1/tickets/${t.id}`)).json().ticket.status).toBe('open');
    expect((await helper.b.post(`/staff/v1/tickets/${t.id}/close`)).json().ticket.status).toBe('closed');
    const logged = [...(await logEntries(deps, 'ticket.replied')), ...(await logEntries(deps, 'ticket.closed'))];
    expect(logged.length).toBeGreaterThanOrEqual(2);
    for (const e of logged) expect(JSON.stringify(e)).not.toMatch(/aubergine|papaya|thanks/);
    expect((await deps.db.query("select 1 from activity_log where detail::text ~ 'aubergine|papaya'")).rowCount).toBe(0);
    // Helpers never see compromised-account tickets.
    expect(errorOf(await helper.b.get('/staff/v1/compromised'))).toBe('forbidden');
  });
});

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
    expect(Object.keys(res.json())).toEqual(['number']);

    // Every session of the account: refused at once, and revoked.
    expect(errorOf(await victim.b.get('/v1/tickets'))).toBe('not-authenticated');
    const live = await deps.db.query('select 1 from sessions where account_id = $1 and revoked_at is null', [victim.id]);
    expect(live.rowCount).toBe(0);
    const acct = await deps.db.query<{ disabled_at: Date | null }>('select disabled_at from accounts where id = $1', [victim.id]);
    expect(acct.rows[0]!.disabled_at).toEqual(T0);
    // A new session (the test login skips the finish's `assertNotDisabled`) is refused on every request.
    const again = new Browser(app);
    await again.post('/t/login', { accountId: victim.id });
    expect(errorOf(await again.get('/v1/tickets'))).toBe('account-disabled');
    // Both open trades paused at once, as the seller and as the buyer.
    expect((await loadTrade(deps.db, secured.code))!.pausedAt).toEqual(T0);
    expect((await loadTrade(deps.db, second.code))!.pausedAt).toEqual(T0);
    // The ticket: the account, the ticked kinds, the comment; never the typed login name.
    const t = await deps.db.query<{ account_id: string; methods_left: string[]; kind: string }>("select * from tickets where kind = 'compromised' and account_id = $1", [victim.id]);
    expect(t.rows[0]).toMatchObject({ account_id: victim.id, methods_left: ['password', 'recovery-code'] });
    const dump = JSON.stringify((await deps.db.query("select t.*, m.body from tickets t left join ticket_messages m on m.ticket_id = t.id where t.kind = 'compromised'")).rows);
    expect(dump.toLowerCase()).not.toContain(victim.loginName.toLowerCase());
    expect((await logEntries(deps, 'account.locked')).some((e) => e.actor_kind === 'system' && JSON.stringify(e.detail).includes(victim.id))).toBe(true);
    for (const e of await logEntries(deps, 'account.locked')) expect(JSON.stringify(e)).not.toContain(SECRET);
  });

  it('a held trade: no trader event moves it (the other party neither); the timer loop keeps it paused through maintenance', async () => {
    const victim = await trader();
    const other = await trader();
    const { trade } = await seedTrade(deps, { sellerId: other.id, buyerId: victim.id, poster: 'seller' });
    await driveTo(deps, trade, 'secured');
    expect((await report({ loginName: victim.loginName, methodsLeft: [], comment: '' })).statusCode).toBe(202);
    // The other party (the seller) is refused too, whatever the event.
    await expect(applyEvent({ db: deps.db, clock: deps.clock }, trade.code, { type: 'propose-cancel' }, 'seller')).rejects.toMatchObject({ status: 409, code: 'trade-held' });
    await expect(applyEvent({ db: deps.db, clock: deps.clock }, trade.code, { type: 'mark-paid', fiatCents: FIAT }, 'buyer')).rejects.toMatchObject({ code: 'trade-held' });
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

  it('answers the same for an unknown name, a staff name and an account already locked, and locks nothing for them', async () => {
    const before = await deps.db.query('select count(*)::int as n from account_locks');
    const unknown = await report({ loginName: 'no-such-person-here', methodsLeft: ['password'], comment: 'help' });
    const malformed = await report({ loginName: '!!', methodsLeft: [], comment: '' });
    const mod = await staff('mod');
    const staffName = await report({ loginName: mod.loginName, methodsLeft: [], comment: '' });
    for (const r of [unknown, malformed, staffName]) {
      expect(r.statusCode, r.body).toBe(202);
      expect(Object.keys(r.json())).toEqual(['number']);
    }
    expect((await deps.db.query('select count(*)::int as n from account_locks')).rows[0]).toEqual(before.rows[0]);
    expect((await deps.db.query<{ disabled_at: Date | null }>('select disabled_at from accounts where id = $1', [mod.id])).rows[0]!.disabled_at).toBeNull();
    expect((await mod.b.get('/staff/v1/account')).statusCode).not.toBe(403);
    // No account on those tickets.
    const rows = await deps.db.query<{ account_id: string | null }>("select account_id from tickets where kind = 'compromised' and number = any($1::bigint[])", [
      [unknown.json().number, malformed.json().number, staffName.json().number],
    ]);
    expect(rows.rows.map((r) => r.account_id)).toEqual([null, null, null]);
    // A second report for a locked account: same answer, still one lock.
    const v = await trader();
    await report({ loginName: v.loginName, methodsLeft: [], comment: '' });
    const again = await report({ loginName: v.loginName, methodsLeft: [], comment: '' });
    expect(again.statusCode).toBe(202);
    expect((await deps.db.query('select count(*)::int as n from account_locks where account_id = $1', [v.id])).rows[0]).toEqual({ n: 1 });
  });

  // Batch 3's front door (requireInside: visitors read nothing but the landing) keeps this one ticket
  // route open, as an explicit PUBLIC_ROUTES exemption: the person may have lost every way in.
  it('is the one ticket route outside the front door: logged out (or on a made-up cookie) it answers the same 202 for a live name and an unknown one; the ticket reads stay closed', async () => {
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
    for (const r of answers) {
      expect(r.statusCode, r.body).toBe(202);
      expect(Object.keys(r.json())).toEqual(['number']);
    }
    expect((await deps.db.query('select count(*)::int as n from account_locks where account_id = $1 and unlocked_at is null', [v.id])).rows[0]).toEqual({ n: 1 });
    for (const url of ['/v1/tickets', '/v1/tickets/00000000-0000-4000-8000-000000000000']) {
      const r = await app.inject({ method: 'GET', url });
      expect(r.statusCode, url).toBe(401);
      expect(r.json()).toEqual({ error: 'not-authenticated' });
    }
  });

  it(`refuses a bad body, and more than ${COMPROMISED_PER_NAME_DAILY} reports a day for one typed name`, async () => {
    expect((await report({ loginName: 'x', methodsLeft: ['a-password-value'], comment: '' })).statusCode).toBe(400);
    expect((await report({ loginName: 'x', methodsLeft: ['password', 'password'], comment: '' })).statusCode).toBe(400);
    expect((await report({ loginName: 'x', methodsLeft: [], comment: '', password: 'hunter2' })).statusCode).toBe(400);
    expect((await report({ methodsLeft: [], comment: '' })).statusCode).toBe(400);
    const name = `flood${Date.now().toString(36)}`;
    for (let i = 0; i < COMPROMISED_PER_NAME_DAILY; i++) expect((await report({ loginName: name, methodsLeft: [], comment: '' })).statusCode).toBe(202);
    const over = await report({ loginName: name, methodsLeft: [], comment: '' });
    expect(over.statusCode).toBe(429);
    expect(errorOf(over)).toBe('slow-down');
  });

  it("a team member's login: the member is locked out, the team owner is not", async () => {
    const owner = await trader();
    const m = await member(owner.id);
    expect((await m.b.get('/v1/tickets')).statusCode).toBe(200);
    expect((await report({ loginName: m.loginName, methodsLeft: [], comment: '' })).statusCode).toBe(202);
    expect([401, 403]).toContain((await m.b.get('/v1/tickets')).statusCode);
    expect((await deps.db.query('select 1 from sessions where member_id = $1 and revoked_at is null', [m.id])).rowCount).toBe(0);
    expect((await owner.b.get('/v1/tickets')).statusCode).toBe(200);
    // Staff see a member's login as "a team member login" (its display name is a placeholder nobody sees).
    const senior = await staff('senior');
    const row = (await senior.b.get('/staff/v1/compromised')).json().tickets.find((t: { locked: boolean; displayName: string | null; matched: boolean }) => t.matched && t.locked && t.displayName === null);
    expect(row).toBeDefined();
    expect(JSON.stringify((await senior.b.get('/staff/v1/compromised')).json())).not.toContain('placeholder');
  });

  it('only a senior moderator or the owner, with a key tap, lifts the lock; the ticket cannot close while locked; trades resume', async () => {
    const victim = await trader();
    const other = await trader();
    const { trade } = await seedTrade(deps, { sellerId: victim.id, buyerId: other.id, poster: 'seller' });
    await driveTo(deps, trade, 'secured');
    const number = (await report({ loginName: victim.loginName, methodsLeft: ['passkey'], comment: 'Phone stolen' })).json().number;
    const { rows } = await deps.db.query<{ id: string }>('select id from tickets where number = $1', [number]);
    const id = rows[0]!.id;

    const mod = await staff('mod', ['tickets.handle']);
    expect(errorOf(await mod.b.get(`/staff/v1/compromised/${id}`))).toBe('forbidden');
    expect(errorOf(await mod.b.post(`/staff/v1/compromised/${id}/unlock`, { tapId: 'x' }))).toBe('forbidden');

    const senior = await staff('senior');
    const listed = (await senior.b.get('/staff/v1/compromised')).json().tickets.find((t: { id: string }) => t.id === id);
    expect(listed).toMatchObject({ matched: true, locked: true, methodsLeft: ['passkey'], displayName: `D${victim.loginName}` });
    const view = (await senior.b.get(`/staff/v1/compromised/${id}`)).json();
    expect(view.comment).toBe('Phone stolen');
    expect(view.account).toMatchObject({ id: victim.id, kind: 'trader', lockedAt: T0.toISOString() });
    expect(view.account.openTrades).toEqual([{ code: trade.code, state: 'secured', side: 'seller', paused: true }]);
    expect(errorOf(await senior.b.post(`/staff/v1/compromised/${id}/close`))).toBe('account-locked');

    // No tap, or a tap for another account: refused, still locked.
    expect(errorOf(await senior.b.post(`/staff/v1/compromised/${id}/unlock`, {}))).toBe('tap-invalid');
    const wrongTap = await seedTap(deps, senior.id, { kind: 'unlock-account', accountId: other.id });
    expect(errorOf(await senior.b.post(`/staff/v1/compromised/${id}/unlock`, { tapId: wrongTap }))).toBe('tap-invalid');
    expect((await deps.db.query('select 1 from account_locks where account_id = $1 and unlocked_at is null', [victim.id])).rowCount).toBe(1);

    setNow(new Date(T0.getTime() + 60 * 60_000));
    const tapId = await seedTap(deps, senior.id, { kind: 'unlock-account', accountId: victim.id });
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
    // The person can use the site again; the ticket can now be closed.
    const back = new Browser(app);
    await back.post('/t/login', { accountId: victim.id });
    expect((await back.get('/v1/tickets')).statusCode).toBe(200);
    expect((await senior.b.post(`/staff/v1/compromised/${id}/close`)).json().ticket.status).toBe('closed');
  });

  it('an account already disabled for another reason stays disabled after the unlock', async () => {
    const closed = await trader({ disabled: true });
    expect((await report({ loginName: closed.loginName, methodsLeft: [], comment: '' })).statusCode).toBe(202);
    const owner = await staff('owner');
    const { rows } = await deps.db.query<{ id: string }>("select id from tickets where kind = 'compromised' and account_id = $1", [closed.id]);
    const tapId = await seedTap(deps, owner.id, { kind: 'unlock-account', accountId: closed.id });
    expect((await owner.b.post(`/staff/v1/compromised/${rows[0]!.id}/unlock`, { tapId })).statusCode).toBe(200);
    expect((await deps.db.query<{ disabled_at: Date | null }>('select disabled_at from accounts where id = $1', [closed.id])).rows[0]!.disabled_at).not.toBeNull();
  });
});

describe('J-14 review minors (J4-J7)', () => {
  // J4: no timing oracle. The 202 goes out before the session revokes and trade pauses run; the
  // trades are held from the lock's commit anyway (tradeHeldSql).
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
      // Held from the commit already: no trader event moves it while the pause is still queued.
      expect((await deps.db.query(`select ${tradeHeldSql('t')} as held from trades t where t.code = $1`, [trade.code])).rows[0]).toEqual({ held: true });
    } finally {
      await blocker.query('rollback');
      blocker.release();
    }
    await afterLocksSettled();
    expect((await loadTrade(deps.db, trade.code))!.pausedAt).toEqual(T0);
    expect((await deps.db.query('select 1 from sessions where account_id = $1 and revoked_at is null', [victim.id])).rowCount).toBe(0);
  });

  // J5: the form has its own budget; a flood of reports never starves login starts (nor the reverse).
  it('J5: its own budget, apart from login starts: an empty start bucket does not stop it, and an empty form bucket answers 503 busy without touching login starts', async () => {
    const budgets = (app as unknown as { budgets: { start: { tokens: number }; compromised: { tokens: number } } }).budgets;
    budgets.compromised.tokens = COMPROMISED_BUCKET.capacity;
    budgets.start.tokens = 0;
    expect((await report({ loginName: 'nobody-j5-a', methodsLeft: [], comment: '' })).statusCode).toBe(202);
    budgets.start.tokens = 5;
    budgets.compromised.tokens = 0;
    const busy = await report({ loginName: 'nobody-j5-b', methodsLeft: [], comment: '' });
    expect(busy.statusCode).toBe(503);
    expect(errorOf(busy)).toBe('busy');
    expect(budgets.start.tokens).toBe(5);
    budgets.compromised.tokens = COMPROMISED_BUCKET.capacity;
  });

  // J6: staff reads of a ticket are audited, ids only (as dispute evidence reads are).
  it('J6: a staff read of a support ticket logs ticket.viewed, of a compromised ticket compromised.viewed, ids only', async () => {
    const a = await trader();
    const t = (await open(a.b, 'The secret word is kumquat')).json().ticket;
    const helper = await staff('helper', ['tickets.handle']);
    expect((await helper.b.get(`/staff/v1/tickets/${t.id}`)).statusCode).toBe(200);
    const viewed = (await logEntries(deps, 'ticket.viewed')).map((e) => ({ actor: e.actor_kind, detail: JSON.parse(e.detail) as unknown }));
    expect(viewed).toContainEqual({ actor: 'staff', detail: { ticketId: t.id } });

    const v = await trader();
    const number = (await report({ loginName: v.loginName, methodsLeft: [], comment: 'kumquat again' })).json().number;
    const id = (await deps.db.query<{ id: string }>("select id from tickets where kind = 'compromised' and number = $1", [number])).rows[0]!.id;
    const senior = await staff('senior');
    expect((await senior.b.get(`/staff/v1/compromised/${id}`)).statusCode).toBe(200);
    const cv = (await logEntries(deps, 'compromised.viewed')).map((e) => ({ actor: e.actor_kind, detail: JSON.parse(e.detail) as unknown }));
    expect(cv).toContainEqual({ actor: 'staff', detail: { ticketId: id } });
    for (const e of [...(await logEntries(deps, 'ticket.viewed')), ...(await logEntries(deps, 'compromised.viewed'))]) {
      expect(JSON.stringify(e)).not.toMatch(/kumquat/);
    }
  });

  // J7: the real login finishes (not /t/login) refuse a locked account.
  it('J7: a real password login and a recovery-code login are refused on a locked account (403 account-disabled), and the code stays unused', async () => {
    const { id, loginName } = await trader();
    const password = 'Correct-Horse-9-locked';
    // A real stored password (Argon2id, peppered), as the password routes write it.
    const { hash, pepperId } = await hashPassword(deps.config, password);
    await deps.db.query('insert into passwords (account_id, hash, pepper_id, updated_at) values ($1, $2, $3, $4)', [id, hash, pepperId, deps.clock()]);
    // Before the lock both finishes work (so the refusals below are the lock's).
    expect((await new Browser(app).post('/v1/login/password', { loginName, password, deviceLabel: 'My browser' })).statusCode).toBe(200);
    // A first session may make recovery codes without a confirm (as recovery.test.ts does).
    const owner = new Browser(app);
    expect((await owner.post('/t/login', { accountId: id, firstSession: true })).statusCode).toBe(200);
    const codes = await owner.post('/v1/account/recovery-codes', {});
    expect(codes.statusCode, codes.body).toBe(200);
    const code = (codes.json() as { codes: string[] }).codes[0]!;
    expect((await report({ loginName, methodsLeft: ['password'], comment: '' })).statusCode).toBe(202);
    const pw = await new Browser(app).post('/v1/login/password', { loginName, password, deviceLabel: 'Thief browser' });
    expect({ status: pw.statusCode, body: pw.json() }).toEqual({ status: 403, body: { error: 'account-disabled' } });
    const rc = await new Browser(app).post('/v1/login/backup', { loginName, kind: 'recovery-code', code, deviceLabel: 'Thief browser' });
    expect({ status: rc.statusCode, body: rc.json() }).toEqual({ status: 403, body: { error: 'account-disabled' } });
    expect((await deps.db.query('select 1 from recovery_codes where account_id = $1 and used_at is not null', [id])).rowCount).toBe(0);
    expect((await deps.db.query('select 1 from sessions where account_id = $1 and revoked_at is null', [id])).rowCount).toBe(0);
  });

  // J7 / J2: today's behaviour, pinned until the owner answers J2 (p11-79): the other party of a held
  // trade cannot open a dispute either (409 trade-held), and no dispute row is written.
  it("J7: the counterparty's open-dispute on a held trade is refused today (409 trade-held)", async () => {
    const victim = await trader();
    const buyer = await trader();
    const { trade } = await seedTrade(deps, { sellerId: victim.id, buyerId: buyer.id, poster: 'seller' });
    const paid = await driveTo(deps, trade, 'paid');
    expect((await report({ loginName: victim.loginName, methodsLeft: [], comment: '' })).statusCode).toBe(202);
    // Past the confirm window, when the buyer could dispute (trade-rules P1); trader sessions end
    // 2 h after start, so the buyer logs in again after the clock jump.
    setNow(new Date(paid.confirmBy!.getTime() + 60_000));
    expect((await buyer.b.post('/t/login', { accountId: buyer.id })).statusCode).toBe(200);
    const res = await buyer.b.post(`/v1/trades/${trade.code}/dispute`, { reason: 'paid', note: '' });
    expect({ status: res.statusCode, error: errorOf(res) }).toEqual({ status: 409, error: 'trade-held' });
    expect((await deps.db.query('select 1 from disputes where code = $1', [trade.code])).rowCount).toBe(0);
  });
});

describe('purgeTickets (Task 30: TICKET_KEEP_DAYS after closing; a ticket naming a trade follows the trade)', () => {
  it('deletes a closed ticket (and its thread) TICKET_KEEP_DAYS after it closed, never an open one or one whose trade is still kept', async () => {
    const a = await trader();
    const b = await trader();
    const { code } = await seedTrade(deps, { sellerId: a.id, buyerId: b.id, poster: 'seller' });
    const plain = (await open(a.b, 'old one')).json().ticket;
    await a.b.post(`/v1/tickets/${plain.id}/close`);
    const withTrade = (await a.b.post('/v1/tickets', { category: 'trades', body: 'about a trade', tradeCode: code })).json().ticket;
    await a.b.post(`/v1/tickets/${withTrade.id}/close`);
    const stillOpen = (await open(b.b, 'open one')).json().ticket;
    expect(RETENTION_JOBS).toContain(purgeTickets);
    const ids = [plain.id, withTrade.id, stillOpen.id];
    const left = async () => (await deps.db.query<{ id: string }>('select id from tickets where id = any($1::uuid[]) order by number', [ids])).rows.map((r) => r.id);
    await purgeTickets.run(deps.db, new Date(T0.getTime() + (TICKET_KEEP_DAYS * 86_400_000 - 1)));
    expect(await left()).toEqual(ids);
    await purgeTickets.run(deps.db, new Date(T0.getTime() + TICKET_KEEP_DAYS * 86_400_000));
    expect(await left()).toEqual([withTrade.id, stillOpen.id]);
    expect((await deps.db.query('select 1 from ticket_messages where ticket_id = $1', [plain.id])).rowCount).toBe(0);
  });
});
