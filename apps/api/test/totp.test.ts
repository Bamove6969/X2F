import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { Secret } from 'otpauth';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deps } from '../src/app.js';
import { SESSION_COOKIE } from '../src/auth/sessions.js';
import { hashPassword } from '../src/auth/password.js';
import { insertPgpKey } from '../src/auth/pgp.js';
import { applyTotp, openSecret, rewrapTotpSecrets, sealSecret, verifyTotp } from '../src/auth/totp.js';
import { subkey } from '../src/config.js';
import { confirmTokenMethod, seedAccount } from './helpers/accounts.js';
import { approvedLogin } from './helpers/approval.js';
import { testApp } from './helpers/app.js';
import { codeOf, decrypt, genKey } from './helpers/pgpKeys.js';
import { createSoftAuthenticator } from './helpers/softAuthenticator.js';
import { Browser, ORIGIN, STEP_MS, addTestLogin, codeAt, wrongCodeAt } from './helpers/totp.js';

const T0 = new Date('2026-10-17T12:00:00Z'); // a step boundary
const HOUR = 3600_000;
const GOOD = 'Correct-Horse-9';

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let now = T0;
let step = 0;
let goodHash: { hash: string; pepperId: number };
let n = 0;

beforeAll(async () => {
  let set: (d: Date) => void;
  ({ app, deps, setNow: set } = await testApp());
  setNow = (d) => {
    now = d;
    set(d);
  };
  addTestLogin(app, deps);
  goodHash = await hashPassword(deps.config, GOOD);
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

/** A trader with the test password and a logged-in browser (the creating session, so onboarding applies). */
async function trader(o: { firstSession?: boolean; kind?: 'trader' | 'staff' } = {}) {
  const username = name();
  const id = await seedAccount(deps, { loginName: username, ...(o.kind ? { kind: o.kind } : {}) });
  await deps.db.query('insert into passwords (account_id, hash, pepper_id, updated_at) values ($1, $2, $3, $4)', [
    id, goodHash.hash, goodHash.pepperId, now,
  ]);
  const b = new Browser(app);
  const res = await b.post('/t/login', { accountId: id, firstSession: o.firstSession ?? true });
  expect(res.statusCode).toBe(200);
  return { id, username, b };
}

async function enrolStart(b: Browser) {
  const res = await b.post('/v1/account/totp/start', {});
  expect(res.statusCode).toBe(200);
  return res.json() as { challengeId: string; otpauthUri: string; secret: string };
}

async function enrol(b: Browser): Promise<string> {
  const s = await enrolStart(b);
  const res = await b.post('/v1/account/totp/finish', { challengeId: s.challengeId, code: codeAt(s.secret, now) });
  expect(res.statusCode).toBe(200);
  return s.secret;
}

const passwordLogin = (b: Browser, username: string) =>
  b.post('/v1/login/password', { loginName: username, password: GOOD, deviceLabel: 'Test browser' });

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

    const late = await enrolStart(b);
    setNow(at(5 * 60_000));
    const expired = await b.post('/v1/account/totp/finish', { challengeId: late.challengeId, code: codeAt(late.secret, now) });
    expect(expired.json()).toEqual({ error: 'challenge-expired' });

    const s2 = await enrolStart(b);
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
 * Owner decision, 16 Nov 2026 (to-lead.log 17:38): the authenticator app is the password login's
 * second factor, so an account uses it only together with a password. It reverses signup round 3
 * behaviour 1 (TOTP with a PGP key, passkey or security key and no password).
 */
describe('TOTP goes with a password (owner, 16 Nov 2026)', () => {
  const tokenUsed = async (token: string) => {
    const { rows } = await deps.db.query<{ used_at: Date | null }>('select used_at from confirm_tokens where token_hash = $1', [
      createHash('sha256').update(token).digest(),
    ]);
    return rows[0]!.used_at !== null;
  };
  /** A trader whose only login method is a PGP key (no password). */
  async function pgpTrader(firstSession = true) {
    const id = await seedAccount(deps, { loginName: name() });
    const key = await genKey();
    await insertPgpKey(deps.db, deps.config, { accountId: id, fingerprint: key.fingerprint, armored: key.publicKey, now });
    const b = new Browser(app);
    expect((await b.post('/t/login', { accountId: id, firstSession })).statusCode).toBe(200);
    return { id, b };
  }
  const removePassword = (b: Browser, confirmToken: string) =>
    app.inject({ method: 'DELETE', url: '/v1/account/methods/password/password', headers: { origin: ORIGIN }, cookies: b.cookies, payload: { confirmToken } });

  it('start is refused with 409 totp-needs-password on an account with no password, in the sign-up window', async () => {
    const { id, b } = await pgpTrader();
    const res = await b.post('/v1/account/totp/start', {});
    expect([res.statusCode, res.json()]).toEqual([409, { error: 'totp-needs-password' }]);
    const { rows } = await deps.db.query("select 1 from challenges where account_id = $1 and purpose = 'add-totp'", [id]);
    expect(rows).toHaveLength(0);
  });

  it('start outside the sign-up window is refused before the confirm token is spent', async () => {
    const { id, b } = await pgpTrader(false);
    const confirmToken = await confirmTokenFor(deps, b.cookies, { kind: 'add-method', method: 'totp' });
    const res = await b.post('/v1/account/totp/start', { confirmToken });
    expect([res.statusCode, res.json()]).toEqual([409, { error: 'totp-needs-password' }]);
    expect(await tokenUsed(confirmToken)).toBe(false);
    // With a password the same token now starts the enrolment.
    await deps.db.query('insert into passwords (account_id, hash, pepper_id, updated_at) values ($1, $2, $3, $4)', [id, goodHash.hash, goodHash.pepperId, now]);
    expect((await b.post('/v1/account/totp/start', { confirmToken })).statusCode).toBe(200);
  });

  it('finish is refused with 409 totp-needs-password when the password went after the start; nothing is enrolled', async () => {
    const { id, b } = await trader();
    const s = await enrolStart(b);
    await deps.db.query('delete from passwords where account_id = $1', [id]);
    const res = await b.post('/v1/account/totp/finish', { challengeId: s.challengeId, code: codeAt(s.secret, now) });
    expect([res.statusCode, res.json()]).toEqual([409, { error: 'totp-needs-password' }]);
    expect(await hasTotpRow(id)).toBe(false);
  });

  it('removing the password while TOTP is enrolled is refused with 409 password-has-totp, before the confirm token is spent', async () => {
    const { id, b } = await trader();
    const key = await genKey();
    await insertPgpKey(deps.db, deps.config, { accountId: id, fingerprint: key.fingerprint, armored: key.publicKey, now });
    await enrol(b);
    const token = await confirmTokenFor(deps, b.cookies, { kind: 'remove-method', method: 'password', id: 'password' });
    const res = await removePassword(b, token);
    expect([res.statusCode, res.json()]).toEqual([409, { error: 'password-has-totp' }]);
    expect(await tokenUsed(token)).toBe(false);
    const { rows } = await deps.db.query('select 1 from passwords where account_id = $1', [id]);
    expect(rows).toHaveLength(1);
    // Without the authenticator app, the password can go (the PGP key still logs in).
    await deps.db.query('delete from totp where account_id = $1', [id]);
    expect((await removePassword(b, token)).statusCode).toBe(200);
  });

  it('applyTotp (also the write of a staged enrolment when the hold ends) refuses an account with no password', async () => {
    const { id } = await pgpTrader();
    const sealed = sealSecret(deps, id, randomBytes(20));
    await expect(applyTotp(deps.db, id, sealed, 0, now)).rejects.toMatchObject({ status: 409, code: 'totp-needs-password' });
    expect(await hasTotpRow(id)).toBe(false);
  });

  it('a TOTP login still asks a password login for the code (TOTP stays the password\'s second factor)', async () => {
    const { username, b } = await trader();
    await enrol(b);
    const res = await passwordLogin(new Browser(app), username);
    expect(res.json()).toMatchObject({ status: 'second-factor' });
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

describe('password login with TOTP (second factor)', () => {
  it('answers second-factor with no session until the code is accepted', async () => {
    const { username, b } = await trader();
    const secret = await enrol(b);
    setNow(at(STEP_MS)); // the enrolment used this step's code

    const fresh = new Browser(app);
    const res = await passwordLogin(fresh, username);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; pendingId: string; needs: string[] };
    expect(body).toEqual({ status: 'second-factor', pendingId: expect.any(String), needs: ['totp'] });
    expect(res.cookies.find((c) => c.name === SESSION_COOKIE)).toBeUndefined();

    const ok = await fresh.post('/v1/login/second-factor', { pendingId: body.pendingId, code: codeAt(secret, now) });
    expect(ok.statusCode).toBe(200);
    // Task 16: the account is logged in elsewhere, so this new browser is approved first.
    expect(await approvedLogin(deps, ok, (u) => fresh.post(u))).toEqual({ status: 'ok' });
    expect(fresh.cookies[SESSION_COOKIE]).toBeTruthy();
    // The pending login is single-use.
    const again = await fresh.post('/v1/login/second-factor', { pendingId: body.pendingId, code: codeAt(secret, now) });
    expect(again.json()).toEqual({ error: 'challenge-expired' });
  });

  it('binds the pending login to the browser and to 5 minutes', async () => {
    const { username, b } = await trader();
    const secret = await enrol(b);
    setNow(at(STEP_MS));
    const first = new Browser(app);
    const { pendingId } = (await passwordLogin(first, username)).json() as { pendingId: string };
    const other = new Browser(app);
    await other.post('/v1/login/pgp/start', { key: 'none' }); // a device cookie of its own
    const res = await other.post('/v1/login/second-factor', { pendingId, code: codeAt(secret, now) });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'challenge-expired' });

    const { pendingId: p2 } = (await passwordLogin(first, username)).json() as { pendingId: string };
    setNow(at(5 * 60_000));
    const late = await first.post('/v1/login/second-factor', { pendingId: p2, code: codeAt(secret, now) });
    expect(late.json()).toEqual({ error: 'challenge-expired' });
  });

  it('throttles wrong codes on the totp key; a PGP login still succeeds meanwhile', async () => {
    const { id, username, b } = await trader();
    const secret = await enrol(b);
    setNow(at(STEP_MS));
    const key = await genKey();
    await insertPgpKey(deps.db, deps.config, { accountId: id, fingerprint: key.fingerprint, armored: key.publicKey, now });

    const attacker = new Browser(app);
    for (let i = 1; i <= 4; i++) {
      const { pendingId } = (await passwordLogin(attacker, username)).json() as { pendingId: string };
      const res = await attacker.post('/v1/login/second-factor', { pendingId, code: wrongCodeAt(secret, now) });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'code-invalid' });
    }
    const { pendingId } = (await passwordLogin(attacker, username)).json() as { pendingId: string };
    const slowed = await attacker.post('/v1/login/second-factor', { pendingId, code: codeAt(secret, now) });
    expect(slowed.statusCode).toBe(429);
    expect(slowed.json()).toMatchObject({ error: 'slow-down' });
    // A refused check does not use up the pending login: after the wait it still finishes.
    setNow(at(3_000));
    const later = await attacker.post('/v1/login/second-factor', { pendingId, code: codeAt(secret, now) });
    expect(later.statusCode).toBe(200);
    expect(await approvedLogin(deps, later, (u) => attacker.post(u))).toEqual({ status: 'ok' });

    // PGP is never throttled by the totp key.
    const owner = new Browser(app);
    const start = await owner.post('/v1/login/pgp/start', { key: key.publicKey, loginName: username });
    const { challengeId, encryptedMessage } = start.json() as { challengeId: string; encryptedMessage: string };
    const code = codeOf(await decrypt(encryptedMessage, key.privateKey));
    const fin = await owner.post('/v1/login/pgp/finish', { challengeId, code, deviceLabel: 'Test browser' });
    expect(fin.statusCode).toBe(200);
    expect(await approvedLogin(deps, fin, (u) => owner.post(u))).toEqual({ status: 'ok' });
  });

  it('a correct passkey login still succeeds while TOTP is throttled', async () => {
    const { id, username, b } = await trader();
    const secret = await enrol(b);
    setNow(at(STEP_MS));
    const auth = createSoftAuthenticator({ backedUp: true, userVerified: true });
    await deps.db.query(
      `insert into webauthn_credentials (account_id, credential_id, public_key, counter, kind, backed_up, device_type, attested, label, created_at)
       values ($1, $2, $3, 0, 'passkey', true, 'multiDevice', false, 'Phone', $4)`,
      [id, Buffer.from(auth.credentialId, 'base64url'), auth.cosePublicKey, now],
    );

    const attacker = new Browser(app);
    for (let i = 1; i <= 4; i++) {
      const { pendingId } = (await passwordLogin(attacker, username)).json() as { pendingId: string };
      expect((await attacker.post('/v1/login/second-factor', { pendingId, code: wrongCodeAt(secret, now) })).statusCode).toBe(401);
    }
    const { pendingId } = (await passwordLogin(attacker, username)).json() as { pendingId: string };
    const slowed = await attacker.post('/v1/login/second-factor', { pendingId, code: codeAt(secret, now) });
    expect(slowed.statusCode).toBe(429);
    expect(slowed.json()).toMatchObject({ error: 'slow-down' });

    // Passkeys (discoverable login) are never throttled by the totp key.
    const { rows } = await deps.db.query<{ h: Buffer }>('select webauthn_user_id as h from accounts where id = $1', [id]);
    const owner = new Browser(app);
    const start = await owner.post('/v1/login/webauthn/start', {});
    expect(start.statusCode).toBe(200);
    const { challengeId, options } = start.json() as { challengeId: string; options: Parameters<typeof auth.authenticate>[0] };
    const response = auth.authenticate(options, ORIGIN, { userHandle: rows[0]!.h.toString('base64url') });
    const fin = await owner.post('/v1/login/webauthn/finish', { challengeId, response, deviceLabel: 'Phone' });
    expect(fin.statusCode).toBe(200);
    expect(await approvedLogin(deps, fin, (u) => owner.post(u))).toEqual({ status: 'ok' });
    expect(owner.cookies[SESSION_COOKIE]).toBeDefined();
  });

  it('logs in without a second factor when no TOTP is enrolled', async () => {
    const { username } = await trader();
    const fresh = new Browser(app);
    const res = await passwordLogin(fresh, username);
    expect(await approvedLogin(deps, res, (u) => fresh.post(u))).toEqual({ status: 'ok' });
  });
});

describe('POST /v1/confirm/password with TOTP', () => {
  it('requires the current code once TOTP is enrolled', async () => {
    const { id, b } = await trader();
    const secret = await enrol(b);
    setNow(at(STEP_MS));
    const action = { kind: 'set-password' };
    // No code: refused before any Argon2 work and counted as a password failure, so neither the
    // answer nor the throttle tells whether the password was right.
    const verify = vi.spyOn(argon2, 'verify');
    const missing = await b.post('/v1/confirm/password', { password: GOOD, action });
    expect(missing.statusCode).toBe(401);
    expect(missing.json()).toEqual({ error: 'credentials-invalid' });
    expect(verify).not.toHaveBeenCalled();
    const { rows } = await deps.db.query<{ key: string; failures: number }>(
      "select key, failures from login_throttle where key like 'password:' || $1 || ':%'",
      [id],
    );
    expect(rows.map((r) => r.failures)).toEqual([1]);
    const wrong = await b.post('/v1/confirm/password', { password: GOOD, totp: wrongCodeAt(secret, now), action });
    expect(wrong.json()).toEqual({ error: 'credentials-invalid' });
    const ok = await b.post('/v1/confirm/password', { password: GOOD, totp: codeAt(secret, now), action });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ confirmToken: expect.any(String) });
    // Password plus authenticator code is still the weak kind: a new wallet waits 24 hours (owner, 2026-10-23).
    expect(await confirmTokenMethod(deps, ok.json().confirmToken)).toBe('password');
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
    // Owner, 16 Nov 2026: TOTP only with a password, so each account gets one first.
    const withPassword = (id: string) =>
      deps.db.query('insert into passwords (account_id, hash, pepper_id, updated_at) values ($1, $2, $3, $4)', [id, goodHash.hash, goodHash.pepperId, now]);
    const first = await seedAccount(deps, { loginName: username });
    await withPassword(first);
    const b1 = new Browser(app);
    await b1.post('/t/login', { accountId: first, firstSession: true });
    const s1 = await enrol(b1);
    await deps.db.query('delete from accounts where id = $1', [first]);
    setNow(at(HOUR / 2));
    const second = await seedAccount(deps, { loginName: username });
    await withPassword(second);
    const b2 = new Browser(app);
    await b2.post('/t/login', { accountId: second, firstSession: true });
    const s2 = await enrol(b2);
    expect(s2).not.toBe(s1);
    setNow(at(STEP_MS));
    expect(await enrol(b2)).not.toBe(s2);
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
