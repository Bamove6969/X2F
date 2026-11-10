import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFinished } from 'vitest';
import type { Deps } from '../src/app.js';
import {
  DEVICE_COOKIE, deviceHash, ensureDeviceCookie, isTrusted,
} from '../src/auth/device.js';
import {
  SESSION_COOKIE, assertNotDisabled, endAllSessions, endOtherSessions, endSession, requireSession, sessionPolicy,
  startSession,
} from '../src/auth/sessions.js';
import { consumeChallenge, purgeExpired } from '../src/auth/challenges.js';
import { addAlert } from '../src/alerts.js';
import { seedAccount } from './helpers/accounts.js';
import { testApp } from './helpers/app.js';
import { testDb } from './helpers/db.js';

const ORIGIN = 'https://x2f.test';
const T0 = new Date('2026-10-17T12:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let current = new Date('2026-10-17T12:00:00Z');
const now0 = () => current;

beforeAll(async () => {
  let set: (d: Date) => void;
  ({ app, deps, setNow: set } = await testApp());
  setNow = (d) => {
    current = d;
    set(d);
  };
  app.post('/t/login', async (req, reply) => {
    const b = req.body as {
      accountId: string; level?: 'full' | 'recovery'; deviceLabel?: string; firstSession?: boolean; holdUntil?: string;
    };
    const sessionId = await startSession(deps, req, reply, {
      accountId: b.accountId,
      level: b.level ?? 'full',
      deviceLabel: b.deviceLabel ?? 'Test browser',
      method: 'passkey',
      firstSession: b.firstSession ?? false,
      ...(b.holdUntil ? { holdUntil: new Date(b.holdUntil) } : {}),
    });
    return { sessionId };
  });
  app.get('/t/me', { preHandler: requireSession() }, async (req) => req.auth);
  app.get('/t/recovery-ok', { preHandler: requireSession({ allowRecovery: true }) }, async (req) => req.auth);
  app.get('/t/trader', { preHandler: requireSession({ kinds: ['trader'] }) }, async () => ({ ok: true }));
  app.get('/t/stale', { preHandler: requireSession({ allowStaleTerms: true }) }, async () => ({ ok: true }));
  app.post('/t/device', async (req, reply) => {
    const had = deviceHash(req) !== null;
    ensureDeviceCookie(req, reply);
    return { had, hash: deviceHash(req)?.toString('hex') ?? null };
  });
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  setNow(T0);
});

let n = 0;
const name = (p = 'user') => `${p}${String(++n).padStart(4, '0')}`;

function cookieOf(res: LightMyRequestResponse, cookie: string) {
  return res.cookies.find((c) => c.name === cookie);
}

async function login(
  accountId: string,
  o: { level?: 'full' | 'recovery'; firstSession?: boolean; cookies?: Record<string, string>; holdUntil?: string; deviceLabel?: string } = {},
): Promise<{ res: LightMyRequestResponse; token: string; sessionId: string }> {
  const { cookies, ...body } = o;
  const res = await app.inject({
    method: 'POST', url: '/t/login', headers: { origin: ORIGIN }, payload: { accountId, ...body }, ...(cookies ? { cookies } : {}),
  });
  expect(res.statusCode).toBe(200);
  const token = cookieOf(res, SESSION_COOKIE)?.value;
  expect(token).toBeTruthy();
  return { res, token: token!, sessionId: res.json<{ sessionId: string }>().sessionId };
}

const get = (url: string, token: string) => app.inject({ method: 'GET', url, cookies: { [SESSION_COOKIE]: token } });

describe('sessionPolicy', () => {
  it('gives staff and owner 2 h idle / 12 h absolute and recovery 25 h / 48 h; a full trader session lasts its chosen length (null)', () => {
    // Owner, 2 Nov 2026: a trader's full session ends at the length chosen at login (expires_at),
    // extended only by "Stay logged in?"; no idle rule and no fixed maximum.
    expect(sessionPolicy('trader', 'full')).toBeNull();
    for (const k of ['staff', 'owner'] as const) {
      expect(sessionPolicy(k, 'full')).toEqual({ idleMs: 2 * HOUR, absoluteMs: 12 * HOUR });
    }
    for (const k of ['trader', 'staff', 'owner'] as const) {
      expect(sessionPolicy(k, 'recovery')).toEqual({ idleMs: 25 * HOUR, absoluteMs: 48 * HOUR });
    }
  });
});

describe('sessions', () => {
  it('authenticates a started session and stops after endSession', async () => {
    const id = await seedAccount(deps, { loginName: name() });
    const { token, sessionId } = await login(id);
    const me = await get('/t/me', token);
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ sessionId, accountId: id, kind: 'trader', level: 'full', onboardingUntil: null });
    await endSession({ ...deps, events: app.events }, sessionId);
    const after = await get('/t/me', token);
    expect(after.statusCode).toBe(401);
    expect(after.json()).toEqual({ error: 'not-authenticated' });
  });

  it('answers not-authenticated with no cookie or an unknown token', async () => {
    expect((await app.inject({ method: 'GET', url: '/t/me' })).json()).toEqual({ error: 'not-authenticated' });
    expect((await get('/t/me', randomBytes(32).toString('base64url'))).statusCode).toBe(401);
    expect((await get('/t/me', 'not a token')).statusCode).toBe(401);
  });

  it('ends a trader session at its length however much it is used, and touches last_seen_at on use', async () => {
    const id = await seedAccount(deps, { loginName: name() });
    const { token, sessionId } = await login(id);
    // No length chosen yet: the shortest choice, 2 hours from the login.
    const row = async () =>
      (await deps.db.query<{ expires_at: Date; last_seen_at: Date }>('select expires_at, last_seen_at from sessions where id = $1', [sessionId])).rows[0]!;
    expect((await row()).expires_at).toEqual(new Date(T0.getTime() + 2 * HOUR));
    setNow(new Date(T0.getTime() + HOUR));
    expect((await get('/t/me', token)).statusCode).toBe(200);
    expect(await row()).toEqual({ expires_at: new Date(T0.getTime() + 2 * HOUR), last_seen_at: new Date(T0.getTime() + HOUR) });
    setNow(new Date(T0.getTime() + 2 * HOUR - MIN));
    expect((await get('/t/me', token)).statusCode).toBe(200);
    setNow(new Date(T0.getTime() + 2 * HOUR));
    expect((await get('/t/me', token)).statusCode).toBe(401);
  });

  it('ends a staff session at 2 h idle, not at 1 h 59 min, and at 12 h absolute', async () => {
    const id = await seedAccount(deps, { loginName: name('staffer'), kind: 'staff' });
    const at = (ms: number) => setNow(new Date(T0.getTime() + ms));

    const idle = await login(id);
    at(2 * HOUR);
    expect((await get('/t/me', idle.token)).statusCode).toBe(401);

    at(0);
    const kept = await login(id);
    at(2 * HOUR - MIN);
    expect((await get('/t/me', kept.token)).statusCode).toBe(200);
    // Last seen at 1:59, so 3:58 is still inside the 2-hour idle window.
    at(3 * HOUR + 58 * MIN);
    expect((await get('/t/me', kept.token)).statusCode).toBe(200);

    at(0);
    const long = await login(id);
    for (let h = 1; h < 12; h++) {
      at(h * HOUR);
      expect((await get('/t/me', long.token)).statusCode).toBe(200);
    }
    at(12 * HOUR);
    expect((await get('/t/me', long.token)).statusCode).toBe(401);
  });

  it('applies the owner policy too (2 h idle)', async () => {
    const id = await seedAccount(deps, { loginName: name('boss'), kind: 'owner' });
    const { token } = await login(id);
    setNow(new Date(T0.getTime() + 2 * HOUR));
    expect((await get('/t/me', token)).statusCode).toBe(401);
  });

  it('ends a recovery session after 25 h idle, not at 24 h 59 min (M4)', async () => {
    const id = await seedAccount(deps, { loginName: name() });
    const kept = await login(id, { level: 'recovery' });
    setNow(new Date(T0.getTime() + 25 * HOUR - MIN));
    expect((await get('/t/recovery-ok', kept.token)).statusCode).toBe(200);
    setNow(T0);
    const idle = await login(id, { level: 'recovery' });
    setNow(new Date(T0.getTime() + 25 * HOUR));
    expect((await get('/t/recovery-ok', idle.token)).statusCode).toBe(401);
  });

  it('moves a staff session\'s expires_at to the idle deadline on use, so idle sessions get purged (M1)', async () => {
    const id = await seedAccount(deps, { loginName: name('staffer'), kind: 'staff' });
    const { token, sessionId } = await login(id);
    const expiresAt = async () =>
      (await deps.db.query<{ expires_at: Date }>('select expires_at from sessions where id = $1', [sessionId])).rows[0]?.expires_at;
    expect(await expiresAt()).toEqual(new Date(T0.getTime() + 2 * HOUR));
    setNow(new Date(T0.getTime() + HOUR));
    expect((await get('/t/me', token)).statusCode).toBe(200);
    expect(await expiresAt()).toEqual(new Date(T0.getTime() + 3 * HOUR));
    // Near the end the absolute limit wins.
    for (let h = 2; h <= 11; h++) {
      setNow(new Date(T0.getTime() + h * HOUR));
      expect((await get('/t/me', token)).statusCode).toBe(200);
    }
    expect(await expiresAt()).toEqual(new Date(T0.getTime() + 12 * HOUR));
    // An idle session is past expires_at and purged an hour after that.
    const other = await login(id);
    const stale = new Date(now0().getTime() + 2 * HOUR + HOUR + MIN);
    await purgeExpired.run(deps.db, stale);
    expect((await deps.db.query('select 1 from sessions where id = $1', [other.sessionId])).rows).toHaveLength(0);
  });

  it('ends a recovery session after 48 h', async () => {
    const id = await seedAccount(deps, { loginName: name() });
    const { token } = await login(id, { level: 'recovery' });
    for (let h = 24; h < 48; h += 24) {
      setNow(new Date(T0.getTime() + h * HOUR));
      expect((await get('/t/recovery-ok', token)).statusCode).toBe(200);
    }
    setNow(new Date(T0.getTime() + 47 * HOUR));
    expect((await get('/t/recovery-ok', token)).statusCode).toBe(200);
    setNow(new Date(T0.getTime() + 48 * HOUR));
    expect((await get('/t/recovery-ok', token)).statusCode).toBe(401);
  });

  it('refuses a recovery session without allowRecovery, and a staff session where kinds is trader', async () => {
    const id = await seedAccount(deps, { loginName: name() });
    const rec = await login(id, { level: 'recovery' });
    const r1 = await get('/t/me', rec.token);
    expect(r1.statusCode).toBe(403);
    expect(r1.json()).toEqual({ error: 'recovery-session' });
    expect((await get('/t/recovery-ok', rec.token)).json()).toMatchObject({ level: 'recovery' });

    const staff = await seedAccount(deps, { loginName: name('staffer'), kind: 'staff' });
    const s = await login(staff);
    const r2 = await get('/t/trader', s.token);
    expect(r2.statusCode).toBe(403);
    expect(r2.json()).toEqual({ error: 'wrong-account-kind' });
    expect((await get('/t/me', s.token)).statusCode).toBe(200);
    const t = await login(id);
    expect((await get('/t/trader', t.token)).statusCode).toBe(200);
  });

  it('stops a live session as soon as the account is disabled', async () => {
    const id = await seedAccount(deps, { loginName: name() });
    const { token } = await login(id);
    expect((await get('/t/me', token)).statusCode).toBe(200);
    await deps.db.query('update accounts set disabled_at = $2 where id = $1', [id, T0]);
    const res = await get('/t/me', token);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'account-disabled' });
    await expect(assertNotDisabled(deps.db, id)).rejects.toMatchObject({ status: 403, code: 'account-disabled' });
    const ok = await seedAccount(deps, { loginName: name() });
    await expect(assertNotDisabled(deps.db, ok)).resolves.toBeUndefined();
  });

  it('never asks an owner (null Terms version) for Terms (M4)', async () => {
    await deps.db.query(`delete from accounts where kind = 'owner'`); // one owner per database
    const id = await seedAccount(deps, { loginName: name('boss'), kind: 'owner' });
    const { rows } = await deps.db.query('select terms_version from accounts where id = $1', [id]);
    expect(rows[0].terms_version).toBeNull();
    expect((await get('/t/me', (await login(id)).token)).statusCode).toBe(200);
  });

  it('answers terms-required to a trader on a stale Terms version, except with allowStaleTerms (R10)', async () => {
    const id = await seedAccount(deps, { loginName: name(), termsVersion: '2026-01-01' });
    const { token } = await login(id);
    const res = await get('/t/me', token);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'terms-required', version: deps.config.termsVersion });
    expect((await get('/t/stale', token)).statusCode).toBe(200);

    const never = await seedAccount(deps, { loginName: name(), termsVersion: null });
    expect((await get('/t/me', (await login(never)).token)).json()).toMatchObject({ error: 'terms-required' });

    const staff = await seedAccount(deps, { loginName: name('staffer'), kind: 'staff' });
    expect((await get('/t/me', (await login(staff)).token)).statusCode).toBe(200);
  });

  it('endAllSessions ends every session of the account and only that account', async () => {
    const id = await seedAccount(deps, { loginName: name() });
    const other = await seedAccount(deps, { loginName: name() });
    const a = await login(id);
    const b = await login(id);
    const c = await login(other);
    await endAllSessions({ ...deps, events: app.events }, id);
    expect((await get('/t/me', a.token)).statusCode).toBe(401);
    expect((await get('/t/me', b.token)).statusCode).toBe(401);
    expect((await get('/t/me', c.token)).statusCode).toBe(200);
  });

  it('endOtherSessions keeps only the given session', async () => {
    const id = await seedAccount(deps, { loginName: name() });
    const a = await login(id);
    const b = await login(id);
    await endOtherSessions({ ...deps, events: app.events }, id, b.sessionId);
    expect((await get('/t/me', a.token)).statusCode).toBe(401);
    expect((await get('/t/me', b.token)).statusCode).toBe(200);
  });

  it('never adopts an attacker-chosen session cookie (fixation)', async () => {
    const id = await seedAccount(deps, { loginName: name() });
    const planted = randomBytes(32).toString('base64url');
    const { token } = await login(id, { cookies: { [SESSION_COOKIE]: planted } });
    expect(token).not.toBe(planted);
    expect((await get('/t/me', planted)).statusCode).toBe(401);
    expect((await get('/t/me', token)).statusCode).toBe(200);
  });

  it('a login made while another valid session is present revokes it and replaces the cookie', async () => {
    const id = await seedAccount(deps, { loginName: name() });
    const first = await login(id);
    const second = await login(id, { cookies: { [SESSION_COOKIE]: first.token } });
    expect(second.token).not.toBe(first.token);
    expect((await get('/t/me', first.token)).statusCode).toBe(401);
    expect((await get('/t/me', second.token)).statusCode).toBe(200);
    const { rows } = await deps.db.query('select revoked_at from sessions where id = $1', [first.sessionId]);
    expect(rows[0].revoked_at).not.toBeNull();
  });

  it('sets both cookies HttpOnly, Secure, SameSite=Strict, Path=/ and without Domain', async () => {
    const id = await seedAccount(deps, { loginName: name() });
    const { res } = await login(id);
    const raw = res.headers['set-cookie'];
    const lines = Array.isArray(raw) ? raw : [String(raw)];
    for (const cookie of [SESSION_COOKIE, DEVICE_COOKIE]) {
      const line = lines.find((l) => l.startsWith(`${cookie}=`));
      expect(line, cookie).toBeDefined();
      const parts = line!.split(';').map((p) => p.trim().toLowerCase());
      expect(parts).toContain('httponly');
      expect(parts).toContain('secure');
      expect(parts).toContain('samesite=strict');
      expect(parts).toContain('path=/');
      expect(parts.some((p) => p.startsWith('domain'))).toBe(false);
    }
    const dev = lines.find((l) => l.startsWith(`${DEVICE_COOKIE}=`))!;
    expect(dev.toLowerCase()).toContain(`max-age=${400 * 24 * 3600}`);
  });

  it('stores only the SHA-256 of the session token', async () => {
    const id = await seedAccount(deps, { loginName: name() });
    const { token, sessionId } = await login(id);
    const { rows } = await deps.db.query<{ token_hash: Buffer }>('select token_hash from sessions where id = $1', [sessionId]);
    const stored = rows[0]!.token_hash;
    expect(stored.toString('base64url')).not.toBe(token);
    expect(stored.equals(Buffer.from(token, 'utf8'))).toBe(false);
    expect(stored.equals(createHash('sha256').update(token).digest())).toBe(true);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  });

  it('sets onboarding only on the first session and alerts only on later logins', async () => {
    const id = await seedAccount(deps, { loginName: name() });
    const first = await login(id, { firstSession: true });
    expect((await get('/t/me', first.token)).json()).toMatchObject({
      onboardingUntil: new Date(T0.getTime() + 30 * MIN).toISOString(),
    });
    expect((await deps.db.query('select * from alerts where account_id = $1', [id])).rows).toEqual([]);

    const label = `  ${'L'.repeat(70)}  `;
    const later = await login(id, { deviceLabel: label });
    expect((await get('/t/me', later.token)).json()).toMatchObject({ onboardingUntil: null });
    const { rows } = await deps.db.query('select kind, detail from alerts where account_id = $1', [id]);
    expect(rows).toEqual([{ kind: 'new-login', detail: { method: 'passkey', deviceLabel: 'L'.repeat(60) } }]);
    const s = await deps.db.query('select device_label from sessions where id = $1', [later.sessionId]);
    expect(s.rows[0].device_label).toBe('L'.repeat(60));

    const hold = new Date(T0.getTime() + DAY).toISOString();
    await login(id, { level: 'recovery', holdUntil: hold });
    const rec = await deps.db.query(`select detail from alerts where account_id = $1 and kind = 'recovery-login'`, [id]);
    expect(rec.rows).toEqual([{ detail: { method: 'passkey', deviceLabel: 'Test browser', holdUntil: hold } }]);
  });

  it('strips control and bidi/format characters from the device label (M2)', async () => {
    const id = await seedAccount(deps, { loginName: name() });
    const evil = '\u202Eevil\u202C \u0000Phone\u200B\u2066x\u2069\n\t';
    const { sessionId } = await login(id, { deviceLabel: evil });
    const s = await deps.db.query('select device_label from sessions where id = $1', [sessionId]);
    expect(s.rows[0].device_label).toBe('evil Phonex');
    const { rows } = await deps.db.query(`select detail from alerts where account_id = $1 and kind = 'new-login'`, [id]);
    expect(rows[0].detail.deviceLabel).toBe('evil Phonex');
    // Stripped before cutting: 60 visible characters survive 60 invisible ones.
    const padded = await login(id, { deviceLabel: '\u200B'.repeat(60) + 'A'.repeat(70) });
    const p = await deps.db.query('select device_label from sessions where id = $1', [padded.sessionId]);
    expect(p.rows[0].device_label).toBe('A'.repeat(60));
  });

  it('trusts the device it logs in from', async () => {
    const id = await seedAccount(deps, { loginName: name() });
    const { res } = await login(id);
    const dev = cookieOf(res, DEVICE_COOKIE)!.value;
    const probe = await app.inject({ method: 'POST', url: '/t/device', headers: { origin: ORIGIN }, cookies: { [DEVICE_COOKIE]: dev } });
    const { had, hash } = probe.json<{ had: boolean; hash: string }>();
    expect(had).toBe(true);
    expect(cookieOf(probe, DEVICE_COOKIE)).toBeUndefined(); // an existing cookie is kept
    expect(await isTrusted(deps, id, Buffer.from(hash, 'hex'))).toBe(true);
    const other = await seedAccount(deps, { loginName: name() });
    expect(await isTrusted(deps, other, Buffer.from(hash, 'hex'))).toBe(false);
    // The stored hash is an HMAC of the cookie, never the cookie itself.
    const { rows } = await deps.db.query<{ device_hash: Buffer }>('select device_hash from trusted_devices where account_id = $1', [id]);
    expect(rows[0]!.device_hash.toString('hex')).toBe(hash);
    expect(hash).not.toBe(createHash('sha256').update(dev).digest('hex'));
  });

  it('ensureDeviceCookie sets a fresh device cookie when absent or malformed', async () => {
    const fresh = await app.inject({ method: 'POST', url: '/t/device', headers: { origin: ORIGIN } });
    expect(fresh.json()).toMatchObject({ had: false });
    expect(fresh.json<{ hash: string | null }>().hash).toMatch(/^[0-9a-f]{64}$/);
    expect(cookieOf(fresh, DEVICE_COOKIE)?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const bad = await app.inject({ method: 'POST', url: '/t/device', headers: { origin: ORIGIN }, cookies: { [DEVICE_COOKIE]: 'x' } });
    expect(bad.json()).toMatchObject({ had: false });
    expect(cookieOf(bad, DEVICE_COOKIE)?.value).not.toBe('x');
  });

  it('POST /v1/logout clears the cookie even for an expired, disabled or unknown session (M3)', async () => {
    const id = await seedAccount(deps, { loginName: name() });
    const logout = (token?: string) =>
      app.inject({ method: 'POST', url: '/v1/logout', headers: { origin: ORIGIN }, ...(token ? { cookies: { [SESSION_COOKIE]: token } } : {}) });
    const expired = await login(id);
    setNow(new Date(T0.getTime() + 8 * DAY));
    const r1 = await logout(expired.token);
    expect(r1.statusCode).toBe(200);
    expect(cookieOf(r1, SESSION_COOKIE)?.value).toBe('');

    setNow(T0);
    const live = await login(id);
    await deps.db.query('update accounts set disabled_at = $2 where id = $1', [id, T0]);
    const r2 = await logout(live.token);
    expect(r2.statusCode).toBe(200);
    expect(cookieOf(r2, SESSION_COOKIE)?.value).toBe('');
    const { rows } = await deps.db.query('select revoked_at from sessions where id = $1', [live.sessionId]);
    expect(rows[0].revoked_at).not.toBeNull();

    for (const t of [undefined, 'garbage', randomBytes(32).toString('base64url')]) {
      const r = await logout(t);
      expect(r.statusCode).toBe(200);
      expect(cookieOf(r, SESSION_COOKIE)?.value).toBe('');
    }
  });

  it('POST /v1/logout ends the session and clears the cookie', async () => {
    const id = await seedAccount(deps, { loginName: name(), termsVersion: '2025-01-01' });
    const { token } = await login(id);
    const res = await app.inject({ method: 'POST', url: '/v1/logout', headers: { origin: ORIGIN }, cookies: { [SESSION_COOKIE]: token } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    const cleared = cookieOf(res, SESSION_COOKIE);
    expect(cleared?.value).toBe('');
    expect((await get('/t/stale', token)).statusCode).toBe(401);
    // A recovery session can log out too.
    const rec = await login(id, { level: 'recovery' });
    const r2 = await app.inject({ method: 'POST', url: '/v1/logout', headers: { origin: ORIGIN }, cookies: { [SESSION_COOKIE]: rec.token } });
    expect(r2.statusCode).toBe(200);
  });
});

describe('consumeChallenge', () => {
  const insertChallenge = async (expiresAt: Date) => {
    const { rows } = await deps.db.query<{ id: string }>(
      `insert into challenges (purpose, method, created_at, expires_at) values ('login', 'pgp', $1, $2) returning id`,
      [T0, expiresAt],
    );
    return rows[0]!.id;
  };

  it('hands a challenge out once, even to parallel callers', async () => {
    const id = await insertChallenge(new Date(T0.getTime() + 5 * MIN));
    const results = await Promise.all([consumeChallenge(deps.db, id, T0), consumeChallenge(deps.db, id, T0)]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(results.filter((r) => r === null)).toHaveLength(1);
    const row = results.find((r) => r !== null)!;
    expect(row).toMatchObject({ id, purpose: 'login', method: 'pgp' });
    expect(row.used_at).toEqual(T0);
  });

  it('returns null for an expired challenge, including at exactly its expiry', async () => {
    const id = await insertChallenge(T0);
    expect(await consumeChallenge(deps.db, id, T0)).toBeNull();
    expect(await consumeChallenge(deps.db, randomUUIDLike(), T0)).toBeNull();
  });
});

function randomUUIDLike(): string {
  const h = randomBytes(16).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20)}`;
}

describe('purgeExpired', () => {
  it('removes old challenges, sessions, throttles, counts, devices and alerts, keeps fresh ones', async () => {
    // Its own database, so rows from the other tests in this file cannot change the counts.
    const db = await testDb();
    onTestFinished(() => db.end());
    const own = { ...deps, db };
    const id = await seedAccount(own, { loginName: name() });
    const ins = (sql: string, p: unknown[]) => db.query(sql, p);
    const ago = (ms: number) => new Date(T0.getTime() - ms);
    await ins(`insert into challenges (purpose, method, created_at, expires_at, payload) values ('login','pgp',$1,$2,'{"tag":"old"}')`, [ago(3 * HOUR), ago(2 * HOUR)]);
    await ins(`insert into challenges (purpose, method, created_at, expires_at, payload) values ('login','pgp',$1,$2,'{"tag":"recent"}')`, [ago(40 * MIN), ago(30 * MIN)]);
    await ins(`insert into challenges (purpose, method, created_at, expires_at, payload) values ('login','pgp',$1,$2,'{"tag":"live"}')`, [T0, new Date(T0.getTime() + 5 * MIN)]);
    await addAlert(db, id, 'new-login', { tag: 'old' }, T0);
    await addAlert(db, id, 'new-login', { tag: 'fresh' }, T0);
    await ins(`update alerts set created_at = $2 where account_id = $1 and detail->>'tag' = 'old'`, [id, ago(91 * DAY)]);
    await ins(`update alerts set created_at = $2 where account_id = $1 and detail->>'tag' = 'fresh'`, [id, ago(89 * DAY)]);
    const sess = (label: string, expires: Date, revoked: Date | null) =>
      ins(
        `insert into sessions (account_id, token_hash, level, device_label, created_at, last_seen_at, expires_at, revoked_at)
         values ($1, $2, 'full', $3, $4, $4, $5, $6)`,
        [id, randomBytes(32), label, ago(DAY), expires, revoked],
      );
    await sess('expired', ago(MIN), null);
    await sess('revoked-old', new Date(T0.getTime() + DAY), ago(2 * HOUR));
    await sess('revoked-recent', new Date(T0.getTime() + DAY), ago(10 * MIN));
    await sess('live', new Date(T0.getTime() + DAY), null);
    await ins(`insert into login_throttle (key, failures, last_failure_at) values ('password:old:anon', 3, $1), ('password:new:anon', 3, $2)`, [ago(2 * HOUR), ago(10 * MIN)]);
    await ins(`insert into daily_counts (key, day, count) values ('old', '2026-10-14', 1), ('new', '2026-10-16', 1), ('today', '2026-10-17', 1)`, []);
    await ins(`insert into trusted_devices (account_id, device_hash, created_at, last_used_at) values ($1, $2, $3, $3), ($1, $4, $5, $5)`, [
      id, randomBytes(32), ago(91 * DAY), randomBytes(32), ago(89 * DAY),
    ]);

    const removed = await purgeExpired.run(db, T0);
    expect(removed).toBe(1 + 1 + 2 + 1 + 1 + 1);
    expect(purgeExpired.name).toBe('purgeExpired');

    const tags = (await db.query(`select payload->>'tag' as t from challenges where payload ? 'tag' order by t`)).rows.map((r) => r.t);
    expect(tags).toEqual(['live', 'recent']);
    const alerts = (await db.query(`select detail->>'tag' as t from alerts where account_id = $1`, [id])).rows.map((r) => r.t);
    expect(alerts).toEqual(['fresh']);
    const labels = (await db.query(`select device_label from sessions where account_id = $1 order by device_label`, [id])).rows.map((r) => r.device_label);
    expect(labels).toEqual(['live', 'revoked-recent']);
    expect((await db.query(`select key from login_throttle where key like 'password:%:anon'`)).rows).toEqual([{ key: 'password:new:anon' }]);
    expect((await db.query(`select key from daily_counts where key in ('old','new','today') order by key`)).rows.map((r) => r.key)).toEqual(['new', 'today']);
    expect((await db.query(`select 1 from trusted_devices where account_id = $1`, [id])).rows).toHaveLength(1);
  });
});
