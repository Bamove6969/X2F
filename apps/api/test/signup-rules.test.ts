// Sign-up login rules (owner 1 Nov 2026, register rows S-012, S-013, S-014; lead job J-09):
// - S-012: a username with an authenticator code alone is no account and no login;
// - S-013: a username alone is no account;
// - S-014: only a strong password is accepted (10+ characters with upper and lower case, a number
//   and a symbol, and not on the leaked list), at sign-up and at a password change.
// These pin the server's side; the live meter is the web's (apps/web/test/signupRules.test.tsx).
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Secret } from 'otpauth';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { SESSION_COOKIE } from '../src/auth/sessions.js';
import { sealSecret } from '../src/auth/totp.js';
import { seedAccount } from './helpers/accounts.js';
import { testApp } from './helpers/app.js';
import { SIG } from './helpers/signature.js';
import { fixtureLeakedList } from './helpers/leaked.js';
import { Browser, addTestLogin, codeAt } from './helpers/totp.js';

const T0 = new Date('2026-11-09T06:00:00Z');
const HOUR = 3600_000;
const TERMS = '2026-10-17';
const GOOD = 'Correct-Horse-9';

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let cleanup: () => Promise<void>;
let now = T0;
let step = 0;
let n = 0;

beforeAll(async () => {
  const fixture = await fixtureLeakedList();
  cleanup = fixture.cleanup;
  let set: (d: Date) => void;
  ({ app, deps, setNow: set } = await testApp({ leaked: fixture.list }));
  setNow = (d) => {
    now = d;
    set(d);
  };
  addTestLogin(app, deps);
});

afterAll(async () => {
  await app.close();
  await cleanup();
});

beforeEach(() => {
  // Each test starts an hour later: request budgets refill.
  setNow(new Date(T0.getTime() + ++step * HOUR));
});

const name = (p = 'rule') => `${p}${process.pid % 1000}x${++n}`;
const names = () => {
  const loginName = name('priv');
  return { loginName, displayName: name('Shown') };
};

async function accountCount(): Promise<number> {
  const { rows } = await deps.db.query<{ n: number }>('select count(*)::int as n from accounts');
  return rows[0]!.n;
}

/** Enrols TOTP directly with a known secret; returns it as base32. */
async function withTotp(accountId: string): Promise<string> {
  const raw = randomBytes(20);
  await deps.db.query('insert into totp (account_id, secret_enc, created_at) values ($1, $2, $3)', [
    accountId, sealSecret(deps, accountId, new Uint8Array(raw)), now,
  ]);
  return new Secret({ buffer: new Uint8Array(raw).buffer }).base32;
}

describe('S-013: a username alone is no account', () => {
  it('every sign-up route refuses the names without a login method, and no account is made', async () => {
    const before = await accountCount();
    const b = new Browser(app);
    const base = { ...names(), deviceLabel: 'Test browser', acceptedTerms: TERMS, termsSignature: SIG };
    // Password sign-up without a password, or with an empty one.
    expect((await b.post('/v1/register/password', base)).statusCode).toBe(400);
    const empty = await b.post('/v1/register/password', { ...base, password: '' });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error).toBe('password-weak');
    // PGP sign-up without a key, or with an empty one.
    expect((await b.post('/v1/register/pgp/start', base)).statusCode).toBe(400);
    expect((await b.post('/v1/register/pgp/start', { ...base, publicKey: '' })).statusCode).toBe(400);
    // Passkey / security key: a finish with no proven credential makes nothing.
    const finish = await b.post('/v1/register/webauthn/finish', { ...base, challengeId: '00000000-0000-0000-0000-000000000000' });
    expect(finish.statusCode).toBeGreaterThanOrEqual(400);
    expect(finish.statusCode).toBeLessThan(500);
    // There is no names-only sign-up route.
    for (const url of ['/v1/register', '/v1/register/name', '/v1/register/username']) {
      expect((await b.post(url, base)).statusCode, url).toBe(404);
    }
    expect(await accountCount()).toBe(before);
  });
});

describe('S-012: a username with an authenticator code alone is no account and no login', () => {
  it('there is no sign-up with an authenticator code, and the password route does not take one in place of a password', async () => {
    const before = await accountCount();
    const b = new Browser(app);
    const base = { ...names(), deviceLabel: 'Test browser', acceptedTerms: TERMS, termsSignature: SIG };
    for (const url of ['/v1/register/totp', '/v1/register/totp/start', '/v1/register/totp/finish', '/v1/register/authenticator']) {
      expect((await b.post(url, { ...base, code: '123456' })).statusCode, url).toBe(404);
    }
    expect((await b.post('/v1/register/password', { ...base, totp: '123456' })).statusCode).toBe(400);
    expect(await accountCount()).toBe(before);
  });

  it('an authenticator app is added only from a signed-in session (never as the first login method)', async () => {
    const b = new Browser(app);
    expect((await b.post('/v1/account/totp/start', {})).statusCode).toBe(401);
    expect((await b.post('/v1/account/totp/finish', { code: '123456' })).statusCode).toBe(401);
  });

  it('a username with a correct authenticator code logs in nowhere: no backup login, no second factor without a password', async () => {
    const loginName = name('totp');
    const id = await seedAccount(deps, { loginName });
    const secret = await withTotp(id);
    const code = codeAt(secret, now);
    const b = new Browser(app);
    const backup = await b.post('/v1/login/backup', { loginName, kind: 'totp', code, deviceLabel: 'Test browser' });
    // Hold model v3 (owner Q81, 2 Nov): an authenticator code is no backup login at all: 403 method-not-allowed (was a 400 input refusal).
    expect(backup.statusCode).toBe(403);
    expect(backup.json()).toMatchObject({ error: 'method-not-allowed' });
    // The second-factor step finishes only a password login this browser started.
    const second = await b.post('/v1/login/second-factor', { pendingId: '00000000-0000-0000-0000-000000000000', code });
    expect(second.statusCode).toBe(400);
    expect(second.json()).toEqual({ error: 'challenge-expired' });
    expect(Object.keys(b.cookies)).not.toContain(SESSION_COOKIE);
    const { rows } = await deps.db.query('select 1 from sessions where account_id = $1', [id]);
    expect(rows).toEqual([]);
  });
  // A password + authenticator account cannot drop the password and keep only the app: methods.test.ts
  // ("a trader whose only primary method is a password keeps it; TOTP and recovery codes can go").
});

describe('S-014: only a strong password is accepted', () => {
  const missing: Array<[string, string]> = [
    ['Short-1a', 'length'],
    ['correct-horse-9', 'upper'],
    ['CORRECT-HORSE-9', 'lower'],
    ['Correct-Horse-x', 'number'],
    ['CorrectHorse99', 'symbol'],
  ];

  it('sign-up refuses a password that misses any one rule, and names the rule', async () => {
    const before = await accountCount();
    for (const [password, rule] of missing) {
      const res = await new Browser(app).post('/v1/register/password', { ...names(), password, deviceLabel: 'Test browser', acceptedTerms: TERMS, termsSignature: SIG });
      expect(res.statusCode, password).toBe(400);
      expect(res.json(), password).toEqual({ error: 'password-weak', missing: [rule] });
    }
    const leaked = await new Browser(app).post('/v1/register/password', { ...names(), password: 'Password123!', deviceLabel: 'Test browser', acceptedTerms: TERMS, termsSignature: SIG });
    expect(leaked.json()).toEqual({ error: 'password-leaked' });
    expect(await accountCount()).toBe(before);
    const ok = await new Browser(app).post('/v1/register/password', { ...names(), password: GOOD, deviceLabel: 'Test browser', acceptedTerms: TERMS, termsSignature: SIG });
    expect(ok.statusCode).toBe(201);
  });

  it('a password change refuses the same weak and leaked passwords', async () => {
    const id = await seedAccount(deps, { loginName: name('chg') });
    const b = new Browser(app);
    expect((await b.post('/t/login', { accountId: id, firstSession: true })).statusCode).toBe(200);
    for (const [password, rule] of missing) {
      const res = await b.put('/v1/account/password', { password });
      expect(res.statusCode, password).toBe(400);
      expect(res.json(), password).toEqual({ error: 'password-weak', missing: [rule] });
    }
    expect((await b.put('/v1/account/password', { password: 'Password123!' })).json()).toEqual({ error: 'password-leaked' });
    const { rows } = await deps.db.query('select 1 from passwords where account_id = $1', [id]);
    expect(rows).toEqual([]);
  });
});
