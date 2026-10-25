/**
 * End-to-end flows of the browser auth client against a real API (Plan 2 Task 14). The flows that
 * need Tasks 11 and 12 (me(), wallets, the Terms route) are in flows-t11-t12.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { codeOf, decrypt, genKey, type Pair } from '../../../apps/api/test/helpers/pgpKeys.js';
import { createSoftAuthenticator, type SoftAuthenticator } from '../../../apps/api/test/helpers/softAuthenticator.js';
import {
  AuthApiError,
  addWebAuthnKey,
  confirmWithWebAuthn,
  createAuthApi,
  loginWithPasskey,
  loginWithSecurityKey,
  registerWithWebAuthn,
  withConfirm,
  type AuthApi,
} from '../src/index.js';
import { ROUTES, callSample, methodNames } from './helpers/routes.js';
import { Jar, ceremonyOf, failure, startServer, uniqueName, type Server } from './helpers/server.js';
import { staffWithKeyAndPgp } from './helpers/staff.js';

const GOOD = 'Correct-Horse-9';
const WRONG = 'Wrong-Horse-99';
const LABEL = 'Browser on Linux';

/**
 * API routes the auth client deliberately does not cover: Plan 3's web-app routes, called by
 * apps/web's own client. Exact "METHOD /path" strings, kept sorted; each Plan 3 task adds its own
 * (Task 6: the trade view and the events route; Task 26: nudges, nudge settings and blocks). Any
 * other new route still needs a client method.
 */
const NOT_AUTH_CLIENT = [
  'GET /v1/account/nudges',
  'GET /v1/trades/:code',
  'POST /v1/account/blocks',
  'POST /v1/nudges',
  'POST /v1/trades/:code/events',
  'PUT /v1/account/nudges',
] as const;

let srv: Server;

beforeAll(async () => {
  srv = await startServer();
});

afterAll(async () => {
  await srv.close();
});

/** The Terms version the person accepted. `GET /v1/terms` comes with Task 11 (see flows-t11-t12). */
const terms = () => srv.deps.config.termsVersion;
const jar = (keepCookies = true) => new Jar(srv.baseUrl, keepCookies);

function apiError(e: unknown): AuthApiError {
  expect(e).toBeInstanceOf(AuthApiError);
  return e as AuthApiError;
}

/** Decrypts a challenge as the person's PGP app would, requiring X2F's signature. */
async function codeFrom(encryptedMessage: string, key: Pair): Promise<string> {
  return codeOf(await decrypt(encryptedMessage, key.privateKey, srv.deps.pgpSigner.publicArmored, srv.now()));
}

async function registerPgp(j: Jar): Promise<{ username: string; key: Pair }> {
  const key = await genKey();
  const username = uniqueName('pgp');
  const start = await j.api.registerPgpStart({ username, publicKey: key.publicKey });
  expect(start.fingerprint).toBe(key.fingerprint);
  const done = await j.api.registerPgpFinish({
    challengeId: start.challengeId, code: await codeFrom(start.encryptedMessage, key), deviceLabel: LABEL, acceptedTerms: terms(),
  });
  expect(done).toEqual({ username });
  return { username, key };
}

async function loginPgp(api: AuthApi, username: string, key: Pair) {
  const start = await api.loginPgpStart({ username });
  return api.loginPgpFinish({ challengeId: start.challengeId, code: await codeFrom(start.encryptedMessage, key), deviceLabel: LABEL });
}

/** A PGP sign-up that adds a passkey during onboarding (no confirm prompt). */
async function pgpUserWithPasskey(): Promise<{ username: string; key: Pair; soft: SoftAuthenticator; own: Jar }> {
  const own = jar();
  const { username, key } = await registerPgp(own);
  const soft = createSoftAuthenticator({ backedUp: true, userVerified: true });
  await addWebAuthnKey(own.api, 'passkey', { label: 'Phone' }, ceremonyOf(soft));
  return { username, key, soft, own };
}

describe('the client covers the API', () => {
  it('has exactly the methods the route table lists', () => {
    expect(Object.keys(createAuthApi()).sort()).toEqual(methodNames().sort());
  });

  it('every method reaches exactly its own route, by its own HTTP method', async () => {
    for (const name of methodNames()) {
      const before = srv.routes.length;
      await callSample(jar().api, name);
      expect(srv.routes.slice(before), name).toEqual([ROUTES[name]]);
    }
  });

  it('every route of the API (but /healthz and the Plan 3 app routes) has its client method', () => {
    // Two methods may share a route (addWallet and addWallets both POST /v1/wallets).
    const expected = new Set(methodNames().map((n) => ROUTES[n]));
    const notAuth = new Set<string>(NOT_AUTH_CLIENT);
    expect(srv.serverRoutes().filter((r) => r !== 'GET /healthz' && !notAuth.has(r))).toEqual([...expected].sort());
  });

  it('lists only Plan 3 routes that exist, sorted, once each', () => {
    const routes = srv.serverRoutes();
    for (const r of NOT_AUTH_CLIENT) expect(routes, r).toContain(r);
    expect([...NOT_AUTH_CLIENT]).toEqual([...new Set(NOT_AUTH_CLIENT)].sort());
  });

  it('serves the official PGP signing key that signs every challenge', async () => {
    const k = await jar().api.getPgpSigningKey();
    expect(k).toEqual({ fingerprint: srv.deps.pgpSigner.fingerprint, publicKey: srv.deps.pgpSigner.publicArmored });
  });
});

describe('onboarding', () => {
  it('PGP sign-up, then a passkey as backup without a confirm prompt; both log in', async () => {
    const { username, key, soft } = await pgpUserWithPasskey();
    await expect(loginWithPasskey(jar().api, LABEL, ceremonyOf(soft))).resolves.toEqual({ status: 'ok' });
    await expect(loginPgp(jar().api, username, key)).resolves.toEqual({ status: 'ok' });
  });

  it('passkey sign-up through the ceremony wrapper', async () => {
    const soft = createSoftAuthenticator({ backedUp: true, userVerified: true });
    const username = uniqueName('key');
    await expect(registerWithWebAuthn(jar().api, username, 'passkey', LABEL, terms(), ceremonyOf(soft))).resolves.toEqual({ username });
    await expect(loginWithPasskey(jar().api, LABEL, ceremonyOf(soft))).resolves.toEqual({ status: 'ok' });
  });

  it('password sign-up: a leaked or weak password is refused with its reason, then a good one works', async () => {
    const own = jar();
    const username = uniqueName('pass');
    const leaked = apiError(await failure(own.api.registerPassword({ username, password: 'Password123!', deviceLabel: LABEL, acceptedTerms: terms() })));
    expect(leaked.status).toBe(400);
    expect(leaked.code).toBe('password-leaked');
    const weak = apiError(await failure(own.api.registerPassword({ username, password: 'short', deviceLabel: LABEL, acceptedTerms: terms() })));
    expect(weak.code).toBe('password-weak');
    expect(weak.missing).toEqual(expect.arrayContaining(['length']));
    const stale = apiError(await failure(own.api.registerPassword({ username, password: GOOD, deviceLabel: LABEL, acceptedTerms: 'old' })));
    expect(stale.code).toBe('terms-not-accepted');

    await expect(own.api.registerPassword({ username, password: GOOD, deviceLabel: LABEL, acceptedTerms: terms() })).resolves.toEqual({ username });
    await own.api.logout();
    expect(apiError(await failure(own.api.newRecoveryCodes({}))).code).toBe('not-authenticated');
    await expect(own.api.loginPassword({ username, password: GOOD, deviceLabel: LABEL })).resolves.toEqual({ status: 'ok' });
  });
});

describe('confirm it\'s you (P2-C2)', () => {
  it('a change 10 seconds after a fresh login goes through withConfirm: one proof, and the token is single-use', async () => {
    const { soft } = await pgpUserWithPasskey();
    const fresh = jar();
    await loginWithPasskey(fresh.api, LABEL, ceremonyOf(soft));
    srv.advance(10_000);

    let token: string | undefined;
    const prove = vi.fn(async (a: Parameters<typeof confirmWithWebAuthn>[1]) => (token = await confirmWithWebAuthn(fresh.api, a, ceremonyOf(soft))));
    const run = vi.fn((t?: string) => fresh.api.newRecoveryCodes({ confirmToken: t }));
    const result = await withConfirm({ kind: 'new-recovery-codes' }, run, prove);
    expect(result.codes).toHaveLength(10);
    expect(prove).toHaveBeenCalledTimes(1);
    expect(prove).toHaveBeenCalledWith({ kind: 'new-recovery-codes' });
    expect(run).toHaveBeenCalledTimes(2);

    const reused = apiError(await failure(fresh.api.newRecoveryCodes({ confirmToken: token })));
    expect(reused.status).toBe(403);
    expect(reused.code).toBe('confirm-invalid');
  });

  it('without a token the API asks for one, naming the action', async () => {
    const { soft } = await pgpUserWithPasskey();
    const fresh = jar();
    await loginWithPasskey(fresh.api, LABEL, ceremonyOf(soft));
    const e = apiError(await failure(fresh.api.newRecoveryCodes({})));
    expect(e.code).toBe('confirm-required');
    expect(e.action).toBe('new-recovery-codes');
  });

  it('PGP proof: the challenge names the action and the code buys a token for it alone', async () => {
    const { username, key } = await pgpUserWithPasskey();
    const fresh = jar();
    await loginPgp(fresh.api, username, key);
    const prove = vi.fn(async (action: Parameters<AuthApi['confirmPgpStart']>[0]['action']) => {
      const start = await fresh.api.confirmPgpStart({ action });
      const text = await decrypt(start.encryptedMessage, key.privateKey, srv.deps.pgpSigner.publicArmored, srv.now());
      expect(text).toContain('make new recovery codes');
      return (await fresh.api.confirmPgpFinish({ challengeId: start.challengeId, code: codeOf(text) })).confirmToken;
    });
    const result = await withConfirm({ kind: 'new-recovery-codes' }, (t) => fresh.api.newRecoveryCodes({ confirmToken: t }), prove);
    expect(result.codes).toHaveLength(10);
    expect(prove).toHaveBeenCalledTimes(1);
  });
});

describe('a flood of bad passwords (Review Focus 2, P2-C1)', () => {
  it('never locks out the user\'s own browser, a passkey, PGP, or a confirm', async () => {
    // A password account (this browser becomes trusted) that adds a passkey and a PGP key during onboarding.
    const own = jar();
    const username = uniqueName('flood');
    await own.api.registerPassword({ username, password: GOOD, deviceLabel: LABEL, acceptedTerms: terms() });
    const soft = createSoftAuthenticator({ backedUp: true, userVerified: true });
    await addWebAuthnKey(own.api, 'passkey', {}, ceremonyOf(soft));
    const key = await genKey();
    const add = await own.api.addPgpKeyStart({ publicKey: key.publicKey });
    await expect(own.api.addPgpKeyFinish({ challengeId: add.challengeId, code: await codeFrom(add.encryptedMessage, key) })).resolves.toEqual({
      fingerprint: key.fingerprint,
    });

    // A stranger with no device cookie: 12 wrong passwords that the server actually checks,
    // waiting out each slow-down it is told about.
    const stranger = jar(false);
    let checked = 0;
    while (checked < 12) {
      const e = apiError(await failure(stranger.api.loginPassword({ username, password: WRONG, deviceLabel: LABEL })));
      if (e.code === 'credentials-invalid') {
        checked++;
        continue;
      }
      expect(e.status).toBe(429);
      expect(['slow-down', 'locked']).toContain(e.code);
      expect(e.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      expect(e.retryAfterSeconds).toBeLessThanOrEqual(30);
      srv.advance(e.retryAfterSeconds! * 1000);
    }
    expect(stranger.cookies.size).toBe(0);
    // The stranger is now locked out (even with the right password), for at most 30 seconds.
    const locked = apiError(await failure(stranger.api.loginPassword({ username, password: GOOD, deviceLabel: LABEL })));
    expect(locked.status).toBe(429);
    expect(locked.code).toBe('locked');
    expect(locked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(locked.retryAfterSeconds).toBeLessThanOrEqual(30);

    // At once, with no time passing: the user's own browser (trusted device cookie) logs in with the password,
    await expect(own.api.loginPassword({ username, password: GOOD, deviceLabel: LABEL })).resolves.toEqual({ status: 'ok' });
    // a fresh browser logs in with the passkey (discoverable) and with PGP,
    await expect(loginWithPasskey(jar().api, LABEL, ceremonyOf(soft))).resolves.toEqual({ status: 'ok' });
    await expect(loginPgp(jar().api, username, key)).resolves.toEqual({ status: 'ok' });
    // and the live session gets a confirm token by passkey and uses it.
    const token = await confirmWithWebAuthn(own.api, { kind: 'new-recovery-codes' }, ceremonyOf(soft));
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(own.api.newRecoveryCodes({ confirmToken: token })).resolves.toMatchObject({ codes: expect.any(Array) });
    // So does a confirm by password from the trusted browser, still with no time passing.
    const byPassword = await own.api.confirmPassword({ password: GOOD, action: { kind: 'new-recovery-codes' } });
    expect(byPassword.confirmToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(own.api.newRecoveryCodes({ confirmToken: byPassword.confirmToken })).resolves.toMatchObject({ codes: expect.any(Array) });

    // The flood is still in force for the stranger.
    expect(apiError(await failure(stranger.api.loginPassword({ username, password: GOOD, deviceLabel: LABEL }))).code).toBe('locked');
  });
});

describe('a flood of bad passwords against a staff username (Review Focus 2)', () => {
  it('security key then PGP: second-factor, then a session, at once after 12 anonymous wrong passwords', async () => {
    const { username, soft, key } = await staffWithKeyAndPgp(srv);
    const stranger = jar(false);
    let tries = 0;
    while (tries < 12) {
      const e = apiError(await failure(stranger.api.loginPassword({ username, password: WRONG, deviceLabel: LABEL })));
      if (e.status === 429) {
        expect(e.retryAfterSeconds).toBeLessThanOrEqual(30);
        srv.advance(e.retryAfterSeconds! * 1000);
        continue;
      }
      expect(e.code).toBe('credentials-invalid');
      tries++;
    }
    expect(apiError(await failure(stranger.api.loginPassword({ username, password: WRONG, deviceLabel: LABEL }))).code).toBe('locked');

    const browser: AuthApi = jar().api;
    const first = await loginWithSecurityKey(browser, username, LABEL, ceremonyOf(soft));
    expect(first).toMatchObject({ status: 'second-factor', needs: ['pgp'] });
    if (first.status !== 'second-factor') throw new Error('expected a second factor');
    const start = await browser.loginPgpStart({ username, pendingId: first.pendingId });
    await expect(
      browser.loginPgpFinish({ challengeId: start.challengeId, code: await codeFrom(start.encryptedMessage, key), deviceLabel: LABEL, pendingId: first.pendingId }),
    ).resolves.toEqual({ status: 'ok' });
    // me() (Task 11) is checked in flows-t11-t12; the session's login methods are this staff account's.
    await expect(browser.listMethods()).resolves.toEqual([
      expect.objectContaining({ type: 'pgp' }),
      expect.objectContaining({ type: 'security-key', label: 'YubiKey' }),
    ]);
  });
});
