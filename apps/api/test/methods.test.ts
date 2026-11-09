import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { normalizeRecoveryCode, type MethodType } from '@x2f/accounts';
import argon2 from 'argon2';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import * as openpgp from 'openpgp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deps } from '../src/app.js';
import { issueConfirmToken } from '../src/auth/confirm.js';
import { completeLogin, type LoginFactor } from '../src/auth/login.js';
import {
  PRIMARY,
  allowedMethods,
  assertMethodAllowed,
  listMethods,
  needsAfter,
  ownerReady,
  pairAllowed,
  passwordAllowed,
} from '../src/auth/methods.js';
import { hashPassword } from '../src/auth/password.js';
import { insertPgpKey, pgpLoginRoutes } from '../src/auth/pgp.js';
import { SESSION_COOKIE, startSession } from '../src/auth/sessions.js';
import { sealSecret } from '../src/auth/totp.js';
import { securityKeyLoginRoutes } from '../src/auth/webauthn.js';
import { ApiError } from '../src/errors.js';
import { seedAccount } from './helpers/accounts.js';
import { testApp } from './helpers/app.js';
import { fixtureLeakedList } from './helpers/leaked.js';
import { codeOf, decrypt, genKey, type Pair } from './helpers/pgpKeys.js';
import { createSoftAuthenticator, type SoftAuthenticator } from './helpers/softAuthenticator.js';

const ORIGIN = 'https://x2f.test';
const T0 = new Date('2026-10-17T12:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const GOOD = 'Correct-Horse-9';
/** The trader API's login mounts, and the staff API's as mounted here (kinds staff and owner). */
const TRADER_LOGIN = '/v1/login';
const STAFF_LOGIN = '/s/login';
const OTHER_GOOD = 'Battery-Staple-7';

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let cleanup: () => Promise<void>;
let now = T0;
let step = 0;
let keys: Pair[];

beforeAll(async () => {
  const fixture = await fixtureLeakedList();
  cleanup = fixture.cleanup;
  let set: (d: Date) => void;
  ({ app, deps, setNow: set } = await testApp({ leaked: fixture.list }));
  setNow = (d) => {
    now = d;
    set(d);
  };
  app.post('/t/login', async (req, reply) => {
    const b = req.body as { accountId: string; firstSession?: boolean; level?: 'full' | 'recovery'; holdUntil?: string };
    const sessionId = await startSession(deps, req, reply, {
      accountId: b.accountId, level: b.level ?? 'full', deviceLabel: 'Test', method: 'passkey',
      firstSession: b.firstSession ?? false, ...(b.holdUntil ? { holdUntil: new Date(b.holdUntil) } : {}),
    });
    return { sessionId };
  });
  // Calls `completeLogin` with any factor, as a login route would after a passing credential check:
  // the only way to present a pair the routes themselves never build (the same PGP key twice).
  app.post('/t/complete', async (req, reply) => {
    const b = req.body as { accountId: string; factor: LoginFactor; pendingId?: string };
    const { rows } = await deps.db.query<{ id: string; kind: 'trader' | 'staff' | 'owner' }>('select id, kind from accounts where id = $1', [b.accountId]);
    return completeLogin(deps, req, reply, {
      account: rows[0]!, factor: b.factor, deviceLabel: 'Forced', ...(b.pendingId ? { pendingId: b.pendingId } : {}),
    });
  });
  // The staff API's login mounts (kinds staff and owner): staff log in only there (owner 2026-11-03).
  await app.register(securityKeyLoginRoutes, { prefix: `${STAFF_LOGIN}/webauthn`, kinds: ['staff', 'owner'] });
  await app.register(async (sub) => pgpLoginRoutes(sub, { kinds: ['staff', 'owner'] }), { prefix: `${STAFF_LOGIN}/pgp` });
  keys = await Promise.all([genKey(), genKey(), genKey()]);
});

afterAll(async () => {
  await app.close();
  await cleanup();
});

beforeEach(() => {
  // Each test starts a day later: budgets, start limits, throttles and challenges are fresh.
  setNow(new Date(T0.getTime() + ++step * DAY));
  vi.restoreAllMocks();
});

/**
 * Accounts seeded by the current test; deleted afterwards (one owner per database, and the shared
 * PGP keys and fixed recovery codes are unique across accounts).
 */
let seeded: string[] = [];
afterEach(async () => {
  if (seeded.length > 0) await deps.db.query('delete from accounts where id = any($1::uuid[])', [seeded]);
  seeded = [];
});

let seq = 0;
const uniqueName = (p = 'meth') => `${p}${String(++seq).padStart(4, '0')}x`;
const sha = (s: string) => createHash('sha256').update(s).digest();
const errorOf = (res: LightMyRequestResponse) => (res.json() as { error?: string }).error;

/** A browser: keeps the cookies the API sets and sends them back. */
class Browser {
  cookies: Record<string, string> = {};
  sessionId = '';
  private keep(res: LightMyRequestResponse): LightMyRequestResponse {
    for (const c of res.cookies) {
      if (c.maxAge === 0 || c.value === '') delete this.cookies[c.name];
      else this.cookies[c.name] = c.value;
    }
    return res;
  }
  async send(method: 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown): Promise<LightMyRequestResponse> {
    return this.keep(
      await app.inject({
        method, url, headers: { origin: ORIGIN }, cookies: this.cookies,
        ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
      }),
    );
  }
  post(url: string, payload: unknown = {}) {
    return this.send('POST', url, payload);
  }
  put(url: string, payload: unknown = {}) {
    return this.send('PUT', url, payload);
  }
  del(url: string, payload?: unknown) {
    return this.send('DELETE', url, payload);
  }
  async get(url: string): Promise<LightMyRequestResponse> {
    return this.keep(await app.inject({ method: 'GET', url, cookies: this.cookies }));
  }
}

async function account(kind: 'trader' | 'staff' | 'owner' = 'trader') {
  const username = uniqueName(kind === 'trader' ? 'user' : kind === 'staff' ? 'crew' : 'boss');
  const id = await seedAccount(deps, { loginName: username, kind });
  seeded.push(id);
  return { id, username };
}

async function loggedIn(accountId: string, o: { firstSession?: boolean; level?: 'full' | 'recovery'; holdUntil?: Date } = {}) {
  const b = new Browser();
  const res = await b.post('/t/login', {
    accountId, firstSession: o.firstSession ?? false, level: o.level ?? 'full', ...(o.holdUntil ? { holdUntil: o.holdUntil.toISOString() } : {}),
  });
  expect(res.statusCode).toBe(200);
  b.sessionId = (res.json() as { sessionId: string }).sessionId;
  return b;
}

async function addPgp(accountId: string, key: Pair, at = now): Promise<string> {
  await insertPgpKey(deps.db, deps.config, { accountId, fingerprint: key.fingerprint, armored: key.publicKey, now: at });
  const { rows } = await deps.db.query<{ id: string }>('select id from pgp_keys where fingerprint = $1', [key.fingerprint]);
  return rows[0]!.id;
}

/** Replaces the server's copy of `key` with a revoked one, as a refresh of a key its owner revoked would. */
async function revokeStored(accountId: string, key: Pair): Promise<string> {
  const priv = await openpgp.readPrivateKey({ armoredKey: key.privateKey });
  const r = await openpgp.revokeKey({ key: priv, date: new Date(now.getTime() - MIN), format: 'armored' });
  await deps.db.query('delete from pgp_keys where account_id = $1 and fingerprint = $2', [accountId, key.fingerprint]);
  return addPgp(accountId, { ...key, publicKey: r.publicKey });
}

async function addCredential(accountId: string, kind: 'passkey' | 'security-key', attested: boolean, auth = createSoftAuthenticator({ backedUp: false, userVerified: true })) {
  const { rows } = await deps.db.query<{ id: string }>(
    `insert into webauthn_credentials (account_id, credential_id, public_key, counter, kind, backed_up, device_type, attested, label, created_at)
     values ($1, $2, $3, 0, $4, false, 'singleDevice', $5, $6, $7) returning id`,
    [accountId, Buffer.from(auth.credentialId, 'base64url'), auth.cosePublicKey, kind, attested, `${kind} label`, now],
  );
  return { id: rows[0]!.id, auth };
}

async function addPassword(accountId: string, pw = GOOD) {
  const { hash, pepperId } = await hashPassword(deps.config, pw);
  await deps.db.query('insert into passwords (account_id, hash, pepper_id, updated_at) values ($1, $2, $3, $4)', [accountId, hash, pepperId, now]);
}

async function addTotp(accountId: string) {
  await deps.db.query('insert into totp (account_id, secret_enc, created_at) values ($1, $2, $3)', [
    accountId, sealSecret(deps, accountId, new Uint8Array(randomBytes(20))), now,
  ]);
}

async function addRecoveryCodes(accountId: string, codes: string[]) {
  for (const c of codes) {
    await deps.db.query('insert into recovery_codes (account_id, code_hash) values ($1, $2)', [accountId, sha(normalizeRecoveryCode(c)!)]);
  }
}

async function token(b: Browser, accountId: string, action: Parameters<typeof issueConfirmToken>[1]['action']) {
  return issueConfirmToken(deps, { sessionId: b.sessionId, accountId, action, method: 'password' });
}

async function alertsOf(accountId: string, kind: string) {
  const { rows } = await deps.db.query<{ detail: Record<string, unknown> }>(
    'select detail from alerts where account_id = $1 and kind = $2 order by created_at',
    [accountId, kind],
  );
  return rows.map((r) => r.detail);
}

async function sessionCount(accountId: string) {
  const { rows } = await deps.db.query<{ n: number }>('select count(*)::int as n from sessions where account_id = $1', [accountId]);
  return rows[0]!.n;
}

// ---------------------------------------------------------------------------------------------

describe('policy', () => {
  it('allowedMethods, passwordAllowed and assertMethodAllowed', () => {
    expect(PRIMARY).toEqual(['pgp', 'passkey', 'security-key', 'password']);
    expect(allowedMethods('trader')).toEqual(['pgp', 'passkey', 'security-key', 'password', 'totp', 'recovery-codes']);
    expect(allowedMethods('staff')).toEqual(['pgp', 'security-key', 'passkey']);
    expect(allowedMethods('owner')).toEqual(['pgp', 'security-key']);
    expect(passwordAllowed('trader')).toBe(true);
    expect(passwordAllowed('staff')).toBe(false);
    expect(passwordAllowed('owner')).toBe(false);
    expect(() => assertMethodAllowed('trader', 'totp')).not.toThrow();
    for (const [kind, m] of [['staff', 'password'], ['staff', 'totp'], ['staff', 'recovery-codes'], ['owner', 'passkey'], ['owner', 'password']] as const) {
      try {
        assertMethodAllowed(kind, m);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
        expect(e).toMatchObject({ status: 403, code: 'method-not-allowed' });
      }
    }
  });

  const pgp = (...fps: string[]): LoginFactor => ({ method: 'pgp', fingerprint: fps[0]!, fingerprints: fps });
  const sk = (attested = true): LoginFactor => ({ method: 'security-key', credentialId: 'k', attested });
  const pk: LoginFactor = { method: 'passkey', credentialId: 'p', attested: false };

  it('pairAllowed: the owner needs PGP and an attested security key', () => {
    expect(pairAllowed('owner', pgp('a'), sk())).toBe(true);
    expect(pairAllowed('owner', sk(), pgp('a'))).toBe(true);
    expect(pairAllowed('owner', pgp('a'), sk(false))).toBe(false);
    expect(pairAllowed('owner', pgp('a'), pgp('b'))).toBe(false);
    expect(pairAllowed('owner', sk(), sk())).toBe(false);
    expect(pairAllowed('owner', pgp('a'), pk)).toBe(false);
  });

  it('pairAllowed: staff need PGP plus an attested key, a passkey or a PGP key with no fingerprint in common', () => {
    expect(pairAllowed('staff', pgp('a'), sk())).toBe(true);
    expect(pairAllowed('staff', sk(), pgp('a'))).toBe(true);
    expect(pairAllowed('staff', pgp('a'), pk)).toBe(true);
    expect(pairAllowed('staff', pk, pgp('a'))).toBe(true);
    expect(pairAllowed('staff', pgp('a'), pgp('b'))).toBe(true);
    expect(pairAllowed('staff', pgp('a'), pgp('a'))).toBe(false);
    expect(pairAllowed('staff', pgp('a', 'b'), pgp('b'))).toBe(false); // the first proved "a or b"
    expect(pairAllowed('staff', pgp('a'), pgp('c', 'a'))).toBe(false);
    expect(pairAllowed('staff', pgp(), pgp('a'))).toBe(false); // no fingerprint proves nothing
    expect(pairAllowed('staff', pgp('a'), sk(false))).toBe(false);
    expect(pairAllowed('staff', sk(), pk)).toBe(false);
    expect(pairAllowed('staff', pk, sk())).toBe(false);
    expect(pairAllowed('staff', pk, pk)).toBe(false);
    expect(pairAllowed('staff', sk(), sk())).toBe(false);
    expect(pairAllowed('trader', pgp('a'), sk())).toBe(false);
  });

  it('needsAfter', () => {
    expect(needsAfter('owner', pgp('a'))).toEqual(['security-key']);
    expect(needsAfter('owner', sk())).toEqual(['pgp']);
    expect(needsAfter('owner', sk(false))).toEqual([]);
    expect(needsAfter('owner', pk)).toEqual([]);
    expect(needsAfter('staff', pgp('a'))).toEqual(['pgp', 'security-key', 'passkey']);
    expect(needsAfter('staff', sk())).toEqual(['pgp']);
    expect(needsAfter('staff', pk)).toEqual(['pgp']);
    expect(needsAfter('trader', pgp('a'))).toEqual([]);
  });
});

describe('ownerReady (R1)', () => {
  it('needs two attested security keys and a PGP key', async () => {
    const { id } = await account('owner');
    await addCredential(id, 'security-key', true);
    expect(await ownerReady(deps, id)).toBe(false); // one attested key
    const second = await addCredential(id, 'security-key', false);
    expect(await ownerReady(deps, id)).toBe(false); // two, one unattested
    await deps.db.query('update webauthn_credentials set attested = true where id = $1', [second.id]);
    expect(await ownerReady(deps, id)).toBe(false); // two attested, no PGP key
    await addPgp(id, await genKey());
    expect(await ownerReady(deps, id)).toBe(true);
  });

  it('counts only PGP keys usable now: a revoked or expired one is no PGP key', async () => {
    const { id } = await account('owner');
    await addCredential(id, 'security-key', true);
    await addCredential(id, 'security-key', true);
    const revoked = await genKey();
    await addPgp(id, revoked);
    expect(await ownerReady(deps, id)).toBe(true);
    await revokeStored(id, revoked);
    expect(await ownerReady(deps, id)).toBe(false);
    await deps.db.query('delete from pgp_keys where account_id = $1', [id]);
    await addPgp(id, await genKey({ date: new Date(now.getTime() - HOUR), keyExpirationTime: 2 * 3600 }));
    expect(await ownerReady(deps, id)).toBe(true);
    setNow(new Date(now.getTime() + 2 * HOUR));
    expect(await ownerReady(deps, id)).toBe(false);
  });
});

describe('GET /v1/account/methods', () => {
  it('lists every method; PGP by the last 16 hex of its fingerprint, recovery codes as one entry', async () => {
    const { id } = await account();
    const key = await genKey();
    const pgpId = await addPgp(id, key);
    const pass = await addCredential(id, 'passkey', false);
    await addPassword(id);
    await addTotp(id);
    await addRecoveryCodes(id, ['AAAA-BBBB-CCCC-DDDD', 'EEEE-FFFF-GGGG-HHHH', '0000-1111-2222-3333']);
    await deps.db.query(`update recovery_codes set used_at = $2 where account_id = $1 and ctid = (select min(ctid) from recovery_codes where account_id = $1)`, [id, now]);

    const res = await (await loggedIn(id)).get('/v1/account/methods');
    expect(res.statusCode).toBe(200);
    const list = res.json() as Array<{ type: MethodType; id: string; label: string; createdAt: string; lastUsedAt: string | null }>;
    expect(list.map((m) => m.type)).toEqual(['pgp', 'passkey', 'password', 'totp', 'recovery-codes']);
    expect(list[0]).toEqual({ type: 'pgp', id: pgpId, label: key.fingerprint.slice(-16), createdAt: now.toISOString(), lastUsedAt: null });
    expect(list[1]).toMatchObject({ type: 'passkey', id: pass.id, label: 'passkey label' });
    expect(list[2]).toMatchObject({ type: 'password', id: 'password' });
    expect(list[3]).toMatchObject({ type: 'totp', id: 'totp' });
    expect(list[4]).toMatchObject({ type: 'recovery-codes', id: 'recovery-codes', label: '2 left', lastUsedAt: now.toISOString() });
    expect(await listMethods(deps.db, id)).toEqual(list);
    // Nothing secret: no hashes, no armored key.
    expect(res.body).not.toContain('argon2');
    expect(res.body).not.toContain('BEGIN PGP');
  });

  it('answers a held recovery session and a stale Terms version', async () => {
    const { id } = await account();
    await addPgp(id, await genKey());
    const held = await loggedIn(id, { level: 'recovery', holdUntil: new Date(now.getTime() + DAY) });
    expect((await held.get('/v1/account/methods')).statusCode).toBe(200);
    await deps.db.query(`update accounts set terms_version = '2000-01-01' where id = $1`, [id]);
    expect((await (await loggedIn(id)).get('/v1/account/methods')).statusCode).toBe(200);
  });

  it('needs a session', async () => {
    const res = await new Browser().get('/v1/account/methods');
    expect(res.statusCode).toBe(401);
  });
});

describe('removing a login method', () => {
  it('refuses the last primary method; after adding a passkey, removal ends every other session (P2-I6)', async () => {
    const { id } = await account();
    const pgpId = await addPgp(id, await genKey());
    const b = await loggedIn(id);
    const other = await loggedIn(id);
    const t = await token(b, id, { kind: 'remove-method', method: 'pgp', id: pgpId });
    const refused = await b.del(`/v1/account/methods/pgp/${pgpId}`, { confirmToken: t });
    expect(refused.statusCode).toBe(409);
    expect(errorOf(refused)).toBe('last-login-method');

    await addCredential(id, 'passkey', false);
    // The refusal came before the token was redeemed: the same token still works.
    const res = await b.del(`/v1/account/methods/pgp/${pgpId}`, { confirmToken: t });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    const { rows } = await deps.db.query('select 1 from pgp_keys where account_id = $1', [id]);
    expect(rows).toHaveLength(0);
    expect(await alertsOf(id, 'login-method-removed')).toEqual([{ method: 'pgp', label: expect.any(String) }]);
    expect(await alertsOf(id, 'sessions-ended')).toEqual([{ count: 1, reason: 'login-method-removed' }]);
    expect((await other.get('/v1/account/methods')).statusCode).toBe(401);
    expect((await b.get('/v1/account/methods')).statusCode).toBe(200);
  });

  it('needs a confirm token bound to that exact method; a full session only', async () => {
    const { id } = await account();
    const pgpId = await addPgp(id, await genKey());
    const passkey = await addCredential(id, 'passkey', false);
    const b = await loggedIn(id);
    const missing = await b.del(`/v1/account/methods/pgp/${pgpId}`, {});
    expect(missing.statusCode).toBe(403);
    expect(missing.json()).toEqual({ error: 'confirm-required', action: 'remove-method' });
    const noBody = await b.del(`/v1/account/methods/pgp/${pgpId}`);
    expect(errorOf(noBody)).toBe('confirm-required');
    const wrong = await token(b, id, { kind: 'remove-method', method: 'passkey', id: passkey.id });
    const res = await b.del(`/v1/account/methods/pgp/${pgpId}`, { confirmToken: wrong });
    expect(res.statusCode).toBe(403);
    expect(errorOf(res)).toBe('confirm-invalid');

    const rec = await loggedIn(id, { level: 'recovery' });
    const r = await rec.del(`/v1/account/methods/pgp/${pgpId}`, { confirmToken: 'x' });
    expect(r.statusCode).toBe(403);
    expect(errorOf(r)).toBe('recovery-session');
  });

  it('answers 404 for an unknown type, an unknown id and another account’s method, before any token is spent', async () => {
    const { id } = await account();
    await addPgp(id, await genKey());
    await addCredential(id, 'passkey', false);
    const other = await account();
    const otherKey = await addPgp(other.id, await genKey());
    const b = await loggedIn(id);
    const t = await token(b, id, { kind: 'remove-method', method: 'pgp', id: otherKey });
    for (const url of [
      `/v1/account/methods/pgp/${otherKey}`,
      `/v1/account/methods/pgp/${randomBytes(16).toString('hex')}`,
      '/v1/account/methods/pgp/not-a-uuid',
      '/v1/account/methods/email/x',
      '/v1/account/methods/totp/totp', // the account has none
    ]) {
      const res = await b.del(url, { confirmToken: t });
      expect(res.statusCode, url).toBe(404);
      expect(errorOf(res)).toBe('not-found');
    }
    const { rows } = await deps.db.query('select used_at from confirm_tokens where account_id = $1', [id]);
    expect(rows[0].used_at).toBeNull();
  });

  it("owner G13: a vendor's last passkey, security key or PGP key can't go, even with a password; after adding another it can", async () => {
    const { id } = await account();
    await addPassword(id);
    const pgpId = await addPgp(id, await genKey());
    await deps.db.query("update accounts set account_type = 'vendor', vendor_since = $2 where id = $1", [id, now]);
    const b = await loggedIn(id);
    const t = await token(b, id, { kind: 'remove-method', method: 'pgp', id: pgpId });
    const refused = await b.del(`/v1/account/methods/pgp/${pgpId}`, { confirmToken: t });
    expect([refused.statusCode, errorOf(refused)]).toEqual([409, 'last-login-method']);
    await addCredential(id, 'passkey', false);
    const t2 = await token(b, id, { kind: 'remove-method', method: 'pgp', id: pgpId });
    expect((await b.del(`/v1/account/methods/pgp/${pgpId}`, { confirmToken: t2 })).statusCode).toBe(200);
    expect((await listMethods(deps.db, id)).map((m) => m.type).sort()).toEqual(['passkey', 'password']);
  });

  it('owner G13 (security review 8 Nov M3): an expired PGP key does not count, so a vendor with one and a passkey keeps the passkey', async () => {
    const { id } = await account();
    await addPassword(id);
    // Expired a day after it was made, long before `now`.
    await addPgp(id, await genKey({ keyExpirationTime: 86_400 }));
    const passkey = await addCredential(id, 'passkey', false);
    await deps.db.query("update accounts set account_type = 'vendor', vendor_since = $2 where id = $1", [id, now]);
    const b = await loggedIn(id);
    const t = await token(b, id, { kind: 'remove-method', method: 'passkey', id: passkey.id });
    const refused = await b.del(`/v1/account/methods/passkey/${passkey.id}`, { confirmToken: t });
    expect([refused.statusCode, errorOf(refused)]).toEqual([409, 'last-login-method']);
  });

  it('a trader whose only primary method is a password keeps it; TOTP and recovery codes can go', async () => {
    const { id } = await account();
    await addPassword(id);
    await addTotp(id);
    await addRecoveryCodes(id, ['AAAA-BBBB-CCCC-DDDD']);
    const b = await loggedIn(id);
    const t = await token(b, id, { kind: 'remove-method', method: 'password', id: 'password' });
    const res = await b.del('/v1/account/methods/password/password', { confirmToken: t });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res)).toBe('last-login-method');

    const t2 = await token(b, id, { kind: 'remove-method', method: 'totp', id: 'totp' });
    expect((await b.del('/v1/account/methods/totp/totp', { confirmToken: t2 })).statusCode).toBe(200);
    const t3 = await token(b, id, { kind: 'remove-method', method: 'recovery-codes', id: 'recovery-codes' });
    expect((await b.del('/v1/account/methods/recovery-codes/recovery-codes', { confirmToken: t3 })).statusCode).toBe(200);
    expect((await listMethods(deps.db, id)).map((m) => m.type)).toEqual(['password']);
  });

  it('owner minimums: two attested keys and a PGP key stay', async () => {
    const { id } = await account('owner');
    const k1 = await addCredential(id, 'security-key', true);
    const k2 = await addCredential(id, 'security-key', true);
    const pgpId = await addPgp(id, await genKey());
    const b = await loggedIn(id);
    for (const [method, mid] of [['security-key', k1.id], ['security-key', k2.id], ['pgp', pgpId]] as const) {
      const t = await token(b, id, { kind: 'remove-method', method, id: mid });
      const res = await b.del(`/v1/account/methods/${method}/${mid}`, { confirmToken: t });
      expect(res.statusCode).toBe(409);
      expect(errorOf(res)).toBe('last-login-method');
    }
    // With a third attested key, one may go.
    await addCredential(id, 'security-key', true);
    const t = await token(b, id, { kind: 'remove-method', method: 'security-key', id: k1.id });
    expect((await b.del(`/v1/account/methods/security-key/${k1.id}`, { confirmToken: t })).statusCode).toBe(200);
  });

  it('owner minimums count attested keys only: an unattested key may go, an attested one may not', async () => {
    const { id } = await account('owner');
    const k1 = await addCredential(id, 'security-key', true);
    await addCredential(id, 'security-key', true);
    const loose = await addCredential(id, 'security-key', false);
    await addPgp(id, await genKey());
    const b = await loggedIn(id);
    const t1 = await token(b, id, { kind: 'remove-method', method: 'security-key', id: k1.id });
    const res = await b.del(`/v1/account/methods/security-key/${k1.id}`, { confirmToken: t1 });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res)).toBe('last-login-method');
    const t2 = await token(b, id, { kind: 'remove-method', method: 'security-key', id: loose.id });
    expect((await b.del(`/v1/account/methods/security-key/${loose.id}`, { confirmToken: t2 })).statusCode).toBe(200);
  });

  it('owner minimums count usable PGP keys only: the last good key stays beside a revoked one; the revoked one may go', async () => {
    const { id } = await account('owner');
    await addCredential(id, 'security-key', true);
    await addCredential(id, 'security-key', true);
    const dead = await genKey();
    await addPgp(id, dead);
    const deadId = await revokeStored(id, dead);
    const good = await addPgp(id, await genKey());
    const b = await loggedIn(id);
    const t = await token(b, id, { kind: 'remove-method', method: 'pgp', id: good });
    const res = await b.del(`/v1/account/methods/pgp/${good}`, { confirmToken: t });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res)).toBe('last-login-method');
    const td = await token(b, id, { kind: 'remove-method', method: 'pgp', id: deadId });
    expect((await b.del(`/v1/account/methods/pgp/${deadId}`, { confirmToken: td })).statusCode).toBe(200);
  });

  it('owner minimums: an expired PGP key does not count either', async () => {
    const { id } = await account('owner');
    await addCredential(id, 'security-key', true);
    await addCredential(id, 'security-key', true);
    await addPgp(id, await genKey({ date: new Date(now.getTime() - HOUR), keyExpirationTime: 2 * 3600 }));
    const good = await addPgp(id, await genKey());
    setNow(new Date(now.getTime() + 2 * HOUR));
    const b = await loggedIn(id);
    const t = await token(b, id, { kind: 'remove-method', method: 'pgp', id: good });
    const res = await b.del(`/v1/account/methods/pgp/${good}`, { confirmToken: t });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res)).toBe('last-login-method');
  });

  it('staff minimums count usable PGP keys only', async () => {
    // Two-PGP pair: a revoked key is no second PGP key.
    const crew = await account('staff');
    const dead = await genKey();
    await addPgp(crew.id, dead);
    await revokeStored(crew.id, dead);
    const a = await addPgp(crew.id, await genKey());
    await addPgp(crew.id, await genKey());
    const b = await loggedIn(crew.id);
    const t = await token(b, crew.id, { kind: 'remove-method', method: 'pgp', id: a });
    const res = await b.del(`/v1/account/methods/pgp/${a}`, { confirmToken: t });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res)).toBe('last-login-method');

    // PGP + passkey: the good PGP key stays beside a revoked one.
    const other = await account('staff');
    const dead2 = await genKey();
    await addPgp(other.id, dead2);
    await revokeStored(other.id, dead2);
    const good = await addPgp(other.id, await genKey());
    await addCredential(other.id, 'passkey', false);
    const b2 = await loggedIn(other.id);
    const t2 = await token(b2, other.id, { kind: 'remove-method', method: 'pgp', id: good });
    expect(errorOf(await b2.del(`/v1/account/methods/pgp/${good}`, { confirmToken: t2 }))).toBe('last-login-method');
  });

  it('staff minimums: a valid pair always stays', async () => {
    const { id } = await account('staff');
    const pgpA = await addPgp(id, await genKey());
    const passkey = await addCredential(id, 'passkey', false);
    const b = await loggedIn(id);
    const t = await token(b, id, { kind: 'remove-method', method: 'passkey', id: passkey.id });
    const res = await b.del(`/v1/account/methods/passkey/${passkey.id}`, { confirmToken: t });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res)).toBe('last-login-method');
    const tp = await token(b, id, { kind: 'remove-method', method: 'pgp', id: pgpA });
    expect(errorOf(await b.del(`/v1/account/methods/pgp/${pgpA}`, { confirmToken: tp }))).toBe('last-login-method');

    // An unattested security key is no partner; a second PGP key is.
    await addCredential(id, 'security-key', false);
    expect(errorOf(await b.del(`/v1/account/methods/passkey/${passkey.id}`, { confirmToken: t }))).toBe('last-login-method');
    await addPgp(id, await genKey());
    expect((await b.del(`/v1/account/methods/passkey/${passkey.id}`, { confirmToken: t })).statusCode).toBe(200);
  });

  it('two parallel removals cannot both pass the minimum', async () => {
    const { id } = await account();
    const pgpId = await addPgp(id, await genKey());
    const passkey = await addCredential(id, 'passkey', false);
    const b = await loggedIn(id);
    const t1 = await token(b, id, { kind: 'remove-method', method: 'pgp', id: pgpId });
    const t2 = await token(b, id, { kind: 'remove-method', method: 'passkey', id: passkey.id });
    const results = await Promise.all([
      b.del(`/v1/account/methods/pgp/${pgpId}`, { confirmToken: t1 }),
      b.del(`/v1/account/methods/passkey/${passkey.id}`, { confirmToken: t2 }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(await listMethods(deps.db, id)).toHaveLength(1);
  });
});

describe('PUT /v1/account/password', () => {
  it('sets a password, ends every other session and keeps the calling one', async () => {
    const { id, username } = await account();
    await addPgp(id, await genKey());
    const b = await loggedIn(id);
    const other = await loggedIn(id);
    const t = await token(b, id, { kind: 'set-password' });
    const res = await b.put('/v1/account/password', { password: GOOD, confirmToken: t });
    expect(res.statusCode).toBe(200);
    // Stored under the current pepper (FU-C).
    const { rows: pw } = await deps.db.query('select pepper_id from passwords where account_id = $1', [id]);
    expect(pw).toEqual([{ pepper_id: deps.config.passwordPeppers.current }]);
    expect((await other.get('/v1/account/methods')).statusCode).toBe(401);
    expect((await b.get('/v1/account/methods')).statusCode).toBe(200);
    expect(await alertsOf(id, 'login-method-added')).toEqual([{ method: 'password' }]);

    // Replacing it works the same way; the new password logs in, the old one does not.
    const t2 = await token(b, id, { kind: 'set-password' });
    expect((await b.put('/v1/account/password', { password: OTHER_GOOD, confirmToken: t2 })).statusCode).toBe(200);
    const login = (pw: string) => new Browser().post('/v1/login/password', { loginName: username, password: pw, deviceLabel: 'x' });
    expect((await login(GOOD)).statusCode).toBe(401);
    expect((await login(OTHER_GOOD)).statusCode).toBe(200);
  });

  it('needs a confirm token outside onboarding; the creating session has 30 minutes without one', async () => {
    const { id } = await account();
    await addPgp(id, await genKey());
    const later = await loggedIn(id);
    const res = await later.put('/v1/account/password', { password: GOOD });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'confirm-required', action: 'set-password' });

    const start = now;
    const first = await loggedIn(id, { firstSession: true });
    expect((await first.put('/v1/account/password', { password: GOOD })).statusCode).toBe(200);
    setNow(new Date(start.getTime() + 31 * MIN));
    const late = await first.put('/v1/account/password', { password: OTHER_GOOD });
    expect(late.statusCode).toBe(403);
    expect(errorOf(late)).toBe('confirm-required');
  });

  it('checks the password before redeeming the token', async () => {
    const { id } = await account();
    await addPgp(id, await genKey());
    const b = await loggedIn(id);
    const t = await token(b, id, { kind: 'set-password' });
    const weak = await b.put('/v1/account/password', { password: 'short', confirmToken: t });
    expect(weak.statusCode).toBe(400);
    expect(errorOf(weak)).toBe('password-weak');
    const leaked = await b.put('/v1/account/password', { password: 'Password123!', confirmToken: t });
    expect(errorOf(leaked)).toBe('password-leaked');
    expect((await b.put('/v1/account/password', { password: GOOD, confirmToken: t })).statusCode).toBe(200);
  });

  it('a held recovery session is refused until the hold ends; then it needs no token', async () => {
    const { id } = await account();
    await addTotp(id);
    const holdUntil = new Date(now.getTime() + DAY);
    const rec = await loggedIn(id, { level: 'recovery', holdUntil });
    const held = await rec.put('/v1/account/password', { password: GOOD });
    expect(held.statusCode).toBe(403);
    expect(errorOf(held)).toBe('recovery-hold');
    setNow(holdUntil);
    expect((await rec.put('/v1/account/password', { password: GOOD })).statusCode).toBe(200);
  });
});

describe('staff and owner: no password, TOTP or recovery codes (R2)', () => {
  it('refuses them for staff and the owner before any token is spent', async () => {
    for (const kind of ['staff', 'owner'] as const) {
      const { id } = await account(kind);
      const b = await loggedIn(id, { firstSession: true });
      for (const [url, put] of [['/v1/account/password', true], ['/v1/account/totp/start', false], ['/v1/account/recovery-codes', false]] as const) {
        const res = put ? await b.put(url, { password: GOOD }) : await b.post(url, {});
        expect(res.statusCode, `${kind} ${url}`).toBe(403);
        expect(errorOf(res)).toBe('method-not-allowed');
      }
    }
  });

  it('staff can add a PGP key and a passkey', async () => {
    const { id } = await account('staff');
    const b = await loggedIn(id, { firstSession: true });
    const key = await genKey();
    const s = await b.post('/v1/account/pgp/start', { publicKey: key.publicKey });
    expect(s.statusCode).toBe(200);
    const code = codeOf(await decrypt(s.json().encryptedMessage, key.privateKey));
    expect((await b.post('/v1/account/pgp/finish', { challengeId: s.json().challengeId, code })).statusCode).toBe(200);

    const auth = createSoftAuthenticator({ backedUp: true, userVerified: true });
    const ws = await b.post('/v1/account/webauthn/start', { kind: 'passkey' });
    expect(ws.statusCode).toBe(200);
    const wf = await b.post('/v1/account/webauthn/finish', { challengeId: ws.json().challengeId, response: auth.register(ws.json().options, ORIGIN) });
    expect(wf.statusCode).toBe(201);
    expect((await listMethods(deps.db, id)).map((m) => m.type)).toEqual(['pgp', 'passkey']);
  });

  it('a staff recovery code gives the unknown-username answer and no session', async () => {
    const { username, id } = await account('staff');
    await addRecoveryCodes(id, ['AAAA-BBBB-CCCC-DDDD']);
    const b = new Browser();
    const res = await b.post('/v1/login/backup', { loginName: username, kind: 'recovery-code', code: 'AAAA-BBBB-CCCC-DDDD', deviceLabel: 'x' });
    const unknown = await new Browser().post('/v1/login/backup', {
      loginName: uniqueName('ghost'), kind: 'recovery-code', code: 'AAAA-BBBB-CCCC-DDDD', deviceLabel: 'x',
    });
    expect(res.statusCode).toBe(unknown.statusCode);
    expect(res.json()).toEqual(unknown.json());
    expect(res.json()).toEqual({ error: 'credentials-invalid' });
    expect(b.cookies[SESSION_COOKIE]).toBeUndefined();
    expect(await sessionCount(id)).toBe(0);
  });

  it('a staff password row never logs in, and the verify runs once against the dummy hash', async () => {
    const { username, id } = await account('staff');
    await addPassword(id);
    const verify = vi.spyOn(argon2, 'verify');
    const res = await new Browser().post('/v1/login/password', { loginName: username, password: GOOD, deviceLabel: 'x' });
    expect(res.statusCode).toBe(401);
    expect(errorOf(res)).toBe('credentials-invalid');
    expect(verify).toHaveBeenCalledTimes(1);
    expect(await sessionCount(id)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Two factors for staff and the owner (R1)

/** A PGP login step: by the pasted key (`_username` is kept for symmetry with `keyStep`; PGP login needs no name). */
async function pgpStep(b: Browser, _username: string, key: Pair, pendingId?: string, mount = TRADER_LOGIN) {
  const s = await b.post(`${mount}/pgp/start`, { key: key.publicKey, ...(pendingId ? { pendingId } : {}) });
  expect(s.statusCode).toBe(200);
  const code = codeOf(await decrypt(s.json().encryptedMessage, key.privateKey));
  return b.post(`${mount}/pgp/finish`, { challengeId: s.json().challengeId, code, deviceLabel: 'Desk', ...(pendingId ? { pendingId } : {}) });
}

async function keyStep(b: Browser, username: string, auth: SoftAuthenticator, pendingId?: string, mount = TRADER_LOGIN) {
  const s = await b.post(`${mount}/webauthn/start`, { loginName: username, ...(pendingId ? { pendingId } : {}) });
  expect(s.statusCode).toBe(200);
  const { challengeId, options } = s.json();
  const res = await b.post(`${mount}/webauthn/finish`, {
    challengeId, response: auth.authenticate(options, ORIGIN), deviceLabel: 'Desk', ...(pendingId ? { pendingId } : {}),
  });
  return { res, options };
}

const hasSessionCookie = (res: LightMyRequestResponse) => res.cookies.some((c) => c.name === SESSION_COOKIE);

// Staff and owner steps go to the staff API's mounts (`STAFF_LOGIN`): neither logs in on the trader API (owner Q13).
describe('two factors for staff and the owner (R1)', () => {
  it('owner: security key, then PGP with the pendingId → a full session', async () => {
    const { id, username } = await account('owner');
    const { auth } = await addCredential(id, 'security-key', true);
    await addPgp(id, keys[0]!);
    const b = new Browser();
    const { res: first } = await keyStep(b, username, auth, undefined, STAFF_LOGIN);
    expect(first.statusCode).toBe(200);
    const body = first.json();
    expect(body).toEqual({ status: 'second-factor', pendingId: expect.any(String), needs: ['pgp'] });
    expect(hasSessionCookie(first)).toBe(false);
    expect(await sessionCount(id)).toBe(0);

    const second = await pgpStep(b, username, keys[0]!, body.pendingId, STAFF_LOGIN);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ status: 'ok' });
    expect(hasSessionCookie(second)).toBe(true);
    const { rows } = await deps.db.query('select level from sessions where account_id = $1', [id]);
    expect(rows).toEqual([{ level: 'full' }]);
    expect(await alertsOf(id, 'new-login')).toEqual([{ method: 'pgp', deviceLabel: 'Desk' }]);

    // The pending login was used up.
    const again = await keyStep(new Browser(), username, auth, body.pendingId, STAFF_LOGIN);
    expect(again.res.statusCode).toBe(400);
  });

  it('owner: PGP, then the security key → a full session', async () => {
    const { id, username } = await account('owner');
    const { auth } = await addCredential(id, 'security-key', true);
    await addPgp(id, keys[0]!);
    const b = new Browser();
    const first = await pgpStep(b, username, keys[0]!, undefined, STAFF_LOGIN);
    expect(first.json()).toEqual({ status: 'second-factor', pendingId: expect.any(String), needs: ['security-key'] });
    expect(hasSessionCookie(first)).toBe(false);
    const { res } = await keyStep(b, username, auth, first.json().pendingId, STAFF_LOGIN);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    expect(hasSessionCookie(res)).toBe(true);
  });

  it('staff: PGP + passkey → a session', async () => {
    const { id, username } = await account('staff');
    await addPgp(id, keys[0]!);
    const { auth } = await addCredential(id, 'passkey', false, createSoftAuthenticator({ backedUp: true, userVerified: true }));
    const b = new Browser();
    const first = await pgpStep(b, username, keys[0]!, undefined, STAFF_LOGIN);
    expect(first.json()).toMatchObject({ status: 'second-factor', needs: ['pgp', 'security-key', 'passkey'] });
    const { res } = await keyStep(b, username, auth, first.json().pendingId, STAFF_LOGIN);
    expect(res.json()).toEqual({ status: 'ok' });
    expect(hasSessionCookie(res)).toBe(true);
  });

  it('staff: two different PGP keys → a session; the first challenge goes to one key and the second leaves it out', async () => {
    const { id, username } = await account('staff');
    await addPgp(id, keys[0]!, new Date(now.getTime() - 2 * MIN));
    await addPgp(id, keys[1]!, new Date(now.getTime() - MIN));
    const b = new Browser();
    const s1 = await b.post(`${STAFF_LOGIN}/pgp/start`, { key: keys[0]!.publicKey });
    await expect(decrypt(s1.json().encryptedMessage, keys[1]!.privateKey)).rejects.toThrow();
    const c1 = codeOf(await decrypt(s1.json().encryptedMessage, keys[0]!.privateKey));
    const first = await b.post(`${STAFF_LOGIN}/pgp/finish`, { challengeId: s1.json().challengeId, code: c1, deviceLabel: 'Desk' });
    const pendingId = first.json().pendingId as string;
    expect(first.json().status).toBe('second-factor');

    const s2 = await b.post(`${STAFF_LOGIN}/pgp/start`, { key: keys[1]!.publicKey, pendingId });
    await expect(decrypt(s2.json().encryptedMessage, keys[0]!.privateKey)).rejects.toThrow();
    const c2 = codeOf(await decrypt(s2.json().encryptedMessage, keys[1]!.privateKey));
    const second = await b.post(`${STAFF_LOGIN}/pgp/finish`, { challengeId: s2.json().challengeId, code: c2, deviceLabel: 'Desk', pendingId });
    expect(second.json()).toEqual({ status: 'ok' });
    expect(hasSessionCookie(second)).toBe(true);
  });

  it('staff: the same PGP key twice is refused (method-not-allowed), and the pending login stays used', async () => {
    const { id, username } = await account('staff');
    await addPgp(id, keys[0]!);
    await addCredential(id, 'passkey', false);
    const b = new Browser();
    const first = await pgpStep(b, username, keys[0]!, undefined, STAFF_LOGIN);
    const pendingId = first.json().pendingId as string;
    // The same key for the second PGP step: a decoy (bound to no account), whose code never works.
    const s2 = await b.post(`${STAFF_LOGIN}/pgp/start`, { key: keys[0]!.publicKey, pendingId });
    expect(s2.statusCode).toBe(200);
    expect((await deps.db.query('select account_id from challenges where id = $1', [s2.json().challengeId])).rows).toEqual([{ account_id: null }]);
    // Forced through completeLogin, the same key is no pair.
    const fp = keys[0]!.fingerprint;
    const forced = await b.post('/t/complete', { accountId: id, factor: { method: 'pgp', fingerprint: fp, fingerprints: [fp] }, pendingId });
    expect(forced.statusCode).toBe(403);
    expect(errorOf(forced)).toBe('method-not-allowed');
    expect(hasSessionCookie(forced)).toBe(false);
    const retry = await b.post('/t/complete', { accountId: id, factor: { method: 'passkey', credentialId: 'x', attested: false }, pendingId });
    expect(errorOf(retry)).toBe('challenge-expired');
    expect(await sessionCount(id)).toBe(0);
  });

  it('staff: a security key then a passkey or a second security key is no pair', async () => {
    const { id, username } = await account('staff');
    const k1 = await addCredential(id, 'security-key', true);
    const k2 = await addCredential(id, 'security-key', true);
    const pk = await addCredential(id, 'passkey', false);
    await addPgp(id, keys[0]!);
    const b = new Browser();
    const first = await keyStep(b, username, k1.auth, undefined, STAFF_LOGIN);
    expect(first.res.json()).toMatchObject({ status: 'second-factor', needs: ['pgp'] });
    const pendingId = first.res.json().pendingId as string;
    // A passkey is offered only after PGP (Task 8), so its answer fails the WebAuthn check first.
    const viaPasskey = await keyStep(b, username, pk.auth, pendingId, STAFF_LOGIN);
    expect(viaPasskey.options.allowCredentials.map((c: { id: string }) => c.id)).not.toContain(pk.auth.credentialId);
    expect(viaPasskey.res.statusCode).toBe(401);
    // Forced through completeLogin, security key + passkey is refused by the pairing rule.
    const forced = await b.post('/t/complete', { accountId: id, factor: { method: 'passkey', credentialId: pk.auth.credentialId, attested: false }, pendingId });
    expect(errorOf(forced)).toBe('method-not-allowed');

    const again = (await keyStep(b, username, k1.auth, undefined, STAFF_LOGIN)).res.json().pendingId as string;
    const second = await keyStep(b, username, k2.auth, again, STAFF_LOGIN);
    expect(second.res.statusCode).toBe(403);
    expect(errorOf(second.res)).toBe('method-not-allowed');
    expect(await sessionCount(id)).toBe(0);
  });

  it('a pendingId from another device or another account, or at 5:00, → challenge-expired', async () => {
    const { id, username } = await account('owner');
    const { auth } = await addCredential(id, 'security-key', true);
    await addPgp(id, keys[0]!);
    const crew = await account('staff');
    const crewKey = await addCredential(crew.id, 'security-key', true);
    await addPgp(crew.id, keys[1]!);

    // Another device.
    const a = new Browser();
    const p1 = (await pgpStep(a, username, keys[0]!, undefined, STAFF_LOGIN)).json().pendingId as string;
    const elsewhere = await keyStep(new Browser(), username, auth, p1, STAFF_LOGIN);
    expect(elsewhere.res.statusCode).toBe(400);
    expect(errorOf(elsewhere.res)).toBe('challenge-expired');
    expect(hasSessionCookie(elsewhere.res)).toBe(false);

    // Another account (same browser).
    const p2 = (await pgpStep(a, username, keys[0]!, undefined, STAFF_LOGIN)).json().pendingId as string;
    // The staff member's key on the staff API's mount (staff never log in on the trader API).
    const cross = await keyStep(a, crew.username, crewKey.auth, p2, STAFF_LOGIN);
    expect(errorOf(cross.res)).toBe('challenge-expired');

    // At exactly 5:00.
    const t = now;
    const p3 = (await pgpStep(a, username, keys[0]!, undefined, STAFF_LOGIN)).json().pendingId as string;
    setNow(new Date(t.getTime() + 4 * MIN));
    const s = await a.post(`${STAFF_LOGIN}/webauthn/start`, { loginName: username, pendingId: p3 });
    setNow(new Date(t.getTime() + 5 * MIN));
    const late = await a.post(`${STAFF_LOGIN}/webauthn/finish`, {
      challengeId: s.json().challengeId, response: auth.authenticate(s.json().options, ORIGIN), deviceLabel: 'Desk', pendingId: p3,
    });
    expect(late.statusCode).toBe(400);
    expect(errorOf(late)).toBe('challenge-expired');
    expect(await sessionCount(id)).toBe(0);
    expect(await sessionCount(crew.id)).toBe(0);
  });

  it('a WebAuthn finish uses the pendingId its start was given', async () => {
    const { id, username } = await account('owner');
    const { auth } = await addCredential(id, 'security-key', true);
    await addPgp(id, keys[0]!);
    const b = new Browser();
    const pendingId = (await pgpStep(b, username, keys[0]!, undefined, STAFF_LOGIN)).json().pendingId as string;
    // Started without one: finishing with one is refused, and the pending login is untouched.
    const s = await b.post(`${STAFF_LOGIN}/webauthn/start`, { loginName: username });
    const res = await b.post(`${STAFF_LOGIN}/webauthn/finish`, {
      challengeId: s.json().challengeId, response: auth.authenticate(s.json().options, ORIGIN), deviceLabel: 'Desk', pendingId,
    });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res)).toBe('challenge-expired');
    const ok = await keyStep(b, username, auth, pendingId, STAFF_LOGIN);
    expect(ok.res.json()).toEqual({ status: 'ok' });
  });

  it('a request from another device or account leaves the pending login usable by its own browser', async () => {
    const { id, username } = await account('owner');
    const { auth } = await addCredential(id, 'security-key', true);
    await addPgp(id, keys[0]!);
    const crew = await account('staff');
    await addPgp(crew.id, keys[1]!);
    const a = new Browser();
    const pendingId = (await pgpStep(a, username, keys[0]!, undefined, STAFF_LOGIN)).json().pendingId as string;
    expect(errorOf((await keyStep(new Browser(), username, auth, pendingId, STAFF_LOGIN)).res)).toBe('challenge-expired');
    const cross = await a.post('/t/complete', {
      accountId: crew.id, factor: { method: 'security-key', credentialId: 'k', attested: true }, pendingId,
    });
    expect(errorOf(cross)).toBe('challenge-expired');
    const { rows } = await deps.db.query('select used_at from challenges where id = $1', [pendingId]);
    expect(rows[0].used_at).toBeNull();
    const ok = await keyStep(a, username, auth, pendingId, STAFF_LOGIN);
    expect(ok.res.json()).toEqual({ status: 'ok' });
    expect(await sessionCount(crew.id)).toBe(0);
  });

  it('a first factor that is in no pair gets no pending login; a trader never has one', async () => {
    const owner = await account('owner');
    const res = await new Browser().post('/t/complete', {
      accountId: owner.id, factor: { method: 'security-key', credentialId: 'k', attested: false },
    });
    expect(res.statusCode).toBe(403);
    expect(errorOf(res)).toBe('method-not-allowed');
    const { rows } = await deps.db.query(`select 1 from challenges where account_id = $1 and purpose = 'second-factor'`, [owner.id]);
    expect(rows).toHaveLength(0);

    const trader = await account();
    const t = await new Browser().post('/t/complete', {
      accountId: trader.id, factor: { method: 'passkey', credentialId: 'p', attested: false }, pendingId: randomUUID(),
    });
    expect(errorOf(t)).toBe('challenge-expired');
    expect(await sessionCount(trader.id)).toBe(0);
  });

  it('a pending row of another method (a trader password login’s TOTP step) is never a pending pair', async () => {
    const { id, username } = await account('staff');
    await addPgp(id, keys[0]!, new Date(now.getTime() - 2 * MIN));
    await addPgp(id, keys[1]!, new Date(now.getTime() - MIN));
    const passkey = await addCredential(id, 'passkey', false);
    const b = new Browser();
    const pendingId = (await pgpStep(b, username, keys[0]!, undefined, STAFF_LOGIN)).json().pendingId as string;
    await deps.db.query(`update challenges set method = 'totp' where id = $1`, [pendingId]);
    // WebAuthn: no PGP first factor is seen, so the passkey is not listed (decoy options).
    const w = await b.post(`${STAFF_LOGIN}/webauthn/start`, { loginName: username, pendingId });
    const listed = (w.json().options.allowCredentials as Array<{ id: string }>).map((c) => c.id);
    expect(listed).not.toContain(passkey.auth.credentialId);
    // PGP: a decoy, not a challenge to the other key.
    const s = await b.post(`${STAFF_LOGIN}/pgp/start`, { key: keys[1]!.publicKey, pendingId });
    expect(s.statusCode).toBe(200);
    expect((await deps.db.query('select account_id from challenges where id = $1', [s.json().challengeId])).rows).toEqual([{ account_id: null }]);
  });

  it('traders still log in with one factor', async () => {
    const { id, username } = await account();
    await addPgp(id, keys[2]!);
    const res = await pgpStep(new Browser(), username, keys[2]!);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});
