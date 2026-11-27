import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Secret } from 'otpauth';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deps } from '../src/app.js';
import { SESSION_COOKIE } from '../src/auth/sessions.js';
import { insertPgpKey } from '../src/auth/pgp.js';
import { applyTotp, openSecret, rewrapTotpSecrets, sealSecret, verifyTotp } from '../src/auth/totp.js';
import { subkey } from '../src/config.js';
import { confirmTokenFor, confirmTokenMethod, seedAccount } from './helpers/accounts.js';
import { approvedLogin } from './helpers/approval.js';
import { testApp } from './helpers/app.js';
import { codeOf, decrypt, genKey } from './helpers/pgpKeys.js';
import { createSoftAuthenticator } from './helpers/softAuthenticator.js';
import { Browser, ORIGIN, STEP_MS, addTestLogin, codeAt, wrongCodeAt } from './helpers/totp.js';

const T0 = new Date('2026-10-17T12:00:00Z'); // a step boundary
const HOUR = 3600_000;

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let now = T0;
let step = 0;
let n = 0;

beforeAll(async () => {
  let set: (d: Date) => void;
  ({ app, deps, setNow: set } = await testApp());
  setNow = (d) => {
    now = d;
    set(d);
  };
  addTestLogin(app, deps);
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  // Each test starts an hour later (on a step boundary): budgets refill and throttle streaks end.
  setNow(new Date(T0.getTime() + ++step * HOUR));
  vi.restoreAllMocks();
});

const name = (p = 'totp') => `${p}${String(++n).padStart(4, '0')}`;
const at = (ms: number) => new Date(now.getTime() + ms);

/** A trader (an unused passkey and security key) and a logged-in browser (the creating session, so onboarding applies). */
async function trader(o: { firstSession?: boolean; kind?: 'trader' | 'staff' } = {}) {
  const username = name();
  const id = await seedAccount(deps, { loginName: username, ...(o.kind ? { kind: o.kind } : {}) });
  const b = new Browser(app);
  const res = await b.post('/t/login', { accountId: id, firstSession: o.firstSession ?? true });
  expect(res.statusCode).toBe(200);
  return { id, username, b };
}

/** `replacing`: the account already has TOTP, so even the sign-up window needs a confirm token (review M1). */
async function enrolStart(b: Browser, o: { replacing?: boolean } = {}) {
  const confirmToken = o.replacing ? await confirmTokenFor(deps, b.cookies, { kind: 'add-method', method: 'totp' }) : undefined;
  const res = await b.post('/v1/account/totp/start', confirmToken !== undefined ? { confirmToken } : {});
  expect(res.statusCode).toBe(200);
  return res.json() as { challengeId: string; otpauthUri: string; secret: string };
}

async function enrol(b: Browser, o: { replacing?: boolean } = {}): Promise<string> {
  const s = await enrolStart(b, o);
  const res = await b.post('/v1/account/totp/finish', { challengeId: s.challengeId, code: codeAt(s.secret, now) });
  expect(res.statusCode).toBe(200);
  return s.secret;
}

function chiSquare(counts: number[], total: number): number {
  const expected = total / counts.length;
  return counts.reduce((s, c) => s + (c - expected) ** 2 / expected, 0);
}

describe('TOTP enrolment', () => {
  it('returns an otpauth URI and never stores the secret in the clear', async () => {
    const { id, username, b } = await trader();
    const s = await enrolStart(b);
    expect(s.otpauthUri.startsWith(`otpauth://totp/X2F:D${username}?`)).toBe(true);
    expect(s.otpauthUri).toContain('digits=6&period=30');
    expect(s.otpauthUri).toContain('algorithm=SHA1');
    const raw = Buffer.from(Secret.fromBase32(s.secret).bytes);
    expect(raw).toHaveLength(20);

    const forms = [s.secret, raw.toString('hex'), raw.toString('base64'), raw.toString('base64url')];
    const { rows: ch } = await deps.db.query<{ payload: object }>('select payload from challenges where id = $1', [s.challengeId]);
    const payload = JSON.stringify(ch[0]!.payload);
    for (const f of forms) expect(payload).not.toContain(f);
    expect(Buffer.from(payload).indexOf(raw)).toBe(-1);

    const finish = await b.post('/v1/account/totp/finish', { challengeId: s.challengeId, code: codeAt(s.secret, now) });
    expect(finish.statusCode).toBe(200);
    const { rows } = await deps.db.query<{ secret_enc: Buffer }>('select secret_enc from totp where account_id = $1', [id]);
    expect(rows[0]!.secret_enc.indexOf(raw)).toBe(-1);
    for (const f of forms) expect(rows[0]!.secret_enc.toString('latin1')).not.toContain(f);
    expect(Buffer.from(openSecret(deps, id, rows[0]!.secret_enc))).toEqual(raw);
    // FU-C: the key-store format, under the current X2F_TOTP_KEYS key.
    const current = deps.config.totpKeys.current;
    expect([...rows[0]!.secret_enc.subarray(0, 3)]).toEqual([0x01, current >> 8, current & 0xff]);
    const { rows: alerts } = await deps.db.query('select detail from alerts where account_id = $1 and kind = $2', [id, 'login-method-added']);
    expect(alerts.map((r) => r.detail)).toEqual([{ method: 'totp' }]);
  });

  it('lets a wrong code be retried until the challenge is used or expires; refuses another session', async () => {
    const { b } = await trader();
    const s = await enrolStart(b);
    const wrong = await b.post('/v1/account/totp/finish', { challengeId: s.challengeId, code: wrongCodeAt(s.secret, now) });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toEqual({ error: 'code-invalid' });
    const right = await b.post('/v1/account/totp/finish', { challengeId: s.challengeId, code: codeAt(s.secret, now) });
    expect(right.statusCode).toBe(200);
    const again = await b.post('/v1/account/totp/finish', { challengeId: s.challengeId, code: codeAt(s.secret, now) });
    expect(again.json()).toEqual({ error: 'challenge-expired' });

    const late = await enrolStart(b, { replacing: true });
    setNow(at(5 * 60_000));
    const expired = await b.post('/v1/account/totp/finish', { challengeId: late.challengeId, code: codeAt(late.secret, now) });
    expect(expired.json()).toEqual({ error: 'challenge-expired' });

    const s2 = await enrolStart(b, { replacing: true });
    const other = await trader();
    const res = await other.b.post('/v1/account/totp/finish', { challengeId: s2.challengeId, code: codeAt(s2.secret, now) });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'challenge-expired' });
  });

  it('throttles wrong codes on the totp key without using the challenge up', async () => {
    const { id, b } = await trader();
    const s = await enrolStart(b);
    for (let i = 1; i <= 4; i++) {
      const res = await b.post('/v1/account/totp/finish', { challengeId: s.challengeId, code: wrongCodeAt(s.secret, now) });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'code-invalid' });
    }
    // The 4th failure starts a 2 s wait: a wrong code and even the right one are refused meanwhile.
    const wrong = await b.post('/v1/account/totp/finish', { challengeId: s.challengeId, code: wrongCodeAt(s.secret, now) });
    expect(wrong.statusCode).toBe(429);
    expect(wrong.json()).toMatchObject({ error: 'slow-down' });
    const slowed = await b.post('/v1/account/totp/finish', { challengeId: s.challengeId, code: codeAt(s.secret, now) });
    expect(slowed.statusCode).toBe(429);
    expect(slowed.json()).toMatchObject({ error: 'slow-down' });
    // A refused check uses nothing up and adds no failure.
    const { rows: open } = await deps.db.query('select 1 from challenges where id = $1 and used_at is null', [s.challengeId]);
    expect(open).toHaveLength(1);
    const { rows: streak } = await deps.db.query<{ failures: number }>(
      `select failures from login_throttle where key like 'totp:' || $1 || ':%'`,
      [id],
    );
    expect(streak.map((r) => r.failures)).toEqual([4]);

    // After the wait the right code enrols on the same challenge and clears the streak.
    setNow(at(3_000));
    const right = await b.post('/v1/account/totp/finish', { challengeId: s.challengeId, code: codeAt(s.secret, now) });
    expect(right.statusCode).toBe(200);
    expect(right.json()).toEqual({ ok: true });
    const { rows: cleared } = await deps.db.query(`select 1 from login_throttle where key like 'totp:' || $1 || ':%'`, [id]);
    expect(cleared).toHaveLength(0);
  });

  it('locks enrolment after 10 wrong codes in a streak, within one challenge', async () => {
    const { b } = await trader();
    const s = await enrolStart(b);
    // Waits after failures 4-9 are 2, 4, 8, 16, 30, 30 s: wait each out, all inside the 5-minute challenge.
    const waits = [0, 0, 0, 2, 4, 8, 16, 30, 30, 0];
    for (const w of waits) {
      const res = await b.post('/v1/account/totp/finish', { challengeId: s.challengeId, code: wrongCodeAt(s.secret, now) });
      expect(res.statusCode).toBe(401);
      setNow(at(w * 1000 + 500));
    }
    // 10 failures → a 30 s lock: the right code is refused while it runs.
    const locked = await b.post('/v1/account/totp/finish', { challengeId: s.challengeId, code: codeAt(s.secret, now) });
    expect(locked.statusCode).toBe(429);
    expect(locked.json()).toMatchObject({ error: 'locked' });
  });

  it('keeps at most 3 open enrolments per session, replacing the oldest', async () => {
    const { b } = await trader();
    const starts = [await enrolStart(b), await enrolStart(b), await enrolStart(b), await enrolStart(b)];
    const { rows } = await deps.db.query(
      `select 1 from challenges where purpose = 'add-totp' and used_at is null and session_id = (
         select session_id from challenges where id = $1)`,
      [starts[0]!.challengeId],
    );
    expect(rows).toHaveLength(3);
    const first = await b.post('/v1/account/totp/finish', { challengeId: starts[0]!.challengeId, code: codeAt(starts[0]!.secret, now) });
    expect(first.json()).toEqual({ error: 'challenge-expired' });
    const second = await b.post('/v1/account/totp/finish', { challengeId: starts[1]!.challengeId, code: codeAt(starts[1]!.secret, now) });
    expect(second.statusCode).toBe(200);
  });

  it('a sealed secret is bound to its account: swapped rows fail closed', async () => {
    const a = await trader();
    const b = await trader();
    const secretA = await enrol(a.b);
    await enrol(b.b);
    setNow(at(STEP_MS));
    await deps.db.query('update totp set secret_enc = (select secret_enc from totp where account_id = $1) where account_id = $2', [a.id, b.id]);
    expect(await verifyTotp(deps, b.id, codeAt(secretA, now))).toBe(false);
    expect(await verifyTotp(deps, a.id, codeAt(secretA, now))).toBe(true);
  });

  it('needs a confirm token outside onboarding', async () => {
    const { b } = await trader({ firstSession: false });
    const res = await b.post('/v1/account/totp/start', {});
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'confirm-required', action: 'add-method' });
  });

  it('is refused for staff by assertMethodAllowed (R2, staff → method-not-allowed)', async () => {
    const { b } = await trader({ kind: 'staff' });
    const res = await b.post('/v1/account/totp/start', {});
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'method-not-allowed' });
  });
});

/**
 * Owner, 26 Nov 2026 (no passwords): an account holds at most one authenticator app; it counts as a
 * kind of login method toward the two an account holds, and never confirms. Owner, 27 Nov 2026: it
 * logs in only with the private login name, at `POST /v1/login/totp` (below), never as a backup
 * login (no recovery-code powers) and never as a second step.
 */
describe('one authenticator app, never a backup or a confirm (owner 26-27 Nov 2026)', () => {
  it('an authenticator code is no backup login, no second-factor step and no confirm', async () => {
    const { b, username } = await trader();
    const secret = await enrol(b);
    const other = new Browser(app);
    const backup = await other.post('/v1/login/backup', { loginName: username, kind: 'totp', code: codeAt(secret, now), deviceLabel: 'x' });
    expect([backup.statusCode, backup.json()]).toEqual([403, { error: 'method-not-allowed' }]);
    expect((await other.post('/v1/login/second-factor', { pendingId: '00000000-0000-0000-0000-000000000000', code: codeAt(secret, now) })).statusCode).toBe(404);
    expect((await b.post('/v1/confirm/totp', { code: codeAt(secret, now), action: { kind: 'extend-session' } })).statusCode).toBe(404);
  });

  it('a second enrolment replaces the first: one app per account', async () => {
    const { id, b } = await trader();
    const first = await enrol(b);
    const second = await enrol(b, { replacing: true });
    expect(second).not.toBe(first);
    const { rows } = await deps.db.query<{ secret_enc: Buffer }>('select secret_enc from totp where account_id = $1', [id]);
    expect(rows).toHaveLength(1);
    expect(Buffer.from(openSecret(deps, id, rows[0]!.secret_enc)).length).toBeGreaterThan(0);
  });
});

const hasTotpRow = async (id: string) => (await deps.db.query('select 1 from totp where account_id = $1', [id])).rows.length > 0;

describe('verifyTotp replay order (P2-I2)', () => {
  it('accepts each step once, never one at or below the last accepted step', async () => {
    const S = now;
    const { id, b } = await trader();
    setNow(new Date(S.getTime() - 3 * STEP_MS)); // enrolled at S-3
    const secret = await enrol(b);
    setNow(new Date(S.getTime() + 5_000)); // inside step S
    const sMinus1 = codeAt(secret, new Date(S.getTime() - STEP_MS));
    const s0 = codeAt(secret, S);
    expect(await verifyTotp(deps, id, sMinus1)).toBe(true);
    expect(await verifyTotp(deps, id, sMinus1)).toBe(false);
    expect(await verifyTotp(deps, id, s0)).toBe(true);
    expect(await verifyTotp(deps, id, s0)).toBe(false);
    expect(await verifyTotp(deps, id, sMinus1)).toBe(false);

    // A code from S-2 (-60 s) is outside the window, even on a fresh enrolment.
    const fresh = await trader();
    setNow(new Date(S.getTime() - 4 * STEP_MS));
    const secret2 = await enrol(fresh.b);
    setNow(new Date(S.getTime() + 5_000));
    expect(await verifyTotp(deps, fresh.id, codeAt(secret2, new Date(S.getTime() - 2 * STEP_MS)))).toBe(false);
    expect(await verifyTotp(deps, fresh.id, codeAt(secret2, new Date(S.getTime() + STEP_MS)))).toBe(true); // +1 step is in
    expect(await verifyTotp(deps, fresh.id, 'abcdef')).toBe(false);
  });

  it('is false for an account without TOTP', async () => {
    const id = await seedAccount(deps, { loginName: name() });
    expect(await verifyTotp(deps, id, '123456')).toBe(false);
  });
});

describe('no patterns in TOTP secrets (R9)', () => {
  it('1,000 enrolments give 1,000 distinct secrets with an even byte spread', async () => {
    const secrets = new Set<string>();
    const counts = new Array<number>(256).fill(0);
    const accounts = await Promise.all(Array.from({ length: 10 }, () => trader()));
    for (const { b } of accounts) {
      for (let i = 0; i < 100; i++) {
        const { secret } = await enrolStart(b); // re-enrolling the same account each time
        secrets.add(secret);
        for (const byte of Secret.fromBase32(secret).bytes) counts[byte]!++;
      }
    }
    expect(secrets.size).toBe(1000);
    // 255 degrees of freedom; 345 is about 4 standard deviations above the mean.
    expect(chiSquare(counts, 20_000)).toBeLessThan(345);
  }, 120_000);

  it('the same login name at different times never gets the same secret', async () => {
    const username = name('same');
    const first = await seedAccount(deps, { loginName: username });
    const b1 = new Browser(app);
    await b1.post('/t/login', { accountId: first, firstSession: true });
    const s1 = await enrol(b1);
    await deps.db.query('delete from accounts where id = $1', [first]);
    setNow(at(HOUR / 2));
    const second = await seedAccount(deps, { loginName: username });
    const b2 = new Browser(app);
    await b2.post('/t/login', { accountId: second, firstSession: true });
    const s2 = await enrol(b2);
    expect(s2).not.toBe(s1);
    setNow(at(STEP_MS));
    expect(await enrol(b2, { replacing: true })).not.toBe(s2);
  });
});

describe('TOTP key store (FU-C, ASVS 2.8.2)', () => {
  /** A secret as Plan 2 sealed it under subkey('totp'), marked format 0 by migration 011. */
  function legacySealed(accountId: string, raw: Uint8Array): Buffer {
    const nonce = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', subkey(deps.config, 'totp'), nonce, { authTagLength: 16 });
    c.setAAD(Buffer.from(`x2f/totp/${accountId}`, 'utf8'));
    const body = Buffer.concat([c.update(raw), c.final()]);
    return Buffer.concat([Buffer.from([0]), nonce, body, c.getAuthTag()]);
  }
  const insertTotp = (accountId: string, sealed: Buffer) =>
    deps.db.query('insert into totp (account_id, secret_enc, created_at) values ($1, $2, $3)', [accountId, sealed, now]);
  const sealedOf = async (accountId: string) =>
    (await deps.db.query<{ secret_enc: Buffer }>('select secret_enc from totp where account_id = $1', [accountId])).rows[0]!.secret_enc;
  const base32 = (raw: Uint8Array) => new Secret({ buffer: new Uint8Array(raw).buffer }).base32;

  it('a format-0 secret (sealed under X2F_SERVER_KEY before FU-C) still verifies until rewrapped', async () => {
    const { id } = await trader();
    const raw = new Uint8Array(randomBytes(20));
    await insertTotp(id, legacySealed(id, raw));
    expect(await verifyTotp(deps, id, codeAt(base32(raw), now))).toBe(true);
  });

  it('with X2F_LEGACY_SECRETS=off a format-0 secret fails closed and is not rewrapped (review M1)', async () => {
    const { id } = await trader();
    const raw = new Uint8Array(randomBytes(20));
    const sealed = legacySealed(id, raw);
    await insertTotp(id, sealed);
    deps.config.legacySecrets = false;
    try {
      expect(await verifyTotp(deps, id, codeAt(base32(raw), now))).toBe(false);
      expect((await rewrapTotpSecrets(deps)).failed).toBeGreaterThanOrEqual(1);
      expect(await sealedOf(id)).toEqual(sealed);
    } finally {
      deps.config.legacySecrets = true;
    }
    expect(await verifyTotp(deps, id, codeAt(base32(raw), now))).toBe(true);
  });

  it('rewrapTotpSecrets moves format-0 and older-key secrets to the current key, once, and leaves unopenable ones', async () => {
    const saved = deps.config.totpKeys;
    const rotated = { current: 7, keys: new Map([[7, new Uint8Array(randomBytes(32))], ...saved.keys]) };
    const legacy = await trader();
    const older = await trader();
    const broken = await trader();
    const rawLegacy = new Uint8Array(randomBytes(20));
    const rawOlder = new Uint8Array(randomBytes(20));
    await insertTotp(legacy.id, legacySealed(legacy.id, rawLegacy));
    await insertTotp(older.id, sealSecret(deps, older.id, rawOlder)); // under the ring's key before rotation
    const bad = sealSecret(deps, broken.id, new Uint8Array(randomBytes(20)));
    bad[bad.length - 1]! ^= 1;
    await insertTotp(broken.id, bad);
    try {
      deps.config.totpKeys = rotated;
      const first = await rewrapTotpSecrets(deps);
      expect(first.rewrapped).toBeGreaterThanOrEqual(2);
      expect(first.failed).toBeGreaterThanOrEqual(1);
      for (const [id, raw] of [[legacy.id, rawLegacy], [older.id, rawOlder]] as const) {
        const sealed = await sealedOf(id);
        expect([...sealed.subarray(0, 3)]).toEqual([0x01, 0x00, 0x07]);
        expect(Buffer.from(openSecret(deps, id, sealed))).toEqual(Buffer.from(raw));
      }
      expect(await sealedOf(broken.id)).toEqual(bad);
      expect(await rewrapTotpSecrets(deps)).toEqual({ rewrapped: 0, failed: first.failed });
      // The old key can now leave the ring: the rewrapped secrets open with the new key alone.
      deps.config.totpKeys = { current: 7, keys: new Map([[7, rotated.keys.get(7)!]]) };
      setNow(at(STEP_MS));
      expect(await verifyTotp(deps, older.id, codeAt(base32(rawOlder), now))).toBe(true);
      expect(await verifyTotp(deps, legacy.id, codeAt(base32(rawLegacy), now))).toBe(true);
    } finally {
      deps.config.totpKeys = saved;
    }
  });

  it('rewrap never overwrites a secret replaced since it was read', async () => {
    const saved = deps.config.totpKeys;
    const { id } = await trader();
    await insertTotp(id, legacySealed(id, new Uint8Array(randomBytes(20))));
    const replacement = sealSecret(deps, id, new Uint8Array(randomBytes(20)));
    const query = deps.db.query.bind(deps.db) as (text: string, values?: unknown[]) => Promise<unknown>;
    let swapped = false;
    const spy = vi.spyOn(deps.db, 'query').mockImplementation((async (text: string, values?: unknown[]) => {
      if (!swapped && text.startsWith('update totp set secret_enc')) {
        swapped = true;
        await query('update totp set secret_enc = $2 where account_id = $1', [id, replacement]);
      }
      return query(text, values);
    }) as never);
    try {
      deps.config.totpKeys = { current: 8, keys: new Map([[8, new Uint8Array(randomBytes(32))], ...saved.keys]) };
      await rewrapTotpSecrets(deps);
    } finally {
      spy.mockRestore();
      deps.config.totpKeys = saved;
    }
    expect(await sealedOf(id)).toEqual(replacement);
  });
});

/** A known authenticator secret written straight to `totp` (for kinds that cannot enrol: staff). Returns its base32. */
async function seedTotp(id: string): Promise<string> {
  const bytes = new Uint8Array(randomBytes(20));
  await applyTotp(deps.db, id, sealSecret(deps, id, bytes), 0, now);
  return new Secret({ buffer: bytes.buffer }).base32;
}

const totpLogin = (b: Browser, loginName: string, code: string) => b.post('/v1/login/totp', { loginName, code, deviceLabel: 'Firefox on Linux' });

/**
 * Owner, 27 Nov 2026 (Jess, 01:04 UTC): "Ours will just be a user ID and otp because user ID is
 * secret". A trader logs in with the private login name plus the authenticator code: a normal full
 * session, with approve-on-device, the throttle and the D-059 lock as every other login, and still
 * never a confirm.
 */
describe('login name + authenticator code logs a trader in (owner 27 Nov 2026)', () => {
  it('opens a full session when the account is logged in nowhere else; the code works once', async () => {
    const { id, username, b } = await trader();
    const secret = await enrol(b);
    await b.post('/v1/logout');
    setNow(at(STEP_MS)); // the enrolment's step is used
    const code = codeAt(secret, now);
    const c = new Browser(app);
    const res = await totpLogin(c, username, code);
    expect([res.statusCode, res.json()]).toEqual([200, { status: 'ok' }]);
    expect(c.cookies[SESSION_COOKIE]).toBeDefined();
    expect((await c.get('/v1/account/me')).statusCode).toBe(200);
    const { rows } = await deps.db.query<{ detail: { method: string } }>(`select detail from alerts where account_id = $1 and kind = 'new-login'`, [id]);
    expect(rows.map((r) => r.detail.method)).toContain('totp');
    // The same code again, from another browser: refused like a wrong code (no replay).
    const replay = await totpLogin(new Browser(app), username, code);
    expect([replay.statusCode, replay.json()]).toEqual([401, { error: 'credentials-invalid' }]);
  });

  it('a new browser waits for approval on the logged-in device, and that approval offers no chat keys', async () => {
    const { username, b } = await trader();
    const secret = await enrol(b);
    setNow(at(STEP_MS));
    const c = new Browser(app);
    const res = await totpLogin(c, username, codeAt(secret, now));
    expect(res.statusCode).toBe(200);
    const wait = res.json() as { status: string; approvalId: string };
    expect(wait.status).toBe('approve-on-device');
    expect(c.cookies[SESSION_COOKIE]).toBeUndefined();
    const view = (await b.get(`/v1/account/approvals/${wait.approvalId}`)).json() as { keysOffered: boolean };
    expect(view.keysOffered).toBe(false);
    expect(await approvedLogin(deps, res, (url) => c.post(url))).toEqual({ status: 'ok' });
    expect((await c.get('/v1/account/me')).statusCode).toBe(200);
  });

  it('a wrong code, a wrong name, an account without an app and a staff account all get the same refusal', async () => {
    const { username, b } = await trader();
    const secret = await enrol(b);
    setNow(at(STEP_MS));
    const plain = await trader();
    const staffName = name('staff');
    const staffId = await seedAccount(deps, { loginName: staffName, kind: 'staff' });
    const staffSecret = await seedTotp(staffId);
    const answers = [
      await totpLogin(new Browser(app), username, wrongCodeAt(secret, now)),
      await totpLogin(new Browser(app), `${username}x`, codeAt(secret, now)),
      await totpLogin(new Browser(app), plain.username, codeAt(secret, now)),
      await totpLogin(new Browser(app), staffName, codeAt(staffSecret, now)),
      await totpLogin(new Browser(app), 'not a name!', '123456'),
    ];
    for (const r of answers) expect([r.statusCode, r.json()]).toEqual([401, { error: 'credentials-invalid' }]);
    // The trader's own code was never spent by those tries.
    const ok = await totpLogin(new Browser(app), username, codeAt(secret, now));
    expect((ok.json() as { status: string }).status).toBe('approve-on-device');
  });

  it('wrong codes slow down, then lock, with retryAfterSeconds; the right code waits too', async () => {
    const { id, username, b } = await trader();
    const secret = await enrol(b);
    setNow(at(STEP_MS));
    const c = new Browser(app);
    const waits = [0, 0, 0, 2, 4, 8, 16, 30, 30, 0];
    for (const [i, w] of waits.entries()) {
      const res = await totpLogin(c, username, wrongCodeAt(secret, now));
      expect(res.statusCode, `try ${i + 1}`).toBe(401);
      if (i === 3) {
        const slowed = await totpLogin(c, username, codeAt(secret, now));
        expect(slowed.statusCode).toBe(429);
        expect(slowed.json()).toMatchObject({ error: 'slow-down', retryAfterSeconds: 2 });
      }
      setNow(at(w * 1000 + 500));
    }
    const locked = await totpLogin(c, username, codeAt(secret, now));
    expect(locked.statusCode).toBe(429);
    expect(locked.json()).toMatchObject({ error: 'locked' });
    expect((locked.json() as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThan(0);
    const { rows } = await deps.db.query(`select 1 from alerts where account_id = $1 and kind = 'login-locked' and detail->>'method' = 'totp'`, [id]);
    expect(rows).toHaveLength(1);
  });

  it('a disabled account (the D-059 compromised lock sets disabled_at) is refused after the right code only', async () => {
    const { id, username, b } = await trader();
    const secret = await enrol(b);
    setNow(at(STEP_MS));
    await deps.db.query('update accounts set disabled_at = $2 where id = $1', [id, now]);
    const wrong = await totpLogin(new Browser(app), username, wrongCodeAt(secret, now));
    expect([wrong.statusCode, wrong.json()]).toEqual([401, { error: 'credentials-invalid' }]);
    const c = new Browser(app);
    const right = await totpLogin(c, username, codeAt(secret, now));
    expect([right.statusCode, right.json()]).toEqual([403, { error: 'account-disabled' }]);
    expect(c.cookies[SESSION_COOKIE]).toBeUndefined();
  });

  it('the session it opens still needs a key to confirm a change: there is no TOTP confirm', async () => {
    const { username, b } = await trader();
    const secret = await enrol(b);
    await b.post('/v1/logout');
    setNow(at(STEP_MS));
    const c = new Browser(app);
    expect((await totpLogin(c, username, codeAt(secret, now))).json()).toEqual({ status: 'ok' });
    // Replacing the app (a login-method change) asks for a confirm, and the authenticator cannot give one.
    const change = await c.post('/v1/account/totp/start', {});
    expect([change.statusCode, change.json()]).toEqual([403, { error: 'confirm-required', action: 'add-method' }]);
    setNow(at(STEP_MS));
    expect((await c.post('/v1/confirm/totp', { code: codeAt(secret, now), action: { kind: 'add-method', method: 'totp' } })).statusCode).toBe(404);
  });
});
