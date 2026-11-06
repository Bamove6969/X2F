import { randomBytes } from 'node:crypto';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import * as openpgp from 'openpgp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deps } from '../src/app.js';
import { DEVICE_COOKIE } from '../src/auth/device.js';
import { insertPgpKey, loadPgpSigner, openKey, pgpLoginRoutes } from '../src/auth/pgp.js';
import { SESSION_COOKIE } from '../src/auth/sessions.js';
import { ApiError } from '../src/errors.js';
import { confirmTokenMethod, seedAccount } from './helpers/accounts.js';
import { approvedLogin } from './helpers/approval.js';
import { testApp, testConfig, testSigner } from './helpers/app.js';
import { inspectPublicKey } from '@x2f/accounts';
import { codeOf, decrypt, genKey, KEY_DATE, resign, type Pair } from './helpers/pgpKeys.js';
import { spySql } from './helpers/sqlSpy.js';

const ORIGIN = 'https://x2f.test';
const ONION = 'http://x2fexample.onion';
const T0 = new Date('2026-10-15T12:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const TERMS = '2026-10-17';

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let logs: string[];
let signerPublic: string;
let now = T0;
let step = 0;
let afterAuthCalls: string[] = [];

beforeAll(async () => {
  const { signer } = await testSigner();
  signerPublic = signer.publicArmored;
  let set: (d: Date) => void;
  ({ app, deps, setNow: set, logs } = await testApp({
    config: testConfig({ origins: [ORIGIN, ONION], pgpSigningFingerprint: signer.fingerprint }),
  }));
  setNow = (d) => {
    now = d;
    set(d);
  };
  // A second mount, as Plan 4 mounts the staff app: traders only, with a hook that refuses.
  await app.register(
    async (s) =>
      pgpLoginRoutes(s, {
        kinds: ['trader'],
        afterAuthenticate: async (accountId) => {
          afterAuthCalls.push(accountId);
          throw new ApiError(403, 'account-disabled');
        },
      }),
    { prefix: '/t/pgp' },
  );
  // The staff API's mount (staff and the owner): staff log in only there (owner 2026-11-03).
  await app.register(async (s) => pgpLoginRoutes(s, { kinds: ['staff', 'owner'] }), { prefix: '/s/pgp' });
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  // Each test starts a day later: start limits, budgets and challenges from earlier tests are gone.
  setNow(new Date(T0.getTime() + ++step * DAY));
  afterAuthCalls = [];
});

/** A browser: keeps the cookies the server sets. */
class Browser {
  cookies: Record<string, string> = {};
  constructor(readonly origin = ORIGIN) {}
  async post(url: string, payload: unknown): Promise<LightMyRequestResponse> {
    const res = await app.inject({
      method: 'POST', url, headers: { origin: this.origin }, cookies: this.cookies, payload: payload as Record<string, unknown>,
    });
    for (const c of res.cookies) this.cookies[c.name] = c.value;
    return res;
  }
}

let counter = 0;
const uniqueName = (p = 'user') => `${p}${(++counter).toString().padStart(3, '0')}x`;

/** Signs up with display name `displayName` and login name `<displayName>.l`. */
async function registerStart(b: Browser, displayName: string, key: Pair) {
  return b.post('/v1/register/pgp/start', { displayName, loginName: `${displayName}.l`, publicKey: key.publicKey });
}

/** Registers display name `displayName` with `key` in browser `b` (or a new one); returns the browser. */
async function registerPgp(displayName: string, key: Pair, b = new Browser()): Promise<Browser> {
  const start = await registerStart(b, displayName, key);
  expect(start.statusCode).toBe(200);
  const code = codeOf(await dec(start.json().encryptedMessage, key.privateKey));
  const fin = await b.post('/v1/register/pgp/finish', {
    challengeId: start.json().challengeId, code, deviceLabel: 'Test browser', acceptedTerms: TERMS,
  });
  expect(fin.statusCode).toBe(201);
  return b;
}

/** PGP login needs no name: the person pastes their whole public key (a key pair sends its public half; a string is sent as is). */
async function loginStart(b: Browser, key: Pair | string, extra: Record<string, unknown> = {}, mount = '/v1/login/pgp') {
  return b.post(`${mount}/start`, { key: typeof key === 'string' ? key : key.publicKey, ...extra });
}

async function loginFinish(b: Browser, challengeId: string, code: string, extra: Record<string, unknown> = {}, mount = '/v1/login/pgp') {
  return b.post(`${mount}/finish`, { challengeId, code, deviceLabel: 'Test browser', ...extra });
}

/** The staff API's PGP mount (`/s/pgp` here, kinds staff and owner). */
const STAFF_MOUNT = '/s/pgp';

/** True when a login start answered with a decoy: a challenge bound to no account (to the outside it looks like any other). */
async function isDecoy(res: LightMyRequestResponse): Promise<boolean> {
  const { rows } = await deps.db.query<{ account_id: string | null }>('select account_id from challenges where id = $1', [res.json().challengeId]);
  return rows.length === 1 && rows[0]!.account_id === null;
}

async function accountId(displayName: string): Promise<string> {
  const { rows } = await deps.db.query<{ id: string }>('select id from accounts where display_key = $1', [displayName.toLowerCase()]);
  return rows[0]!.id;
}

/** The recipient profile a message shows: public-key algorithm of each PKESK packet. */
async function recipients(armored: string): Promise<string[]> {
  const msg = await openpgp.readMessage({ armoredMessage: armored });
  return msg.packets
    .filterByTag(openpgp.enums.packet.publicKeyEncryptedSessionKey)
    .map((p) => String((p as unknown as { publicKeyAlgorithm: number }).publicKeyAlgorithm));
}

/** A well-formed device cookie the client made up (32 random bytes, base64url). */
const madeUpCookie = () => randomBytes(32).toString('base64url');

const pkeskIDs = async (armored: string) => {
  const msg = await openpgp.readMessage({ armoredMessage: armored });
  return msg.packets.filterByTag(openpgp.enums.packet.publicKeyEncryptedSessionKey).map((p) => {
    return (p as unknown as { publicKeyID: openpgp.KeyID & { isWildcard(): boolean } }).publicKeyID;
  });
};

/** Decrypts at the test clock, so a signature made at the server clock is not "in the future". */
const dec = (message: string, privateArmored: string, signer?: string) => decrypt(message, privateArmored, signer, now);

let ed: Pair;
let edB: Pair;

beforeAll(async () => {
  [ed, edB] = await Promise.all([genKey(), genKey()]);
});

describe('register', () => {
  it('sends a signed challenge naming the site, purpose and times; the code works in any case and spacing', async () => {
    const b = new Browser();
    const name = uniqueName();
    const start = await registerStart(b, name, ed);
    expect(start.statusCode).toBe(200);
    expect(Object.keys(start.json()).sort()).toEqual(['challengeId', 'encryptedMessage', 'expiresAt', 'fingerprint']);
    expect(start.json().fingerprint).toBe(ed.fingerprint);
    const text = await dec(start.json().encryptedMessage, ed.privateKey, signerPublic);
    const t = now.toISOString().slice(0, 19);
    const exp = new Date(now.getTime() + 5 * MIN).toISOString().slice(0, 19);
    expect(text).toContain('X2F login code: ');
    expect(text).toContain('Site: X2F (x2f.test)');
    expect(text).toContain('Purpose: create your account');
    expect(text).toContain(`Time: ${t}Z`);
    expect(text).toContain(`Expires: ${exp}Z`);
    const code = codeOf(text).toLowerCase().replaceAll('-', '');
    const fin = await b.post('/v1/register/pgp/finish', {
      challengeId: start.json().challengeId, code, deviceLabel: 'Test browser', acceptedTerms: TERMS,
    });
    expect(fin.statusCode).toBe(201);
    expect(fin.json()).toEqual({ displayName: name });
    expect(fin.body).not.toContain(`${name}.l`);
    expect(b.cookies[SESSION_COOKIE]).toBeTruthy();
    const { rows } = await deps.db.query('select terms_version from accounts where display_key = $1', [name.toLowerCase()]);
    expect(rows[0].terms_version).toBe(TERMS);
  });

  it('uses the checked Origin as the site host (onion)', async () => {
    const b = new Browser(ONION);
    const start = await registerStart(b, uniqueName(), ed);
    const text = await dec(start.json().encryptedMessage, ed.privateKey);
    expect(text).toContain('Site: X2F (x2fexample.onion)');
    expect(text).toContain('Only paste this code into x2fexample.onion.');
  });

  it('gives zero key IDs in every PKESK packet', async () => {
    const start = await registerStart(new Browser(), uniqueName(), ed);
    const ids = await pkeskIDs(start.json().encryptedMessage);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id.isWildcard()).toBe(true);
  });

  it('requires the current Terms before touching the challenge', async () => {
    const b = new Browser();
    const name = uniqueName();
    const key = await genKey();
    const start = await registerStart(b, name, key);
    const code = codeOf(await dec(start.json().encryptedMessage, key.privateKey));
    const bad = await b.post('/v1/register/pgp/finish', { challengeId: start.json().challengeId, code, deviceLabel: 'x', acceptedTerms: '2020-01-01' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ error: 'terms-not-accepted', version: TERMS });
    const ok = await b.post('/v1/register/pgp/finish', { challengeId: start.json().challengeId, code, deviceLabel: 'x', acceptedTerms: TERMS });
    expect(ok.statusCode).toBe(201);
  });

  it('refuses a private key and stores nothing of it', async () => {
    const before = await deps.db.query('select count(*)::int as n from challenges');
    const res = await new Browser().post('/v1/register/pgp/start', { displayName: uniqueName(), loginName: 'some.login', publicKey: ed.privateKey });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('key-private');
    expect(typeof res.json().detail).toBe('string');
    const after = await deps.db.query('select count(*)::int as n from challenges');
    expect(after.rows[0].n).toBe(before.rows[0].n);
    const leaked = await deps.db.query(`select 1 from challenges where payload::text like '%PRIVATE%'`);
    expect(leaked.rows).toHaveLength(0);
    expect((await deps.db.query('select count(*)::int as n from pgp_keys where fingerprint = $1', [ed.fingerprint])).rows[0].n).toBeLessThanOrEqual(1);
    expect(logs.join('\n')).not.toContain('PRIVATE KEY');
  });

  it('refuses a 40 KiB key as too large', async () => {
    const res = await new Browser().post('/v1/register/pgp/start', { displayName: uniqueName(), loginName: 'some.login', publicKey: 'x'.repeat(40 * 1024) });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('key-too-large');
  });

  it('checks both names at start', async () => {
    const name = uniqueName();
    await registerPgp(name, await genKey());
    const taken = await registerStart(new Browser(), name.toUpperCase(), ed);
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error).toBe('display-name-taken');
    // A taken login name is not revealed at start; only the finish, after the code proves the key,
    // says so, and only as the generic names-unavailable.
    const fresh = await genKey();
    const lb = new Browser();
    const loginTaken = await lb.post('/v1/register/pgp/start', { displayName: uniqueName(), loginName: `${name}.L`, publicKey: fresh.publicKey });
    expect(loginTaken.statusCode).toBe(200);
    const free = await new Browser().post('/v1/register/pgp/start', { displayName: uniqueName(), loginName: 'never.used.9', publicKey: fresh.publicKey });
    expect(Object.keys(free.json()).sort()).toEqual(Object.keys(loginTaken.json()).sort());
    const code = codeOf(await dec(loginTaken.json().encryptedMessage, fresh.privateKey));
    const fin = await lb.post('/v1/register/pgp/finish', { challengeId: loginTaken.json().challengeId, code, deviceLabel: 'x', acceptedTerms: TERMS });
    expect(fin.statusCode).toBe(409);
    expect(fin.json()).toEqual({ error: 'names-unavailable' });
    const reserved = await registerStart(new Browser(), 'X2F.Support', ed);
    expect(reserved.json().error).toBe('display-name-reserved');
    const same = await new Browser().post('/v1/register/pgp/start', { displayName: 'Same.Pgp1', loginName: 'same.pgp1', publicKey: ed.publicKey });
    expect(same.json().error).toBe('names-same');
  });

  it('reveals a reused key only after the code proves it (409 key-in-use)', async () => {
    const key = await genKey();
    await registerPgp(uniqueName(), key);
    const b = new Browser();
    const name = uniqueName();
    const start = await registerStart(b, name, key);
    expect(start.statusCode).toBe(200);
    const code = codeOf(await dec(start.json().encryptedMessage, key.privateKey));
    const fin = await b.post('/v1/register/pgp/finish', { challengeId: start.json().challengeId, code, deviceLabel: 'x', acceptedTerms: TERMS });
    expect(fin.statusCode).toBe(409);
    expect(fin.json()).toEqual({ error: 'key-in-use' });
    const { rows } = await deps.db.query('select 1 from accounts where display_key = $1', [name.toLowerCase()]);
    expect(rows).toHaveLength(0);
  });
});

describe('signing key (R7)', () => {
  it('GET /v1/pgp/signing-key returns the fingerprint and the public half only', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/pgp/signing-key' });
    expect(res.statusCode).toBe(200);
    expect(res.json().fingerprint).toBe(deps.config.pgpSigningFingerprint);
    expect(res.json().publicKey).toContain('-----BEGIN PGP PUBLIC KEY BLOCK-----');
    expect(res.json().publicKey).not.toContain('PRIVATE KEY');
  });

  describe('loadPgpSigner', () => {
    let dir: string;
    beforeAll(async () => {
      dir = await mkdtemp(join(tmpdir(), 'x2f-signer-'));
    });
    afterAll(async () => {
      await rm(dir, { recursive: true, force: true });
    });
    const write = async (name: string, text: string) => {
      const p = join(dir, name);
      await writeFile(p, text);
      await chmod(p, 0o600);
      return p;
    };

    it('loads the key when the fingerprint matches', async () => {
      const { privateArmored, signer } = await testSigner();
      const s = await loadPgpSigner(await write('ok.asc', privateArmored), signer.fingerprint);
      expect(s.fingerprint).toBe(signer.fingerprint);
      expect(s.publicArmored).not.toContain('PRIVATE');
    });

    it('throws naming X2F_PGP_SIGNING_FINGERPRINT on a different fingerprint', async () => {
      const { privateArmored } = await testSigner();
      await expect(loadPgpSigner(await write('fp.asc', privateArmored), 'a'.repeat(40))).rejects.toThrow(/X2F_PGP_SIGNING_FINGERPRINT/);
    });

    it('refuses a public-only key file', async () => {
      const { signer } = await testSigner();
      await expect(loadPgpSigner(await write('pub.asc', signer.publicArmored), signer.fingerprint)).rejects.toThrow(/X2F_PGP_SIGNING_KEY_PATH/);
    });

    it('refuses a passphrase-protected key', async () => {
      const k = await openpgp.generateKey({ type: 'ecc', curve: 'ed25519Legacy', userIDs: [{ name: 's' }], passphrase: 'secret', date: KEY_DATE });
      const fp = (await openpgp.readKey({ armoredKey: k.publicKey })).getFingerprint();
      await expect(loadPgpSigner(await write('enc.asc', k.privateKey), fp)).rejects.toThrow(/passphrase/);
    });
  });
});

describe('login', () => {
  let name: string;
  let key: Pair;
  let home: Browser;

  beforeAll(async () => {
    name = uniqueName();
    key = await genKey();
    home = await registerPgp(name, key);
  });

  it('a code works once, until exactly 5:00', async () => {
    const b = new Browser();
    const s1 = await loginStart(b, key);
    expect(s1.statusCode).toBe(200);
    const text = await dec(s1.json().encryptedMessage, key.privateKey, signerPublic);
    expect(text).toContain('Purpose: log in');
    const code = codeOf(text);
    const t = now;
    setNow(new Date(t.getTime() + 5 * MIN - 1000));
    const ok = await loginFinish(b, s1.json().challengeId, code);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ status: 'ok' });
    expect(b.cookies[SESSION_COOKIE]).toBeTruthy();
    // A used login challenge answers exactly like a wrong code (I-2a).
    const again = await loginFinish(b, s1.json().challengeId, code);
    expect(again.statusCode).toBe(401);
    expect(again.json()).toEqual({ error: 'code-invalid' });

    setNow(new Date(t.getTime() + HOUR));
    const s2 = await loginStart(home, key);
    const code2 = codeOf(await dec(s2.json().encryptedMessage, key.privateKey));
    setNow(new Date(t.getTime() + HOUR + 5 * MIN));
    const late = await loginFinish(home, s2.json().challengeId, code2);
    expect(late.statusCode).toBe(400);
    expect(late.json()).toEqual({ error: 'challenge-expired' });
  });

  it('a wrong code is code-invalid; 20 wrong codes do not block a correct one', async () => {
    const b = new Browser();
    for (let i = 0; i < 20; i++) {
      setNow(new Date(now.getTime() + 61_000));
      const s = await loginStart(b, key);
      expect(s.statusCode).toBe(200);
      const res = await loginFinish(b, s.json().challengeId, 'AAAA-AAAA-AAAA');
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'code-invalid' });
    }
    setNow(new Date(now.getTime() + 61_000));
    const s = await loginStart(b, key);
    const res = await loginFinish(b, s.json().challengeId, codeOf(await dec(s.json().encryptedMessage, key.privateKey)));
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('challenge DoS: an anonymous browser cannot push out a known browser’s challenge, and is slowed after 5', async () => {
    const a = home;
    const sa = await loginStart(a, key);
    const codeA = codeOf(await dec(sa.json().encryptedMessage, key.privateKey));
    const attacker = new Browser();
    for (let i = 0; i < 5; i++) expect((await loginStart(attacker, key)).statusCode).toBe(200);
    // Earlier tests' PGP-alone logins on new browsers started the account's 24-hour hold, during
    // which a login that waits opens nothing (Task 17 review round 2 N-C1); this test is about challenges.
    await deps.db.query('delete from account_holds');
    const fin = await loginFinish(a, sa.json().challengeId, codeA);
    expect(fin.json()).toEqual({ status: 'ok' });
    const sixth = await loginStart(attacker, key);
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json().error).toBe('slow-down');

    // A's second start invalidates A's first; the first then answers like a wrong code.
    const a1 = await loginStart(a, key);
    const a2 = await loginStart(a, key);
    const c1 = codeOf(await dec(a1.json().encryptedMessage, key.privateKey));
    const c2 = codeOf(await dec(a2.json().encryptedMessage, key.privateKey));
    expect((await loginFinish(a, a1.json().challengeId, c1)).json()).toEqual({ error: 'code-invalid' });
    expect((await loginFinish(a, a2.json().challengeId, c2)).json()).toEqual({ status: 'ok' });
  });

  it('two parallel finishes with the right code: one session, one code-invalid', async () => {
    const b = new Browser();
    const s = await loginStart(b, key);
    const code = codeOf(await dec(s.json().encryptedMessage, key.privateKey));
    const [r1, r2] = await Promise.all([loginFinish(b, s.json().challengeId, code), loginFinish(b, s.json().challengeId, code)]);
    expect([r1.statusCode, r2.statusCode].sort()).toEqual([200, 401]);
    expect([r1.json(), r2.json()]).toContainEqual({ error: 'code-invalid' });
  });

  it('same shape for unknown and real keys, by fingerprint or whole key; the decoy code never works', async () => {
    const stranger = await genKey();
    const decoy = await loginStart(new Browser(), stranger);
    const real = await loginStart(new Browser(), key);
    for (const res of [decoy, real]) {
      expect(res.statusCode).toBe(200);
      expect(Object.keys(res.json()).sort()).toEqual(['challengeId', 'encryptedMessage', 'expiresAt']);
      expect(res.headers['set-cookie'] === undefined).toBe(decoy.headers['set-cookie'] === undefined);
    }
    // Both go to the pasted key: the same recipient packets, so holding the public key tells nothing.
    expect(await recipients(decoy.json().encryptedMessage)).toEqual(await recipients(real.json().encryptedMessage));
    const decoyText = await dec(decoy.json().encryptedMessage, stranger.privateKey, signerPublic);
    for (const id of await pkeskIDs(decoy.json().encryptedMessage)) expect(id.isWildcard()).toBe(true);
    const res = await loginFinish(new Browser(), decoy.json().challengeId, codeOf(decoyText));
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'code-invalid' });
  });

  it('a disabled account with the right code → account-disabled, no session', async () => {
    const n = uniqueName();
    const k = await genKey();
    await registerPgp(n, k);
    await deps.db.query('update accounts set disabled_at = $2 where display_key = $1', [n.toLowerCase(), now]);
    const b = new Browser();
    const s = await loginStart(b, k);
    const res = await loginFinish(b, s.json().challengeId, codeOf(await dec(s.json().encryptedMessage, k.privateKey)));
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'account-disabled' });
    expect(b.cookies[SESSION_COOKIE]).toBeUndefined();
  });
});

describe('expired keys and refreshed keys', () => {
  it('an expired key gets key-expired with nothing else; a re-signed refresh is stored after finish', async () => {
    const n = uniqueName();
    // Valid for 3 days from 2 days ago.
    const k = await genKey({ date: new Date(now.getTime() - 2 * DAY), keyExpirationTime: 3 * 86_400 });
    await registerPgp(n, k);
    setNow(new Date(now.getTime() + 2 * DAY));
    const b = new Browser();
    // The pasted key is expired: refused before any lookup, as it would be for anyone's key.
    const expired = await loginStart(b, k);
    expect(expired.statusCode).toBe(400);
    expect(expired.json()).toMatchObject({ error: 'key-expired' });
    const stranger = await genKey({ date: new Date(now.getTime() - 4 * DAY), keyExpirationTime: 3 * 86_400 });
    expect((await loginStart(b, stranger)).json()).toMatchObject({ error: 'key-expired' });

    // Pasting the re-signed whole key refreshes the stored copy.
    const refreshed = await resign(k, new Date(now.getTime() - HOUR), 365 * 86_400);
    const s = await loginStart(b, refreshed.publicKey);
    expect(s.statusCode).toBe(200);
    const code = codeOf(await dec(s.json().encryptedMessage, refreshed.privateKey));
    const fin = await loginFinish(b, s.json().challengeId, code);
    expect(fin.json()).toEqual({ status: 'ok' });
    const { rows } = await deps.db.query<{ armored_enc: Buffer; fingerprint: string }>(
      'select armored_enc, fingerprint from pgp_keys where account_id = $1', [await accountId(n)],
    );
    const storedNow = await inspectPublicKey(openKey(deps.config, rows[0]!.armored_enc, rows[0]!.fingerprint), now);
    expect(storedNow.ok).toBe(true);
    // The stored copy is the refreshed one now.
    expect((await loginStart(b, refreshed)).statusCode).toBe(200);
  });

  it('a pasted key X2F does not know gets a decoy encrypted to that key, whose code never works', async () => {
    const n = uniqueName();
    const k = await genKey();
    await registerPgp(n, k);
    const other = await genKey();
    for (let i = 0; i < 2; i++) {
      const b = new Browser();
      const s = await loginStart(b, other.publicKey);
      expect(s.statusCode).toBe(200);
      expect(Object.keys(s.json()).sort()).toEqual(['challengeId', 'encryptedMessage', 'expiresAt']);
      await expect(dec(s.json().encryptedMessage, k.privateKey)).rejects.toThrow();
      // A keyserver copy tells the tester nothing: the message goes to the key they sent either way.
      const code = codeOf(await dec(s.json().encryptedMessage, other.privateKey, signerPublic));
      expect((await loginFinish(b, s.json().challengeId, code)).json()).toEqual({ error: 'code-invalid' });
    }
  });

  it('a refresh merges into the stored key: an old public copy cannot undo a subkey revocation (I2)', async () => {
    const n = uniqueName();
    // Two encryption subkeys; the newer one (S2) is the one encryption picks.
    const k = await genKey({ subkeys: [{}, { date: new Date(KEY_DATE.getTime() + DAY) }] });
    await registerPgp(n, k);
    const priv = await openpgp.readPrivateKey({ armoredKey: k.privateKey });
    const onlyS2 = await openpgp.readPrivateKey({ armoredKey: k.privateKey });
    onlyS2.subkeys = [onlyS2.subkeys[1]!];
    const s2Only = onlyS2.armor();

    // Control: before the revocation, a challenge decrypts with S2 alone.
    const s0 = await loginStart(new Browser(), k);
    await dec(s0.json().encryptedMessage, s2Only);

    // The owner revokes S2 and refreshes the server's copy with the revocation.
    const revokedS2 = await priv.subkeys[1]!.revoke(priv.keyPacket as openpgp.SecretKeyPacket, {}, new Date(now.getTime() - MIN));
    const revokedKey = await openpgp.readPrivateKey({ armoredKey: k.privateKey });
    revokedKey.subkeys[1] = revokedS2;
    const b = new Browser();
    const s1 = await loginStart(b, revokedKey.toPublic().armor());
    expect(s1.statusCode).toBe(200);
    await expect(dec(s1.json().encryptedMessage, s2Only)).rejects.toThrow();
    const c1 = codeOf(await dec(s1.json().encryptedMessage, k.privateKey));
    expect(await approvedLogin(deps, await loginFinish(b, s1.json().challengeId, c1), (u) => b.post(u, {}))).toEqual({ status: 'ok' });

    // Someone sends the old public copy (no revocation) as a refresh: S2 stays revoked on the
    // server. The pasted copy picks S2, which the stored copy no longer accepts (M-2), so it gets
    // a decoy, still encrypted to the subkey the pasted key picks: the message depends on the
    // pasted key alone, and its code never works.
    const b2 = new Browser();
    const s2 = await loginStart(b2, k.publicKey);
    expect(s2.statusCode).toBe(200);
    expect(await isDecoy(s2)).toBe(true);
    const c2 = codeOf(await dec(s2.json().encryptedMessage, s2Only));
    expect((await loginFinish(b2, s2.json().challengeId, c2)).json()).toEqual({ error: 'code-invalid' });
    // An unknown key with the same layout gets a message of the same shape.
    const lookalike = await genKey({ subkeys: [{}, { date: new Date(KEY_DATE.getTime() + DAY) }] });
    const unknown = await loginStart(new Browser(), lookalike);
    expect(await recipients(unknown.json().encryptedMessage)).toEqual(await recipients(s2.json().encryptedMessage));
    const { rows } = await deps.db.query<{ armored_enc: Buffer; fingerprint: string }>(
      'select armored_enc, fingerprint from pgp_keys where account_id = $1', [await accountId(n)],
    );
    const stored = await openpgp.readKey({ armoredKey: openKey(deps.config, rows[0]!.armored_enc, rows[0]!.fingerprint) });
    const enc = await stored.getEncryptionKey(undefined, now);
    expect(enc.getKeyID().equals(stored.subkeys[1]!.getKeyID())).toBe(false);
    // The current copy (with the revocation) still logs in, through S1.
    const b3 = new Browser();
    const s3 = await loginStart(b3, revokedKey.toPublic().armor());
    expect(await isDecoy(s3)).toBe(false);
    await expect(dec(s3.json().encryptedMessage, s2Only)).rejects.toThrow();
    const c3 = codeOf(await dec(s3.json().encryptedMessage, k.privateKey));
    expect(await approvedLogin(deps, await loginFinish(b3, s3.json().challengeId, c3), (u) => b3.post(u, {}))).toEqual({ status: 'ok' });
  });

  it('a key whose only encryption subkey expired (primary still valid) → key-expired, no fallback', async () => {
    const n = uniqueName();
    const k = await genKey({ date: new Date(now.getTime() - 2 * DAY), subkeys: [{ keyExpirationTime: 3 * 86_400 }] });
    await registerPgp(n, k);
    setNow(new Date(now.getTime() + 2 * DAY));
    const res = await loginStart(new Browser(), k);
    expect(res.statusCode).toBe(400);
    // Refused on the pasted key alone, the same for a key nobody registered.
    const stranger = await genKey({ date: new Date(now.getTime() - 4 * DAY), subkeys: [{ keyExpirationTime: 3 * 86_400 }] });
    expect((await loginStart(new Browser(), stranger)).json()).toEqual(res.json());
  });

  it('a key revoked on the server gets the same decoy as an unknown key; pasting the revoked key → key-revoked', async () => {
    const n = uniqueName();
    const k = await genKey();
    await registerPgp(n, k);
    const priv = await openpgp.readPrivateKey({ armoredKey: k.privateKey });
    const r = await openpgp.revokeKey({ key: priv, date: new Date(now.getTime() - MIN), format: 'armored' });
    // The owner of the key revoked it; the server's copy is updated as a refresh would.
    const fp = k.fingerprint;
    const id = await accountId(n);
    await deps.db.query('delete from pgp_keys where account_id = $1', [id]);
    await insertPgpKey(deps.db, deps.config, { accountId: id, fingerprint: fp, armored: r.publicKey, now });
    // An old, unrevoked copy (as on a keyserver): the answer an unknown key gets, and its code never works.
    const b = new Browser();
    const res = await loginStart(b, k);
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json()).sort()).toEqual(['challengeId', 'encryptedMessage', 'expiresAt']);
    const stranger = await loginStart(new Browser(), await genKey());
    expect(await recipients(res.json().encryptedMessage)).toEqual(await recipients(stranger.json().encryptedMessage));
    const code = codeOf(await dec(res.json().encryptedMessage, k.privateKey, signerPublic));
    expect((await loginFinish(b, res.json().challengeId, code)).json()).toEqual({ error: 'code-invalid' });
    const { rows } = await deps.db.query('select account_id from challenges where id = $1', [res.json().challengeId]);
    expect(rows).toEqual([{ account_id: null }]);
    // The revoked key itself is refused by inspection, before any lookup.
    expect((await loginStart(new Browser(), r.publicKey)).json()).toMatchObject({ error: 'key-revoked' });
  });
});

describe('binding', () => {
  let name: string;
  let key: Pair;
  let home: Browser;

  beforeAll(async () => {
    name = uniqueName();
    key = await genKey();
    home = await registerPgp(name, key);
  });

  // Each test starts a day later, past the 12-hour logout timer: log home in afresh, in the same
  // (trusted) browser, so no 24-hour hold starts (Task 17) and a second browser's login can wait for approval.
  beforeEach(async () => {
    const s = await loginStart(home, key);
    await loginFinish(home, s.json().challengeId, codeOf(await dec(s.json().encryptedMessage, key.privateKey)));
  });

  it('a login code is refused by the confirm and register finishes', async () => {
    setNow(new Date(now.getTime() + HOUR));
    const s = await loginStart(home, key);
    const code = codeOf(await dec(s.json().encryptedMessage, key.privateKey));
    const c = await home.post('/v1/confirm/pgp/finish', { challengeId: s.json().challengeId, code });
    expect(c.json()).toEqual({ error: 'challenge-expired' });
    const s2 = await loginStart(home, key);
    const code2 = codeOf(await dec(s2.json().encryptedMessage, key.privateKey));
    const r = await home.post('/v1/register/pgp/finish', { challengeId: s2.json().challengeId, code: code2, deviceLabel: 'x', acceptedTerms: TERMS });
    expect(r.json()).toEqual({ error: 'challenge-expired' });
  });

  it('a confirm challenge of session A cannot be finished by session B, nor after A logs out', async () => {
    setNow(new Date(now.getTime() + HOUR));
    const a = home;
    const b = new Browser();
    const sb = await loginStart(b, key);
    await approvedLogin(deps, await loginFinish(b, sb.json().challengeId, codeOf(await dec(sb.json().encryptedMessage, key.privateKey))), (u) => b.post(u, {}));

    const action = { kind: 'set-password' };
    const ca = await a.post('/v1/confirm/pgp/start', { action });
    expect(ca.statusCode).toBe(200);
    const codeA = codeOf(await dec(ca.json().encryptedMessage, key.privateKey, signerPublic));
    const byB = await b.post('/v1/confirm/pgp/finish', { challengeId: ca.json().challengeId, code: codeA });
    expect(byB.json()).toEqual({ error: 'challenge-expired' });

    const ca2 = await a.post('/v1/confirm/pgp/start', { action });
    const codeA2 = codeOf(await dec(ca2.json().encryptedMessage, key.privateKey));
    expect((await a.post('/v1/logout', {})).statusCode).toBe(200);
    // Log in again in the same browser: a new session, so the old confirm challenge is dead.
    const s = await loginStart(a, key);
    await loginFinish(a, s.json().challengeId, codeOf(await dec(s.json().encryptedMessage, key.privateKey)));
    const after = await a.post('/v1/confirm/pgp/finish', { challengeId: ca2.json().challengeId, code: codeA2 });
    expect(after.json()).toEqual({ error: 'challenge-expired' });
    home = a;
  });

  it('an add-key challenge of account X cannot be finished by account Y', async () => {
    const y = await registerPgp(uniqueName(), await genKey());
    const newKey = await genKey();
    const start = await y.post('/v1/account/pgp/start', { publicKey: newKey.publicKey }); // onboarding: no token needed
    expect(start.statusCode).toBe(200);
    const code = codeOf(await dec(start.json().encryptedMessage, newKey.privateKey, signerPublic));
    // X's PGP-alone login may have started the 24-hour hold (Task 17, coolingOff.test.ts), which
    // would refuse first; this test is about the binding.
    await deps.db.query('delete from account_holds');
    const byX = await home.post('/v1/account/pgp/finish', { challengeId: start.json().challengeId, code });
    expect(byX.json()).toEqual({ error: 'challenge-expired' });
  });
});

describe('confirm and adding a key', () => {
  it('a second key needs a confirm token outside onboarding; with one it is added and both keys log in', async () => {
    const n = uniqueName();
    const k1 = await genKey();
    const b = await registerPgp(n, k1);
    setNow(new Date(now.getTime() + 31 * MIN));
    const k2 = await genKey();

    const none = await b.post('/v1/account/pgp/start', { publicKey: k2.publicKey });
    expect(none.statusCode).toBe(403);
    expect(none.json()).toEqual({ error: 'confirm-required', action: 'add-method' });

    const action = { kind: 'add-method', method: 'pgp' };
    const cs = await b.post('/v1/confirm/pgp/start', { action });
    const ctext = await dec(cs.json().encryptedMessage, k1.privateKey, signerPublic);
    expect(ctext).toContain('Purpose: add a login method (pgp)');
    const cf = await b.post('/v1/confirm/pgp/finish', { challengeId: cs.json().challengeId, code: codeOf(ctext) });
    expect(cf.statusCode).toBe(200);
    const { confirmToken } = cf.json();
    expect(typeof confirmToken).toBe('string');
    // The token records how it was earned (owner, 2026-10-23: a PGP confirm makes a new wallet usable at once).
    expect(await confirmTokenMethod(deps, confirmToken)).toBe('pgp');

    // A PGP-alone session's change waits 24 hours (Task 17, owner 2026-10-29 14:12; coolingOff.test.ts):
    // here the session counts as strong, since this test is about the key itself.
    await deps.db.query("update sessions set strength = 'strong' where account_id = (select id from accounts where display_key = $1)", [n.toLowerCase()]);
    const as = await b.post('/v1/account/pgp/start', { publicKey: k2.publicKey, confirmToken });
    expect(as.statusCode).toBe(200);
    const atext = await dec(as.json().encryptedMessage, k2.privateKey, signerPublic);
    expect(atext).toContain('Purpose: add this PGP key to your account');
    const af = await b.post('/v1/account/pgp/finish', { challengeId: as.json().challengeId, code: codeOf(atext) });
    expect(af.statusCode).toBe(200);

    const id = await accountId(n);
    const { rows } = await deps.db.query(`select detail from alerts where account_id = $1 and kind = 'login-method-added'`, [id]);
    expect(rows).toEqual([{ detail: { method: 'pgp', fingerprint: k2.fingerprint } }]);

    // Each key logs in on its own, and a challenge goes to the one key named only.
    for (const [mine, theirs] of [[k1, k2], [k2, k1]] as const) {
      const b2 = new Browser();
      const s = await loginStart(b2, mine);
      await expect(dec(s.json().encryptedMessage, theirs.privateKey)).rejects.toThrow();
      const fin = await loginFinish(b2, s.json().challengeId, codeOf(await dec(s.json().encryptedMessage, mine.privateKey)));
      expect(await approvedLogin(deps, fin, (u) => b2.post(u, {}))).toEqual({ status: 'ok' });
    }
  });

  it('a confirm token is issued for exactly the confirmed action', async () => {
    const n = uniqueName();
    const k = await genKey();
    const b = await registerPgp(n, k);
    setNow(new Date(now.getTime() + 31 * MIN));
    const cs = await b.post('/v1/confirm/pgp/start', { action: { kind: 'set-password' } });
    const cf = await b.post('/v1/confirm/pgp/finish', {
      challengeId: cs.json().challengeId, code: codeOf(await dec(cs.json().encryptedMessage, k.privateKey)),
    });
    const k2 = await genKey();
    const wrong = await b.post('/v1/account/pgp/start', { publicKey: k2.publicKey, confirmToken: cf.json().confirmToken });
    expect(wrong.json()).toEqual({ error: 'confirm-invalid' });
  });

  it('adding a key already on another account → key-in-use at finish', async () => {
    const taken = await genKey();
    await registerPgp(uniqueName(), taken);
    const b = await registerPgp(uniqueName(), await genKey());
    const s = await b.post('/v1/account/pgp/start', { publicKey: taken.publicKey });
    expect(s.statusCode).toBe(200);
    const f = await b.post('/v1/account/pgp/finish', {
      challengeId: s.json().challengeId, code: codeOf(await dec(s.json().encryptedMessage, taken.privateKey)),
    });
    expect(f.statusCode).toBe(409);
    expect(f.json()).toEqual({ error: 'key-in-use' });
  });
});

describe('user IDs (R16)', () => {
  it('a v6 key is stored without user IDs and still logs in; a v4 key is kept whole; no email anywhere', async () => {
    const v6 = await genKey({ v6: true, userIDs: [{ name: 'name', email: 'a@b.c' }] });
    const v4 = await genKey({ userIDs: [{ name: 'name', email: 'a@b.c' }] });
    const n6 = uniqueName();
    const n4 = uniqueName();
    await registerPgp(n6, v6);
    await registerPgp(n4, v4);

    const row = async (n: string) =>
      (await deps.db.query<{ armored_enc: Buffer; fingerprint: string; t: string }>(
        'select armored_enc, fingerprint, p::text as t from pgp_keys p where account_id = $1', [await accountId(n)],
      )).rows[0]!;
    const r6 = await row(n6);
    const r4 = await row(n4);
    const k6 = await openpgp.readKey({ armoredKey: openKey(deps.config, r6.armored_enc, r6.fingerprint) });
    const k4 = await openpgp.readKey({ armoredKey: openKey(deps.config, r4.armored_enc, r4.fingerprint) });
    expect(k6.users).toHaveLength(0);
    expect(k4.users).toHaveLength(1);
    for (const r of [r6, r4]) {
      expect(r.t).not.toContain('a@b.c');
      expect(r.t).not.toContain('-----BEGIN');
      expect(r.armored_enc.toString('latin1')).not.toContain('a@b.c');
      expect(r.armored_enc.toString('latin1')).not.toContain('-----BEGIN');
    }
    const ch = await deps.db.query(`select 1 from challenges where payload::text like '%a@b.c%' or payload::text like '%-----BEGIN%'`);
    expect(ch.rows).toHaveLength(0);

    const b = new Browser();
    const s = await loginStart(b, v6);
    const fin = await loginFinish(b, s.json().challengeId, codeOf(await dec(s.json().encryptedMessage, v6.privateKey)));
    expect(await approvedLogin(deps, fin, (u) => b.post(u, {}))).toEqual({ status: 'ok' });

    const signing = await app.inject({ method: 'GET', url: '/v1/pgp/signing-key' });
    expect(signing.body).not.toContain('a@b.c');
    expect(logs.join('\n')).not.toContain('a@b.c');
    expect(logs.join('\n')).not.toContain('-----BEGIN');
  });
});

describe('staff, owner and other mounts', () => {
  it('a staff account’s correct code alone on the staff mount → second-factor and no session (R1, Task 10)', async () => {
    const n = uniqueName('crew');
    const k = await genKey();
    const id = await seedAccount(deps, { loginName: n, kind: 'staff' });
    await insertPgpKey(deps.db, deps.config, { accountId: id, fingerprint: k.fingerprint, armored: k.publicKey, now });
    const b = new Browser();
    const s = await loginStart(b, k, {}, STAFF_MOUNT);
    const res = await loginFinish(b, s.json().challengeId, codeOf(await dec(s.json().encryptedMessage, k.privateKey)), {}, STAFF_MOUNT);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'second-factor', pendingId: expect.any(String), needs: ['pgp', 'security-key', 'passkey'] });
    expect(b.cookies[SESSION_COOKIE]).toBeUndefined();
    const { rows } = await deps.db.query('select 1 from sessions where account_id = $1', [id]);
    expect(rows).toHaveLength(0);
  });

  it('afterAuthenticate throwing stops a trader login before any session; other kinds get a decoy', async () => {
    const n = uniqueName();
    const k = await genKey();
    await registerPgp(n, k);
    const id = await accountId(n);
    const before = (await deps.db.query('select count(*)::int as n from sessions where account_id = $1', [id])).rows[0].n;
    const b = new Browser();
    const s = await b.post('/t/pgp/start', { key: k.publicKey });
    const res = await b.post('/t/pgp/finish', {
      challengeId: s.json().challengeId, code: codeOf(await dec(s.json().encryptedMessage, k.privateKey)), deviceLabel: 'x',
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'account-disabled' });
    expect(afterAuthCalls).toEqual([id]);
    expect(b.cookies[SESSION_COOKIE]).toBeUndefined();
    const after = (await deps.db.query('select count(*)::int as n from sessions where account_id = $1', [id])).rows[0].n;
    expect(after).toBe(before);

    // A staff account is not in this mount's kinds: it gets a decoy.
    const sn = uniqueName('crew');
    const sk = await genKey();
    const sid = await seedAccount(deps, { loginName: sn, kind: 'staff' });
    await insertPgpKey(deps.db, deps.config, { accountId: sid, fingerprint: sk.fingerprint, armored: sk.publicKey, now });
    const ds = await b.post('/t/pgp/start', { key: sk.publicKey });
    expect(ds.statusCode).toBe(200);
    expect(await isDecoy(ds)).toBe(true);
  });

  it('on the staff mount, with a pendingId the second step refuses the key the first factor used; a bad pendingId gets a decoy', async () => {
    const n = uniqueName('crew');
    const [ka, kb] = await Promise.all([genKey(), genKey()]);
    const id = await seedAccount(deps, { loginName: n, kind: 'staff' });
    await insertPgpKey(deps.db, deps.config, { accountId: id, fingerprint: ka.fingerprint, armored: ka.publicKey, now });
    await insertPgpKey(deps.db, deps.config, { accountId: id, fingerprint: kb.fingerprint, armored: kb.publicKey, now });
    const b = new Browser();
    await b.post('/v1/login/pgp/start', { key: (await genKey()).publicKey }); // gets the browser a device cookie
    const { createHmac } = await import('node:crypto');
    const { subkey } = await import('../src/config.js');
    const dev = createHmac('sha256', subkey(deps.config, 'device')).update(b.cookies[DEVICE_COOKIE]!).digest();
    const { rows } = await deps.db.query<{ id: string }>(
      `insert into challenges (account_id, device_hash, purpose, method, payload, created_at, expires_at)
       values ($1, $2, 'second-factor', 'pair', $3, $4, $5) returning id`,
      [id, dev, JSON.stringify({ first: { method: 'pgp', fingerprint: ka.fingerprint, fingerprints: [ka.fingerprint] } }), now, new Date(now.getTime() + 5 * MIN)],
    );
    const pendingId = rows[0]!.id;
    const s = await loginStart(b, kb, { pendingId }, STAFF_MOUNT);
    expect(s.statusCode).toBe(200);
    await dec(s.json().encryptedMessage, kb.privateKey);
    // The first factor's key again: a decoy.
    const sameKey = await loginStart(b, ka, { pendingId }, STAFF_MOUNT);
    expect(sameKey.statusCode).toBe(200);
    expect(await isDecoy(sameKey)).toBe(true);
    expect(await isDecoy(s)).toBe(false);

    // M6: finish must name the pendingId the challenge was started with.
    const code = codeOf(await dec(s.json().encryptedMessage, kb.privateKey));
    const swapped = await loginFinish(b, s.json().challengeId, code, { pendingId: '00000000-0000-4000-8000-000000000001' }, STAFF_MOUNT);
    expect(swapped.json()).toEqual({ error: 'challenge-expired' });

    // From another browser (another device) the same pendingId is a decoy.
    const other = await loginStart(new Browser(), kb, { pendingId }, STAFF_MOUNT);
    expect(await isDecoy(other)).toBe(true);
    // An unknown pendingId is a decoy.
    const unknown = await loginStart(b, kb, { pendingId: '00000000-0000-4000-8000-000000000000' }, STAFF_MOUNT);
    expect(await isDecoy(unknown)).toBe(true);
  });
});

describe('review fixes', () => {
  it('I1: made-up cookies neither evict a known browser’s challenge nor hold it; there is no per-key ceiling', async () => {
    const n = uniqueName();
    const k = await genKey();
    const a = await registerPgp(n, k); // A's device is trusted for the account
    const sa = await loginStart(a, k);
    const codeA = codeOf(await dec(sa.json().encryptedMessage, k.privateKey));
    const madeUp = () =>
      app.inject({
        method: 'POST', url: '/v1/login/pgp/start', headers: { origin: ORIGIN },
        cookies: { [DEVICE_COOKIE]: madeUpCookie() }, payload: { key: k.publicKey },
      });
    for (let i = 0; i < 12; i++) {
      setNow(new Date(now.getTime() + 1000)); // A's challenge is the oldest, the first a shared cap would evict
      expect((await madeUp()).statusCode).toBe(200);
    }
    expect((await loginFinish(a, sa.json().challengeId, codeA)).json()).toEqual({ status: 'ok' });
    // No count across devices: a fresh cookie is never refused, and A still gets challenges.
    expect((await madeUp()).statusCode).toBe(200);
    expect((await loginStart(a, k)).statusCode).toBe(200);
  });

  it('M3: a parallel burst from one device gets exactly 5 challenges, then 429; one stays open', async () => {
    const n = uniqueName();
    const mk = await genKey();
    await registerPgp(n, mk);
    const cookie = madeUpCookie();
    const res = await Promise.all(
      Array.from({ length: 8 }, () =>
        app.inject({
          method: 'POST', url: '/v1/login/pgp/start', headers: { origin: ORIGIN },
          cookies: { [DEVICE_COOKIE]: cookie }, payload: { key: mk.publicKey },
        }),
      ),
    );
    expect(res.filter((r) => r.statusCode === 200)).toHaveLength(5);
    expect(res.filter((r) => r.statusCode === 429)).toHaveLength(3);
    const after = await app.inject({
      method: 'POST', url: '/v1/login/pgp/start', headers: { origin: ORIGIN }, cookies: { [DEVICE_COOKIE]: cookie }, payload: { key: mk.publicKey },
    });
    expect(after.statusCode).toBe(429);
    const { rows } = await deps.db.query(
      `select count(*)::int as n from challenges where account_id = $1 and purpose = 'login' and used_at is null`,
      [await accountId(n)],
    );
    expect(rows[0].n).toBe(1);
  });

  it('I3: an unknown key’s decoy goes to that key, as a real login would; repeated starts look alike', async () => {
    for (const v6 of [false, true]) {
      const stranger = await genKey({ v6 });
      const known = await genKey({ v6 });
      await registerPgp(uniqueName(), known);
      const d1 = await loginStart(new Browser(), stranger);
      const d2 = await loginStart(new Browser(), stranger);
      const real = await loginStart(new Browser(), known);
      expect(await recipients(d1.json().encryptedMessage)).toEqual(await recipients(d2.json().encryptedMessage));
      expect(await recipients(d1.json().encryptedMessage)).toEqual(await recipients(real.json().encryptedMessage));
      expect(await recipients(d1.json().encryptedMessage)).toHaveLength(1);
      await dec(d1.json().encryptedMessage, stranger.privateKey, signerPublic);
    }
  });

  it('refuses a fingerprint (or anything but a whole public key) the same way for known and unknown keys', async () => {
    const k = await genKey();
    await registerPgp(uniqueName(), k);
    const stranger = await genKey();
    const answers = [];
    for (const fp of [k.fingerprint, stranger.fingerprint, `0x${k.fingerprint.toUpperCase()}`]) {
      const res = await loginStart(new Browser(), fp);
      expect(res.statusCode).toBe(400);
      answers.push(res.json());
    }
    expect(answers[0]).toMatchObject({ error: 'key-unreadable' });
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
    for (const bad of ['', 'not a key', k.privateKey]) {
      const res = await loginStart(new Browser(), bad);
      expect(res.statusCode, bad.slice(0, 20)).toBe(400);
      expect(res.json().error).toMatch(/^key-/);
    }
    expect((await new Browser().post('/v1/login/pgp/start', { username: 'someone1' })).json()).toEqual({ error: 'bad-request' });
  });

  it('the start limit is per key and device and counts decoys as real starts', async () => {
    const stranger = await genKey();
    const b = new Browser();
    for (let i = 0; i < 5; i++) expect((await loginStart(b, stranger)).statusCode).toBe(200);
    const sixth = await loginStart(b, stranger);
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json().error).toBe('slow-down');
    // Another key from the same browser is not affected.
    expect((await loginStart(b, await genKey())).statusCode).toBe(200);
    // A known key from an unknown browser counts the same way.
    const k = await genKey();
    await registerPgp(uniqueName(), k);
    const c = new Browser();
    for (let i = 0; i < 5; i++) expect((await loginStart(c, k)).statusCode).toBe(200);
    expect((await loginStart(c, k)).json()).toEqual(sixth.json());
  });

  it('a second start supersedes the first the same way for a known and an unknown key', async () => {
    const known = await genKey();
    await registerPgp(uniqueName(), known);
    const stranger = await genKey();
    const outcome = async (k: Pair) => {
      const b = new Browser();
      const first = await loginStart(b, k);
      const second = await loginStart(b, k);
      expect(second.statusCode).toBe(200);
      const res = await loginFinish(b, first.json().challengeId, 'AAAA-AAAA-AAAA');
      return { status: res.statusCode, body: res.json(), raw: res.body };
    };
    const a = await outcome(known);
    const b = await outcome(stranger);
    // Exactly the answer a wrong code on an open challenge gets (I-2a).
    expect(a).toMatchObject({ status: 401, body: { error: 'code-invalid' } });
    expect(b).toEqual(a);
    const open = await loginStart(new Browser(), stranger);
    const wrong = await loginFinish(new Browser(), open.json().challengeId, 'AAAA-AAAA-AAAA');
    expect({ status: wrong.statusCode, body: wrong.json(), raw: wrong.body }).toEqual(a);
  });

  it('I-1: PGP start costs the same queries for a known and an unknown key, with or without a device cookie', async () => {
    const known = await genKey();
    await registerPgp(uniqueName(), known);
    // Pool AND checked-out client queries (storeLoginChallenge runs in a transaction), in order.
    const spy = spySql(deps.db);
    const count = async (k: Pair, cookies: Record<string, string>, extra: Record<string, unknown> = {}) => {
      spy.clear();
      const res = await app.inject({
        method: 'POST', url: '/v1/login/pgp/start', headers: { origin: ORIGIN }, cookies, payload: { key: k.publicKey, ...extra },
      });
      expect(res.statusCode).toBe(200);
      return spy.sql();
    };
    try {
      for (const cookies of [{}, { [DEVICE_COOKIE]: madeUpCookie() }]) {
        for (const extra of [{}, { pendingId: '0b8f3a52-6f0e-4d3c-9a4e-2b7c1d5e8f90' }]) {
          const [a, b] = [await count(known, cookies, extra), await count(await genKey(), cookies, extra)];
          expect(a.length, JSON.stringify({ cookies, extra })).toBeGreaterThan(0);
          // The transaction's own statements are in the sequence compared.
          expect(a, JSON.stringify({ cookies, extra })).toContain('begin');
          expect(a.some((q) => q.includes('pg_advisory_xact_lock')), JSON.stringify({ cookies, extra })).toBe(true);
          expect(b, JSON.stringify({ cookies, extra })).toEqual(a);
        }
      }
    } finally {
      spy.restore();
    }
  });

  it('I-2b: a stranger filling their bucket on device A changes nothing for device B, known key or not', async () => {
    const known = await genKey();
    await registerPgp(uniqueName(), known);
    const stranger = await genKey();
    const outcome = async (k: Pair) => {
      const b = new Browser();
      const sb = await loginStart(b, k);
      const a = new Browser();
      for (let i = 0; i < 5; i++) {
        setNow(new Date(now.getTime() + 1000));
        expect((await loginStart(a, k)).statusCode).toBe(200);
      }
      const full = await loginStart(a, k);
      // B's challenge is still open, and B may still start.
      const { rows } = await deps.db.query('select used_at from challenges where id = $1', [sb.json().challengeId]);
      const again = await loginStart(b, k);
      return { full: [full.statusCode, full.json().error], bOpen: rows[0].used_at === null, bAgain: again.statusCode };
    };
    const a = await outcome(known);
    expect(a).toEqual({ full: [429, 'slow-down'], bOpen: true, bAgain: 200 });
    expect(await outcome(stranger)).toEqual(a);
    // And for the known key B's challenge still logs in after A's flood.
    const b = new Browser();
    const sb = await loginStart(b, known);
    const flood = new Browser();
    for (let i = 0; i < 6; i++) await loginStart(flood, known);
    const code = codeOf(await dec(sb.json().encryptedMessage, known.privateKey));
    expect(await approvedLogin(deps, await loginFinish(b, sb.json().challengeId, code), (u) => b.post(u, {}))).toEqual({ status: 'ok' });
  });

  it('M1: a challenge started on one origin cannot be finished from another', async () => {
    const b = new Browser();
    const key = await genKey();
    const start = await registerStart(b, uniqueName(), key);
    const code = codeOf(await dec(start.json().encryptedMessage, key.privateKey));
    const onion = new Browser(ONION);
    onion.cookies = { ...b.cookies };
    const fin = await onion.post('/v1/register/pgp/finish', { challengeId: start.json().challengeId, code, deviceLabel: 'x', acceptedTerms: TERMS });
    expect(fin.statusCode).toBe(400);
    expect(fin.json()).toEqual({ error: 'challenge-expired' });

    const n = uniqueName();
    const k = await genKey();
    await registerPgp(n, k);
    const s = await loginStart(b, k);
    const c = codeOf(await dec(s.json().encryptedMessage, k.privateKey));
    onion.cookies = { ...b.cookies };
    // A login challenge answers every refusal like a wrong code (I-2a).
    expect((await loginFinish(onion, s.json().challengeId, c)).json()).toEqual({ error: 'code-invalid' });
  });
});

describe('logs', () => {
  it('no log line holds a key, a message or a code', () => {
    const all = logs.join('\n');
    expect(all).not.toContain('PGP');
    expect(all).not.toMatch(/[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}/);
  });
});
