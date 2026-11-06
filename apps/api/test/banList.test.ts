import type { FastifyInstance } from 'fastify';
import * as openpgp from 'openpgp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAccount, assertDisplayNameFree, type NewNames } from '../src/accounts.js';
import type { Deps } from '../src/app.js';
import { insertPgpKey } from '../src/auth/pgp.js';
import { jabberBanned, keyFingerprints, normalizeJabber, recordBan, recordBannedValues } from '../src/bans.js';
import { ApiError } from '../src/errors.js';
import { seedAccount } from './helpers/accounts.js';
import { testApp } from './helpers/app.js';
import { genKey } from './helpers/pgpKeys.js';
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
    const id = await createAccount(c, deps.config, { ...n, kind: 'trader', termsVersion: deps.config.termsVersion, now: deps.clock() });
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
  it('at sign-up: the banned primary key → 409 key-unavailable', async () => {
    const b = await banned();
    const res = await new Browser(app).post('/v1/register/pgp/start', { displayName: uniq('Newbie'), loginName: uniq('new.login'), publicKey: b.key.publicKey });
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json()).toEqual({ error: 'key-unavailable' });
  });

  it('a key whose subkey is banned is refused too', async () => {
    const k = await genKey({ subkeys: [{}, { sign: true }] });
    const key = await openpgp.readKey({ armoredKey: k.publicKey });
    const sub = key.getSubkeys()[1]!.getFingerprint();
    await recordBannedValues(deps.db, deps.config, { kind: 'pgp-fingerprint', values: [sub], accountId: null, now: deps.clock() });
    const res = await new Browser(app).post('/v1/register/pgp/start', { displayName: uniq('Newbie'), loginName: uniq('new.login'), publicKey: k.publicKey });
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json()).toEqual({ error: 'key-unavailable' });
  });

  it('as a new key on another account: POST /v1/account/pgp/start → 409 key-unavailable before any confirm', async () => {
    const b = await banned();
    const other = await seedAccount(deps, { loginName: uniq('keyadder') });
    const br = new Browser(app);
    expect((await br.post('/t/login', { accountId: other })).statusCode).toBe(200);
    const res = await br.post('/v1/account/pgp/start', { publicKey: b.key.publicKey });
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json()).toEqual({ error: 'key-unavailable' });
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
    expect(normalizeJabber('a@')).toBeNull();
  });

  it('jabberBanned is true for a banned account, false for others', async () => {
    await banned({ jabber: 'evil@jabber.example' });
    expect(await jabberBanned(deps.db, deps.config, 'EVIL@jabber.example/laptop')).toBe(true);
    expect(await jabberBanned(deps.db, deps.config, 'good@jabber.example')).toBe(false);
    expect(await jabberBanned(deps.db, deps.config, 'garbage')).toBe(false);
  });
});

