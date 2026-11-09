import { createHash, createHmac, randomBytes } from 'node:crypto';
import { normalizeRecoveryCode } from '@x2f/accounts';
import type { FastifyInstance } from 'fastify';
import { Secret } from 'otpauth';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deps } from '../src/app.js';
import { loginNameLookup } from '../src/accounts.js';
import { DEVICE_COOKIE } from '../src/auth/device.js';
import { hashPassword, verifyPassword } from '../src/auth/password.js';
import { RECOVERY_HOLD_MS } from '../src/auth/recovery.js';
import { SESSION_COOKIE, requireSession } from '../src/auth/sessions.js';
import { sealSecret } from '../src/auth/totp.js';
import { seedAccount } from './helpers/accounts.js';
import { testApp } from './helpers/app.js';
import { genKey, type Pair } from './helpers/pgpKeys.js';
import { spySql } from './helpers/sqlSpy.js';
import { Browser, addTestLogin, codeAt } from './helpers/totp.js';

const T0 = new Date('2026-10-17T06:00:00Z'); // a step boundary, early in the UTC day
const HOUR = 3600_000;
const CODE = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let now = T0;
let day = 0;
let n = 0;
let key: Pair;

beforeAll(async () => {
  let set: (d: Date) => void;
  ({ app, deps, setNow: set } = await testApp());
  setNow = (d) => {
    now = d;
    set(d);
  };
  addTestLogin(app, deps);
  app.get('/t/recovery-ok', { preHandler: requireSession({ allowRecovery: true }) }, async () => ({ ok: true }));
  app.get('/t/held-ok', { preHandler: requireSession({ allowRecovery: true, allowHeld: true }) }, async () => ({ ok: true }));
  key = await genKey();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  // Each test runs on its own UTC day: daily caps, budgets and throttle streaks start fresh.
  setNow(new Date(T0.getTime() + ++day * 24 * HOUR));
});

const name = (p = 'rec') => `${p}${String(++n).padStart(4, '0')}`;
const at = (ms: number) => new Date(now.getTime() + ms);
const sha = (s: string) => createHash('sha256').update(s).digest();
/** FU-C: HMAC-SHA-256 under a recovery-code key, bound to the account. */
const keyed = (keyBytes: Uint8Array, accountId: string, normalized: string) =>
  createHmac('sha256', keyBytes).update(`x2f/recovery-code\0${accountId}\0${normalized}`, 'utf8').digest();
const currentKeyed = (accountId: string, code: string) =>
  keyed(deps.config.recoveryCodeKeys.keys.get(deps.config.recoveryCodeKeys.current)!, accountId, normalizeRecoveryCode(code)!);

async function account(o: { kind?: 'trader' | 'staff' | 'owner'; disabled?: boolean } = {}) {
  const username = name();
  const id = await seedAccount(deps, { loginName: username, ...o });
  return { id, username };
}

async function loggedIn(accountId: string, firstSession = true): Promise<Browser> {
  const b = new Browser(app);
  expect((await b.post('/t/login', { accountId, firstSession })).statusCode).toBe(200);
  return b;
}

/** Enrols TOTP directly with a known secret; returns it as base32. */
async function withTotp(accountId: string): Promise<string> {
  const raw = randomBytes(20);
  await deps.db.query('insert into totp (account_id, secret_enc, created_at) values ($1, $2, $3)', [
    accountId, sealSecret(deps, accountId, new Uint8Array(raw)), now,
  ]);
  return new Secret({ buffer: new Uint8Array(raw).buffer }).base32;
}

/**
 * New codes from `b`. A backup login earlier in a test started the account's 24-hour hold (Task 17),
 * which refuses every login-method change; `endHold` ends it as the owner's strong login would
 * (coolingOff.test.ts covers the hold itself).
 */
const endHold = (accountId: string) => deps.db.query('delete from account_holds where account_id = $1', [accountId]);

async function newCodes(b: Browser): Promise<string[]> {
  const res = await b.post('/v1/account/recovery-codes', {});
  expect(res.statusCode).toBe(200);
  return (res.json() as { codes: string[] }).codes;
}

const backup = (b: Browser, username: string, kind: 'totp' | 'recovery-code', code: string) =>
  b.post('/v1/login/backup', { loginName: username, kind, code, deviceLabel: 'Backup browser' });

async function sessionRow(b: Browser) {
  const token = b.cookies[SESSION_COOKIE]!;
  const { rows } = await deps.db.query<{ id: string; level: string; hold_until: Date | null }>(
    'select id, level, hold_until from sessions where token_hash = $1',
    [sha(token)],
  );
  return rows[0]!;
}

async function alerts(accountId: string, kind: string) {
  const { rows } = await deps.db.query<{ detail: Record<string, unknown> }>(
    'select detail from alerts where account_id = $1 and kind = $2 order by created_at',
    [accountId, kind],
  );
  return rows.map((r) => r.detail);
}

/**
 * Runs `n` copies of `run` at once and holds each one just after its query starting with `prefix`
 * until all `n` have made it, so they truly race on whatever comes next.
 */
async function racing<T>(prefix: string, n: number, run: () => Promise<T>): Promise<T[]> {
  const query = deps.db.query.bind(deps.db) as (text: string, values?: unknown[]) => Promise<unknown>;
  let reached = 0;
  let release!: () => void;
  const barrier = new Promise<void>((r) => { release = r; });
  const spy = vi.spyOn(deps.db, 'query').mockImplementation((async (text: string, values?: unknown[]) => {
    const result = await query(text, values);
    if (text.startsWith(prefix)) {
      if (++reached === n) release();
      await barrier;
    }
    return result;
  }) as never);
  try {
    const results = await Promise.all(Array.from({ length: n }, run));
    expect(reached).toBe(n);
    return results;
  } finally {
    spy.mockRestore();
  }
}

describe('POST /v1/account/recovery-codes', () => {
  it('returns 10 distinct codes in the trade-code format, stored only as hashes', async () => {
    const { id } = await account();
    const codes = await newCodes(await loggedIn(id));
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(CODE);
    const { rows } = await deps.db.query<{ code_hash: Buffer; key_id: number | null }>(
      'select code_hash, key_id from recovery_codes where account_id = $1', [id],
    );
    // Keyed hash (FU-C) of the normalized form that login compares, under the current key.
    expect(rows.map((r) => r.code_hash.toString('hex')).sort()).toEqual(codes.map((c) => currentKeyed(id, c).toString('hex')).sort());
    expect(new Set(rows.map((r) => r.key_id))).toEqual(new Set([deps.config.recoveryCodeKeys.current]));
    for (const c of codes) expect(rows.some((r) => r.code_hash.equals(sha(normalizeRecoveryCode(c)!)))).toBe(false);
  });

  it('needs a confirm token outside onboarding and a full session', async () => {
    const { id } = await account();
    const res = await (await loggedIn(id, false)).post('/v1/account/recovery-codes', {});
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'confirm-required', action: 'new-recovery-codes' });
  });

  it('is refused for staff and the owner (R2)', async () => {
    for (const kind of ['staff', 'owner'] as const) {
      const { id } = await account({ kind });
      const res = await (await loggedIn(id)).post('/v1/account/recovery-codes', {});
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'method-not-allowed' });
    }
  });
});

describe('recovery-code keys (FU-C, ASVS 2.6.2)', () => {
  const insert = (accountId: string, hash: Buffer, keyId: number | null) =>
    deps.db.query('insert into recovery_codes (account_id, code_hash, key_id) values ($1, $2, $3)', [accountId, hash, keyId]);

  it('a legacy set (plain SHA-256, key_id null) still works once per code until it is regenerated', async () => {
    const { id, username } = await account();
    const legacy = ['ABCD-EFGH-JKMN-PQRS', 'BCDE-FGHJ-KMNP-QRST'];
    for (const c of legacy) await insert(id, sha(normalizeRecoveryCode(c)!), null);
    expect((await backup(new Browser(app), username, 'recovery-code', legacy[0]!)).statusCode).toBe(200);
    expect((await backup(new Browser(app), username, 'recovery-code', legacy[0]!)).statusCode).toBe(401);
    await endHold(id);
    await newCodes(await loggedIn(id));
    expect((await backup(new Browser(app), username, 'recovery-code', legacy[1]!)).statusCode).toBe(401);
    const { rows } = await deps.db.query('select 1 from recovery_codes where account_id = $1 and key_id is null', [id]);
    expect(rows).toEqual([]);
  });

  it('with X2F_LEGACY_SECRETS=off a legacy code is refused and stays unused (review M1)', async () => {
    const { id, username } = await account();
    await insert(id, sha(normalizeRecoveryCode('GHJK-MNPQ-RSTV-WXYZ')!), null);
    deps.config.legacySecrets = false;
    try {
      expect((await backup(new Browser(app), username, 'recovery-code', 'GHJK-MNPQ-RSTV-WXYZ')).statusCode).toBe(401);
    } finally {
      deps.config.legacySecrets = true;
    }
    const { rows } = await deps.db.query('select used_at from recovery_codes where account_id = $1', [id]);
    expect(rows).toEqual([{ used_at: null }]);
  });

  it('a SHA-256 value stored as keyed, or a keyed value stored as legacy, does not match', async () => {
    const { id, username } = await account();
    await insert(id, sha(normalizeRecoveryCode('CDEF-GHJK-MNPQ-RSTV')!), deps.config.recoveryCodeKeys.current);
    await insert(id, currentKeyed(id, 'DEFG-HJKM-NPQR-STVW'), null);
    expect((await backup(new Browser(app), username, 'recovery-code', 'CDEF-GHJK-MNPQ-RSTV')).statusCode).toBe(401);
    expect((await backup(new Browser(app), username, 'recovery-code', 'DEFG-HJKM-NPQR-STVW')).statusCode).toBe(401);
  });

  it('is bound to the account: another account\'s keyed value of the same code does not match', async () => {
    const a = await account();
    const b = await account();
    await insert(b.id, currentKeyed(a.id, 'EFGH-JKMN-PQRS-TVWX'), deps.config.recoveryCodeKeys.current);
    expect((await backup(new Browser(app), b.username, 'recovery-code', 'EFGH-JKMN-PQRS-TVWX')).statusCode).toBe(401);
  });

  it('accepts a code under an older key still in the ring, and not once that key is removed', async () => {
    const { id, username } = await account();
    const old = new Uint8Array(randomBytes(32));
    const saved = deps.config.recoveryCodeKeys;
    const code = 'FGHJ-KMNP-QRST-VWXY';
    await insert(id, keyed(old, id, normalizeRecoveryCode(code)!), 3);
    try {
      deps.config.recoveryCodeKeys = { current: saved.current, keys: new Map([[saved.current, saved.keys.get(saved.current)!]]) };
      expect((await backup(new Browser(app), username, 'recovery-code', code)).statusCode).toBe(401);
      deps.config.recoveryCodeKeys = { current: saved.current, keys: new Map([...saved.keys, [3, old]]) };
      expect((await backup(new Browser(app), username, 'recovery-code', code)).statusCode).toBe(200);
    } finally {
      deps.config.recoveryCodeKeys = saved;
    }
  });
});

describe('backup login with a recovery code', () => {
  // Plan 2 Task 17 (owner, 2026-10-29): a recovery code alone is one weak
  // way, so it is now held for 24 hours like a TOTP backup login (it used to have no hold).
  it('logs in once as a recovery session held 24 hours; regenerating invalidates the old set', async () => {
    const { id, username } = await account();
    const owner = await loggedIn(id);
    const codes = await newCodes(owner);

    const b = new Browser(app);
    // Typed in lower case without dashes still works.
    const res = await backup(b, username, 'recovery-code', codes[0]!.toLowerCase().replaceAll('-', ''));
    expect(res.statusCode).toBe(200);
    const holdUntil = new Date(now.getTime() + RECOVERY_HOLD_MS);
    expect(res.json()).toEqual({ status: 'ok', level: 'recovery', holdUntil: holdUntil.toISOString() });
    const row = await sessionRow(b);
    expect(row.level).toBe('recovery');
    expect(row.hold_until).toEqual(holdUntil);
    expect(await alerts(id, 'recovery-login')).toEqual([{ method: 'recovery-code', deviceLabel: 'Backup browser', holdUntil: holdUntil.toISOString() }]);

    const again = await backup(new Browser(app), username, 'recovery-code', codes[0]!);
    expect(again.statusCode).toBe(401);
    expect(again.json()).toEqual({ error: 'credentials-invalid' });

    await endHold(id);
    await newCodes(owner);
    const old = await backup(new Browser(app), username, 'recovery-code', codes[1]!);
    expect(old.json()).toEqual({ error: 'credentials-invalid' });
  });

  it('a recovery session is refused on full-only routes and cannot confirm', async () => {
    const { id, username } = await account();
    const codes = await newCodes(await loggedIn(id));
    const b = new Browser(app);
    expect((await backup(b, username, 'recovery-code', codes[0]!)).statusCode).toBe(200);
    for (const [url, body] of [
      ['/v1/confirm/password', { password: 'x', action: { kind: 'set-password' } }],
      ['/v1/account/recovery-codes', {}],
      ['/v1/account/totp/start', {}],
    ] as const) {
      const res = await b.post(url, body);
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'recovery-session' });
    }
  });

  it('a disabled account gets account-disabled and the code stays unused', async () => {
    const { id, username } = await account();
    const codes = await newCodes(await loggedIn(id));
    await deps.db.query('update accounts set disabled_at = $2 where id = $1', [id, now]);
    // A wrong code says nothing about the account being disabled.
    const wrong = await backup(new Browser(app), username, 'recovery-code', 'ABCD-EFGH-JKMN-PQRT');
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toEqual({ error: 'credentials-invalid' });
    const res = await backup(new Browser(app), username, 'recovery-code', codes[0]!);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'account-disabled' });
    const { rows } = await deps.db.query('select used_at from recovery_codes where code_hash = $1', [currentKeyed(id, codes[0]!)]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.used_at).toBeNull();
  });

  it('an unknown username, a malformed code and a staff account all answer like a wrong code (R2)', async () => {
    const { id: staffId, username: staffName } = await account({ kind: 'staff' });
    const staffCode = 'ABCD-EFGH-JKMN-PQRS';
    await deps.db.query('insert into recovery_codes (account_id, code_hash) values ($1, $2)', [staffId, sha(staffCode)]);
    const { username } = await account();
    const cases: Array<[string, string]> = [
      ['nobody-at-all', 'ABCD-EFGH-JKMN-PQRT'],
      [username, 'ABCD-EFGH-JKMN-PQRT'],
      [username, 'not a code'],
      [staffName, staffCode],
    ];
    for (const [u, c] of cases) {
      const b = new Browser(app);
      const res = await backup(b, u, 'recovery-code', c);
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'credentials-invalid' });
      expect(b.cookies[SESSION_COOKIE]).toBeUndefined();
    }
    const { rows } = await deps.db.query('select used_at from recovery_codes where account_id = $1', [staffId]);
    expect(rows[0]!.used_at).toBeNull();
    // An authenticator code is no backup for anyone: the same 400 for a staff name as for any name.
    for (const u of [staffName, username, 'nobody-at-all']) {
      const res = await backup(new Browser(app), u, 'totp', '123456');
      expect(res.json()).toEqual({ error: 'bad-request' });
    }
  });

  it('two parallel uses of one code: exactly one logs in', async () => {
    const { id, username } = await account();
    const codes = await newCodes(await loggedIn(id));
    // All three find the code unused before any of them marks it, so only the guarded update decides.
    const results = await racing('select id from recovery_codes', 3, () => backup(new Browser(app), username, 'recovery-code', codes[0]!));
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 401, 401]);
  });

  it('wrong codes are throttled on the recovery-code key', async () => {
    const { id, username } = await account();
    const codes = await newCodes(await loggedIn(id));
    const b = new Browser(app);
    for (let i = 0; i < 4; i++) {
      expect((await backup(b, username, 'recovery-code', 'ABCD-EFGH-JKMN-PQRT')).statusCode).toBe(401);
    }
    const res = await backup(b, username, 'recovery-code', codes[0]!);
    expect(res.statusCode).toBe(429);
    expect(res.json()).toMatchObject({ error: 'slow-down' });
  });
});

describe('an authenticator code is not a backup way in (design build gaps Job 1, board Login-Backup)', () => {
  it('kind totp is refused before any lookup, even with a correct code: no session, no hold, nothing counted', async () => {
    const { id, username } = await account();
    const secret = await withTotp(id);
    const b = new Browser(app);
    const spy = spySql(deps.db);
    let res: Awaited<ReturnType<typeof backup>>;
    try {
      res = await backup(b, username, 'totp', codeAt(secret, now));
      // Only the site-wide maintenance gate reads (every request); nothing about any account.
      expect(spy.sql().filter((s) => /accounts|totp|login_throttle|recovery_codes|sessions|account_holds/.test(s))).toEqual([]);
    } finally {
      spy.restore();
    }
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad-request' });
    expect(b.cookies[SESSION_COOKIE]).toBeUndefined();
    expect((await deps.db.query('select 1 from account_holds where account_id = $1', [id])).rows).toEqual([]);
    expect((await deps.db.query("select 1 from login_throttle where key like 'totp:%' or key like 'backup-totp:%'")).rows).toEqual([]);
    expect(await alerts(id, 'recovery-login')).toEqual([]);
    // Only the backup offer went: password + authenticator code stays a login (totp.test.ts).
  });
});

describe('the held recovery session of a backup login (P2-I1, Task 17)', () => {
  it('opens a held recovery session that may add a key only after 24 hours', async () => {
    const { id, username } = await account();
    const codes = await newCodes(await loggedIn(id));
    const b = new Browser(app);
    const start = now;
    const res = await backup(b, username, 'recovery-code', codes[0]!);
    expect(res.statusCode).toBe(200);
    const holdUntil = new Date(start.getTime() + RECOVERY_HOLD_MS);
    expect(res.json()).toEqual({ status: 'ok', level: 'recovery', holdUntil: holdUntil.toISOString() });
    const row = await sessionRow(b);
    expect(row.level).toBe('recovery');
    expect(row.hold_until).toEqual(holdUntil);
    expect(await alerts(id, 'recovery-login')).toEqual([
      { method: 'recovery-code', deviceLabel: 'Backup browser', holdUntil: holdUntil.toISOString() },
    ]);

    setNow(new Date(holdUntil.getTime() - 1000)); // +23:59:59
    const early = await b.post('/v1/account/pgp/start', { publicKey: key.publicKey });
    expect(early.statusCode).toBe(403);
    expect(early.json()).toEqual({ error: 'recovery-hold', holdUntil: holdUntil.toISOString() });
    // Fail closed (review): every recovery-allowed route refuses a held session unless it opts in.
    const held = await b.get('/t/recovery-ok');
    expect(held.statusCode).toBe(403);
    expect(held.json()).toEqual({ error: 'recovery-hold', holdUntil: holdUntil.toISOString() });
    expect((await b.get('/t/held-ok')).statusCode).toBe(200);
    expect((await b.post('/v1/account/pgp/finish', { challengeId: '00000000-0000-0000-0000-000000000000', code: 'x' })).json())
      .toEqual({ error: 'recovery-hold', holdUntil: holdUntil.toISOString() });
    setNow(holdUntil); // +24:00:00
    expect((await b.get('/t/recovery-ok')).statusCode).toBe(200);
    const later = await b.post('/v1/account/pgp/start', { publicKey: key.publicKey });
    expect(later.statusCode).toBe(200);
    expect(later.json()).toMatchObject({ challengeId: expect.any(String) });
  });

  it('the hold covers adding a passkey or security key too', async () => {
    const { id, username } = await account();
    const codes = await newCodes(await loggedIn(id));
    const b = new Browser(app);
    const start = now;
    expect((await backup(b, username, 'recovery-code', codes[0]!)).statusCode).toBe(200);
    const holdUntil = new Date(start.getTime() + RECOVERY_HOLD_MS);

    setNow(new Date(holdUntil.getTime() - 1000)); // +23:59:59
    for (const kind of ['passkey', 'security-key'] as const) {
      const early = await b.post('/v1/account/webauthn/start', { kind });
      expect(early.statusCode).toBe(403);
      expect(early.json()).toEqual({ error: 'recovery-hold', holdUntil: holdUntil.toISOString() });
    }
    setNow(holdUntil); // +24:00:00
    for (const kind of ['passkey', 'security-key'] as const) {
      const later = await b.post('/v1/account/webauthn/start', { kind });
      expect(later.statusCode).toBe(200);
      expect(later.json()).toMatchObject({ challengeId: expect.any(String), options: expect.any(Object) });
    }
  });

  it('a recovery-code session is held too (Task 17)', async () => {
    const { id, username } = await account();
    const codes = await newCodes(await loggedIn(id));
    const b = new Browser(app);
    await backup(b, username, 'recovery-code', codes[0]!);
    const res = await b.post('/v1/account/pgp/start', { publicKey: key.publicKey });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'recovery-hold' });
  });

  it('any full session of the account can end it', async () => {
    const { id, username } = await account();
    const codes = await newCodes(await loggedIn(id));
    const b = new Browser(app);
    await backup(b, username, 'recovery-code', codes[0]!);
    const { id: recoveryId } = await sessionRow(b);

    const stranger = await loggedIn((await account()).id);
    const refused = await stranger.delete(`/v1/account/recovery-sessions/${recoveryId}`);
    expect(refused.statusCode).toBe(404);
    // A recovery session cannot cancel itself or another (full sessions only).
    expect((await b.delete(`/v1/account/recovery-sessions/${recoveryId}`)).json()).toEqual({ error: 'recovery-session' });

    const owner = await loggedIn(id, false);
    const ok = await owner.delete(`/v1/account/recovery-sessions/${recoveryId}`);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ ok: true });
    expect(await alerts(id, 'recovery-hold-cancelled')).toEqual([{ sessionId: recoveryId }]);
    const after = await b.post('/v1/account/pgp/start', { publicKey: key.publicKey });
    expect(after.statusCode).toBe(401);
    expect(after.json()).toEqual({ error: 'not-authenticated' });
    // A full session is not a recovery session.
    const { id: fullId } = await sessionRow(owner);
    expect((await owner.delete(`/v1/account/recovery-sessions/${fullId}`)).statusCode).toBe(404);
    expect((await owner.delete('/v1/account/recovery-sessions/not-a-uuid')).statusCode).toBe(404);
  });
});

describe('S-019: the recovery code is an emergency login only (owner G32; lead job J-09)', () => {
  const PASSWORD = 'Correct-Horse-9';

  async function withPassword(accountId: string): Promise<void> {
    const { hash, pepperId } = await hashPassword(deps.config, PASSWORD);
    await deps.db.query('insert into passwords (account_id, hash, pepper_id, updated_at) values ($1, $2, $3, $4)', [accountId, hash, pepperId, now]);
  }

  const accountRow = async (id: string) =>
    (await deps.db.query('select display_name, display_key, login_tag, login_tag_key_id from accounts where id = $1', [id])).rows[0];
  const passwordRow = async (id: string) =>
    (await deps.db.query<{ hash: string; pepper_id: number; updated_at: Date }>('select hash, pepper_id, updated_at from passwords where account_id = $1', [id]))
      .rows[0];
  const holdUntil = async (id: string) =>
    (await deps.db.query<{ hold_until: Date }>('select hold_until from account_holds where account_id = $1', [id])).rows[0]?.hold_until;

  it('changes neither the username nor the password, and the password still logs in', async () => {
    const { id, username } = await account();
    await withPassword(id);
    const codes = await newCodes(await loggedIn(id));
    const names = await accountRow(id);
    const pw = await passwordRow(id);

    expect((await backup(new Browser(app), username, 'recovery-code', codes[0]!)).statusCode).toBe(200);

    expect(await accountRow(id)).toEqual(names);
    expect(await passwordRow(id)).toEqual(pw);
    expect(await verifyPassword(deps.config, { hash: pw!.hash, pepperId: pw!.pepper_id }, PASSWORD)).toBe(true);
    expect(await alerts(id, 'login-method-added')).toEqual([{ method: 'recovery-codes' }]);
  });

  it('the recovery session cannot set a new password during its 24 hours: the password stays', async () => {
    const { id, username } = await account();
    await withPassword(id);
    const codes = await newCodes(await loggedIn(id));
    const pw = await passwordRow(id);
    const b = new Browser(app);
    expect((await backup(b, username, 'recovery-code', codes[0]!)).statusCode).toBe(200);
    const until = new Date(now.getTime() + RECOVERY_HOLD_MS);

    setNow(new Date(until.getTime() - 1000));
    const res = await b.put('/v1/account/password', { password: 'Another-Horse-77' });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'recovery-hold', holdUntil: until.toISOString() });
    expect(await passwordRow(id)).toEqual(pw);
  });

  it('never shortens the 24-hour hold: a second code later moves the end later, never earlier', async () => {
    const { id, username } = await account();
    const codes = await newCodes(await loggedIn(id));
    const first = new Browser(app);
    expect((await backup(first, username, 'recovery-code', codes[0]!)).statusCode).toBe(200);
    const firstEnd = new Date(now.getTime() + RECOVERY_HOLD_MS);
    expect(await holdUntil(id)).toEqual(firstEnd);
    expect((await sessionRow(first)).hold_until).toEqual(firstEnd);

    setNow(at(12 * HOUR));
    const second = new Browser(app);
    expect((await backup(second, username, 'recovery-code', codes[1]!)).statusCode).toBe(200);
    const secondEnd = new Date(now.getTime() + RECOVERY_HOLD_MS);
    expect(await holdUntil(id)).toEqual(secondEnd);
    expect(secondEnd.getTime()).toBeGreaterThan(firstEnd.getTime());
    // The first backup session keeps its own 24 hours.
    expect((await sessionRow(first)).hold_until).toEqual(firstEnd);
    // A recovery session cannot end a hold (only a full session can end a backup session).
    const { id: firstId } = await sessionRow(first);
    expect((await second.delete(`/v1/account/recovery-sessions/${firstId}`)).json()).toEqual({ error: 'recovery-session' });
    expect(await holdUntil(id)).toEqual(secondEnd);
  });
});

describe('I-1: backup login costs the same queries for a known and an unknown login name', () => {
  const count = async (spy: ReturnType<typeof spySql>, run: () => Promise<{ statusCode: number }>) => {
    spy.clear();
    expect((await run()).statusCode).toBe(401);
    // Pool AND checked-out client queries, in order (whitespace normalised), so parity covers the
    // full statement sequence, not just their number or the pool's share.
    const sql = spy.sql();
    expect(sql.length).toBeGreaterThan(0);
    return JSON.stringify(sql);
  };

  // A recovery code is the only backup way in (an authenticator code is refused before any lookup).
  for (const kind of ['recovery-code'] as const) {
    it(`${kind}: with and without a device cookie, and on the miss that reaches the lock`, async () => {
      const { id, username } = await account();
      await withTotp(id);
      await newCodes(await loggedIn(id));
      const ghost = name('ghost');
      const wrong = 'ABCD-EFGH-JKMN-PQRT';
      const method = kind;
      const browser = (withCookie: boolean) => {
        const b = new Browser(app);
        if (withCookie) b.cookies[DEVICE_COOKIE] = randomBytes(32).toString('base64url');
        return b;
      };
      const spy = spySql(deps.db);
      try {
        for (const withCookie of [false, true]) {
          const counts = [
            await count(spy, () => backup(browser(withCookie), username, kind, wrong)),
            await count(spy, () => backup(browser(withCookie), ghost, kind, wrong)),
          ];
          expect(new Set(counts).size, `cookie: ${withCookie}`).toBe(1);
        }
        // The 10th failure in a streak: the login-locked alert for the account, the same work for none.
        const keys = [`${method}:${id}:anon`, `${method}:name:${loginNameLookup(deps.config, ghost).tag}:anon`];
        for (const key of keys) {
          await deps.db.query('delete from login_throttle where key = $1', [key]);
          await deps.db.query('insert into login_throttle (key, failures, last_failure_at) values ($1, 9, $2)', [key, at(-60_000)]);
        }
        const tenth = [
          await count(spy, () => backup(browser(false), username, kind, wrong)),
          await count(spy, () => backup(browser(false), ghost, kind, wrong)),
        ];
        expect(new Set(tenth).size).toBe(1);
      } finally {
        spy.restore();
      }
      expect(await alerts(id, 'login-locked')).toEqual([{ method }]);
    });
  }
});

describe('no patterns in recovery codes (R9)', () => {
  it('10,000 codes are distinct with an even spread at every position', async () => {
    const { id } = await account();
    const b = await loggedIn(id);
    const all = new Set<string>();
    const counts = Array.from({ length: 16 }, () => new Array<number>(32).fill(0));
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    for (let i = 0; i < 1000; i++) {
      for (const c of await newCodes(b)) {
        all.add(c);
        [...c.replaceAll('-', '')].forEach((ch, pos) => counts[pos]![alphabet.indexOf(ch)]!++);
      }
    }
    expect(all.size).toBe(10_000);
    for (const position of counts) {
      const expected = 10_000 / 32;
      const chi = position.reduce((s, c) => s + (c - expected) ** 2 / expected, 0);
      // 31 degrees of freedom; with the TOTP check, about one false alarm in 3,000 runs (R9).
      expect(chi).toBeLessThan(76);
    }
  }, 120_000);
});
