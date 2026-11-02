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
import { HOLD_BLOCKED_ROUTES, LIVE_SESSION_EXEMPT, LIVE_SESSION_ROUTES, startHold } from '../src/auth/hold.js';
import { PAST_REP_FINISHES_PER_HOUR, PAST_REP_STARTS_PER_HOUR } from '../src/limits.js';
import { PAST_REP_ARCHIVE_HOSTS, PAST_REP_SITES, pastRepChallenge } from '../src/pastrep/challenge.js';
import { PAST_REP_KEY_AAD, PAST_REP_SIG_AAD } from '../src/pastrep/routes.js';
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

  it("item 71: a GnuPG-style signature carrying a Signer's User ID (an email) is accepted and stored only sealed (x2f/pastrep-sig/<id>)", async () => {
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
    expect(res.statusCode, res.body).toBe(201);
    expect(res.body).not.toContain('old@example.org');
    const id = res.json().id as string;
    // The stored bytes hold neither the email nor any readable signature.
    const [row] = await rows();
    expect(row).not.toHaveProperty('signature');
    const sealed = row!.signature_enc as Buffer;
    expect(Buffer.isBuffer(sealed)).toBe(true);
    expect(sealed.includes(Buffer.from('old@example.org'))).toBe(false);
    expect(sealed.includes(Buffer.from('BEGIN PGP'))).toBe(false);
    const all = await deps.db.query<{ t: string }>('select p::text as t from past_reputation p union all select c::text from challenges c');
    for (const r of all.rows) expect(r.t).not.toContain('old@example.org');
    // The right label opens it, and it still verifies over the issued text (the email is inside, sealed).
    const opened = openKey(deps.config, sealed, id, PAST_REP_SIG_AAD);
    expect(opened.startsWith('-----BEGIN PGP SIGNATURE-----\n\n')).toBe(true);
    expect(((await openpgp.readSignature({ armoredSignature: opened })).packets[0] as openpgp.SignaturePacket).signersUserID).toBe('Old Trader <old@example.org>');
    expect(await verifyPastRepSignature(opened, row!.challenge_text as string, ed.publicKey, T0)).toMatchObject({ ok: true });
    // A wrong label, or another claim's id, does not open it.
    expect(() => openKey(deps.config, sealed, id, PAST_REP_KEY_AAD)).toThrow();
    expect(() => openKey(deps.config, sealed, id)).toThrow();
    expect(() => openKey(deps.config, sealed, ed.fingerprint, PAST_REP_SIG_AAD)).toThrow();
    expect(() => openKey(deps.config, sealed, '00000000-0000-4000-8000-000000000000', PAST_REP_SIG_AAD)).toThrow();
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
    expect(await verifyPastRepSignature(await clearsign(text, ed), text, ed.publicKey, T0)).toMatchObject({ ok: true });
    expect(await verifyPastRepSignature(await detach(text, ed), text, ed.publicKey, T0)).toMatchObject({ ok: true });
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

  it('item 72: the same key backs two sites of the same account', async () => {
    const { b, id } = await login();
    const c1 = await start(b, ed, { site: 'LocalMonero' });
    expect((await finishOf(b, c1.challengeId, await clearsign(c1.text, ed))).statusCode).toBe(201);
    const c2 = await start(b, ed, { site: 'AgoraDesk' });
    const res = await finishOf(b, c2.challengeId, await clearsign(c2.text, ed));
    expect(res.statusCode, res.body).toBe(201);
    const both = await rows();
    expect(both).toHaveLength(2);
    expect(both).toEqual(expect.arrayContaining([
      expect.objectContaining({ account_id: id, site: 'LocalMonero', fingerprint: ed.fingerprint, status: 'signed' }),
      expect.objectContaining({ account_id: id, site: 'AgoraDesk', fingerprint: ed.fingerprint, status: 'signed' }),
    ]));
    // The same site twice is still one live claim (P5-A21).
    const c3 = await start(b, other, { site: 'Paxful' });
    expect((await finishOf(b, c3.challengeId, await clearsign(c3.text, other))).statusCode).toBe(201);
    expect((await b.post('/v1/account/past-rep/start', startBody(ed, { site: 'AgoraDesk' }))).json()).toMatchObject({ error: 'site-claimed' });
  });

  it('item 72: a key live on one account is refused for another even when that account already uses the key elsewhere', async () => {
    const a = await login();
    const c1 = await start(a.b, ed);
    expect((await finishOf(a.b, c1.challengeId, await clearsign(c1.text, ed))).statusCode).toBe(201);
    const bAcc = await login();
    const c2 = await start(bAcc.b, ed, { site: 'Bisq' });
    const res = await finishOf(bAcc.b, c2.challengeId, await clearsign(c2.text, ed));
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'fingerprint-claimed' });
    expect(await rows()).toHaveLength(1);
  });

  it('item 72: two accounts finishing the same key at once → exactly one row, the other fingerprint-claimed (race-safe)', async () => {
    for (let round = 0; round < 3; round += 1) {
      await deps.db.query('delete from past_reputation');
      const a = await login();
      const bAcc = await login();
      const ca = await start(a.b, ed, { site: 'LocalMonero' });
      const cb = await start(bAcc.b, ed, { site: 'Paxful' });
      const [sa, sb] = await Promise.all([clearsign(ca.text, ed), clearsign(cb.text, ed)]);
      const res = await Promise.all([finishOf(a.b, ca.challengeId, sa), finishOf(bAcc.b, cb.challengeId, sb)]);
      expect(res.map((r) => r.statusCode).sort(), res.map((r) => r.body).join(' | ')).toEqual([201, 409]);
      expect(res.find((r) => r.statusCode === 409)!.json()).toMatchObject({ error: 'fingerprint-claimed' });
      expect(await rows()).toHaveLength(1);
    }
  });

  it('item 72: the database itself refuses a live row whose key is live on another account; the same account is fine', async () => {
    const a = await login();
    const c = await start(a.b, ed);
    expect((await finishOf(a.b, c.challengeId, await clearsign(c.text, ed))).statusCode).toBe(201);
    const bAcc = await login();
    const [row] = await rows();
    const copy = (account: string, site: string, status = 'signed') =>
      deps.db.query(
        `insert into past_reputation (account_id, site, evidence_url, claimed_trades, fingerprint, key_enc, challenge_text, signature_enc, status, created_at)
         values ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9)`,
        [account, site, URL_OK, ed.fingerprint, row!.key_enc, row!.challenge_text, row!.signature_enc, status, T0],
      );
    await expect(copy(bAcc.id, 'Bisq')).rejects.toMatchObject({ code: '23505', constraint: 'past_reputation_fingerprint_account' });
    await expect(copy(bAcc.id, 'Bisq', 'approved')).rejects.toMatchObject({ code: '23505', constraint: 'past_reputation_fingerprint_account' });
    await copy(bAcc.id, 'Bisq', 'rejected');
    await copy(a.id, 'Bisq');
    // Turning another account's dead row live again is refused too.
    await expect(deps.db.query(`update past_reputation set status = 'signed' where account_id = $1`, [bAcc.id])).rejects.toMatchObject({ code: '23505' });
  });

  it('item 74: a claim a moderator revoked may be filed again with the same key and goes back to a moderator (signed)', async () => {
    const { b, id } = await login();
    const c1 = await start(b, ed);
    const first = (await finishOf(b, c1.challengeId, await clearsign(c1.text, ed))).json().id as string;
    await deps.db.query(`update past_reputation set status = 'revoked', decided_at = $2, reason = 'test' where id = $1`, [first, T0]);
    const c2 = await start(b, ed);
    const res = await finishOf(b, c2.challengeId, await clearsign(c2.text, ed));
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toEqual({ id: expect.any(String), status: 'signed' });
    const both = await rows();
    expect(both).toHaveLength(2);
    expect(both).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: first, account_id: id, site: 'LocalMonero', fingerprint: ed.fingerprint, status: 'revoked' }),
      expect.objectContaining({ id: res.json().id, account_id: id, site: 'LocalMonero', fingerprint: ed.fingerprint, status: 'signed' }),
    ]));
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

describe('hold and throttle (lead follow-up, owner 1 Nov)', () => {
  it('a held account is refused start and finish with the hold\'s code; list and delete still work', async () => {
    const { b, id } = await login();
    const c = await start(b, ed);
    const signed = await clearsign(c.text, ed);
    // A claim made before the hold, to list and remove during it.
    const c2 = await start(b, other, { site: 'Paxful' });
    const claim = (await b.post('/v1/account/past-rep/finish', { challengeId: c2.challengeId, signed: await clearsign(c2.text, other) })).json().id as string;
    const until = await startHold(deps.db, id, T0, { reason: 'weak-new-device', startedBy: null });
    for (const res of [
      await b.post('/v1/account/past-rep/start', startBody(ed, { site: 'Bisq' })),
      await b.post('/v1/account/past-rep/finish', { challengeId: c.challengeId, signed }),
    ]) {
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'recovery-hold', holdUntil: until.toISOString() });
    }
    expect((await b.get('/v1/account/past-rep')).statusCode).toBe(200);
    expect((await b.delete(`/v1/account/past-rep/${claim}`)).json()).toEqual({ id: claim, status: 'removed' });
    expect(await rows()).toMatchObject([{ id: claim, status: 'removed' }]);
    expect(HOLD_BLOCKED_ROUTES).toEqual(expect.arrayContaining(['POST /v1/account/past-rep/start', 'POST /v1/account/past-rep/finish']));
    expect(HOLD_BLOCKED_ROUTES).not.toContain('DELETE /v1/account/past-rep/:id');
  });

  it(`start is throttled: ${PAST_REP_STARTS_PER_HOUR} an hour per account, the next refused 429 slow-down, fine again after the hour`, async () => {
    expect(PAST_REP_STARTS_PER_HOUR).toBe(10);
    const t = new Date('2026-11-02T08:00:00Z');
    setNow(t);
    const { b } = await login();
    // A malformed site or link is refused before the throttle and costs nothing.
    expect((await b.post('/v1/account/past-rep/start', startBody(ed, { url: 'https://evil.example/x' }))).statusCode).toBe(400);
    for (let i = 0; i < PAST_REP_STARTS_PER_HOUR; i++) {
      // A refused key counts (each start is a key inspection).
      const res = await b.post('/v1/account/past-rep/start', i === 0 ? startBody(rsa1024) : startBody(ed));
      expect(res.statusCode, `start ${i + 1}`).toBe(i === 0 ? 400 : 200);
    }
    const over = await b.post('/v1/account/past-rep/start', startBody(ed));
    expect(over.statusCode).toBe(429);
    expect(over.json()).toMatchObject({ error: 'slow-down', retryAfterSeconds: expect.any(Number) });
    // Another account is not affected.
    expect((await (await login()).b.post('/v1/account/past-rep/start', startBody(ed))).statusCode).toBe(200);
    setNow(new Date(t.getTime() + 3_600_000));
    expect((await b.post('/v1/account/past-rep/start', startBody(ed))).statusCode).toBe(200);
  });
});

/** A certify-only Ed25519 primary with only an encryption subkey (made with GnuPG 2: `--quick-gen-key ... ed25519 cert`, `--quick-add-key ... cv25519 encr`): it can never sign. */
const CERT_ONLY = `-----BEGIN PGP PUBLIC KEY BLOCK-----

mDMEaueLrBYJKwYBBAHaRw8BAQdAzEALj9mR02P+En/7ciX6gQVYysEerTquUgXb
XGiyQny0CUNlcnQgT25seYiPBBMWCgA4FiEEUnfksTSIcvCleejJIolbGovmEnYF
Amrni6wCGwEFCwkIBwIGFQoJCAsCBBYCAwECHgECF4AACgkQIolbGovmEnb5dQEA
sQceV04TWvGVA46HwGaID35RuW4QdJXAXmkOm1co9o4A93Ks8yZpUquOtVPJgXI1
1Ll9G5V7lL6SSWJDe4VHWw24OARq54usEgorBgEEAZdVAQUBAQdA7RDrN+bpZiZa
TSNARjAYK9oGY/us/7Nxy8st4TL8UxMDAQgHiHgEGBYKACAWIQRSd+SxNIhy8KV5
6MkiiVsai+YSdgUCaueLrAIbDAAKCRAiiVsai+YSdvLcAQCbzKT+SSRzKO3pAzEB
yskrnzaSGWLzwkEG7iwnqMDUkQD9H0hlmy5snC0eKl9D18ah9N3t5LPX8vcSyoQ6
NX3tKgY=
=Xr4W
-----END PGP PUBLIC KEY BLOCK-----`;

const finishOf = (b: Browser, challengeId: string, signed: string) => b.post('/v1/account/past-rep/finish', { challengeId, signed });
const challengeUsed = async (id: string) => (await deps.db.query<{ used_at: Date | null }>('select used_at from challenges where id = $1', [id])).rows[0]!.used_at !== null;

describe('review round 1', () => {
  it('M1: detached signatures over the wrong text, by another key, or made too early are refused', async () => {
    const { b } = await login();
    const c = await start(b, ed);
    const cases: Array<[string, string]> = [
      [await detach(c.text.replace(/^Nonce: .*$/m, 'Nonce: 0000000000000000'), ed), 'wrong-text'],
      [await detach(`${c.text}\nExtra line`, ed), 'wrong-text'],
      [await detach(c.text, other), 'wrong-key'],
      [await detach(c.text, ed, new Date(T0.getTime() - 2 * 3_600_000)), 'wrong-text'],
    ];
    for (const [signed, error] of cases) expect((await finishOf(b, c.challengeId, signed)).json(), error).toMatchObject({ error });
    expect(await rows()).toEqual([]);
    expect(await challengeUsed(c.challengeId)).toBe(false);
  });

  it('M2: an RSA-1024 signing subkey under an Ed25519 primary → wrong-key (PAST_REP_VERIFY_CONFIG is the one verify uses)', async () => {
    const weakSub = await gen({ subkeys: [{}, { type: 'rsa', rsaBits: 1024, sign: true }], config: { minRSABits: 1024 } });
    const { b } = await login();
    const c = await start(b, weakSub);
    const signed = await openpgp.sign({
      message: await openpgp.createCleartextMessage({ text: c.text }), signingKeys: await priv(weakSub), date: T0, config: { minRSABits: 1024 },
    });
    const sig = (await openpgp.readCleartextMessage({ cleartextMessage: signed })) as unknown as { signature: openpgp.Signature };
    const pub = await openpgp.readKey({ armoredKey: weakSub.publicKey });
    expect(sig.signature.getSigningKeyIDs()[0]!.equals(pub.getKeyID())).toBe(false);
    expect((await finishOf(b, c.challengeId, signed)).json()).toMatchObject({ error: 'wrong-key' });
  });

  it('M2: a signing subkey revoked, or expired, after the signature but before now → wrong-key (judged at now)', async () => {
    const signedAt = new Date(T0.getTime() - 2 * 60_000);
    const goneAt = new Date(T0.getTime() - 60_000);
    // Revoked: the public key pasted at start carries the subkey's revocation, dated after the signature.
    const withSub = await gen({ subkeys: [{}, { sign: true }] });
    const p = await priv(withSub);
    const subIndex = p.subkeys.findIndex((k) => k.bindingSignatures.some((s) => (s.keyFlags?.[0] ?? 0) & openpgp.enums.keyFlags.signData));
    expect(subIndex).toBeGreaterThan(-1);
    p.subkeys[subIndex] = await p.subkeys[subIndex]!.revoke(p.keyPacket as openpgp.SecretKeyPacket, undefined, goneAt);
    const revokedPub: Pair = { ...withSub, publicKey: p.toPublic().armor() };
    // Expired: the signing subkey's binding ends a minute before now.
    const expiring = await gen({ subkeys: [{}, { sign: true, keyExpirationTime: Math.floor((goneAt.getTime() - KEY_DATE.getTime()) / 1000) }] });
    for (const key of [revokedPub, expiring]) {
      const { b } = await login();
      const c = await start(b, key);
      const res = await finishOf(b, c.challengeId, await clearsign(c.text, key, signedAt));
      expect(res.json()).toMatchObject({ error: 'wrong-key' });
    }
    expect(await rows()).toEqual([]);
  });

  it('M3: a hold that starts after the preHandler refuses finish under the account lock: no row, challenge unused', async () => {
    const { b, id } = await login();
    const c = await start(b, ed);
    const signed = await clearsign(c.text, ed);
    let until: Date | null = null;
    const orig = deps.db.query.bind(deps.db) as (...a: unknown[]) => Promise<unknown>;
    const q = vi.spyOn(deps.db, 'query').mockImplementation((async (...args: unknown[]) => {
      if (until === null && typeof args[0] === 'string' && args[0].includes('from challenges where id = $1 and purpose')) {
        until = new Date(0);
        until = await startHold(deps.db, id, T0, { reason: 'weak-new-device', startedBy: null });
      }
      return orig(...args);
    }) as never);
    let res;
    try {
      res = await finishOf(b, c.challengeId, signed);
    } finally {
      q.mockRestore();
    }
    expect(until).not.toBeNull();
    expect(res.statusCode, res.body).toBe(403);
    expect(res.json()).toEqual({ error: 'recovery-hold', holdUntil: until!.toISOString() });
    expect(await rows()).toEqual([]);
    expect(await challengeUsed(c.challengeId)).toBe(false);
  });

  it('M3: a session revoked after the preHandler gets 401 from finish: no row, challenge unused', async () => {
    const { b } = await login();
    const c = await start(b, ed);
    const signed = await clearsign(c.text, ed);
    const sessionId = (await deps.db.query<{ session_id: string }>('select session_id from challenges where id = $1', [c.challengeId])).rows[0]!.session_id;
    let fired = false;
    const orig = deps.db.query.bind(deps.db) as (...a: unknown[]) => Promise<unknown>;
    const q = vi.spyOn(deps.db, 'query').mockImplementation((async (...args: unknown[]) => {
      if (!fired && typeof args[0] === 'string' && args[0].includes('from challenges where id = $1 and purpose')) {
        fired = true;
        await orig('update sessions set revoked_at = $2 where id = $1', [sessionId, T0]);
      }
      return orig(...args);
    }) as never);
    let res;
    try {
      res = await finishOf(b, c.challengeId, signed);
    } finally {
      q.mockRestore();
    }
    expect(fired).toBe(true);
    expect(res.statusCode, res.body).toBe(401);
    expect(await rows()).toEqual([]);
    expect(await challengeUsed(c.challengeId)).toBe(false);
  });

  it('M3: finish is in LIVE_SESSION_ROUTES, no longer exempt', () => {
    expect(LIVE_SESSION_ROUTES).toContain('POST /v1/account/past-rep/finish');
    expect('POST /v1/account/past-rep/finish' in LIVE_SESSION_EXEMPT).toBe(false);
  });

  it('M4: the stored signature is re-armored with no armor headers and still verifies over challenge_text', async () => {
    const { b } = await login();
    const c = await start(b, ed);
    const signed = (await clearsign(c.text, ed)).replace('-----BEGIN PGP SIGNATURE-----\n', '-----BEGIN PGP SIGNATURE-----\nComment: a@b.c\nVersion: Leaky 1.0\n');
    expect(signed).toContain('Comment: a@b.c');
    expect((await finishOf(b, c.challengeId, signed)).statusCode).toBe(201);
    const [row] = await rows();
    const stored = openKey(deps.config, row!.signature_enc as Buffer, row!.id as string, PAST_REP_SIG_AAD);
    expect(stored).not.toContain('a@b.c');
    expect(stored).not.toContain('Leaky');
    expect(stored).not.toContain('BEGIN PGP SIGNED MESSAGE');
    expect(stored.startsWith('-----BEGIN PGP SIGNATURE-----\n\n')).toBe(true);
    expect(stored.split('\n').filter((l) => /^[A-Za-z-]+: /.test(l))).toEqual([]);
    expect(await verifyPastRepSignature(stored, row!.challenge_text as string, ed.publicKey, T0)).toMatchObject({ ok: true });
  });

  it('N1: the window is [issuedAt − 5 min, now]: a signer with a fast clock is refused, one just before now passes', async () => {
    const { b } = await login();
    const c = await start(b, ed);
    expect((await finishOf(b, c.challengeId, await clearsign(c.text, ed, new Date(T0.getTime() + 3 * 60_000)))).statusCode).toBe(400);
    expect((await finishOf(b, c.challengeId, await clearsign(c.text, ed, new Date(T0.getTime() - 4 * 60_000)))).statusCode).toBe(201);
  });

  it('N3: start refuses a key with no usable signing key (key-no-signing)', async () => {
    setNow(new Date('2026-11-05T00:00:00Z'));
    const { b } = await login();
    const res = await b.post('/v1/account/past-rep/start', startBody({ publicKey: CERT_ONLY, privateKey: '', fingerprint: '' }));
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json()).toMatchObject({ error: 'key-no-signing' });
  });

  it('N4: two finishes of one challenge at once → exactly one row, the other challenge-used', async () => {
    const { b } = await login();
    const c = await start(b, ed);
    const signed = await clearsign(c.text, ed);
    const res = await Promise.all([finishOf(b, c.challengeId, signed), finishOf(b, c.challengeId, signed)]);
    expect(res.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(res.find((r) => r.statusCode === 409)!.json()).toMatchObject({ error: 'challenge-used' });
    expect(await rows()).toHaveLength(1);
  });

  it('N4: two challenges for one site finished at once → one row, the other site-claimed', async () => {
    const { b } = await login();
    const c1 = await start(b, ed);
    const c2 = await start(b, other);
    const res = await Promise.all([finishOf(b, c1.challengeId, await clearsign(c1.text, ed)), finishOf(b, c2.challengeId, await clearsign(c2.text, other))]);
    expect(res.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(res.find((r) => r.statusCode === 409)!.json()).toMatchObject({ error: 'site-claimed' });
    expect(await rows()).toHaveLength(1);
  });

  it(`N5: finish is throttled per account (${PAST_REP_FINISHES_PER_HOUR} an hour), the next 429 slow-down`, async () => {
    const t = new Date('2026-11-03T08:00:00Z');
    setNow(t);
    const { b } = await login();
    const c = await start(b, ed);
    for (let i = 0; i < PAST_REP_FINISHES_PER_HOUR; i++) {
      expect((await finishOf(b, c.challengeId, 'not a signature')).json(), `finish ${i + 1}`).toMatchObject({ error: 'bad-signature' });
    }
    const over = await finishOf(b, c.challengeId, await clearsign(c.text, ed, t));
    expect(over.statusCode).toBe(429);
    expect(over.json()).toMatchObject({ error: 'slow-down', retryAfterSeconds: expect.any(Number) });
    expect(await rows()).toEqual([]);
  });

  it('N6: the semgrep rule also covers child_process and globalThis.fetch', () => {
    const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
    const rule = readFileSync(join(ROOT, 'tools/semgrep/pastrep-no-fetch.yml'), 'utf8');
    expect(rule).toContain('child_process');
    expect(rule).toContain('globalThis');
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
