// Owner rulings of 9 Nov 2026 on the recovery code (owner-answers page 11):
// - S-109 (p11-34): "a correct recovery code always gets in", even when logins are throttled. A
//   wrong code is still throttled exactly as before (429 and no failure counted while it waits).
// - S-110 (p11-35): a password change with the current password (the confirm token), the new
//   password and the recovery code goes through at once, with no 24-hour hold, for a session whose
//   changes would otherwise wait.
// - S-111 (p11-36): after a code is used the person is told it is burned (`recoveryCodeBurned`).
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { issueConfirmToken } from '../src/auth/confirm.js';
import { verifyPassword } from '../src/auth/password.js';
import { SIG } from './helpers/signature.js';
import { accountIdByLoginName } from './helpers/accounts.js';
import { fixtureLeakedList } from './helpers/leaked.js';
import { tradeApp } from './helpers/tradeApp.js';
import { Browser } from './helpers/totp.js';

const TERMS = '2026-10-17';
const GOOD = 'Correct-Horse-9';
const NEW_PASSWORD = 'Another-Horse-8';
const WRONG_CODE = 'ABCD-EFGH-JKMN-PQRT';
const HOUR = 3600_000;
const T0 = new Date('2026-11-12T12:00:00Z');

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
  ({ app, deps, setNow: set } = await tradeApp({}, { leaked: fixture.list }));
  setNow = (d) => {
    now = d;
    set(d);
  };
});

afterAll(async () => {
  await app.close();
  await cleanup();
});

beforeEach(() => {
  setNow(new Date(T0.getTime() + ++step * 72 * HOUR));
});

let seq = 0;
const unique = (p: string) => `${p}${++seq}r`;
const errorOf = (r: LightMyRequestResponse) => (r.json() as { error?: string }).error;

const onboarding = (accountId: string, until: Date | null) =>
  deps.db.query('update sessions set onboarding_until = $2 where account_id = $1', [accountId, until]);

/** A password trader with the recovery code (made inside the sign-up window); the window is then over, so its changes wait. */
async function ownerWithCode() {
  const b = new Browser(app);
  const name = unique('recov');
  const res = await b.post('/v1/register/password', { displayName: `P${name}`, loginName: name, password: GOOD, deviceLabel: 'Laptop', acceptedTerms: TERMS, termsSignature: SIG });
  expect(res.statusCode).toBe(201);
  const id = (await accountIdByLoginName(deps, name))!;
  const codes = (await b.post('/v1/account/recovery-codes', {})).json() as { codes: string[] };
  await onboarding(id, null);
  return { b, name, id, code: codes.codes[0]! };
}

async function sessionOf(b: Browser): Promise<string> {
  const res = await b.get('/v1/account/sessions');
  expect(res.statusCode).toBe(200);
  return (res.json() as Array<{ id: string; current: boolean }>).find((s) => s.current)!.id;
}

const tokenFor = async (b: Browser, accountId: string) =>
  issueConfirmToken(deps, { sessionId: await sessionOf(b), accountId, action: { kind: 'set-password' }, method: 'password' });

const backupLogin = (b: Browser, name: string, code: string) =>
  b.post('/v1/login/backup', { loginName: name, kind: 'recovery-code', code, deviceLabel: 'Tor Browser' });

async function throttleRows(accountId: string): Promise<Array<{ key: string; failures: number }>> {
  const { rows } = await deps.db.query<{ key: string; failures: number }>(
    "select key, failures from login_throttle where key like 'recovery-code:' || $1 || ':%' order by key",
    [accountId],
  );
  return rows;
}

const unusedCodes = async (accountId: string) =>
  (await deps.db.query<{ n: number }>('select count(*)::int as n from recovery_codes where account_id = $1 and used_at is null', [accountId])).rows[0]!.n;

const passwordMatches = async (accountId: string, password: string) => {
  const { rows } = await deps.db.query<{ hash: string; pepper_id: number }>('select hash, pepper_id from passwords where account_id = $1', [accountId]);
  return verifyPassword(deps.config, { hash: rows[0]!.hash, pepperId: rows[0]!.pepper_id }, password);
};

const draftsOf = async (accountId: string) =>
  (await deps.db.query<{ n: number }>('select count(*)::int as n from hold_changes where account_id = $1', [accountId])).rows[0]!.n;

describe('S-109: a correct recovery code always gets in, even when logins are throttled', () => {
  it('after enough wrong codes to slow down (429 slow-down), the correct code logs in at once and the streak is cleared', async () => {
    const t = await ownerWithCode();
    const b = new Browser(app);
    for (let i = 0; i < 4; i++) expect((await backupLogin(b, t.name, WRONG_CODE)).statusCode).toBe(401);
    // The next wrong code waits ...
    const slowed = await backupLogin(b, t.name, WRONG_CODE);
    expect(slowed.statusCode).toBe(429);
    expect(errorOf(slowed)).toBe('slow-down');
    // ... but the right one does not.
    const res = await backupLogin(b, t.name, t.code);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', level: 'recovery' });
    expect(await throttleRows(t.id)).toEqual([]);
  });

  it('after the lock (10 wrong codes, 429 locked), the correct code still logs in', async () => {
    const t = await ownerWithCode();
    const b = new Browser(app);
    // Ten failures in a streak; each waits out the wait before it so it counts.
    for (let i = 0; i < 10; i++) {
      setNow(new Date(now.getTime() + 31_000));
      expect((await backupLogin(b, t.name, WRONG_CODE)).statusCode).toBe(401);
    }
    const locked = await backupLogin(b, t.name, WRONG_CODE);
    expect(locked.statusCode).toBe(429);
    expect(errorOf(locked)).toBe('locked');
    const res = await backupLogin(b, t.name, t.code);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', level: 'recovery' });
  });

  it('a wrong code while throttled is still refused with the wait and adds no failure', async () => {
    const t = await ownerWithCode();
    const b = new Browser(app);
    for (let i = 0; i < 4; i++) expect((await backupLogin(b, t.name, WRONG_CODE)).statusCode).toBe(401);
    const before = await throttleRows(t.id);
    expect(before.map((r) => r.failures)).toEqual([4]);
    for (let i = 0; i < 3; i++) {
      const r = await backupLogin(b, t.name, WRONG_CODE);
      expect(r.statusCode).toBe(429);
      expect(r.json()).toMatchObject({ error: 'slow-down', retryAfterSeconds: expect.any(Number) });
    }
    expect(await throttleRows(t.id)).toEqual(before);
    // The code is still unused.
    expect(await unusedCodes(t.id)).toBe(1);
  });

  it('an unknown login name while throttled answers 429 as before (nothing to get in to)', async () => {
    const b = new Browser(app);
    const ghost = unique('ghostname');
    for (let i = 0; i < 4; i++) expect((await backupLogin(b, ghost, WRONG_CODE)).statusCode).toBe(401);
    expect((await backupLogin(b, ghost, WRONG_CODE)).statusCode).toBe(429);
  });
});

describe('S-110: password change with the current password, the new password and the recovery code applies at once', () => {
  it('without the code a username + password session\'s change still waits (202 staged)', async () => {
    const t = await ownerWithCode();
    const r = await t.b.put('/v1/account/password', { password: NEW_PASSWORD, confirmToken: await tokenFor(t.b, t.id) });
    expect(r.statusCode).toBe(202);
    expect(await passwordMatches(t.id, GOOD)).toBe(true);
  });

  it('with the correct code: applied now (200), nothing staged, the code spent and replaced, other sessions ended, the person told the code is burned', async () => {
    const t = await ownerWithCode();
    // A thief logged in elsewhere with the same password.
    const thief = new Browser(app);
    const w = (await thief.post('/v1/login/password', { loginName: t.name, password: GOOD, deviceLabel: 'Thief' })).json() as { approvalId: string; number: number };
    expect((await t.b.post(`/v1/account/approvals/${w.approvalId}`, { choice: w.number })).json()).toEqual({ outcome: 'approved' });
    expect((await thief.post(`/v1/login/approval/${w.approvalId}/poll`)).json()).toMatchObject({ status: 'ok' });
    const { rows: old } = await deps.db.query<{ id: string }>('select id from recovery_codes where account_id = $1', [t.id]);

    const r = await t.b.put('/v1/account/password', { password: NEW_PASSWORD, confirmToken: await tokenFor(t.b, t.id), recoveryCode: t.code.toLowerCase() });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true, recoveryCodeBurned: true });
    expect(await passwordMatches(t.id, NEW_PASSWORD)).toBe(true);
    expect(await draftsOf(t.id)).toBe(0);
    // The thief is logged out; the owner's session goes on.
    expect((await thief.get('/v1/account/me')).statusCode).toBe(401);
    expect((await t.b.get('/v1/account/me')).statusCode).toBe(200);
    // The used code no longer works; a new one replaced it (hold model v3, one code).
    const { rows: now1 } = await deps.db.query<{ id: string }>('select id from recovery_codes where account_id = $1 and used_at is null', [t.id]);
    expect(now1).toHaveLength(1);
    expect(now1[0]!.id).not.toBe(old[0]!.id);
    expect((await backupLogin(new Browser(app), t.name, t.code)).statusCode).toBe(401);
    // No account hold was started.
    expect((await deps.db.query('select 1 from account_holds where account_id = $1', [t.id])).rows).toHaveLength(0);
  });

  it('a wrong code: 401 credentials-invalid, nothing changes or is staged, the failure counts on the recovery-code key, and the confirm token is not used up', async () => {
    const t = await ownerWithCode();
    const token = await tokenFor(t.b, t.id);
    const r = await t.b.put('/v1/account/password', { password: NEW_PASSWORD, confirmToken: token, recoveryCode: WRONG_CODE });
    expect(r.statusCode).toBe(401);
    expect(errorOf(r)).toBe('credentials-invalid');
    expect(await passwordMatches(t.id, GOOD)).toBe(true);
    expect(await draftsOf(t.id)).toBe(0);
    expect((await throttleRows(t.id)).map((x) => x.failures)).toEqual([1]);
    expect(await unusedCodes(t.id)).toBe(1);
    // The same token still works with the right code.
    const ok = await t.b.put('/v1/account/password', { password: NEW_PASSWORD, confirmToken: token, recoveryCode: t.code });
    expect(ok.statusCode).toBe(200);
  });

  it('a correct code gets through a throttled recovery-code key (S-109) here too', async () => {
    const t = await ownerWithCode();
    for (let i = 0; i < 4; i++) {
      expect((await t.b.put('/v1/account/password', { password: NEW_PASSWORD, confirmToken: await tokenFor(t.b, t.id), recoveryCode: WRONG_CODE })).statusCode).toBe(401);
    }
    const slowed = await t.b.put('/v1/account/password', { password: NEW_PASSWORD, confirmToken: await tokenFor(t.b, t.id), recoveryCode: WRONG_CODE });
    expect(slowed.statusCode).toBe(429);
    const r = await t.b.put('/v1/account/password', { password: NEW_PASSWORD, confirmToken: await tokenFor(t.b, t.id), recoveryCode: t.code });
    expect(r.statusCode).toBe(200);
    expect(await passwordMatches(t.id, NEW_PASSWORD)).toBe(true);
  });

  it('the code still needs the current password: without a confirm token the change is refused and the code stays unused', async () => {
    const t = await ownerWithCode();
    const r = await t.b.put('/v1/account/password', { password: NEW_PASSWORD, recoveryCode: t.code });
    expect(r.statusCode).toBe(403);
    expect(errorOf(r)).toBe('confirm-required');
    expect(await unusedCodes(t.id)).toBe(1);
    expect(await passwordMatches(t.id, GOOD)).toBe(true);
  });

  it('a recoveryCode that is not a string is 400 bad-request', async () => {
    const t = await ownerWithCode();
    const r = await t.b.put('/v1/account/password', { password: NEW_PASSWORD, confirmToken: await tokenFor(t.b, t.id), recoveryCode: 12 });
    expect(r.statusCode).toBe(400);
    expect(await unusedCodes(t.id)).toBe(1);
  });

  it('never lifts a running account hold: 403 recovery-hold and the code stays unused', async () => {
    const t = await ownerWithCode();
    await deps.db.query(
      `insert into account_holds (account_id, started_at, hold_until, reason, started_methods) values ($1, $2, $3, 'recovery-code', '{}')`,
      [t.id, now, new Date(now.getTime() + 24 * HOUR)],
    );
    const r = await t.b.put('/v1/account/password', { password: NEW_PASSWORD, confirmToken: await tokenFor(t.b, t.id), recoveryCode: t.code });
    expect(r.statusCode).toBe(403);
    expect(errorOf(r)).toBe('recovery-hold');
    expect(await unusedCodes(t.id)).toBe(1);
  });

  it('a strong session that gives a code: applied as before, and the code is spent too', async () => {
    const t = await ownerWithCode();
    await deps.db.query("update sessions set strength = 'strong' where account_id = $1", [t.id]);
    const r = await t.b.put('/v1/account/password', { password: NEW_PASSWORD, confirmToken: await tokenFor(t.b, t.id), recoveryCode: t.code });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true, recoveryCodeBurned: true });
    expect((await backupLogin(new Browser(app), t.name, t.code)).statusCode).toBe(401);
  });
});
