import { randomBytes } from 'node:crypto';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import * as openpgp from 'openpgp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { DEVICE_COOKIE } from '../src/auth/device.js';
import { decoyPrivateKeys, insertPgpKey, loadPgpSigner, openKey, pgpLoginRoutes } from '../src/auth/pgp.js';
import { SESSION_COOKIE } from '../src/auth/sessions.js';
import { ApiError } from '../src/errors.js';
import { confirmTokenMethod, seedAccount } from './helpers/accounts.js';
import { testApp, testConfig, testSigner } from './helpers/app.js';
import { inspectPublicKey } from '@x2f/accounts';
import { codeOf, decrypt, genKey, KEY_DATE, resign, type Pair } from './helpers/pgpKeys.js';

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

async function registerStart(b: Browser, username: string, key: Pair) {
  return b.post('/v1/register/pgp/start', { username, publicKey: key.publicKey });
}

/** Registers `username` with `key` in browser `b` (or a new one); returns the browser. */
async function registerPgp(username: string, key: Pair, b = new Browser()): Promise<Browser> {
  const start = await registerStart(b, username, key);
  expect(start.statusCode).toBe(200);
  const code = codeOf(await dec(start.json().encryptedMessage, key.privateKey));
  const fin = await b.post('/v1/register/pgp/finish', {
    challengeId: start.json().challengeId, code, deviceLabel: 'Test browser', acceptedTerms: TERMS,
  });
  expect(fin.statusCode).toBe(201);
  return b;
}

async function loginStart(b: Browser, username: string, extra: Record<string, unknown> = {}) {
  return b.post('/v1/login/pgp/start', { username, ...extra });
}

async function loginFinish(b: Browser, challengeId: string, code: string, extra: Record<string, unknown> = {}) {
  return b.post('/v1/login/pgp/finish', { challengeId, code, deviceLabel: 'Test browser', ...extra });
}

async function accountId(username: string): Promise<string> {
  const { rows } = await deps.db.query<{ id: string }>('select id from accounts where username_key = $1', [username.toLowerCase()]);
  return rows[0]!.id;
}

/** Decrypts a decoy with whichever pool key it went to. */
async function decDecoy(message: string, signer?: string): Promise<string> {
  for (const k of await decoyPrivateKeys()) {
    try {
      return await dec(message, k.armor(), signer);
    } catch {
      // another pool key
    }
  }
  throw new Error('not a decoy');
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
    expect(fin.json()).toEqual({ username: name });
    expect(b.cookies[SESSION_COOKIE]).toBeTruthy();
    const { rows } = await deps.db.query('select terms_version from accounts where username_key = $1', [name.toLowerCase()]);
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
    const res = await new Browser().post('/v1/register/pgp/start', { username: uniqueName(), publicKey: ed.privateKey });
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
    const res = await new Browser().post('/v1/register/pgp/start', { username: uniqueName(), publicKey: 'x'.repeat(40 * 1024) });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('key-too-large');
  });

  it('checks the username at start', async () => {
    const name = uniqueName();
    await registerPgp(name, await genKey());
    const taken = await registerStart(new Browser(), name.toUpperCase(), ed);
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error).toBe('username-taken');
    const reserved = await registerStart(new Browser(), 'X2F.Support', ed);
    expect(reserved.json().error).toBe('username-reserved');
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
    const { rows } = await deps.db.query('select 1 from accounts where username_key = $1', [name.toLowerCase()]);
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
    const s1 = await loginStart(b, name);
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
    const again = await loginFinish(b, s1.json().challengeId, code);
    expect(again.json()).toEqual({ error: 'challenge-expired' });

    setNow(new Date(t.getTime() + HOUR));
    const s2 = await loginStart(home, name);
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
      const s = await loginStart(b, name);
      expect(s.statusCode).toBe(200);
      const res = await loginFinish(b, s.json().challengeId, 'AAAA-AAAA-AAAA');
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'code-invalid' });
    }
    setNow(new Date(now.getTime() + 61_000));
    const s = await loginStart(b, name);
    const res = await loginFinish(b, s.json().challengeId, codeOf(await dec(s.json().encryptedMessage, key.privateKey)));
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('challenge DoS: an anonymous browser cannot push out a known browser’s challenge, and is slowed after 5', async () => {
    const a = home;
    const sa = await loginStart(a, name);
    const codeA = codeOf(await dec(sa.json().encryptedMessage, key.privateKey));
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({ method: 'POST', url: '/v1/login/pgp/start', headers: { origin: ORIGIN }, payload: { username: name } });
      expect(res.statusCode).toBe(200);
    }
    const fin = await loginFinish(a, sa.json().challengeId, codeA);
    expect(fin.json()).toEqual({ status: 'ok' });
    const sixth = await app.inject({ method: 'POST', url: '/v1/login/pgp/start', headers: { origin: ORIGIN }, payload: { username: name } });
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json().error).toBe('slow-down');

    // A's second start invalidates A's first.
    const a1 = await loginStart(a, name);
    const a2 = await loginStart(a, name);
    const c1 = codeOf(await dec(a1.json().encryptedMessage, key.privateKey));
    const c2 = codeOf(await dec(a2.json().encryptedMessage, key.privateKey));
    expect((await loginFinish(a, a1.json().challengeId, c1)).json()).toEqual({ error: 'challenge-expired' });
    expect((await loginFinish(a, a2.json().challengeId, c2)).json()).toEqual({ status: 'ok' });
  });

  it('two parallel finishes with the right code: one session, one challenge-expired', async () => {
    const b = new Browser();
    const s = await loginStart(b, name);
    const code = codeOf(await dec(s.json().encryptedMessage, key.privateKey));
    const [r1, r2] = await Promise.all([loginFinish(b, s.json().challengeId, code), loginFinish(b, s.json().challengeId, code)]);
    expect([r1.statusCode, r2.statusCode].sort()).toEqual([200, 400]);
    expect([r1.json(), r2.json()]).toContainEqual({ error: 'challenge-expired' });
  });

  it('same shape for unknown, password-only and real usernames; the decoy code never works', async () => {
    const pwOnly = uniqueName();
    await seedAccount(deps, { username: pwOnly });
    const shapes: string[][] = [];
    let decoy: LightMyRequestResponse | undefined;
    for (const u of ['nobody-here', pwOnly, name]) {
      const res = await loginStart(new Browser(), u);
      expect(res.statusCode).toBe(200);
      shapes.push(Object.keys(res.json()).sort());
      if (u === 'nobody-here') decoy = res;
    }
    expect(shapes[0]).toEqual(['challengeId', 'encryptedMessage', 'expiresAt']);
    expect(shapes[1]).toEqual(shapes[0]);
    expect(shapes[2]).toEqual(shapes[0]);
    const decoyText = await decDecoy(decoy!.json().encryptedMessage, signerPublic);
    for (const id of await pkeskIDs(decoy!.json().encryptedMessage)) expect(id.isWildcard()).toBe(true);
    const res = await loginFinish(new Browser(), decoy!.json().challengeId, codeOf(decoyText));
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'code-invalid' });
  });

  it('a disabled account with the right code → account-disabled, no session', async () => {
    const n = uniqueName();
    const k = await genKey();
    await registerPgp(n, k);
    await deps.db.query('update accounts set disabled_at = $2 where username_key = $1', [n.toLowerCase(), now]);
    const b = new Browser();
    const s = await loginStart(b, n);
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
    const expired = await loginStart(b, n);
    expect(expired.statusCode).toBe(400);
    expect(expired.json()).toEqual({ error: 'key-expired' });

    const refreshed = await resign(k, new Date(now.getTime() - HOUR), 365 * 86_400);
    const s = await loginStart(b, n, { refreshedKey: refreshed.publicKey });
    expect(s.statusCode).toBe(200);
    const code = codeOf(await dec(s.json().encryptedMessage, refreshed.privateKey));
    const fin = await loginFinish(b, s.json().challengeId, code);
    expect(fin.json()).toEqual({ status: 'ok' });
    const { rows } = await deps.db.query<{ armored_enc: Buffer; fingerprint: string }>(
      'select armored_enc, fingerprint from pgp_keys where account_id = $1', [await accountId(n)],
    );
    const storedNow = await inspectPublicKey(openKey(deps.config, rows[0]!.armored_enc, rows[0]!.fingerprint), now);
    expect(storedNow.ok).toBe(true);
    // The next login needs no refresh.
    expect((await loginStart(b, n)).statusCode).toBe(200);
  });

  it('a refreshedKey with another fingerprint gets a decoy encrypted to that key, whose code never works', async () => {
    const n = uniqueName();
    const k = await genKey();
    await registerPgp(n, k);
    const other = await genKey();
    for (const u of [n, 'nobody-at-all']) {
      const b = new Browser();
      const s = await loginStart(b, u, { refreshedKey: other.publicKey });
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
    const s0 = await loginStart(new Browser(), n);
    await dec(s0.json().encryptedMessage, s2Only);

    // The owner revokes S2 and refreshes the server's copy with the revocation.
    const revokedS2 = await priv.subkeys[1]!.revoke(priv.keyPacket as openpgp.SecretKeyPacket, {}, new Date(now.getTime() - MIN));
    const revokedKey = await openpgp.readPrivateKey({ armoredKey: k.privateKey });
    revokedKey.subkeys[1] = revokedS2;
    const b = new Browser();
    const s1 = await loginStart(b, n, { refreshedKey: revokedKey.toPublic().armor() });
    expect(s1.statusCode).toBe(200);
    await expect(dec(s1.json().encryptedMessage, s2Only)).rejects.toThrow();
    const c1 = codeOf(await dec(s1.json().encryptedMessage, k.privateKey));
    expect((await loginFinish(b, s1.json().challengeId, c1)).json()).toEqual({ status: 'ok' });

    // Someone sends the old public copy (no revocation) as a refresh: S2 stays revoked.
    const s2 = await loginStart(new Browser(), n, { refreshedKey: k.publicKey });
    expect(s2.statusCode).toBe(200);
    await expect(dec(s2.json().encryptedMessage, s2Only)).rejects.toThrow();
    const b2 = new Browser();
    const s3 = await loginStart(b2, n, { refreshedKey: k.publicKey });
    const c3 = codeOf(await dec(s3.json().encryptedMessage, k.privateKey));
    expect((await loginFinish(b2, s3.json().challengeId, c3)).json()).toEqual({ status: 'ok' });
    const { rows } = await deps.db.query<{ armored_enc: Buffer; fingerprint: string }>(
      'select armored_enc, fingerprint from pgp_keys where account_id = $1', [await accountId(n)],
    );
    const stored = await openpgp.readKey({ armoredKey: openKey(deps.config, rows[0]!.armored_enc, rows[0]!.fingerprint) });
    const enc = await stored.getEncryptionKey(undefined, now);
    expect(enc.getKeyID().equals(stored.subkeys[1]!.getKeyID())).toBe(false);
    const s4 = await loginStart(new Browser(), n);
    await expect(dec(s4.json().encryptedMessage, s2Only)).rejects.toThrow();
  });

  it('a key whose only encryption subkey expired (primary still valid) → key-expired, no fallback', async () => {
    const n = uniqueName();
    const k = await genKey({ date: new Date(now.getTime() - 2 * DAY), subkeys: [{ keyExpirationTime: 3 * 86_400 }] });
    await registerPgp(n, k);
    setNow(new Date(now.getTime() + 2 * DAY));
    const res = await loginStart(new Browser(), n);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'key-expired' });
  });

  it('a revoked key → key-revoked with nothing else', async () => {
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
    const res = await loginStart(new Browser(), n);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'key-revoked' });
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

  // Each test starts a day later, past the 12-hour logout timer: log home in afresh.
  beforeEach(async () => {
    home = new Browser();
    const s = await loginStart(home, name);
    await loginFinish(home, s.json().challengeId, codeOf(await dec(s.json().encryptedMessage, key.privateKey)));
  });

  it('a login code is refused by the confirm and register finishes', async () => {
    setNow(new Date(now.getTime() + HOUR));
    const s = await loginStart(home, name);
    const code = codeOf(await dec(s.json().encryptedMessage, key.privateKey));
    const c = await home.post('/v1/confirm/pgp/finish', { challengeId: s.json().challengeId, code });
    expect(c.json()).toEqual({ error: 'challenge-expired' });
    const s2 = await loginStart(home, name);
    const code2 = codeOf(await dec(s2.json().encryptedMessage, key.privateKey));
    const r = await home.post('/v1/register/pgp/finish', { challengeId: s2.json().challengeId, code: code2, deviceLabel: 'x', acceptedTerms: TERMS });
    expect(r.json()).toEqual({ error: 'challenge-expired' });
  });

  it('a confirm challenge of session A cannot be finished by session B, nor after A logs out', async () => {
    setNow(new Date(now.getTime() + HOUR));
    const a = home;
    const b = new Browser();
    const sb = await loginStart(b, name);
    await loginFinish(b, sb.json().challengeId, codeOf(await dec(sb.json().encryptedMessage, key.privateKey)));

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
    const s = await loginStart(a, name);
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

    const as = await b.post('/v1/account/pgp/start', { publicKey: k2.publicKey, confirmToken });
    expect(as.statusCode).toBe(200);
    const atext = await dec(as.json().encryptedMessage, k2.privateKey, signerPublic);
    expect(atext).toContain('Purpose: add this PGP key to your account');
    const af = await b.post('/v1/account/pgp/finish', { challengeId: as.json().challengeId, code: codeOf(atext) });
    expect(af.statusCode).toBe(200);

    const id = await accountId(n);
    const { rows } = await deps.db.query(`select detail from alerts where account_id = $1 and kind = 'login-method-added'`, [id]);
    expect(rows).toEqual([{ detail: { method: 'pgp', fingerprint: k2.fingerprint } }]);

    const s = await loginStart(new Browser(), n);
    const t1 = await dec(s.json().encryptedMessage, k1.privateKey);
    const t2 = await dec(s.json().encryptedMessage, k2.privateKey);
    expect(t1).toBe(t2);
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
    const s = await loginStart(b, n6);
    const fin = await loginFinish(b, s.json().challengeId, codeOf(await dec(s.json().encryptedMessage, v6.privateKey)));
    expect(fin.json()).toEqual({ status: 'ok' });

    const signing = await app.inject({ method: 'GET', url: '/v1/pgp/signing-key' });
    expect(signing.body).not.toContain('a@b.c');
    expect(logs.join('\n')).not.toContain('a@b.c');
    expect(logs.join('\n')).not.toContain('-----BEGIN');
  });
});

describe('staff, owner and other mounts', () => {
  it('a staff account’s correct code alone → second-factor and no session (R1, Task 10)', async () => {
    const n = uniqueName('crew');
    const k = await genKey();
    const id = await seedAccount(deps, { username: n, kind: 'staff' });
    await insertPgpKey(deps.db, deps.config, { accountId: id, fingerprint: k.fingerprint, armored: k.publicKey, now });
    const b = new Browser();
    const s = await loginStart(b, n);
    const res = await loginFinish(b, s.json().challengeId, codeOf(await dec(s.json().encryptedMessage, k.privateKey)));
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
    const s = await b.post('/t/pgp/start', { username: n });
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
    const sid = await seedAccount(deps, { username: sn, kind: 'staff' });
    await insertPgpKey(deps.db, deps.config, { accountId: sid, fingerprint: sk.fingerprint, armored: sk.publicKey, now });
    const ds = await b.post('/t/pgp/start', { username: sn });
    expect(ds.statusCode).toBe(200);
    await expect(dec(ds.json().encryptedMessage, sk.privateKey)).rejects.toThrow();
  });

  it('with a pendingId the second step leaves out the key the first factor used; a bad pendingId gets a decoy', async () => {
    const n = uniqueName('crew');
    const [ka, kb] = await Promise.all([genKey(), genKey()]);
    const id = await seedAccount(deps, { username: n, kind: 'staff' });
    await insertPgpKey(deps.db, deps.config, { accountId: id, fingerprint: ka.fingerprint, armored: ka.publicKey, now });
    await insertPgpKey(deps.db, deps.config, { accountId: id, fingerprint: kb.fingerprint, armored: kb.publicKey, now });
    const b = new Browser();
    await b.post('/v1/login/pgp/start', { username: 'nobody-here' }); // gets the browser a device cookie
    const { createHmac } = await import('node:crypto');
    const { subkey } = await import('../src/config.js');
    const dev = createHmac('sha256', subkey(deps.config, 'device')).update(b.cookies[DEVICE_COOKIE]!).digest();
    const { rows } = await deps.db.query<{ id: string }>(
      `insert into challenges (account_id, device_hash, purpose, method, payload, created_at, expires_at)
       values ($1, $2, 'second-factor', 'pair', $3, $4, $5) returning id`,
      [id, dev, JSON.stringify({ first: { method: 'pgp', fingerprint: ka.fingerprint, fingerprints: [ka.fingerprint] } }), now, new Date(now.getTime() + 5 * MIN)],
    );
    const pendingId = rows[0]!.id;
    const s = await loginStart(b, n, { pendingId });
    expect(s.statusCode).toBe(200);
    await dec(s.json().encryptedMessage, kb.privateKey);
    await expect(dec(s.json().encryptedMessage, ka.privateKey)).rejects.toThrow();

    // M6: finish must name the pendingId the challenge was started with.
    const code = codeOf(await dec(s.json().encryptedMessage, kb.privateKey));
    const swapped = await loginFinish(b, s.json().challengeId, code, { pendingId: '00000000-0000-4000-8000-000000000001' });
    expect(swapped.json()).toEqual({ error: 'challenge-expired' });

    // From another browser (another device) the same pendingId is a decoy.
    const other = await loginStart(new Browser(), n, { pendingId });
    await expect(dec(other.json().encryptedMessage, kb.privateKey)).rejects.toThrow();
    // An unknown pendingId is a decoy.
    const unknown = await loginStart(b, n, { pendingId: '00000000-0000-4000-8000-000000000000' });
    await expect(dec(unknown.json().encryptedMessage, kb.privateKey)).rejects.toThrow();
  });
});

describe('review fixes', () => {
  it('I1: made-up cookies neither evict a trusted browser’s challenge nor dodge the start limit', async () => {
    const n = uniqueName();
    const k = await genKey();
    const a = await registerPgp(n, k); // A's device is trusted for the account
    const sa = await loginStart(a, n);
    const codeA = codeOf(await dec(sa.json().encryptedMessage, k.privateKey));
    for (let i = 0; i < 5; i++) {
      setNow(new Date(now.getTime() + 1000)); // A's challenge is the oldest, the first a cap would evict
      const res = await app.inject({
        method: 'POST', url: '/v1/login/pgp/start', headers: { origin: ORIGIN },
        cookies: { [DEVICE_COOKIE]: madeUpCookie() }, payload: { username: n },
      });
      expect(res.statusCode).toBe(200);
    }
    const id = await accountId(n);
    const open = await deps.db.query(
      `select count(*)::int as n from challenges where account_id = $1 and purpose = 'login' and used_at is null and payload->>'startGroup' = 'anon'`,
      [id],
    );
    expect(open.rows[0].n).toBeLessThanOrEqual(3);
    expect((await loginFinish(a, sa.json().challengeId, codeA)).json()).toEqual({ status: 'ok' });
    const sixth = await app.inject({
      method: 'POST', url: '/v1/login/pgp/start', headers: { origin: ORIGIN },
      cookies: { [DEVICE_COOKIE]: madeUpCookie() }, payload: { username: n },
    });
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json().error).toBe('slow-down');
    // The trusted browser is in its own group and still gets challenges.
    expect((await loginStart(a, n)).statusCode).toBe(200);
  });

  it('M3: concurrent untrusted starts leave at most 3 open challenges', async () => {
    const n = uniqueName();
    await registerPgp(n, await genKey());
    const res = await Promise.all(
      Array.from({ length: 5 }, () =>
        app.inject({
          method: 'POST', url: '/v1/login/pgp/start', headers: { origin: ORIGIN },
          cookies: { [DEVICE_COOKIE]: madeUpCookie() }, payload: { username: n },
        }),
      ),
    );
    for (const r of res) expect(r.statusCode).toBe(200);
    const { rows } = await deps.db.query(
      `select count(*)::int as n from challenges where account_id = $1 and purpose = 'login' and used_at is null`,
      [await accountId(n)],
    );
    expect(rows[0].n).toBeLessThanOrEqual(3);
  });

  it('I3: an unknown username’s decoy profile is stable across calls, and the pool varies across names', async () => {
    const profiles = new Set<string>();
    for (let i = 0; i < 24; i++) {
      const u = `ghost${i.toString().padStart(3, '0')}`;
      const r1 = await loginStart(new Browser(), u);
      const r2 = await loginStart(new Browser(), u);
      const p1 = await recipients(r1.json().encryptedMessage);
      const p2 = await recipients(r2.json().encryptedMessage);
      expect(p2).toEqual(p1);
      expect(p1.length === 1 || p1.length === 2).toBe(true);
      await decDecoy(r1.json().encryptedMessage, signerPublic);
      profiles.add(p1.join(','));
    }
    expect(profiles.size).toBeGreaterThanOrEqual(3);
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
    const s = await loginStart(b, n);
    const c = codeOf(await dec(s.json().encryptedMessage, k.privateKey));
    onion.cookies = { ...b.cookies };
    expect((await loginFinish(onion, s.json().challengeId, c)).json()).toEqual({ error: 'challenge-expired' });
  });
});

describe('logs', () => {
  it('no log line holds a key, a message or a code', () => {
    const all = logs.join('\n');
    expect(all).not.toContain('PGP');
    expect(all).not.toMatch(/[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}/);
  });
});
