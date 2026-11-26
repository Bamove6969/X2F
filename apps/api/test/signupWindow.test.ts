// Security review of sign-up v2 (12 Nov 2026), M1: the creating session's sign-up window
// (`onboarding_until`, 30 minutes) lets a method be ADDED without confirm-it's-you, never REPLACED,
// and it closes when sign-up ends (`POST /v1/account/onboarding/end`, sent on reaching Welcome).
// The reviewer's probe was replacing an existing password inside the window (passwords are gone
// since 26 Nov 2026; the same rule holds for every other method).
// Re-verify R1 (P4 to P8, and WebAuthn like P6): the rule holds where each change WRITES, not only
// where its ceremony starts, and `onboarding/end` uses up ceremonies opened on the window.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { insertPgpKey } from '../src/auth/pgp.js';
import { randomBytes } from 'node:crypto';
import { seedAccount } from './helpers/accounts.js';
import { testApp } from './helpers/app.js';
import { codeOf, decrypt, genKey } from './helpers/pgpKeys.js';
import { createSoftAuthenticator } from './helpers/softAuthenticator.js';
import { Browser, ORIGIN, addTestLogin, codeAt } from './helpers/totp.js';

const T0 = new Date('2026-10-20T06:00:00Z');
const HOUR = 3600_000;

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let now = T0;
let day = 0;
let n = 0;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  let set: (d: Date) => void;
  cleanup = async () => {};
  ({ app, deps, setNow: set } = await testApp({}));
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
  setNow(new Date(T0.getTime() + ++day * 24 * HOUR));
});

/** A trader and its creating session (first session: inside the 30-minute sign-up window). */
async function signedUp(): Promise<{ id: string; b: Browser }> {
  const id = await seedAccount(deps, { loginName: `win${String(++n).padStart(4, '0')}`, methods: false });
  const b = new Browser(app);
  expect((await b.post('/t/login', { accountId: id, firstSession: true })).statusCode).toBe(200);
  return { id, b };
}

/** Methods written straight to the account (owner 26 Nov 2026: sign-up ends only with two kinds). */
async function withKinds(accountId: string, kinds: Array<'totp' | 'security-key' | 'pgp'>): Promise<void> {
  for (const k of kinds) {
    if (k === 'totp') await deps.db.query('insert into totp (account_id, secret_enc, created_at) values ($1, $2, $3)', [accountId, randomBytes(48), now]);
    if (k === 'security-key') {
      await deps.db.query(
        `insert into webauthn_credentials (account_id, credential_id, public_key, counter, kind, backed_up, device_type, label, created_at)
         values ($1, $2, $3, 0, 'security-key', false, 'singleDevice', 'Key', $4)`,
        [accountId, randomBytes(32), randomBytes(77), now],
      );
    }
    if (k === 'pgp') {
      const key = await genKey();
      await insertPgpKey(deps.db, deps.config, { accountId, fingerprint: key.fingerprint, armored: key.publicKey, now });
    }
  }
}

const confirmNeeded = (res: { statusCode: number; json: () => unknown }) => {
  expect(res.statusCode).toBe(403);
  expect((res.json() as { error: string }).error).toBe('confirm-required');
};

describe('M1(b): inside the sign-up window a method may be added, never replaced', () => {
  it('a first authenticator app is added freely; another one would replace it and needs confirmation', async () => {
    const { id, b } = await signedUp();
    expect((await b.post('/v1/account/totp/start', {})).statusCode).toBe(200);
    await deps.db.query('insert into totp (account_id, secret_enc, created_at) values ($1, $2, $3)', [id, Buffer.from('x'), now]);
    confirmNeeded(await b.post('/v1/account/totp/start', {}));
  });

  it('the first recovery code is made freely; a new one (replacing it) needs confirmation', async () => {
    const { b } = await signedUp();
    expect((await b.post('/v1/account/recovery-codes', {})).statusCode).toBe(200);
    confirmNeeded(await b.post('/v1/account/recovery-codes', {}));
  });

  it('a PGP key is not added freely to an account that already has one', async () => {
    const { id, b } = await signedUp();
    const first = await genKey();
    await insertPgpKey(deps.db, deps.config, { accountId: id, fingerprint: first.fingerprint, armored: first.publicKey, now });
    const second = await genKey();
    confirmNeeded(await b.post('/v1/account/pgp/start', { publicKey: second.publicKey }));
  });
});

describe('M1(a): the window closes when sign-up ends', () => {
  it('POST /v1/account/onboarding/end closes it: after that even a first method needs confirmation', async () => {
    const { id, b } = await signedUp();
    // Owner 26 Nov 2026: with fewer than two kinds sign-up does not end (409, the window stays open).
    expect((await b.post('/v1/account/onboarding/end', {})).json()).toEqual({ error: 'two-methods-required' });
    await withKinds(id, ['totp', 'security-key']);
    const res = await b.post('/v1/account/onboarding/end', {});
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    const { rows } = await deps.db.query<{ onboarding_until: Date | null }>('select onboarding_until from sessions where account_id = $1', [id]);
    expect(rows.map((r) => r.onboarding_until)).toEqual([null]);
    confirmNeeded(await b.post('/v1/account/pgp/start', { publicKey: (await genKey()).publicKey }));
    confirmNeeded(await b.post('/v1/account/recovery-codes', {}));
  });

  it('it needs a session, and only ever closes the caller\'s own window', async () => {
    const anon = await new Browser(app).post('/v1/account/onboarding/end', {});
    expect(anon.statusCode).toBe(401);
    const a = await signedUp();
    const other = await signedUp();
    await withKinds(a.id, ['totp', 'security-key']);
    expect((await a.b.post('/v1/account/onboarding/end', {})).statusCode).toBe(200);
    expect((await other.b.post('/v1/account/recovery-codes', {})).statusCode).toBe(200);
  });
});

describe('re-verify R1: the window is checked again where the change writes', () => {
  const totpStart = async (b: Browser) => {
    const s = await b.post('/v1/account/totp/start', {});
    expect(s.statusCode).toBe(200);
    return s.json() as { challengeId: string; secret: string };
  };
  const totpFinish = (b: Browser, s: { challengeId: string; secret: string }) =>
    b.post('/v1/account/totp/finish', { challengeId: s.challengeId, code: codeAt(s.secret, now) });

  it('P4: two app enrolments opened in the window; once one finishes, the other cannot replace it', async () => {
    const { id, b } = await signedUp();
    const a = await totpStart(b);
    const second = await totpStart(b);
    expect((await totpFinish(b, second)).statusCode).toBe(200);
    confirmNeeded(await b.post('/v1/account/totp/start', {}));
    confirmNeeded(await totpFinish(b, a));
    const { rows } = await deps.db.query<{ secret_enc: Buffer }>('select secret_enc from totp where account_id = $1', [id]);
    expect(rows).toHaveLength(1);
  });

  it('P5: an app enrolment opened in the window cannot finish after onboarding/end', async () => {
    const { id, b } = await signedUp();
    // Sign-up ends only with two kinds of login method (owner 26 Nov 2026).
    await withKinds(id, ['pgp', 'security-key']);
    const s = await totpStart(b);
    expect((await b.post('/v1/account/onboarding/end', {})).statusCode).toBe(200);
    const res = await totpFinish(b, s);
    expect(res.statusCode).not.toBe(200);
    expect((await deps.db.query('select 1 from totp where account_id = $1', [id])).rows).toHaveLength(0);
  });

  it('P5 (window run out): a start in the window, a finish after the 30 minutes, gets 403', async () => {
    const { id, b } = await signedUp();
    const s = await totpStart(b);
    // Still inside the 5-minute enrolment, but past the window: moved by a direct update of the session.
    await deps.db.query("update sessions set onboarding_until = $2 where account_id = $1", [id, new Date(now.getTime() - 1000)]);
    confirmNeeded(await totpFinish(b, s));
  });

  it('P6: two PGP keys started in the window; only the first finish adds one', async () => {
    const { id, b } = await signedUp();
    const k1 = await genKey();
    const k2 = await genKey();
    const s1 = await b.post('/v1/account/pgp/start', { publicKey: k1.publicKey });
    const s2 = await b.post('/v1/account/pgp/start', { publicKey: k2.publicKey });
    expect([s1.statusCode, s2.statusCode]).toEqual([200, 200]);
    const c1 = codeOf(await decrypt(s1.json().encryptedMessage, k1.privateKey));
    const c2 = codeOf(await decrypt(s2.json().encryptedMessage, k2.privateKey));
    expect((await b.post('/v1/account/pgp/finish', { challengeId: s1.json().challengeId, code: c1 })).statusCode).toBe(200);
    confirmNeeded(await b.post('/v1/account/pgp/finish', { challengeId: s2.json().challengeId, code: c2 }));
    expect((await deps.db.query('select 1 from pgp_keys where account_id = $1', [id])).rows).toHaveLength(1);
  });

  it('P6 after onboarding/end: an open PGP add is used up', async () => {
    const { id, b } = await signedUp();
    const k = await genKey();
    const s = await b.post('/v1/account/pgp/start', { publicKey: k.publicKey });
    const code = codeOf(await decrypt(s.json().encryptedMessage, k.privateKey));
    await withKinds(id, ['totp', 'security-key']);
    expect((await b.post('/v1/account/onboarding/end', {})).statusCode).toBe(200);
    expect((await b.post('/v1/account/pgp/finish', { challengeId: s.json().challengeId, code })).statusCode).not.toBe(200);
    expect((await deps.db.query('select 1 from pgp_keys where account_id = $1', [id])).rows).toHaveLength(0);
  });

  for (const kind of ['passkey', 'security-key'] as const) {
    it(`WebAuthn (${kind}), as P6: two adds started in the window; only the first finish adds one`, async () => {
      const { id, b } = await signedUp();
      const auth1 = createSoftAuthenticator({ backedUp: kind === 'passkey', userVerified: true });
      const auth2 = createSoftAuthenticator({ backedUp: kind === 'passkey', userVerified: true });
      const s1 = await b.post('/v1/account/webauthn/start', { kind });
      const s2 = await b.post('/v1/account/webauthn/start', { kind });
      expect([s1.statusCode, s2.statusCode]).toEqual([200, 200]);
      const f1 = await b.post('/v1/account/webauthn/finish', { challengeId: s1.json().challengeId, response: auth1.register(s1.json().options, ORIGIN) });
      expect(f1.statusCode).toBe(201);
      confirmNeeded(await b.post('/v1/account/webauthn/finish', { challengeId: s2.json().challengeId, response: auth2.register(s2.json().options, ORIGIN) }));
      expect((await deps.db.query('select 1 from webauthn_credentials where account_id = $1', [id])).rows).toHaveLength(1);
    });

    it(`WebAuthn (${kind}): an add opened in the window cannot finish after onboarding/end`, async () => {
      const { id, b } = await signedUp();
      const auth = createSoftAuthenticator({ backedUp: kind === 'passkey', userVerified: true });
      const s = await b.post('/v1/account/webauthn/start', { kind });
      await withKinds(id, ['totp', 'pgp']);
      expect((await b.post('/v1/account/onboarding/end', {})).statusCode).toBe(200);
      const f = await b.post('/v1/account/webauthn/finish', { challengeId: s.json().challengeId, response: auth.register(s.json().options, ORIGIN) });
      expect(f.statusCode).not.toBe(201);
      expect((await deps.db.query('select 1 from webauthn_credentials where account_id = $1', [id])).rows).toHaveLength(0);
    });
  }

  it('P8: two parallel first recovery codes; exactly one is made, the other gets 403', async () => {
    const { id, b } = await signedUp();
    const res = await Promise.all([b.post('/v1/account/recovery-codes', {}), b.post('/v1/account/recovery-codes', {})]);
    expect(res.map((r) => r.statusCode).sort()).toEqual([200, 403]);
    confirmNeeded(res.find((r) => r.statusCode === 403)!);
    expect((await deps.db.query('select 1 from recovery_codes where account_id = $1 and used_at is null', [id])).rows.length).toBeGreaterThan(0);
  });
});
