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
  walletsAction,
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
  const start = await j.api.registerPgpStart({ displayName: `D${username}`, loginName: username, publicKey: key.publicKey });
  await j.api.registerPgpFinish({
    challengeId: start.challengeId, code: await codeFrom(start.encryptedMessage, key), deviceLabel: LABEL, acceptedTerms: version,
  });
  return { username, key };
}

// Which route each method reaches is checked in flows.test.ts.
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
    await own.api.registerPassword({ displayName: `D${username}`, loginName: username, password: GOOD, deviceLabel: LABEL, acceptedTerms: version });
    const me = await own.api.me();
    expect(me.methods).toEqual(['password']);
    expect(me.suggestions).toEqual(['add-authenticator', 'add-backup']);
    expect(me.logoutTimer).toEqual({ idleHours: 12, adjustable: true });
    await expect(own.api.setLogoutTimer({ idleHours: 4 })).resolves.toEqual({ idleHours: 4, adjustable: true });
    await expect(own.api.getLogoutTimer()).resolves.toEqual({ idleHours: 4, adjustable: true });
    expect((await own.api.me()).logoutTimer).toEqual({ idleHours: 4, adjustable: true });
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
    // Confirmed with a passkey: usable at once (owner, 2026-10-23).
    expect(wallet).toMatchObject({ address, label: 'Second', usable: true });

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

describe('several wallets under one confirm, and the rule (owner, 2026-10-24)', () => {
  const drafts = (list: string[]) => list.map((address, i) => ({ app: 'cake' as const, label: `W${i + 1}`, address }));

  it('password: the first batch works at once without a prompt; a later batch is proved once and waits on one clock', async () => {
    const own = jar();
    const { version } = await own.api.getTerms();
    const login = uniqueName('bat');
    await own.api.registerPassword({ displayName: `D${login}`, loginName: login, password: GOOD, deviceLabel: LABEL, acceptedTerms: version });
    await expect(own.api.getWalletRule()).resolves.toEqual({ firstWallet: true, strongMethods: [], password: 'immediate', waitHours: 24 });

    const first = await own.api.addWallets({ wallets: drafts([fakeAddress(), fakeAddress()]) });
    expect(first.map((w) => w.usable)).toEqual([true, true]);
    await expect(own.api.getWalletRule()).resolves.toEqual({ firstWallet: false, strongMethods: [], password: 'waits', waitHours: 24 });

    const list = [fakeAddress(), fakeAddress(), fakeAddress()];
    const action = await walletsAction(list);
    const prove = vi.fn(async (a: Parameters<typeof own.api.confirmPassword>[0]['action']) => {
      expect(a).toEqual(action);
      return (await own.api.confirmPassword({ password: GOOD, action: a })).confirmToken;
    });
    const added = await withConfirm(action, (t) => own.api.addWallets({ wallets: drafts(list), confirmToken: t }), prove);
    expect(prove).toHaveBeenCalledTimes(1);
    expect(added.map((w) => w.address)).toEqual(list);
    expect(added.every((w) => !w.usable)).toBe(true);
    expect(new Set(added.map((w) => w.usableFrom))).toEqual(new Set([new Date(srv.now().getTime() + 24 * 3_600_000).toISOString()]));

    // The first batch stays usable while the later one waits.
    const listed = await own.api.listWallets();
    expect(listed.filter((w) => w.usable).map((w) => w.id).sort()).toEqual(first.map((w) => w.id).sort());
    expect(listed).toHaveLength(5);
  });

  it('a token for list A does not add list B, nor A in another order, and stays usable for A', async () => {
    const own = jar();
    const { version } = await own.api.getTerms();
    const login = uniqueName('bat');
    await own.api.registerPassword({ displayName: `D${login}`, loginName: login, password: GOOD, deviceLabel: LABEL, acceptedTerms: version });
    await own.api.addWallet({ app: 'cake', label: 'First', address: fakeAddress() });
    const a = [fakeAddress(), fakeAddress()];
    const b = [fakeAddress(), fakeAddress()];
    const { confirmToken } = await own.api.confirmPassword({ password: GOOD, action: await walletsAction(a) });
    for (const other of [b, [a[1]!, a[0]!]]) {
      const e = apiError(await failure(own.api.addWallets({ wallets: drafts(other), confirmToken })));
      expect(e.status).toBe(403);
      expect(e.code).toBe('confirm-invalid');
    }
    await expect(own.api.addWallets({ wallets: drafts(a), confirmToken })).resolves.toHaveLength(2);
    await expect(own.api.listWallets()).resolves.toHaveLength(3);
  });

  it('PGP and a passkey, no password: the rule says so, and a later batch proved with the passkey works at once', async () => {
    const own = jar();
    await registerPgp(own);
    const soft = createSoftAuthenticator({ backedUp: true, userVerified: true });
    await addWebAuthnKey(own.api, 'passkey', {}, ceremonyOf(soft));
    await expect(own.api.getWalletRule()).resolves.toEqual({ firstWallet: true, strongMethods: ['pgp', 'passkey'], password: 'none', waitHours: 24 });
    await own.api.addWallet({ app: 'cake', label: 'First', address: fakeAddress() });

    const fresh = jar();
    await loginWithPasskey(fresh.api, LABEL, ceremonyOf(soft));
    await expect(fresh.api.getWalletRule()).resolves.toEqual({ firstWallet: false, strongMethods: ['pgp', 'passkey'], password: 'none', waitHours: 24 });
    const list = [fakeAddress(), fakeAddress()];
    const added = await withConfirm(
      await walletsAction(list),
      (t) => fresh.api.addWallets({ wallets: drafts(list), confirmToken: t }),
      (a) => confirmWithWebAuthn(fresh.api, a, ceremonyOf(soft)),
    );
    expect(added.map((w) => w.usable)).toEqual([true, true]);
  });

  it('refuses a batch with one bad address whole: nothing is added', async () => {
    const own = jar();
    const { version } = await own.api.getTerms();
    const login = uniqueName('bat');
    await own.api.registerPassword({ displayName: `D${login}`, loginName: login, password: GOOD, deviceLabel: LABEL, acceptedTerms: version });
    const e = apiError(await failure(own.api.addWallets({ wallets: drafts([fakeAddress(), 'not-an-address']) })));
    expect(e.status).toBe(400);
    expect(e.code).toBe('address-invalid');
    await expect(own.api.listWallets()).resolves.toEqual([]);
  });
});

describe('after a staff two-factor login (Task 10 flow in flows.test.ts)', () => {
  it('me() shows the staff account', async () => {
    const { username, soft, key } = await staffWithKeyAndPgp(srv);
    const browser: AuthApi = jar().api;
    const first = await loginWithSecurityKey(browser, username, LABEL, ceremonyOf(soft));
    if (first.status !== 'second-factor') throw new Error('expected a second factor');
    const start = await browser.loginPgpStart({ key: key.publicKey, pendingId: first.pendingId });
    await browser.loginPgpFinish({ challengeId: start.challengeId, code: await codeFrom(start.encryptedMessage, key), deviceLabel: LABEL, pendingId: first.pendingId });
    await expect(browser.me()).resolves.toMatchObject({
      displayName: `D${username}`, needsLoginName: false, kind: 'staff', logoutTimer: { idleHours: 2, adjustable: false },
    });
  });
});

describe('new-device approval (Plan 2 Task 16)', () => {
  async function passwordUser(): Promise<{ own: Jar; username: string }> {
    const own = jar();
    const { version } = await own.api.getTerms();
    const username = uniqueName('appr');
    await own.api.registerPassword({ displayName: `D${username}`, loginName: username, password: GOOD, deviceLabel: LABEL, acceptedTerms: version });
    return { own, username };
  }

  it('a new browser waits; the logged-in one taps the number; the poll lets it in', async () => {
    const { own, username } = await passwordUser();
    const other = jar();
    const wait = await other.api.loginPassword({ loginName: username, password: GOOD, deviceLabel: 'Browser on Android' });
    if (wait.status !== 'approve-on-device') throw new Error(`expected a wait, got ${wait.status}`);
    await expect(other.api.pollLoginApproval(wait.approvalId)).resolves.toEqual({ status: 'waiting', expiresAt: wait.expiresAt });
    const [view] = await own.api.listApprovals();
    expect(view).toMatchObject({ id: wait.approvalId, deviceLabel: 'Browser on Android', atLimit: false, oneDevice: false });
    await expect(own.api.getApproval(wait.approvalId)).resolves.toEqual(view);
    expect(view!.choices).toContain(wait.number);
    await expect(own.api.decideApproval(wait.approvalId, { choice: wait.number })).resolves.toEqual({ outcome: 'approved' });
    await expect(other.api.pollLoginApproval(wait.approvalId)).resolves.toEqual({ status: 'ok', loggedOut: [] });
    expect((await other.api.me()).level).toBe('full');
    const ended = apiError(await failure(own.api.decideApproval(wait.approvalId, { block: true })));
    expect(ended.code).toBe('approval-ended');
    expect(ended.outcome).toBe('approved');
  });

  it('a block ends it; cancel ends it too; the device settings read back', async () => {
    const { own, username } = await passwordUser();
    const b = jar();
    const w1 = await b.api.loginPassword({ loginName: username, password: GOOD, deviceLabel: LABEL });
    if (w1.status !== 'approve-on-device') throw new Error('expected a wait');
    await expect(own.api.decideApproval(w1.approvalId, { block: true })).resolves.toEqual({ outcome: 'blocked' });
    await expect(b.api.pollLoginApproval(w1.approvalId)).resolves.toEqual({ status: 'blocked' });
    const w2 = await b.api.loginPassword({ loginName: username, password: GOOD, deviceLabel: LABEL });
    if (w2.status !== 'approve-on-device') throw new Error('expected a wait');
    await b.api.cancelLoginApproval(w2.approvalId);
    await expect(own.api.listApprovals()).resolves.toEqual([]);
    await expect(own.api.getDeviceSettings()).resolves.toEqual({ oneDevice: false, maxDevices: 3 });
    const refused = apiError(await failure(own.api.setOneDevice({ on: true })));
    expect(refused.code).toBe('confirm-required');
    expect(refused.action).toBe('set-one-device');
  });
});
