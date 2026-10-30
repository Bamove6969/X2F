import { createHmac, randomBytes } from 'node:crypto';
import { normalizePassword } from '@x2f/accounts';
import argon2 from 'argon2';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deps } from '../src/app.js';
import { loginNameLookup } from '../src/accounts.js';
import { issueConfirmToken, requireConfirm } from '../src/auth/confirm.js';
import { DEVICE_COOKIE } from '../src/auth/device.js';
import { DUMMY_HASH, hashPassword, pepperedPassword } from '../src/auth/password.js';
import { SESSION_COOKIE, requireSession } from '../src/auth/sessions.js';
import { ARGON2_SLOTS, Semaphore } from '../src/limits.js';
import { accountIdByLoginName, seedAccount } from './helpers/accounts.js';
import { testApp } from './helpers/app.js';
import { fixtureLeakedList } from './helpers/leaked.js';
import { spySql } from './helpers/sqlSpy.js';

const ORIGIN = 'https://x2f.test';
const T0 = new Date('2026-10-17T12:00:00Z');
const HOUR = 3600_000;
const TERMS = '2026-10-17';
const GOOD = 'Correct-Horse-9';

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let logs: string[];
let cleanup: () => Promise<void>;
let now = T0;
let step = 0;

beforeAll(async () => {
  const fixture = await fixtureLeakedList();
  cleanup = fixture.cleanup;
  let set: (d: Date) => void;
  ({ app, deps, setNow: set, logs } = await testApp({ leaked: fixture.list }));
  setNow = (d) => {
    now = d;
    set(d);
  };
  app.post('/t/set-password', { preHandler: [requireSession(), requireConfirm({ kind: 'set-password' })] }, async () => ({ ok: true }));
  app.post(
    '/t/add-method',
    { preHandler: [requireSession(), requireConfirm({ kind: 'add-method', method: 'passkey' })] },
    async () => ({ ok: true }),
  );
});

afterAll(async () => {
  await app.close();
  await cleanup();
});

beforeEach(() => {
  // Each test starts an hour later: request budgets refill and throttle streaks end.
  setNow(new Date(T0.getTime() + ++step * HOUR));
  vi.restoreAllMocks();
});

const cookie = (res: LightMyRequestResponse, name: string) => res.cookies.find((c) => c.name === name)?.value;

function post(url: string, payload: unknown, cookies: Record<string, string> = {}) {
  return app.inject({ method: 'POST', url, headers: { origin: ORIGIN }, cookies, payload: payload as Record<string, unknown> });
}

/** Registers login name `loginName` with display name `P` + it (or `o.displayName`). */
const register = (
  loginName: string,
  password = GOOD,
  extra: Record<string, unknown> = { acceptedTerms: TERMS },
  o: { displayName?: string; cookies?: Record<string, string> } = {},
) =>
  post(
    '/v1/register/password',
    { displayName: o.displayName ?? `P${loginName}`, loginName, password, deviceLabel: 'Test browser', ...extra },
    o.cookies,
  );

const login = (loginName: string, password: string, cookies: Record<string, string> = {}) =>
  post('/v1/login/password', { loginName, password, deviceLabel: 'Test browser' }, cookies);

async function accountRow(loginName: string) {
  const { rows } = await deps.db.query<{ id: string; terms_version: string | null; terms_accepted_at: Date | null }>(
    'select id, terms_version, terms_accepted_at from accounts where id = $1',
    [await accountIdByLoginName(deps, loginName)],
  );
  return rows[0];
}

async function alerts(accountId: string, kind: string) {
  const { rows } = await deps.db.query('select detail from alerts where account_id = $1 and kind = $2', [accountId, kind]);
  return rows;
}

describe('terms on sign-up (R10)', () => {
  it('refuses a missing or older version before hashing or creating anything', async () => {
    const hash = vi.spyOn(argon2, 'hash');
    for (const extra of [{}, { acceptedTerms: '2026-01-01' }, { acceptedTerms: true }]) {
      const res = await register('termsless1', GOOD, extra);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'terms-not-accepted', version: TERMS });
    }
    expect(hash).not.toHaveBeenCalled();
    expect(await accountRow('termsless1')).toBeUndefined();
  });

  it('records the current version on the new account', async () => {
    const res = await register('termsful1');
    expect(res.statusCode).toBe(201);
    const row = await accountRow('termsful1');
    expect(row!.terms_version).toBe(TERMS);
    expect(row!.terms_accepted_at).toEqual(now);
  });
});

describe('POST /v1/register/password', () => {
  it('creates the account, its Argon2id hash and a first session without a new-login alert', async () => {
    const res = await register('Satoshi.N');
    expect(res.statusCode).toBe(201);
    // Only the public display name comes back, never the login name.
    expect(res.json()).toEqual({ displayName: 'PSatoshi.N' });
    expect(res.body).not.toContain('"Satoshi.N"');
    expect(cookie(res, SESSION_COOKIE)).toBeTruthy();
    expect(cookie(res, DEVICE_COOKIE)).toBeTruthy();
    const id = (await accountRow('Satoshi.N'))!.id;
    const { rows } = await deps.db.query<{ hash: string }>('select hash from passwords where account_id = $1', [id]);
    // argon2 0.45.1 writes the parameters in the order m, p, t; the values are what count.
    const m = /^\$argon2id\$v=19\$([^$]+)\$/.exec(rows[0]!.hash);
    expect(m).not.toBeNull();
    expect(Object.fromEntries(m![1]!.split(',').map((kv) => kv.split('=')))).toEqual({ m: '65536', t: '3', p: '1' });
    expect(await alerts(id, 'new-login')).toHaveLength(0);
    const { rows: sessions } = await deps.db.query('select onboarding_until from sessions where account_id = $1', [id]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.onboarding_until).not.toBeNull();
  });

  it('refuses taken names case-insensitively and reserved display names, without false positives', async () => {
    expect((await register('Satoshi.Q')).statusCode).toBe(201);
    // A taken login name is found only by the final create, after the Argon2 hash, and answered
    // with the generic names-unavailable (never "login name taken").
    const hash = vi.spyOn(argon2, 'hash');
    const loginTaken = await register('satoshi.q', GOOD, { acceptedTerms: TERMS }, { displayName: 'Fresh.Name1' });
    expect(loginTaken.statusCode).toBe(409);
    expect(loginTaken.json()).toEqual({ error: 'names-unavailable' });
    expect(hash).toHaveBeenCalledTimes(1);
    hash.mockRestore();
    expect(await accountRow('satoshi.q')).toBeDefined();
    const { rows: fresh } = await deps.db.query("select 1 from accounts where display_key = 'fresh.name1'");
    expect(fresh).toEqual([]);
    const displayTaken = await register('other.login1', GOOD, { acceptedTerms: TERMS }, { displayName: 'psatoshi.q' });
    expect(displayTaken.statusCode).toBe(409);
    expect(displayTaken.json()).toEqual({ error: 'display-name-taken' });
    const reserved = await register('quiet.one1', GOOD, { acceptedTerms: TERMS }, { displayName: 'X2F.Support' });
    expect(reserved.statusCode).toBe(400);
    expect(reserved.json()).toEqual({ error: 'display-name-reserved' });
    // F4: look-alikes of reserved words are reserved for display names.
    const lookAlike = await register('quiet.one2', GOOD, { acceptedTerms: TERMS }, { displayName: 'adm1n.team' });
    expect(lookAlike.json()).toEqual({ error: 'display-name-reserved' });
    expect((await register('quiet.one3', GOOD, { acceptedTerms: TERMS }, { displayName: 'badminton' })).statusCode).toBe(201);
    const invalid = await register('quiet.one4', GOOD, { acceptedTerms: TERMS }, { displayName: 'аlice' }); // Cyrillic а
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({ error: 'display-name-invalid' });
    const badLogin = await register('bad login', GOOD, { acceptedTerms: TERMS }, { displayName: 'Fine.Name5' });
    expect(badLogin.json()).toEqual({ error: 'login-name-invalid' });
    // A private login name may hold a reserved word: nobody ever sees it.
    expect((await register('my.admin.pw', GOOD, { acceptedTerms: TERMS }, { displayName: 'Plain.Pat' })).statusCode).toBe(201);
  });

  it('refuses a login name equal to the display name in any case', async () => {
    const res = await register('Same.Name1', GOOD, { acceptedTerms: TERMS }, { displayName: 'same.NAME1' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'names-same' });
  });

  it('one namespace (review I1): a login name never equals a display name, nor a display name a login name', async () => {
    // Alice: display Mira.K. Bob picks login name mira.k: refused before the Argon2 hash (display
    // names are public, so the cheap refusal tells nobody anything new).
    expect((await register('alice.private', GOOD, { acceptedTerms: TERMS }, { displayName: 'Mira.K' })).statusCode).toBe(201);
    const hash = vi.spyOn(argon2, 'hash');
    const bob = await register('MIRA.K', GOOD, { acceptedTerms: TERMS }, { displayName: 'Bob.Trades' });
    expect(bob.statusCode).toBe(409);
    expect(bob.json()).toEqual({ error: 'names-unavailable' });
    expect(hash).not.toHaveBeenCalled();
    // Bob: login night.owl. Carol picks display name Night.Owl: refused only by the credential-bound
    // create (after the hash), as the generic names-unavailable, so no start route can test a login name.
    expect((await register('night.owl', GOOD, { acceptedTerms: TERMS }, { displayName: 'Bob.Trades' })).statusCode).toBe(201);
    hash.mockClear();
    const carol = await register('carol.private', GOOD, { acceptedTerms: TERMS }, { displayName: 'Night.Owl' });
    expect(carol.statusCode).toBe(409);
    expect(carol.json()).toEqual({ error: 'names-unavailable' });
    expect(hash).toHaveBeenCalledTimes(1);
    hash.mockRestore();
    expect(await accountRow('carol.private')).toBeUndefined();
    expect((await deps.db.query("select 1 from accounts where display_key = 'night.owl'")).rows).toEqual([]);
  });

  it('F4: refuses a display name that looks like a staff or owner display name', async () => {
    await seedAccount(deps, { loginName: 'staff.login9', displayName: 'Kim.Lorn', kind: 'staff' });
    for (const displayName of ['kim.lom', 'Klm.L0rn', 'KIM.LORN']) {
      const res = await register(`kimfan.${displayName.length}${displayName[1]}`, GOOD, { acceptedTerms: TERMS }, { displayName });
      expect(res.statusCode, displayName).toBe(400);
      expect(res.json()).toEqual({ error: 'display-name-reserved' });
    }
    // Two traders whose names only look alike are both fine.
    expect((await register('trader.aa1', GOOD, { acceptedTerms: TERMS }, { displayName: 'Alice.bb' })).statusCode).toBe(201);
    expect((await register('trader.aa2', GOOD, { acceptedTerms: TERMS }, { displayName: 'A1ice.bb' })).statusCode).toBe(201);
  });

  it('refuses leaked and weak passwords', async () => {
    const leaked = await register('leaky001', 'Password123!');
    expect(leaked.statusCode).toBe(400);
    expect(leaked.json()).toEqual({ error: 'password-leaked' });
    const weak = await register('weakling1', 'password');
    expect(weak.statusCode).toBe(400);
    expect(weak.json().error).toBe('password-weak');
    expect(weak.json().missing).toEqual(expect.arrayContaining(['upper', 'number', 'symbol', 'length']));
    expect(await accountRow('leaky001')).toBeUndefined();
  });

  it('answers 413 to a body over 4 KiB without hashing', async () => {
    const hash = vi.spyOn(argon2, 'hash');
    const res = await register('bigbody01', `Aa1!${'x'.repeat(5000)}`);
    expect(res.statusCode).toBe(413);
    expect(hash).not.toHaveBeenCalled();
  });

  it('strips control characters from the device label', async () => {
    const res = await post('/v1/register/password', {
      displayName: 'Plabelnul1', loginName: 'labelnul1', password: GOOD, deviceLabel: 'a\u0000b', acceptedTerms: TERMS,
    });
    expect(res.statusCode).toBe(201);
    const ok = await post('/v1/login/password', { loginName: 'labelnul1', password: GOOD, deviceLabel: 'c\u0000d' });
    expect(ok.statusCode).toBe(200);
    const id = (await accountRow('labelnul1'))!.id;
    const { rows } = await deps.db.query<{ device_label: string }>(
      'select device_label from sessions where account_id = $1 order by created_at, device_label', [id],
    );
    expect(rows.map((r) => r.device_label).sort()).toEqual(['ab', 'cd']);
  });

  it('refuses a body with missing or non-string fields', async () => {
    const res = await post('/v1/register/password', { displayName: 'Pshapeless', loginName: 'shapeless', password: 12, deviceLabel: 'x', acceptedTerms: TERMS });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad-request' });
  });
});

describe('POST /v1/login/password', () => {
  it('logs in with the right password and adds one new-login alert; refuses a wrong one', async () => {
    await register('loginok01');
    const id = (await accountRow('loginok01'))!.id;
    const ok = await login('LOGINOK01', GOOD);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ status: 'ok' });
    expect(cookie(ok, SESSION_COOKIE)).toBeTruthy();
    expect(await alerts(id, 'new-login')).toEqual([{ detail: { method: 'password', deviceLabel: 'Test browser' } }]);
    const bad = await login('loginok01', 'Wrong-Horse-9');
    expect(bad.statusCode).toBe(401);
    expect(bad.json()).toEqual({ error: 'credentials-invalid', misses: 1 });
  });

  it('logs in by the login name only, never by the public display name', async () => {
    await register('private.lg1', GOOD, { acceptedTerms: TERMS }, { displayName: 'Public.Face1' });
    expect((await login('Public.Face1', GOOD)).json()).toMatchObject({ error: 'credentials-invalid' });
    expect((await login('private.lg1', GOOD)).statusCode).toBe(200);
  });

  it('an account from before login names logs in by its old (public) name until it sets a private one (review I3)', async () => {
    const id = await seedAccount(deps, { loginName: null, displayName: 'Legacy.Acct' });
    const legacyHash = await hashPassword(deps.config, GOOD);
    await deps.db.query('insert into passwords (account_id, hash, pepper_id, updated_at) values ($1, $2, $3, $4)', [
      id, legacyHash.hash, legacyHash.pepperId, now,
    ]);
    const first = await login('Legacy.Acct', GOOD);
    expect(first.statusCode).toBe(200);
    const session = cookie(first, SESSION_COOKIE)!;
    // The creating session's onboarding window does not apply: a login session needs a confirm token.
    const { rows: s } = await deps.db.query<{ id: string }>('select id from sessions where account_id = $1', [id]);
    const confirmToken = await issueConfirmToken(deps, { sessionId: s[0]!.id, accountId: id, action: { kind: 'set-login-name' }, method: 'password' });
    const set = await post('/v1/account/login-name', { loginName: 'legacy.private', confirmToken }, { [SESSION_COOKIE]: session });
    expect(set.statusCode).toBe(200);
    // The old name no longer logs in; the new one does.
    expect((await login('Legacy.Acct', GOOD)).json()).toMatchObject({ error: 'credentials-invalid' });
    expect((await login('legacy.private', GOOD)).statusCode).toBe(200);
  });

  it('never shows a wait: after 10 misses the name is quietly not checked for 15 minutes, with the same answer', async () => {
    await register('quietlock1');
    const id = (await accountRow('quietlock1'))!.id;
    // One unknown browser (its device cookie kept), as a person retrying would be.
    const jar = { [DEVICE_COOKIE]: cookie(await login('nobody.qq1', GOOD), DEVICE_COOKIE)! };
    await deps.db.query("delete from login_throttle where key like 'password-visitor:%'");
    for (let i = 1; i <= 10; i++) {
      const res = await login('quietlock1', 'Wrong-Horse-9', jar);
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'credentials-invalid', misses: i });
    }
    expect(await alerts(id, 'login-locked')).toEqual([{ detail: { method: 'password' } }]);
    // The right password now gets the same answer, after one (dummy) Argon2 verify.
    const verify = vi.spyOn(argon2, 'verify');
    const locked = await login('quietlock1', GOOD, jar);
    expect(locked.statusCode).toBe(401);
    expect(locked.json()).toEqual({ error: 'credentials-invalid', misses: 11 });
    expect(locked.headers['retry-after']).toBeUndefined();
    expect(verify).toHaveBeenCalledTimes(1);
    // A quietly locked name checks DUMMY_HASH under the current pepper (FU-C), like an unknown name.
    expect(verify).toHaveBeenCalledWith(DUMMY_HASH, pepperedPassword(deps.config, deps.config.passwordPeppers.current, GOOD));
    verify.mockRestore();
    setNow(new Date(now.getTime() + 14 * 60_000));
    expect((await login('quietlock1', GOOD)).statusCode).toBe(401);
    setNow(new Date(now.getTime() + 60_000));
    expect((await login('quietlock1', GOOD)).statusCode).toBe(200);
  });

  it('the quiet lock on an unknown browser leaves a trusted browser of the account alone', async () => {
    const reg = await register('quietlock2');
    const device = cookie(reg, DEVICE_COOKIE)!;
    for (let i = 0; i < 12; i++) await login('quietlock2', 'Wrong-Horse-9');
    expect((await login('quietlock2', GOOD, { [DEVICE_COOKIE]: device })).statusCode).toBe(200);
  });

  it('counts misses per browser (any names) and clears them on a success from that browser', async () => {
    await register('countme01');
    const first = await login('nobody.at.all', GOOD);
    const device = cookie(first, DEVICE_COOKIE)!;
    const jar = { [DEVICE_COOKIE]: device };
    expect(first.json()).toEqual({ error: 'credentials-invalid', misses: 1 });
    expect((await login('countme01', 'Wrong-Horse-9', jar)).json()).toEqual({ error: 'credentials-invalid', misses: 2 });
    expect((await login('someone.else', GOOD, jar)).json()).toEqual({ error: 'credentials-invalid', misses: 3 });
    // Another browser has its own count.
    expect((await login('countme01', 'Wrong-Horse-9')).json()).toEqual({ error: 'credentials-invalid', misses: 1 });
    expect((await login('countme01', GOOD, jar)).statusCode).toBe(200);
    expect((await login('countme01', 'Wrong-Horse-9', jar)).json()).toEqual({ error: 'credentials-invalid', misses: 1 });
  });

  it('gives the same shape and one Argon2 verify for an unknown name, a PGP-only account, a staff account and a wrong password', async () => {
    await register('shape0001');
    await seedAccount(deps, { loginName: 'pgponly01' });
    const staffId = await seedAccount(deps, { loginName: 'staffer01', kind: 'staff' });
    const staffHash = await hashPassword(deps.config, GOOD);
    await deps.db.query('insert into passwords (account_id, hash, pepper_id, updated_at) values ($1, $2, $3, $4)', [
      staffId, staffHash.hash, staffHash.pepperId, now,
    ]);
    const cases: Array<[string, string]> = [
      ['nobody0001', GOOD],
      ['pgponly01', GOOD],
      ['staffer01', GOOD],
      ['shape0001', 'Wrong-Horse-9'],
      ['аlice', GOOD],
      ['bad\u0000name', GOOD],
    ];
    for (const [loginName, password] of cases) {
      const verify = vi.spyOn(argon2, 'verify');
      // A fresh browser each time, so `misses` is 1 for every case.
      const res = await login(loginName, password);
      expect(res.statusCode, loginName).toBe(401);
      expect(res.json()).toEqual({ error: 'credentials-invalid', misses: 1 });
      expect(verify, loginName).toHaveBeenCalledTimes(1);
      verify.mockRestore();
    }
    // An unknown or malformed name is throttled under an HMAC tag, never the typed name (a NUL would
    // also break Postgres).
    const nulKey = `password-login:name:${loginNameLookup(deps.config, 'bad\u0000name').tag}:anon`;
    const { rows } = await deps.db.query<{ failures: number }>('select failures from login_throttle where key = $1', [nulKey]);
    expect(rows).toEqual([{ failures: 1 }]);
    const { rows: named } = await deps.db.query("select key from login_throttle where key like '%nobody0001%'");
    expect(named).toEqual([]);
  });

  it('I-1: a known and an unknown login name cost the same queries, with or without a device cookie, on the 10th miss too', async () => {
    await register('parity001');
    const id = (await accountRow('parity001'))!.id;
    // Pool AND checked-out client queries, in order (whitespace normalised), so parity covers the
    // full statement sequence, not just their number or the pool's share.
    const spy = spySql(deps.db);
    const count = async (loginName: string, cookies: Record<string, string>) => {
      spy.clear();
      const res = await login(loginName, 'Wrong-Horse-9', cookies);
      expect(res.statusCode).toBe(401);
      const sql = spy.sql();
      expect(sql.length).toBeGreaterThan(0);
      return JSON.stringify(sql);
    };
    try {
      for (const cookies of [{}, { [DEVICE_COOKIE]: randomBytes(32).toString('base64url') }]) {
        const counts = [await count('parity001', cookies), await count('ghost.parity1', cookies), await count('bad name!', cookies)];
        expect(new Set(counts).size, JSON.stringify(cookies)).toBe(1);
      }
      // The miss that reaches the quiet lock: the alert for a real account, the same work for none.
      const tag = loginNameLookup(deps.config, 'ghost.parity2').tag;
      for (const key of [`password-login:${id}:anon`, `password-login:name:${tag}:anon`]) {
        await deps.db.query('delete from login_throttle where key = $1', [key]);
        await deps.db.query('insert into login_throttle (key, failures, last_failure_at) values ($1, 9, $2)', [key, now]);
      }
      const tenth = [await count('parity001', {}), await count('ghost.parity2', {})];
      expect(new Set(tenth).size).toBe(1);
      expect(await alerts(id, 'login-locked')).toEqual([{ detail: { method: 'password' } }]);
      // Locked: still the same queries.
      const locked = [await count('parity001', {}), await count('ghost.parity2', {})];
      expect(new Set(locked).size).toBe(1);
    } finally {
      spy.restore();
    }
  });

  it('verifies the dummy hash when the account is unknown', async () => {
    const verify = vi.spyOn(argon2, 'verify');
    await login('ghost0001', GOOD);
    expect(verify).toHaveBeenCalledWith(DUMMY_HASH, pepperedPassword(deps.config, deps.config.passwordPeppers.current, GOOD));
  });

  it('answers 413 to a body over 4 KiB without verifying', async () => {
    const verify = vi.spyOn(argon2, 'verify');
    const res = await login('bigbody02', `Aa1!${'x'.repeat(5000)}`);
    expect(res.statusCode).toBe(413);
    expect(verify).not.toHaveBeenCalled();
  });

  it('refuses a disabled account after the password checks out', async () => {
    await register('disabled1');
    await deps.db.query('update accounts set disabled_at = $2 where id = $1', [await accountIdByLoginName(deps, 'disabled1'), now]);
    expect((await login('disabled1', 'Wrong-Horse-9')).json()).toMatchObject({ error: 'credentials-invalid' });
    const res = await login('disabled1', GOOD);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'account-disabled' });
  });
});

describe('POST /v1/confirm/password', () => {
  it('issues a token that redeems for that action only; wrong confirms are throttled apart from login misses', async () => {
    const reg = await register('confirm01');
    const session = cookie(reg, SESSION_COOKIE)!;
    const device = cookie(reg, DEVICE_COOKIE)!;
    const cookies = { [SESSION_COOKIE]: session, [DEVICE_COOKIE]: device };
    const res = await post('/v1/confirm/password', { password: GOOD, action: { kind: 'set-password' } }, cookies);
    expect(res.statusCode).toBe(200);
    const { confirmToken } = res.json<{ confirmToken: string }>();
    expect((await post('/t/add-method', { confirmToken }, cookies)).json()).toEqual({ error: 'confirm-invalid' });
    expect((await post('/t/set-password', { confirmToken }, cookies)).statusCode).toBe(200);
    expect((await post('/t/set-password', { confirmToken }, cookies)).json()).toEqual({ error: 'confirm-invalid' });

    const wrongConfirm = async () => {
      const bad = await post('/v1/confirm/password', { password: 'Wrong-Horse-9', action: { kind: 'set-password' } }, cookies);
      expect(bad.statusCode).toBe(401);
      expect(bad.json()).toEqual({ error: 'credentials-invalid' });
    };
    // Login misses (the `password-login` key) do not count against the signed-in person's confirms.
    await wrongConfirm();
    await wrongConfirm();
    for (let i = 0; i < 5; i++) expect((await login('confirm01', 'Wrong-Horse-9', { [DEVICE_COOKIE]: device })).statusCode).toBe(401);
    expect((await post('/v1/confirm/password', { password: GOOD, action: { kind: 'set-password' } }, cookies)).statusCode).toBe(200);
    // Four wrong confirms in a row: the confirm path keeps its own short waits.
    for (let i = 0; i < 4; i++) await wrongConfirm();
    const slow = await post('/v1/confirm/password', { password: GOOD, action: { kind: 'set-password' } }, cookies);
    expect(slow.statusCode).toBe(429);
    expect(slow.json()).toMatchObject({ error: 'slow-down' });
  });

  it('answers 413 to a body over 4 KiB without verifying', async () => {
    const reg = await register('confirm03');
    const verify = vi.spyOn(argon2, 'verify');
    const res = await post(
      '/v1/confirm/password',
      { password: `Aa1!${'x'.repeat(5000)}`, action: { kind: 'set-password' } },
      { [SESSION_COOKIE]: cookie(reg, SESSION_COOKIE)! },
    );
    expect(res.statusCode).toBe(413);
    expect(verify).not.toHaveBeenCalled();
  });

  it('needs a session and a well-formed action', async () => {
    const anon = await post('/v1/confirm/password', { password: GOOD, action: { kind: 'set-password' } });
    expect(anon.json()).toEqual({ error: 'not-authenticated' });
    const reg = await register('confirm02');
    const cookies = { [SESSION_COOKIE]: cookie(reg, SESSION_COOKIE)! };
    for (const action of [undefined, { kind: 'launch-missiles' }, { kind: 'set-password', extra: 'x' }, { kind: 'add-method', method: 'fax' }]) {
      const res = await post('/v1/confirm/password', { password: GOOD, action }, cookies);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'bad-request' });
    }
  });
});

describe('budgets (P2-I8)', () => {
  it('answers 503 busy when the Argon2 slots are full', async () => {
    await register('budget001');
    const tiny = new Semaphore(1, 0);
    vi.spyOn(ARGON2_SLOTS, 'run').mockImplementation((fn) => tiny.run(fn));
    vi.spyOn(argon2, 'verify').mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 200));
      return false;
    });
    const results = await Promise.all([login('budget001', 'Wrong-Horse-9'), login('budget001', 'Wrong-Horse-9')]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([401, 503]);
    expect(results.find((r) => r.statusCode === 503)!.json()).toEqual({ error: 'busy' });
  });

  it('a busy refusal never uses up a throttle try', async () => {
    await register('busyslot1');
    for (let i = 0; i < 9; i++) expect((await login('busyslot1', 'Wrong-Horse-9')).statusCode).toBe(401);
    const full = new Semaphore(0, 0);
    const run = vi.spyOn(ARGON2_SLOTS, 'run').mockImplementation((fn) => full.run(fn));
    const busy = await login('busyslot1', GOOD);
    expect(busy.statusCode).toBe(503);
    expect(busy.json()).toEqual({ error: 'busy' });
    run.mockRestore();
    // Still the 10th try of the streak, so it is checked.
    expect((await login('busyslot1', GOOD)).statusCode).toBe(200);
  });

  it('answers 503 busy to the 21st register within a minute', async () => {
    for (let i = 0; i < 20; i++) expect((await register(`bucket${String(i).padStart(3, '0')}`, GOOD, {})).statusCode).toBe(400);
    const res = await register('bucket020');
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'busy' });
  });
});

describe('pepper (FU-C, ASVS 2.4.5)', () => {
  type Row = { hash: string; pepper_id: number | null; updated_at: Date };
  const row = async (id: string) =>
    (await deps.db.query<Row>('select hash, pepper_id, updated_at from passwords where account_id = $1', [id])).rows[0]!;
  const hmac = (key: Uint8Array, pw: string) => createHmac('sha256', key).update(normalizePassword(pw), 'utf8').digest();
  const ARGON2_PLAIN = { type: argon2.argon2id, memoryCost: 65_536, timeCost: 3, parallelism: 1 } as const;

  /** Swaps the pepper ring for one test; the real one comes back afterwards. */
  async function withPeppers(ring: typeof deps.config.passwordPeppers, f: () => Promise<void>) {
    const saved = deps.config.passwordPeppers;
    deps.config.passwordPeppers = ring;
    try {
      await f();
    } finally {
      deps.config.passwordPeppers = saved;
    }
  }

  it('hashes HMAC-SHA-256(current pepper, NFC password) with Argon2id and records the pepper id', async () => {
    await register('peppered1', 'Cafe\u0301-Horse-9');
    const id = (await accountRow('peppered1'))!.id;
    const r = await row(id);
    const { current, keys } = deps.config.passwordPeppers;
    expect(r.pepper_id).toBe(current);
    expect(await argon2.verify(r.hash, hmac(keys.get(current)!, 'Café-Horse-9'))).toBe(true);
    expect(await argon2.verify(r.hash, normalizePassword('Café-Horse-9'))).toBe(false);
    expect(pepperedPassword(deps.config, current, 'Cafe\u0301-Horse-9')).toEqual(hmac(keys.get(current)!, 'Café-Horse-9'));
  });

  it('accepts a legacy hash (no pepper, marked null) and rehashes it under the current pepper on that login only', async () => {
    const id = await seedAccount(deps, { loginName: 'legacypw1' });
    const legacy = await argon2.hash(normalizePassword(GOOD), ARGON2_PLAIN);
    const changed = new Date(now.getTime() - 5 * HOUR);
    await deps.db.query('insert into passwords (account_id, hash, pepper_id, updated_at) values ($1, $2, null, $3)', [id, legacy, changed]);
    // A wrong password neither logs in nor touches the stored hash.
    expect((await login('legacypw1', 'Wrong-Horse-9')).statusCode).toBe(401);
    expect(await row(id)).toEqual({ hash: legacy, pepper_id: null, updated_at: changed });
    const verify = vi.spyOn(argon2, 'verify');
    const ok = await login('legacypw1', GOOD);
    expect(ok.statusCode).toBe(200);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledWith(legacy, normalizePassword(GOOD));
    const r = await row(id);
    const { current, keys } = deps.config.passwordPeppers;
    expect(r.pepper_id).toBe(current);
    expect(r.hash).not.toBe(legacy);
    expect(r.updated_at).toEqual(changed); // a rehash is not a password change
    expect(await argon2.verify(r.hash, hmac(keys.get(current)!, GOOD))).toBe(true);
    // The next login checks the peppered hash and does not hash again.
    const hash = vi.spyOn(argon2, 'hash');
    expect((await login('legacypw1', GOOD)).statusCode).toBe(200);
    expect(hash).not.toHaveBeenCalled();
    expect((await row(id)).hash).toBe(r.hash);
  });

  it('rotates: a hash under an older pepper still logs in and moves to the current one', async () => {
    const old = new Uint8Array(randomBytes(32));
    const newer = new Uint8Array(randomBytes(32));
    const id = await seedAccount(deps, { loginName: 'rotatepw1' });
    const oldHash = await argon2.hash(hmac(old, GOOD), ARGON2_PLAIN);
    await deps.db.query('insert into passwords (account_id, hash, pepper_id, updated_at) values ($1, $2, 4, $3)', [id, oldHash, now]);
    await withPeppers({ current: 5, keys: new Map([[5, newer], [4, old]]) }, async () => {
      expect((await login('rotatepw1', GOOD)).statusCode).toBe(200);
      const r = await row(id);
      expect(r.pepper_id).toBe(5);
      expect(await argon2.verify(r.hash, hmac(newer, GOOD))).toBe(true);
    });
  });

  it('refuses, with one dummy verify and no rehash, a hash whose pepper is no longer configured', async () => {
    const gone = new Uint8Array(randomBytes(32));
    const id = await seedAccount(deps, { loginName: 'lostpep01' });
    const goneHash = await argon2.hash(hmac(gone, GOOD), ARGON2_PLAIN);
    await deps.db.query('insert into passwords (account_id, hash, pepper_id, updated_at) values ($1, $2, 9, $3)', [id, goneHash, now]);
    const verify = vi.spyOn(argon2, 'verify');
    const res = await login('lostpep01', GOOD);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'credentials-invalid', misses: expect.any(Number) });
    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledWith(DUMMY_HASH, pepperedPassword(deps.config, deps.config.passwordPeppers.current, GOOD));
    expect((await row(id)).hash).toBe(goneHash);
  });

  it('a wrong password against a legacy or an older-pepper hash hashes nothing and changes nothing (review M5)', async () => {
    const old = new Uint8Array(randomBytes(32));
    const legacyId = await seedAccount(deps, { loginName: 'wrongleg1' });
    const olderId = await seedAccount(deps, { loginName: 'wrongold1' });
    const legacy = await argon2.hash(normalizePassword(GOOD), ARGON2_PLAIN);
    const older = await argon2.hash(hmac(old, GOOD), ARGON2_PLAIN);
    await deps.db.query('insert into passwords (account_id, hash, pepper_id, updated_at) values ($1, $2, null, $3)', [legacyId, legacy, now]);
    await deps.db.query('insert into passwords (account_id, hash, pepper_id, updated_at) values ($1, $2, 4, $3)', [olderId, older, now]);
    const { current, keys } = deps.config.passwordPeppers;
    await withPeppers({ current, keys: new Map([...keys, [4, old]]) }, async () => {
      const hash = vi.spyOn(argon2, 'hash');
      expect((await login('wrongleg1', 'Wrong-Horse-9')).statusCode).toBe(401);
      expect((await login('wrongold1', 'Wrong-Horse-9')).statusCode).toBe(401);
      expect(hash).not.toHaveBeenCalled();
    });
    expect(await row(legacyId)).toMatchObject({ hash: legacy, pepper_id: null });
    expect(await row(olderId)).toMatchObject({ hash: older, pepper_id: 4 });
  });

  it('a password change between the check and the rehash wins: the conditional rehash writes nothing (review M5)', async () => {
    const id = await seedAccount(deps, { loginName: 'racerh001' });
    const legacy = await argon2.hash(normalizePassword(GOOD), ARGON2_PLAIN);
    await deps.db.query('insert into passwords (account_id, hash, pepper_id, updated_at) values ($1, $2, null, $3)', [id, legacy, now]);
    const changed = await hashPassword(deps.config, 'Other-Horse-9');
    const query = deps.db.query.bind(deps.db) as (text: string, values?: unknown[]) => Promise<unknown>;
    let raced = false;
    vi.spyOn(deps.db, 'query').mockImplementation((async (text: string, values?: unknown[]) => {
      if (!raced && text.startsWith('update passwords set hash = $2, pepper_id = $3')) {
        raced = true;
        await query('update passwords set hash = $2, pepper_id = $3 where account_id = $1', [id, changed.hash, changed.pepperId]);
      }
      return query(text, values);
    }) as never);
    expect((await login('racerh001', GOOD)).statusCode).toBe(200);
    vi.restoreAllMocks();
    expect(raced).toBe(true);
    expect(await row(id)).toMatchObject({ hash: changed.hash, pepper_id: changed.pepperId });
  });

  it('with X2F_LEGACY_SECRETS=off a legacy hash is refused like a wrong password, with one dummy verify (review M1)', async () => {
    const id = await seedAccount(deps, { loginName: 'legoff001' });
    const legacy = await argon2.hash(normalizePassword(GOOD), ARGON2_PLAIN);
    await deps.db.query('insert into passwords (account_id, hash, pepper_id, updated_at) values ($1, $2, null, $3)', [id, legacy, now]);
    deps.config.legacySecrets = false;
    try {
      const verify = vi.spyOn(argon2, 'verify');
      const hash = vi.spyOn(argon2, 'hash');
      const res = await login('legoff001', GOOD);
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'credentials-invalid', misses: expect.any(Number) });
      expect(verify).toHaveBeenCalledTimes(1);
      expect(verify).toHaveBeenCalledWith(DUMMY_HASH, pepperedPassword(deps.config, deps.config.passwordPeppers.current, GOOD));
      expect(hash).not.toHaveBeenCalled();
    } finally {
      deps.config.legacySecrets = true;
    }
    expect(await row(id)).toMatchObject({ hash: legacy, pepper_id: null });
  });

  it('a confirm with the password also rehashes a legacy hash', async () => {
    await register('confirmrh');
    const id = (await accountRow('confirmrh'))!.id;
    const ok = await login('confirmrh', GOOD);
    const legacy = await argon2.hash(normalizePassword(GOOD), ARGON2_PLAIN);
    await deps.db.query('update passwords set hash = $2, pepper_id = null where account_id = $1', [id, legacy]);
    const res = await post(
      '/v1/confirm/password', { password: GOOD, action: { kind: 'set-password' } },
      { [SESSION_COOKIE]: cookie(ok, SESSION_COOKIE)!, [DEVICE_COOKIE]: cookie(ok, DEVICE_COOKIE)! },
    );
    expect(res.statusCode).toBe(200);
    expect((await row(id)).pepper_id).toBe(deps.config.passwordPeppers.current);
  });
});

describe('logs', () => {
  it('never contain a pepper', async () => {
    const before = logs.length;
    await register('PepperLog1', 'Very-Secret-Pw-43');
    await login('PepperLog1', 'Very-Secret-Pw-43');
    await login('PepperLog1', 'Wrong-Secret-Pw-43');
    const text = logs.slice(before).join('\n');
    for (const key of deps.config.passwordPeppers.keys.values()) {
      for (const enc of ['base64', 'base64url', 'hex'] as const) expect(text).not.toContain(Buffer.from(key).toString(enc));
    }
  });

  it('never contain the password, the cookie value, the login name or the display name', async () => {
    const before = logs.length;
    const reg = await register('Logged.User', 'Very-Secret-Pw-42');
    const ok = await login('Logged.User', 'Very-Secret-Pw-42');
    await login('Logged.User', 'Other-Secret-Pw-42');
    for (let i = 0; i < 11; i++) await login('Logged.User', 'Other-Secret-Pw-42');
    const text = logs.slice(before).join('\n');
    for (const secret of [
      'Very-Secret-Pw-42', 'Other-Secret-Pw-42', 'Logged.User', 'logged.user',
      cookie(reg, SESSION_COOKIE)!, cookie(ok, SESSION_COOKIE)!, cookie(reg, DEVICE_COOKIE)!,
    ]) {
      expect(text).not.toContain(secret);
    }
  });
});
