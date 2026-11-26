// Plan 4 Task 4: the staff API shell, staff login with login hours, and staff sessions.
import { randomBytes } from 'node:crypto';
import type { LoginHours } from '@x2f/staff';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AttestationPolicy, Deps } from '../../src/app.js';
import { requireStaff } from '../../src/staff/guard.js';
import { buildStaffApi } from '../../src/staff/app.js';
import { staffListenFromEnv } from '../../src/staff/main.js';
import { sweepHours, sweepPass, startHoursSweeper } from '../../src/staff/sweeper.js';
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

/** The allowlisted AAGUID every test key carries (on both lists), unless a test says otherwise. */
const KEY_AAGUID = '0b0c0d0e-1111-4222-8333-444455556666';
/** The current allowlists; a test may withdraw an AAGUID (a snapshot refresh) and must put it back. */
const lists = { owner: new Set([KEY_AAGUID]), staff: new Set([KEY_AAGUID]) };
const attestation: AttestationPolicy = {
  async init() {},
  isAllowed: (aaguid, fmt, kind) => fmt !== 'none' && lists[kind].has(aaguid.toLowerCase()),
};

beforeAll(async () => {
  ({ app, trader, deps, setNow, close, logs } = await staffApps({ attestation }));
  setNow(MON_NOON);
  owner = await seedStaff(deps, { role: 'owner' });
});
afterAll(async () => close());
beforeEach(() => setNow(MON_NOON));

/** An attested security key, stored as registration stores one; `aaguid` defaults to the allowlisted KEY_AAGUID. */
async function addKey(accountId: string, aaguid: string | null = KEY_AAGUID): Promise<SoftAuthenticator> {
  const key = createSoftAuthenticator({ backedUp: false, userVerified: true });
  await deps.db.query(
    `insert into webauthn_credentials (account_id, credential_id, public_key, counter, kind, backed_up, device_type, attested, aaguid, label, created_at)
     values ($1, $2, $3, 0, 'security-key', false, 'singleDevice', true, $4, 'k', $5)`,
    [accountId, Buffer.from(key.credentialId, 'base64url'), key.cosePublicKey, aaguid, deps.clock()],
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
async function fullLogin(b: StaffBrowser, accountId: string, loginName: string, key: SoftAuthenticator, pendingApp: 'staff' | 'trader' = 'staff') {
  const probe = (await b.post('/staff/v1/login/security-key/start', { loginName })).json();
  const { rows: dev } = await deps.db.query<{ device_hash: Buffer }>('select device_hash from challenges where id = $1', [probe.challengeId]);
  const now = deps.clock();
  const { rows } = await deps.db.query<{ id: string }>(
    `insert into challenges (account_id, device_hash, purpose, method, payload, created_at, expires_at)
     values ($1, $2, 'second-factor', 'pair', $3, $4, $5) returning id`,
    [accountId, dev[0]!.device_hash, JSON.stringify({ first: { method: 'pgp', fingerprint: 'a'.repeat(40), fingerprints: ['a'.repeat(40)] }, app: pendingApp }), now, new Date(now.getTime() + 5 * MIN)],
  );
  const pendingId = rows[0]!.id;
  const start = (await b.post('/staff/v1/login/security-key/start', { pendingId })).json();
  return b.post('/staff/v1/login/security-key/finish', {
    challengeId: start.challengeId, response: key.authenticate(start.options, STAFF_ORIGIN), deviceLabel: 'Desk', pendingId,
  });
}

// Re-verify round 3, X2 (lead call): the staff login's challenge is derived, never chosen.
describe('the staff login challenge is the staff site\'s own domain (X2)', () => {
  it('answers a login nonce; the challenge is sha256("x2f-staff-login-v1\\n" + nonce); a tampered challenge row is refused', async () => {
    const { staffLoginChallenge } = await import('@x2f/staff');
    const s = await seedStaff(deps, { role: 'mod' });
    const key = await addKey(s.id);
    const b = new StaffBrowser(app);
    const start = (await b.post('/staff/v1/login/security-key/start', { loginName: s.loginName })).json();
    expect(start.loginNonce).toMatch(/^[0-9a-f]{64}$/);
    expect(start.options.challenge).toBe(Buffer.from(staffLoginChallenge(start.loginNonce)).toString('base64url'));
    // A database that swaps the stored challenge (for a tap's, say) gets no login.
    await deps.db.query(`update challenges set webauthn_challenge = $2 where id = $1`, [start.challengeId, Buffer.alloc(32, 7).toString('base64url')]);
    const opts = { ...start.options, challenge: Buffer.alloc(32, 7).toString('base64url') };
    const res = await b.post('/staff/v1/login/security-key/finish', { challengeId: start.challengeId, response: key.authenticate(opts, STAFF_ORIGIN), deviceLabel: 'Desk' });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res)).toBe('challenge-expired');
  });
});

describe('staff login with login hours', () => {
  it('logs a staff member in with a security key inside their hours, on the staff cookie only', async () => {
    const s = await seedStaff(deps, { role: 'mod', hours: OFFICE });
    const key = await addKey(s.id);
    const b = new StaffBrowser(app);
    const first = await keyFirstStep(b, s.loginName, key);
    expect(first.statusCode).toBe(200);
    // Owner G3: after a security key, PGP or a passkey completes the pair.
    expect(first.json()).toMatchObject({ status: 'second-factor', needs: ['pgp', 'passkey'] });
    const res = await fullLogin(b, s.id, s.loginName, key);
    expect(res.json()).toEqual({ status: 'ok' });
    expect(b.cookies[STAFF_SESSION_COOKIE]).toBeDefined();
    expect(b.cookies[SESSION_COOKIE]).toBeUndefined();
    const { rows } = await deps.db.query("select app from sessions where account_id = $1 and revoked_at is null", [s.id]);
    expect(rows).toEqual([{ app: 'staff' }]);
    const me = await b.get('/staff/v1/me');
    expect(me.statusCode).toBe(200);
    // The 2-hour idle limit (14:00) comes before the end of the window (17:00).
    expect(me.json()).toEqual({ displayName: `D${s.loginName}`, role: 'mod', nav: ['disputes', 'past-reputation', 'training', 'log'], grants: [], sessionEndsAt: '2026-11-02T14:00:00.000Z' });
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

  it('the sweeper also purges stale key taps (RV5 m8, lead re-review item 4)', async () => {
    const s = await seedStaff(deps, { role: 'mod' });
    const old = new Date(deps.clock().getTime() - 25 * 60 * 60_000);
    const { rows: ins } = await deps.db.query<{ id: string }>(
      `insert into key_taps (account_id, intent, nonce, started_at) values ($1, '{"kind":"emergency-stop"}', $2, $3) returning id`,
      [s.id, randomBytes(16), old],
    );
    const sweeper = startHoursSweeper({ db: deps.db, clock: deps.clock, events: app.events }, (e) => { throw e; }, 20);
    let gone = false;
    for (let i = 0; i < 100 && !gone; i++) {
      gone = (await deps.db.query('select 1 from key_taps where id = $1', [ins[0]!.id])).rowCount === 0;
      if (!gone) await new Promise((r) => setTimeout(r, 20));
    }
    await sweeper.stop();
    expect(gone).toBe(true);
  });

  it('a failed hours sweep still purges stale taps (lead review 7 Nov M3)', async () => {
    const s = await seedStaff(deps, { role: 'mod' });
    const old = new Date(deps.clock().getTime() - 25 * 60 * 60_000);
    const { rows: ins } = await deps.db.query<{ id: string }>(
      `insert into key_taps (account_id, intent, nonce, started_at) values ($1, '{"kind":"emergency-stop"}', $2, $3) returning id`,
      [s.id, randomBytes(16), old],
    );
    // A database whose sessions read fails: the sweep throws, the purge still runs.
    const failing = {
      query: (text: string, params?: unknown[]) =>
        /from sessions s join staff_members/.test(text) ? Promise.reject(new Error('sweep down')) : deps.db.query(text, params),
    } as unknown as typeof deps.db;
    const errors: unknown[] = [];
    await sweepPass({ db: failing, clock: deps.clock, events: app.events }, (e) => errors.push(e));
    expect(errors.map((e) => (e as Error).message)).toEqual(['sweep down']);
    expect((await deps.db.query('select 1 from key_taps where id = $1', [ins[0]!.id])).rowCount).toBe(0);
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
    expect(me.nav).toEqual(['overview', 'disputes', 'past-reputation', 'accounts', 'staff', 'performance', 'prices', 'training', 'log', 'feedback', 'tickets', 'settings']);
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

describe('owner G3: two PGP keys are not a moderator\'s pair (review P-I2)', () => {
  /** A PGP login step on the staff site with `key` (the second step when `pendingId` is given). */
  async function pgpStep(b: StaffBrowser, key: Awaited<ReturnType<typeof genKey>>, pendingId?: string) {
    const start = await b.post('/staff/v1/login/pgp/start', { key: key.publicKey, ...(pendingId ? { pendingId } : {}) });
    expect(start.statusCode, start.body).toBe(200);
    const code = codeOf(await decrypt(start.json().encryptedMessage, key.privateKey, undefined, deps.clock()));
    return b.post('/staff/v1/login/pgp/finish', { challengeId: start.json().challengeId, code, deviceLabel: 'Desk', ...(pendingId ? { pendingId } : {}) });
  }
  async function withTwoPgpKeys(role: 'mod' | 'senior' | 'helper') {
    const s = await seedStaff(deps, { role });
    const keys = [await genKey(), await genKey()];
    for (const k of keys) await insertPgpKey(deps.db, deps.config, { accountId: s.id, fingerprint: k.fingerprint, armored: k.publicKey, now: deps.clock() });
    return { s, keys };
  }

  for (const role of ['mod', 'senior'] as const) {
    it(`a ${role === 'mod' ? 'moderator' : 'senior moderator'}: PGP first offers no PGP second step, and a second PGP key is refused`, async () => {
      const { s, keys } = await withTwoPgpKeys(role);
      const b = new StaffBrowser(app);
      const first = await pgpStep(b, keys[0]!);
      expect(first.json()).toEqual({ status: 'second-factor', pendingId: expect.any(String), needs: ['security-key', 'passkey'] });
      const second = await pgpStep(b, keys[1]!, first.json().pendingId);
      expect([second.statusCode, errorOf(second)]).toEqual([403, 'method-not-allowed']);
      expect(b.cookies[STAFF_SESSION_COOKIE]).toBeUndefined();
      const { rows } = await deps.db.query('select 1 from sessions where account_id = $1', [s.id]);
      expect(rows).toEqual([]);
    });
  }

  it('a helper still logs in with two different PGP keys (until the owner says otherwise)', async () => {
    const { keys } = await withTwoPgpKeys('helper');
    const b = new StaffBrowser(app);
    const first = await pgpStep(b, keys[0]!);
    expect(first.json()).toMatchObject({ status: 'second-factor', needs: ['pgp', 'security-key', 'passkey'] });
    const second = await pgpStep(b, keys[1]!, first.json().pendingId);
    expect(second.json()).toEqual({ status: 'ok' });
    expect(b.cookies[STAFF_SESSION_COOKIE]).toBeDefined();
  });
});

describe('the AAGUID allowlist at staff and owner login (Plan 4 M1, RV5 m5)', () => {
  const OTHER = '99999999-8888-4777-8666-555544443333';
  const listed = async (b: StaffBrowser, loginName: string, key: SoftAuthenticator) => {
    const start = (await b.post('/staff/v1/login/security-key/start', { loginName })).json();
    return start.options.allowCredentials.map((c: { id: string }) => c.id).includes(key.credentialId) as boolean;
  };
  const sessions = async (id: string) => (await deps.db.query('select 1 from sessions where account_id = $1', [id])).rows.length;

  it('neither offers nor accepts a staff key whose AAGUID a refresh withdrew from the staff list', async () => {
    const s = await seedStaff(deps, { role: 'mod' });
    const key = await addKey(s.id);
    expect(await listed(new StaffBrowser(app), s.loginName, key)).toBe(true);
    lists.staff.delete(KEY_AAGUID);
    try {
      expect(await listed(new StaffBrowser(app), s.loginName, key)).toBe(false);
      // Signed anyway against the start that left it out: Plan 2's refusal, as for any unlisted key.
      expect(errorOf(await keyFirstStep(new StaffBrowser(app), s.loginName, key))).toBe('webauthn-failed');
    } finally {
      lists.staff.add(KEY_AAGUID);
    }
    expect(await sessions(s.id)).toBe(0);
  });

  it('refuses a key withdrawn between start and finish with method-not-allowed, at either step, before the hours check', async () => {
    const s = await seedStaff(deps, { role: 'mod', hours: OFFICE });
    const key = await addKey(s.id);
    setNow(MON_1701); // outside the hours: the allowlist refusal still comes first
    const b = new StaffBrowser(app);
    const start = (await b.post('/staff/v1/login/security-key/start', { loginName: s.loginName })).json();
    lists.staff.delete(KEY_AAGUID);
    try {
      const res = await b.post('/staff/v1/login/security-key/finish', {
        challengeId: start.challengeId, response: key.authenticate(start.options, STAFF_ORIGIN), deviceLabel: 'Desk',
      });
      expect(res.statusCode).toBe(403);
      expect(errorOf(res)).toBe('method-not-allowed');
    } finally {
      lists.staff.add(KEY_AAGUID);
    }
    // The second step after a PGP first factor too.
    setNow(MON_NOON);
    const b2 = new StaffBrowser(app);
    const probe = (await b2.post('/staff/v1/login/security-key/start', { loginName: s.loginName })).json();
    const { rows: dev } = await deps.db.query<{ device_hash: Buffer }>('select device_hash from challenges where id = $1', [probe.challengeId]);
    const { rows } = await deps.db.query<{ id: string }>(
      `insert into challenges (account_id, device_hash, purpose, method, payload, created_at, expires_at)
       values ($1, $2, 'second-factor', 'pair', $3, $4, $5) returning id`,
      [s.id, dev[0]!.device_hash, JSON.stringify({ first: { method: 'pgp', fingerprint: 'a'.repeat(40), fingerprints: ['a'.repeat(40)] }, app: 'staff' }), deps.clock(), new Date(deps.clock().getTime() + 5 * MIN)],
    );
    const second = (await b2.post('/staff/v1/login/security-key/start', { pendingId: rows[0]!.id })).json();
    lists.staff.delete(KEY_AAGUID);
    try {
      const res = await b2.post('/staff/v1/login/security-key/finish', {
        challengeId: second.challengeId, response: key.authenticate(second.options, STAFF_ORIGIN), deviceLabel: 'Desk', pendingId: rows[0]!.id,
      });
      expect(errorOf(res)).toBe('method-not-allowed');
    } finally {
      lists.staff.add(KEY_AAGUID);
    }
    expect(await sessions(s.id)).toBe(0);
    // Back on the list, the same key logs in again (no data migration either way).
    expect((await fullLogin(new StaffBrowser(app), s.id, s.loginName, key)).json()).toEqual({ status: 'ok' });
  });

  it("checks the owner's keys against the owner's list, not staff's", async () => {
    const key = await addKey(owner.id, OTHER);
    lists.staff.add(OTHER);
    try {
      expect(await listed(new StaffBrowser(app), owner.loginName, key)).toBe(false);
      lists.owner.add(OTHER);
      expect(await listed(new StaffBrowser(app), owner.loginName, key)).toBe(true);
    } finally {
      lists.staff.delete(OTHER);
      lists.owner.delete(OTHER);
    }
  });

  it('never offers an attested key stored without an AAGUID', async () => {
    const s = await seedStaff(deps, { role: 'senior' });
    const key = await addKey(s.id, null);
    expect(await listed(new StaffBrowser(app), s.loginName, key)).toBe(false);
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
async function traderPgpLogin(b: StaffBrowser, key: { publicKey: string; privateKey: string }, loginName: string, extra: Record<string, unknown> = {}) {
  // Owner G6: the trader PGP login takes the username with the key.
  const start = await b.post('/v1/login/pgp/start', { key: key.publicKey, loginName, ...extra });
  expect(start.statusCode).toBe(200);
  const { rows } = await deps.db.query<{ account_id: string | null }>('select account_id from challenges where id = $1', [start.json().challengeId]);
  const code = codeOf(await decrypt(start.json().encryptedMessage, key.privateKey, undefined, deps.clock()));
  const finish = await b.post('/v1/login/pgp/finish', { challengeId: start.json().challengeId, code, deviceLabel: 'Desk', ...extra });
  return { decoy: rows[0]!.account_id === null, finish };
}

/**
 * Owner 2026-11-03 (Q19): staff have two separate logins, an ordinary trader account for trading and
 * the staff account for staff work. A staff account logs in only on the staff API. On the trader
 * API's login mounts it is EXACTLY an unknown login name or key (security review RV5 I1): the
 * staff kind is "not found" at the lookup, so start and finish answer with the same status and body
 * as for a name or key that does not exist, before and after the credential, and nothing is made.
 * The owner is refused there the same way (owner Q13, 6 Nov). Traders and team members are
 * unchanged.
 */
describe('staff accounts log in only on the staff site (owner 2026-11-03, Q19; RV5 I1)', () => {
  const noSessions = async (accountId: string) =>
    (await deps.db.query('select 1 from sessions where account_id = $1', [accountId])).rows.length === 0;
  const noChallenges = async (accountId: string) =>
    (await deps.db.query('select 1 from challenges where account_id = $1', [accountId])).rows.length === 0;
  const challengeAccount = async (challengeId: string) =>
    (await deps.db.query<{ account_id: string | null }>('select account_id from challenges where id = $1', [challengeId])).rows[0]!.account_id;
  /** The start answer's shape, without its random values. */
  const keyStartShape = (body: { challengeId: string; options: Record<string, unknown> & { allowCredentials: unknown[] } }) => ({
    keys: Object.keys(body).sort(), options: Object.keys(body.options).sort(), listed: body.options.allowCredentials.length,
  });

  it('security key by name: a staff name answers exactly as an unknown name (start and finish), with its own real key', async () => {
    const s = await seedStaff(deps, { role: 'mod' });
    const key = await addKey(s.id);
    const results = [];
    for (const name of [s.loginName, uniqueTrader()]) {
      const b = traderBrowser();
      const start = await b.post('/v1/login/webauthn/start', { loginName: name });
      const finish = await b.post('/v1/login/webauthn/finish', {
        challengeId: start.json().challengeId, response: key.authenticate(start.json().options, TRADER_ORIGIN), deviceLabel: 'Desk',
      });
      results.push({
        start: [start.statusCode, keyStartShape(start.json())],
        listedTheKey: start.json().options.allowCredentials.some((c: { id: string }) => c.id === key.credentialId),
        boundTo: await challengeAccount(start.json().challengeId),
        finish: [finish.statusCode, finish.json()],
        session: b.cookies[SESSION_COOKIE] !== undefined,
      });
    }
    expect(results[0]).toEqual(results[1]);
    expect(results[0]!.finish).toEqual([401, { error: 'webauthn-failed' }]);
    expect(results[0]!.boundTo).toBeNull();
    expect(await noSessions(s.id)).toBe(true);
    expect(await noChallenges(s.id)).toBe(true);
    // The same key on the staff site works.
    expect((await keyFirstStep(new StaffBrowser(app), s.loginName, key)).json()).toMatchObject({ status: 'second-factor' });
  });

  it('security key second step: a staff pendingId answers exactly as an unknown pendingId', async () => {
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
      [s.id, dev, JSON.stringify({ first: { method: 'pgp', fingerprint: 'a'.repeat(40), fingerprints: ['a'.repeat(40)] }, app: 'trader' }), now, new Date(now.getTime() + 5 * MIN)],
    );
    const results = [];
    for (const pendingId of [rows[0]!.id, '00000000-0000-4000-8000-0000000000aa']) {
      const start = await b.post('/v1/login/webauthn/start', { pendingId });
      const finish = await b.post('/v1/login/webauthn/finish', {
        challengeId: start.json().challengeId, response: key.authenticate(start.json().options, TRADER_ORIGIN), deviceLabel: 'Desk', pendingId,
      });
      results.push({
        start: [start.statusCode, keyStartShape(start.json())],
        boundTo: await challengeAccount(start.json().challengeId),
        finish: [finish.statusCode, finish.json()],
      });
    }
    expect(results[0]).toEqual(results[1]);
    expect(results[0]!.finish).toEqual([401, { error: 'webauthn-failed' }]);
    expect(b.cookies[SESSION_COOKIE]).toBeUndefined();
    expect(await noSessions(s.id)).toBe(true);
  });

  it('PGP: a staff key answers exactly as an unknown key (start and finish), even with the right code', async () => {
    const s = await seedStaff(deps, { role: 'mod' });
    const k = await genKey();
    await insertPgpKey(deps.db, deps.config, { accountId: s.id, fingerprint: k.fingerprint, armored: k.publicKey, now: deps.clock() });
    const results = [];
    for (const key of [k, await genKey()]) {
      const b = traderBrowser();
      const start = await b.post('/v1/login/pgp/start', { key: key.publicKey, loginName: s.loginName });
      const code = codeOf(await decrypt(start.json().encryptedMessage, key.privateKey, undefined, deps.clock()));
      const finish = await b.post('/v1/login/pgp/finish', { challengeId: start.json().challengeId, code, deviceLabel: 'Desk' });
      results.push({
        start: [start.statusCode, Object.keys(start.json()).sort()],
        boundTo: await challengeAccount(start.json().challengeId),
        finish: [finish.statusCode, finish.json()],
        session: b.cookies[SESSION_COOKIE] !== undefined,
      });
    }
    expect(results[0]).toEqual(results[1]);
    expect(results[0]!.finish).toEqual([401, { error: 'code-invalid' }]);
    expect(await noSessions(s.id)).toBe(true);
    expect(await noChallenges(s.id)).toBe(true);
  });

  it('backup codes: a staff name answers as an unknown name (staff have none)', async () => {
    const s = await seedStaff(deps, { role: 'mod' });
    for (const kind of ['totp', 'recovery-code']) {
      const res = await traderBrowser().post('/v1/login/backup', { loginName: s.loginName, kind, code: '123456', deviceLabel: 'D' });
      const unknown = await traderBrowser().post('/v1/login/backup', { loginName: uniqueTrader(), kind, code: '123456', deviceLabel: 'D' });
      expect([res.statusCode, res.json()]).toEqual([unknown.statusCode, unknown.json()]);
    }
  });

  it('owner Q13: the owner is refused on the trader site exactly as an unknown name or key, and logs in on the staff site', async () => {
    const key = await addKey(owner.id);
    const k = await genKey();
    await insertPgpKey(deps.db, deps.config, { accountId: owner.id, fingerprint: k.fingerprint, armored: k.publicKey, now: deps.clock() });
    const pgp = [];
    for (const kk of [k, await genKey()]) {
      const r = await traderPgpLogin(traderBrowser(), kk, owner.loginName);
      pgp.push({ decoy: r.decoy, finish: [r.finish.statusCode, r.finish.json()] });
    }
    expect(pgp[0]).toEqual(pgp[1]);
    expect(pgp[0]).toEqual({ decoy: true, finish: [401, { error: 'code-invalid' }] });
    const keys = [];
    for (const name of [owner.loginName, uniqueTrader()]) {
      const b = traderBrowser();
      const r = await traderKeyLogin(b, name, key);
      keys.push({ listedTheKey: r.listed.includes(key.credentialId), finish: [r.finish.statusCode, r.finish.json()], session: b.cookies[SESSION_COOKIE] !== undefined });
    }
    expect(keys[0]).toEqual(keys[1]);
    expect(keys[0]).toEqual({ listedTheKey: false, finish: [401, { error: 'webauthn-failed' }], session: false });
    const s = new StaffBrowser(app);
    expect((await fullLogin(s, owner.id, owner.loginName, key)).json()).toEqual({ status: 'ok' });
    expect(s.cookies[STAFF_SESSION_COOKIE]).toBeDefined();
  });

  it("lead review I-1: one name's decoy lists differ between the two sites, so comparing them shows no real key", async () => {
    // An unknown name: two different lists of the same length, each the same on every start.
    const name = uniqueTrader();
    const ids = async (b: StaffBrowser, url: string, loginName: string) =>
      ((await b.post(url, { loginName })).json().options.allowCredentials as Array<{ id: string }>).map((c) => c.id);
    const onTrader = await ids(traderBrowser(), '/v1/login/webauthn/start', name);
    const onStaff = await ids(new StaffBrowser(app), '/staff/v1/login/security-key/start', name);
    expect(onTrader).toHaveLength(onStaff.length);
    expect(onTrader.filter((id) => onStaff.includes(id))).toEqual([]);
    expect(await ids(traderBrowser(), '/v1/login/webauthn/start', name)).toEqual(onTrader);
    expect(await ids(new StaffBrowser(app), '/staff/v1/login/security-key/start', name)).toEqual(onStaff);
    // A staff member with two keys: the trader site's list (all decoys) shares nothing with the staff
    // site's, so the difference between them is never the real keys.
    const m = await seedStaff(deps, { role: 'mod' });
    const k1 = await addKey(m.id);
    const k2 = await addKey(m.id);
    const staffList = await ids(new StaffBrowser(app), '/staff/v1/login/security-key/start', m.loginName);
    const traderList = await ids(traderBrowser(), '/v1/login/webauthn/start', m.loginName);
    expect(staffList).toEqual(expect.arrayContaining([k1.credentialId, k2.credentialId]));
    expect(traderList).not.toContain(k1.credentialId);
    expect(traderList.filter((id) => staffList.includes(id))).toEqual([]);
  });

  it('lead review M-1: a pending login recorded on the trader site cannot be finished on the staff site', async () => {
    const s = await seedStaff(deps, { role: 'senior' });
    const key = await addKey(s.id);
    const b = new StaffBrowser(app);
    const res = await fullLogin(b, s.id, s.loginName, key, 'trader');
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'webauthn-failed' });
    expect(b.cookies[STAFF_SESSION_COOKIE]).toBeUndefined();
    expect(await noSessions(s.id)).toBe(true);
    // The same pair recorded on the staff site works.
    expect((await fullLogin(new StaffBrowser(app), s.id, s.loginName, key)).json()).toEqual({ status: 'ok' });
  });

  it('leaves trader and team-member logins on the trader API unchanged', async () => {
    const t = uniqueTrader();
    const traderId = await seedAccount(deps, { loginName: t, kind: 'trader' });
    const tk = await genKey();
    await insertPgpKey(deps.db, deps.config, { accountId: traderId, fingerprint: tk.fingerprint, armored: tk.publicKey, now: deps.clock() });
    const tb = traderBrowser();
    const traderTry = await traderPgpLogin(tb, tk, t);
    expect(traderTry.finish.json()).toEqual({ status: 'ok' });
    expect(tb.cookies[SESSION_COOKIE]).toBeDefined();

    const m = uniqueTrader();
    const memberId = await seedAccount(deps, { loginName: m, kind: 'member' });
    const mk = await genKey();
    await insertPgpKey(deps.db, deps.config, { accountId: memberId, fingerprint: mk.fingerprint, armored: mk.publicKey, now: deps.clock() });
    const memberTry = await traderPgpLogin(traderBrowser(), mk, m);
    expect(memberTry.decoy).toBe(false);
    expect(memberTry.finish.json()).toMatchObject({ status: 'second-factor' });
  });
});

describe('the staff app shell', () => {
  it('X2F_STAFF_ORIGIN takes https, and http only for 127.0.0.1, [::1] or localhost (RV5 m3)', () => {
    const origin = (o: string) => staffListenFromEnv({ X2F_STAFF_ORIGIN: o })?.origin;
    expect(origin('https://staff.example.org')).toBe('https://staff.example.org');
    expect(origin('http://localhost:5174')).toBe('http://localhost:5174');
    expect(origin('http://127.0.0.1:8082')).toBe('http://127.0.0.1:8082');
    expect(origin('http://[::1]:8082')).toBe('http://[::1]:8082');
    // The trader CSP's opt-in for clear text elsewhere does not reach the staff origin.
    expect(() => staffListenFromEnv({ X2F_STAFF_ORIGIN: 'http://staff.example.org', X2F_ALLOW_INSECURE_ORIGINS: '1' })).toThrow(/X2F_STAFF_ORIGIN/);
    for (const bad of [
      'http://staff.example.org', 'http://staffx2f.onion', 'http://localhost.example.org', 'http://127.0.0.2', 'http://[::2]', 'ftp://localhost',
      'https://staff.example.org/', 'https://staff.example.org/staff', 'https://u@staff.example.org',
    ]) {
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

  it('re-checks a staff row written while the account kind is being changed (RV5 m2, both orders)', async () => {
    const pool = deps.db as unknown as import('pg').Pool;
    const insert = `insert into staff_members (account_id, role, hours, has_security_key, joined_at) values ($1, 'mod', '"any"', true, now())`;
    // The kind change first: the staff row waits for it and then sees a trader.
    const a = await seedAccount(deps, { loginName: uniqueTrader(), kind: 'staff' });
    const t1 = await pool.connect();
    const t2 = await pool.connect();
    try {
      await t1.query('begin');
      await t1.query("update accounts set kind = 'trader' where id = $1", [a]);
      const late = t2.query(insert, [a]).then(() => 'inserted', (e: { code?: string }) => e.code);
      await new Promise((r) => setTimeout(r, 200));
      await t1.query('commit');
      expect(await late).toBe('23514');
      // The staff row first: the kind change waits for it and then sees the mod row.
      const b = await seedAccount(deps, { loginName: uniqueTrader(), kind: 'staff' });
      await t1.query('begin');
      await t1.query(insert, [b]);
      const change = t2.query("update accounts set kind = 'trader' where id = $1", [b]).then(() => 'changed', (e: { code?: string }) => e.code);
      await new Promise((r) => setTimeout(r, 200));
      await t1.query('commit');
      expect(await change).toBe('23514');
    } finally {
      await t1.query('rollback').catch(() => {});
      t1.release();
      t2.release();
    }
  });

  it('refuses to delete an account that has a staff row: the foreign key is on delete restrict (RV5 m6)', async () => {
    const s = await seedStaff(deps, { role: 'helper' });
    // PostgreSQL reports a restrict violation as 23503 too; the catalog tells restrict from no action.
    await expect(deps.db.query('delete from accounts where id = $1', [s.id])).rejects.toMatchObject({ code: '23503', constraint: 'staff_members_account_id_fkey' });
    const { rows } = await deps.db.query<{ confdeltype: string }>(
      `select c.confdeltype from pg_constraint c
        where c.conrelid = 'staff_members'::regclass and c.confrelid = 'accounts'::regclass and c.contype = 'f'`,
    );
    expect(rows).toEqual([{ confdeltype: 'r' }]);
  });
});

