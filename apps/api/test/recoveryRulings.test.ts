// Owner rulings of 9 Nov 2026 on the recovery code (owner-answers page 11):
// - S-109 (p11-34): "a correct recovery code always gets in", even when logins are throttled. A
//   wrong code is still throttled (429 while it waits); since review L1 (12 Nov) a wrong code that
//   arrives while throttled is counted too, so the streak and its lock alert follow a real attack.
// (S-110 and S-111, the password change with the recovery code, went with passwords, owner 26 Nov 2026.)
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AddressValidator, Deps } from '../src/app.js';
import { accountIdByLoginName } from './helpers/accounts.js';
import { signUpWithKey } from './helpers/signup.js';
import { tradeApp } from './helpers/tradeApp.js';
import { Browser } from './helpers/totp.js';

const TERMS = '2026-10-17';
const WRONG_CODE = 'ABCD-EFGH-JKMN-PQRT';
const HOUR = 3600_000;
const T0 = new Date('2026-11-12T12:00:00Z');

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let now = T0;
let step = 0;
let cleanup: () => Promise<void>;

const fakeValidator: AddressValidator = { check: async (a) => (/^5[1-9A-HJ-NP-Za-km-z]{94}$/.test(a) ? 'ok' : 'invalid') };
beforeAll(async () => {
  cleanup = async () => {};
  let set: (d: Date) => void;
  ({ app, deps, setNow: set } = await tradeApp({}, { addresses: fakeValidator }));
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
const unique = (p: string) => `${p}${String(++seq).padStart(4, '0')}r`;
const errorOf = (r: LightMyRequestResponse) => (r.json() as { error?: string }).error;

const onboarding = (accountId: string, until: Date | null) =>
  deps.db.query('update sessions set onboarding_until = $2 where account_id = $1', [accountId, until]);

/** A key trader with the recovery code (made inside the sign-up window); the window is then over. */
async function ownerWithCode() {
  const b = new Browser(app);
  const name = unique('recov');
  const { res } = await signUpWithKey(b, { displayName: `P${name}`, loginName: name, deviceLabel: 'Laptop', acceptedTerms: TERMS });
  expect(res.statusCode, res.body).toBe(201);
  const id = (await accountIdByLoginName(deps, name))!;
  const codes = (await b.post('/v1/account/recovery-codes', {})).json() as { codes: string[] };
  await onboarding(id, null);
  return { b, name, id, code: codes.codes[0]! };
}

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
    expect(res.json()).toMatchObject({ status: 'ok' });
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
    expect(res.json()).toMatchObject({ status: 'ok' });
  });

  it('a wrong code while throttled is still refused with the wait, and is counted (review L1)', async () => {
    const t = await ownerWithCode();
    const b = new Browser(app);
    for (let i = 0; i < 4; i++) expect((await backupLogin(b, t.name, WRONG_CODE)).statusCode).toBe(401);
    expect((await throttleRows(t.id)).map((r) => r.failures)).toEqual([4]);
    for (let i = 0; i < 3; i++) {
      const r = await backupLogin(b, t.name, WRONG_CODE);
      expect(r.statusCode).toBe(429);
      expect(r.json()).toMatchObject({ error: 'slow-down', retryAfterSeconds: expect.any(Number) });
    }
    // Review L1: the throttled misses count, so the streak stays live and reaches the lock.
    expect((await throttleRows(t.id)).map((r) => r.failures)).toEqual([7]);
    // The code is still unused, and still gets in.
    expect(await unusedCodes(t.id)).toBe(1);
    expect((await backupLogin(b, t.name, t.code)).statusCode).toBe(200);
  });

  it('throttled misses reach the lock and its one login-locked alert (review L1)', async () => {
    const t = await ownerWithCode();
    const b = new Browser(app);
    // Four counted misses, then six more refused with the wait: ten in the streak, no clock moved.
    for (let i = 0; i < 4; i++) expect((await backupLogin(b, t.name, WRONG_CODE)).statusCode).toBe(401);
    for (let i = 0; i < 6; i++) expect((await backupLogin(b, t.name, WRONG_CODE)).statusCode).toBe(429);
    expect((await throttleRows(t.id)).map((r) => r.failures)).toEqual([10]);
    const { rows } = await deps.db.query("select detail from alerts where account_id = $1 and kind = 'login-locked'", [t.id]);
    expect(rows).toEqual([{ detail: { method: 'recovery-code' } }]);
  });

  it('an unknown login name while throttled answers 429 as before (nothing to get in to)', async () => {
    const b = new Browser(app);
    const ghost = unique('ghostname');
    for (let i = 0; i < 4; i++) expect((await backupLogin(b, ghost, WRONG_CODE)).statusCode).toBe(401);
    expect((await backupLogin(b, ghost, WRONG_CODE)).statusCode).toBe(429);
  });
});
