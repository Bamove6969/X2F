// Plan 2 Task 16: new-device approval, number matching, the 3-device limit and "One device at a
// time". Logins here use passwords (the gate is the same function for PGP, passkeys and security
// keys: `completeLogin`'s trader branch; the passkey case below proves that path too).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import type { AccountKind } from '@x2f/accounts';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deps } from '../src/app.js';
import {
  APPROVAL_COOKIE, APPROVAL_TTL_MS, APPROVALS_PER_HOUR, approvalRandom, coarseDeviceLabel, drawNumbers,
} from '../src/auth/approval.js';
import { issueConfirmToken } from '../src/auth/confirm.js';
import { DEVICE_COOKIE, ensureDeviceCookie } from '../src/auth/device.js';
import { completeLogin, type LoginFactor } from '../src/auth/login.js';
import { SESSION_COOKIE, startSession } from '../src/auth/sessions.js';
import { accountIdByLoginName, seedAccount } from './helpers/accounts.js';
import { testApp } from './helpers/app.js';
import { fixtureLeakedList } from './helpers/leaked.js';
import { createSoftAuthenticator } from './helpers/softAuthenticator.js';

const ORIGIN = 'https://x2f.test';
const T0 = new Date('2026-10-17T12:00:00Z');
const HOUR = 3600_000;
const TERMS = '2026-10-17';
const GOOD = 'Correct-Horse-9';

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let now = T0;
let step = 0;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const fixture = await fixtureLeakedList();
  cleanup = fixture.cleanup;
  let set: (d: Date) => void;
  ({ app, deps, setNow: set } = await testApp({ leaked: fixture.list }));
  setNow = (d) => {
    now = d;
    set(d);
  };
  app.post('/t/session', async (req, reply) => {
    const { accountId } = req.body as { accountId: string };
    await startSession(deps, req, reply, { accountId, level: 'full', deviceLabel: 'Test', method: 'pgp', firstSession: false });
    return { ok: true };
  });
  app.post('/t/complete', async (req, reply) => {
    ensureDeviceCookie(req, reply);
    const { accountId, factor, pendingId } = req.body as { accountId: string; factor: LoginFactor; pendingId?: string };
    const { rows } = await deps.db.query<{ kind: AccountKind }>('select kind from accounts where id = $1', [accountId]);
    return completeLogin(deps, req, reply, {
      account: { id: accountId, kind: rows[0]!.kind }, factor, deviceLabel: 'Desk', ...(pendingId !== undefined ? { pendingId } : {}),
    });
  });
});

afterAll(async () => {
  await app.close();
  await cleanup();
});

beforeEach(() => {
  setNow(new Date(T0.getTime() + ++step * HOUR));
  vi.restoreAllMocks();
});

/** One browser: its own cookie jar (device cookie, session, approval cookie). */
class Browser {
  cookies: Record<string, string> = {};
  constructor(readonly label = 'Browser on Linux') {}
  private keep(res: LightMyRequestResponse): LightMyRequestResponse {
    for (const c of res.cookies) {
      if (c.maxAge === 0 || c.value === '') delete this.cookies[c.name];
      else this.cookies[c.name] = c.value;
    }
    return res;
  }
  async send(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown): Promise<LightMyRequestResponse> {
    return this.keep(
      await app.inject({
        method, url, headers: { origin: ORIGIN }, cookies: this.cookies,
        ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
      }),
    );
  }
  get = (url: string) => this.send('GET', url);
  post = (url: string, payload: unknown = {}) => this.send('POST', url, payload);
  login(name: string, password = GOOD) {
    return this.post('/v1/login/password', { loginName: name, password, deviceLabel: this.label });
  }
  me() {
    return this.get('/v1/account/me');
  }
}

let seq = 0;
const unique = (p: string) => `${p}${++seq}x${step}`;

/** Signs up a password trader in a fresh browser (logged in there). */
async function signUp(label = 'Firefox on Linux') {
  const b = new Browser(label);
  const name = unique('dev');
  const res = await b.post('/v1/register/password', { displayName: `P${name}`, loginName: name, password: GOOD, deviceLabel: label, acceptedTerms: TERMS });
  expect(res.statusCode).toBe(201);
  const rows = [{ id: (await accountIdByLoginName(deps, name))! }];
  return { a: b, name, accountId: rows[0]!.id };
}

type Wait = { status: 'approve-on-device'; approvalId: string; number: number; expiresAt: string };

async function waitFor(b: Browser, name: string): Promise<Wait> {
  const res = await b.login(name);
  expect(res.statusCode).toBe(200);
  const body = res.json() as Wait;
  expect(body.status).toBe('approve-on-device');
  return body;
}

const approvalCount = async (accountId: string) => (await deps.db.query('select 1 from login_approvals where account_id = $1', [accountId])).rowCount;

const wrongOf = (choices: number[], right: number) => choices.find((c) => c !== right)!;

async function alerts(accountId: string, kind: string) {
  const { rows } = await deps.db.query<{ detail: Record<string, unknown> }>(
    'select detail from alerts where account_id = $1 and kind = $2 order by created_at',
    [accountId, kind],
  );
  return rows.map((r) => r.detail);
}

/** Approves `w` from the logged-in browser `a` and collects the session on `b`. */
async function approveAndCollect(a: Browser, b: Browser, w: Wait, extra: Record<string, unknown> = {}) {
  const res = await a.post(`/v1/account/approvals/${w.approvalId}`, { choice: w.number, ...extra });
  expect(res.json()).toEqual({ outcome: 'approved' });
  const poll = await b.post(`/v1/login/approval/${w.approvalId}/poll`);
  expect(poll.statusCode).toBe(200);
  return poll;
}

describe('when a login waits for approval', () => {
  it('an untrusted browser while the account is logged in elsewhere: no session, a number, an approval cookie', async () => {
    const { a, name, accountId } = await signUp();
    const b = new Browser();
    const res = await b.login(name);
    const body = res.json() as Wait;
    expect(body).toEqual({
      status: 'approve-on-device', approvalId: expect.any(String), number: expect.any(Number),
      expiresAt: new Date(now.getTime() + APPROVAL_TTL_MS).toISOString(),
    });
    expect(body.number).toBeGreaterThanOrEqual(10);
    expect(body.number).toBeLessThanOrEqual(99);
    expect(res.cookies.find((c) => c.name === SESSION_COOKIE)).toBeUndefined();
    const approvalCookie = res.cookies.find((c) => c.name === APPROVAL_COOKIE);
    expect(approvalCookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/' });
    expect((await b.me()).statusCode).toBe(401);
    // The logged-in side is told, without the number.
    const [alert] = await alerts(accountId, 'login-approval');
    expect(alert).toEqual({ approvalId: body.approvalId, deviceLabel: 'Browser on Linux', method: 'password' });
    expect((await a.me()).statusCode).toBe(200);
  });

  it('an account with no open session: a trusted browser logs in; a new one with a password is refused (hold model v3: approval-unavailable)', async () => {
    const { a, name, accountId } = await signUp();
    await a.post('/v1/logout');
    const b = new Browser();
    const res = await b.login(name);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'approval-unavailable' });
    expect((await b.me()).statusCode).toBe(401);
    expect(await approvalCount(accountId)).toBe(0);
    expect((await a.login(name)).json()).toEqual({ status: 'ok' });
    expect((await a.me()).statusCode).toBe(200);
  });

  it('a trusted browser under the limit needs no approval; the same browser re-logging in needs none', async () => {
    const { a, name } = await signUp();
    const b = new Browser();
    await approveAndCollect(a, b, await waitFor(b, name));
    await b.post('/v1/logout');
    expect((await b.login(name)).json()).toEqual({ status: 'ok' });
    // A logged-in browser logging in again replaces its own session, no approval.
    expect((await a.login(name)).json()).toEqual({ status: 'ok' });
  });

  it('a recovery session is not a logged-in device for this rule, and cannot approve', async () => {
    const { a, name, accountId } = await signUp();
    await deps.db.query(`update sessions set level = 'recovery' where account_id = $1`, [accountId]);
    expect((await a.get('/v1/account/approvals')).json()).toMatchObject({ error: 'recovery-session' });
    // Nothing is logged in to approve it: a password on a new device is refused (hold model v3), no approval opens.
    expect((await new Browser().login(name)).json()).toEqual({ error: 'approval-unavailable' });
    expect(await approvalCount(accountId)).toBe(0);
  });
});

describe('number matching', () => {
  it('the logged-in device sees three distinct choices with the right one, a coarse label, and nothing else', async () => {
    const { a, name } = await signUp();
    const b = new Browser('tap 47 now');
    const w = await waitFor(b, name);
    const list = (await a.get('/v1/account/approvals')).json() as Array<Record<string, unknown>>;
    expect(list).toHaveLength(1);
    const view = (await a.get(`/v1/account/approvals/${w.approvalId}`)).json() as { choices: number[] } & Record<string, unknown>;
    expect(view).toEqual(list[0]);
    expect(Object.keys(view).sort()).toEqual(['atLimit', 'choices', 'createdAt', 'deviceLabel', 'expiresAt', 'id', 'oneDevice']);
    expect(view.deviceLabel).toBe('A new device');
    expect(new Set(view.choices).size).toBe(3);
    expect(view.choices).toContain(w.number);
    for (const c of view.choices) expect(c >= 10 && c <= 99).toBe(true);
    expect(JSON.stringify(view)).not.toContain(name);
  });

  it('the right number approves; the poll then starts the session once', async () => {
    const { a, name, accountId } = await signUp();
    const b = new Browser();
    const w = await waitFor(b, name);
    expect((await b.post(`/v1/login/approval/${w.approvalId}/poll`)).json()).toEqual({ status: 'waiting', expiresAt: w.expiresAt });
    const saved = { [DEVICE_COOKIE]: b.cookies[DEVICE_COOKIE]!, [APPROVAL_COOKIE]: b.cookies[APPROVAL_COOKIE]! };
    const poll = await approveAndCollect(a, b, w);
    expect(poll.json()).toEqual({ status: 'ok', loggedOut: [] });
    expect(poll.cookies.find((c) => c.name === SESSION_COOKIE)).toBeDefined();
    expect((await b.me()).statusCode).toBe(200);
    expect((await a.me()).statusCode).toBe(200);
    expect(await alerts(accountId, 'new-login')).toContainEqual({ method: 'password', deviceLabel: 'Browser on Linux' });
    // Collected once: a replay of the poll (cookie and all) starts nothing.
    const replay = new Browser();
    replay.cookies = { ...saved };
    expect((await replay.post(`/v1/login/approval/${w.approvalId}/poll`)).json()).toEqual({ status: 'expired' });
    expect((await replay.me()).statusCode).toBe(401);
  });

  it('a wrong number blocks the login and is logged; it cannot be retried', async () => {
    const { a, name, accountId } = await signUp();
    const b = new Browser();
    const w = await waitFor(b, name);
    const { choices } = (await a.get(`/v1/account/approvals/${w.approvalId}`)).json() as { choices: number[] };
    expect((await a.post(`/v1/account/approvals/${w.approvalId}`, { choice: wrongOf(choices, w.number) })).json()).toEqual({ outcome: 'blocked' });
    expect((await a.post(`/v1/account/approvals/${w.approvalId}`, { choice: w.number })).json()).toEqual({ error: 'approval-ended', outcome: 'blocked' });
    expect((await b.post(`/v1/login/approval/${w.approvalId}/poll`)).json()).toEqual({ status: 'blocked' });
    expect((await b.me()).statusCode).toBe(401);
    expect(await alerts(accountId, 'login-blocked')).toEqual([
      { approvalId: w.approvalId, deviceLabel: 'Browser on Linux', method: 'password', reason: 'wrong-number' },
    ]);
  });

  it('"No, block it" blocks and is logged', async () => {
    const { a, name, accountId } = await signUp();
    const b = new Browser();
    const w = await waitFor(b, name);
    expect((await a.post(`/v1/account/approvals/${w.approvalId}`, { block: true })).json()).toEqual({ outcome: 'blocked' });
    expect((await b.post(`/v1/login/approval/${w.approvalId}/poll`)).json()).toEqual({ status: 'blocked' });
    expect((await alerts(accountId, 'login-blocked'))[0]).toMatchObject({ reason: 'blocked' });
  });

  it('refuses malformed decisions without deciding', async () => {
    const { a, name } = await signUp();
    const b = new Browser();
    const w = await waitFor(b, name);
    for (const body of [{}, { choice: '47' }, { choice: 4.5 }, { block: false }, { block: true, choice: w.number }, { choice: w.number, extra: 1 }, { choice: w.number, logOut: 'x' }]) {
      expect((await a.post(`/v1/account/approvals/${w.approvalId}`, body)).statusCode, JSON.stringify(body)).toBe(400);
    }
    expect((await b.post(`/v1/login/approval/${w.approvalId}/poll`)).json()).toMatchObject({ status: 'waiting' });
  });

  it('expires after 2 minutes on both sides', async () => {
    const { a, name } = await signUp();
    const b = new Browser();
    const w = await waitFor(b, name);
    setNow(new Date(now.getTime() + APPROVAL_TTL_MS));
    expect((await a.get('/v1/account/approvals')).json()).toEqual([]);
    expect((await a.post(`/v1/account/approvals/${w.approvalId}`, { choice: w.number })).json()).toEqual({ error: 'approval-ended', outcome: 'expired' });
    expect((await b.post(`/v1/login/approval/${w.approvalId}/poll`)).json()).toEqual({ status: 'expired' });
  });

  it('an approved login not collected within 2 minutes expires', async () => {
    const { a, name } = await signUp();
    const b = new Browser();
    const w = await waitFor(b, name);
    expect((await a.post(`/v1/account/approvals/${w.approvalId}`, { choice: w.number })).json()).toEqual({ outcome: 'approved' });
    setNow(new Date(now.getTime() + APPROVAL_TTL_MS));
    expect((await b.post(`/v1/login/approval/${w.approvalId}/poll`)).json()).toEqual({ status: 'expired' });
    expect((await b.me()).statusCode).toBe(401);
  });

  it('the new device can cancel', async () => {
    const { a, name } = await signUp();
    const b = new Browser();
    const w = await waitFor(b, name);
    expect((await b.post(`/v1/login/approval/${w.approvalId}/cancel`)).json()).toEqual({ ok: true });
    expect((await a.post(`/v1/account/approvals/${w.approvalId}`, { choice: w.number })).json()).toMatchObject({ error: 'approval-ended' });
  });
});

describe('binding to the new browser', () => {
  it('a poll from another browser, or without the approval cookie, is not-found and collects nothing', async () => {
    const { a, name } = await signUp();
    const b = new Browser();
    const w = await waitFor(b, name);
    expect((await a.post(`/v1/account/approvals/${w.approvalId}`, { choice: w.number })).json()).toEqual({ outcome: 'approved' });
    const url = `/v1/login/approval/${w.approvalId}/poll`;
    const thief = new Browser();
    thief.cookies[APPROVAL_COOKIE] = b.cookies[APPROVAL_COOKIE]!;
    expect((await thief.post(url)).json()).toEqual({ error: 'not-found' });
    const noSecret = new Browser();
    noSecret.cookies[DEVICE_COOKIE] = b.cookies[DEVICE_COOKIE]!;
    expect((await noSecret.post(url)).json()).toEqual({ error: 'not-found' });
    const wrongSecret = new Browser();
    wrongSecret.cookies[DEVICE_COOKIE] = b.cookies[DEVICE_COOKIE]!;
    wrongSecret.cookies[APPROVAL_COOKIE] = 'A'.repeat(43);
    expect((await wrongSecret.post(url)).json()).toEqual({ error: 'not-found' });
    expect((await new Browser().post('/v1/login/approval/not-a-uuid/poll')).json()).toEqual({ error: 'not-found' });
    // The real browser still collects it.
    expect((await b.post(url)).json()).toEqual({ status: 'ok', loggedOut: [] });
  });

  it('another account cannot see or decide an approval', async () => {
    const { name } = await signUp();
    const other = await signUp();
    const b = new Browser();
    const w = await waitFor(b, name);
    expect((await other.a.get('/v1/account/approvals')).json()).toEqual([]);
    expect((await other.a.get(`/v1/account/approvals/${w.approvalId}`)).statusCode).toBe(404);
    expect((await other.a.post(`/v1/account/approvals/${w.approvalId}`, { choice: w.number })).statusCode).toBe(404);
  });

  it('a second login from the same browser supersedes its first approval', async () => {
    const { a, name } = await signUp();
    const b = new Browser();
    const first = await waitFor(b, name);
    const second = await waitFor(b, name);
    expect((await a.post(`/v1/account/approvals/${first.approvalId}`, { choice: first.number })).json()).toMatchObject({ error: 'approval-ended' });
    expect((await a.get('/v1/account/approvals')).json()).toHaveLength(1);
    expect((await approveAndCollect(a, b, second)).json()).toMatchObject({ status: 'ok' });
  });
});

describe('limits on approvals', () => {
  it('at most 3 open per account: a 4th expires the oldest', async () => {
    const { a, name } = await signUp();
    const ws = [];
    for (let i = 0; i < 4; i++) {
      setNow(new Date(now.getTime() + 1000)); // each a second apart, so "oldest" is defined
      ws.push(await waitFor(new Browser(), name));
    }
    const open = ((await a.get('/v1/account/approvals')).json() as Array<{ id: string }>).map((v) => v.id);
    expect(open.sort()).toEqual(ws.slice(1).map((w) => w.approvalId).sort());
  });

  it(`at most ${APPROVALS_PER_HOUR} start per account per hour, then 429 slow-down`, async () => {
    const { name } = await signUp();
    for (let i = 0; i < APPROVALS_PER_HOUR; i++) await waitFor(new Browser(), name);
    const res = await new Browser().login(name);
    expect(res.statusCode).toBe(429);
    expect(res.json()).toMatchObject({ error: 'slow-down', reason: 'approvals' });
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });
});

describe('the 3-device limit', () => {
  it('a 4th device needs a session logged out; the approval names it and the poll ends it', async () => {
    const { a, name, accountId } = await signUp();
    const b = new Browser('Chrome on Windows');
    await approveAndCollect(a, b, await waitFor(b, name));
    const c = new Browser('Safari on iOS');
    await approveAndCollect(a, c, await waitFor(c, name));
    // A trusted browser at the limit needs approval too.
    await c.post('/v1/logout');
    expect((await c.login(name)).json()).toEqual({ status: 'ok' });
    const d = new Browser('Firefox on Android');
    const w = await waitFor(d, name);
    // Review M5: the waiting device is told nothing about the account's devices.
    expect(w).not.toHaveProperty('devices');
    expect((await a.get(`/v1/account/approvals/${w.approvalId}`)).json()).toMatchObject({ atLimit: true });
    const refused = await a.post(`/v1/account/approvals/${w.approvalId}`, { choice: w.number });
    expect(refused.statusCode).toBe(409);
    const { error, sessions } = refused.json() as { error: string; sessions: Array<{ id: string; deviceLabel: string; current: boolean }> };
    expect(error).toBe('too-many-devices');
    expect(sessions.map((s) => s.deviceLabel).sort()).toEqual(['Chrome on Windows', 'Firefox on Linux', 'Safari on iOS']);
    // Still open after the refusal.
    expect((await d.post(`/v1/login/approval/${w.approvalId}/poll`)).json()).toMatchObject({ status: 'waiting' });
    const victim = sessions.find((s) => s.deviceLabel === 'Safari on iOS')!;
    const poll = await approveAndCollect(a, d, w, { logOut: victim.id });
    expect(poll.json()).toEqual({ status: 'ok', loggedOut: ['Safari on iOS'] });
    expect((await c.me()).statusCode).toBe(401);
    expect((await d.me()).statusCode).toBe(200);
    expect(await alerts(accountId, 'logged-out-by-new-device')).toEqual([{ deviceLabels: ['Safari on iOS'], count: 1 }]);
  });

  it('two approvals racing for the last slot: the second must log a device out', async () => {
    const { a, name } = await signUp();
    const b = new Browser();
    await approveAndCollect(a, b, await waitFor(b, name));
    const w1 = await waitFor(new Browser(), name);
    const w2 = await waitFor(new Browser(), name);
    expect((await a.post(`/v1/account/approvals/${w1.approvalId}`, { choice: w1.number })).json()).toEqual({ outcome: 'approved' });
    expect((await a.post(`/v1/account/approvals/${w2.approvalId}`, { choice: w2.number })).json()).toMatchObject({ error: 'too-many-devices' });
  });

  it("the owner's max_devices setting changes the limit", async () => {
    await deps.db.query(`insert into owner_settings (key, value, updated_at) values ('max_devices', 1, now()) on conflict (key) do update set value = 1`);
    try {
      const { a, name } = await signUp();
      expect((await a.get('/v1/account/security/devices')).json()).toEqual({ oneDevice: false, maxDevices: 1 });
      const w = await waitFor(new Browser(), name);
      expect((await a.get(`/v1/account/approvals/${w.approvalId}`)).json()).toMatchObject({ atLimit: true });
      expect((await a.post(`/v1/account/approvals/${w.approvalId}`, { choice: w.number })).json()).toMatchObject({ error: 'too-many-devices' });
    } finally {
      await deps.db.query(`delete from owner_settings where key = 'max_devices'`);
    }
  });
});

describe('"One device at a time"', () => {
  async function turnOn(a: Browser, accountId: string, on = true) {
    const { rows } = await deps.db.query<{ id: string }>(`select id from sessions where account_id = $1 and revoked_at is null`, [accountId]);
    const token = await issueConfirmToken(deps, { sessionId: rows[0]!.id, accountId, action: { kind: 'set-one-device', on: on ? 'on' : 'off' }, method: 'password' });
    return a.send('PUT', '/v1/account/security/one-device', { on, confirmToken: token });
  }

  it('needs confirm-it\'s-you for exactly that change', async () => {
    const { a, accountId } = await signUp();
    expect((await a.send('PUT', '/v1/account/security/one-device', { on: true })).json()).toEqual({ error: 'confirm-required', action: 'set-one-device' });
    expect((await a.send('PUT', '/v1/account/security/one-device', { on: 'yes' })).statusCode).toBe(400);
    const { rows } = await deps.db.query<{ id: string }>(`select id from sessions where account_id = $1`, [accountId]);
    const offToken = await issueConfirmToken(deps, { sessionId: rows[0]!.id, accountId, action: { kind: 'set-one-device', on: 'off' }, method: 'password' });
    expect((await a.send('PUT', '/v1/account/security/one-device', { on: true, confirmToken: offToken })).json()).toEqual({ error: 'confirm-invalid' });
    expect((await turnOn(a, accountId)).json()).toEqual({ oneDevice: true, maxDevices: 3 });
    expect(await alerts(accountId, 'one-device-set')).toEqual([{ on: true }]);
  });

  it('approving a new device logs out every other device, the approver included', async () => {
    const { a, name, accountId } = await signUp();
    expect((await turnOn(a, accountId)).statusCode).toBe(200);
    const b = new Browser();
    const w = await waitFor(b, name);
    expect((await a.get(`/v1/account/approvals/${w.approvalId}`)).json()).toMatchObject({ oneDevice: true, atLimit: false });
    const poll = await approveAndCollect(a, b, w);
    expect(poll.json()).toEqual({ status: 'ok', loggedOut: ['Firefox on Linux'] });
    expect((await a.me()).json()).toEqual({ error: 'not-authenticated' });
    expect((await b.me()).statusCode).toBe(200);
    // Even the trusted first browser now needs approval to come back while b is logged in.
    expect((await a.login(name)).json()).toMatchObject({ status: 'approve-on-device' });
  });
});

describe('what the logged-in devices are sent', () => {
  it('a live event with the id only', async () => {
    const { name, accountId } = await signUp();
    const frames: string[] = [];
    const detach = app.events.attach(accountId, { send: (f) => void frames.push(f), close: () => undefined });
    try {
      const w = await waitFor(new Browser(), name);
      expect(frames).toEqual([`data: ${JSON.stringify({ type: 'login-approval', id: w.approvalId })}\n\n`]);
    } finally {
      detach?.();
    }
  });

  it('the push is the fixed sentence', async () => {
    const send = vi.spyOn(app.push, 'send');
    const { name, accountId } = await signUp();
    await waitFor(new Browser(), name);
    expect(send).toHaveBeenCalledWith(accountId, 'login');
  });
});

describe('the numbers and labels', () => {
  it('every number comes from crypto.randomInt through the seam (no patterns)', () => {
    const calls: Array<[number, number]> = [];
    const values = [47, 47, 12, 90, 0, 1];
    vi.spyOn(approvalRandom, 'int').mockImplementation((min, max) => {
      calls.push([min, max]);
      return values.shift()!;
    });
    const { number, choices } = drawNumbers();
    expect(number).toBe(47);
    expect(new Set(choices)).toEqual(new Set([47, 12, 90]));
    expect(calls.slice(0, 4)).toEqual([[10, 100], [10, 100], [10, 100], [10, 100]]);
    const src = readFileSync(new URL('../src/auth/approval.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/import \{[^}]*\brandomInt\b[^}]*\} from 'node:crypto'/);
    expect(src).not.toMatch(/Math\.random/);
  });

  it('the shuffled choices are spread over positions', () => {
    const at = [0, 0, 0];
    for (let i = 0; i < 600; i++) {
      const { number, choices } = drawNumbers();
      at[choices.indexOf(number)]!++;
    }
    for (const n of at) expect(n).toBeGreaterThan(120);
  });

  it('labels are coarse and never carry digits or free text', () => {
    expect(coarseDeviceLabel('Browser on Linux')).toBe('Browser on Linux');
    expect(coarseDeviceLabel('Chrome, Windows')).toBe('Chrome on Windows');
    expect(coarseDeviceLabel('Browser on ChromeOS')).toBe('Browser on ChromeOS');
    expect(coarseDeviceLabel('Firefox 128 on Linux - tap 47')).toBe('Firefox on Linux');
    expect(coarseDeviceLabel('tap 47')).toBe('A new device');
    expect(coarseDeviceLabel('')).toBe('A new device');
  });
});

describe('who it applies to', () => {
  it('a passkey login (completeLogin) waits too', async () => {
    const auth = createSoftAuthenticator({ backedUp: true, userVerified: true });
    const a = new Browser();
    const name = unique('pk');
    const start = await a.post('/v1/register/webauthn/start', { displayName: `D.${name}`, loginName: name, kind: 'passkey' });
    const { challengeId, options } = start.json();
    expect((await a.post('/v1/register/webauthn/finish', { challengeId, response: auth.register(options, ORIGIN), deviceLabel: 'Laptop', acceptedTerms: TERMS })).statusCode).toBe(201);
    const b = new Browser();
    const s = (await b.post('/v1/login/webauthn/start', {})).json();
    const res = await b.post('/v1/login/webauthn/finish', { challengeId: s.challengeId, response: auth.authenticate(s.options, ORIGIN), deviceLabel: 'Phone' });
    expect(res.json()).toMatchObject({ status: 'approve-on-device' });
    const { rows } = await deps.db.query<{ method: string }>('select method from login_approvals where id = $1', [(res.json() as Wait).approvalId]);
    expect(rows[0]!.method).toBe('passkey');
  });

  it('a staff login is unaffected: its second factor starts a session while another staff session is open', async () => {
    const id = await seedAccount(deps, { loginName: unique('staff'), kind: 'staff' });
    const a = new Browser();
    expect((await a.post('/t/session', { accountId: id })).statusCode).toBe(200);
    expect((await a.get('/v1/account/approvals')).json()).toEqual({ error: 'wrong-account-kind' });
    expect((await a.get('/v1/account/security/devices')).json()).toEqual({ error: 'wrong-account-kind' });
    const b = new Browser();
    const first = (await b.post('/t/complete', { accountId: id, factor: { method: 'pgp', fingerprint: 'A'.repeat(40), fingerprints: ['A'.repeat(40)] } })).json();
    expect(first).toMatchObject({ status: 'second-factor' });
    const second = await b.post('/t/complete', {
      accountId: id, pendingId: first.pendingId, factor: { method: 'passkey', credentialId: 'cred', attested: false },
    });
    expect(second.json()).toEqual({ status: 'ok' });
    expect((await b.me()).statusCode).toBe(200);
    const { rows } = await deps.db.query('select 1 from login_approvals where account_id = $1', [id]);
    expect(rows).toHaveLength(0);
  });
});

describe('team members (Plan 2 Task 18, at its landing: was NEEDS_TASKS_16_17_MEMBERS)', () => {
  /** A joined member of `teamId` (its login account seeded directly; the real sign-up is team.test.ts's). */
  async function memberOf(teamId: string): Promise<{ id: string; loginId: string }> {
    const name = unique('mem');
    const loginId = await seedAccount(deps, { loginName: name, displayName: `m-${name}-placeholder`, kind: 'member' });
    const { rows } = await deps.db.query<{ id: string }>(
      `insert into team_members (account_id, display_name, display_key, roles, invite_expires_at, member_account_id, joined_at, created_at)
       values ($1, $2, $3, '{offers,trades}', $4, $5, $4, $4) returning id`,
      [teamId, `M${name}`, `m${name}`.toLowerCase(), now, loginId],
    );
    return { id: rows[0]!.id, loginId };
  }
  const pgp = (c: string): LoginFactor => ({ method: 'pgp', fingerprint: c.repeat(40), fingerprints: [c.repeat(40)] });
  /** The member's two-factor login (`completeLogin`, the staff rule) in browser `b`: a PGP key, then `second`. */
  async function memberLogin(b: Browser, loginId: string, second: LoginFactor = pgp('B')): Promise<unknown> {
    const first = (await b.post('/t/complete', { accountId: loginId, factor: pgp('A') })).json() as { status: string; pendingId: string };
    expect(first.status).toBe('second-factor');
    return (await b.post('/t/complete', { accountId: loginId, pendingId: first.pendingId, factor: second })).json();
  }
  const memberSessions = async (memberId: string) =>
    (await deps.db.query<{ id: string; account_id: string; strength: string }>(
      'select id, account_id, strength from sessions where member_id = $1 and revoked_at is null order by created_at, id', [memberId],
    )).rows;
  const approvals = async (accountId: string) => (await deps.db.query('select 1 from login_approvals where account_id = $1', [accountId])).rowCount;

  it("a member's own login needs no approval: its two factors start a strong session of the team account on a new device", async () => {
    const { accountId } = await signUp();
    for (const second of [pgp('B'), { method: 'passkey', credentialId: 'cred', attested: false } as LoginFactor]) {
      const m = await memberOf(accountId);
      const b = new Browser();
      expect(await memberLogin(b, m.loginId, second)).toEqual({ status: 'ok' });
      expect((await b.me()).statusCode).toBe(200);
      // Members always log in with two factors (any pair `pairAllowed` lets in, two PGP keys
      // included), so their logins are strong for Task 17.
      expect(await memberSessions(m.id)).toEqual([expect.objectContaining({ account_id: accountId, strength: 'strong' })]);
      expect(await approvals(m.loginId)).toBe(0);
    }
    expect(await approvals(accountId)).toBe(0);
  });

  it("member sessions count toward the account's device limit; the approval may log one out", async () => {
    const { a, name, accountId } = await signUp();
    const m1 = await memberOf(accountId);
    const m2 = await memberOf(accountId);
    const b1 = new Browser();
    const b2 = new Browser();
    expect(await memberLogin(b1, m1.loginId)).toEqual({ status: 'ok' });
    expect(await memberLogin(b2, m2.loginId)).toEqual({ status: 'ok' });
    // The owner's one device plus two members' make three: a new device of the owner's is the fourth.
    const d = new Browser('Chrome on Windows');
    const w = await waitFor(d, name);
    expect((await a.get(`/v1/account/approvals/${w.approvalId}`)).json()).toMatchObject({ atLimit: true });
    const refused = await a.post(`/v1/account/approvals/${w.approvalId}`, { choice: w.number });
    expect(refused.statusCode).toBe(409);
    const { error, sessions } = refused.json() as { error: string; sessions: Array<{ id: string; deviceLabel: string }> };
    expect(error).toBe('too-many-devices');
    const [s1] = await memberSessions(m1.id);
    const [s2] = await memberSessions(m2.id);
    expect(sessions).toHaveLength(3);
    expect(sessions.map((s) => s.id)).toEqual(expect.arrayContaining([s1!.id, s2!.id]));
    expect(sessions.map((s) => s.deviceLabel).sort()).toEqual(['Desk', 'Desk', 'Firefox on Linux']);
    const poll = await approveAndCollect(a, d, w, { logOut: s1!.id });
    expect(poll.json()).toEqual({ status: 'ok', loggedOut: ['Desk'] });
    expect((await b1.me()).statusCode).toBe(401);
    expect((await b2.me()).statusCode).toBe(200);
    expect((await d.me()).statusCode).toBe(200);
  });

  it("member sessions never approve logins: the approval routes are the account owner's, and a member's browser is no logged-in device of the owner's", async () => {
    const { a, name, accountId } = await signUp();
    const m = await memberOf(accountId);
    const mb = new Browser();
    expect(await memberLogin(mb, m.loginId)).toEqual({ status: 'ok' });
    const d = new Browser('Chrome on Windows');
    const w = await waitFor(d, name);
    expect((await mb.get('/v1/account/approvals')).json()).toEqual({ error: 'owner-only' });
    expect((await mb.get(`/v1/account/approvals/${w.approvalId}`)).json()).toEqual({ error: 'owner-only' });
    const tried = await mb.post(`/v1/account/approvals/${w.approvalId}`, { choice: w.number });
    expect(tried.json()).toEqual({ error: 'owner-only' });
    expect((await d.post(`/v1/login/approval/${w.approvalId}/poll`)).json()).toMatchObject({ status: 'waiting' });
    // The owner's credentials typed into the member's browser: that browser's member session does
    // not make it the owner's logged-in device, so the login waits for the owner's approval.
    expect((await waitFor(mb, name)).status).toBe('approve-on-device');
    expect((await a.me()).statusCode).toBe(200);
  });

  it("with only members logged in, the owner's login waits for no approval (no session could give it)", async () => {
    const { a, name, accountId } = await signUp();
    await a.post('/v1/logout');
    const m = await memberOf(accountId);
    expect(await memberLogin(new Browser(), m.loginId)).toEqual({ status: 'ok' });
    // Hold model v3: a password on a new device with no owner device to approve it is refused; on the owner's trusted browser it gets in.
    const d = new Browser('Chrome on Windows');
    expect((await d.login(name)).json()).toEqual({ error: 'approval-unavailable' });
    expect((await a.login(name)).json()).toEqual({ status: 'ok' });
    expect(await approvals(accountId)).toBe(0);
  });

  it("hold model v3: a recovery-code login logs the team's members out too; during the hold no member logs in (403 recovery-hold); after it they do", async () => {
    const { a, name, accountId } = await signUp();
    // Inside the sign-up window the code needs no confirm token.
    const code = ((await a.post('/v1/account/recovery-codes', {})).json() as { codes: string[] }).codes[0]!;
    const m = await memberOf(accountId);
    const mb = new Browser();
    expect(await memberLogin(mb, m.loginId)).toEqual({ status: 'ok' });
    expect(await memberSessions(m.id)).toHaveLength(1);
    const rec = await new Browser('Tor Browser').post('/v1/login/backup', { loginName: name, kind: 'recovery-code', code, deviceLabel: 'Tor Browser' });
    expect(rec.json()).toMatchObject({ status: 'ok', level: 'recovery' });
    const until = (rec.json() as { holdUntil: string }).holdUntil;
    expect(await memberSessions(m.id)).toEqual([]);
    expect((await mb.me()).statusCode).toBe(401);
    // A member's login during the hold: refused, no session opens, on the member's own browser too.
    expect(await memberLogin(mb, m.loginId)).toEqual({ error: 'recovery-hold', holdUntil: until });
    expect(await memberSessions(m.id)).toEqual([]);
    setNow(new Date(new Date(until).getTime() + 1000));
    expect(await memberLogin(mb, m.loginId)).toEqual({ status: 'ok' });
    expect(await memberSessions(m.id)).toHaveLength(1);
  });
});

describe('one gate', () => {
  // login.ts keeps one: the staff and owner two-factor finish, which Task 16 leaves alone.
  it("every later full login goes through traderLogin: no other source file starts a full session with firstSession false", () => {
    const root = new URL('../src/', import.meta.url).pathname;
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = `${d}${f}`;
        if (statSync(p).isDirectory()) walk(`${p}/`);
        else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk(root);
    const offenders = files.filter((f) => !f.endsWith('auth/approval.ts') && !f.endsWith('auth/login.ts')).filter((f) => {
      const src = readFileSync(f, 'utf8');
      return /startSession\([^;]*level: 'full'[^;]*firstSession: false/s.test(src);
    });
    expect(offenders).toEqual([]);
    // login.ts: its one full session comes after the trader branch has returned.
    const login = readFileSync(`${root}auth/login.ts`, 'utf8');
    expect(login.indexOf('return traderLogin(')).toBeGreaterThan(0);
    expect(login.indexOf('return traderLogin(')).toBeLessThan(login.indexOf('await startSession('));
  });
});
