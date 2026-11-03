// Plan 4 Task 6: owner first-run setup (a one-time code printed to stderr, the pending owner
// account, two attested security keys, the PGP key, finish, and the page locked for good).
import { createHash } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keyCheckCode } from '@x2f/staff';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../../src/app.js';
import { fileAttestationPolicy } from '../../src/auth/attestation.js';
import type { AttestationPolicy } from '../../src/auth/attestation.js';
import { SETUP_TRIES_PER_HOUR, ensureSetupCode } from '../../src/staff/ownerSetup.js';
import { startStaffApi } from '../../src/staff/main.js';
import { captureLogs } from '../helpers/logs.js';
import { codeOf, decrypt, genKey, type Pair } from '../helpers/pgpKeys.js';
import { createSoftAuthenticator, createTestCa, writeTestMds, type SoftAuthenticator, type TestCa } from '../helpers/softAuthenticator.js';
import { STAFF_ORIGIN, StaffBrowser, errorOf, insertSession, logEntries, staffApps } from '../helpers/staffApp.js';

const ALLOWED = '11111111-2222-4333-8444-555555555555';
const T0 = new Date('2026-11-02T12:00:00Z');
const HOUR = 3600_000;
const LINE = /^X2F owner setup code: ([0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}) \(valid until the owner account is created\)\n$/;

const SETUP_ROUTES = [
  '/staff/v1/setup/code',
  '/staff/v1/setup/account',
  '/staff/v1/setup/key/start',
  '/staff/v1/setup/key/finish',
  '/staff/v1/setup/pgp/start',
  '/staff/v1/setup/pgp/finish',
  '/staff/v1/setup/finish',
];

let ca: TestCa;
let attestation: AttestationPolicy;
let pgp: Pair;
let pgp2: Pair;

beforeAll(async () => {
  ca = createTestCa();
  const dir = await mkdtemp(join(tmpdir(), 'x2f-mds-'));
  await writeTestMds(dir, ca, { statements: [ALLOWED], allow: [ALLOWED], ownerAllow: [ALLOWED] });
  attestation = fileAttestationPolicy(dir);
  await attestation.init();
  [pgp, pgp2] = await Promise.all([genKey(), genKey()]);
});

/** A fresh database per test: setup locks for good, so no test can share one. */
let open: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of open) await c();
  open = [];
});

async function fresh(): Promise<{ app: FastifyInstance; deps: Deps; setNow(d: Date): void; logs: string[] }> {
  const s = await staffApps({ attestation });
  s.setNow(T0);
  open.push(s.close);
  return s;
}

const key = (): SoftAuthenticator => createSoftAuthenticator({ backedUp: false, userVerified: true, attestation: { aaguid: ALLOWED, ca } });

async function enterCode(b: StaffBrowser, code: string): Promise<LightMyRequestResponse> {
  return b.post('/staff/v1/setup/code', { code });
}

async function addKey(b: StaffBrowser, k: SoftAuthenticator): Promise<LightMyRequestResponse> {
  const start = await b.post('/staff/v1/setup/key/start', {});
  expect(start.statusCode, start.body).toBe(200);
  const { challengeId, options } = start.json();
  return b.post('/staff/v1/setup/key/finish', { challengeId, response: k.register(options, STAFF_ORIGIN), label: 'Main key' });
}

async function addPgp(b: StaffBrowser, deps: Deps, pair: Pair): Promise<LightMyRequestResponse> {
  const start = await b.post('/staff/v1/setup/pgp/start', { publicKey: pair.publicKey });
  expect(start.statusCode, start.body).toBe(200);
  const code = codeOf(await decrypt(start.json().encryptedMessage, pair.privateKey, undefined, deps.clock()));
  return b.post('/staff/v1/setup/pgp/finish', { challengeId: start.json().challengeId, code });
}

/** Code and account; returns the browser holding the setup cookie. */
async function begin(app: FastifyInstance, deps: Deps, username = 'lumen.k', loginName = 'lumen-login'): Promise<StaffBrowser> {
  const code = (await ensureSetupCode(deps))!;
  const b = new StaffBrowser(app);
  expect((await enterCode(b, code)).statusCode).toBe(200);
  const acc = await b.post('/staff/v1/setup/account', { username, loginName });
  expect(acc.statusCode, acc.body).toBe(201);
  return b;
}

describe('the setup code', () => {
  it('is printed once to stderr at startup, never to the structured log, stored only as its SHA-256, and reused across restarts', async () => {
    const { deps } = await fresh();
    const lines: string[] = [];
    const { stream, logs } = captureLogs();
    const listen = { origin: STAFF_ORIGIN, host: '127.0.0.1', port: 0 };
    const first = await startStaffApi(deps, listen, { stderr: (l) => void lines.push(l), logStream: stream });
    await first.close();
    expect(lines).toHaveLength(1);
    const code = LINE.exec(lines[0]!)![1]!;
    expect(logs.join('\n')).not.toContain(code);
    expect(logs.join('\n')).not.toContain(code.replaceAll('-', ''));

    // Only the hash is stored: nothing in the row spells the code.
    const { rows } = await deps.db.query<{ code_hash: Buffer }>('select * from owner_setup');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.code_hash.equals(createHash('sha256').update(code).digest())).toBe(true);
    expect(JSON.stringify(rows[0])).not.toContain(code.replaceAll('-', ''));

    // A restart prints the same code (still unused), and only once.
    const second = await startStaffApi(deps, listen, { stderr: (l) => void lines.push(l), logStream: stream });
    await second.close();
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe(lines[0]);
    expect(await ensureSetupCode(deps)).toBe(code);
  });

  it('refuses a wrong code, and the 11th try in an hour (even the right code) is slow-down; the code stays valid', async () => {
    const { app, deps, setNow } = await fresh();
    const code = (await ensureSetupCode(deps))!;
    const b = new StaffBrowser(app);
    for (let i = 0; i < SETUP_TRIES_PER_HOUR; i++) {
      const res = await enterCode(b, 'AAAA-AAAA-AAAA');
      expect({ status: res.statusCode, error: errorOf(res) }).toEqual({ status: 401, error: 'code-invalid' });
    }
    const eleventh = await enterCode(b, code);
    expect({ status: eleventh.statusCode, error: errorOf(eleventh) }).toEqual({ status: 429, error: 'slow-down' });
    expect(eleventh.json().retryAfterSeconds).toBeGreaterThan(0);
    // Global: another browser is refused too.
    expect(errorOf(await enterCode(new StaffBrowser(app), code))).toBe('slow-down');
    setNow(new Date(T0.getTime() + HOUR + 1));
    const later = await enterCode(new StaffBrowser(app), code.toLowerCase().replaceAll('-', ''));
    expect(later.statusCode, later.body).toBe(200);
  });

  it('a parallel burst gets exactly 10 tries', async () => {
    const { app, deps } = await fresh();
    await ensureSetupCode(deps);
    const res = await Promise.all(Array.from({ length: 15 }, () => enterCode(new StaffBrowser(app), 'AAAA-AAAA-AAAA')));
    expect(res.filter((r) => errorOf(r) === 'code-invalid')).toHaveLength(SETUP_TRIES_PER_HOUR);
    expect(res.filter((r) => errorOf(r) === 'slow-down')).toHaveLength(15 - SETUP_TRIES_PER_HOUR);
  });

  it('every later step needs the setup cookie', async () => {
    const { app, deps } = await fresh();
    await ensureSetupCode(deps);
    for (const url of SETUP_ROUTES.slice(1)) {
      const res = await new StaffBrowser(app).post(url, {});
      expect({ url, status: res.statusCode, error: errorOf(res) }).toEqual({ url, status: 401, error: 'not-authenticated' });
    }
  });
});

describe('the pending owner account', () => {
  it('is created disabled, cannot log in, and a second account call replaces it (only ever one owner)', async () => {
    const { app, deps } = await fresh();
    const b = await begin(app, deps, 'first.lumen', 'first-login');
    const { rows } = await deps.db.query<{ id: string; disabled_at: Date | null }>("select id, disabled_at from accounts where kind = 'owner'");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.disabled_at).toEqual(T0);
    const { token } = await insertSession(deps, rows[0]!.id, 'staff');
    expect(errorOf(await new StaffBrowser(app).withSession(token).get('/staff/v1/me'))).toBe('account-disabled');

    const again = await b.post('/staff/v1/setup/account', { username: 'second.lumen', loginName: 'second-login' });
    expect(again.statusCode, again.body).toBe(201);
    const after = await deps.db.query<{ display_name: string }>("select display_name from accounts where kind = 'owner'");
    expect(after.rows.map((r) => r.display_name)).toEqual(['second.lumen']);
    // The same names can be picked again (the replaced account is gone).
    expect((await b.post('/staff/v1/setup/account', { username: 'first.lumen', loginName: 'first-login' })).statusCode).toBe(201);
  });

  it('refuses names that break the account name rules', async () => {
    const { app, deps } = await fresh();
    const code = (await ensureSetupCode(deps))!;
    const b = new StaffBrowser(app);
    await enterCode(b, code);
    expect(errorOf(await b.post('/staff/v1/setup/account', { username: 'same.name', loginName: 'same.name' }))).toBe('names-same');
    expect((await b.post('/staff/v1/setup/account', {})).statusCode).toBe(400);
    const { rows } = await deps.db.query("select 1 from accounts where kind = 'owner'");
    expect(rows).toHaveLength(0);
  });
});

describe('keys and finish', () => {
  it('accepts attested security keys only (method-not-allowed otherwise)', async () => {
    const { app, deps } = await fresh();
    const b = await begin(app, deps);
    expect(errorOf(await b.post('/staff/v1/setup/key/start', { kind: 'passkey' }))).toBe('method-not-allowed');
    const unattested = createSoftAuthenticator({ backedUp: false, userVerified: true, attestation: 'none' });
    const res = await addKey(b, unattested);
    expect({ status: res.statusCode, error: errorOf(res) }).toEqual({ status: 403, error: 'method-not-allowed' });
    const { rows } = await deps.db.query('select 1 from webauthn_credentials');
    expect(rows).toHaveLength(0);
  });

  it('finish needs two keys (owner-needs-two-keys), then the PGP key (owner-needs-pgp, A9)', async () => {
    const { app, deps } = await fresh();
    const b = await begin(app, deps);
    expect((await addKey(b, key())).statusCode).toBe(201);
    expect(errorOf(await b.post('/staff/v1/setup/finish', { deviceLabel: 'Desk' }))).toBe('owner-needs-two-keys');
    expect((await addKey(b, key())).statusCode).toBe(201);
    expect(errorOf(await b.post('/staff/v1/setup/finish', { deviceLabel: 'Desk' }))).toBe('owner-needs-pgp');
    const { rows } = await deps.db.query('select locked_at from owner_setup');
    expect(rows).toEqual([{ locked_at: null }]);
  });

  it('the full flow creates the owner with its staff row, starts the owner session, logs once and locks the page for good', async () => {
    const { app, deps, logs } = await fresh();
    const code = (await ensureSetupCode(deps))!;
    const b = await begin(app, deps);
    const k1 = key();
    const k2 = key();
    expect((await addKey(b, k1)).statusCode).toBe(201);
    expect((await addKey(b, k2)).statusCode).toBe(201);
    const p = await addPgp(b, deps, pgp);
    expect(p.statusCode, p.body).toBe(201);
    const done = await b.post('/staff/v1/setup/finish', { deviceLabel: 'Desk' });
    expect(done.statusCode, done.body).toBe(200);
    // Both keys share the test clock's created_at, so their order falls to the random row id.
    const codes = (done.json() as { keyCheckCodes: string[] }).keyCheckCodes;
    expect([...codes].sort()).toEqual([keyCheckCode(k1.cosePublicKey), keyCheckCode(k2.cosePublicKey)].sort());

    const me = await b.get('/staff/v1/me');
    expect(me.statusCode, me.body).toBe(200);
    expect(me.json()).toMatchObject({ username: 'lumen.k', role: 'owner' });

    const { rows: owner } = await deps.db.query<{ id: string; disabled_at: Date | null }>("select id, disabled_at from accounts where kind = 'owner'");
    expect(owner).toHaveLength(1);
    expect(owner[0]!.disabled_at).toBeNull();
    const { rows: staff } = await deps.db.query('select role, hours, switched_off_at, has_security_key from staff_members where account_id = $1', [owner[0]!.id]);
    expect(staff).toEqual([{ role: 'owner', hours: 'any', switched_off_at: null, has_security_key: true }]);
    expect(await logEntries(deps, 'owner.setup-completed')).toEqual([{ actor_kind: 'staff', detail: '{}' }]);
    const { rows: setup } = await deps.db.query<{ locked_at: Date | null }>('select locked_at from owner_setup');
    expect(setup[0]!.locked_at).toEqual(T0);

    // Locked: every setup route is 404 setup-locked, with or without the setup cookie.
    for (const url of SETUP_ROUTES) {
      for (const browser of [b, new StaffBrowser(app)]) {
        const res = await browser.post(url, url.endsWith('/code') ? { code } : {});
        expect({ url, status: res.statusCode, error: errorOf(res) }).toEqual({ url, status: 404, error: 'setup-locked' });
      }
    }
    // A second owner cannot be created by any route, and a restart prints nothing.
    expect(errorOf(await b.post('/staff/v1/setup/account', { username: 'other.lumen', loginName: 'other-login' }))).toBe('setup-locked');
    expect(await ensureSetupCode(deps)).toBeNull();
    const lines: string[] = [];
    const s = await startStaffApi(deps, { origin: STAFF_ORIGIN, host: '127.0.0.1', port: 0 }, { stderr: (l) => void lines.push(l), logStream: captureLogs().stream });
    await s.close();
    expect(lines).toEqual([]);
    await expect(
      deps.db.query(`insert into accounts (display_name, display_key, login_tag, login_tag_key_id, kind, webauthn_user_id, created_at)
                     values ('o2', 'o2', '\\x00', 1, 'owner', '\\x01', now())`),
    ).rejects.toThrow(/one_owner/);
    // The code never reached the structured log.
    expect(logs.join('\n')).not.toContain(code);
  });

  it('the locked row refuses every change (trigger)', async () => {
    const { app, deps } = await fresh();
    const b = await begin(app, deps);
    await addKey(b, key());
    await addKey(b, key());
    await addPgp(b, deps, pgp);
    expect((await b.post('/staff/v1/setup/finish', { deviceLabel: 'Desk' })).statusCode).toBe(200);
    await expect(deps.db.query('update owner_setup set locked_at = null')).rejects.toThrow(/owner_setup/);
    await expect(deps.db.query("update owner_setup set code_hash = '\\x00'")).rejects.toThrow(/owner_setup/);
    await expect(deps.db.query('delete from owner_setup')).rejects.toThrow(/owner_setup/);
    await expect(deps.db.query('truncate owner_setup')).rejects.toThrow(/owner_setup/);
    const { rows } = await deps.db.query<{ locked_at: Date | null }>('select locked_at from owner_setup');
    expect(rows[0]!.locked_at).not.toBeNull();
  });

  it('two parallel finish calls lock exactly once', async () => {
    const { app, deps } = await fresh();
    const b = await begin(app, deps);
    await addKey(b, key());
    await addKey(b, key());
    await addPgp(b, deps, pgp2);
    const twin = new StaffBrowser(app);
    twin.cookies = { ...b.cookies };
    const res = await Promise.all([b.post('/staff/v1/setup/finish', { deviceLabel: 'A' }), twin.post('/staff/v1/setup/finish', { deviceLabel: 'B' })]);
    expect(res.map((r) => r.statusCode).sort()).toEqual([200, 404]);
    expect(res.map(errorOf).filter(Boolean)).toEqual(['setup-locked']);
    expect(await logEntries(deps, 'owner.setup-completed')).toHaveLength(1);
    const { rows } = await deps.db.query("select 1 from staff_members where role = 'owner'");
    expect(rows).toHaveLength(1);
  });
});
