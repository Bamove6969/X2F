// S-085 review S4/S5: every real login path binds the new session to `X2F-Session-Key` (not only the
// test helper `/t/login`), and a malformed header is refused at the top of the route, before the
// login factor is spent. docs/superpowers/specs/2026-11-12-device-bound-sessions.md.
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { Secret } from 'otpauth';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { fileAttestationPolicy } from '../src/auth/attestation.js';
import { DEVICE_COOKIE } from '../src/auth/device.js';
import { BOUND_COOKIE, SESSION_KEY_HEADER } from '../src/auth/deviceBound.js';
import { insertPgpKey } from '../src/auth/pgp.js';
import { hashPassword } from '../src/auth/password.js';
import { SESSION_COOKIE } from '../src/auth/sessions.js';
import { sealSecret } from '../src/auth/totp.js';
import type { Config } from '../src/config.js';
import { rolesToAbilities } from '../src/team/abilities.js';
import { seedAccount, trustedDevice } from './helpers/accounts.js';
import { testApp } from './helpers/app.js';
import { fixtureLeakedList } from './helpers/leaked.js';
import { codeOf, decrypt, genKey, type Pair } from './helpers/pgpKeys.js';
import { SIG } from './helpers/signature.js';
import { createSoftAuthenticator, createTestCa, writeTestMds } from './helpers/softAuthenticator.js';
import { addTestLogin, codeAt } from './helpers/totp.js';

const ORIGIN = 'https://x2f.test';
const T0 = new Date('2026-10-17T12:00:00Z');
const DAY = 24 * 3600_000;
const GOOD = 'Correct-Horse-9';
const ALLOWED = '11111111-2222-4333-8444-555555555555';

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let now = T0;
let step = 0;
let cleanups: Array<() => Promise<void>> = [];
let goodHash: { hash: string; pepperId: number };
let pgpKey: Pair;
let memberKey: Pair;
let memberKey2: Pair;

beforeAll(async () => {
  const leaked = await fixtureLeakedList();
  const ca = createTestCa();
  const mdsDir = await mkdtemp(join(tmpdir(), 'x2f-mds-'));
  await writeTestMds(mdsDir, ca, { statements: [ALLOWED], allow: [ALLOWED], ownerAllow: [ALLOWED] });
  const attestation = fileAttestationPolicy(mdsDir);
  await attestation.init();
  cleanups = [leaked.cleanup, () => rm(mdsDir, { recursive: true, force: true })];
  let set: (d: Date) => void;
  ({ app, deps, setNow: set } = await testApp({ leaked: leaked.list, attestation }));
  setNow = (d) => {
    now = d;
    set(d);
  };
  addTestLogin(app, deps);
  (deps.config as Config).deviceBoundSessions = true;
  goodHash = await hashPassword(deps.config, GOOD);
  pgpKey = await genKey();
  memberKey = await genKey();
  memberKey2 = await genKey();
});

afterAll(async () => {
  await app.close();
  for (const c of cleanups) await c();
});

beforeEach(() => {
  // Each test starts a day later: budgets, throttles and daily caps from earlier tests are gone.
  setNow(new Date(T0.getTime() + ++step * DAY));
});

function deviceKey(): { spki: string; der: Buffer } {
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return { spki: der.toString('base64url'), der };
}

/** A browser whose POSTs carry `X2F-Session-Key` (as the web's auth client sends it), or `header` when given. */
class Browser {
  cookies: Record<string, string> = {};
  readonly key = deviceKey();
  header: string | null;
  constructor(header?: string | null) {
    this.header = header === undefined ? this.key.spki : header;
  }
  async send(method: 'GET' | 'POST', url: string, payload?: unknown): Promise<LightMyRequestResponse> {
    const headers: Record<string, string> = { origin: ORIGIN };
    if (method === 'POST' && this.header !== null) headers[SESSION_KEY_HEADER] = this.header;
    const res = await app.inject({ method, url, headers, cookies: this.cookies, ...(payload !== undefined ? { payload: payload as object } : {}) });
    for (const c of res.cookies) {
      if (c.maxAge === 0 || c.value === '') delete this.cookies[c.name];
      else this.cookies[c.name] = c.value;
    }
    return res;
  }
  post = (url: string, payload: unknown = {}) => this.send('POST', url, payload);
  get = (url: string) => this.send('GET', url);
}

const errorOf = (res: LightMyRequestResponse) => (res.body === '' ? undefined : (res.json() as { error?: string }).error);
let seq = 0;
const unique = (p: string) => `${p}${++seq}x${step}`;

/** The session `b` holds is bound to `b`'s key: a bound cookie, the key on the row, and its session cookie alone is refused. */
async function expectBound(b: Browser): Promise<void> {
  expect(b.cookies[SESSION_COOKIE]).toBeDefined();
  expect(b.cookies[BOUND_COOKIE]).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const { rows } = await deps.db.query<{ bound_key: Buffer | null }>(
    "select bound_key from sessions where token_hash = sha256(convert_to($1, 'utf8'))",
    [b.cookies[SESSION_COOKIE]],
  );
  expect(rows[0]?.bound_key?.equals(b.key.der)).toBe(true);
  expect((await b.get('/v1/account/me')).statusCode).toBe(200);
  const copied = new Browser(null);
  copied.cookies = { [SESSION_COOKIE]: b.cookies[SESSION_COOKIE]! };
  expect(errorOf(await copied.get('/v1/account/me'))).toBe('session-proof-required');
}

async function withPassword(accountId: string): Promise<void> {
  await deps.db.query('insert into passwords (account_id, hash, pepper_id, updated_at) values ($1, $2, $3, $4)', [accountId, goodHash.hash, goodHash.pepperId, now]);
}
async function withTotp(accountId: string): Promise<string> {
  const raw = randomBytes(20);
  await deps.db.query('insert into totp (account_id, secret_enc, created_at) values ($1, $2, $3)', [accountId, sealSecret(deps, accountId, new Uint8Array(raw)), now]);
  return new Secret({ buffer: new Uint8Array(raw).buffer }).base32;
}
/** Password then authenticator code, in `b`. */
async function passwordAndCode(b: Browser, loginName: string, secret: string): Promise<LightMyRequestResponse> {
  const first = await b.post('/v1/login/password', { loginName, password: GOOD, deviceLabel: 'Laptop' });
  expect(first.json(), first.body).toMatchObject({ status: 'second-factor' });
  return b.post('/v1/login/second-factor', { pendingId: (first.json() as { pendingId: string }).pendingId, code: codeAt(secret, now) });
}

describe('every real login path binds the session (S4)', () => {
  it('password sign-up', async () => {
    const b = new Browser();
    const loginName = unique('reg');
    const res = await b.post('/v1/register/password', { displayName: `P${loginName}`, loginName, password: GOOD, deviceLabel: 'Laptop', acceptedTerms: deps.config.termsVersion, termsSignature: SIG });
    expect(res.statusCode, res.body).toBe(201);
    await expectBound(b);
  });

  it('password and authenticator code (the second-factor step)', async () => {
    const loginName = unique('pw');
    const id = await seedAccount(deps, { loginName });
    await withPassword(id);
    const secret = await withTotp(id);
    // A browser the account knows (a password and a code get in there with no device to approve).
    const b = new Browser();
    b.cookies[DEVICE_COOKIE] = await trustedDevice(deps, id);
    const res = await passwordAndCode(b, loginName, secret);
    expect(res.json(), res.body).toEqual({ status: 'ok' });
    await expectBound(b);
  });

  it('a team member\'s login (members log in with a PGP key or a security key): the member session is bound', async () => {
    const owner = await seedAccount(deps, { loginName: unique('teamowner') });
    const loginName = unique('member');
    const memberId = await seedAccount(deps, { loginName, kind: 'member' });
    for (const k of [memberKey, memberKey2]) await insertPgpKey(deps.db, deps.config, { accountId: memberId, fingerprint: k.fingerprint, armored: k.publicKey, now });
    const name = unique('Member');
    await deps.db.query(
      `insert into team_members (account_id, display_name, display_key, abilities, invite_expires_at, member_account_id, joined_at, created_at)
       values ($1, $2, $3, $4, $5, $6, $5, $5)`,
      [owner, name, name.toLowerCase(), rolesToAbilities(['offers']), now, memberId],
    );
    const b = new Browser();
    const ls = await b.post('/v1/login/pgp/start', { key: memberKey.publicKey, loginName });
    expect(ls.statusCode, ls.body).toBe(200);
    const code = codeOf(await decrypt(ls.json().encryptedMessage, memberKey.privateKey));
    const first = await b.post('/v1/login/pgp/finish', { challengeId: ls.json().challengeId, code, deviceLabel: 'Laptop' });
    // A member's login is a pair: the second PGP key completes it.
    const { pendingId } = first.json() as { status: string; pendingId: string };
    expect(first.json(), first.body).toMatchObject({ status: 'second-factor' });
    const s2 = await b.post('/v1/login/pgp/start', { key: memberKey2.publicKey, loginName, pendingId });
    expect(s2.statusCode, s2.body).toBe(200);
    const code2 = codeOf(await decrypt(s2.json().encryptedMessage, memberKey2.privateKey));
    const res = await b.post('/v1/login/pgp/finish', { challengeId: s2.json().challengeId, code: code2, deviceLabel: 'Laptop', pendingId });
    expect(res.json(), res.body).toEqual({ status: 'ok' });
    const { rows } = await deps.db.query<{ member_id: string | null }>("select member_id from sessions where token_hash = sha256(convert_to($1, 'utf8'))", [b.cookies[SESSION_COOKIE]]);
    expect(rows[0]?.member_id).not.toBeNull();
    await expectBound(b);
  });

  it('a device-approval poll: the session opened by the new device\'s poll is bound to the new device\'s key', async () => {
    const a = new Browser();
    const loginName = unique('appr');
    const reg = await a.post('/v1/register/password', { displayName: `P${loginName}`, loginName, password: GOOD, deviceLabel: 'Desk', acceptedTerms: deps.config.termsVersion, termsSignature: SIG });
    expect(reg.statusCode, reg.body).toBe(201);
    const b = new Browser();
    const wait = await b.post('/v1/login/password', { loginName, password: GOOD, deviceLabel: 'Phone' });
    const w = wait.json() as { status: string; approvalId: string; number: number };
    expect(w.status, wait.body).toBe('approve-on-device');
    expect(b.cookies[SESSION_COOKIE]).toBeUndefined();
    expect((await a.post(`/v1/account/approvals/${w.approvalId}`, { choice: w.number })).json()).toEqual({ outcome: 'approved' });
    const poll = await b.post(`/v1/login/approval/${w.approvalId}/poll`);
    expect(poll.statusCode, poll.body).toBe(200);
    await expectBound(b);
  });

  it('a recovery-code (backup) login', async () => {
    const loginName = unique('rec');
    const id = await seedAccount(deps, { loginName });
    const owner = new Browser(null);
    expect((await owner.post('/t/login', { accountId: id, firstSession: true })).statusCode).toBe(200);
    const codes = (await owner.post('/v1/account/recovery-codes', {})).json() as { codes: string[] };
    const b = new Browser();
    const res = await b.post('/v1/login/backup', { loginName, kind: 'recovery-code', code: codes.codes[0], deviceLabel: 'Backup browser' });
    expect(res.statusCode, res.body).toBe(200);
    await expectBound(b);
  });

  it('a PGP login', async () => {
    const displayName = unique('pgp');
    const a = new Browser(null);
    const start = await a.post('/v1/register/pgp/start', { displayName, loginName: `${displayName}.l`, publicKey: pgpKey.publicKey });
    expect(start.statusCode, start.body).toBe(200);
    const code = codeOf(await decrypt(start.json().encryptedMessage, pgpKey.privateKey));
    const fin = await a.post('/v1/register/pgp/finish', { challengeId: start.json().challengeId, code, deviceLabel: 'Desk', acceptedTerms: deps.config.termsVersion, termsSignature: SIG });
    expect(fin.statusCode, fin.body).toBe(201);
    // A PGP key is a strong login: it gets in from a new browser while the account is logged in elsewhere (or asks that device; collected below).
    const b = new Browser();
    const ls = await b.post('/v1/login/pgp/start', { key: pgpKey.publicKey, loginName: `${displayName}.l` });
    expect(ls.statusCode, ls.body).toBe(200);
    const lcode = codeOf(await decrypt(ls.json().encryptedMessage, pgpKey.privateKey));
    const res = await b.post('/v1/login/pgp/finish', { challengeId: ls.json().challengeId, code: lcode, deviceLabel: 'Laptop' });
    const body = res.json() as { status: string; approvalId?: string; number?: number };
    if (body.status === 'approve-on-device') {
      expect((await a.post(`/v1/account/approvals/${body.approvalId}`, { choice: body.number })).json()).toEqual({ outcome: 'approved' });
      expect((await b.post(`/v1/login/approval/${body.approvalId}/poll`)).statusCode).toBe(200);
    } else {
      expect(body, res.body).toEqual({ status: 'ok' });
    }
    await expectBound(b);
  }, 60_000);

  it('a passkey (WebAuthn) sign-up and login', async () => {
    const auth = createSoftAuthenticator({ backedUp: true, userVerified: true });
    const loginName = unique('pk');
    const a = new Browser();
    const start = await a.post('/v1/register/webauthn/start', { displayName: `D.${loginName}`, loginName, kind: 'passkey' });
    expect(start.statusCode, start.body).toBe(200);
    const { challengeId, options } = start.json();
    const reg = await a.post('/v1/register/webauthn/finish', { challengeId, response: auth.register(options, ORIGIN), deviceLabel: 'Laptop', acceptedTerms: deps.config.termsVersion, termsSignature: SIG });
    expect(reg.statusCode, reg.body).toBe(201);
    await expectBound(a);
    const b = new Browser();
    const ls = await b.post('/v1/login/webauthn/start', {});
    const res = await b.post('/v1/login/webauthn/finish', { challengeId: ls.json().challengeId, response: auth.authenticate(ls.json().options, ORIGIN), deviceLabel: 'Desk' });
    const body = res.json() as { status: string; approvalId?: string; number?: number };
    if (body.status === 'approve-on-device') {
      expect((await a.post(`/v1/account/approvals/${body.approvalId}`, { choice: body.number })).json()).toEqual({ outcome: 'approved' });
      expect((await b.post(`/v1/login/approval/${body.approvalId}/poll`)).statusCode).toBe(200);
    } else {
      expect(body, res.body).toEqual({ status: 'ok' });
    }
    await expectBound(b);
  });
});

describe('a malformed header spends no login factor (S5)', () => {
  it('a recovery code sent with a bad header is refused with 400 and still works afterwards', async () => {
    const loginName = unique('rec');
    const id = await seedAccount(deps, { loginName });
    const owner = new Browser(null);
    expect((await owner.post('/t/login', { accountId: id, firstSession: true })).statusCode).toBe(200);
    const code = ((await owner.post('/v1/account/recovery-codes', {})).json() as { codes: string[] }).codes[0];
    const bad = new Browser('AAAA');
    const res = await bad.post('/v1/login/backup', { loginName, kind: 'recovery-code', code, deviceLabel: 'Backup browser' });
    expect({ status: res.statusCode, error: errorOf(res) }).toEqual({ status: 400, error: 'bad-request' });
    const good = new Browser();
    expect((await good.post('/v1/login/backup', { loginName, kind: 'recovery-code', code, deviceLabel: 'Backup browser' })).statusCode).toBe(200);
  });

  it('an approval poll with a bad header is refused with 400 and the approval can still be collected', async () => {
    const a = new Browser();
    const loginName = unique('appr');
    expect((await a.post('/v1/register/password', { displayName: `P${loginName}`, loginName, password: GOOD, deviceLabel: 'Desk', acceptedTerms: deps.config.termsVersion, termsSignature: SIG })).statusCode).toBe(201);
    const b = new Browser();
    const w = (await b.post('/v1/login/password', { loginName, password: GOOD, deviceLabel: 'Phone' })).json() as { approvalId: string; number: number };
    expect((await a.post(`/v1/account/approvals/${w.approvalId}`, { choice: w.number })).json()).toEqual({ outcome: 'approved' });
    const good = b.header;
    b.header = 'not base64!';
    const res = await b.post(`/v1/login/approval/${w.approvalId}/poll`);
    expect({ status: res.statusCode, error: errorOf(res) }).toEqual({ status: 400, error: 'bad-request' });
    b.header = good;
    expect((await b.post(`/v1/login/approval/${w.approvalId}/poll`)).statusCode).toBe(200);
    await expectBound(b);
  });
});
