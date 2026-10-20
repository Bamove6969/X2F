import type { FastifyInstance } from 'fastify';
import { Secret } from 'otpauth';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { SESSION_COOKIE } from '../src/auth/sessions.js';
import { hashPassword } from '../src/auth/password.js';
import { insertPgpKey } from '../src/auth/pgp.js';
import { openSecret, verifyTotp } from '../src/auth/totp.js';
import { seedAccount } from './helpers/accounts.js';
import { testApp } from './helpers/app.js';
import { codeOf, decrypt, genKey } from './helpers/pgpKeys.js';
import { Browser, STEP_MS, addTestLogin, codeAt, wrongCodeAt } from './helpers/totp.js';

const T0 = new Date('2026-10-17T12:00:00Z'); // a step boundary
const HOUR = 3600_000;
const GOOD = 'Correct-Horse-9';

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let now = T0;
let step = 0;
let goodHash: string;
let n = 0;

beforeAll(async () => {
  let set: (d: Date) => void;
  ({ app, deps, setNow: set } = await testApp());
  setNow = (d) => {
    now = d;
    set(d);
  };
  addTestLogin(app, deps);
  goodHash = await hashPassword(GOOD);
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  // Each test starts an hour later (on a step boundary): budgets refill and throttle streaks end.
  setNow(new Date(T0.getTime() + ++step * HOUR));
});

const name = (p = 'totp') => `${p}${String(++n).padStart(4, '0')}`;
const at = (ms: number) => new Date(now.getTime() + ms);

/** A trader with the test password and a logged-in browser (the creating session, so onboarding applies). */
async function trader(o: { firstSession?: boolean; kind?: 'trader' | 'staff' } = {}) {
  const username = name();
  const id = await seedAccount(deps, { username, ...(o.kind ? { kind: o.kind } : {}) });
  await deps.db.query('insert into passwords (account_id, hash, updated_at) values ($1, $2, $3)', [id, goodHash, now]);
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
  b.post('/v1/login/password', { username, password: GOOD, deviceLabel: 'Test browser' });

function chiSquare(counts: number[], total: number): number {
  const expected = total / counts.length;
  return counts.reduce((s, c) => s + (c - expected) ** 2 / expected, 0);
}

describe('TOTP enrolment', () => {
  it('returns an otpauth URI and never stores the secret in the clear', async () => {
    const { id, username, b } = await trader();
    const s = await enrolStart(b);
    expect(s.otpauthUri.startsWith(`otpauth://totp/X2F:${username}?`)).toBe(true);
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
    expect(Buffer.from(openSecret(deps, rows[0]!.secret_enc))).toEqual(raw);
    const { rows: alerts } = await deps.db.query('select detail from alerts where account_id = $1 and kind = $2', [id, 'login-method-added']);
    expect(alerts.map((r) => r.detail)).toEqual([{ method: 'totp' }]);
  });

  it('refuses a wrong code, a used challenge and another session', async () => {
    const { b } = await trader();
    const s = await enrolStart(b);
    const wrong = await b.post('/v1/account/totp/finish', { challengeId: s.challengeId, code: wrongCodeAt(s.secret, now) });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toEqual({ error: 'code-invalid' });
    const again = await b.post('/v1/account/totp/finish', { challengeId: s.challengeId, code: codeAt(s.secret, now) });
    expect(again.json()).toEqual({ error: 'challenge-expired' });

    const s2 = await enrolStart(b);
    const other = await trader();
    const res = await other.b.post('/v1/account/totp/finish', { challengeId: s2.challengeId, code: codeAt(s2.secret, now) });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'challenge-expired' });
  });

  it('needs a confirm token outside onboarding', async () => {
    const { b } = await trader({ firstSession: false });
    const res = await b.post('/v1/account/totp/start', {});
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'confirm-required', action: 'add-method' });
  });

  it('is for traders only until Task 10 (staff → method-not-allowed)', async () => {
    const { b } = await trader({ kind: 'staff' });
    const res = await b.post('/v1/account/totp/start', {});
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'method-not-allowed' });
  });
});

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
    const id = await seedAccount(deps, { username: name() });
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
    expect(ok.json()).toEqual({ status: 'ok' });
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
    await other.post('/v1/login/pgp/start', { username: 'nobody-here' }); // a device cookie of its own
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

    // PGP is never throttled by the totp key. TODO(Task 8 merge): also log in with a passkey here.
    const owner = new Browser(app);
    const start = await owner.post('/v1/login/pgp/start', { username });
    const { challengeId, encryptedMessage } = start.json() as { challengeId: string; encryptedMessage: string };
    const code = codeOf(await decrypt(encryptedMessage, key.privateKey));
    const fin = await owner.post('/v1/login/pgp/finish', { challengeId, code, deviceLabel: 'Test browser' });
    expect(fin.statusCode).toBe(200);
    expect(fin.json()).toEqual({ status: 'ok' });
  });

  it('logs in without a second factor when no TOTP is enrolled', async () => {
    const { username } = await trader();
    const res = await passwordLogin(new Browser(app), username);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});

describe('POST /v1/confirm/password with TOTP', () => {
  it('requires the current code once TOTP is enrolled', async () => {
    const { b } = await trader();
    const secret = await enrol(b);
    setNow(at(STEP_MS));
    const action = { kind: 'set-password' };
    const missing = await b.post('/v1/confirm/password', { password: GOOD, action });
    expect(missing.statusCode).toBe(401);
    expect(missing.json()).toEqual({ error: 'credentials-invalid' });
    const wrong = await b.post('/v1/confirm/password', { password: GOOD, totp: wrongCodeAt(secret, now), action });
    expect(wrong.json()).toEqual({ error: 'credentials-invalid' });
    const ok = await b.post('/v1/confirm/password', { password: GOOD, totp: codeAt(secret, now), action });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ confirmToken: expect.any(String) });
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

  it('the same username at different times never gets the same secret', async () => {
    const username = name('same');
    const first = await seedAccount(deps, { username });
    const b1 = new Browser(app);
    await b1.post('/t/login', { accountId: first, firstSession: true });
    const s1 = await enrol(b1);
    await deps.db.query('delete from accounts where id = $1', [first]);
    setNow(at(HOUR / 2));
    const second = await seedAccount(deps, { username });
    const b2 = new Browser(app);
    await b2.post('/t/login', { accountId: second, firstSession: true });
    const s2 = await enrol(b2);
    expect(s2).not.toBe(s1);
    setNow(at(STEP_MS));
    expect(await enrol(b2)).not.toBe(s2);
  });
});
