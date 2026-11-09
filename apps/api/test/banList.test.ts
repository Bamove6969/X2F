import type { FastifyInstance } from 'fastify';
import * as openpgp from 'openpgp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAccount, assertDisplayNameFree, type NewNames } from '../src/accounts.js';
import type { Deps } from '../src/app.js';
import { issueConfirmToken } from '../src/auth/confirm.js';
import { insertPgpKey, storableKey } from '../src/auth/pgp.js';
import { assertKeyNotBanned, jabberBanned, keyFingerprints, normalizeJabber, recordBan, recordBannedValues } from '../src/bans.js';
import { ApiError } from '../src/errors.js';
import { seedAccount } from './helpers/accounts.js';
import { testApp } from './helpers/app.js';
import { codeOf, decrypt, genKey } from './helpers/pgpKeys.js';
import { SIG } from './helpers/signature.js';
import { Browser, addTestLogin } from './helpers/totp.js';

// Owner, 2 Nov 2026: the ban list. When an account is banned its usernames (display and login
// name), its PGP key fingerprints (primary and every subkey) and its Jabber account are recorded,
// and none of them can be used again: not at sign-up, not as a new key, not at Jabber setup. Not
// tracked: Monero addresses, payment details, IP addresses, device fingerprints. Everything is
// stored only as a keyed tag (the login-name pattern of FU-D, under X2F_LOGIN_NAME_KEYS). The ban
// action itself is staff-side (Plan 4); this is the data, the checks and `recordBan`.

let app: FastifyInstance;
let deps: Deps;
let n = 0;
const uniq = (p: string) => `${p}${(++n).toString().padStart(3, '0')}x`;

beforeAll(async () => {
  ({ app, deps } = await testApp());
  addTestLogin(app, deps);
});
afterAll(async () => {
  await app.close();
});

const names = (display: string, login: string): NewNames => ({ displayName: display, displayKey: display.toLowerCase(), loginKey: login.toLowerCase() });

/** createAccount in a transaction of its own (it takes the names lock). */
async function create(n: NewNames): Promise<string> {
  const c = await deps.db.connect();
  try {
    await c.query('begin');
    const id = await createAccount(c, deps.config, { ...n, kind: 'trader', termsVersion: deps.config.termsVersion, termsSignature: SIG, now: deps.clock() });
    await c.query('commit');
    return id;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

async function codeOfError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return `${e.status} ${e.code}`;
    throw e;
  }
  return 'ok';
}

/** A banned account: display name, login name and one PGP key with an extra subkey. */
async function banned(o: { jabber?: string } = {}) {
  const display = uniq('Bad');
  const login = uniq('badlogin');
  const id = await seedAccount(deps, { loginName: login, displayName: display });
  const key = await genKey({ subkeys: [{}, { sign: true }] });
  await insertPgpKey(deps.db, deps.config, { accountId: id, fingerprint: key.fingerprint, armored: key.publicKey, now: deps.clock() });
  const r = await recordBan(deps, id, o);
  return { id, display, login, key, recorded: r.recorded };
}

describe('recordBan', () => {
  it('records the display name, the login name, the primary key and every subkey, and the Jabber account, as keyed tags only', async () => {
    const b = await banned({ jabber: 'Bad.Person@Example.org/phone' });
    const fps = await keyFingerprints(b.key.publicKey);
    expect(fps).toHaveLength(3);
    // display + login + 3 fingerprints + jabber
    expect(b.recorded).toBe(6);
    const { rows } = await deps.db.query<Record<string, unknown>>('select * from banned_identifiers where account_id = $1', [b.id]);
    expect(rows.map((r) => r.kind).sort()).toEqual(['display-name', 'jabber', 'login-name', 'pgp-fingerprint', 'pgp-fingerprint', 'pgp-fingerprint']);
    // Nothing in clear: no column holds the name, the login name, a fingerprint or the Jabber address.
    const text = JSON.stringify(rows, (_k, v: unknown) => (Buffer.isBuffer(v) ? v.toString('latin1') : v)).toLowerCase();
    for (const s of [b.display.toLowerCase(), b.login.toLowerCase(), ...fps, 'bad.person@example.org']) expect(text).not.toContain(s);
  });

  it('is idempotent: banning twice records nothing new', async () => {
    const b = await banned();
    expect((await recordBan(deps, b.id)).recorded).toBe(0);
  });

  it("owner G27: banning a team account bans each member login's login name and PGP keys too", async () => {
    const team = await seedAccount(deps, { loginName: uniq('teamlogin'), displayName: uniq('Team') });
    const memberLogin = uniq('memberlogin');
    const member = await seedAccount(deps, { loginName: memberLogin, kind: 'member' });
    const key = await genKey();
    await insertPgpKey(deps.db, deps.config, { accountId: member, fingerprint: key.fingerprint, armored: key.publicKey, now: deps.clock() });
    await deps.db.query(
      `insert into team_members (account_id, display_name, display_key, roles, invite_expires_at, member_account_id, joined_at, created_at)
       values ($1, 'Sam', 'sam', '{trades}', $2, $3, $2, $2)`,
      [team, deps.clock(), member],
    );
    const fps = await keyFingerprints(key.publicKey);
    // team: display + login; member: login + every fingerprint of its key
    expect((await recordBan(deps, team)).recorded).toBe(2 + 1 + fps.length);
    const { rows } = await deps.db.query<{ kind: string }>('select kind from banned_identifiers where account_id = $1 order by kind', [member]);
    expect(rows.map((r) => r.kind)).toEqual(['login-name', ...fps.map(() => 'pgp-fingerprint')]);
    expect(await codeOfError(create(names(uniq('Fresh'), memberLogin)))).toBe('409 names-unavailable');
    expect((await recordBan(deps, team)).recorded).toBe(0);
  });

  it('records nothing it is not told to: no wallet address, payment detail, IP address or device', async () => {
    const cols = await deps.db.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'banned_identifiers' order by column_name",
    );
    expect(cols.rows.map((r) => r.column_name)).toEqual(['account_id', 'banned_at', 'id', 'kind', 'tag', 'tag_key_id']);
    const kinds = await deps.db.query<{ def: string }>(
      "select pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'banned_identifiers'::regclass and contype = 'c'",
    );
    expect(kinds.rows.map((r) => r.def).join(' ')).toMatch(/display-name.*login-name.*pgp-fingerprint.*jabber/);
  });
});

describe('a banned name can never be used again', () => {
  it('as a display name: the early check says display-name-taken; createAccount says names-unavailable', async () => {
    const b = await banned();
    const fresh = names(b.display, uniq('newlogin'));
    expect(await codeOfError(assertDisplayNameFree(deps.db, fresh, deps.config))).toBe('409 display-name-taken');
    expect(await codeOfError(create(fresh))).toBe('409 names-unavailable');
  });

  it('as a login name (never named as banned: the generic names-unavailable)', async () => {
    const b = await banned();
    expect(await codeOfError(create(names(uniq('Fresh'), b.login)))).toBe('409 names-unavailable');
  });

  it('in the other namespace too: the banned display name as a login name, the banned login name as a display name', async () => {
    const b = await banned();
    expect(await codeOfError(create(names(uniq('Fresh'), b.display)))).toBe('409 names-unavailable');
    expect(await codeOfError(create(names(b.login, uniq('fresh'))))).toBe('409 names-unavailable');
    // The early display-name check does not say a private login name was banned.
    expect(await codeOfError(assertDisplayNameFree(deps.db, names(b.login, uniq('fresh')), deps.config))).toBe('ok');
  });

  it('case-insensitively, and after the banned account is gone', async () => {
    const b = await banned();
    await deps.db.query('delete from pgp_keys where account_id = $1', [b.id]);
    await deps.db.query('delete from accounts where id = $1', [b.id]);
    expect(await codeOfError(create(names(b.display.toUpperCase(), uniq('other'))))).toBe('409 names-unavailable');
    const { rows } = await deps.db.query('select account_id from banned_identifiers where account_id is null');
    expect(rows.length).toBeGreaterThan(0);
  });

  it('only the exact name (case aside): a look-alike of a banned name is free (owner answer Q79, 2026-11-06)', async () => {
    // Owner: "similar looking names to a banned account should not be banned as well". The
    // look-alike folding (0/o, 1/l/i, rn/m) stays for staff and owner names only.
    const b = await banned();
    const alike = b.display.replace(/0/g, 'O').replace(/1/g, 'l');
    expect(alike).not.toBe(b.display);
    const loginAlike = b.login.replace(/0/g, 'o').replace(/1/g, 'l');
    expect(loginAlike).not.toBe(b.login);
    const fresh = names(alike, loginAlike);
    expect(await codeOfError(assertDisplayNameFree(deps.db, fresh, deps.config))).toBe('ok');
    expect(await codeOfError(create(fresh))).toBe('ok');
  });

  it('through the sign-up route: POST /v1/register/pgp/start with a banned display name → 409 display-name-taken', async () => {
    const b = await banned();
    const key = await genKey();
    const res = await new Browser(app).post('/v1/register/pgp/start', { displayName: b.display, loginName: uniq('ok.login'), publicKey: key.publicKey });
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json()).toEqual({ error: 'display-name-taken' });
  });
});

describe('a banned PGP key can never be used again', () => {
  // Lead review 2026-11-06 item 1: a refusal before the code is proved would let anyone, with no
  // login and no proof, ask whether a key is banned. Every start answers as for any key; the
  // refusal comes only from the write (insertPgpKey / applyPgpKey), after the code proved the key,
  // with the same shape as the other refusal there (409 key-in-use).

  /** Sign-up start then finish with `key` (the code decrypted with its private half). */
  async function signUp(key: { publicKey: string; privateKey: string }, display = uniq('Newbie'), login = uniq('new.login')) {
    const b = new Browser(app);
    const start = await b.post('/v1/register/pgp/start', { displayName: display, loginName: login, publicKey: key.publicKey });
    const code = start.statusCode === 200 ? codeOf(await decrypt(start.json().encryptedMessage, key.privateKey)) : '';
    const finish = start.statusCode === 200
      ? await b.post('/v1/register/pgp/finish', { challengeId: start.json().challengeId, code, deviceLabel: 'Laptop', acceptedTerms: deps.config.termsVersion })
      : null;
    return { start, finish, display };
  }

  it('at sign-up: start answers as for any key (no answer before proof); finish refuses 409 key-unavailable and creates nothing', async () => {
    const b = await banned();
    const { start, finish, display } = await signUp(b.key);
    expect(start.statusCode, start.body).toBe(200);
    expect(Object.keys(start.json()).sort()).toEqual(Object.keys((await signUp(await genKey())).start.json()).sort());
    expect(finish!.statusCode, finish!.body).toBe(409);
    expect(finish!.json()).toEqual({ error: 'key-unavailable' });
    expect((await deps.db.query('select 1 from accounts where display_key = $1', [display.toLowerCase()])).rowCount).toBe(0);
  });

  it('the refusal after proof has the shape of the other one there (key-in-use): status, body keys, challenge used up', async () => {
    const b = await banned();
    const banRes = await signUp(b.key);
    const inUse = await genKey();
    await insertPgpKey(deps.db, deps.config, { accountId: await seedAccount(deps, { loginName: uniq('holder') }), fingerprint: inUse.fingerprint, armored: inUse.publicKey, now: deps.clock() });
    const useRes = await signUp(inUse);
    expect(useRes.finish!.statusCode).toBe(409);
    expect(useRes.finish!.json()).toEqual({ error: 'key-in-use' });
    expect(banRes.finish!.statusCode).toBe(useRes.finish!.statusCode);
    expect(Object.keys(banRes.finish!.json())).toEqual(Object.keys(useRes.finish!.json()));
  });

  it('a key whose subkey is banned is refused too (after proof)', async () => {
    const k = await genKey({ subkeys: [{}, { sign: true }] });
    const key = await openpgp.readKey({ armoredKey: k.publicKey });
    const sub = key.getSubkeys()[1]!.getFingerprint();
    await recordBannedValues(deps.db, deps.config, { kind: 'pgp-fingerprint', values: [sub], accountId: null, now: deps.clock() });
    const { start, finish } = await signUp(k);
    expect(start.statusCode, start.body).toBe(200);
    expect(finish!.statusCode, finish!.body).toBe(409);
    expect(finish!.json()).toEqual({ error: 'key-unavailable' });
  });

  it('lead review item 2: a login that refreshes the stored key with a banned subkey is refused, and nothing is stored', async () => {
    const k = await genKey();
    const id = await seedAccount(deps, { loginName: uniq('refresher') });
    await insertPgpKey(deps.db, deps.config, { accountId: id, fingerprint: k.fingerprint, armored: k.publicKey, now: deps.clock() });
    const before = (await deps.db.query<{ armored_enc: Buffer }>('select armored_enc from pgp_keys where account_id = $1', [id])).rows[0]!.armored_enc;
    // The same primary key with a new signing subkey, which is banned.
    const priv = await openpgp.readPrivateKey({ armoredKey: k.privateKey });
    const grown = await priv.addSubkey({ sign: true, date: new Date(deps.clock().getTime() - 60_000) });
    const sub = grown.getSubkeys().at(-1)!.getFingerprint();
    await recordBannedValues(deps.db, deps.config, { kind: 'pgp-fingerprint', values: [sub], accountId: null, now: deps.clock() });
    const b = new Browser(app);
    const start = await b.post('/v1/login/pgp/start', { key: grown.toPublic().armor() });
    expect(start.statusCode, start.body).toBe(200);
    const code = codeOf(await decrypt(start.json().encryptedMessage, grown.armor(), undefined, deps.clock()));
    const finish = await b.post('/v1/login/pgp/finish', { challengeId: start.json().challengeId, code, deviceLabel: 'Desk' });
    expect([finish.statusCode, finish.json()]).toEqual([409, { error: 'key-unavailable' }]);
    const after = (await deps.db.query<{ armored_enc: Buffer }>('select armored_enc from pgp_keys where account_id = $1', [id])).rows[0]!.armored_enc;
    expect(after.equals(before)).toBe(true);
    expect((await deps.db.query('select 1 from sessions where account_id = $1', [id])).rowCount).toBe(0);
  });

  it('as a new key on another account: POST /v1/account/pgp/start answers as for any key; finish refuses 409 key-unavailable and adds nothing', async () => {
    const b = await banned();
    const other = await seedAccount(deps, { loginName: uniq('keyadder') });
    const br = new Browser(app);
    expect((await br.post('/t/login', { accountId: other })).statusCode).toBe(200);
    // A strong session with its confirm (this test is about the key, not the confirm or the hold).
    const sid = (await deps.db.query<{ id: string }>("update sessions set strength = 'strong' where account_id = $1 returning id", [other])).rows[0]!.id;
    const confirmToken = await issueConfirmToken(deps, { sessionId: sid, accountId: other, action: { kind: 'add-method', method: 'pgp' }, method: 'passkey' });
    const start = await br.post('/v1/account/pgp/start', { publicKey: b.key.publicKey, confirmToken });
    expect(start.statusCode, start.body).toBe(200);
    const code = codeOf(await decrypt(start.json().encryptedMessage, b.key.privateKey));
    await deps.db.query('delete from account_holds where account_id = $1', [other]);
    const finish = await br.post('/v1/account/pgp/finish', { challengeId: start.json().challengeId, code });
    expect(finish.statusCode, finish.body).toBe(409);
    expect(finish.json()).toEqual({ error: 'key-unavailable' });
    expect((await deps.db.query('select 1 from pgp_keys where account_id = $1', [other])).rowCount).toBe(0);
  });

  it('insertPgpKey (every sign-up and team join writes through it) refuses it whatever the route', async () => {
    const b = await banned();
    await deps.db.query('delete from pgp_keys where account_id = $1', [b.id]);
    const other = await seedAccount(deps, { loginName: uniq('keyadder') });
    const write = insertPgpKey(deps.db, deps.config, { accountId: other, fingerprint: b.key.fingerprint, armored: b.key.publicKey, now: deps.clock() });
    expect(await codeOfError(write)).toBe('409 key-unavailable');
  });

  it('a key that is not banned goes through', async () => {
    const k = await genKey();
    const res = await new Browser(app).post('/v1/register/pgp/start', { displayName: uniq('Clean'), loginName: uniq('clean.login'), publicKey: k.publicKey });
    expect(res.statusCode, res.body).toBe(200);
  });
});

describe('Jabber (seam: no Jabber alert account in the code yet)', () => {
  it('normalizes: case, spaces and the resource part', () => {
    expect(normalizeJabber('  Bad.Person@Example.ORG/phone ')).toBe('bad.person@example.org');
    expect(normalizeJabber('not-an-address')).toBeNull();
    // Lead vendor review minor: a trailing dot, an internationalised domain and full-width letters fold together.
    expect(normalizeJabber('bad.person@example.org.')).toBe('bad.person@example.org');
    expect(normalizeJabber('bad@\u00e9xample.org')).toBe(normalizeJabber('bad@xn--xample-9ua.org'));
    expect(normalizeJabber('\uff42\uff41\uff44@example.org')).toBe('bad@example.org');
    expect(normalizeJabber('bad@exa mple.org')).toBeNull();
    expect(normalizeJabber('a@')).toBeNull();
  });

  it('jabberBanned is true for a banned account, false for others', async () => {
    await banned({ jabber: 'evil@jabber.example' });
    expect(await jabberBanned(deps.db, deps.config, 'EVIL@jabber.example/laptop')).toBe(true);
    expect(await jabberBanned(deps.db, deps.config, 'good@jabber.example')).toBe(false);
    expect(await jabberBanned(deps.db, deps.config, 'garbage')).toBe(false);
  });
});

describe('security review 8 Nov I1: a ban covers only what the banned account controls', () => {
  // Mallory takes Vera's public key and appends her primary key packet to his own key as a subkey
  // (the fingerprint is the same: it hashes only the key body). He needs nothing from Vera. A ban of
  // his account must not ban her key, or every PGP login of hers would end 409 key-unavailable.

  /**
   * Mallory's public key with `foreign` (another person's primary key body) appended as a subkey:
   * with no binding at all, or bound by Mallory as an encryption or a signing subkey (a signing one
   * without the foreign key's back-signature, which only the foreign key's owner can make).
   */
  async function withForeignSubkey(mallory: { privateKey: string }, foreign: string, bind: 'none' | 'encrypt' | 'sign'): Promise<string> {
    const m = await openpgp.readPrivateKey({ armoredKey: mallory.privateKey });
    const f = await openpgp.readKey({ armoredKey: foreign });
    const sub = new openpgp.PublicSubkeyPacket();
    sub.read(f.keyPacket.write());
    const list = m.toPublic().toPacketList();
    list.push(sub);
    if (bind !== 'none') {
      const sig = new openpgp.SignaturePacket();
      sig.signatureType = openpgp.enums.signature.subkeyBinding;
      sig.publicKeyAlgorithm = m.keyPacket.algorithm;
      sig.hashAlgorithm = openpgp.enums.hash.sha256;
      sig.keyFlags = new Uint8Array([bind === 'sign' ? openpgp.enums.keyFlags.signData : openpgp.enums.keyFlags.encryptCommunication | openpgp.enums.keyFlags.encryptStorage]);
      // The typings omit sign's config argument, which openpgp reads.
      const sign = sig.sign.bind(sig) as (...a: unknown[]) => Promise<void>;
      await sign(m.keyPacket, { key: m.keyPacket, bind: sub }, new Date(deps.clock().getTime() - 60_000), false, openpgp.config);
      list.push(sig);
    }
    return openpgp.armor(openpgp.enums.armor.publicKey, list.write());
  }

  /** Signs up through the routes with `publicKey` (decrypted with `privateKey`): the new account's id (null if refused) and the finish answer. */
  async function register(publicKey: string, privateKey: string) {
    const display = uniq('Mal');
    const b = new Browser(app);
    const start = await b.post('/v1/register/pgp/start', { displayName: display, loginName: uniq('mal.login'), publicKey });
    expect(start.statusCode, start.body).toBe(200);
    const code = codeOf(await decrypt(start.json().encryptedMessage, privateKey));
    const finish = await b.post('/v1/register/pgp/finish', { challengeId: start.json().challengeId, code, deviceLabel: 'Laptop', acceptedTerms: deps.config.termsVersion });
    const { rows } = await deps.db.query<{ id: string }>('select id from accounts where display_key = $1', [display.toLowerCase()]);
    return { id: rows[0]?.id ?? null, finish };
  }

  /** Vera: an account, and her own PGP key (not yet stored). */
  async function vera() {
    return { id: await seedAccount(deps, { loginName: uniq('vera') }), key: await genKey() };
  }

  async function loginWith(key: { publicKey: string; privateKey: string }) {
    const b = new Browser(app);
    const start = await b.post('/v1/login/pgp/start', { key: key.publicKey });
    expect(start.statusCode, start.body).toBe(200);
    const code = codeOf(await decrypt(start.json().encryptedMessage, key.privateKey, undefined, deps.clock()));
    return b.post('/v1/login/pgp/finish', { challengeId: start.json().challengeId, code, deviceLabel: 'Desk' });
  }

  for (const bind of ['none', 'encrypt', 'sign'] as const) {
    it(`a banned account whose key carries another account's key as a subkey (${bind === 'none' ? 'no binding' : `bound for ${bind}, no back-signature`}) does not ban that account's key`, async () => {
      const v = await vera();
      const mallory = await genKey();
      const combined = await withForeignSubkey(mallory, v.key.publicKey, bind);
      // The reviewer's proof of concept: the combined key lists Vera's fingerprint among its subkeys.
      expect(await keyFingerprints(combined)).toContain(v.key.fingerprint.toLowerCase());
      // Mallory signs up before Vera's key is on file (afterwards, a bound copy is refused: below).
      const m = await register(combined, mallory.privateKey);
      expect(m.finish.statusCode, m.finish.body).toBe(201);
      // The sign-up proved Mallory's own encryption subkey (the challenge's recipient), not Vera's key.
      const mine = (await openpgp.readKey({ armoredKey: mallory.publicKey })).getSubkeys()[0]!.getFingerprint();
      expect((await deps.db.query('select proved_subkeys from pgp_keys where account_id = $1', [m.id])).rows).toEqual([{ proved_subkeys: [mine] }]);
      await insertPgpKey(deps.db, deps.config, { accountId: v.id, fingerprint: v.key.fingerprint, armored: v.key.publicKey, now: deps.clock() });
      await recordBan(deps, m.id!);
      await expect(assertKeyNotBanned(deps.db, deps.config, v.key.publicKey)).resolves.toBeUndefined();
      // Mallory's own key is banned.
      await expect(assertKeyNotBanned(deps.db, deps.config, mallory.publicKey)).rejects.toMatchObject({ code: 'key-unavailable' });
      const login = await loginWith(v.key);
      expect(login.statusCode, login.body).toBe(200);
    });
  }

  it('storableKey drops a subkey with no valid binding (the stored copy never carries it)', async () => {
    const v = await vera();
    const mallory = await genKey();
    const stored = await storableKey(await withForeignSubkey(mallory, v.key.publicKey, 'none'), deps.clock());
    expect(await keyFingerprints(stored)).toEqual(await keyFingerprints(mallory.publicKey));
    // A bound subkey is kept (a ban still skips it: above).
    const bound = await storableKey(await withForeignSubkey(mallory, v.key.publicKey, 'encrypt'), deps.clock());
    expect(await keyFingerprints(bound)).toContain(v.key.fingerprint.toLowerCase());
  });

  it("a key whose subkey is already another account's key is refused after proof (409 key-in-use) and creates nothing", async () => {
    const v = await vera();
    await insertPgpKey(deps.db, deps.config, { accountId: v.id, fingerprint: v.key.fingerprint, armored: v.key.publicKey, now: deps.clock() });
    const mallory = await genKey();
    const m = await register(await withForeignSubkey(mallory, v.key.publicKey, 'sign'), mallory.privateKey);
    expect([m.finish.statusCode, m.finish.json()]).toEqual([409, { error: 'key-in-use' }]);
    expect(m.id).toBeNull();
  });

  it('bans the subkeys the account proved, one a later login proved too, and signing subkeys that signed back', async () => {
    const k = await genKey({ subkeys: [{}, { sign: true }] });
    const id = await seedAccount(deps, { loginName: uniq('prover') });
    await insertPgpKey(deps.db, deps.config, { accountId: id, fingerprint: k.fingerprint, armored: k.publicKey, now: deps.clock() });
    // A newer encryption subkey: the next login's challenge goes to it, so that login proves it.
    const priv = await openpgp.readPrivateKey({ armoredKey: k.privateKey });
    const grown = await priv.addSubkey({ date: new Date(deps.clock().getTime() - 60_000) });
    const newEnc = grown.getSubkeys().at(-1)!.getFingerprint();
    const login = await loginWith({ publicKey: grown.toPublic().armor(), privateKey: grown.armor() });
    expect(login.statusCode, login.body).toBe(200);
    const { rows } = await deps.db.query<{ proved_subkeys: string[] }>('select proved_subkeys from pgp_keys where account_id = $1', [id]);
    expect(rows[0]!.proved_subkeys).toContain(newEnc);
    // login name + primary + first encryption subkey (proved at the write) + signing subkey + the new encryption subkey
    expect((await recordBan(deps, id)).recorded).toBe(2 + 4);
    for (const fp of await keyFingerprints(grown.toPublic().armor())) {
      await expect(recordBannedValues(deps.db, deps.config, { kind: 'pgp-fingerprint', values: [fp], accountId: null, now: deps.clock() })).resolves.toBe(0);
    }
  });

  it('an encryption subkey the account never proved is not banned', async () => {
    // Two encryption subkeys: challenges go to the newer one only.
    const k = await genKey({ subkeys: [{}, { date: new Date('2026-02-01T00:00:00Z') }] });
    const id = await seedAccount(deps, { loginName: uniq('twoenc') });
    await insertPgpKey(deps.db, deps.config, { accountId: id, fingerprint: k.fingerprint, armored: k.publicKey, now: deps.clock() });
    await recordBan(deps, id);
    const older = (await openpgp.readKey({ armoredKey: k.publicKey })).getSubkeys()[0]!.getFingerprint();
    expect((await keyFingerprints(k.publicKey)).length).toBe(3);
    // The older subkey is not on the list (recording it now adds a row); the primary is.
    await expect(recordBannedValues(deps.db, deps.config, { kind: 'pgp-fingerprint', values: [k.fingerprint.toLowerCase()], accountId: null, now: deps.clock() })).resolves.toBe(0);
    await expect(recordBannedValues(deps.db, deps.config, { kind: 'pgp-fingerprint', values: [older], accountId: null, now: deps.clock() })).resolves.toBe(1);
  });
});

