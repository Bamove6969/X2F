// Plan 5 Task 10: past reputation claims proven by a PGP signature (spec 5.5; P5-A20 to P5-A24).
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAST_REP_VERIFY_CONFIG, STRICT_CONFIG, inspectPublicKey } from '@x2f/accounts';
import type { FastifyInstance } from 'fastify';
import * as openpgp from 'openpgp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deps } from '../src/app.js';
import { openKey } from '../src/auth/pgp.js';
import { LIVE_SESSION_EXEMPT, LIVE_SESSION_ROUTES } from '../src/auth/hold.js';
import { PAST_REP_ARCHIVE_HOSTS, PAST_REP_SITES, pastRepChallenge } from '../src/pastrep/challenge.js';
import { PAST_REP_KEY_AAD } from '../src/pastrep/routes.js';
import { verifyPastRepSignature } from '../src/pastrep/verify.js';
import { seedAccount } from './helpers/accounts.js';
import { testApp } from './helpers/app.js';
import { KEY_DATE } from './helpers/pgpKeys.js';
import { Browser, addTestLogin } from './helpers/totp.js';

const T0 = new Date('2026-11-01T12:00:00Z');
const URL_OK = 'https://web.archive.org/web/2023/https://localmonero.co/user/olduser';
const SRC = fileURLToPath(new URL('../src/', import.meta.url));

type Pair = { publicKey: string; privateKey: string; fingerprint: string };

async function gen(o: Partial<Parameters<typeof openpgp.generateKey>[0]> = {}): Promise<Pair> {
  const kind = o.type === undefined ? { type: 'ecc' as const, curve: 'ed25519Legacy' as const } : {};
  const k = await openpgp.generateKey({ ...kind, userIDs: [{ name: 'Old Trader' }], date: KEY_DATE, ...o, format: 'armored' });
  return { publicKey: k.publicKey, privateKey: k.privateKey, fingerprint: (await openpgp.readKey({ armoredKey: k.publicKey })).getFingerprint() };
}

const priv = (p: Pair) => openpgp.readPrivateKey({ armoredKey: p.privateKey });

async function clearsign(text: string, signers: Pair | Pair[], date = T0): Promise<string> {
  const signingKeys = await Promise.all([signers].flat().map(priv));
  return openpgp.sign({ message: await openpgp.createCleartextMessage({ text }), signingKeys, date, config: PAST_REP_VERIFY_CONFIG });
}

async function detach(text: string, signer: Pair, date = T0): Promise<string> {
  return openpgp.sign({ message: await openpgp.createMessage({ text }), signingKeys: await priv(signer), detached: true, date, config: PAST_REP_VERIFY_CONFIG }) as Promise<string>;
}

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let logs: string[];
let ed: Pair;
let other: Pair;
let rsa2048: Pair;
let rsa1024: Pair;
let n = 0;

async function login(display?: string): Promise<{ b: Browser; id: string; name: string }> {
  n += 1;
  const name = display ?? `Trader${String(n).padStart(3, '0')}`;
  const id = await seedAccount(deps, { loginName: `login${n}x`, displayName: name });
  const b = new Browser(app);
  expect((await b.post('/t/login', { accountId: id })).statusCode).toBe(200);
  return { b, id, name };
}

const startBody = (key: Pair, o: Partial<{ site: string; url: string; claimedTrades: number }> = {}) => ({
  site: 'LocalMonero', url: URL_OK, claimedTrades: 1240, publicKey: key.publicKey, ...o,
});

async function start(b: Browser, key: Pair, o: Partial<{ site: string; url: string; claimedTrades: number }> = {}) {
  const res = await b.post('/v1/account/past-rep/start', startBody(key, o));
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { challengeId: string; text: string; expiresAt: string };
}

const rows = async () => (await deps.db.query<Record<string, unknown>>('select * from past_reputation order by created_at')).rows;

beforeAll(async () => {
  ({ app, deps, setNow, logs } = await testApp());
  addTestLogin(app, deps);
  [ed, other, rsa2048, rsa1024] = await Promise.all([
    gen(),
    gen(),
    gen({ type: 'rsa', rsaBits: 2048 }),
    gen({ type: 'rsa', rsaBits: 1024, config: { minRSABits: 1024 } }),
  ]);
}, 600_000);
afterAll(async () => app.close());
beforeEach(async () => {
  setNow(T0);
  await deps.db.query('delete from past_reputation');
});

describe('pastRepChallenge', () => {
  it('is the exact eight lines, the fingerprint uppercase in groups of 4', () => {
    const text = pastRepChallenge({
      origin: 'https://x2f.test', displayName: 'Old.Trader', site: 'LocalMonero', url: URL_OK,
      fingerprint: 'abcdef0123456789abcdef0123456789abcdef01', nonce: '0123456789ABCDEF', issuedAt: T0,
    });
    expect(text).toBe(
      [
        'X2F past reputation proof',
        'Site: https://x2f.test',
        'X2F name: Old.Trader',
        'Old site: LocalMonero',
        `Old profile: ${URL_OK}`,
        'Key: ABCD EF01 2345 6789 ABCD EF01 2345 6789 ABCD EF01',
        'Nonce: 0123456789ABCDEF',
        'Issued: 2026-11-01T12:00:00Z',
      ].join('\n'),
    );
  });

  it('the sites and archive hosts are the plan\'s lists', () => {
    expect(PAST_REP_SITES).toEqual(['LocalMonero', 'AgoraDesk', 'LocalBitcoins', 'Paxful', 'Hodl Hodl', 'Bisq', 'Other']);
    expect(PAST_REP_ARCHIVE_HOSTS).toEqual(['web.archive.org', 'archive.ph', 'archive.today', 'archive.is']);
  });
});

describe('start and finish', () => {
  it('an Ed25519 key signs the issued text (cleartext) → signed; nothing is stored before finish', async () => {
    const { b, id, name } = await login();
    const c = await start(b, ed);
    expect(c.text).toContain(`X2F name: ${name}`);
    expect(c.text).toMatch(/^Nonce: [0-9A-HJKMNP-TV-Z]{16}$/m);
    expect(c.text).toContain('Site: https://x2f.test');
    expect(new Date(c.expiresAt).getTime()).toBe(T0.getTime() + 60 * 60_000);
    expect(await rows()).toEqual([]);
    const res = await b.post('/v1/account/past-rep/finish', { challengeId: c.challengeId, signed: await clearsign(c.text, ed) });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toEqual({ id: expect.any(String), status: 'signed' });
    expect(await rows()).toMatchObject([
      { account_id: id, site: 'LocalMonero', evidence_url: URL_OK, claimed_trades: 1240, fingerprint: ed.fingerprint, status: 'signed', challenge_text: c.text },
    ]);
    const list = await b.get('/v1/account/past-rep');
    expect(list.json()).toEqual([
      { id: res.json().id, site: 'LocalMonero', url: URL_OK, claimedTrades: 1240, verifiedTrades: null, status: 'signed', reason: null },
    ]);
  });

  it('a detached signature also works', async () => {
    const { b } = await login();
    const c = await start(b, ed);
    const res = await b.post('/v1/account/past-rep/finish', { challengeId: c.challengeId, signed: await detach(c.text, ed) });
    expect(res.statusCode, res.body).toBe(201);
  });

  it('the text with a different nonce, display name or site → wrong-text', async () => {
    const { b } = await login();
    const c = await start(b, ed);
    for (const changed of [
      c.text.replace(/^Nonce: .*$/m, 'Nonce: 0000000000000000'),
      c.text.replace(/^X2F name: .*$/m, 'X2F name: Someone.Else'),
      c.text.replace(/^Site: .*$/m, 'Site: https://evil.example'),
    ]) {
      const res = await b.post('/v1/account/past-rep/finish', { challengeId: c.challengeId, signed: await clearsign(changed, ed) });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'wrong-text' });
    }
    expect(await rows()).toEqual([]);
  });

  it('a valid signature by another key → wrong-key', async () => {
    const { b } = await login();
    const c = await start(b, ed);
    const res = await b.post('/v1/account/past-rep/finish', { challengeId: c.challengeId, signed: await clearsign(c.text, other) });
    expect(res.json()).toMatchObject({ error: 'wrong-key' });
  });

  it('a signature by a signing subkey of the claimed key passes', async () => {
    const withSub = await gen({ subkeys: [{}, { sign: true }] });
    const { b } = await login();
    const c = await start(b, withSub);
    const signed = await clearsign(c.text, withSub);
    const sig = (await openpgp.readCleartextMessage({ cleartextMessage: signed })) as unknown as { signature: openpgp.Signature };
    const primary = await openpgp.readKey({ armoredKey: withSub.publicKey });
    expect(sig.signature.getSigningKeyIDs()[0]!.equals(primary.getKeyID())).toBe(false);
    const res = await b.post('/v1/account/past-rep/finish', { challengeId: c.challengeId, signed });
    expect(res.statusCode, res.body).toBe(201);
  });

  it("a signature carrying a Signer's User ID (an email) → bad-signature, nothing stored (R16; lead question)", async () => {
    const { b } = await login();
    const c = await start(b, ed);
    const original = openpgp.SignaturePacket.prototype.sign;
    const spy = vi.spyOn(openpgp.SignaturePacket.prototype, 'sign').mockImplementation(function (this: openpgp.SignaturePacket, ...args) {
      this.signersUserID = 'Old Trader <old@example.org>';
      return original.apply(this, args);
    });
    let signed: string;
    try {
      signed = await clearsign(c.text, ed);
    } finally {
      spy.mockRestore();
    }
    const parsed = (await openpgp.readCleartextMessage({ cleartextMessage: signed })) as unknown as { signature: openpgp.Signature };
    expect((parsed.signature.packets[0] as openpgp.SignaturePacket).signersUserID).toBe('Old Trader <old@example.org>');
    const res = await b.post('/v1/account/past-rep/finish', { challengeId: c.challengeId, signed });
    expect(res.json()).toMatchObject({ error: 'bad-signature' });
    expect(await rows()).toEqual([]);
  });

  it('a garbled paste → bad-signature', async () => {
    const { b } = await login();
    const c = await start(b, ed);
    const res = await b.post('/v1/account/past-rep/finish', { challengeId: c.challengeId, signed: 'not a signature' });
    expect(res.json()).toMatchObject({ error: 'bad-signature' });
  });
});

describe('keys (P5-A22)', () => {
  it('RSA 2048 accepted here, RSA 1024 refused key-weak', async () => {
    const { b } = await login();
    const c = await start(b, rsa2048);
    expect((await b.post('/v1/account/past-rep/finish', { challengeId: c.challengeId, signed: await clearsign(c.text, rsa2048) })).statusCode).toBe(201);
    const weak = await b.post('/v1/account/past-rep/start', startBody(rsa1024, { site: 'Paxful' }));
    expect(weak.statusCode).toBe(400);
    expect(weak.json()).toMatchObject({ error: 'key-weak' });
  });

  it('a signing-only Ed25519 key accepted here; RSA 2048 and a signing-only key still refused by login defaults', async () => {
    const signOnly = await gen({ subkeys: [] });
    const { b } = await login();
    const c = await start(b, signOnly);
    expect((await b.post('/v1/account/past-rep/finish', { challengeId: c.challengeId, signed: await clearsign(c.text, signOnly) })).statusCode).toBe(201);
    expect(await inspectPublicKey(rsa2048.publicKey, T0)).toMatchObject({ ok: false, reason: 'key-weak' });
    expect(await inspectPublicKey(signOnly.publicKey, T0)).toMatchObject({ ok: false, reason: 'key-no-encryption' });
  });

  it('a revoked key → key-revoked; an expired key → key-expired; the same key re-signed to a later expiry passes', async () => {
    const { b } = await login();
    const base = await gen();
    const revoked = await openpgp.revokeKey({ key: await priv(base), format: 'armored', date: KEY_DATE });
    const r1 = await b.post('/v1/account/past-rep/start', startBody({ ...base, publicKey: revoked.publicKey }));
    expect(r1.json()).toMatchObject({ error: 'key-revoked' });

    const expiring = await gen({ keyExpirationTime: 86_400 });
    const r2 = await b.post('/v1/account/past-rep/start', startBody(expiring));
    expect(r2.json()).toMatchObject({ error: 'key-expired' });
    const later = await openpgp.reformatKey({
      privateKey: await priv(expiring), userIDs: [{ name: 'Old Trader' }], date: new Date(T0.getTime() - 86_400_000), keyExpirationTime: 365 * 86_400, format: 'armored',
    });
    const extended: Pair = { publicKey: later.publicKey, privateKey: later.privateKey, fingerprint: expiring.fingerprint };
    const c = await start(b, extended);
    expect((await b.post('/v1/account/past-rep/finish', { challengeId: c.challengeId, signed: await clearsign(c.text, extended) })).statusCode).toBe(201);
  });

  it('an RSA 2048 signature verifies under PAST_REP_VERIFY_CONFIG and fails under Plan 2\'s STRICT_CONFIG', async () => {
    const text = 'X2F past reputation proof';
    const signed = await clearsign(text, rsa2048);
    const verificationKeys = await openpgp.readKey({ armoredKey: rsa2048.publicKey });
    const check = async (config: openpgp.Config) => {
      const message = await openpgp.readCleartextMessage({ cleartextMessage: signed });
      const r = await openpgp.verify({ message, verificationKeys, expectSigned: true, date: T0, config });
      await Promise.all(r.signatures.map((s) => s.verified));
    };
    await expect(check(PAST_REP_VERIFY_CONFIG)).resolves.toBeUndefined();
    await expect(check(STRICT_CONFIG)).rejects.toThrow();
  });
});

describe('evidence links (P5-A20)', () => {
  it('refuses anything but https on an archive host, with no userinfo or port', async () => {
    const { b } = await login();
    for (const url of [
      'http://web.archive.org/web/2023/https://localmonero.co/user/x',
      'https://evil.example/web/2023',
      'https://user@web.archive.org/web/2023',
      'https://web.archive.org:8443/web/2023',
      'https://web.archive.org./web/2023',
      'https://web.archive.org.evil.example/web/2023',
      'https://evil.example\\@web.archive.org/web/2023',
      'not a url',
    ]) {
      const res = await b.post('/v1/account/past-rep/start', startBody(ed, { url }));
      expect(res.statusCode, url).toBe(400);
      expect(res.json(), url).toMatchObject({ error: 'bad-url' });
    }
    for (const url of ['https://archive.ph/AbCd1', 'https://ARCHIVE.today/AbCd1', 'https://archive.is/AbCd1']) {
      expect((await b.post('/v1/account/past-rep/start', startBody(ed, { url }))).statusCode, url).toBe(200);
    }
  });

  it('an unknown site → bad-site', async () => {
    const { b } = await login();
    const res = await b.post('/v1/account/past-rep/start', startBody(ed, { site: 'Craigslist' }));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'bad-site' });
  });

  it('a site with a signed or approved claim → 409 site-claimed', async () => {
    const { b } = await login();
    const c = await start(b, ed);
    expect((await b.post('/v1/account/past-rep/finish', { challengeId: c.challengeId, signed: await clearsign(c.text, ed) })).statusCode).toBe(201);
    const again = await b.post('/v1/account/past-rep/start', startBody(other));
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: 'site-claimed' });
  });
});

describe('replay and binding', () => {
  it("account B finishing account A's challenge with A's valid signature → challenge-expired, no row", async () => {
    const a = await login();
    const bAcc = await login();
    const c = await start(a.b, ed);
    const res = await bAcc.b.post('/v1/account/past-rep/finish', { challengeId: c.challengeId, signed: await clearsign(c.text, ed) });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'challenge-expired' });
    expect(await rows()).toEqual([]);
  });

  it('a second finish of a used challenge → challenge-used', async () => {
    const { b } = await login();
    const c = await start(b, ed);
    const signed = await clearsign(c.text, ed);
    expect((await b.post('/v1/account/past-rep/finish', { challengeId: c.challengeId, signed })).statusCode).toBe(201);
    const again = await b.post('/v1/account/past-rep/finish', { challengeId: c.challengeId, signed });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: 'challenge-used' });
    expect(await rows()).toHaveLength(1);
  });

  it('an expired or unknown challenge → challenge-expired', async () => {
    const { b } = await login();
    const c = await start(b, ed);
    const signed = await clearsign(c.text, ed);
    setNow(new Date(T0.getTime() + 60 * 60_000 + 1000));
    expect((await b.post('/v1/account/past-rep/finish', { challengeId: c.challengeId, signed })).json()).toMatchObject({ error: 'challenge-expired' });
    expect((await b.post('/v1/account/past-rep/finish', { challengeId: '00000000-0000-4000-8000-000000000000', signed })).json()).toMatchObject({ error: 'challenge-expired' });
    expect((await b.post('/v1/account/past-rep/finish', { challengeId: 'nope', signed })).json()).toMatchObject({ error: 'challenge-expired' });
  });
});

describe('cleartext tricks', () => {
  it('a valid cleartext block with extra lines outside it → wrong-text', async () => {
    const { b } = await login();
    const c = await start(b, ed);
    const signed = await clearsign(c.text, ed);
    for (const paste of [`Note: I agree to pay\n${signed}`, `${signed}\nAnd more text`, `${signed}\n${await clearsign('Other text', ed)}`]) {
      const res = await b.post('/v1/account/past-rep/finish', { challengeId: c.challengeId, signed: paste });
      expect(res.json()).toMatchObject({ error: 'wrong-text' });
    }
    expect(await rows()).toEqual([]);
  });

  it('a message carrying two signatures, one by the claimed key and one by another key → wrong-key', async () => {
    const { b } = await login();
    const c = await start(b, ed);
    const res = await b.post('/v1/account/past-rep/finish', { challengeId: c.challengeId, signed: await clearsign(c.text, [ed, other]) });
    expect(res.json()).toMatchObject({ error: 'wrong-key' });
  });

  it('a signature dated 2 h before issuedAt → wrong-text', async () => {
    const { b } = await login();
    const c = await start(b, ed);
    const res = await b.post('/v1/account/past-rep/finish', {
      challengeId: c.challengeId, signed: await clearsign(c.text, ed, new Date(T0.getTime() - 2 * 3_600_000)),
    });
    expect(res.json()).toMatchObject({ error: 'wrong-text' });
  });

  it('CRLF line ends and trailing whitespace in the paste are accepted', async () => {
    const { b } = await login();
    const c = await start(b, ed);
    const signed = `\n  ${(await clearsign(c.text, ed)).replace(/\r?\n/g, '\r\n')}  \r\n`;
    const res = await b.post('/v1/account/past-rep/finish', { challengeId: c.challengeId, signed });
    expect(res.statusCode, res.body).toBe(201);
  });

  it('verifyPastRepSignature compares what was verified', async () => {
    const text = pastRepChallenge({
      origin: 'https://x2f.test', displayName: 'A.Trader', site: 'Bisq', url: URL_OK, fingerprint: ed.fingerprint, nonce: '0123456789ABCDEF', issuedAt: T0,
    });
    expect(await verifyPastRepSignature(await clearsign(text, ed), text, ed.publicKey, T0)).toEqual({ ok: true });
    expect(await verifyPastRepSignature(await detach(text, ed), text, ed.publicKey, T0)).toEqual({ ok: true });
    expect(await verifyPastRepSignature(await clearsign(`${text}\nExtra`, ed), text, ed.publicKey, T0)).toEqual({ ok: false, reason: 'wrong-text' });
    expect(await verifyPastRepSignature(await clearsign(text, other), text, ed.publicKey, T0)).toEqual({ ok: false, reason: 'wrong-key' });
  });
});

describe('storage (R16)', () => {
  it('a v6 signing-only Ed25519 key carrying a user ID is stored with no user ID packet', async () => {
    const v6 = await gen({ type: 'curve25519', subkeys: [], config: { v6Keys: true }, userIDs: [{ name: 'V6 User', email: 'v6@example.org' }] });
    expect((await openpgp.readKey({ armoredKey: v6.publicKey })).users).toHaveLength(1);
    const { b } = await login();
    const c = await start(b, v6);
    expect((await b.post('/v1/account/past-rep/finish', { challengeId: c.challengeId, signed: await clearsign(c.text, v6) })).statusCode).toBe(201);
    const [row] = await rows();
    const armored = openKey(deps.config, row!.key_enc as Buffer, v6.fingerprint, PAST_REP_KEY_AAD);
    const stored = await openpgp.readKey({ armoredKey: armored });
    expect(stored.getFingerprint()).toBe(v6.fingerprint);
    expect(stored.users).toHaveLength(0);
    expect(armored).not.toContain('v6@example.org');
    // Its own encryption domain: the login key AAD does not open it.
    expect(() => openKey(deps.config, row!.key_enc as Buffer, v6.fingerprint)).toThrow();
  });

  it('a v4 key with Name <a@b.c>: no row, response or captured log contains a@b.c', async () => {
    const named = await gen({ userIDs: [{ name: 'Name', email: 'a@b.c' }] });
    const { b } = await login();
    logs.length = 0;
    const s = await b.post('/v1/account/past-rep/start', startBody(named));
    const c = s.json() as { challengeId: string; text: string };
    const f = await b.post('/v1/account/past-rep/finish', { challengeId: c.challengeId, signed: await clearsign(c.text, named) });
    expect(f.statusCode).toBe(201);
    const l = await b.get('/v1/account/past-rep');
    for (const body of [s.body, f.body, l.body, logs.join('\n')]) expect(body).not.toContain('a@b.c');
    const all = await deps.db.query<{ t: string }>('select p::text as t from past_reputation p union all select c::text from challenges c');
    for (const r of all.rows) expect(r.t).not.toContain('a@b.c');
    // The sealed key does hold it (a v4 key breaks without its user ID), only encrypted.
    const [row] = await rows();
    expect(openKey(deps.config, row!.key_enc as Buffer, named.fingerprint, PAST_REP_KEY_AAD)).toContain('BEGIN PGP PUBLIC KEY');
  });
});

describe('one fingerprint, one account (P5-A24)', () => {
  it('the same fingerprint claimed by a second account: start succeeds, finish → 409 fingerprint-claimed', async () => {
    const a = await login();
    const c1 = await start(a.b, ed);
    expect((await a.b.post('/v1/account/past-rep/finish', { challengeId: c1.challengeId, signed: await clearsign(c1.text, ed) })).statusCode).toBe(201);
    const bAcc = await login();
    const c2 = await start(bAcc.b, ed);
    const res = await bAcc.b.post('/v1/account/past-rep/finish', { challengeId: c2.challengeId, signed: await clearsign(c2.text, ed) });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'fingerprint-claimed' });
    expect(await rows()).toHaveLength(1);
  });

  it('a removed claim frees the site and the fingerprint', async () => {
    const { b } = await login();
    const c = await start(b, ed);
    const id = (await b.post('/v1/account/past-rep/finish', { challengeId: c.challengeId, signed: await clearsign(c.text, ed) })).json().id as string;
    const del = await b.delete(`/v1/account/past-rep/${id}`);
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ id, status: 'removed' });
    expect((await b.get('/v1/account/past-rep')).json()).toMatchObject([{ id, status: 'removed' }]);
    const c2 = await start(b, ed);
    expect((await b.post('/v1/account/past-rep/finish', { challengeId: c2.challengeId, signed: await clearsign(c2.text, ed) })).statusCode).toBe(201);
  });

  it("another account's claim cannot be removed (404) and is not listed", async () => {
    const a = await login();
    const c = await start(a.b, ed);
    const id = (await a.b.post('/v1/account/past-rep/finish', { challengeId: c.challengeId, signed: await clearsign(c.text, ed) })).json().id as string;
    const bAcc = await login();
    expect((await bAcc.b.delete(`/v1/account/past-rep/${id}`)).statusCode).toBe(404);
    expect((await bAcc.b.get('/v1/account/past-rep')).json()).toEqual([]);
    expect((await rows())[0]).toMatchObject({ status: 'signed' });
  });
});

/** Every .ts file under `dir`. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('screenshots alone never count', () => {
  it('only finish inserts a claim: one insert in the server code, reached only from the finish route', () => {
    const hits = sources(SRC).flatMap((p) => (readFileSync(p, 'utf8').match(/insert\s+into\s+past_reputation\b/gi) ?? []).map(() => p));
    expect(hits.map((p) => p.slice(SRC.length))).toEqual(['pastrep/routes.ts']);
    const routes = readFileSync(join(SRC, 'pastrep/routes.ts'), 'utf8');
    // The insert sits in the finish handler, after the signature check.
    const finish = routes.indexOf("'/v1/account/past-rep/finish'");
    const verified = routes.indexOf('verifyPastRepSignature(', finish);
    const insert = routes.search(/insert\s+into\s+past_reputation/i);
    expect(finish).toBeGreaterThan(-1);
    expect(verified).toBeGreaterThan(finish);
    expect(insert).toBeGreaterThan(verified);
  });

  it('the past-rep routes are exactly start, finish, list and delete, each classified for the live-session tripwire', () => {
    const mine = app.printRoutes({ commonPrefix: false }).split('\n').filter((l) => l.includes('past-rep'));
    expect(mine.length).toBeGreaterThan(0);
    for (const r of ['POST /v1/account/past-rep/start', 'POST /v1/account/past-rep/finish', 'DELETE /v1/account/past-rep/:id']) {
      expect(r in LIVE_SESSION_EXEMPT || LIVE_SESSION_ROUTES.includes(r), r).toBe(true);
      expect(app.sessionWriteRoutes).toContain(r);
    }
    expect(app.sessionWriteRoutes.filter((r) => r.includes('past-rep')).sort()).toEqual([
      'DELETE /v1/account/past-rep/:id', 'POST /v1/account/past-rep/finish', 'POST /v1/account/past-rep/start',
    ]);
  });
});

describe('no lookups (P5-A20, review 2026-10-24)', () => {
  it('the whole flow calls no fetch, DNS lookup or http(s) request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('fetch called');
    });
    const lookup = vi.spyOn(dns, 'lookup');
    const lookupP = vi.spyOn(dns.promises, 'lookup');
    const resolve = vi.spyOn(dns, 'resolve');
    const httpReq = vi.spyOn(http, 'request');
    const httpGet = vi.spyOn(http, 'get');
    const httpsReq = vi.spyOn(https, 'request');
    const httpsGet = vi.spyOn(https, 'get');
    try {
      const { b } = await login();
      const c = await start(b, ed);
      expect((await b.post('/v1/account/past-rep/finish', { challengeId: c.challengeId, signed: await clearsign(c.text, ed) })).statusCode).toBe(201);
      await b.get('/v1/account/past-rep');
      for (const s of [fetchSpy, lookup, lookupP, resolve, httpReq, httpGet, httpsReq, httpsGet]) expect(s).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('the semgrep rule exists, covers the pastrep code, and the root script runs tools/semgrep', () => {
    const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
    const rule = readFileSync(join(ROOT, 'tools/semgrep/pastrep-no-fetch.yml'), 'utf8');
    for (const s of ['node:http', 'node:https', 'node:net', 'node:dns', 'undici', 'fetch(', 'apps/api/src/pastrep/', 'apps/api/src/staff/pastrep.ts']) expect(rule).toContain(s);
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts.semgrep).toContain('--config tools/semgrep');
  });
});

describe('members and sessions', () => {
  it('a recovery (backup) session is refused', async () => {
    const id = await seedAccount(deps, { loginName: 'recov1x' });
    const b = new Browser(app);
    await b.post('/t/login', { accountId: id, level: 'recovery' });
    const res = await b.post('/v1/account/past-rep/start', startBody(ed));
    expect(res.statusCode).toBe(403);
  });

  it('a team member gets 403 owner-only on every past-rep route (Task 18: owner-only until decided)', async () => {
    const owner = await login();
    const loginId = await seedAccount(deps, { loginName: 'pmember1x', displayName: 'pm-placeholder', kind: 'member' });
    await deps.db.query(
      `insert into team_members (account_id, display_name, display_key, roles, invite_expires_at, member_account_id, joined_at, created_at)
       values ($1, 'PastMember', 'pastmember', $2, $3, $4, $3, $3)`,
      [owner.id, ['offers', 'trades'], T0, loginId],
    );
    const mb = new Browser(app);
    expect((await mb.post('/t/login', { accountId: loginId })).statusCode).toBe(200);
    for (const res of [
      await mb.post('/v1/account/past-rep/start', startBody(ed)),
      await mb.post('/v1/account/past-rep/finish', { challengeId: '00000000-0000-4000-8000-000000000000', signed: 'x' }),
      await mb.get('/v1/account/past-rep'),
      await mb.delete('/v1/account/past-rep/00000000-0000-4000-8000-000000000000'),
    ]) {
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'owner-only' });
    }
  });

  it('logged out → 401', async () => {
    const res = await new Browser(app).get('/v1/account/past-rep');
    expect(res.statusCode).toBe(401);
  });
});
