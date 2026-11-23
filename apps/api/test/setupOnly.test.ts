// Security review of wip/lead-notes-all 656d259c, M2: the owner ruled a password alone does not
// finish sign-up (16 Nov 2026), yet a password-only account became permanent once its 30-minute
// sign-up window passed, and its password login got a full session. Now a trader account whose
// only login is a password (no authenticator app, passkey, security key or usable PGP key) gets a
// setup-only session outside the window: `me` (setupOnly: true), adding a second method (and its
// confirm, its staged change and the recovery code), the Terms, and logging out. Everything else
// is 403 `second-method-required`.
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { testApp } from './helpers/app.js';
import { fixtureLeakedList } from './helpers/leaked.js';
import { SIG } from './helpers/signature.js';
import { Browser, addTestLogin } from './helpers/totp.js';

const T0 = new Date('2026-11-09T06:00:00Z');
const HOUR = 3600_000;
const MIN = 60_000;
const GOOD = 'Correct-Horse-9';
let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let now = T0;
let step = 0;
let n = 0;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const fixture = await fixtureLeakedList();
  cleanup = fixture.cleanup;
  let set: (d: Date) => void;
  ({ app, deps, setNow: set } = await testApp({ leaked: fixture.list }));
  setNow = (d) => {
    now = d;
    set(d);
  };
  addTestLogin(app, deps);
});
afterAll(async () => {
  await app.close();
  await cleanup();
});
beforeEach(() => setNow(new Date(T0.getTime() + ++step * 24 * HOUR)));

// Fixed-width parts, so every name is 10 or 11 characters whatever the pid (new names are 8–20,
// owner demo notes #126 and #127; an unpadded pid under 100 made `sox42x1`, 7, and failed sign-up).
const pad = (v: number, w: number) => String(v).padStart(w, '0');
const names = () => {
  const p = pad(process.pid % 1000, 3);
  const k = pad(++n, 2);
  return { loginName: `soxp${p}n${k}`, displayName: `Setup${p}x${k}` };
};

/** A password-only sign-up; answers the creating browser and the names. */
async function passwordOnly() {
  const nm = names();
  const b = new Browser(app);
  const reg = await b.post('/v1/register/password', { ...nm, password: GOOD, deviceLabel: 'P', acceptedTerms: deps.config.termsVersion, termsSignature: SIG });
  expect(reg.statusCode, reg.body).toBe(201);
  const { rows } = await deps.db.query<{ id: string }>('select account_id as id from sessions order by created_at desc limit 1');
  return { b, nm, id: rows[0]!.id };
}

const addKeyRow = (id: string) =>
  deps.db.query(
    `insert into webauthn_credentials (account_id, credential_id, public_key, counter, kind, backed_up, device_type, label, created_at)
     values ($1, $2, $3, 0, 'security-key', false, 'singleDevice', 'key', $4)`,
    [id, randomBytes(32), randomBytes(77), now],
  );

/** Routes a setup-only session is refused: trading, offers, wallets and other account changes. */
async function expectRefused(b: Browser) {
  for (const [method, url, body] of [
    ['GET', '/v1/wallets', undefined],
    ['POST', '/v1/wallets', { wallets: [] }],
    ['GET', '/v1/trades', undefined],
    ['POST', '/v1/offers', {}],
    ['GET', '/v1/account/offers', undefined],
    ['PUT', '/v1/account/type', { type: 'vendor' }],
    ['POST', '/v1/account/blocks', { displayName: 'Someone1' }],
  ] as const) {
    const res = method === 'GET' ? await b.get(url) : method === 'PUT' ? await b.put(url, body) : await b.post(url, body);
    expect(res.statusCode, `${method} ${url}`).toBe(403);
    expect(res.json(), `${method} ${url}`).toMatchObject({ error: 'second-method-required' });
  }
}

describe('review M2: a password alone gives a setup-only session', () => {
  it('inside the sign-up window the creating session is not held back', async () => {
    const { b } = await passwordOnly();
    expect((await b.get('/v1/account/me')).json()).toMatchObject({ setupOnly: false });
    expect((await b.get('/v1/wallets')).statusCode).toBe(200);
  });

  it('once the window has passed, the creating session is setup-only', async () => {
    const { b } = await passwordOnly();
    setNow(new Date(now.getTime() + 31 * MIN));
    const me = await b.get('/v1/account/me');
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ setupOnly: true, methods: ['password'] });
    await expectRefused(b);
  });

  it('a password login after the window answers setupOnly, and the session reaches only the set-up routes', async () => {
    const { b, nm } = await passwordOnly();
    setNow(new Date(now.getTime() + 31 * MIN));
    await b.post('/v1/logout');
    // The same browser (its device is trusted for the account: a new one with nothing logged in to
    // approve it is refused, approval-unavailable, as before).
    const b2 = b;
    const login = await b2.post('/v1/login/password', { loginName: nm.loginName, password: GOOD, deviceLabel: 'Q' });
    expect(login.statusCode, login.body).toBe(200);
    expect(login.json()).toEqual({ status: 'ok', setupOnly: true });
    await expectRefused(b2);
    // What it may do: read itself and its methods, confirm with the password, start adding a second
    // method (the authenticator app here), see its staged changes, and log out.
    expect((await b2.get('/v1/account/me')).json()).toMatchObject({ setupOnly: true });
    expect((await b2.get('/v1/account/methods')).statusCode).toBe(200);
    expect((await b2.get('/v1/account/hold')).statusCode).toBe(200);
    expect((await b2.get('/v1/terms')).statusCode).toBe(200);
    const confirm = await b2.post('/v1/confirm/password', { password: GOOD, action: { kind: 'add-method', method: 'totp' } });
    expect(confirm.statusCode, confirm.body).toBe(200);
    const start = await b2.post('/v1/account/totp/start', { confirmToken: confirm.json().confirmToken });
    expect(start.statusCode, start.body).toBe(200);
    const c2 = await b2.post('/v1/confirm/password', { password: GOOD, action: { kind: 'add-method', method: 'security-key' } });
    const wa = await b2.post('/v1/account/webauthn/start', { kind: 'security-key', confirmToken: c2.json().confirmToken });
    expect(wa.statusCode, wa.body).toBe(200);
    expect((await b2.post('/v1/logout')).statusCode).toBe(200);
    expect((await b2.get('/v1/account/me')).statusCode).toBe(401);
  });

  it('once a second method is on the account, the same session is a normal one', async () => {
    const { b, id } = await passwordOnly();
    setNow(new Date(now.getTime() + 31 * MIN));
    expect((await b.get('/v1/wallets')).statusCode).toBe(403);
    await addKeyRow(id);
    expect((await b.get('/v1/account/me')).json()).toMatchObject({ setupOnly: false });
    expect((await b.get('/v1/wallets')).statusCode).toBe(200);
    expect((await b.get('/v1/trades')).statusCode).toBe(200);
  });

  it('an account with no password (another method) is never setup-only', async () => {
    const { b, id } = await passwordOnly();
    await addKeyRow(id);
    await deps.db.query('delete from passwords where account_id = $1', [id]);
    setNow(new Date(now.getTime() + 31 * MIN));
    expect((await b.get('/v1/account/me')).json()).toMatchObject({ setupOnly: false });
    expect((await b.get('/v1/wallets')).statusCode).toBe(200);
  });

  it('re-review N2: a setup-only owner sees its sessions and ends a stranger\'s newer one', async () => {
    const { b, id } = await passwordOnly();
    setNow(new Date(now.getTime() + 31 * MIN));
    // A stranger's newer username-and-password session on the account.
    const stranger = new Browser(app);
    expect((await stranger.post('/t/login', { accountId: id })).statusCode).toBe(200);
    await deps.db.query("update sessions set strength = 'weak-single' where account_id = $1", [id]);
    const list = await b.get('/v1/account/sessions');
    expect(list.statusCode, list.body).toBe(200);
    const theirs = (list.json() as Array<{ id: string; current: boolean }>).find((s) => !s.current)!;
    const del = await b.delete(`/v1/account/sessions/${theirs.id}`);
    expect(del.statusCode, del.body).toBeLessThan(300);
    expect((await stranger.get('/v1/account/me')).statusCode).toBe(401);
  });
});
