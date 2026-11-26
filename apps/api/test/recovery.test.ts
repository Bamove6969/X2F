import { createHash, createHmac, randomBytes } from 'node:crypto';
import { newRecoveryCode, normalizeRecoveryCode } from '@x2f/accounts';
import type { FastifyInstance } from 'fastify';
import { Secret } from 'otpauth';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deps } from '../src/app.js';
import { loginNameLookup } from '../src/accounts.js';
import { DEVICE_COOKIE } from '../src/auth/device.js';
import { RECOVERY_WINDOW_MS, SESSION_COOKIE } from '../src/auth/sessions.js';
import { sealSecret } from '../src/auth/totp.js';
import { confirmTokenFor, seedAccount } from './helpers/accounts.js';
import { testApp } from './helpers/app.js';
import { genKey, type Pair } from './helpers/pgpKeys.js';
import { spySql } from './helpers/sqlSpy.js';
import { Browser, STEP_MS, addTestLogin, codeAt, wrongCodeAt } from './helpers/totp.js';

const T0 = new Date('2026-10-17T06:00:00Z'); // a step boundary, early in the UTC day
const HOUR = 3600_000;
// Owner demo note, 12 Nov 2026 (/setup/backup): the recovery code is about four times longer than
// the old 16 symbols: 64 Crockford base32 symbols in 16 groups of four (320 bits).
const CODE = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){15}$/;

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

/** `replacing`: the account already holds a code, so even the sign-up window needs a confirm token (review M1). */
async function newCodes(b: Browser, o: { replacing?: boolean } = {}): Promise<string[]> {
  const confirmToken = o.replacing ? await confirmTokenFor(deps, b.cookies, { kind: 'new-recovery-codes' }) : undefined;
  const res = await b.post('/v1/account/recovery-codes', confirmToken !== undefined ? { confirmToken } : {});
  expect(res.statusCode).toBe(200);
  return (res.json() as { codes: string[] }).codes;
}

const backup = (b: Browser, username: string, kind: 'totp' | 'recovery-code', code: string) =>
  b.post('/v1/login/backup', { loginName: username, kind, code, deviceLabel: 'Backup browser' });

async function sessionRow(b: Browser) {
  const token = b.cookies[SESSION_COOKIE]!;
  const { rows } = await deps.db.query<{ id: string; level: string; recovery_until: Date | null }>(
    'select id, level, recovery_until from sessions where token_hash = $1',
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
  it('returns one code (hold model v3) of 64 symbols, stored only as its keyed hash', async () => {
    const { id } = await account();
    const codes = await newCodes(await loggedIn(id));
    expect(codes).toHaveLength(1);
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
    await newCodes(await loggedIn(id), { replacing: true });
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
  // Owner 26 Nov 2026 (no holds): the recovery-code login logs everyone out and opens a full session
  // that may change everything without a confirm for an hour.
  it('logs in once as a full session with an hour to change everything, and logs the account out; regenerating invalidates the old code', async () => {
    const { id, username } = await account();
    const owner = await loggedIn(id);
    const [old] = await newCodes(owner);
    const codes = await newCodes(owner, { replacing: true });
    expect((await backup(new Browser(app), username, 'recovery-code', old!)).json()).toEqual({ error: 'credentials-invalid' });

    const b = new Browser(app);
    // Typed in lower case without dashes still works.
    const res = await backup(b, username, 'recovery-code', codes[0]!.toLowerCase().replaceAll('-', ''));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
    const row = await sessionRow(b);
    expect(row.level).toBe('full');
    expect(row.recovery_until).toEqual(new Date(now.getTime() + RECOVERY_WINDOW_MS));
    expect(await alerts(id, 'recovery-login')).toEqual([{ method: 'recovery-code', deviceLabel: 'Backup browser' }]);
    expect((await owner.get('/v1/account/me')).statusCode).toBe(401);

    const again = await backup(new Browser(app), username, 'recovery-code', codes[0]!);
    expect(again.statusCode).toBe(401);
    expect(again.json()).toEqual({ error: 'credentials-invalid' });
  });

  it('the long code logs in exactly as shown, dashes and all (79 characters), and once only', async () => {
    const { id, username } = await account();
    const [code] = await newCodes(await loggedIn(id));
    expect(code).toHaveLength(79);
    const res = await backup(new Browser(app), username, 'recovery-code', code!);
    expect(res.statusCode).toBe(200);
    expect((await backup(new Browser(app), username, 'recovery-code', code!)).statusCode).toBe(401);
  });

  it('a code of the old 16-symbol format, stored before the change, still logs in once', async () => {
    const { id, username } = await account();
    const old = 'K7M2-9QXA-4FTR-8WPN';
    const keyId = deps.config.recoveryCodeKeys.current;
    await deps.db.query('insert into recovery_codes (account_id, code_hash, key_id) values ($1, $2, $3)', [id, currentKeyed(id, old), keyId]);
    expect((await backup(new Browser(app), username, 'recovery-code', old.toLowerCase())).statusCode).toBe(200);
    expect((await backup(new Browser(app), username, 'recovery-code', old)).statusCode).toBe(401);
  });

  it('inside its hour the recovery-code login makes a new code and adds methods without a confirm; after it, a confirm is needed', async () => {
    const { id, username } = await account();
    const codes = await newCodes(await loggedIn(id));
    const b = new Browser(app);
    expect((await backup(b, username, 'recovery-code', codes[0]!)).statusCode).toBe(200);
    expect((await b.post('/v1/account/recovery-codes', {})).statusCode).toBe(200);
    expect((await b.post('/v1/account/totp/start', {})).statusCode).toBe(200);
    expect((await b.post('/v1/account/pgp/start', { publicKey: key.publicKey })).statusCode).toBe(200);
    setNow(at(RECOVERY_WINDOW_MS));
    expect((await b.post('/v1/account/recovery-codes', {})).statusCode).toBe(403);
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
    // An authenticator code alone is no backup login for anyone (hold model v3): the same answer for every name.
    for (const u of [staffName, username, 'nobody-at-all']) {
      expect((await backup(new Browser(app), u, 'totp', '123456')).json()).toEqual({ error: 'method-not-allowed' });
    }
  });

  it('two parallel uses of one code: exactly one logs in', async () => {
    const { id, username } = await account();
    const codes = await newCodes(await loggedIn(id));
    // All three find the code unused before any of them marks it, so only the guarded update decides.
    const results = await racing('select id from recovery_codes', 3, () => backup(new Browser(app), username, 'recovery-code', codes[0]!));
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 401, 401]);
  });

  it('wrong codes are throttled on the recovery-code key; a correct code still gets in (owner S-109, recoveryRulings.test.ts)', async () => {
    const { id, username } = await account();
    const codes = await newCodes(await loggedIn(id));
    const b = new Browser(app);
    for (let i = 0; i < 4; i++) {
      expect((await backup(b, username, 'recovery-code', 'ABCD-EFGH-JKMN-PQRT')).statusCode).toBe(401);
    }
    const wrong = await backup(b, username, 'recovery-code', 'ABCD-EFGH-JKMN-PQRS');
    expect(wrong.statusCode).toBe(429);
    expect(wrong.json()).toMatchObject({ error: 'slow-down' });
    // Owner S-109 (p11-34, 9 Nov 2026): "a correct recovery code always gets in".
    const res = await backup(b, username, 'recovery-code', codes[0]!);
    expect(res.statusCode).toBe(200);
  });
});

describe('the authenticator app is no backup login', () => {
  it('an authenticator code alone is no backup login any more (hold model v3): 403 method-not-allowed, right code or wrong, nothing checked', async () => {
    const { id, username } = await account();
    const secret = await withTotp(id);
    const verify = vi.spyOn(deps.db, 'query');
    for (const code of [codeAt(secret, now), wrongCodeAt(secret, now)]) {
      const b = new Browser(app);
      const res = await backup(b, username, 'totp', code);
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'method-not-allowed' });
      expect(b.cookies[SESSION_COOKIE]).toBeUndefined();
    }
    expect(verify.mock.calls.some(([q]) => String(q).includes('from totp'))).toBe(false);
    verify.mockRestore();
    expect(await alerts(id, 'recovery-login')).toEqual([]);
  });

});

describe('S-019: the recovery code is an emergency login only (owner G32; lead job J-09)', () => {
  const accountRow = async (id: string) =>
    (await deps.db.query('select trade_tag, display_key, login_tag, login_tag_key_id from accounts where id = $1', [id])).rows[0];

  it('changes neither the username nor the Trade Tag', async () => {
    const { id, username } = await account();
    const codes = await newCodes(await loggedIn(id));
    const names = await accountRow(id);
    expect((await backup(new Browser(app), username, 'recovery-code', codes[0]!)).statusCode).toBe(200);
    expect(await accountRow(id)).toEqual(names);
    expect(await alerts(id, 'login-method-added')).toEqual([{ method: 'recovery-codes' }]);
  });

  it('there is one code: a second recovery login with it is refused', async () => {
    const { id, username } = await account();
    const codes = await newCodes(await loggedIn(id));
    expect(codes).toHaveLength(1);
    expect((await backup(new Browser(app), username, 'recovery-code', codes[0]!)).statusCode).toBe(200);
    setNow(at(12 * HOUR));
    expect((await backup(new Browser(app), username, 'recovery-code', codes[0]!)).statusCode).toBe(401);
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

  // An authenticator code alone is refused before any lookup (hold model v3), so only the recovery code is checked here.
  for (const kind of ['recovery-code'] as const) {
    it(`${kind}: with and without a device cookie, and on the miss that reaches the lock`, async () => {
      const { id, username } = await account();
      const secret = await withTotp(id);
      await newCodes(await loggedIn(id));
      const ghost = name('ghost');
      void secret;
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
    // Hold model v3: the route makes one code at a time, each from `newRecoveryCode` (checked once through it here).
    const { id } = await account();
    expect((await newCodes(await loggedIn(id)))[0]).toMatch(CODE);
    const all = new Set<string>();
    const counts = Array.from({ length: 64 }, () => new Array<number>(32).fill(0));
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    for (let i = 0; i < 10_000; i++) {
      const c = newRecoveryCode();
      all.add(c);
      [...c.replaceAll('-', '')].forEach((ch, pos) => counts[pos]![alphabet.indexOf(ch)]!++);
    }
    expect(all.size).toBe(10_000);
    for (const position of counts) {
      const expected = 10_000 / 32;
      const chi = position.reduce((s, c) => s + (c - expected) ** 2 / expected, 0);
      // 31 degrees of freedom. With 64 positions (the 64-symbol code, 12 Nov 2026) at this threshold,
      // about one false alarm in 1,500 runs, plus the TOTP check's share (R9; review I-1).
      expect(chi).toBeLessThan(76);
    }
  });
});
