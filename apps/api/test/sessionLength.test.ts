// Session length chosen at every login, and "Stay logged in?" (owner, 2 Nov 2026; boards
// SessionLength, SessionExtend, Devices). The chosen time is the session length: using the session
// never moves its end, and there is no fixed maximum. Extending re-proves a login method on the
// server (a confirm token for `extend-session`), never a client flag.
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { issueConfirmToken } from '../src/auth/confirm.js';
import { SESSION_COOKIE } from '../src/auth/sessions.js';
import { seedAccount } from './helpers/accounts.js';
import { testApp } from './helpers/app.js';
import { Browser, addTestLogin } from './helpers/totp.js';

const T0 = new Date('2026-11-02T12:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const TERMS = '2026-10-17';
const GOOD = 'Correct-Horse-9';

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let n = 0;

beforeAll(async () => {
  ({ app, deps, setNow } = await testApp());
  addTestLogin(app, deps);
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  setNow(T0);
});

const at = (ms: number) => setNow(new Date(T0.getTime() + ms));
const iso = (ms: number) => new Date(T0.getTime() + ms).toISOString();
const errorOf = (res: LightMyRequestResponse) => (res.json() as { error?: string }).error;

interface SessionInfo {
  lengthHours: number | null;
  choices: number[];
  expiresAt: string;
  canExtend: boolean;
  serverNow: string;
}

async function sessionOf(b: Browser): Promise<SessionInfo | null> {
  const res = await b.get('/v1/account/me');
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { session: SessionInfo | null }).session;
}

async function loggedIn(accountId: string, o: { level?: 'full' | 'recovery' } = {}): Promise<Browser & { sessionId: string }> {
  const b = new Browser(app) as Browser & { sessionId: string };
  const res = await b.post('/t/login', { accountId, ...o });
  expect(res.statusCode, res.body).toBe(200);
  b.sessionId = (res.json() as { sessionId: string }).sessionId;
  return b;
}

async function trader(kind: 'trader' | 'staff' | 'owner' = 'trader') {
  const id = await seedAccount(deps, { loginName: `len${String(++n).padStart(4, '0')}x`, kind });
  return { id, b: await loggedIn(id) };
}

const setLength = (b: Browser, hours: unknown) => b.put('/v1/account/session/length', { hours });
const extendToken = (b: Browser & { sessionId: string }, accountId: string) =>
  issueConfirmToken(deps, { sessionId: b.sessionId, accountId, action: { kind: 'extend-session' }, method: 'password' });

describe('choosing the session length', () => {
  it('a new trader session lasts 2 hours until a length is chosen, and me offers the choices with none chosen', async () => {
    const { b } = await trader();
    expect(await sessionOf(b)).toEqual({ lengthHours: null, choices: [2, 4, 6, 12], expiresAt: iso(2 * HOUR), canExtend: true, serverNow: iso(0) });
    // Using the session never moves its end.
    at(2 * HOUR - MIN);
    expect((await sessionOf(b))!.expiresAt).toBe(iso(2 * HOUR));
    at(2 * HOUR);
    expect((await b.get('/v1/account/me')).statusCode).toBe(401);
  });

  it('the chosen length counts from the login, and using the session never moves the end', async () => {
    const { b } = await trader();
    at(30 * MIN);
    const res = await setLength(b, 6);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ lengthHours: 6, expiresAt: iso(6 * HOUR) });
    for (let m = 60; m < 6 * 60; m += 60) {
      at(m * MIN);
      expect((await b.get('/v1/account/me')).statusCode).toBe(200);
    }
    at(6 * HOUR - MIN);
    expect((await sessionOf(b))!.expiresAt).toBe(iso(6 * HOUR));
    at(6 * HOUR);
    expect((await b.get('/v1/account/me')).statusCode).toBe(401);
  });

  it('refuses a length that is not one of the account type’s choices', async () => {
    const { b } = await trader();
    for (const bad of [0, 1, 3, 8, 10, 24, 2.5, '6', null, true, [6]]) {
      const res = await setLength(b, bad);
      expect(res.statusCode, String(bad)).toBe(400);
      expect(errorOf(res)).toBe('bad-request');
    }
    expect((await b.put('/v1/account/session/length', {})).statusCode).toBe(400);
    expect((await sessionOf(b))!.lengthHours).toBeNull();
  });

  it('once chosen, a shorter length applies now and a longer one from the next "Stay logged in"', async () => {
    const { id, b } = await trader();
    expect((await setLength(b, 6)).statusCode).toBe(200);
    at(HOUR);
    expect((await setLength(b, 2)).json()).toMatchObject({ lengthHours: 2, expiresAt: iso(2 * HOUR) });
    // Lengthening never adds time without a login method: the end stays, the next extend uses 12.
    expect((await setLength(b, 12)).json()).toMatchObject({ lengthHours: 12, expiresAt: iso(2 * HOUR) });
    at(2 * HOUR - MIN);
    const res = await b.post('/v1/account/session/extend', { confirmToken: await extendToken(b, id) });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ lengthHours: 12, expiresAt: iso(14 * HOUR - MIN) });
  });

  it('changes only the calling session', async () => {
    const { id, b } = await trader();
    const other = await loggedIn(id);
    expect((await setLength(b, 12)).statusCode).toBe(200);
    expect(await sessionOf(other)).toMatchObject({ lengthHours: null, expiresAt: iso(2 * HOUR) });
  });
});

describe('"Stay logged in?": extending the session', () => {
  it('needs a confirm token for exactly extend-session, then adds the length from now', async () => {
    const { id, b } = await trader();
    expect((await setLength(b, 4)).statusCode).toBe(200);
    at(4 * HOUR - 2 * MIN);
    const bare = await b.post('/v1/account/session/extend', {});
    expect(bare.statusCode).toBe(403);
    expect(bare.json()).toEqual({ error: 'confirm-required', action: 'extend-session' });
    const wrong = await issueConfirmToken(deps, { sessionId: b.sessionId, accountId: id, action: { kind: 'set-password' }, method: 'password' });
    expect(errorOf(await b.post('/v1/account/session/extend', { confirmToken: wrong }))).toBe('confirm-invalid');
    const token = b.cookies[SESSION_COOKIE];
    const res = await b.post('/v1/account/session/extend', { confirmToken: await extendToken(b, id) });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ lengthHours: 4, expiresAt: iso(8 * HOUR - 2 * MIN) });
    // The same session goes on: its cookie is set again (same token, a fresh lifetime).
    expect(res.cookies.find((c) => c.name === SESSION_COOKIE)?.value).toBe(token);
    at(8 * HOUR - 3 * MIN);
    expect((await b.get('/v1/account/me')).statusCode).toBe(200);
    at(8 * HOUR - 2 * MIN);
    expect((await b.get('/v1/account/me')).statusCode).toBe(401);
  });

  it('a token is single use and bound to the session it was earned on', async () => {
    const { id, b } = await trader();
    const other = await loggedIn(id);
    const token = await extendToken(b, id);
    expect(errorOf(await other.post('/v1/account/session/extend', { confirmToken: token }))).toBe('confirm-invalid');
    expect((await b.post('/v1/account/session/extend', { confirmToken: token })).statusCode).toBe(200);
    expect(errorOf(await b.post('/v1/account/session/extend', { confirmToken: token }))).toBe('confirm-invalid');
  });

  it('works with the password alone, through the real confirm route (owner: any login method)', async () => {
    const b = new Browser(app);
    const name = `pw${String(++n).padStart(4, '0')}x`;
    const reg = await b.post('/v1/register/password', { displayName: `P${name}`, loginName: name, password: GOOD, deviceLabel: 'Laptop', acceptedTerms: TERMS });
    expect(reg.statusCode, reg.body).toBe(200);
    expect((await setLength(b, 2)).statusCode).toBe(200);
    at(2 * HOUR - MIN);
    const miss = await b.post('/v1/confirm/password', { password: 'Wrong-Horse-9', action: { kind: 'extend-session' } });
    expect(miss.statusCode).toBe(401);
    const ok = await b.post('/v1/confirm/password', { password: GOOD, action: { kind: 'extend-session' } });
    expect(ok.statusCode, ok.body).toBe(200);
    const { confirmToken } = ok.json() as { confirmToken: string };
    const res = await b.post('/v1/account/session/extend', { confirmToken });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ lengthHours: 2, expiresAt: iso(4 * HOUR - MIN) });
  });

  it('has no fixed maximum: extended every time, a session outlives 30 days', async () => {
    const { id, b } = await trader();
    expect((await setLength(b, 12)).statusCode).toBe(200);
    for (let h = 11; h < 35 * 24; h += 11) {
      at(h * HOUR);
      const res = await b.post('/v1/account/session/extend', { confirmToken: await extendToken(b, id) });
      expect(res.statusCode, `${h} h`).toBe(200);
    }
    at(35 * DAY);
    expect((await b.get('/v1/account/me')).statusCode).toBe(200);
  });

  it('once the time is up the session is over: extending is refused', async () => {
    const { id, b } = await trader();
    const token = await extendToken(b, id);
    at(2 * HOUR);
    expect((await b.post('/v1/account/session/extend', { confirmToken: token })).statusCode).toBe(401);
  });

  it('a session whose length was never chosen extends by the shortest choice', async () => {
    const { id, b } = await trader();
    at(HOUR);
    const res = await b.post('/v1/account/session/extend', { confirmToken: await extendToken(b, id) });
    expect(res.json()).toMatchObject({ lengthHours: null, expiresAt: iso(3 * HOUR) });
  });
});

describe('who has a session length', () => {
  it('staff and owner sessions keep their fixed rules: no length to choose', async () => {
    for (const kind of ['staff', 'owner'] as const) {
      const { b } = await trader(kind);
      expect(await sessionOf(b)).toBeNull();
      expect(errorOf(await setLength(b, 2))).toBe('wrong-account-kind');
      expect(errorOf(await b.post('/v1/account/session/extend', {}))).toBe('wrong-account-kind');
    }
  });

  it('a backup (recovery) session keeps its own rules', async () => {
    const id = await seedAccount(deps, { loginName: `rec${String(++n).padStart(4, '0')}x` });
    const b = await loggedIn(id, { level: 'recovery' });
    expect(await sessionOf(b)).toBeNull();
    expect(errorOf(await setLength(b, 2))).toBe('recovery-session');
    expect(errorOf(await b.post('/v1/account/session/extend', {}))).toBe('recovery-session');
  });

  it('a team member chooses the length of their own session, but cannot extend it (open owner question)', async () => {
    const { id: teamId } = await trader();
    const loginId = await seedAccount(deps, { loginName: `mlen${++n}x`, displayName: `m-len-${n}`, kind: 'member' });
    const now = deps.clock();
    await deps.db.query(
      `insert into team_members (account_id, display_name, display_key, roles, invite_expires_at, member_account_id, joined_at, created_at)
       values ($1, $2, $3, $4, $5, $6, $5, $5)`,
      [teamId, `Member${n}`, `member${n}`, ['trades'], now, loginId],
    );
    const m = await loggedIn(loginId);
    expect(await sessionOf(m)).toMatchObject({ lengthHours: null, choices: [2, 4, 6, 12], canExtend: false });
    expect((await setLength(m, 4)).json()).toMatchObject({ lengthHours: 4, expiresAt: iso(4 * HOUR) });
    expect(errorOf(await m.post('/v1/account/session/extend', {}))).toBe('owner-only');
  });
});
