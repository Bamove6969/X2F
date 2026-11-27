import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deps } from '../src/app.js';
import { randomBytes } from 'node:crypto';
import { fileAttestationPolicy } from '../src/auth/attestation.js';
import { issueConfirmToken, requireConfirm } from '../src/auth/confirm.js';
import { DEVICE_COOKIE } from '../src/auth/device.js';
import { SESSION_COOKIE, requireSession, startSession } from '../src/auth/sessions.js';
import {
  assertCredentialAllowed,
  MAX_SECURITY_KEYS,
  registrationOptionsFor,
  securityKeyLoginRoutes,
  verifyWebAuthnAssertion,
  verifyWebAuthnRegistration,
  webauthnAssertionOptions,
  webauthnRegistrationOptions,
} from '../src/auth/webauthn.js';
import { ApiError } from '../src/errors.js';
import { accountIdByLoginName, confirmTokenFor, confirmTokenMethod, currentLoginTag, seedAccount as seedTagged } from './helpers/accounts.js';
import { approvedLogin } from './helpers/approval.js';
import { testApp } from './helpers/app.js';
import { createSoftAuthenticator, createTestCa, writeTestMds, type SoftAuthenticator, type TestCa } from './helpers/softAuthenticator.js';
import { spySql } from './helpers/sqlSpy.js';
import { SIG } from './helpers/signature.js';
import { openTermsSignature } from '../src/termsSignature.js';

const ORIGIN = 'https://x2f.test';
const T0 = new Date('2026-10-17T12:00:00Z');
const HOUR = 3600_000;
const MIN = 60_000;
const TERMS = '2026-10-17';
const ALLOWED = '11111111-2222-4333-8444-555555555555';
const UNLISTED = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const NO_STATEMENT = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
/** On staff's allowlist but not the owner's (like a YubiKey 5 below firmware 5.7, a Security Key or a Titan). */
const STAFF_ONLY = '12121212-3434-4565-8787-909090909090';

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let now = T0;
let step = 0;
let ca: TestCa;
let mdsDir: string;
let afterAuthCalls: string[] = [];
let twoFactorCalls: string[] = [];

/** One browser: keeps the cookies the API sets. */
class Browser {
  cookies: Record<string, string> = {};
  async post(url: string, payload: unknown): Promise<LightMyRequestResponse> {
    const res = await app.inject({
      method: 'POST', url, headers: { origin: ORIGIN }, cookies: this.cookies, payload: payload as Record<string, unknown>,
    });
    for (const c of res.cookies) this.cookies[c.name] = c.value;
    return res;
  }
}

beforeAll(async () => {
  ca = createTestCa();
  mdsDir = await mkdtemp(join(tmpdir(), 'x2f-mds-'));
  await writeTestMds(mdsDir, ca, { statements: [ALLOWED, UNLISTED, STAFF_ONLY], allow: [ALLOWED, STAFF_ONLY], ownerAllow: [ALLOWED] });
  const attestation = fileAttestationPolicy(mdsDir);
  await attestation.init();
  let set: (d: Date) => void;
  ({ app, deps, setNow: set } = await testApp({ attestation }));
  setNow = (d) => {
    now = d;
    set(d);
  };
  app.post('/t/session', async (req, reply) => {
    const { accountId, first } = req.body as { accountId: string; first: boolean };
    await startSession(deps, req, reply, { accountId, level: 'full', deviceLabel: 'Test', method: 'pgp', firstSession: first });
    return { ok: true };
  });
  app.post(
    '/t/add-wallet',
    { preHandler: [requireSession(), requireConfirm({ kind: 'add-wallet', addressHash: 'a'.repeat(64), addressEnd: 'abc' })] },
    async () => ({ ok: true }),
  );
  await app.register(securityKeyLoginRoutes, {
    prefix: '/t/sk',
    kinds: ['trader'],
    afterAuthenticate: async (accountId: string) => {
      afterAuthCalls.push(accountId);
      throw new ApiError(403, 'account-disabled');
    },
  });
  await app.register(securityKeyLoginRoutes, { prefix: '/t/staff-only', kinds: ['staff'] });
  await app.register(securityKeyLoginRoutes, {
    prefix: '/t/two',
    kinds: ['owner', 'staff'],
    afterAuthenticate: async (accountId: string) => void twoFactorCalls.push(accountId),
  });
});

afterAll(async () => {
  await app.close();
  await rm(mdsDir, { recursive: true, force: true });
});

beforeEach(() => {
  setNow(new Date(T0.getTime() + ++step * HOUR));
  afterAuthCalls = [];
  twoFactorCalls = [];
  vi.restoreAllMocks();
});

/** Owners seeded by the current test; afterEach deletes them even when the test fails (one owner per database). */
let seededOwners: string[] = [];

afterEach(async () => {
  if (seededOwners.length > 0) await deps.db.query('delete from accounts where id = any($1::uuid[])', [seededOwners]);
  seededOwners = [];
});

/** Login names of seeded and signed-up accounts: the database holds only their tags (FU-D). */
const loginNames = new Map<string, string>();
async function seedAccount(...args: Parameters<typeof seedTagged>): Promise<string> {
  const id = await seedTagged(...args);
  if (args[1].loginName !== null) loginNames.set(id, args[1].loginName);
  return id;
}

let nameSeq = 0;
const uniqueName = (prefix: string) => `${prefix}${String(++nameSeq).padStart(4, '0')}x`;
/** Sign-up names for a test login name: Trade Tag `D.<login name>`. */
const names = (loginName: string) => ({ tradeTag: `D.${loginName}`, loginName });

async function seedOwner(): Promise<string> {
  const id = await seedAccount(deps, { loginName: uniqueName('boss'), kind: 'owner' });
  seededOwners.push(id);
  return id;
}

/** Signs up a trader with a passkey or security key; returns the browser (logged in) and authenticator. */
async function signUp(kind: 'passkey' | 'security-key', username = uniqueName('user')) {
  const b = new Browser();
  const auth = createSoftAuthenticator({ backedUp: kind === 'passkey', userVerified: true });
  const start = await b.post('/v1/register/webauthn/start', { ...names(username), kind });
  expect(start.statusCode).toBe(200);
  const { challengeId, options } = start.json();
  const res = await b.post('/v1/register/webauthn/finish', {
    challengeId, response: auth.register(options, ORIGIN), deviceLabel: 'Laptop', acceptedTerms: TERMS, termsSignature: SIG,
  });
  expect(res.statusCode).toBe(201);
  const accountId = (await accountIdByLoginName(deps, username))!;
  loginNames.set(accountId, username);
  return { b, auth, username, accountId, options };
}

async function discoverableLogin(auth: SoftAuthenticator, o: { origin?: string; rpId?: string; type?: string; b?: Browser } = {}) {
  const b = o.b ?? new Browser();
  const start = await b.post('/v1/login/webauthn/start', {});
  const { challengeId, options } = start.json();
  const response = auth.authenticate(options, o.origin ?? ORIGIN, {
    ...(o.rpId ? { rpId: o.rpId } : {}), ...(o.type ? { type: o.type } : {}),
  });
  const res = await b.post('/v1/login/webauthn/finish', { challengeId, response, deviceLabel: 'Phone' });
  return { res, b, challengeId, response, start };
}

async function usernameLogin(auth: SoftAuthenticator, username: string, b = new Browser(), prefix = '/v1/login/webauthn') {
  const start = await b.post(`${prefix}/start`, { loginName: username });
  const { challengeId, options } = start.json();
  const res = await b.post(`${prefix}/finish`, { challengeId, response: auth.authenticate(options, ORIGIN), deviceLabel: 'Desk' });
  return { res, b, options };
}

async function loggedIn(accountId: string, first = false) {
  const b = new Browser();
  expect((await b.post('/t/session', { accountId, first })).statusCode).toBe(200);
  return b;
}

async function insertCredential(accountId: string, auth: SoftAuthenticator, kind: string, attested: boolean) {
  await deps.db.query(
    `insert into webauthn_credentials (account_id, credential_id, public_key, counter, kind, backed_up, device_type, attested, label, created_at)
     values ($1, $2, $3, 0, $4, false, 'singleDevice', $5, 'k', $6)`,
    [accountId, Buffer.from(auth.credentialId, 'base64url'), auth.cosePublicKey, kind, attested, now],
  );
}

const errorOf = (res: LightMyRequestResponse) => (res.json() as { error?: string }).error;

describe('passkey sign-up and discoverable login', () => {
  it('registers a passkey, then logs in without a username', async () => {
    const { auth, accountId } = await signUp('passkey');
    const { rows: before } = await deps.db.query('select kind, attested, backed_up from webauthn_credentials where account_id = $1', [accountId]);
    expect(before).toEqual([{ kind: 'passkey', attested: false, backed_up: true }]);

    const { res, start, b } = await discoverableLogin(auth);
    expect(start.json().options.allowCredentials).toEqual([]);
    expect(start.json().options.userVerification).toBe('required');
    expect(res.statusCode).toBe(200);
    // Task 16: the sign-up browser is still logged in, so this new one is approved first.
    expect(await approvedLogin(deps, res, (u) => b.post(u, {}))).toEqual({ status: 'ok' });
    expect(b.cookies[SESSION_COOKIE]).toBeDefined();
    const { rows } = await deps.db.query('select last_used_at from webauthn_credentials where account_id = $1', [accountId]);
    expect(rows[0].last_used_at).toEqual(now);
    const alerts = await deps.db.query("select detail from alerts where account_id = $1 and kind = 'new-login'", [accountId]);
    expect(alerts.rows).toHaveLength(1);
    expect(alerts.rows[0].detail).toMatchObject({ method: 'passkey' });
  });

  it('requires the current Terms before creating anything (R10)', async () => {
    const b = new Browser();
    const username = uniqueName('terms');
    const auth = createSoftAuthenticator({ backedUp: true, userVerified: true });
    const { challengeId, options } = (await b.post('/v1/register/webauthn/start', { ...names(username), kind: 'passkey' })).json();
    const response = auth.register(options, ORIGIN);
    for (const acceptedTerms of [undefined, '2026-01-01']) {
      const res = await b.post('/v1/register/webauthn/finish', { challengeId, response, deviceLabel: 'L', acceptedTerms, termsSignature: SIG });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'terms-not-accepted', version: TERMS });
    }
    // A signature that is sent is checked (owner, 8 Nov 2026), still before the challenge is used;
    // since owner demo note #187 a trader may send none, but an explicit null is not "none".
    for (const [termsSignature, error] of [[null, 'signature-invalid'], [{ kind: 'typed', name: '' }, 'signature-invalid']] as const) {
      const res = await b.post('/v1/register/webauthn/finish', { challengeId, response, deviceLabel: 'L', acceptedTerms: TERMS, termsSignature });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error });
    }
    expect(await accountIdByLoginName(deps, username)).toBeUndefined();
    const ok = await b.post('/v1/register/webauthn/finish', { challengeId, response, deviceLabel: 'L', acceptedTerms: TERMS, termsSignature: SIG });
    expect(ok.statusCode).toBe(201);
    const id = (await accountIdByLoginName(deps, username))!;
    const { rows } = await deps.db.query('select terms_version, terms_signature from accounts where id = $1', [id]);
    expect(rows[0].terms_version).toBe(TERMS);
    expect(openTermsSignature(deps.config, rows[0].terms_signature, id)).toEqual(SIG);
  });

  // Owner demo note #187 (25 Nov 2026): a trader agrees with the tick alone.
  it('registers with no signature: the current version is recorded and no signature is stored', async () => {
    const b = new Browser();
    const username = uniqueName('nosig');
    const auth = createSoftAuthenticator({ backedUp: true, userVerified: true });
    const { challengeId, options } = (await b.post('/v1/register/webauthn/start', { ...names(username), kind: 'passkey' })).json();
    const response = auth.register(options, ORIGIN);
    const ok = await b.post('/v1/register/webauthn/finish', { challengeId, response, deviceLabel: 'L', acceptedTerms: TERMS });
    expect(ok.statusCode).toBe(201);
    const id = (await accountIdByLoginName(deps, username))!;
    const { rows } = await deps.db.query('select terms_version, terms_signature from accounts where id = $1', [id]);
    expect(rows[0].terms_version).toBe(TERMS);
    expect(rows[0].terms_signature).toBeNull();
  });

  it('puts a 32-byte user handle in the options, never the username', async () => {
    const { options, accountId, username } = await signUp('passkey', 'Handle.Check7');
    const id = Buffer.from(options.user.id, 'base64url');
    expect(id).toHaveLength(32);
    expect(id.toString('latin1').toLowerCase()).not.toContain(username.toLowerCase());
    // The authenticator stores and shows the public Trade Tag only, never the private login name.
    expect(options.user.name).toBe(`D.${username}`);
    expect(JSON.stringify(options)).not.toContain(`"${username}"`);
    const { rows } = await deps.db.query('select webauthn_user_id from accounts where id = $1', [accountId]);
    expect(rows[0].webauthn_user_id).toEqual(id);
  });

  it('refuses a taken username at start', async () => {
    const { username } = await signUp('passkey');
    const res = await new Browser().post('/v1/register/webauthn/start', { ...names(username.toUpperCase()), kind: 'passkey' });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res)).toBe('trade-tag-taken');
  });

  it('a disabled account with a valid passkey gets account-disabled', async () => {
    const { auth, accountId } = await signUp('passkey');
    await deps.db.query('update accounts set disabled_at = $2 where id = $1', [accountId, now]);
    const { res } = await discoverableLogin(auth);
    expect(res.statusCode).toBe(403);
    expect(errorOf(res)).toBe('account-disabled');
  });
});

describe('WebAuthn security checks (P2-I4)', () => {
  it('refuses another origin at login and at registration', async () => {
    const { auth } = await signUp('passkey');
    const { res } = await discoverableLogin(auth, { origin: 'https://evil.test' });
    expect(res.statusCode).toBe(401);
    expect(errorOf(res)).toBe('webauthn-failed');

    const b = new Browser();
    const fresh = createSoftAuthenticator({ backedUp: true, userVerified: true });
    const { challengeId, options } = (await b.post('/v1/register/webauthn/start', { ...names(uniqueName('evil')), kind: 'passkey' })).json();
    const reg = await b.post('/v1/register/webauthn/finish', {
      challengeId, response: fresh.register(options, 'https://evil.test'), deviceLabel: 'L', acceptedTerms: TERMS, termsSignature: SIG,
    });
    expect(errorOf(reg)).toBe('webauthn-failed');
  });

  it('refuses an rpIdHash for another RP ID', async () => {
    const { auth } = await signUp('passkey');
    const { res } = await discoverableLogin(auth, { rpId: 'other.test' });
    expect(errorOf(res)).toBe('webauthn-failed');
  });

  it('refuses a replayed response and a challenge at exactly 5:00', async () => {
    const { auth } = await signUp('passkey');
    const { res, b, challengeId, response } = await discoverableLogin(auth);
    expect(res.statusCode).toBe(200);
    const again = await b.post('/v1/login/webauthn/finish', { challengeId, response, deviceLabel: 'Phone' });
    expect(again.statusCode).toBe(400);
    expect(errorOf(again)).toBe('challenge-expired');

    const b2 = new Browser();
    const start = (await b2.post('/v1/login/webauthn/start', {})).json();
    const late = auth.authenticate(start.options, ORIGIN);
    setNow(new Date(now.getTime() + 5 * MIN));
    const res2 = await b2.post('/v1/login/webauthn/finish', { challengeId: start.challengeId, response: late, deviceLabel: 'P' });
    expect(errorOf(res2)).toBe('challenge-expired');
  });

  it('refuses a counter that does not increase', async () => {
    const { auth } = await signUp('passkey');
    expect((await discoverableLogin(auth)).res.statusCode).toBe(200); // reports 0
    expect((await discoverableLogin(auth)).res.statusCode).toBe(200); // reports 1
    auth.setCounter(1);
    const { res } = await discoverableLogin(auth);
    expect(errorOf(res)).toBe('webauthn-failed');
    const { rows } = await deps.db.query('select counter from webauthn_credentials where credential_id = $1', [
      Buffer.from(auth.credentialId, 'base64url'),
    ]);
    expect(rows[0].counter).toBe('1');
  });

  it('requires user presence, and user verification for passkeys', async () => {
    const { auth } = await signUp('passkey');
    auth.flags.userPresent = false;
    expect(errorOf((await discoverableLogin(auth)).res)).toBe('webauthn-failed');
    auth.flags.userPresent = true;
    auth.flags.userVerified = false;
    expect(errorOf((await discoverableLogin(auth)).res)).toBe('webauthn-failed');

    const b = new Browser();
    const noUv = createSoftAuthenticator({ backedUp: true, userVerified: false });
    const { challengeId, options } = (await b.post('/v1/register/webauthn/start', { ...names(uniqueName('nouv')), kind: 'passkey' })).json();
    const reg = await b.post('/v1/register/webauthn/finish', {
      challengeId, response: noUv.register(options, ORIGIN), deviceLabel: 'L', acceptedTerms: TERMS, termsSignature: SIG,
    });
    expect(errorOf(reg)).toBe('webauthn-failed');
  });

  // Owner decision, 16 Nov 2026 (comms to-lead.log 17:50:46): a security key stands alone, with the
  // key PIN (user verification) REQUIRED on registration and every login; the server checks the UV
  // flag itself (the options alone are only a request to the browser).
  it('a security key needs user verification (its PIN) on registration and every login', async () => {
    const b = new Browser();
    const start = (await b.post('/v1/register/webauthn/start', { ...names(uniqueName('skuv')), kind: 'security-key' })).json();
    const noPin = createSoftAuthenticator({ backedUp: false, userVerified: false });
    const reg = await b.post('/v1/register/webauthn/finish', {
      challengeId: start.challengeId, response: noPin.register(start.options, ORIGIN), deviceLabel: 'L', acceptedTerms: TERMS, termsSignature: SIG,
    });
    expect(errorOf(reg)).toBe('webauthn-failed');

    const { auth, username } = await signUp('security-key');
    const ok = await usernameLogin(auth, username);
    expect(ok.res.statusCode).toBe(200);
    auth.flags.userVerified = false;
    expect(errorOf((await usernameLogin(auth, username)).res)).toBe('webauthn-failed');
    // And the options ask the browser for it.
    expect(start.options.authenticatorSelection.userVerification).toBe('required');
    expect(ok.options.userVerification).toBe('required');
  });

  it('every kind and account kind asks for user verification at registration (staff and owner at least as strict)', () => {
    for (const accountKind of ['trader', 'staff', 'member', 'owner'] as const) {
      for (const kind of ['passkey', 'security-key'] as const) {
        if (accountKind === 'owner' && kind === 'passkey') continue;
        expect(registrationOptionsFor(kind, accountKind).authenticatorSelection.userVerification, `${accountKind} ${kind}`).toBe('required');
      }
    }
  });

  it('review m1: a login refused only for missing user verification says the key needs its PIN; nothing else does', async () => {
    const PIN = "Your key needs its PIN (or fingerprint) to log in. Set one in your key's settings, then try again.";
    const counterOf = async (auth: SoftAuthenticator) =>
      (await deps.db.query('select counter from webauthn_credentials where credential_id = $1', [Buffer.from(auth.credentialId, 'base64url')])).rows[0].counter;
    // A passkey (discoverable login) and a security key (login by name), each answering without UV.
    const passkey = await signUp('passkey');
    passkey.auth.flags.userVerified = false;
    const p = (await discoverableLogin(passkey.auth)).res;
    expect({ status: p.statusCode, body: p.json() }).toEqual({ status: 401, body: { error: 'webauthn-failed', detail: PIN } });
    const key = await signUp('security-key');
    key.auth.flags.userVerified = false;
    const k = (await usernameLogin(key.auth, key.username)).res;
    expect({ status: k.statusCode, body: k.json() }).toEqual({ status: 401, body: { error: 'webauthn-failed', detail: PIN } });
    // The refused answer moved no counter, so the next good one still logs in.
    expect(await counterOf(key.auth)).toBe('0');
    key.auth.flags.userVerified = true;
    expect((await usernameLogin(key.auth, key.username)).res.statusCode).toBe(200);

    // Without UV and also failing anything else, the answer is the plain refusal: no PIN hint.
    key.auth.flags.userVerified = false;
    key.auth.flags.userPresent = false;
    expect((await usernameLogin(key.auth, key.username)).res.json()).toEqual({ error: 'webauthn-failed' });
    key.auth.flags.userPresent = true;
    expect((await discoverableLogin(passkey.auth, { origin: 'https://evil.example' })).res.json()).toEqual({ error: 'webauthn-failed' });
    expect((await discoverableLogin(passkey.auth, { type: 'webauthn.create' })).res.json()).toEqual({ error: 'webauthn-failed' });
    const stranger = createSoftAuthenticator({ backedUp: false, userVerified: false });
    expect((await usernameLogin(stranger, key.username)).res.json()).toEqual({ error: 'webauthn-failed' });
    // A counter that does not increase, without UV: plain too.
    key.auth.flags.userVerified = true;
    expect((await usernameLogin(key.auth, key.username)).res.statusCode).toBe(200);
    key.auth.setCounter(0);
    key.auth.flags.userVerified = false;
    expect((await usernameLogin(key.auth, key.username)).res.json()).toEqual({ error: 'webauthn-failed' });
  });

  it('refuses clientDataJSON.type webauthn.create on a login', async () => {
    const { auth } = await signUp('passkey');
    expect(errorOf((await discoverableLogin(auth, { type: 'webauthn.create' })).res)).toBe('webauthn-failed');
  });

  it("refuses account A's security key on account B's username challenge", async () => {
    const a = await signUp('security-key');
    const bAcct = await signUp('security-key');
    const browser = new Browser();
    const start = (await browser.post('/v1/login/webauthn/start', { loginName: bAcct.username })).json();
    const res = await browser.post('/v1/login/webauthn/finish', {
      challengeId: start.challengeId, response: a.auth.authenticate(start.options, ORIGIN), deviceLabel: 'D',
    });
    expect(errorOf(res)).toBe('webauthn-failed');
    // B's own key on its own challenge works.
    const own = await usernameLogin(bAcct.auth, bAcct.username);
    expect(await approvedLogin(deps, own.res, (u) => own.b.post(u, {}))).toEqual({ status: 'ok' });
  });

  it('does not let a discoverable login use a security key or a wrong user handle', async () => {
    const sk = await signUp('security-key');
    expect(errorOf((await discoverableLogin(sk.auth)).res)).toBe('webauthn-failed');
    const pk = await signUp('passkey');
    const b = new Browser();
    const start = (await b.post('/v1/login/webauthn/start', {})).json();
    const response = pk.auth.authenticate(start.options, ORIGIN, { userHandle: Buffer.alloc(32, 1).toString('base64url') });
    expect(errorOf(await b.post('/v1/login/webauthn/finish', { challengeId: start.challengeId, response, deviceLabel: 'P' }))).toBe(
      'webauthn-failed',
    );
    // Discoverable login is for traders: a staff passkey is refused there.
    const crewId = await seedAccount(deps, { loginName: uniqueName('crew'), kind: 'staff' });
    const crewKey = createSoftAuthenticator({ backedUp: true, userVerified: true });
    await insertCredential(crewId, crewKey, 'passkey', false);
    const { rows } = await deps.db.query<{ webauthn_user_id: Buffer }>('select webauthn_user_id from accounts where id = $1', [crewId]);
    const s2 = (await b.post('/v1/login/webauthn/start', {})).json();
    const crewResponse = crewKey.authenticate(s2.options, ORIGIN, { userHandle: rows[0]!.webauthn_user_id.toString('base64url') });
    expect(errorOf(await b.post('/v1/login/webauthn/finish', { challengeId: s2.challengeId, response: crewResponse, deviceLabel: 'P' }))).toBe(
      'webauthn-failed',
    );
  });
});

describe('enumeration (P2-I7)', () => {
  it('answers unknown names and passkey-only accounts with decoy options of the same shape', async () => {
    const real = await signUp('security-key');
    const passkeyOnly = await signUp('passkey');
    const b = new Browser();
    const responses = await Promise.all(
      [real.username, 'Nobody.Here42', passkeyOnly.username, 'bad name!'].map((username) => b.post('/v1/login/webauthn/start', { loginName: username })),
    );
    const shapes = responses.map((r) => {
      expect(r.statusCode).toBe(200);
      const j = r.json();
      return { top: Object.keys(j).sort(), options: Object.keys(j.options).sort(), cred: Object.keys(j.options.allowCredentials[0]).sort() };
    });
    for (const s of shapes) expect(s).toEqual(shapes[0]);

    const again = (await b.post('/v1/login/webauthn/start', { loginName: 'Nobody.Here42' })).json();
    const first = responses[1]!.json();
    expect(again.options.allowCredentials).toEqual(first.options.allowCredentials);
    expect(again.options.challenge).not.toEqual(first.options.challenge);
    expect(first.options.allowCredentials).toHaveLength(MAX_SECURITY_KEYS);
    const other = (await b.post('/v1/login/webauthn/start', { loginName: 'Nobody.Else42' })).json();
    expect(other.options.allowCredentials).not.toEqual(first.options.allowCredentials);
    // The passkey-only account's decoy does not list its passkey.
    expect(responses[2]!.json().options.allowCredentials.map((c: { id: string }) => c.id)).not.toContain(passkeyOnly.auth.credentialId);

    // A decoy challenge fails like a wrong key.
    const res = await b.post('/v1/login/webauthn/finish', {
      challengeId: first.challengeId, response: real.auth.authenticate(first.options, ORIGIN), deviceLabel: 'D',
    });
    expect(errorOf(res)).toBe('webauthn-failed');
  });

  it('gives decoys on a mount whose kinds exclude the account', async () => {
    const t = await signUp('security-key');
    const start = (await new Browser().post('/t/staff-only/start', { loginName: t.username })).json();
    expect(start.options.allowCredentials.map((c: { id: string }) => c.id)).not.toContain(t.auth.credentialId);
  });
});

describe('afterAuthenticate (Plan 4 mounts)', () => {
  it('runs after the credential check and stops the login before any session', async () => {
    const t = await signUp('security-key');
    const { res } = await usernameLogin(t.auth, t.username, new Browser(), '/t/sk');
    expect(res.statusCode).toBe(403);
    expect(errorOf(res)).toBe('account-disabled');
    expect(afterAuthCalls).toEqual([t.accountId]);
    expect(res.cookies.find((c) => c.name === SESSION_COOKIE)).toBeUndefined();
    // A failed credential check never reaches it.
    const stranger = createSoftAuthenticator({ backedUp: false, userVerified: true });
    afterAuthCalls = [];
    await usernameLogin(stranger, t.username, new Browser(), '/t/sk');
    expect(afterAuthCalls).toEqual([]);
  });
});

describe('login-name tags under key rotation (FU-D)', () => {
  const tagOf = async (accountId: string) =>
    (await deps.db.query<{ login_tag: Buffer; login_tag_key_id: number }>('select login_tag, login_tag_key_id from accounts where id = $1', [accountId]))
      .rows[0]!;

  it('a security key logs in by a name under the old key; only a successful login re-tags the row', async () => {
    const t = await signUp('security-key');
    // Nothing else logged in, so the new browser's login needs no approval (Plan 2 Task 16).
    await t.b.post('/v1/logout', {});
    const saved = deps.config.loginNameKeys;
    try {
      deps.config.loginNameKeys = { current: 2, keys: new Map([[2, new Uint8Array(randomBytes(32))], ...saved.keys]) };
      // A wrong key, and a right key whose login afterAuthenticate stops: no re-tag.
      expect(errorOf((await usernameLogin(createSoftAuthenticator({ backedUp: false, userVerified: true }), t.username)).res)).toBe('webauthn-failed');
      expect(errorOf((await usernameLogin(t.auth, t.username, new Browser(), '/t/sk')).res)).toBe('account-disabled');
      expect((await tagOf(t.accountId)).login_tag_key_id).toBe(1);
      expect((await usernameLogin(t.auth, t.username)).res.json()).toEqual({ status: 'ok' });
      expect(await tagOf(t.accountId)).toEqual({ login_tag: currentLoginTag(deps, t.username, 2), login_tag_key_id: 2 });
      // No challenge payload holds the plaintext login name (the Trade Tag `D.<login name>` contains it, hence the quotes).
      const { rows } = await deps.db.query<{ p: string }>('select payload::text as p from challenges');
      expect(rows.filter((r) => r.p.toLowerCase().includes(`"${t.username.toLowerCase()}"`))).toEqual([]);
    } finally {
      deps.config.loginNameKeys = saved;
    }
  });

  it('a failing re-tag after the session cookie is set still answers ok with the session (review M1)', async () => {
    const t = await signUp('security-key');
    // Nothing else logged in, so the new browser's login needs no approval (Plan 2 Task 16).
    await t.b.post('/v1/logout', {});
    const saved = deps.config.loginNameKeys;
    const real = deps.db.query.bind(deps.db) as (...a: unknown[]) => Promise<unknown>;
    const query = vi.spyOn(deps.db, 'query').mockImplementation(((...a: unknown[]) =>
      String(a[0]).startsWith('update accounts set login_tag = $2, login_tag_key_id = $3 where id = $1')
        ? Promise.reject(Object.assign(new Error('Connection terminated unexpectedly'), { code: '57P01' }))
        : real(...a)) as never);
    try {
      deps.config.loginNameKeys = { current: 2, keys: new Map([[2, new Uint8Array(randomBytes(32))], ...saved.keys]) };
      const { res, b } = await usernameLogin(t.auth, t.username);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok' });
      expect(res.cookies.find((c) => c.name === SESSION_COOKIE)).toBeDefined();
      expect((await tagOf(t.accountId)).login_tag_key_id).toBe(1);
      query.mockRestore();
      // The next login by name retries the re-tag (from the same, logged-in browser: no approval).
      expect((await usernameLogin(t.auth, t.username, b)).res.json()).toEqual({ status: 'ok' });
      expect((await tagOf(t.accountId)).login_tag_key_id).toBe(2);
    } finally {
      query.mockRestore();
      deps.config.loginNameKeys = saved;
    }
  });

  it('start runs the same SQL for names under the old key, the current key, unknown and malformed', async () => {
    const old = await signUp('security-key');
    const saved = deps.config.loginNameKeys;
    try {
      deps.config.loginNameKeys = { current: 2, keys: new Map([[2, new Uint8Array(randomBytes(32))], ...saved.keys]) };
      const current = await signUp('security-key');
      const b = new Browser();
      await b.post('/v1/login/webauthn/start', {}); // the device cookie
      const spy = spySql(deps.db);
      try {
        const sqlOf = async (loginName: string) => {
          spy.clear();
          expect((await b.post('/v1/login/webauthn/start', { loginName })).statusCode).toBe(200);
          return spy.sql();
        };
        const all = [await sqlOf(old.username), await sqlOf(current.username), await sqlOf(uniqueName('ghost')), await sqlOf('bad name!')];
        for (const sql of all.slice(1)) expect(sql).toEqual(all[0]);
      } finally {
        spy.restore();
      }
    } finally {
      deps.config.loginNameKeys = saved;
    }
  });
});

describe('attestation for staff and owner (P2-I5, R1)', () => {
  async function staffAdd(b: Browser, auth: SoftAuthenticator, kind: 'passkey' | 'security-key') {
    const start = await b.post('/v1/account/webauthn/start', { kind });
    expect(start.statusCode).toBe(200);
    const { challengeId, options } = start.json();
    return { options, res: await b.post('/v1/account/webauthn/finish', { challengeId, response: auth.register(options, ORIGIN), label: 'Key' }) };
  }

  it('stores attested keys only from the allowlist, and staff passkeys unattested', async () => {
    const staffId = await seedAccount(deps, { loginName: uniqueName('crew'), kind: 'staff' });
    const b = await loggedIn(staffId, true);

    const none = createSoftAuthenticator({ backedUp: false, userVerified: true, attestation: 'none' });
    const r1 = await staffAdd(b, none, 'security-key');
    expect(r1.options.attestation).toBe('direct');
    expect(r1.options.authenticatorSelection).toMatchObject({ authenticatorAttachment: 'cross-platform', residentKey: 'discouraged' });
    expect(r1.res.statusCode).toBe(403);
    expect(errorOf(r1.res)).toBe('method-not-allowed');

    const unlisted = createSoftAuthenticator({ backedUp: false, userVerified: true, attestation: { aaguid: UNLISTED, ca } });
    expect(errorOf((await staffAdd(b, unlisted, 'security-key')).res)).toBe('method-not-allowed');

    // Self attestation names any AAGUID it likes: never attested.
    const selfAtt = createSoftAuthenticator({ backedUp: false, userVerified: true, attestation: { aaguid: ALLOWED, self: true } });
    expect(errorOf((await staffAdd(b, selfAtt, 'security-key')).res)).toBe('method-not-allowed');

    const unknown = createSoftAuthenticator({ backedUp: false, userVerified: true, attestation: { aaguid: NO_STATEMENT, ca } });
    // A vendor outside the snapshot is a policy refusal for staff and owner (M6).
    expect(errorOf((await staffAdd(b, unknown, 'security-key')).res)).toBe('method-not-allowed');

    const good = createSoftAuthenticator({ backedUp: false, userVerified: true, attestation: { aaguid: ALLOWED, ca } });
    const r2 = await staffAdd(b, good, 'security-key');
    expect(r2.res.statusCode).toBe(201);

    const pk = createSoftAuthenticator({ backedUp: true, userVerified: true });
    const r3 = await staffAdd(b, pk, 'passkey');
    expect(r3.options.attestation).toBe('none');
    expect(r3.res.statusCode).toBe(201);

    const { rows } = await deps.db.query('select kind, attested, aaguid from webauthn_credentials where account_id = $1 order by created_at, kind desc', [staffId]);
    expect(rows).toEqual([
      { kind: 'security-key', attested: true, aaguid: ALLOWED },
      { kind: 'passkey', attested: false, aaguid: null },
    ]);
  });

  it('checks the owner against the owner allowlist and staff against the staff allowlist (owner, 2026-10-20)', async () => {
    const staffId = await seedAccount(deps, { loginName: uniqueName('crew'), kind: 'staff' });
    const staff = await loggedIn(staffId, true);
    const staffKey = createSoftAuthenticator({ backedUp: false, userVerified: true, attestation: { aaguid: STAFF_ONLY, ca } });
    expect((await staffAdd(staff, staffKey, 'security-key')).res.statusCode).toBe(201);

    const ownerId = await seedOwner();
    const owner = await loggedIn(ownerId, true);
    const ownerStaffKey = createSoftAuthenticator({ backedUp: false, userVerified: true, attestation: { aaguid: STAFF_ONLY, ca } });
    const refused = await staffAdd(owner, ownerStaffKey, 'security-key');
    expect(refused.options.attestation).toBe('direct');
    expect(refused.res.statusCode).toBe(403);
    expect(errorOf(refused.res)).toBe('method-not-allowed');
    const ownerKey = createSoftAuthenticator({ backedUp: false, userVerified: true, attestation: { aaguid: ALLOWED, ca } });
    expect((await staffAdd(owner, ownerKey, 'security-key')).res.statusCode).toBe(201);

    const { rows } = await deps.db.query('select account_id, attested, aaguid from webauthn_credentials where account_id = any($1) order by created_at', [[staffId, ownerId]]);
    expect(rows).toEqual([
      { account_id: staffId, attested: true, aaguid: STAFF_ONLY },
      { account_id: ownerId, attested: true, aaguid: ALLOWED },
    ]);
  });

  it("takes a trader's security key of any model, attested or not, even one outside the snapshot (owner demo 13 Nov)", async () => {
    // Owner, 16 Nov 2026: every security key verifies its user (PIN), so these keys do; the subject here is attestation.
    // A browser may pass the key's own attestation on although 'none' was asked for.
    // One new trader per key: since sign-up v2 (review M1(b)) the sign-up window adds a first key
    // only; a second one needs a confirm token, which this test is not about.
    const keys = [
      createSoftAuthenticator({ backedUp: false, userVerified: true, attestation: 'none' }),
      createSoftAuthenticator({ backedUp: false, userVerified: true, attestation: { aaguid: UNLISTED, ca } }),
      createSoftAuthenticator({ backedUp: false, userVerified: true, attestation: { aaguid: NO_STATEMENT, ca } }),
      createSoftAuthenticator({ backedUp: false, userVerified: true, attestation: { aaguid: NO_STATEMENT, self: true } }),
    ];
    const traders: string[] = [];
    for (const [i, key] of keys.entries()) {
      const traderId = await seedAccount(deps, { loginName: uniqueName('trd'), kind: 'trader', methods: false });
      traders.push(traderId);
      const r = await staffAdd(await loggedIn(traderId, true), key, 'security-key');
      expect(r.options.attestation).toBe('none');
      expect(r.options.hints).toEqual(['security-key']);
      // Owner 25 Nov security-key report: ES256 first (every FIDO2 key and Android do it), then EdDSA and RS256.
      expect(r.options.pubKeyCredParams.map((p: { alg: number }) => p.alg)).toEqual([-7, -8, -257]);
      expect(r.options.authenticatorSelection).toMatchObject({ authenticatorAttachment: 'cross-platform', residentKey: 'discouraged', userVerification: 'required' });
      expect(r.res.statusCode, `key ${i}`).toBe(201);
    }
    const { rows } = await deps.db.query('select kind, attested from webauthn_credentials where account_id = any($1::uuid[])', [traders]);
    expect(rows).toEqual(keys.map(() => ({ kind: 'security-key', attested: false })));
  });

  it("review M1: takes a trader's key whatever fails in its attestation statement; staff, owner and member stay refused", async () => {
    // The model's statement is in the snapshot, but the chain leads to another root (a root the
    // snapshot has not caught up with), or the leaf has expired: a trader's key still registers.
    const otherRoot = createTestCa();
    const expired = createTestCa({ expiredLeaves: true });
    // One new trader per key: since sign-up v2 the sign-up window adds a first key only.
    const traders: string[] = [];
    for (const [name, att] of [['another root', { aaguid: UNLISTED, ca: otherRoot }], ['another root, allowlisted model', { aaguid: ALLOWED, ca: otherRoot }], ['expired leaf', { aaguid: ALLOWED, ca: expired }]] as const) {
      const id = await seedAccount(deps, { loginName: uniqueName('trd'), kind: 'trader', methods: false });
      traders.push(id);
      const r = await staffAdd(await loggedIn(id, true), createSoftAuthenticator({ backedUp: false, userVerified: true, attestation: att }), 'security-key');
      expect(r.res.statusCode, name).toBe(201);
    }
    const { rows } = await deps.db.query('select kind, attested from webauthn_credentials where account_id = any($1::uuid[])', [traders]);
    expect(rows).toEqual([1, 2, 3].map(() => ({ kind: 'security-key', attested: false })));
    const trader = await loggedIn(await seedAccount(deps, { loginName: uniqueName('trd'), kind: 'trader', methods: false }), true);

    // The retry without the statement still checks the rest: a wrong origin is still 401.
    const start = await trader.post('/v1/account/webauthn/start', { kind: 'security-key' });
    const { challengeId, options } = start.json();
    const wrongOrigin = createSoftAuthenticator({ backedUp: false, userVerified: true, attestation: { aaguid: UNLISTED, ca: otherRoot } }).register(options, 'https://evil.example');
    const bad = await trader.post('/v1/account/webauthn/finish', { challengeId, response: wrongOrigin, label: 'Key' });
    expect(bad.statusCode).toBe(401);
    expect(errorOf(bad)).toBe('webauthn-failed');

    // Staff and the owner (their add-key route) and a team member's login (the Plan 4 helpers that
    // the team screens use): the same keys are not taken, and an unlisted model is still refused.
    const staffId = await seedAccount(deps, { loginName: uniqueName('crew'), kind: 'staff' });
    const ownerId = await seedOwner();
    for (const [who, id] of [['staff', staffId], ['owner', ownerId]] as const) {
      const b = await loggedIn(id, true);
      for (const att of [{ aaguid: ALLOWED, ca: otherRoot }, { aaguid: ALLOWED, ca: expired }]) {
        const r = await staffAdd(b, createSoftAuthenticator({ backedUp: false, userVerified: true, attestation: att }), 'security-key');
        expect(r.res.statusCode, who).toBe(401);
      }
      for (const att of [{ aaguid: UNLISTED, ca }, { aaguid: NO_STATEMENT, ca }]) {
        const r = await staffAdd(b, createSoftAuthenticator({ backedUp: false, userVerified: true, attestation: att }), 'security-key');
        expect(r.res.statusCode, who).toBe(403);
        expect(errorOf(r.res), who).toBe('method-not-allowed');
      }
    }
    const memberId = await seedAccount(deps, { loginName: uniqueName('mbr'), kind: 'member' });
    const challenge = new Uint8Array(32).fill(5);
    const memberOptions = await webauthnRegistrationOptions(deps, memberId, { kind: 'security-key', challenge });
    expect(memberOptions.attestation).toBe('direct');
    const verify = (att: { aaguid: string; ca: TestCa }) =>
      verifyWebAuthnRegistration(deps, memberId, createSoftAuthenticator({ backedUp: false, userVerified: true, attestation: att }).register(memberOptions, ORIGIN), challenge, { kind: 'security-key' });
    for (const att of [{ aaguid: ALLOWED, ca: otherRoot }, { aaguid: ALLOWED, ca: expired }]) {
      await expect(verify(att)).rejects.toMatchObject({ status: 401, code: 'webauthn-failed' });
    }
    for (const att of [{ aaguid: UNLISTED, ca }, { aaguid: NO_STATEMENT, ca }]) {
      await expect(verify(att)).rejects.toMatchObject({ status: 403, code: 'method-not-allowed' });
    }
    const { rows: others } = await deps.db.query('select count(*)::int as n from webauthn_credentials where account_id = any($1)', [[staffId, ownerId, memberId]]);
    expect(others).toEqual([{ n: 0 }]);
  });

  it('refuses an owner passkey before any confirm token is spent', async () => {
    const ownerId = await seedOwner();
    const b = await loggedIn(ownerId, true);
    const res = await b.post('/v1/account/webauthn/start', { kind: 'passkey' });
    expect(errorOf(res)).toBe('method-not-allowed');
    expect(() => registrationOptionsFor('passkey', 'owner')).toThrow(ApiError);
  });

  it('refuses an owner login with an unattested passkey', async () => {
    const ownerId = await seedOwner();
    const key = createSoftAuthenticator({ backedUp: false, userVerified: true });
    const pk = createSoftAuthenticator({ backedUp: true, userVerified: true });
    await insertCredential(ownerId, key, 'security-key', true);
    await insertCredential(ownerId, pk, 'passkey', false);
    const { res, options } = await usernameLogin(pk, await usernameOf(ownerId), new Browser(), '/t/two'); // the owner logs in only on the staff site's mount (owner Q13)
    const listed = options.allowCredentials.map((c: { id: string }) => c.id);
    expect(listed).toHaveLength(MAX_SECURITY_KEYS); // the key plus decoys (review I2)
    expect(listed).toContain(key.credentialId);
    expect(listed).not.toContain(pk.credentialId);
    expect(res.statusCode).toBe(403);
    expect(errorOf(res)).toBe('method-not-allowed');
    expect(res.cookies.find((c) => c.name === SESSION_COOKIE)).toBeUndefined();
  });

  it('assertCredentialAllowed follows R1', () => {
    const ok = (k: 'trader' | 'staff' | 'owner', kind: string, attested: boolean) => {
      try {
        assertCredentialAllowed(k, { kind, attested });
        return true;
      } catch (e) {
        expect(e).toMatchObject({ status: 403, code: 'method-not-allowed' });
        return false;
      }
    };
    expect(ok('owner', 'security-key', true)).toBe(true);
    expect(ok('owner', 'security-key', false)).toBe(false);
    expect(ok('owner', 'passkey', false)).toBe(false);
    expect(ok('owner', 'passkey', true)).toBe(false);
    expect(ok('staff', 'security-key', true)).toBe(true);
    expect(ok('staff', 'security-key', false)).toBe(false);
    expect(ok('staff', 'passkey', false)).toBe(true); // only as PGP's partner (pairAllowed)
    expect(ok('trader', 'passkey', false)).toBe(true);
    expect(ok('trader', 'security-key', false)).toBe(true);
    expect(ok('trader', 'password', false)).toBe(false);
  });

  it('lists a staff passkey at login only after a PGP or security-key first factor from the same device (owner G3; on a staff mount: staff log in only on the staff API, owner 2026-11-03)', async () => {
    const name = uniqueName('crewlogin');
    const staffId = await seedAccount(deps, { loginName: name, kind: 'staff' });
    const key = createSoftAuthenticator({ backedUp: false, userVerified: true });
    const pk = createSoftAuthenticator({ backedUp: true, userVerified: true });
    await insertCredential(staffId, key, 'security-key', true);
    await insertCredential(staffId, pk, 'passkey', false);
    const b = new Browser();
    const plain = (await b.post('/t/two/start', { loginName: name })).json();
    const ids = (j: { options: { allowCredentials: Array<{ id: string }> } }) => j.options.allowCredentials.map((c) => c.id);
    // The key among decoys (review I2: always MAX_SECURITY_KEYS entries), never the passkey.
    expect(ids(plain)).toHaveLength(MAX_SECURITY_KEYS);
    expect(ids(plain)).toContain(key.credentialId);
    expect(ids(plain)).not.toContain(pk.credentialId);

    const device = await deps.db.query<{ device_hash: Buffer }>('select device_hash from challenges where id = $1', [plain.challengeId]);
    const insertPending = (method: string, deviceHash: Buffer) =>
      deps.db.query<{ id: string }>(
        `insert into challenges (account_id, device_hash, purpose, method, payload, created_at, expires_at)
         values ($1, $2, 'second-factor', 'pair', $3, $4, $5) returning id`,
        [
          staffId, deviceHash,
          // A PGP first factor as completeLogin records it (parseFactor needs the fingerprints).
          JSON.stringify({ first: method === 'pgp' ? { method, fingerprint: 'a'.repeat(40), fingerprints: ['a'.repeat(40)] } : { method }, app: 'trader' }),
          now, new Date(now.getTime() + 5 * MIN),
        ],
      );
    const afterPgp = (await insertPending('pgp', device.rows[0]!.device_hash)).rows[0]!.id;
    const withPending = (await b.post('/t/two/start', { loginName: name, pendingId: afterPgp })).json();
    expect(ids(withPending)).toEqual(expect.arrayContaining([key.credentialId, pk.credentialId]));
    expect(ids(withPending)).toHaveLength(MAX_SECURITY_KEYS);
    // The second step needs no login name (review I3): the pending login from this device names the account.
    const nameless = (await b.post('/t/two/start', { pendingId: afterPgp })).json();
    expect(ids(nameless)).toEqual(expect.arrayContaining([key.credentialId, pk.credentialId]));
    expect(ids(nameless)).toHaveLength(MAX_SECURITY_KEYS);
    expect(nameless.options.userVerification).toBe('required');
    // From another device, or with a pendingId that names nothing, it is a decoy; no name is needed either.
    const elsewhere = (await new Browser().post('/t/two/start', { pendingId: afterPgp })).json();
    expect(ids(elsewhere)).toHaveLength(MAX_SECURITY_KEYS);
    expect(ids(elsewhere)).not.toContain(key.credentialId);
    const nothing = (await b.post('/t/two/start', { pendingId: '0b8f3a52-6f0e-4d3c-9a4e-2b7c1d5e8f90' })).json();
    expect(ids(nothing)).toHaveLength(MAX_SECURITY_KEYS);
    expect(ids(nothing)).not.toContain(key.credentialId);
    expect(withPending.options.userVerification).toBe('required');

    // Another device, or a first factor that was not PGP: security keys only.
    const other = (await new Browser().post('/t/two/start', { loginName: name, pendingId: afterPgp })).json();
    expect(ids(other)).not.toContain(pk.credentialId);
    // Owner G3 (7 Nov): a staff key first step is followed by a PGP key or a passkey, so the passkey is listed then too.
    const afterKey = (await insertPending('security-key', device.rows[0]!.device_hash)).rows[0]!.id;
    expect(ids((await b.post('/t/two/start', { loginName: name, pendingId: afterKey })).json())).toContain(pk.credentialId);
    // Reading the pending row does not use it up.
    const { rows } = await deps.db.query('select used_at from challenges where id = $1', [afterPgp]);
    expect(rows[0].used_at).toBeNull();
    // Finishing the nameless start logs the staff member in (the pending login is consumed).
    const fin = await b.post('/t/two/finish', {
      challengeId: nameless.challengeId, response: key.authenticate(nameless.options, ORIGIN), deviceLabel: 'Desk', pendingId: afterPgp,
    });
    expect(fin.statusCode).toBe(200);
    expect(fin.json()).toEqual({ status: 'ok' });
  });
});

describe('Plan 4 helpers', () => {
  it('refuses an owner a staff-only key when the kind is left to the attestation', async () => {
    const ownerId = await seedOwner();
    const challenge = new Uint8Array(32).fill(5);
    const options = await webauthnRegistrationOptions(deps, ownerId, { challenge });
    expect(options.attestation).toBe('direct');
    const key = createSoftAuthenticator({ backedUp: false, userVerified: false, attestation: { aaguid: STAFF_ONLY, ca } });
    // Not on the owner list → not attested → counted as a passkey, which the owner may never use.
    await expect(verifyWebAuthnRegistration(deps, ownerId, key.register(options, ORIGIN), challenge)).rejects.toMatchObject({
      status: 401, code: 'webauthn-failed',
    });
    const keyUv = createSoftAuthenticator({ backedUp: false, userVerified: true, attestation: { aaguid: STAFF_ONLY, ca } });
    await expect(verifyWebAuthnRegistration(deps, ownerId, keyUv.register(options, ORIGIN), challenge)).rejects.toMatchObject({
      status: 403, code: 'method-not-allowed',
    });
    const { rows } = await deps.db.query('select 1 from webauthn_credentials where account_id = $1', [ownerId]);
    expect(rows).toEqual([]);
  });

  it('registers and verifies with caller-held challenges', async () => {
    const staffId = await seedAccount(deps, { loginName: uniqueName('helper'), kind: 'staff' });
    const challenge = new Uint8Array(32).fill(7);
    const options = await webauthnRegistrationOptions(deps, staffId, { challenge });
    expect(options.attestation).toBe('direct');
    const good = createSoftAuthenticator({ backedUp: false, userVerified: true, attestation: { aaguid: ALLOWED, ca } });
    const result = await verifyWebAuthnRegistration(deps, staffId, good.register(options, ORIGIN), challenge);
    expect(result).toEqual({ credentialId: good.credentialId, kind: 'security-key', attested: true, aaguid: ALLOWED });
    const { rows } = await deps.db.query('select attested from webauthn_credentials where account_id = $1', [staffId]);
    expect(rows).toEqual([{ attested: true }]);

    const assertChallenge = new Uint8Array(32).fill(9);
    const aOpts = await webauthnAssertionOptions(deps, staffId, assertChallenge);
    expect(aOpts.allowCredentials?.map((c) => c.id)).toEqual([good.credentialId]);
    const ok = await verifyWebAuthnAssertion(deps, staffId, good.authenticate(aOpts, ORIGIN), assertChallenge);
    expect(ok).toEqual({ credentialId: good.credentialId, kind: 'security-key', attested: true });

    const otherId = await seedAccount(deps, { loginName: uniqueName('helper'), kind: 'staff' });
    await expect(verifyWebAuthnAssertion(deps, otherId, good.authenticate(aOpts, ORIGIN), assertChallenge)).rejects.toMatchObject({
      code: 'webauthn-failed',
    });
    // Without attestation the credential can only be a passkey, which needs user verification.
    const plain = createSoftAuthenticator({ backedUp: true, userVerified: true });
    const pOpts = await webauthnRegistrationOptions(deps, otherId, { kind: 'passkey', challenge });
    expect(await verifyWebAuthnRegistration(deps, otherId, plain.register(pOpts, ORIGIN), challenge)).toMatchObject({
      kind: 'passkey', attested: false,
    });
  });
});

describe('confirm and adding a credential', () => {
  it('adds a second security key with a WebAuthn confirm token; tokens stay bound to their action', async () => {
    const t = await signUp('security-key');
    // A second kind of login method (owner 26 Nov 2026), so the session is not setup-only.
    await deps.db.query("insert into totp (account_id, secret_enc, created_at) values ($1, '\\x01', now())", [t.accountId]);
    setNow(new Date(now.getTime() + 31 * MIN)); // onboarding over
    const noToken = await t.b.post('/v1/account/webauthn/start', { kind: 'security-key' });
    expect(noToken.statusCode).toBe(403);
    expect(errorOf(noToken)).toBe('confirm-required');

    const confirm = async (action: object) => {
      const start = await t.b.post('/v1/confirm/webauthn/start', { action });
      expect(start.statusCode).toBe(200);
      const { challengeId, options } = start.json();
      const res = await t.b.post('/v1/confirm/webauthn/finish', { challengeId, response: t.auth.authenticate(options, ORIGIN) });
      expect(res.statusCode).toBe(200);
      return res.json().confirmToken as string;
    };

    const token = await confirm({ kind: 'add-method', method: 'security-key' });
    // The method comes from the stored credential that signed, never from the request (owner, 2026-10-23).
    expect(await confirmTokenMethod(deps, token)).toBe('security-key');
    const start = await t.b.post('/v1/account/webauthn/start', { kind: 'security-key', confirmToken: token });
    expect(start.statusCode).toBe(200);
    const { challengeId, options } = start.json();
    expect(options.excludeCredentials.map((c: { id: string }) => c.id)).toEqual([t.auth.credentialId]);
    const second = createSoftAuthenticator({ backedUp: false, userVerified: true }); // owner 16 Nov 2026: a security key verifies its user (PIN)
    const fin = await t.b.post('/v1/account/webauthn/finish', { challengeId, response: second.register(options, ORIGIN), label: 'Spare' });
    expect(fin.statusCode).toBe(201);
    const { rows } = await deps.db.query('select label from webauthn_credentials where account_id = $1 order by created_at', [t.accountId]);
    // Security review of wip/lead-seckey-fix: a key sent with no name gets "Security key N".
    expect(rows.map((r) => r.label)).toEqual(['Security key 1', 'Spare']);
    const alerts = await deps.db.query("select detail from alerts where account_id = $1 and kind = 'login-method-added'", [t.accountId]);
    expect(alerts.rows).toEqual([{ detail: { method: 'security-key' } }]);

    const login = (await new Browser().post('/v1/login/webauthn/start', { loginName: t.username })).json();
    expect(login.options.allowCredentials.map((c: { id: string }) => c.id)).toEqual(expect.arrayContaining([t.auth.credentialId, second.credentialId]));
    const own = await usernameLogin(second, t.username);
    expect(await approvedLogin(deps, own.res, (u) => own.b.post(u, {}))).toEqual({ status: 'ok' });

    const passkeyToken = await confirm({ kind: 'add-method', method: 'passkey' });
    const wallet = await t.b.post('/t/add-wallet', { confirmToken: passkeyToken });
    expect(wallet.statusCode).toBe(403);
    expect(errorOf(wallet)).toBe('confirm-invalid');
  });

  it('records passkey on a token confirmed with a passkey (owner, 2026-10-23)', async () => {
    const t = await signUp('passkey');
    const start = await t.b.post('/v1/confirm/webauthn/start', { action: { kind: 'extend-session' } });
    const { challengeId, options } = start.json();
    const res = await t.b.post('/v1/confirm/webauthn/finish', { challengeId, response: t.auth.authenticate(options, ORIGIN) });
    expect(res.statusCode).toBe(200);
    expect(await confirmTokenMethod(deps, res.json().confirmToken)).toBe('passkey');
  });

  it('binds a confirm challenge to its session', async () => {
    const t = await signUp('security-key');
    const other = await loggedIn(t.accountId);
    const start = (await t.b.post('/v1/confirm/webauthn/start', { action: { kind: 'key-test' } })).json();
    const res = await other.post('/v1/confirm/webauthn/finish', { challengeId: start.challengeId, response: t.auth.authenticate(start.options, ORIGIN) });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res)).toBe('challenge-expired');
  });

  it('sets the device cookie on sign-up and login routes', async () => {
    const res = await new Browser().post('/v1/login/webauthn/start', {});
    expect(res.cookies.find((c) => c.name === DEVICE_COOKIE)).toBeDefined();
  });
});

async function usernameOf(accountId: string): Promise<string> {
  return loginNames.get(accountId)!;
}

describe('review fixes', () => {
  it('I1: runs afterAuthenticate only for credentials the account kind may use', async () => {
    const ownerId = await seedOwner();
    const crewId = await seedAccount(deps, { loginName: uniqueName('crew'), kind: 'staff' });
    const ownerKey = createSoftAuthenticator({ backedUp: false, userVerified: true });
    const ownerPasskey = createSoftAuthenticator({ backedUp: true, userVerified: true });
    const ownerPlainKey = createSoftAuthenticator({ backedUp: false, userVerified: true });
    const crewKey = createSoftAuthenticator({ backedUp: false, userVerified: true });
    const crewPlainKey = createSoftAuthenticator({ backedUp: false, userVerified: true });
    await insertCredential(ownerId, ownerKey, 'security-key', true);
    await insertCredential(ownerId, ownerPasskey, 'passkey', false);
    await insertCredential(ownerId, ownerPlainKey, 'security-key', false);
    await insertCredential(crewId, crewKey, 'security-key', true);
    await insertCredential(crewId, crewPlainKey, 'security-key', false);
    const owner = await usernameOf(ownerId);
    const crew = await usernameOf(crewId);

    for (const [auth, name] of [[ownerPasskey, owner], [ownerPlainKey, owner], [crewPlainKey, crew]] as const) {
      const { res } = await usernameLogin(auth, name, new Browser(), '/t/two');
      expect(res.statusCode).toBe(403);
      expect(errorOf(res)).toBe('method-not-allowed');
      expect(res.cookies.find((c) => c.name === SESSION_COOKIE)).toBeUndefined();
    }
    expect(twoFactorCalls).toEqual([]);

    await usernameLogin(ownerKey, owner, new Browser(), '/t/two');
    await usernameLogin(crewKey, crew, new Browser(), '/t/two');
    expect(twoFactorCalls).toEqual([ownerId, crewId]);

    // Confirm: the unattested passkey is refused at finish even though the challenge is real.
    const b = await loggedIn(ownerId);
    const start = await b.post('/v1/confirm/webauthn/start', { action: { kind: 'key-test' } });
    expect(start.statusCode).toBe(200);
    const { challengeId, options } = start.json();
    const fin = await b.post('/v1/confirm/webauthn/finish', { challengeId, response: ownerPasskey.authenticate(options, ORIGIN) });
    expect(fin.statusCode).toBe(403);
    expect(errorOf(fin)).toBe('method-not-allowed');
  });

  it('M1: of two parallel assertions with the same counter, exactly one succeeds', async () => {
    const { auth } = await signUp('passkey');
    expect((await discoverableLogin(auth)).res.statusCode).toBe(200); // reports 0
    expect((await discoverableLogin(auth)).res.statusCode).toBe(200); // reports 1: stored 1
    const b1 = new Browser();
    const b2 = new Browser();
    const s1 = (await b1.post('/v1/login/webauthn/start', {})).json();
    const s2 = (await b2.post('/v1/login/webauthn/start', {})).json();
    auth.setCounter(5);
    const r1 = auth.authenticate(s1.options, ORIGIN);
    auth.setCounter(5);
    const r2 = auth.authenticate(s2.options, ORIGIN);
    const results = await Promise.all([
      b1.post('/v1/login/webauthn/finish', { challengeId: s1.challengeId, response: r1, deviceLabel: 'A' }),
      b2.post('/v1/login/webauthn/finish', { challengeId: s2.challengeId, response: r2, deviceLabel: 'B' }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 401]);
    expect(results.map((r) => errorOf(r) ?? 'ok').sort()).toEqual(['ok', 'webauthn-failed']);
  });

  it('M2: refuses a credential the challenge did not list', async () => {
    const crewId = await seedAccount(deps, { loginName: uniqueName('crew'), kind: 'staff' });
    const key = createSoftAuthenticator({ backedUp: false, userVerified: true });
    const pk = createSoftAuthenticator({ backedUp: true, userVerified: true });
    await insertCredential(crewId, key, 'security-key', true);
    await insertCredential(crewId, pk, 'passkey', false);
    const { res, options } = await usernameLogin(pk, await usernameOf(crewId), new Browser(), '/t/two');
    const listed = options.allowCredentials.map((c: { id: string }) => c.id);
    expect(listed).toContain(key.credentialId);
    expect(listed).not.toContain(pk.credentialId);
    expect(res.statusCode).toBe(401);
    expect(errorOf(res)).toBe('webauthn-failed');
    expect(twoFactorCalls).toEqual([]);
  });

  const idsOf = (res: LightMyRequestResponse): string[] => (res.json().options.allowCredentials as Array<{ id: string }>).map((c) => c.id);
  const lengthsOf = (res: LightMyRequestResponse): number[] => idsOf(res).map((id) => Buffer.from(id, 'base64url').length);
  /** A soft authenticator whose credential ID has `bytes` bytes (real authenticators differ: YubiKeys use 64). */
  const withIdLength = (bytes: number): SoftAuthenticator => ({
    ...createSoftAuthenticator({ backedUp: false, userVerified: true }), credentialId: randomBytes(bytes).toString('base64url'),
  });

  it('I2: a known name, an unknown one and a malformed one list exactly MAX_SECURITY_KEYS entries and run the same SQL', async () => {
    const real = await signUp('security-key');
    await insertCredential(real.accountId, withIdLength(64), 'security-key', false);
    await insertCredential(real.accountId, withIdLength(32), 'security-key', false);
    const b = new Browser();
    await b.post('/v1/login/webauthn/start', {}); // the device cookie
    const spy = spySql(deps.db);
    try {
      const run = async (loginName: string) => {
        spy.clear();
        const res = await b.post('/v1/login/webauthn/start', { loginName });
        expect(res.statusCode).toBe(200);
        return { res, sql: spy.sql() };
      };
      const known = await run(real.username);
      const unknown = await run('Ghost.User77');
      const malformed = await run('bad name!');
      // Three real keys plus two decoys, five decoys, five decoys: never a count that only a real account produces.
      for (const r of [known, unknown, malformed]) expect(idsOf(r.res)).toHaveLength(MAX_SECURITY_KEYS);
      expect(idsOf(known.res)).toEqual(expect.arrayContaining([real.auth.credentialId]));
      expect(new Set(idsOf(known.res)).size).toBe(MAX_SECURITY_KEYS);
      // The same statements in the same order (Minor 6: sequence, not count).
      expect(unknown.sql).toEqual(known.sql);
      expect(malformed.sql).toEqual(known.sql);
      expect(known.sql.length).toBeGreaterThan(2);
      // Deterministic per name: a retry lists the same entries (real and decoy alike), another name lists others.
      expect(idsOf((await run(real.username)).res)).toEqual(idsOf(known.res));
      expect(idsOf((await run('Ghost.User77')).res)).toEqual(idsOf(unknown.res));
      expect(idsOf((await run('Ghost.User78')).res)).not.toEqual(idsOf(unknown.res));
    } finally {
      spy.restore();
    }
  });

  it('I2: decoy ID lengths are drawn from the lengths of the security keys actually stored, not a fixed 64', async () => {
    const holder = await signUp('security-key');
    for (let i = 0; i < 3; i++) await insertCredential(holder.accountId, withIdLength(32), 'security-key', false);
    const { rows } = await deps.db.query<{ len: number }>(
      "select distinct length(credential_id)::int as len from webauthn_credentials where kind = 'security-key'",
    );
    const stored = new Set(rows.map((r) => r.len));
    expect(stored.has(32)).toBe(true);
    expect(stored.has(64)).toBe(true);
    const b = new Browser();
    const seen = new Set<number>();
    for (let i = 0; i < 40; i++) {
      for (const len of lengthsOf(await b.post('/v1/login/webauthn/start', { loginName: `Stranger.${i}` }))) {
        expect(stored.has(len)).toBe(true);
        seen.add(len);
      }
    }
    expect(seen.has(32)).toBe(true);
    expect(seen.has(64)).toBe(true);
  });

  it('I2: at most MAX_SECURITY_KEYS security keys per account; the next one is refused at start and at finish', async () => {
    const t = await signUp('security-key');
    for (let i = 0; i < MAX_SECURITY_KEYS - 2; i++) await insertCredential(t.accountId, withIdLength(64), 'security-key', false);
    // The account already has security keys, so even within onboarding another one needs a confirm
    // token (review M1). The fifth key is allowed.
    const confirmToken = await confirmTokenFor(deps, t.b.cookies, { kind: 'add-method', method: 'security-key' });
    const start = await t.b.post('/v1/account/webauthn/start', { kind: 'security-key', confirmToken });
    expect(start.statusCode).toBe(200);
    const { challengeId, options } = start.json();
    // Another key reaches the table before this ceremony finishes: the finish is refused too.
    await insertCredential(t.accountId, withIdLength(64), 'security-key', false);
    const fifth = createSoftAuthenticator({ backedUp: false, userVerified: true }); // owner 16 Nov 2026: a security key verifies its user (PIN)
    const fin = await t.b.post('/v1/account/webauthn/finish', { challengeId, response: fifth.register(options, ORIGIN), label: 'Sixth' });
    expect(fin.statusCode).toBe(409);
    expect(errorOf(fin)).toBe('security-key-limit');
    const again = await t.b.post('/v1/account/webauthn/start', {
      kind: 'security-key', confirmToken: await confirmTokenFor(deps, t.b.cookies, { kind: 'add-method', method: 'security-key' }),
    });
    expect(again.statusCode).toBe(409);
    expect(errorOf(again)).toBe('security-key-limit');
    // Passkeys are not counted.
    expect((await t.b.post('/v1/account/webauthn/start', { kind: 'passkey' })).statusCode).toBe(200);
    const { rows } = await deps.db.query("select count(*)::int as n from webauthn_credentials where account_id = $1 and kind = 'security-key'", [t.accountId]);
    expect(rows[0].n).toBe(MAX_SECURITY_KEYS);
    // Its login options still list exactly MAX_SECURITY_KEYS entries: all real, no decoy.
    const login = await new Browser().post('/v1/login/webauthn/start', { loginName: t.username });
    expect(idsOf(login)).toHaveLength(MAX_SECURITY_KEYS);
    expect(idsOf(login)).toEqual(expect.arrayContaining([t.auth.credentialId]));
  });

  it('M3: with a pendingId, staff, trader, unknown and malformed names run the same SQL', async () => {
    const trader = await signUp('security-key');
    const crewId = await seedAccount(deps, { loginName: uniqueName('crew'), kind: 'staff' });
    await insertCredential(crewId, createSoftAuthenticator({ backedUp: false, userVerified: true }), 'security-key', true);
    const crew = await usernameOf(crewId);
    const b = new Browser();
    await b.post('/v1/login/webauthn/start', {}); // the device cookie
    const pendingId = '0b8f3a52-6f0e-4d3c-9a4e-2b7c1d5e8f90';

    const spy = spySql(deps.db);
    try {
      const run = async (loginName: string) => {
        spy.clear();
        expect((await b.post('/v1/login/webauthn/start', { loginName, pendingId })).statusCode).toBe(200);
        return spy.sql();
      };
      const sequences = [await run(crew), await run(trader.username), await run('Ghost.User77'), await run('bad name!')];
      for (const seq of sequences) expect(seq).toEqual(sequences[0]);
    } finally {
      spy.restore();
    }
  });

  it('M4: an add-key challenge cannot be spent at login', async () => {
    const t = await signUp('passkey');
    const start = (await t.b.post('/v1/account/webauthn/start', { kind: 'security-key' })).json();
    const res = await new Browser().post('/v1/login/webauthn/finish', {
      challengeId: start.challengeId, response: t.auth.authenticate({ ...start.options, rpId: 'x2f.test' }, ORIGIN), deviceLabel: 'D',
    });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res)).toBe('challenge-expired');
  });

  it('M4: an owner passkey is refused before a real confirm token is spent', async () => {
    const ownerId = await seedOwner();
    const b = await loggedIn(ownerId); // not the creating session: no onboarding window
    const { rows: s } = await deps.db.query<{ id: string }>('select id from sessions where account_id = $1', [ownerId]);
    const token = await issueConfirmToken(deps, { sessionId: s[0]!.id, accountId: ownerId, action: { kind: 'add-method', method: 'passkey' }, method: 'passkey' });
    const res = await b.post('/v1/account/webauthn/start', { kind: 'passkey', confirmToken: token });
    expect(res.statusCode).toBe(403);
    expect(errorOf(res)).toBe('method-not-allowed');
    const { rows } = await deps.db.query('select used_at from confirm_tokens where session_id = $1', [s[0]!.id]);
    expect(rows).toEqual([{ used_at: null }]);
  });

  it('M5: stores only known transports', async () => {
    const b = new Browser();
    const username = uniqueName('trans');
    const auth = createSoftAuthenticator({ backedUp: false, userVerified: true });
    const { challengeId, options } = (await b.post('/v1/register/webauthn/start', { ...names(username), kind: 'security-key' })).json();
    const response = auth.register(options, ORIGIN);
    response.response.transports = ['usb', 'bogus', 'nfc', 'x'.repeat(500), 'hybrid'] as never;
    const res = await b.post('/v1/register/webauthn/finish', { challengeId, response, deviceLabel: 'L', acceptedTerms: TERMS, termsSignature: SIG });
    expect(res.statusCode).toBe(201);
    const { rows } = await deps.db.query('select c.transports from webauthn_credentials c where c.account_id = $1', [
      await accountIdByLoginName(deps, username),
    ]);
    expect(rows[0].transports).toEqual(['usb', 'nfc', 'hybrid']);
  });
});

// Owner 25 Nov security-key report: "it should let me name it as well", and a clear reason when
// a key without a PIN is refused at registration.
describe('owner 25 Nov security-key report', () => {
  const put = (b: Browser, payload: unknown) =>
    app.inject({ method: 'PUT', url: '/v1/account/webauthn/label', headers: { origin: ORIGIN }, cookies: b.cookies, payload: payload as Record<string, unknown> });

  it('a registration refused only for missing user verification says needs-pin; any other refusal does not', async () => {
    const b = new Browser();
    const start = (await b.post('/v1/register/webauthn/start', { ...names(uniqueName('nopin')), kind: 'security-key' })).json();
    const noPin = createSoftAuthenticator({ backedUp: false, userVerified: false });
    const reg = await b.post('/v1/register/webauthn/finish', {
      challengeId: start.challengeId, response: noPin.register(start.options, ORIGIN), deviceLabel: 'L', acceptedTerms: TERMS, termsSignature: SIG,
    });
    expect(reg.statusCode).toBe(401);
    expect(reg.json()).toMatchObject({ error: 'webauthn-failed', reason: 'needs-pin' });

    // Another origin, without UV too: the plain refusal (the hint is only for an answer good in every other way).
    const again = (await b.post('/v1/register/webauthn/start', { ...names(uniqueName('nopin')), kind: 'security-key' })).json();
    const other = await b.post('/v1/register/webauthn/finish', {
      challengeId: again.challengeId, response: noPin.register(again.options, 'https://evil.test'), deviceLabel: 'L', acceptedTerms: TERMS, termsSignature: SIG,
    });
    expect(other.statusCode).toBe(401);
    expect(other.json().reason).toBeUndefined();
    // Nothing was made.
    const { rows } = await deps.db.query('select 1 from webauthn_credentials where credential_id = $1', [Buffer.from(noPin.credentialId, 'base64url')]);
    expect(rows).toEqual([]);
  });

  it('a security key is never asked to be a resident key, and the challenge allows PIN plus touch on a phone', () => {
    const o = registrationOptionsFor('security-key', 'trader');
    expect(o.authenticatorSelection).toEqual({ residentKey: 'discouraged', userVerification: 'required', authenticatorAttachment: 'cross-platform' });
    expect(o.supportedAlgorithmIDs).toEqual([-7, -8, -257]);
    expect(o.timeout).toBeGreaterThanOrEqual(120_000);
  });

  it('names my own key: trimmed and stored, shown in my login methods', async () => {
    const t = await signUp('security-key');
    const res = await put(t.b, { credentialId: t.auth.credentialId, label: '  Blue   YubiKey ' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ label: 'Blue YubiKey' });
    const methods = await app.inject({ method: 'GET', url: '/v1/account/methods', headers: { origin: ORIGIN }, cookies: t.b.cookies });
    expect(methods.json().filter((m: { type: string }) => m.type === 'security-key').map((m: { label: string }) => m.label)).toEqual(['Blue YubiKey']);
  });

  it('refuses a name outside 1 to 32 letters, digits, spaces and the allowed punctuation, and changes nothing', async () => {
    const t = await signUp('passkey');
    for (const [label, reason] of [['', 'empty'], ['   ', 'empty'], ['x'.repeat(33), 'too-long'], ['a‮b', 'characters'], ['<b>', 'characters'], ['a\nb', 'characters']] as const) {
      const res = await put(t.b, { credentialId: t.auth.credentialId, label });
      expect(res.statusCode, JSON.stringify(label)).toBe(400);
      expect(res.json()).toMatchObject({ error: 'key-name-invalid', reason });
    }
    for (const bad of [{ credentialId: t.auth.credentialId }, { credentialId: t.auth.credentialId, label: 5 }, { credentialId: 'short', label: 'ok' }, { label: 'ok' }]) {
      expect((await put(t.b, bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
    const { rows } = await deps.db.query('select label from webauthn_credentials where account_id = $1', [t.accountId]);
    expect(rows).toEqual([{ label: 'Passkey 1' }]);
  });

  it("another account's key is not found, and no session is not authenticated", async () => {
    const mine = await signUp('security-key');
    const theirs = await signUp('security-key');
    const res = await put(mine.b, { credentialId: theirs.auth.credentialId, label: 'Mine now' });
    expect(res.statusCode).toBe(404);
    expect(errorOf(res)).toBe('not-found');
    expect((await put(new Browser(), { credentialId: mine.auth.credentialId, label: 'X' })).statusCode).toBe(401);
    const { rows } = await deps.db.query('select label from webauthn_credentials where account_id = $1', [theirs.accountId]);
    expect(rows).toEqual([{ label: 'Security key 1' }]);
  });
});

// Security review of wip/lead-seckey-fix.
describe('security review of wip/lead-seckey-fix', () => {
  it('needs-pin also on add-key (a signed-in trader) and on the staff and owner path', async () => {
    const t = await signUp('passkey');
    const start = (await t.b.post('/v1/account/webauthn/start', { kind: 'security-key' })).json();
    const noPin = createSoftAuthenticator({ backedUp: false, userVerified: false });
    const fin = await t.b.post('/v1/account/webauthn/finish', { challengeId: start.challengeId, response: noPin.register(start.options, ORIGIN) });
    expect(fin.statusCode).toBe(401);
    expect(fin.json()).toMatchObject({ error: 'webauthn-failed', reason: 'needs-pin' });

    // Staff and owner: an attested key from the allowlist, without its PIN.
    for (const id of [await seedAccount(deps, { loginName: uniqueName('pinstaff'), kind: 'staff' }), await seedOwner()]) {
      const challenge = randomBytes(32);
      const options = await webauthnRegistrationOptions(deps, id, { challenge });
      const key = createSoftAuthenticator({ backedUp: false, userVerified: false, attestation: { aaguid: ALLOWED, ca } });
      await expect(verifyWebAuthnRegistration(deps, id, key.register(options, ORIGIN), challenge, { kind: 'security-key' })).rejects.toMatchObject({
        status: 401, code: 'webauthn-failed', extra: { reason: 'needs-pin' },
      });
      // A key outside the snapshot without its PIN is refused, never with the PIN hint (it would not be taken with one either).
      const unknown = createSoftAuthenticator({ backedUp: false, userVerified: false, attestation: { aaguid: NO_STATEMENT, ca } });
      const e = await verifyWebAuthnRegistration(deps, id, unknown.register(options, ORIGIN), challenge, { kind: 'security-key' }).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).extra?.reason).toBeUndefined();
      expect((await deps.db.query('select 1 from webauthn_credentials where account_id = $1', [id])).rows).toEqual([]);
    }
  });

  it('one name rule at creation: an invalid or taken name falls back to the first free "Security key N"; the registration still succeeds', async () => {
    const b = new Browser();
    const start = (await b.post('/v1/register/webauthn/start', { ...names(uniqueName('lbl')), kind: 'security-key' })).json();
    const key = createSoftAuthenticator({ backedUp: false, userVerified: true });
    const reg = await b.post('/v1/register/webauthn/finish', {
      challengeId: start.challengeId, response: key.register(start.options, ORIGIN), deviceLabel: 'L', acceptedTerms: TERMS, label: 'YоbiKey‮',
    });
    expect(reg.statusCode).toBe(201);
    const accountId = (await deps.db.query('select account_id from webauthn_credentials where credential_id = $1', [Buffer.from(key.credentialId, 'base64url')])).rows[0]!.account_id as string;
    const labels = async () => (await deps.db.query('select label from webauthn_credentials where account_id = $1 order by label', [accountId])).rows.map((r) => r.label);
    expect(await labels()).toEqual(['Security key 1']);
    const add = async (label: string) => {
      const confirmToken = await confirmTokenFor(deps, b.cookies, { kind: 'add-method', method: 'security-key' });
      const s = (await b.post('/v1/account/webauthn/start', { kind: 'security-key', confirmToken })).json();
      const k = createSoftAuthenticator({ backedUp: false, userVerified: true });
      expect((await b.post('/v1/account/webauthn/finish', { challengeId: s.challengeId, response: k.register(s.options, ORIGIN), label })).statusCode).toBe(201);
    };
    await add('  SECURITY key 1 ');
    await add('x'.repeat(40));
    await add(' Spare  ');
    expect(await labels()).toEqual(['Security key 1', 'Security key 2', 'Security key 3', 'Spare']);
  });
});
