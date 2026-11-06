// Plan 4 Task 4: the staff API shell, staff login with login hours, and staff sessions.
import { randomBytes } from 'node:crypto';
import type { LoginHours } from '@x2f/staff';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../../src/app.js';
import { requireStaff } from '../../src/staff/guard.js';
import { buildStaffApi } from '../../src/staff/app.js';
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
import { insertPgpKey } from '../../src/auth/pgp.js';
import { DEVICE_COOKIE } from '../../src/auth/device.js';
import { codeOf, decrypt, genKey } from '../helpers/pgpKeys.js';

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

/** A browser on the trader origin, on the trader API. */
const traderBrowser = () => new StaffBrowser(trader, TRADER_ORIGIN);

/** A security-key login by name on the trader API's mount (`/v1/login/webauthn`). */
async function traderKeyLogin(b: StaffBrowser, loginName: string, key: SoftAuthenticator, extra: Record<string, unknown> = {}) {
  const start = await b.post('/v1/login/webauthn/start', { loginName, ...extra });
  const options = start.json().options;
  const finish = await b.post('/v1/login/webauthn/finish', {
    challengeId: start.json().challengeId, response: key.authenticate(options, TRADER_ORIGIN), deviceLabel: 'Desk', ...extra,
  });
  return { listed: (options.allowCredentials as Array<{ id: string }>).map((c) => c.id), finish };
}

/** A PGP login on the trader API: start with the whole key, decrypt whatever comes back, finish. */
async function traderPgpLogin(b: StaffBrowser, key: { publicKey: string; privateKey: string }, extra: Record<string, unknown> = {}) {
  const start = await b.post('/v1/login/pgp/start', { key: key.publicKey, ...extra });
  expect(start.statusCode).toBe(200);
  const { rows } = await deps.db.query<{ account_id: string | null }>('select account_id from challenges where id = $1', [start.json().challengeId]);
  const code = codeOf(await decrypt(start.json().encryptedMessage, key.privateKey, undefined, deps.clock()));
  const finish = await b.post('/v1/login/pgp/finish', { challengeId: start.json().challengeId, code, deviceLabel: 'Desk', ...extra });
  return { decoy: rows[0]!.account_id === null, finish };
}

/**
 * Owner 2026-11-03 (Q19): staff have two separate logins, an ordinary trader account for trading and
 * the staff account for staff work. A staff account logs in only on the staff API; the trader API's
 * login mounts treat it as an unknown name or key, so the answer is the same as for a name or key
 * that does not exist (nothing says the account is there). The owner and team members keep logging
 * in on the trader API (owner question open: should the owner also be refused there?).
 */
describe('staff accounts log in only on the staff site (owner 2026-11-03)', () => {
  it('refuses a staff security key on the trader API exactly as an unknown name: decoy options, 401 webauthn-failed', async () => {
    const s = await seedStaff(deps, { role: 'mod' });
    const key = await addKey(s.id);
    const staffTry = await traderKeyLogin(traderBrowser(), s.loginName, key);
    expect(staffTry.listed).not.toContain(key.credentialId);
    expect(staffTry.finish.statusCode).toBe(401);
    expect(errorOf(staffTry.finish)).toBe('webauthn-failed');
    const unknown = await traderKeyLogin(traderBrowser(), uniqueTrader(), key);
    expect([unknown.finish.statusCode, errorOf(unknown.finish)]).toEqual([401, 'webauthn-failed']);
    const { rows } = await deps.db.query('select 1 from sessions where account_id = $1', [s.id]);
    expect(rows).toHaveLength(0);
    // The same key on the staff site works.
    expect((await keyFirstStep(new StaffBrowser(app), s.loginName, key)).json()).toMatchObject({ status: 'second-factor' });
  });

  it('refuses a staff second step on the trader API (a pendingId of a staff first factor): decoy, 401 webauthn-failed', async () => {
    const s = await seedStaff(deps, { role: 'senior' });
    const key = await addKey(s.id);
    const b = traderBrowser();
    await b.post('/v1/login/webauthn/start', { loginName: uniqueTrader() }); // gets the browser a device cookie
    const { createHmac } = await import('node:crypto');
    const { subkey } = await import('../../src/config.js');
    const dev = createHmac('sha256', subkey(deps.config, 'device')).update(b.cookies[DEVICE_COOKIE]!).digest();
    const now = deps.clock();
    const { rows } = await deps.db.query<{ id: string }>(
      `insert into challenges (account_id, device_hash, purpose, method, payload, created_at, expires_at)
       values ($1, $2, 'second-factor', 'pair', $3, $4, $5) returning id`,
      [s.id, dev, JSON.stringify({ first: { method: 'pgp', fingerprint: 'a'.repeat(40), fingerprints: ['a'.repeat(40)] } }), now, new Date(now.getTime() + 5 * MIN)],
    );
    const pendingId = rows[0]!.id;
    const start = (await b.post('/v1/login/webauthn/start', { pendingId })).json();
    expect(start.options.allowCredentials.map((c: { id: string }) => c.id)).not.toContain(key.credentialId);
    const finish = await b.post('/v1/login/webauthn/finish', {
      challengeId: start.challengeId, response: key.authenticate(start.options, TRADER_ORIGIN), deviceLabel: 'Desk', pendingId,
    });
    expect([finish.statusCode, errorOf(finish)]).toEqual([401, 'webauthn-failed']);
    expect(b.cookies[SESSION_COOKIE]).toBeUndefined();
  });

  it('refuses a staff PGP key on the trader API exactly as an unknown key: decoy challenge, 401 code-invalid', async () => {
    const s = await seedStaff(deps, { role: 'mod' });
    const k = await genKey();
    await insertPgpKey(deps.db, deps.config, { accountId: s.id, fingerprint: k.fingerprint, armored: k.publicKey, now: deps.clock() });
    const staffTry = await traderPgpLogin(traderBrowser(), k);
    expect(staffTry.decoy).toBe(true);
    expect([staffTry.finish.statusCode, errorOf(staffTry.finish)]).toEqual([401, 'code-invalid']);
    const unknown = await traderPgpLogin(traderBrowser(), await genKey());
    expect([unknown.finish.statusCode, errorOf(unknown.finish)]).toEqual([401, 'code-invalid']);
    const { rows } = await deps.db.query('select 1 from sessions where account_id = $1', [s.id]);
    expect(rows).toHaveLength(0);
  });

  it('refuses a staff backup-code login on the trader API as for an unknown name (401 code-invalid)', async () => {
    const s = await seedStaff(deps, { role: 'mod' });
    for (const kind of ['totp', 'recovery-code']) {
      const res = await traderBrowser().post('/v1/login/backup', { loginName: s.loginName, kind, code: '123456', deviceLabel: 'D' });
      const unknown = await traderBrowser().post('/v1/login/backup', { loginName: uniqueTrader(), kind, code: '123456', deviceLabel: 'D' });
      expect([res.statusCode, errorOf(res)]).toEqual([unknown.statusCode, errorOf(unknown)]);
    }
  });

  it('still lets the owner start a login on the trader API (owner question open), and a team member', async () => {
    const key = await addKey(owner.id);
    const ownerTry = await traderKeyLogin(traderBrowser(), owner.loginName, key);
    expect(ownerTry.listed).toContain(key.credentialId);
    expect(ownerTry.finish.json()).toMatchObject({ status: 'second-factor' });
    const m = uniqueTrader();
    const memberId = await seedAccount(deps, { loginName: m, kind: 'member' });
    const mk = await genKey();
    await insertPgpKey(deps.db, deps.config, { accountId: memberId, fingerprint: mk.fingerprint, armored: mk.publicKey, now: deps.clock() });
    const memberTry = await traderPgpLogin(traderBrowser(), mk);
    expect(memberTry.decoy).toBe(false);
    expect(memberTry.finish.json()).toMatchObject({ status: 'second-factor' });
  });
});

describe('the staff app shell', () => {
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
});

