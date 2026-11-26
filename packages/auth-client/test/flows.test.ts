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
import { Jar, approved, ceremonyOf, failure, startServer, uniqueName, type Server } from './helpers/server.js';
import { staffWithKeyAndPgp } from './helpers/staff.js';

const LABEL = 'Browser on Linux';

/**
 * API routes the auth client deliberately does not cover: Plan 3's web-app routes, called by
 * apps/web's own client. Exact "METHOD /path" strings, kept sorted; each Plan 3 task adds its own
 * (Task 3: methods, method suggestions, price, the owner's price health; Task 4: offers; Task 5:
 * taking an offer and the poster's wallet; Task 6: the trade view
 * and the events route; Task 8: the identity and attestation routes; Task 19: live events, Web
 * Push (its final-alert receipt route is gone with the final alert: trade-rules, owner 8 Nov p6-1); Task 24: the release confirmations; Task 26: nudges, nudge settings
  * and blocks; Task 27: the dispute and the appeal; Task 36: My offers; Task 37: the Blocked list and unblock; Plan 5 Tasks 4 and 21: the two feedback
 * routes; Plan 5 Task 3 and C12b: reviews, Skip review, the pending reviews and the traded-total setting; Plan 5 Task 19: the review dispute, apps/web/src/screens/review/api.ts; Plan 5 Task 10: the four past-reputation routes;
 * Plan 5 Tasks 5 and 12: the profile, badge settings and the signed record, apps/web/src/screens/profile/api.ts;
 * Plan 4 Task 8: the site state, read by the web shell; J-16 flex offers: the currency list, read by
 * Post an offer in apps/web/src/screens/post/api.ts; D-016: the account's own freezes, read by
 * apps/web/src/screens/account/AccountFrozen.tsx; S-093: a block row's note, apps/web/src/screens/settings/blockApi.ts;
 * P-012/P-013: the blur check, apps/web/src/api/blurCheck.ts; Haveno review finding 2: the signed ruling statement,
 * read by apps/web/src/escrow/adapters.ts; Plan 5 Tasks 14-15: a proof's ciphertext, read by
 * apps/web/src/screens/proof/ChatProof.tsx and put by apps/web/src/proof/upload.ts; Plan 4 Task 12: the seller's payment proof for a ruling;
 * chat membership design tasks 4 and 6: the chat key record and the counterparty's fallback grant, called by the chat
 * engine through apps/web/src/chat/http.ts like the other /v1/chats routes; D-005: My trades' list, read by
 * apps/web/src/screens/trades/api.ts; Plan 4 Task 27: the ban notice, read by
 * apps/web/src/screens/account/AccountBanned.tsx; sign-up v2, 12 Nov 2026: X2F's signing key as a file to import, a
 * plain download link on the PGP code step; lien recovery review B1/Q2: the quote's lien preview,
 * apps/web/src/screens/quote/api.ts, and the creditor's signed recovery address, apps/web/src/screens/liens/liensApi.ts).
 * Any other new route still needs a client method.
 * Param names are spelled as the route tree reports them (srv.serverRoutes): the proof stack's
 * proofs/:id and the blur check's proofs/:proofId share one node, so all three of those routes read
 * proofs/:id|:proofId; blur-checks/:proofId has no other name at its node and keeps :proofId.
 */
const NOT_AUTH_CLIENT = [
  'DELETE /v1/account/blocks/:displayName',
  'DELETE /v1/account/notes/:displayName|:id',
  'DELETE /v1/account/past-rep/:id',
  'DELETE /v1/account/push',
  'GET /.well-known/x2f-signing-key.asc',
  'GET /v1/account/badges',
  // Plan 4 Task 27: the ban notice's own read, apps/web/src/screens/account/AccountBanned.tsx.
  'GET /v1/account/ban',
  'GET /v1/account/blocks',
  'GET /v1/account/freeze',
  'GET /v1/account/liens/preview',
  'GET /v1/account/notes/:displayName|:id',
  'GET /v1/account/nudges',
  'GET /v1/account/offers',
  'GET /v1/account/past-rep',
  'GET /v1/account/profile/traded-total',
  'GET /v1/account/push',
  'GET /v1/account/record',
  'GET /v1/chats',
  'GET /v1/chats/:chat',
  'GET /v1/chats/:chat/attestation',
  'GET /v1/chats/:chat/envelopes',
  'GET /v1/chats/:chat/key',
  'GET /v1/currencies',
  'GET /v1/events',
  'GET /v1/methods',
  'GET /v1/news',
  'GET /v1/offers',
  'GET /v1/offers/:id',
  'GET /v1/price',
  'GET /v1/reviews/pending',
  'GET /v1/site',
  'GET /v1/team/permissions',
  // Plan 4 Tasks 30-31: support tickets, apps/web/src/screens/support/tickets-model.ts.
  'GET /v1/tickets',
  'GET /v1/tickets/:id',
  'GET /v1/traders/:name',
  'GET /v1/traders/:name/record',
  'GET /v1/trades',
  'GET /v1/trades/:code',
  'GET /v1/trades/:code/after-refund-statement',
  'GET /v1/trades/:code/attestation',
  'GET /v1/trades/:code/blur-checks',
  'GET /v1/trades/:code/confirmations',
  'GET /v1/trades/:code/dispute',
  'GET /v1/trades/:code/proofs/:id|:proofId',
  'GET /v1/trades/:code/review',
  'GET /v1/trades/:code/ruling-statement',
  'PATCH /v1/offers/:id',
  'POST /v1/account/blocks',
  'POST /v1/account/liens/:id/recovery-address',
  'POST /v1/account/notes',
  'POST /v1/account/offers/status',
  'POST /v1/account/past-rep/finish',
  'POST /v1/account/past-rep/start',
  'POST /v1/account/push',
  // S-085 device-bound sessions: the session's proof of its device key, apps/web/src/session/deviceKey.ts.
  'POST /v1/account/session/proof',
  'POST /v1/account/session/proof/challenge',
  'POST /v1/chats',
  'POST /v1/chats/:chat/envelopes',
  'POST /v1/chats/:chat/grant',
  'POST /v1/chats/:chat/identity',
  'POST /v1/chats/:chat/key',
  'POST /v1/feedback',
  'POST /v1/feedback/form',
  'POST /v1/method-suggestions',
  'POST /v1/nudges',
  'POST /v1/offers',
  'POST /v1/offers/:id/take',
  'POST /v1/reviews/:id/dispute',
  'POST /v1/tickets',
  'POST /v1/tickets/:id/close',
  'POST /v1/tickets/:id/messages',
  'POST /v1/trades/:code/appeal',
  'POST /v1/trades/:code/blur-checks/:proofId',
  'POST /v1/trades/:code/chat',
  'POST /v1/trades/:code/dispute',
  'POST /v1/trades/:code/events',
  'POST /v1/trades/:code/identity',
  'POST /v1/trades/:code/payment-proof',
  'POST /v1/trades/:code/proofs/:id|:proofId/blur-check',
  'POST /v1/trades/:code/review',
  'POST /v1/trades/:code/review/skip',
  'POST /v1/trades/:code/wallet',
  'PUT /v1/account/badges',
  'PUT /v1/account/blocks/:displayName/note',
  'PUT /v1/account/nudges',
  'PUT /v1/account/profile/traded-total',
  'PUT /v1/account/record/public',
  'PUT /v1/trades/:code/proofs/:id|:proofId',
  // POST /v1/trades/:code/final-alert-seen is gone with the final alert (owner 8 Nov, p6-1; design-results).
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
  const start = await j.api.registerPgpStart({ displayName: `D${username}`, loginName: username, publicKey: key.publicKey });
  expect(start.fingerprint).toBe(key.fingerprint);
  const done = await j.api.registerPgpFinish({
    challengeId: start.challengeId, code: await codeFrom(start.encryptedMessage, key), deviceLabel: LABEL, acceptedTerms: terms(),
  });
  expect(done).toEqual({ displayName: `D${username}` });
  return { username, key };
}

/** PGP login: the login name with the whole public key (owner G6). */
async function loginPgp(api: AuthApi, username: string, key: Pair) {
  const start = await api.loginPgpStart({ loginName: username, key: key.publicKey });
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
    // Task 16: the sign-up browser is still logged in, so each new browser is approved first.
    const [j1, j2] = [jar(), jar()];
    await expect(approved(srv, j1, loginWithPasskey(j1.api, LABEL, ceremonyOf(soft)))).resolves.toEqual({ status: 'ok' });
    await expect(approved(srv, j2, loginPgp(j2.api, username, key))).resolves.toEqual({ status: 'ok' });
  });

  it('passkey sign-up through the ceremony wrapper', async () => {
    const soft = createSoftAuthenticator({ backedUp: true, userVerified: true });
    const username = uniqueName('key');
    await expect(registerWithWebAuthn(jar().api, { displayName: `D${username}`, loginName: username }, 'passkey', LABEL, terms(), ceremonyOf(soft))).resolves.toEqual({
      displayName: `D${username}`,
      credentialId: soft.credentialId,
    });
    const fresh = jar();
    await expect(approved(srv, fresh, loginWithPasskey(fresh.api, LABEL, ceremonyOf(soft)))).resolves.toEqual({ status: 'ok' });
  });

  it('names the passkey just made by its credential id (owner 25 Nov security-key report)', async () => {
    const soft = createSoftAuthenticator({ backedUp: true, userVerified: true });
    const username = uniqueName('nam');
    const j = jar();
    const { credentialId } = await registerWithWebAuthn(j.api, { displayName: `D${username}`, loginName: username }, 'passkey', LABEL, terms(), ceremonyOf(soft));
    await expect(j.api.renameWebAuthnKey({ credentialId, label: ' Phone  passkey ' })).resolves.toEqual({ label: 'Phone passkey' });
    expect((await j.api.listMethods()).filter((m) => m.type === 'passkey').map((m) => m.label)).toEqual(['Phone passkey']);
    await expect(j.api.renameWebAuthnKey({ credentialId, label: 'x'.repeat(33) })).rejects.toMatchObject({ status: 400, code: 'key-name-invalid', reason: 'too-long' });
  });

});

describe('confirm it\'s you (P2-C2)', () => {
  it('a change 10 seconds after a fresh login goes through withConfirm: one proof, and the token is single-use', async () => {
    const { soft } = await pgpUserWithPasskey();
    const fresh = jar();
    await approved(srv, fresh, loginWithPasskey(fresh.api, LABEL, ceremonyOf(soft)));
    srv.advance(10_000);

    let token: string | undefined;
    const prove = vi.fn(async (a: Parameters<typeof confirmWithWebAuthn>[1]) => (token = await confirmWithWebAuthn(fresh.api, a, ceremonyOf(soft))));
    const run = vi.fn((t?: string) => fresh.api.newRecoveryCodes({ confirmToken: t }));
    const result = await withConfirm({ kind: 'new-recovery-codes' }, run, prove);
    // Hold model v3 (owner 2 Nov 2026): ONE recovery code.
    expect(result.codes).toHaveLength(1);
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
    await approved(srv, fresh, loginWithPasskey(fresh.api, LABEL, ceremonyOf(soft)));
    const e = apiError(await failure(fresh.api.newRecoveryCodes({})));
    expect(e.code).toBe('confirm-required');
    expect(e.action).toBe('new-recovery-codes');
  });

  it('PGP proof: the challenge names the action and the code buys a token for it alone', async () => {
    const { username, key } = await pgpUserWithPasskey();
    const fresh = jar();
    await approved(srv, fresh, loginPgp(fresh.api, username, key));
    const prove = vi.fn(async (action: Parameters<AuthApi['confirmPgpStart']>[0]['action']) => {
      const start = await fresh.api.confirmPgpStart({ action });
      const text = await decrypt(start.encryptedMessage, key.privateKey, srv.deps.pgpSigner.publicArmored, srv.now());
      expect(text).toContain('make new recovery codes');
      return (await fresh.api.confirmPgpFinish({ challengeId: start.challengeId, code: codeOf(text) })).confirmToken;
    });
    const result = await withConfirm({ kind: 'new-recovery-codes' }, (t) => fresh.api.newRecoveryCodes({ confirmToken: t }), prove);
    // Hold model v3 (owner 2 Nov 2026): ONE recovery code.
    expect(result.codes).toHaveLength(1);
    expect(prove).toHaveBeenCalledTimes(1);
  });
});

describe('a two-factor username on the trader site (Review Focus 2)', () => {
  // Staff and the owner log in only on the staff API (owner 2026-11-03, Q19; owner Q13, 6 Nov). After a
  // the owner's keys answer here exactly as an unknown name's would.
  it('owner (Q13): the trader site answers the owner as an unknown name', async () => {
    const { username, soft, key } = await staffWithKeyAndPgp(srv, 'owner');
    const browser: AuthApi = jar().api;
    expect(apiError(await failure(loginWithSecurityKey(browser, username, LABEL, ceremonyOf(soft))))).toMatchObject({ status: 401, code: 'webauthn-failed' });
    const start = await browser.loginPgpStart({ loginName: username, key: key.publicKey });
    expect(apiError(await failure(browser.loginPgpFinish({ challengeId: start.challengeId, code: await codeFrom(start.encryptedMessage, key), deviceLabel: LABEL }))))
      .toMatchObject({ status: 401, code: 'code-invalid' });
    await expect(browser.listMethods()).rejects.toMatchObject({ status: 401 });
  });

  it('staff: the trader site answers a staff username as an unknown one (security key, PGP)', async () => {
    const { username, soft, key } = await staffWithKeyAndPgp(srv);
    const browser: AuthApi = jar().api;
    expect(apiError(await failure(loginWithSecurityKey(browser, username, LABEL, ceremonyOf(soft))))).toMatchObject({ status: 401, code: 'webauthn-failed' });
    const start = await browser.loginPgpStart({ loginName: username, key: key.publicKey });
    expect(apiError(await failure(browser.loginPgpFinish({ challengeId: start.challengeId, code: await codeFrom(start.encryptedMessage, key), deviceLabel: LABEL }))))
      .toMatchObject({ status: 401, code: 'code-invalid' });
    await expect(browser.listMethods()).rejects.toMatchObject({ status: 401 });
  });
});
