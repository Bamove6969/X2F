import { createHash, randomBytes } from 'node:crypto';
import { normalizeRecoveryCode } from '@x2f/accounts';
import type { FastifyInstance } from 'fastify';
import { Secret } from 'otpauth';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deps } from '../src/app.js';
import { RECOVERY_HOLD_MS, TOTP_BACKUP_DAILY } from '../src/auth/recovery.js';
import { SESSION_COOKIE, requireSession } from '../src/auth/sessions.js';
import { sealSecret } from '../src/auth/totp.js';
import { seedAccount } from './helpers/accounts.js';
import { testApp } from './helpers/app.js';
import { genKey, type Pair } from './helpers/pgpKeys.js';
import { Browser, STEP_MS, addTestLogin, codeAt, wrongCodeAt } from './helpers/totp.js';

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

async function account(o: { kind?: 'trader' | 'staff' | 'owner'; disabled?: boolean } = {}) {
  const username = name();
  const id = await seedAccount(deps, { username, ...o });
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

async function newCodes(b: Browser): Promise<string[]> {
  const res = await b.post('/v1/account/recovery-codes', {});
  expect(res.statusCode).toBe(200);
  return (res.json() as { codes: string[] }).codes;
}

const backup = (b: Browser, username: string, kind: 'totp' | 'recovery-code', code: string) =>
  b.post('/v1/login/backup', { username, kind, code, deviceLabel: 'Backup browser' });

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
    const { rows } = await deps.db.query<{ code_hash: Buffer }>('select code_hash from recovery_codes where account_id = $1', [id]);
    // Hashed in the normalized form that login compares.
    expect(rows.map((r) => r.code_hash.toString('hex')).sort()).toEqual(codes.map((c) => sha(normalizeRecoveryCode(c)!).toString('hex')).sort());
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

describe('backup login with a recovery code', () => {
  it('logs in once as a recovery session with no hold; regenerating invalidates the old set', async () => {
    const { id, username } = await account();
    const owner = await loggedIn(id);
    const codes = await newCodes(owner);

    const b = new Browser(app);
    // Typed in lower case without dashes still works.
    const res = await backup(b, username, 'recovery-code', codes[0]!.toLowerCase().replaceAll('-', ''));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', level: 'recovery', holdUntil: null });
    const row = await sessionRow(b);
    expect(row.level).toBe('recovery');
    expect(row.hold_until).toBeNull();
    expect(await alerts(id, 'recovery-login')).toEqual([{ method: 'recovery-code', deviceLabel: 'Backup browser' }]);

    const again = await backup(new Browser(app), username, 'recovery-code', codes[0]!);
    expect(again.statusCode).toBe(401);
    expect(again.json()).toEqual({ error: 'credentials-invalid' });

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
    const { rows } = await deps.db.query('select used_at from recovery_codes where code_hash = $1', [sha(codes[0]!)]);
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
    for (const kind of ['totp'] as const) {
      const res = await backup(new Browser(app), staffName, kind, '123456');
      expect(res.json()).toEqual({ error: 'credentials-invalid' });
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

describe('backup login with TOTP (P2-I1)', () => {
  it('opens a held recovery session that may add a key only after 24 hours', async () => {
    const { id, username } = await account();
    const secret = await withTotp(id);
    const b = new Browser(app);
    const start = now;
    const res = await backup(b, username, 'totp', codeAt(secret, now));
    expect(res.statusCode).toBe(200);
    const holdUntil = new Date(start.getTime() + RECOVERY_HOLD_MS);
    expect(res.json()).toEqual({ status: 'ok', level: 'recovery', holdUntil: holdUntil.toISOString() });
    const row = await sessionRow(b);
    expect(row.level).toBe('recovery');
    expect(row.hold_until).toEqual(holdUntil);
    expect(await alerts(id, 'recovery-login')).toEqual([
      { method: 'totp', deviceLabel: 'Backup browser', holdUntil: holdUntil.toISOString() },
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
    const secret = await withTotp(id);
    const b = new Browser(app);
    const start = now;
    expect((await backup(b, username, 'totp', codeAt(secret, now))).statusCode).toBe(200);
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

  it('a recovery-code session has no hold', async () => {
    const { id, username } = await account();
    const codes = await newCodes(await loggedIn(id));
    const b = new Browser(app);
    await backup(b, username, 'recovery-code', codes[0]!);
    const res = await b.post('/v1/account/pgp/start', { publicKey: key.publicKey });
    expect(res.statusCode).toBe(200);
  });

  it('any full session of the account can end it', async () => {
    const { id, username } = await account();
    const secret = await withTotp(id);
    const b = new Browser(app);
    await backup(b, username, 'totp', codeAt(secret, now));
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

  it(`the ${TOTP_BACKUP_DAILY + 1}th attempt in one UTC day is refused even with a correct code`, async () => {
    const { id, username } = await account();
    const secret = await withTotp(id);
    for (let i = 0; i < TOTP_BACKUP_DAILY; i++) {
      const res = await backup(new Browser(app), username, 'totp', codeAt(secret, now));
      expect(res.statusCode).toBe(200);
      setNow(at(STEP_MS)); // a fresh step for the next code
    }
    const sixth = await backup(new Browser(app), username, 'totp', codeAt(secret, now));
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json()).toMatchObject({ error: 'slow-down' });
    // The next UTC day it works again.
    const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    setNow(midnight);
    expect((await backup(new Browser(app), username, 'totp', codeAt(secret, now))).statusCode).toBe(200);
  });

  it('two parallel uses of one TOTP code: exactly one logs in', async () => {
    const { id, username } = await account();
    const secret = await withTotp(id);
    const code = codeAt(secret, now);
    // All three read the secret and match the code before any of them moves `last_step`.
    const results = await racing('select secret_enc from totp', 3, () => backup(new Browser(app), username, 'totp', code));
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 401, 401]);
  });

  it('a wrong or replayed code fails like an unknown username', async () => {
    const { id, username } = await account();
    const secret = await withTotp(id);
    const wrong = await backup(new Browser(app), username, 'totp', wrongCodeAt(secret, now));
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toEqual({ error: 'credentials-invalid' });
    const code = codeAt(secret, now);
    expect((await backup(new Browser(app), username, 'totp', code)).statusCode).toBe(200);
    expect((await backup(new Browser(app), username, 'totp', code)).json()).toEqual({ error: 'credentials-invalid' });
    const unknown = await backup(new Browser(app), 'nobody-at-all', 'totp', code);
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json()).toEqual({ error: 'credentials-invalid' });
    const noTotp = await backup(new Browser(app), (await account()).username, 'totp', code);
    expect(noTotp.json()).toEqual({ error: 'credentials-invalid' });
  });

  it('a disabled account gets account-disabled only with a correct code', async () => {
    const { id, username } = await account({ disabled: true });
    const secret = await withTotp(id);
    expect((await backup(new Browser(app), username, 'totp', wrongCodeAt(secret, now))).json()).toEqual({ error: 'credentials-invalid' });
    const res = await backup(new Browser(app), username, 'totp', codeAt(secret, now));
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'account-disabled' });
  });
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
