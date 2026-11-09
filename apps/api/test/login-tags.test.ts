// FU-D: the private login name is stored only as a keyed tag (X2F_LOGIN_NAME_KEYS).
import * as crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import type { Deps } from '../src/app.js';
import {
  assertLoginNamesTagged, createAccount, loginNameLookup, loginTag, openNames, sealNames, tagLoginNames,
} from '../src/accounts.js';
import type { Keyring } from '../src/config.js';
import { MIGRATIONS_DIR, migrate } from '../src/db/migrate.js';
import { issueConfirmToken } from '../src/auth/confirm.js';
import { ApiError } from '../src/errors.js';
import { accountIdByLoginName, currentLoginTag, seedAccount } from './helpers/accounts.js';
import { testApp, testConfig } from './helpers/app.js';
import { emptyDb } from './helpers/db.js';
import { fixtureLeakedList } from './helpers/leaked.js';
import { codeOf, decrypt, genKey } from './helpers/pgpKeys.js';
import { Browser, addTestLogin } from './helpers/totp.js';
import { VAPID_ENV } from './helpers/vapid.js';
import { SIG } from './helpers/signature.js';

// Every HMAC made while a request runs is counted (parity: the same HMAC work for every name).
vi.mock('node:crypto', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:crypto')>();
  return { ...real, createHmac: vi.fn(real.createHmac) };
});
const hmacSpy = vi.mocked(crypto.createHmac);

const API_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const T0 = new Date('2026-10-17T06:00:00Z');
const HOUR = 3600_000;
const TERMS = '2026-10-17';
const GOOD = 'Correct-Horse-9';

let app: FastifyInstance;
let deps: Deps;
let logs: string[];
let setNow: (d: Date) => void;
let cleanup: () => Promise<void>;
let original: Keyring;
let step = 0;
let n = 0;

beforeAll(async () => {
  const fixture = await fixtureLeakedList();
  cleanup = fixture.cleanup;
  ({ app, deps, setNow, logs } = await testApp({ leaked: fixture.list }));
  addTestLogin(app, deps);
  original = deps.config.loginNameKeys;
});

afterAll(async () => {
  await app.close();
  await cleanup();
});

beforeEach(() => {
  // Each test starts a day later: request budgets refill and throttle streaks end.
  setNow(new Date(T0.getTime() + ++step * 24 * HOUR));
  deps.config.loginNameKeys = original;
});

const uniq = (p = 'tag') => `${p}${String(++n).padStart(4, '0')}x`;
const key32 = () => new Uint8Array(crypto.randomBytes(32));
/** A ring with a new current key `id` in front of the test's original key 1. */
const rotated = (id = 2): Keyring => ({ current: id, keys: new Map([[id, key32()], ...original.keys]) });

const register = (b: Browser, loginName: string, displayName = `P${loginName}`) =>
  b.post('/v1/register/password', { displayName, loginName, password: GOOD, deviceLabel: 'T', acceptedTerms: TERMS, termsSignature: SIG });
const login = (loginName: string, password = GOOD, b = new Browser(app)) =>
  b.post('/v1/login/password', { loginName, password, deviceLabel: 'T' });
const backup = (loginName: string, code: string, b = new Browser(app)) =>
  b.post('/v1/login/backup', { loginName, kind: 'recovery-code', code, deviceLabel: 'T' });

/** Every public table's pg_stats rows (sampled values, histograms) as one text. */
async function statsDump(db: Deps['db']) {
  const { rows } = await db.query<{ dump: string | null }>(`select string_agg(s::text, '') as dump from pg_stats s where schemaname = 'public'`);
  return rows[0]!.dump ?? '';
}

async function tagRow(id: string) {
  const { rows } = await deps.db.query<{ login_tag: Buffer | null; login_tag_key_id: number | null; login_name: string | null; login_key: string | null }>(
    'select login_tag, login_tag_key_id, login_name, login_key from accounts where id = $1',
    [id],
  );
  return rows[0]!;
}

/** A password account under key `keyId` of the ring now in `deps.config` (seeded directly). */
async function passwordAccount(keyId?: number) {
  const loginName = uniq();
  const id = await seedAccount(deps, { loginName, ...(keyId !== undefined ? { loginKeyId: keyId } : {}) });
  const { hashPassword } = await import('../src/auth/password.js');
  const h = await hashPassword(deps.config, GOOD);
  await deps.db.query('insert into passwords (account_id, hash, pepper_id, updated_at) values ($1, $2, $3, now())', [id, h.hash, h.pepperId]);
  return { id, loginName };
}

describe('the tag', () => {
  it('is HMAC-SHA-256 of "x2f/login-name\\0" + the lower-cased NFC name', () => {
    const key = key32();
    const expected = crypto.createHmac('sha256', key).update('x2f/login-name\0alice.secret', 'utf8').digest();
    expect(loginTag(key, 'Alice.Secret')).toEqual(expected);
    expect(loginTag(key, 'ALICE.SECRET')).toEqual(expected);
    expect(loginTag(key, 'é')).toEqual(loginTag(key, 'é'));
    expect(loginTag(key32(), 'alice.secret')).not.toEqual(expected);
  });

  it('a lookup computes the name under every key of the ring, once each, whatever the input', () => {
    deps.config.loginNameKeys = { current: 3, keys: new Map([[3, key32()], [2, key32()], [1, key32()]]) };
    for (const input of ['Known.Name1', 'ghost.name', 'bad name!', '', 'x'.repeat(500)]) {
      const r = loginNameLookup(deps.config, input);
      expect(r.candidates.ids, input).toEqual([3, 2, 1]);
      expect(r.candidates.tags, input).toHaveLength(3);
      expect(r.candidates.current, input).toEqual(r.candidates.tags[0]);
    }
    const ok = loginNameLookup(deps.config, 'Known.Name1');
    expect(ok.valid).toBe(true);
    expect(ok.candidates.tags[1]).toEqual(loginTag(deps.config.loginNameKeys.keys.get(2)!, 'known.name1'));
    expect(loginNameLookup(deps.config, 'bad name!').valid).toBe(false);
  });
});

describe('I-1 parity under a two-key ring', () => {
  /** The SQL a request runs (whitespace normalised) and the HMACs it makes: in total and under a login-name key. */
  async function work(run: () => Promise<{ statusCode: number }>, status = 401) {
    const query = vi.spyOn(deps.db, 'query');
    hmacSpy.mockClear();
    try {
      expect((await run()).statusCode).toBe(status);
      const ring = [...deps.config.loginNameKeys.keys.values()];
      return {
        sql: JSON.stringify(query.mock.calls.map((c) => String(c[0]).replace(/\s+/g, ' ').trim())),
        hmacs: hmacSpy.mock.calls.length,
        loginHmacs: hmacSpy.mock.calls.filter((c) => ring.some((k) => Buffer.from(k as Uint8Array).equals(Buffer.from(c[1] as Uint8Array)))).length,
      };
    } finally {
      query.mockRestore();
    }
  }

  it('password login: old-key, current-key, unknown and malformed names cost the same queries and HMACs', async () => {
    const old = await passwordAccount(1);
    deps.config.loginNameKeys = rotated();
    const current = await passwordAccount();
    const results = [];
    for (const name of [old.loginName, current.loginName, uniq('ghost'), 'bad name!', 'x'.repeat(200)]) {
      results.push(await work(() => login(name, 'Wrong-Horse-9')));
    }
    expect(new Set(results.map((r) => r.sql)).size).toBe(1);
    expect(new Set(results.map((r) => r.hmacs)).size).toBe(1);
    expect(results.map((r) => r.loginHmacs)).toEqual([2, 2, 2, 2, 2]);
    // A failed login moves nothing.
    expect((await tagRow(old.id)).login_tag_key_id).toBe(1);
  });

  it('backup login: old-key, current-key, unknown and malformed names cost the same queries and HMACs', async () => {
    const old = await passwordAccount(1);
    deps.config.loginNameKeys = rotated();
    const current = await passwordAccount();
    const results = [];
    for (const name of [old.loginName, current.loginName, uniq('ghost'), 'bad name!']) {
      results.push(await work(() => backup(name, 'ABCD-EFGH-JKMN-PQRT')));
    }
    expect(new Set(results.map((r) => r.sql)).size).toBe(1);
    expect(new Set(results.map((r) => r.hmacs)).size).toBe(1);
    expect(results.map((r) => r.loginHmacs)).toEqual([2, 2, 2, 2]);
  });
});

describe('rotation', () => {
  it('password: a name under the old key still logs in, then the row is re-tagged under the current key', async () => {
    const { id, loginName } = await passwordAccount(1);
    deps.config.loginNameKeys = rotated();
    // One browser: a password alone on a new device starts the 24-hour hold, during which only a
    // browser already logged in may log in again (Task 17 review round 2 N-C1).
    const b = new Browser(app);
    expect((await login(loginName, GOOD, b)).statusCode).toBe(200);
    const row = await tagRow(id);
    expect(row.login_tag_key_id).toBe(2);
    expect(row.login_tag).toEqual(currentLoginTag(deps, loginName, 2));
    // Once moved, the old key can leave the ring.
    deps.config.loginNameKeys = { current: 2, keys: new Map([[2, deps.config.loginNameKeys.keys.get(2)!]]) };
    expect((await login(loginName, GOOD, b)).statusCode).toBe(200);
    expect((await tagRow(id)).login_tag_key_id).toBe(2);
  });

  it('password: a name still under a key that has left the ring fails like an unknown name', async () => {
    const { id, loginName } = await passwordAccount(1);
    deps.config.loginNameKeys = { current: 2, keys: new Map([[2, key32()]]) };
    expect((await login(loginName)).json()).toMatchObject({ error: 'credentials-invalid' });
    expect((await tagRow(id)).login_tag_key_id).toBe(1);
  });

  it('a wrong password does not re-tag; a disabled account is not re-tagged either', async () => {
    const { id, loginName } = await passwordAccount(1);
    deps.config.loginNameKeys = rotated();
    expect((await login(loginName, 'Wrong-Horse-9')).statusCode).toBe(401);
    await deps.db.query('update accounts set disabled_at = now() where id = $1', [id]);
    expect((await login(loginName)).statusCode).toBe(403);
    expect((await tagRow(id)).login_tag_key_id).toBe(1);
  });

  it('backup login with a recovery code re-tags the row', async () => {
    const { id, loginName } = await passwordAccount(1);
    const b = new Browser(app);
    expect((await b.post('/t/login', { accountId: id, firstSession: true })).statusCode).toBe(200);
    const res = await b.post('/v1/account/recovery-codes', {});
    expect(res.statusCode).toBe(200);
    const [code] = (res.json() as { codes: string[] }).codes;
    deps.config.loginNameKeys = rotated(9);
    expect((await backup(loginName, code!)).statusCode).toBe(200);
    expect((await tagRow(id)).login_tag_key_id).toBe(9);
    expect((await tagRow(id)).login_tag).toEqual(currentLoginTag(deps, loginName, 9));
  });
});

describe('the re-tag is best-effort (review M1)', () => {
  /** Runs `run` with the re-tag's update failing like a dropped connection; every other query runs. */
  async function retagFails<T>(run: () => Promise<T>): Promise<T> {
    const real = deps.db.query.bind(deps.db) as (...a: unknown[]) => Promise<unknown>;
    const query = vi.spyOn(deps.db, 'query').mockImplementation(((...a: unknown[]) =>
      String(a[0]).startsWith('update accounts set login_tag = $2, login_tag_key_id = $3 where id = $1')
        ? Promise.reject(Object.assign(new Error('Connection terminated unexpectedly'), { code: '57P01' }))
        : real(...a)) as never);
    try {
      return await run();
    } finally {
      query.mockRestore();
    }
  }

  it('password: a failing re-tag still logs in; the row stays under the old key and the next login moves it', async () => {
    const { id, loginName } = await passwordAccount(1);
    deps.config.loginNameKeys = rotated();
    // One browser (the hold of a password alone on a new device: Task 17 review round 2 N-C1).
    const b = new Browser(app);
    const res = await retagFails(() => login(loginName, GOOD, b));
    expect(res.statusCode).toBe(200);
    expect(res.headers['set-cookie']).toBeDefined();
    expect((await tagRow(id)).login_tag_key_id).toBe(1);
    expect((await login(loginName, GOOD, b)).statusCode).toBe(200);
    expect((await tagRow(id)).login_tag_key_id).toBe(2);
  });

  it('recovery code: a failing re-tag after the code is burned still starts the session', async () => {
    const { id, loginName } = await passwordAccount(1);
    const b = new Browser(app);
    expect((await b.post('/t/login', { accountId: id, firstSession: true })).statusCode).toBe(200);
    const [code] = ((await b.post('/v1/account/recovery-codes', {})).json() as { codes: string[] }).codes;
    deps.config.loginNameKeys = rotated();
    const res = await retagFails(() => backup(loginName, code!));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', level: 'recovery' });
    expect((await tagRow(id)).login_tag_key_id).toBe(1);
    expect(logs.join('\n')).not.toContain(loginName.toLowerCase());
  });
});

describe('uniqueness across keys', () => {
  it('a name held under an old key cannot be signed up again under the current key: names-unavailable', async () => {
    const { loginName } = await passwordAccount(1);
    deps.config.loginNameKeys = rotated();
    const res = await register(new Browser(app), loginName.toUpperCase());
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'names-unavailable' });
    const tags = [currentLoginTag(deps, loginName, 1), currentLoginTag(deps, loginName, 2)];
    const { rows } = await deps.db.query('select 1 from accounts where login_tag = any($1::bytea[])', [tags]);
    expect(rows).toHaveLength(1);
  });

  it('two sign-ups racing for one name: one account, the other gets names-unavailable', async () => {
    deps.config.loginNameKeys = rotated();
    const name = uniq('race');
    const results = await Promise.all([register(new Browser(app), name, `A${name}`), register(new Browser(app), name, `B${name}`)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.statusCode === 409)!.json()).toEqual({ error: 'names-unavailable' });
    expect(await accountIdByLoginName(deps, name)).toBeDefined();
  });

  it('two processes with different current keys (a rolling key change) cannot both create one name', async () => {
    const a = rotated();
    // The other process still has key 1 first, but already holds key 2.
    const b: Keyring = { current: 1, keys: new Map([[1, original.keys.get(1)!], [2, a.keys.get(2)!]]) };
    const name = uniq('roll');
    const names = (d: string) => ({
      displayName: d, displayKey: d.toLowerCase(), loginKey: name.toLowerCase(), kind: 'trader' as const, termsVersion: TERMS, termsSignature: SIG, now: new Date(),
    });
    const first = await deps.db.connect();
    const second = await deps.db.connect();
    try {
      await first.query('begin');
      await second.query('begin');
      await createAccount(first, { ...deps.config, loginNameKeys: a }, names(`A${name}`));
      // The second sign-up waits for the first one's transaction, then sees its row under key 2.
      const racing = createAccount(second, { ...deps.config, loginNameKeys: b }, names(`B${name}`)).then(
        () => 'created',
        (e: ApiError) => e.code,
      );
      await new Promise((r) => setTimeout(r, 200));
      await first.query('commit');
      expect(await racing).toBe('names-unavailable');
    } finally {
      await second.query('rollback');
      first.release();
      second.release();
    }
  });

  it('a new account is tagged under the current key, never stored in plaintext', async () => {
    deps.config.loginNameKeys = rotated(5);
    const name = uniq('new');
    expect((await register(new Browser(app), name)).statusCode).toBe(201);
    const row = await tagRow((await accountIdByLoginName(deps, name))!);
    expect(row).toEqual({ login_tag: currentLoginTag(deps, name, 5), login_tag_key_id: 5, login_name: null, login_key: null });
  });

  // Security review 2026-11-08, finding 9. `npm run typecheck` is what enforces these.
  it('createAccount needs a signature and a version for a trader, by type', () => {
    type Args = Parameters<typeof createAccount>[2];
    const base = { displayName: 'A', displayKey: 'a', loginKey: 'b', now: new Date() };
    // @ts-expect-error a trader must carry a signature
    const unsigned: Args = { ...base, kind: 'trader', termsVersion: TERMS };
    // @ts-expect-error a trader must carry a Terms version
    const unversioned: Args = { ...base, kind: 'trader', termsVersion: null, termsSignature: SIG };
    // @ts-expect-error a signature belongs to a trader only
    const staffSigned: Args = { ...base, kind: 'staff', termsVersion: null, termsSignature: SIG };
    const staff: Args = { ...base, kind: 'staff', termsVersion: null };
    expect([unsigned, unversioned, staffSigned, staff]).toHaveLength(4);
  });

  it('createAccount refuses equal names itself (the check SQL can no longer make)', async () => {
    const client = await deps.db.connect();
    try {
      await client.query('begin');
      await expect(
        createAccount(client, deps.config, {
          displayName: 'Same.Name1', displayKey: 'same.name1', loginKey: 'same.name1',
          kind: 'trader', termsVersion: TERMS, termsSignature: SIG, now: new Date(),
        }),
      ).rejects.toEqual(new ApiError(400, 'names-same'));
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
});

describe('one namespace for both names with tags (FU-A review I1, coordination note 2)', () => {
  const names = (display: string, login: string) => ({
    displayName: display, displayKey: display.toLowerCase(), loginKey: login.toLowerCase(), kind: 'trader' as const, termsVersion: TERMS, termsSignature: SIG, now: new Date(),
  });

  it("B: a display name that is someone's login name under an old key is refused at create (names-unavailable)", async () => {
    const { loginName } = await passwordAccount(1);
    deps.config.loginNameKeys = rotated();
    const res = await register(new Browser(app), uniq('carol'), loginName.toUpperCase());
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'names-unavailable' });
  });

  it("A: a login name that is someone's display name is refused, even when the display name appears after the sign-up started", async () => {
    // At start (cheap, display names are public): FU-A's assertDisplayNameFree.
    const alice = uniq('Mira.K');
    expect((await register(new Browser(app), uniq('alice'), alice)).statusCode).toBe(201);
    const early = await register(new Browser(app), alice.toUpperCase(), uniq('Bob.T'));
    expect(early.json()).toEqual({ error: 'names-unavailable' });
    // At create, under the lock: the display name was taken between a sign-up's start and finish.
    const late = uniq('Late.D');
    await seedAccount(deps, { loginName: uniq('late'), displayName: late });
    const client = await deps.db.connect();
    try {
      await client.query('begin');
      await expect(createAccount(client, deps.config, names(uniq('Dave.T'), late))).rejects.toEqual(new ApiError(409, 'names-unavailable'));
    } finally {
      await client.query('rollback');
      client.release();
    }
  });

  it('crossing sign-ups (display x, login y and display y, login x) racing: exactly one is created', async () => {
    const [x, y] = [uniq('Cross.X'), uniq('Cross.Y')];
    const first = await deps.db.connect();
    const second = await deps.db.connect();
    try {
      await first.query('begin');
      await second.query('begin');
      await createAccount(first, deps.config, names(x, y));
      const racing = createAccount(second, deps.config, names(y, x)).then(
        () => 'created',
        (e: ApiError) => e.code,
      );
      await new Promise((r) => setTimeout(r, 200));
      await first.query('commit');
      expect(await racing).toBe('names-unavailable');
    } finally {
      await second.query('rollback');
      first.release();
      second.release();
    }
  });

  it('the login-name route of a pre-009 account checks both namespaces under every key', async () => {
    const { loginName } = await passwordAccount(1);
    deps.config.loginNameKeys = rotated();
    const id = await seedAccount(deps, { loginName: null, displayName: uniq('Old.T') });
    const b = new Browser(app);
    const { sessionId } = (await b.post('/t/login', { accountId: id })).json() as { sessionId: string };
    const set = async (name: string) =>
      b.post('/v1/account/login-name', {
        loginName: name, confirmToken: await issueConfirmToken(deps, { sessionId, accountId: id, action: { kind: 'set-login-name' }, method: 'password' }),
      });
    expect((await set(loginName)).json()).toEqual({ error: 'names-unavailable' }); // a login name under the old key
    const fresh = uniq('fresh');
    expect((await set(fresh)).statusCode).toBe(200);
    expect(await tagRow(id)).toEqual({ login_tag: currentLoginTag(deps, fresh, 2), login_tag_key_id: 2, login_name: null, login_key: null });
  });
});

describe('sealed names in a waiting sign-up (FU-A review note 1)', () => {
  it('round-trips; holds no plaintext login name; anything that does not open is challenge-expired', () => {
    const n = { displayName: 'Shown.Name1', displayKey: 'shown.name1', loginKey: 'very.secret1' };
    const sealed = sealNames(deps.config, n);
    expect(JSON.stringify(sealed)).not.toContain('very.secret1');
    expect(sealed.displayName).toBe('Shown.Name1');
    expect(openNames(deps.config, sealed)).toEqual(n);
    expect(sealNames(deps.config, n).login).not.toBe(sealed.login); // a fresh nonce each time
    const raw = Buffer.from(sealed.login, 'base64url');
    raw[raw.length - 1]! ^= 1;
    for (const bad of [
      { ...sealed, login: raw.toString('base64url') }, { ...sealed, login: '' }, { ...sealed, login: 1 }, null, 'x',
      // A payload from before FU-D (plaintext names) cannot finish.
      { displayName: 'Shown.Name1', displayKey: 'shown.name1', loginName: 'very.secret1', loginKey: 'very.secret1' },
    ]) {
      expect(() => openNames(deps.config, bad)).toThrow(new ApiError(400, 'challenge-expired'));
    }
    expect(() => openNames(testConfig(), sealed)).toThrow(new ApiError(400, 'challenge-expired'));
  });

  it('a PGP sign-up started under one login-name key finishes after the ring rotated, tagged under the new key', async () => {
    const pair = await genKey();
    const loginName = uniq('pgpsign');
    const b = new Browser(app);
    const start = await b.post('/v1/register/pgp/start', { displayName: uniq('Shown.Pgp'), loginName, publicKey: pair.publicKey });
    expect(start.statusCode).toBe(200);
    const { challengeId, encryptedMessage } = start.json() as { challengeId: string; encryptedMessage: string };
    const code = codeOf(await decrypt(encryptedMessage, pair.privateKey, undefined, deps.clock()));
    deps.config.loginNameKeys = rotated(6);
    const res = await b.post('/v1/register/pgp/finish', { challengeId, code, deviceLabel: 'T', acceptedTerms: TERMS, termsSignature: SIG });
    expect(res.statusCode).toBe(201);
    const id = (await accountIdByLoginName(deps, loginName))!;
    expect((await tagRow(id)).login_tag_key_id).toBe(6);
  });
});

describe('no plaintext login name anywhere', () => {
  it('not in responses, logs or any table after sign-up, logins and failed logins', async () => {
    const secret = uniq('Hidden.Login');
    const b = new Browser(app);
    const bodies: string[] = [];
    const keep = <R extends { body: string }>(r: R): R => (bodies.push(r.body), r);
    keep(await register(b, secret, uniq('Shown.Name')));
    keep(await login(secret));
    keep(await login(secret, 'Wrong-Horse-9'));
    keep(await backup(secret, 'ABCD-EFGH-JKMN-PQRT'));
    keep(await new Browser(app).post('/v1/login/webauthn/start', { loginName: secret }));
    // Sign-ups that wait in a challenge (PGP code, WebAuthn ceremony) keep the login name sealed meanwhile.
    const other = uniq('Hidden.Other');
    const pgp = keep(await new Browser(app).post('/v1/register/pgp/start', { displayName: uniq('Shown.Pgp'), loginName: other, publicKey: (await genKey()).publicKey }));
    expect(pgp.statusCode).toBe(200);
    const wa = keep(await new Browser(app).post('/v1/register/webauthn/start', { displayName: uniq('Shown.Wa'), loginName: other, kind: 'passkey' }));
    expect(wa.statusCode).toBe(200);
    const me = keep(await b.get('/v1/account/me'));
    expect(me.json()).toMatchObject({ needsLoginName: false });
    const needles = [secret.toLowerCase(), other.toLowerCase()];
    const clean = (text: string) => needles.every((needle) => !text.toLowerCase().includes(needle));
    for (const body of bodies) expect(clean(body), body).toBe(true);
    expect(clean(logs.join('\n'))).toBe(true);
    const { rows: tables } = await deps.db.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    expect(tables.length).toBeGreaterThan(5);
    for (const { table_name } of tables) {
      // Table names come from the catalogue, never from input.
      const { rows } = await deps.db.query<{ dump: string | null }>(`select string_agg(t::text, '') as dump from "${table_name}" t`);
      expect(clean(rows[0]!.dump ?? ''), table_name).toBe(true);
    }
    // The planner's samples of every column (pg_stats over pg_statistic; FU-D round-2 N1) hold none either.
    await deps.db.query('analyze');
    expect(clean(await statsDump(deps.db)), 'pg_stats').toBe(true);
  });
});

describe('migration 012 and the tag-login-names tool', () => {
  it('tags every plaintext row, nulls the plaintext, is idempotent, prints counts only; the API refuses to start until then', async () => {
    const db = await emptyDb();
    const dir = await mkdtemp(join(tmpdir(), 'x2f-mig-'));
    try {
      for (const f of (await readdir(MIGRATIONS_DIR)).filter((f) => f < '012')) await copyFile(join(MIGRATIONS_DIR, f), join(dir, f));
      await migrate(db, dir);
      // As 009 left them: two accounts with private login names, and a pre-009 one (legacy: its login
      // name is its display name until it sets one).
      const insert = (display: string, login: string) =>
        db.query(
          `insert into accounts (display_name, display_key, login_name, login_key, legacy_login_name, kind, webauthn_user_id, created_at)
           values ($1, $2, $3, $4, $5, 'trader', $6, now()) returning id`,
          [display, display.toLowerCase(), login, login.toLowerCase(), login === display, crypto.randomBytes(32)],
        );
      const a = (await insert('Shown.One1', 'Tool.Secret1')).rows[0].id as string;
      const c = (await insert('Shown.Two2', 'Tool.Secret2')).rows[0].id as string;
      const legacy = (await insert('Shown.Three3', 'Shown.Three3')).rows[0].id as string;
      // A sign-up waiting in a challenge with its login name in plaintext (FU-A review note 1).
      await db.query(
        `insert into challenges (purpose, method, payload, created_at, expires_at)
         values ('register', 'pgp', $1, now(), now() + interval '5 minutes'), ('login', 'pgp', '{}', now(), now() + interval '5 minutes')`,
        [{ names: { displayName: 'Shown.Four4', displayKey: 'shown.four4', loginName: 'Tool.Secret4', loginKey: 'tool.secret4' } }],
      );
      expect((await db.query("select kind from name_keys where key like 'tool.%'")).rows).toHaveLength(2);
      // As autovacuum would have done by now: the planner's samples (pg_statistic) hold the names.
      await db.query('analyze accounts, name_keys');
      expect((await statsDump(db)).toLowerCase()).toContain('tool.secret1');
      await migrate(db);
      // 012 ends the waiting sign-up (and only it).
      expect((await db.query('select purpose from challenges')).rows).toEqual([{ purpose: 'login' }]);
      // The plaintext is still there until the tool runs, and the API will not start on it.
      const before = await db.query('select count(*)::int as n from accounts where login_key is not null');
      expect(before.rows[0].n).toBe(3);
      const refused = await assertLoginNamesTagged(db).then(() => null, (e: Error) => e.message);
      expect(refused).toMatch(/3 login names are not tagged yet.*tag-login-names/);
      expect(refused!.toLowerCase()).not.toContain('tool.secret');

      // The real tool, as an operator runs it: full settings in the environment.
      const config = testConfig({ loginNameKeys: { current: 4, keys: new Map([[4, key32()]]) } });
      const name = (await db.query<{ name: string }>('select current_database() as name')).rows[0]!.name;
      const b64 = (k: Uint8Array) => Buffer.from(k).toString('base64');
      const ring = (r: Keyring) => [...r.keys].map(([id, k]) => `${id}:${b64(k)}`).join(',');
      const env = {
        PATH: process.env.PATH, X2F_ORIGINS: 'https://x2f.test', X2F_RP_ID: 'x2f.test', DATABASE_URL: `${inject('pgUrl')}/${name}`,
        X2F_LEAKED_LIST_PATH: '/nonexistent', X2F_SERVER_KEY: b64(config.serverKey), X2F_MONERO_NETWORK: 'stagenet',
        X2F_TERMS_VERSION: TERMS, X2F_PGP_SIGNING_KEY_PATH: '/nonexistent', X2F_PGP_SIGNING_FINGERPRINT: '0'.repeat(40),
        X2F_PASSWORD_PEPPERS: ring(config.passwordPeppers), X2F_RECOVERY_CODE_KEYS: ring(config.recoveryCodeKeys),
        X2F_TOTP_KEYS: ring(config.totpKeys), X2F_LOGIN_NAME_KEYS: ring(config.loginNameKeys), ...VAPID_ENV,
      };
      const run = spawnSync(join(API_DIR, '..', '..', 'node_modules', '.bin', 'tsx'), ['src/tools/tag-login-names.ts'], {
        cwd: API_DIR, env, encoding: 'utf8', timeout: 60_000,
      });
      expect(run.stderr).toBe('');
      expect(run.status).toBe(0);
      expect(run.stdout).toBe('{"tagged":3}\n');

      const { rows } = await db.query(
        'select id, login_tag, login_tag_key_id, login_name, login_key, legacy_login_name from accounts order by display_name',
      );
      const key = config.loginNameKeys.keys.get(4)!;
      expect(rows).toEqual([
        { id: a, login_tag: loginTag(key, 'tool.secret1'), login_tag_key_id: 4, login_name: null, login_key: null, legacy_login_name: false },
        { id: legacy, login_tag: loginTag(key, 'shown.three3'), login_tag_key_id: 4, login_name: null, login_key: null, legacy_login_name: true },
        { id: c, login_tag: loginTag(key, 'tool.secret2'), login_tag_key_id: 4, login_name: null, login_key: null, legacy_login_name: false },
      ]);
      // The name_keys trigger dropped the plaintext login entries: display keys only.
      expect((await db.query('select key, kind from name_keys order by key')).rows).toEqual([
        { key: 'shown.one1', kind: 'display' }, { key: 'shown.three3', kind: 'display' }, { key: 'shown.two2', kind: 'display' },
      ]);
      expect(await tagLoginNames({ db, config })).toEqual({ tagged: 0 });
      // Migration 012 step 1's SQL, as documented (FU-D round-2 N1): no sampled name is left in pg_stats.
      for (const sql of ['ANALYZE accounts, name_keys', 'VACUUM FULL accounts, name_keys, pg_statistic', 'CHECKPOINT']) await db.query(sql);
      const stats = (await statsDump(db)).toLowerCase();
      expect(stats).toContain('shown.one1');
      expect(stats).not.toContain('tool.secret');
      await assertLoginNamesTagged(db);
      // The tagged row is found by the login lookup.
      const found = loginNameLookup(config, 'TOOL.secret1').candidates;
      const hit = await db.query(
        'select id from accounts a where (a.login_tag_key_id, a.login_tag) in (select * from unnest($1::smallint[], $2::bytea[]))',
        [found.ids, found.tags],
      );
      expect(hit.rows).toEqual([{ id: a }]);
    } finally {
      await db.end();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

