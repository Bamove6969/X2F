// Owner, 26 Nov 2026 (no passwords): a trader account holds at least two kinds of login method
// (passkey, security key, PGP key, authenticator app; recovery codes do not count). A trader
// account owner's session whose account holds fewer gets a setup-only session once its sign-up
// window has passed: `me` (setupOnly: true), adding a second method (and its confirm, and the
// recovery code), the Terms, its sessions, and logging out. Everything else is 403
// `two-methods-required`.
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { testApp } from './helpers/app.js';
import { logInWithKey, signUpWithKey } from './helpers/signup.js';
import { Browser, ORIGIN, addTestLogin } from './helpers/totp.js';

const T0 = new Date('2026-11-09T06:00:00Z');
const HOUR = 3600_000;
const MIN = 60_000;
let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let now = T0;
let step = 0;
let n = 0;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  cleanup = async () => {};
  let set: (d: Date) => void;
  ({ app, deps, setNow: set } = await testApp({}));
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

/** A sign-up with one passkey only; answers the creating browser, the names and the passkey. */
async function oneKind() {
  const nm = names();
  const b = new Browser(app);
  const { res: reg, auth } = await signUpWithKey(b, { ...nm, deviceLabel: 'P', acceptedTerms: deps.config.termsVersion });
  expect(reg.statusCode, reg.body).toBe(201);
  const { rows } = await deps.db.query<{ id: string }>('select account_id as id from sessions order by created_at desc limit 1');
  return { b, nm, id: rows[0]!.id, auth };
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
    expect(res.json(), `${method} ${url}`).toMatchObject({ error: 'two-methods-required' });
  }
}

describe('one kind of login method gives a setup-only session', () => {
  it('inside the sign-up window the creating session is not held back', async () => {
    const { b } = await oneKind();
    expect((await b.get('/v1/account/me')).json()).toMatchObject({ setupOnly: false });
    expect((await b.get('/v1/wallets')).statusCode).toBe(200);
  });

  it('once the window has passed, the creating session is setup-only', async () => {
    const { b } = await oneKind();
    setNow(new Date(now.getTime() + 31 * MIN));
    const me = await b.get('/v1/account/me');
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ setupOnly: true, methods: ['passkey'] });
    await expectRefused(b);
  });

  it('a login after the window answers setupOnly, and the session reaches only the set-up routes', async () => {
    const { b, auth } = await oneKind();
    setNow(new Date(now.getTime() + 31 * MIN));
    await b.post('/v1/logout');
    // The same browser (its device is trusted for the account).
    const login = await logInWithKey(b, auth, 'Q');
    expect(login.statusCode, login.body).toBe(200);
    expect(login.json()).toMatchObject({ status: 'ok' });
    await expectRefused(b);
    // What it may do: read itself and its methods, confirm with its passkey, start adding a second
    // method (the authenticator app or a security key here), and log out.
    expect((await b.get('/v1/account/me')).json()).toMatchObject({ setupOnly: true });
    expect((await b.get('/v1/account/methods')).statusCode).toBe(200);
    expect((await b.get('/v1/terms')).statusCode).toBe(200);
    const confirm = async (action: object) => {
      const st = await b.post('/v1/confirm/webauthn/start', { action });
      expect(st.statusCode, st.body).toBe(200);
      const { challengeId, options } = st.json();
      const fin = await b.post('/v1/confirm/webauthn/finish', { challengeId, response: auth.authenticate(options, ORIGIN) });
      expect(fin.statusCode, fin.body).toBe(200);
      return fin.json().confirmToken as string;
    };
    const start = await b.post('/v1/account/totp/start', { confirmToken: await confirm({ kind: 'add-method', method: 'totp' }) });
    expect(start.statusCode, start.body).toBe(200);
    const wa = await b.post('/v1/account/webauthn/start', { kind: 'security-key', confirmToken: await confirm({ kind: 'add-method', method: 'security-key' }) });
    expect(wa.statusCode, wa.body).toBe(200);
    expect((await b.post('/v1/logout')).statusCode).toBe(200);
    expect((await b.get('/v1/account/me')).statusCode).toBe(401);
  });

  it('once a second method is on the account, the same session is a normal one', async () => {
    const { b, id } = await oneKind();
    setNow(new Date(now.getTime() + 31 * MIN));
    expect((await b.get('/v1/wallets')).statusCode).toBe(403);
    await addKeyRow(id);
    expect((await b.get('/v1/account/me')).json()).toMatchObject({ setupOnly: false });
    expect((await b.get('/v1/wallets')).statusCode).toBe(200);
    expect((await b.get('/v1/trades')).statusCode).toBe(200);
  });

  it('a stored PGP key that cannot log in (expired, revoked, unreadable) counts as no kind', async () => {
    const { b, id } = await oneKind();
    await deps.db.query('insert into pgp_keys (account_id, fingerprint, armored_enc, created_at) values ($1, $2, $3, $4)', [
      id, randomBytes(20).toString('hex'), randomBytes(64), now,
    ]);
    setNow(new Date(now.getTime() + 31 * MIN));
    expect((await b.get('/v1/account/me')).json()).toMatchObject({ setupOnly: true });
  });

  it('re-review N2: a setup-only owner sees its sessions and ends a stranger\'s newer one', async () => {
    const { b, id } = await oneKind();
    setNow(new Date(now.getTime() + 31 * MIN));
    // A stranger's newer session on the account.
    const stranger = new Browser(app);
    expect((await stranger.post('/t/login', { accountId: id })).statusCode).toBe(200);
    const list = await b.get('/v1/account/sessions');
    expect(list.statusCode, list.body).toBe(200);
    const theirs = (list.json() as Array<{ id: string; current: boolean }>).find((s) => !s.current)!;
    const del = await b.delete(`/v1/account/sessions/${theirs.id}`);
    expect(del.statusCode, del.body).toBeLessThan(300);
    expect((await stranger.get('/v1/account/me')).statusCode).toBe(401);
  });
});
