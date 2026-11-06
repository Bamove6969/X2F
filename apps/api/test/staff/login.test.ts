// Plan 4 Task 4: the staff API shell, staff login with login hours, and staff sessions.
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { LoginHours } from '@x2f/staff';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../../src/app.js';
import { requireStaff } from '../../src/staff/guard.js';
import { buildStaffApi } from '../../src/staff/app.js';
import { staffListenFromEnv } from '../../src/staff/main.js';
import { sweepHours, startHoursSweeper } from '../../src/staff/sweeper.js';
import { createSoftAuthenticator, type SoftAuthenticator } from '../helpers/softAuthenticator.js';
import {
  MODERATION_STUB,
  SESSION_COOKIE,
  STAFF_ORIGIN,
  STAFF_SESSION_COOKIE,
  StaffBrowser,
  TRADER_ORIGIN,
  errorOf,
  insertSession,
  logEntries,
  seedStaff,
  staffApps,
} from '../helpers/staffApp.js';
import { seedAccount } from '../helpers/accounts.js';

const MIN = 60_000;
/** Mon–Fri 09:00–17:00 in UTC. 2026-11-02 is a Monday. */
const OFFICE: LoginHours = { days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], start: '09:00', end: '17:00', tz: 'UTC' };
const MON_NOON = new Date('2026-11-02T12:00:00Z');
const MON_1659 = new Date('2026-11-02T16:59:00Z');
const MON_1700 = new Date('2026-11-02T17:00:00Z');
const MON_1701 = new Date('2026-11-02T17:01:00Z');

let app: FastifyInstance;
let trader: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let close: () => Promise<void>;
let logs: string[];
/** The one owner of this database (`one_owner`), shared by the tests. */
let owner: { id: string; loginName: string };

beforeAll(async () => {
  ({ app, trader, deps, setNow, close, logs } = await staffApps());
  setNow(MON_NOON);
  owner = await seedStaff(deps, { role: 'owner' });
});
afterAll(async () => close());
beforeEach(() => setNow(MON_NOON));

async function addKey(accountId: string): Promise<SoftAuthenticator> {
  const key = createSoftAuthenticator({ backedUp: false, userVerified: true });
  await deps.db.query(
    `insert into webauthn_credentials (account_id, credential_id, public_key, counter, kind, backed_up, device_type, attested, label, created_at)
     values ($1, $2, $3, 0, 'security-key', false, 'singleDevice', true, 'k', $4)`,
    [accountId, Buffer.from(key.credentialId, 'base64url'), key.cosePublicKey, deps.clock()],
  );
  return key;
}

/** The first factor with a security key: `{ status: 'second-factor', ... }` or a refusal. */
async function keyFirstStep(b: StaffBrowser, loginName: string, key: SoftAuthenticator) {
  const start = (await b.post('/staff/v1/login/security-key/start', { loginName })).json();
  return b.post('/staff/v1/login/security-key/finish', {
    challengeId: start.challengeId, response: key.authenticate(start.options, STAFF_ORIGIN), deviceLabel: 'Desk',
  });
}

/**
 * A whole two-factor login: a PGP first factor recorded for this browser (as `completeLogin` writes
 * it; PGP itself is Plan 2's and tested there), then the security key as the second step.
 */
async function fullLogin(b: StaffBrowser, accountId: string, loginName: string, key: SoftAuthenticator) {
  const probe = (await b.post('/staff/v1/login/security-key/start', { loginName })).json();
  const { rows: dev } = await deps.db.query<{ device_hash: Buffer }>('select device_hash from challenges where id = $1', [probe.challengeId]);
  const now = deps.clock();
  const { rows } = await deps.db.query<{ id: string }>(
    `insert into challenges (account_id, device_hash, purpose, method, payload, created_at, expires_at)
     values ($1, $2, 'second-factor', 'pair', $3, $4, $5) returning id`,
    [accountId, dev[0]!.device_hash, JSON.stringify({ first: { method: 'pgp', fingerprint: 'a'.repeat(40), fingerprints: ['a'.repeat(40)] } }), now, new Date(now.getTime() + 5 * MIN)],
  );
  const pendingId = rows[0]!.id;
  const start = (await b.post('/staff/v1/login/security-key/start', { pendingId })).json();
  return b.post('/staff/v1/login/security-key/finish', {
    challengeId: start.challengeId, response: key.authenticate(start.options, STAFF_ORIGIN), deviceLabel: 'Desk', pendingId,
  });
}

describe('staff login with login hours', () => {
  it('logs a staff member in with a security key inside their hours, on the staff cookie only', async () => {
    const s = await seedStaff(deps, { role: 'mod', hours: OFFICE });
    const key = await addKey(s.id);
    const b = new StaffBrowser(app);
    const first = await keyFirstStep(b, s.loginName, key);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ status: 'second-factor', needs: ['pgp'] });
    const res = await fullLogin(b, s.id, s.loginName, key);
    expect(res.json()).toEqual({ status: 'ok' });
    expect(b.cookies[STAFF_SESSION_COOKIE]).toBeDefined();
    expect(b.cookies[SESSION_COOKIE]).toBeUndefined();
    const { rows } = await deps.db.query("select app from sessions where account_id = $1 and revoked_at is null", [s.id]);
    expect(rows).toEqual([{ app: 'staff' }]);
    const me = await b.get('/staff/v1/me');
    expect(me.statusCode).toBe(200);
    // The 2-hour idle limit (14:00) comes before the end of the window (17:00).
    expect(me.json()).toEqual({ username: `D${s.loginName}`, role: 'mod', nav: ['disputes', 'training', 'log'], sessionEndsAt: '2026-11-02T14:00:00.000Z' });
  });

  it('refuses the same login 1 minute after the window closes, only after the key verifies', async () => {
    const s = await seedStaff(deps, { role: 'mod', hours: OFFICE });
    const key = await addKey(s.id);
    setNow(MON_1701);
    const res = await keyFirstStep(new StaffBrowser(app), s.loginName, key);
    expect(res.statusCode).toBe(403);
    expect(errorOf(res)).toBe('outside-login-hours');
    // A wrong key gets Plan 2's refusal, never the hours one (no hours oracle).
    const stranger = createSoftAuthenticator({ backedUp: false, userVerified: true });
    const bad = await keyFirstStep(new StaffBrowser(app), s.loginName, stranger);
    expect(errorOf(bad)).toBe('webauthn-failed');
    const { rows } = await deps.db.query('select 1 from sessions where account_id = $1', [s.id]);
    expect(rows).toEqual([]);
  });

  it('gives sessionEndsAt as the end of the window when that comes first', async () => {
    const s = await seedStaff(deps, { role: 'senior', hours: OFFICE });
    const key = await addKey(s.id);
    setNow(new Date('2026-11-02T16:00:00Z'));
    const b = new StaffBrowser(app);
    expect((await fullLogin(b, s.id, s.loginName, key)).json()).toEqual({ status: 'ok' });
    expect((await b.get('/staff/v1/me')).json().sessionEndsAt).toBe('2026-11-02T17:00:00.000Z');
  });

  it('refuses a session open at 16:59 at 17:00; it is ended and logged once', async () => {
    const s = await seedStaff(deps, { role: 'mod', hours: OFFICE });
    const key = await addKey(s.id);
    setNow(MON_1659);
    const b = new StaffBrowser(app);
    expect((await fullLogin(b, s.id, s.loginName, key)).json()).toEqual({ status: 'ok' });
    expect((await b.get('/staff/v1/me')).statusCode).toBe(200);
    const mine = async () => (await logEntries(deps, 'staff.session-ended-hours')).filter((e) => e.detail === JSON.stringify({ staffId: s.id }));
    setNow(MON_1700);
    const res = await b.get('/staff/v1/me');
    expect(res.statusCode).toBe(401);
    expect(errorOf(res)).toBe('outside-login-hours');
    // The session is over: the next request is simply not logged in, and the sweeper finds nothing.
    expect(errorOf(await b.get('/staff/v1/me'))).toBe('not-authenticated');
    await sweepHours({ db: deps.db, clock: deps.clock, events: app.events });
    expect(await mine()).toEqual([{ actor_kind: 'system', detail: JSON.stringify({ staffId: s.id }) }]);
  });

  it('the sweeper ends every session outside its window, once each, and leaves the others', async () => {
    setNow(MON_1659);
    const late = await seedStaff(deps, { role: 'mod', hours: OFFICE });
    const night = await seedStaff(deps, { role: 'mod', hours: { days: ['Mon'], start: '16:00', end: '02:00', tz: 'UTC' } });
    const a = await insertSession(deps, late.id, 'staff');
    const a2 = await insertSession(deps, late.id, 'staff');
    const n = await insertSession(deps, night.id, 'staff');
    const o = await insertSession(deps, owner.id, 'staff');
    const before = (await logEntries(deps, 'staff.session-ended-hours')).length;
    setNow(MON_1700);
    const sweep = { db: deps.db, clock: deps.clock, events: app.events };
    // Sessions other tests left open at 17:00 end too; this test's two are among them.
    expect(await sweepHours(sweep)).toBeGreaterThanOrEqual(2);
    expect(await sweepHours(sweep)).toBe(0);
    const live = async (id: string) => (await deps.db.query('select revoked_at from sessions where id = $1', [id])).rows[0].revoked_at === null;
    expect([await live(a.sessionId), await live(a2.sessionId), await live(n.sessionId), await live(o.sessionId)]).toEqual([false, false, true, true]);
    const entries = (await logEntries(deps, 'staff.session-ended-hours')).slice(before).filter((e) => [late.id, night.id, owner.id].some((id) => e.detail.includes(id)));
    expect(entries).toEqual([
      { actor_kind: 'system', detail: JSON.stringify({ staffId: late.id }) },
      { actor_kind: 'system', detail: JSON.stringify({ staffId: late.id }) },
    ]);
  });

  it('startHoursSweeper runs on its interval and stops', async () => {
    setNow(MON_1659);
    const s = await seedStaff(deps, { role: 'helper', hours: OFFICE });
    const sess = await insertSession(deps, s.id, 'staff');
    setNow(MON_1700);
    const sweeper = startHoursSweeper({ db: deps.db, clock: deps.clock, events: app.events }, (e) => { throw e; }, 20);
    for (let i = 0; i < 100; i++) {
      const { rows } = await deps.db.query('select revoked_at from sessions where id = $1', [sess.sessionId]);
      if (rows[0].revoked_at !== null) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    await sweeper.stop();
    const { rows } = await deps.db.query('select revoked_at from sessions where id = $1', [sess.sessionId]);
    expect(rows[0].revoked_at).not.toBeNull();
  });

  it('logs the owner in at any hour', async () => {
    const o = owner;
    const key = await addKey(o.id);
    setNow(new Date('2026-11-08T03:17:00Z')); // a Sunday night
    const b = new StaffBrowser(app);
    expect((await keyFirstStep(b, o.loginName, key)).json()).toMatchObject({ status: 'second-factor', needs: ['pgp'] });
    expect((await fullLogin(b, o.id, o.loginName, key)).json()).toEqual({ status: 'ok' });
    const me = (await b.get('/staff/v1/me')).json();
    expect(me.role).toBe('owner');
    expect(me.nav).toEqual(['overview', 'disputes', 'staff', 'performance', 'training', 'log', 'feedback', 'settings']);
  });

  it('refuses a switched-off staff member at login and on every request', async () => {
    const s = await seedStaff(deps, { role: 'mod', switchedOff: true });
    const key = await addKey(s.id);
    expect(errorOf(await keyFirstStep(new StaffBrowser(app), s.loginName, key))).toBe('account-disabled');
    const sess = await insertSession(deps, s.id, 'staff');
    const res = await new StaffBrowser(app).withSession(sess.token).get('/staff/v1/me');
    expect(res.statusCode).toBe(403);
    expect(errorOf(res)).toBe('account-disabled');
  });

  it('refuses a trader at the staff login, and staff without a staff row', async () => {
    const t = uniqueTrader();
    const traderId = await seedAccount(deps, { loginName: t, kind: 'trader' });
    const key = await addKey(traderId);
    // A mount for staff and the owner gives a trader decoy options: the key is not even listed.
    const start = (await new StaffBrowser(app).post('/staff/v1/login/security-key/start', { loginName: t })).json();
    expect(start.options.allowCredentials.map((c: { id: string }) => c.id)).not.toContain(key.credentialId);
    const name = uniqueTrader();
    const bare = await seedAccount(deps, { loginName: name, kind: 'staff' });
    const bareKey = await addKey(bare);
    expect(errorOf(await keyFirstStep(new StaffBrowser(app), name, bareKey))).toBe('account-disabled');
  });
});

let traderSeq = 0;
const uniqueTrader = () => `trader${++traderSeq}${randomBytes(3).toString('hex')}`;

describe('staff sessions are separate from trading sessions', () => {
  it('refuses a trader session cookie value sent as __Host-x2f_staff', async () => {
    const traderId = await seedAccount(deps, { loginName: uniqueTrader(), kind: 'trader' });
    const t = await insertSession(deps, traderId, 'trader');
    const res = await new StaffBrowser(app).withSession(t.token).get('/staff/v1/me');
    expect(res.statusCode).toBe(401);
    expect(errorOf(res)).toBe('not-authenticated');
    // A staff member's own trader-API session is not a staff session either.
    const s = await seedStaff(deps, { role: 'senior' });
    const ts = await insertSession(deps, s.id, 'trader');
    expect(errorOf(await new StaffBrowser(app).withSession(ts.token).get('/staff/v1/me'))).toBe('not-authenticated');
  });

  it('refuses a staff or owner staff-app session on the trader API (take, post, account)', async () => {
    const s = await seedStaff(deps, { role: 'senior' });
    for (const id of [s.id, owner.id]) {
      const { token } = await insertSession(deps, id, 'staff');
      for (const [method, url] of [['POST', '/v1/offers'], ['POST', '/v1/offers/00000000-0000-4000-8000-000000000000/take'], ['GET', '/v1/account/me']] as const) {
        const res = await trader.inject({ method, url, headers: { origin: TRADER_ORIGIN }, cookies: { [SESSION_COOKIE]: token }, ...(method === 'POST' ? { payload: {} } : {}) });
        expect(res.statusCode, `${method} ${url}`).toBe(401);
        expect(errorOf(res)).toBe('not-authenticated');
      }
    }
  });

  it('refuses a password login for a staff username', async () => {
    const s = await seedStaff(deps, { role: 'mod' });
    const res = await trader.inject({
      method: 'POST', url: '/v1/login/password', headers: { origin: TRADER_ORIGIN }, payload: { loginName: s.loginName, password: 'correct horse battery staple', deviceLabel: 'D' },
    });
    expect(res.statusCode).toBe(401);
    expect(errorOf(res)).toBe('credentials-invalid');
  });

  it('logs out on the staff cookie: never 401, the session is revoked and the cookie cleared', async () => {
    const s = await seedStaff(deps, { role: 'mod' });
    const sess = await insertSession(deps, s.id, 'staff');
    const b = new StaffBrowser(app).withSession(sess.token);
    const res = await b.post('/staff/v1/logout');
    expect(res.statusCode).toBe(200);
    expect(res.cookies.find((c) => c.name === STAFF_SESSION_COOKIE)?.value).toBe('');
    const { rows } = await deps.db.query('select revoked_at from sessions where id = $1', [sess.sessionId]);
    expect(rows[0].revoked_at).not.toBeNull();
    expect((await new StaffBrowser(app).post('/staff/v1/logout')).statusCode).toBe(200);
  });
});

describe('the staff app shell', () => {
  it('X2F_STAFF_ORIGIN takes https, and http only for localhost or 127.0.0.1 (RV5 m3)', () => {
    const origin = (o: string) => staffListenFromEnv({ X2F_STAFF_ORIGIN: o })?.origin;
    expect(origin('https://staff.example.org')).toBe('https://staff.example.org');
    expect(origin('http://localhost:5174')).toBe('http://localhost:5174');
    expect(origin('http://127.0.0.1:8082')).toBe('http://127.0.0.1:8082');
    for (const bad of ['http://staff.example.org', 'http://staffx2f.onion', 'http://localhost.example.org', 'http://127.0.0.2', 'ftp://localhost']) {
      expect(() => staffListenFromEnv({ X2F_STAFF_ORIGIN: bad }), bad).toThrow(/X2F_STAFF_ORIGIN/);
    }
    expect(staffListenFromEnv({})).toBeNull();
  });

  it('refuses a request whose Origin is the trader origin', async () => {
    const res = await new StaffBrowser(app, TRADER_ORIGIN).post('/staff/v1/logout');
    expect(res.statusCode).toBe(403);
    expect(errorOf(res)).toBe('origin-refused');
    // The staff WebAuthn ceremony is bound to the staff relying party, not the trader one.
    const s = await seedStaff(deps, { role: 'mod' });
    await addKey(s.id);
    const start = (await new StaffBrowser(app).post('/staff/v1/login/security-key/start', { loginName: s.loginName })).json();
    expect(start.options.rpId).toBe('staff.x2f.test');
  });

  it('sends no-store, no-referrer and the staff CSP on every answer, 404s included', async () => {
    for (const url of ['/healthz', '/staff/v1/nothing-here']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['content-security-policy']).toContain("connect-src 'self'");
      expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    }
  });

  it('throws at startup for a route without a perm, or one whose guard does not match it', async () => {
    const other = await buildStaffApi({ ...deps, staffOrigin: STAFF_ORIGIN, moderation: MODERATION_STUB });
    try {
      expect(() => other.get('/staff/v1/no-perm', async () => ({}))).toThrow(/without a declared perm/);
      expect(() => other.get('/staff/v1/unguarded', { config: { perm: 'disputes.handle' } }, async () => ({}))).toThrow(/does not run requireStaff/);
      expect(() => other.get('/staff/v1/mismatch', { config: { perm: 'disputes.handle' }, preHandler: requireStaff('self') }, async () => ({}))).toThrow(/does not run requireStaff/);
      expect(() => other.get('/staff/v1/public', { config: { perm: 'public-login' }, preHandler: requireStaff('self') }, async () => ({}))).toThrow(/public staff route/);
    } finally {
      await other.close();
    }
  });

  it('turns request logging off and never logs a URL', async () => {
    const before = logs.length;
    await app.inject({ method: 'GET', url: '/staff/v1/me?secret=abc' });
    await app.inject({ method: 'POST', url: '/staff/v1/login/pgp/start', headers: { origin: STAFF_ORIGIN }, payload: { key: 'secret' } });
    expect(logs.slice(before).join('\n')).not.toContain('secret');
  });

  it('reads the role from the database on every request: a demoted senior is refused at once (round-2 N2)', async () => {
    const other = await buildStaffApi({ ...deps, staffOrigin: STAFF_ORIGIN, moderation: MODERATION_STUB });
    other.post('/staff/v1/test-approve', { config: { perm: 'rulings.approve' }, preHandler: requireStaff('rulings.approve') }, async () => ({ ok: true }));
    try {
      const s = await seedStaff(deps, { role: 'senior' });
      const { token } = await insertSession(deps, s.id, 'staff');
      const b = new StaffBrowser(other).withSession(token);
      expect((await b.post('/staff/v1/test-approve')).statusCode).toBe(200);
      await deps.db.query("update staff_members set role = 'mod' where account_id = $1", [s.id]);
      const res = await b.post('/staff/v1/test-approve');
      expect(res.statusCode).toBe(403);
      expect(errorOf(res)).toBe('forbidden');
    } finally {
      await other.close();
    }
  });
});

describe('migration 202 (staff_members)', () => {
  it('keeps the owner row at "any" hours and never switched off, and the owner role on the owner account only', async () => {
    const o = owner;
    await expect(deps.db.query(`update staff_members set hours = $2 where account_id = $1`, [o.id, JSON.stringify(OFFICE)])).rejects.toMatchObject({ code: '23514' });
    await expect(deps.db.query('update staff_members set switched_off_at = now() where account_id = $1', [o.id])).rejects.toMatchObject({ code: '23514' });
    await expect(deps.db.query("update staff_members set role = 'senior' where account_id = $1", [o.id])).rejects.toMatchObject({ code: '23514' });
    const s = await seedStaff(deps, { role: 'senior' });
    await expect(deps.db.query("update staff_members set role = 'owner' where account_id = $1", [s.id])).rejects.toMatchObject({ code: '23514' });
    const traderId = await seedAccount(deps, { loginName: uniqueTrader(), kind: 'trader' });
    await expect(
      deps.db.query(`insert into staff_members (account_id, role, hours, has_security_key, joined_at) values ($1, 'mod', '"any"', true, now())`, [traderId]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('stores only grantable perms in grants (RV5 m1)', async () => {
    const s = await seedStaff(deps, { role: 'mod' });
    await deps.db.query("update staff_members set grants = '{tickets.handle}' where account_id = $1", [s.id]);
    for (const bad of [['site.control'], ['tickets.handle', 'staff.manage'], ['owner'], ['']]) {
      await expect(deps.db.query('update staff_members set grants = $2 where account_id = $1', [s.id, bad]), bad.join()).rejects.toMatchObject({ code: '23514' });
    }
  });

  it('re-checks an account kind change against its staff_members row (RV5 m2)', async () => {
    const s = await seedStaff(deps, { role: 'mod' });
    // A staff account turned trader (or member) would keep a mod row on a non-staff account.
    await expect(deps.db.query("update accounts set kind = 'trader' where id = $1", [s.id])).rejects.toMatchObject({ code: '23514' });
    await expect(deps.db.query("update accounts set kind = 'member' where id = $1", [s.id])).rejects.toMatchObject({ code: '23514' });
    // The owner account turned staff would keep the owner role (no hours) on a staff account.
    await expect(deps.db.query("update accounts set kind = 'staff' where id = $1", [owner.id])).rejects.toMatchObject({ code: '23514' });
    // An account with no staff row changes kind as before, and other columns of a staff account still update.
    const t = await seedAccount(deps, { loginName: uniqueTrader(), kind: 'staff' });
    await deps.db.query("update accounts set kind = 'trader' where id = $1", [t]);
    await deps.db.query("update accounts set display_name = display_name where id = $1", [s.id]);
  });
});


// TRIPWIRE (RV5 m5, looks at this checkout only): an owner or staff security key whose AAGUID a
// FIDO snapshot refresh withdraws from the allowlist still logs in to the staff app, because the
// allowlist is applied only when a key is registered (coordination.md, Plan 4 M1). Key taps re-check
// it already (Task 5). Fires when Task 6 (owner setup) or Task 7 (staff management) lands, the tasks
// that register owner and staff keys: then pass the credential to the staff login check (or check it
// in the security-key login finish for kinds staff and owner) so a stored `attested` key whose
// `aaguid` is no longer `deps.attestation.isAllowed(aaguid, 'packed', owner|staff)` is refused,
// test it, and delete this tripwire.
describe('Task 4 tripwires', () => {
  const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
  it('NEEDS_P4_STAFF_LOGIN_AAGUID: the AAGUID allowlist re-check at staff and owner login (Tasks 6/7)', () => {
    expect(existsSync(ROOT + 'apps/api/src/staff/guard.ts'), 'the tripwire looks at the right tree').toBe(true);
    for (const f of ['apps/api/src/staff/ownerSetup.ts', 'apps/api/src/staff/members.ts']) {
      expect(existsSync(ROOT + f), `${f} landed: re-check the AAGUID allowlist at staff/owner login (see this test)`).toBe(false);
    }
  });
});
