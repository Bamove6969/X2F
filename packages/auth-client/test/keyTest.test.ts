/**
 * Owner demo note #94 (16 Nov 2026): "there is no confirmation screen when you setup your security
 * key ... it should even have you test it after adding it to make sure it functions correctly".
 * `testWebAuthnKey` runs a real assertion by the key just added, through the existing confirm
 * ceremony and the server's own assertion check, on a real `buildApi` (Postgres).
 */
import type { AuthenticationResponseJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { codeOf, decrypt, genKey, type Pair } from '../../../apps/api/test/helpers/pgpKeys.js';
import { createSoftAuthenticator, type SoftAuthenticator } from '../../../apps/api/test/helpers/softAuthenticator.js';
import { AuthApiError, KEY_TEST_ACTION, KeyTestError, addWebAuthnKeyWithId, confirmWithWebAuthn, testWebAuthnKey, withConfirm, type AuthenticationCeremony } from '../src/index.js';
import { Jar, ceremonyOf, failure, startServer, uniqueName, type Server } from './helpers/server.js';
import { SIG } from './helpers/routes.js';

const LABEL = 'Browser on Linux';
let srv: Server;

beforeAll(async () => {
  srv = await startServer();
});

afterAll(async () => {
  await srv.close();
});

async function codeFrom(encryptedMessage: string, key: Pair): Promise<string> {
  return codeOf(await decrypt(encryptedMessage, key.privateKey, srv.deps.pgpSigner.publicArmored, srv.now()));
}

/** A new PGP account, still in its sign-up window (so adding a key needs no confirm). */
async function account(): Promise<Jar> {
  const j = new Jar(srv.baseUrl, true);
  const { version } = await j.api.getTerms();
  const key = await genKey();
  const username = uniqueName('kt');
  const start = await j.api.registerPgpStart({ displayName: `D${username}`, loginName: username, publicKey: key.publicKey });
  await j.api.registerPgpFinish({ challengeId: start.challengeId, code: await codeFrom(start.encryptedMessage, key), deviceLabel: LABEL, acceptedTerms: version, termsSignature: SIG });
  return j;
}

const softKey = () => createSoftAuthenticator({ backedUp: false, userVerified: true });

/** Adds `soft` as a security key; a second key is confirmed with `prior` (the first key), as the sheet would. */
function addKey(j: Jar, soft: SoftAuthenticator, prior?: SoftAuthenticator, label?: string) {
  return withConfirm(
    { kind: 'add-method', method: 'security-key' },
    (t) => addWebAuthnKeyWithId(j.api, 'security-key', { ...(label !== undefined ? { label } : {}), ...(t !== undefined ? { confirmToken: t } : {}) }, ceremonyOf(soft)),
    (a) => confirmWithWebAuthn(j.api, a, ceremonyOf(prior!)),
  );
}

/** A ceremony that records the options the browser was given. */
function watched(soft: SoftAuthenticator): AuthenticationCeremony & { seen: PublicKeyCredentialRequestOptionsJSON[] } {
  const seen: PublicKeyCredentialRequestOptionsJSON[] = [];
  const inner = ceremonyOf(soft);
  return {
    seen,
    startAuthentication: async (o) => {
      seen.push(o.optionsJSON);
      return inner.startAuthentication(o);
    },
  };
}

describe('note #94: test a security key right after adding it', () => {
  it('the key just added passes: the browser is asked for that key alone, and the server checks its answer', async () => {
    const j = await account();
    const old = softKey();
    await addKey(j, old, undefined, 'Old key');
    const soft = softKey();
    const { staged, credentialId } = await addKey(j, soft, old, 'New key');
    expect(staged).toBeUndefined();
    expect(credentialId).toBe(soft.credentialId);
    const c = watched(soft);
    await expect(testWebAuthnKey(j.api, credentialId, c)).resolves.toBeUndefined();
    expect(c.seen).toHaveLength(1);
    expect(c.seen[0]!.allowCredentials!.map((x) => x.id)).toEqual([soft.credentialId]);
    // It reuses the existing confirm action; nothing new is asked of the server.
    expect(KEY_TEST_ACTION).toEqual({ kind: 'extend-session' });
  });

  it('another of the account\'s keys answering is not a pass (refused before the server is asked)', async () => {
    const j = await account();
    const a = softKey();
    const b = softKey();
    const added = await addKey(j, a);
    await addKey(j, b, a);
    const e = await failure(testWebAuthnKey(j.api, added.credentialId, ceremonyOf(b)));
    expect(e).toBeInstanceOf(KeyTestError);
    expect((e as KeyTestError).code).toBe('other-key');
  });

  it('a credential the account does not hold is never tried', async () => {
    const j = await account();
    await addKey(j, softKey());
    const stranger = softKey();
    const e = await failure(testWebAuthnKey(j.api, stranger.credentialId, ceremonyOf(stranger)));
    expect(e).toBeInstanceOf(KeyTestError);
    expect((e as KeyTestError).code).toBe('not-listed');
  });

  it("an answer that names the new key but was signed by another fails the server's check", async () => {
    const j = await account();
    const real = softKey();
    const other = softKey();
    const { credentialId } = await addKey(j, real);
    await addKey(j, other, real);
    const forged: AuthenticationCeremony = {
      startAuthentication: async ({ optionsJSON }) => {
        const r = (await ceremonyOf(other).startAuthentication({ optionsJSON })) as AuthenticationResponseJSON;
        return { ...r, id: credentialId, rawId: credentialId };
      },
    };
    const e = await failure(testWebAuthnKey(j.api, credentialId, forged));
    expect(e).toBeInstanceOf(AuthApiError);
    expect((e as AuthApiError).status).toBe(401);
  });
});
