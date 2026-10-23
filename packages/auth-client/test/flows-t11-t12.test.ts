/**
 * End-to-end flows that need Plan 2 Tasks 11 and 12: `me()` and `GET /v1/terms` (Task 11) and
 * wallets (Task 12). Excluded in vitest.config.ts until those tasks are on the same line as this
 * one; it type-checks always. The Task 10 flows (the staff two-factor login) are in flows.test.ts.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AddressValidator } from '../../../apps/api/src/app.js';
import { codeOf, decrypt, genKey, type Pair } from '../../../apps/api/test/helpers/pgpKeys.js';
import { createSoftAuthenticator } from '../../../apps/api/test/helpers/softAuthenticator.js';
import {
  AuthApiError,
  addWebAuthnKey,
  confirmWithWebAuthn,
  loginWithPasskey,
  loginWithSecurityKey,
  walletAction,
  withConfirm,
  type AuthApi,
} from '../src/index.js';
import { Jar, ceremonyOf, failure, startServer, uniqueName, type Server } from './helpers/server.js';
import { staffWithKeyAndPgp } from './helpers/staff.js';

const GOOD = 'Correct-Horse-9';
const LABEL = 'Browser on Linux';
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** A 95-character base58 string: what the stand-in validator below takes for a standard address. */
function fakeAddress(): string {
  return `4${Array.from(randomBytes(94), (b) => BASE58[b % BASE58.length]).join('')}`;
}

// The real validator (Task 12) needs monero-ts; these flows need only "valid" and "not valid".
const addresses = {
  check: (a: string) => (/^[1-9A-HJ-NP-Za-km-z]{95}$/.test(a) ? 'ok' : 'invalid'),
} as unknown as AddressValidator;

let srv: Server;

beforeAll(async () => {
  srv = await startServer({ addresses });
});

afterAll(async () => {
  await srv.close();
});

const jar = (keepCookies = true) => new Jar(srv.baseUrl, keepCookies);

function apiError(e: unknown): AuthApiError {
  expect(e).toBeInstanceOf(AuthApiError);
  return e as AuthApiError;
}

async function codeFrom(encryptedMessage: string, key: Pair): Promise<string> {
  return codeOf(await decrypt(encryptedMessage, key.privateKey, srv.deps.pgpSigner.publicArmored, srv.now()));
}

/** Every sign-up sends the Terms version from `GET /v1/terms` (R10). */
async function registerPgp(j: Jar): Promise<{ username: string; key: Pair }> {
  const { version } = await j.api.getTerms();
  const key = await genKey();
  const username = uniqueName('pgp');
  const start = await j.api.registerPgpStart({ username, publicKey: key.publicKey });
  await j.api.registerPgpFinish({
    challengeId: start.challengeId, code: await codeFrom(start.encryptedMessage, key), deviceLabel: LABEL, acceptedTerms: version,
  });
  return { username, key };
}

// Which route each method reaches is checked in flows.test.ts once NEEDS_TASKS_11_12 is gone.
describe('the client covers the API (Tasks 11 and 12 routes)', () => {
  it('GET /v1/terms is the version sign-up needs', async () => {
    await expect(jar().api.getTerms()).resolves.toEqual({ version: srv.deps.config.termsVersion });
  });
});

describe('onboarding', () => {
  it('PGP: a passkey as backup and the first wallet without a prompt; me() shows both methods and no suggestions', async () => {
    const own = jar();
    await registerPgp(own);
    const soft = createSoftAuthenticator({ backedUp: true, userVerified: true });
    await addWebAuthnKey(own.api, 'passkey', { label: 'Phone' }, ceremonyOf(soft));
    const address = fakeAddress();
    const wallet = await own.api.addWallet({ app: 'cake', label: 'Cake', address });
    expect(wallet).toMatchObject({ app: 'cake', label: 'Cake', address, addressEnd: address.slice(-6), usable: true });

    const me = await own.api.me();
    expect(me.methods).toEqual(['pgp', 'passkey']);
    expect(me.hasBackup).toBe(true);
    expect(me.suggestions).toEqual([]);
    expect(me.termsCurrent).toBe(true);
    await expect(own.api.listWallets()).resolves.toHaveLength(1);
  });

  it('password: me() suggests an authenticator app and a backup', async () => {
    const own = jar();
    const { version } = await own.api.getTerms();
    const username = uniqueName('pass');
    await own.api.registerPassword({ username, password: GOOD, deviceLabel: LABEL, acceptedTerms: version });
    const me = await own.api.me();
    expect(me.methods).toEqual(['password']);
    expect(me.suggestions).toEqual(['add-authenticator', 'add-backup']);
  });

  it('a PGP account that adds a password still has no backup (R11)', async () => {
    const own = jar();
    await registerPgp(own);
    await own.api.setPassword({ password: GOOD });
    const me = await own.api.me();
    expect(me.methods).toEqual(['pgp', 'password']);
    expect(me.hasBackup).toBe(false);
    expect(me.suggestions).toContain('add-backup');
  });
});

describe('every later wallet goes through withConfirm (P2-C2)', () => {
  it('10 seconds after a fresh login: one proof, then the token cannot add another address', async () => {
    const own = jar();
    await registerPgp(own);
    const soft = createSoftAuthenticator({ backedUp: true, userVerified: true });
    await addWebAuthnKey(own.api, 'passkey', {}, ceremonyOf(soft));
    await own.api.addWallet({ app: 'cake', label: 'First', address: fakeAddress() });

    const fresh = jar();
    await loginWithPasskey(fresh.api, LABEL, ceremonyOf(soft));
    srv.advance(10_000);

    const address = fakeAddress();
    let token: string | undefined;
    const prove = vi.fn(async (a: Parameters<typeof confirmWithWebAuthn>[1]) => (token = await confirmWithWebAuthn(fresh.api, a, ceremonyOf(soft))));
    const wallet = await withConfirm(
      await walletAction(address),
      (t) => fresh.api.addWallet({ app: 'feather', label: 'Second', address, confirmToken: t }),
      prove,
    );
    expect(prove).toHaveBeenCalledTimes(1);
    expect(wallet).toMatchObject({ address, label: 'Second' });

    const reused = apiError(await failure(fresh.api.addWallet({ app: 'feather', label: 'Third', address: fakeAddress(), confirmToken: token })));
    expect(reused.status).toBe(403);
    expect(reused.code).toBe('confirm-invalid');
    await expect(fresh.api.listWallets()).resolves.toHaveLength(2);
  });

  it('a token for one address does not add another', async () => {
    const own = jar();
    await registerPgp(own);
    const soft = createSoftAuthenticator({ backedUp: true, userVerified: true });
    await addWebAuthnKey(own.api, 'passkey', {}, ceremonyOf(soft));
    await own.api.addWallet({ app: 'cake', label: 'First', address: fakeAddress() });
    const fresh = jar();
    await loginWithPasskey(fresh.api, LABEL, ceremonyOf(soft));
    const token = await confirmWithWebAuthn(fresh.api, await walletAction(fakeAddress()), ceremonyOf(soft));
    const e = apiError(await failure(fresh.api.addWallet({ app: 'cake', label: 'Other', address: fakeAddress(), confirmToken: token })));
    expect(e.code).toBe('confirm-invalid');
  });
});

describe('after a staff two-factor login (Task 10 flow in flows.test.ts)', () => {
  it('me() shows the staff account', async () => {
    const { username, soft, key } = await staffWithKeyAndPgp(srv);
    const browser: AuthApi = jar().api;
    const first = await loginWithSecurityKey(browser, username, LABEL, ceremonyOf(soft));
    if (first.status !== 'second-factor') throw new Error('expected a second factor');
    const start = await browser.loginPgpStart({ username, pendingId: first.pendingId });
    await browser.loginPgpFinish({ challengeId: start.challengeId, code: await codeFrom(start.encryptedMessage, key), deviceLabel: LABEL, pendingId: first.pendingId });
    await expect(browser.me()).resolves.toMatchObject({ username, kind: 'staff' });
  });
});
