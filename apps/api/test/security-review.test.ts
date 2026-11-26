import { checkDisplayName } from '@x2f/accounts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { START_BUCKET } from '../src/limits.js';
import { seedAccount } from './helpers/accounts.js';
import { approvedLogin } from './helpers/approval.js';
import { testApp } from './helpers/app.js';
import { Browser, ORIGIN, addTestLogin } from './helpers/totp.js';
import { codeOf, decrypt, genKey } from './helpers/pgpKeys.js';
import { SIG } from './helpers/signature.js';

// Plan 2 Task 15 (docs/security/plan-2-review.md): proofs for the findings of the security review.

const HOUR = 3600_000;
let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;

beforeAll(async () => {
  ({ app, deps, setNow } = await testApp());
  addTestLogin(app, deps);
});

afterAll(async () => {
  await app.close();
});

async function loggedIn(accountId: string): Promise<Browser> {
  const b = new Browser(app);
  expect((await b.post('/t/login', { accountId })).statusCode).toBe(200);
  return b;
}

describe('F1: the request budgets are global (Important; open until the Plan 6 per-source limit in the proxy)', () => {
  it('KNOWN DoS, not intended (F1, open until the Plan 6 per-source proxy limit): one anonymous client spending the start budget makes every other login answer 503 busy', async () => {
    // Records the in-process behaviour only: the budget is per process, not per source, and the API
    // stores no IPs (R5), so it cannot tell the flooder from anyone else. The proof that F1 is fixed
    // belongs in a test that goes through the proxy; it cannot be written against this app alone.
    for (let i = 0; i < START_BUCKET.capacity; i++) {
      const res = await app.inject({
        method: 'POST', url: '/v1/login/webauthn/start', headers: { origin: ORIGIN }, payload: { loginName: `nobody${i}xx` },
      });
      expect(res.statusCode).toBe(200);
    }
    const victim = await new Browser(app).post('/v1/login/pgp/start', { key: 'x', loginName: 'realuser1' });
    expect(victim.statusCode).toBe(503);
    expect(victim.json()).toMatchObject({ error: 'busy' });
    // The owner's security-key login start is refused the same way.
    const owner = await new Browser(app).post('/v1/login/webauthn/start', { loginName: 'theowner1' });
    expect(owner.statusCode).toBe(503);
  });

  it('busy logins (owner, 2026-10-23): a login already started finishes even when the start budget is empty', async () => {
    setNow(new Date('2026-10-17T15:00:00Z')); // the budget has refilled
    const k = await genKey();
    const reg = new Browser(app);
    const rs = await reg.post('/v1/register/pgp/start', { displayName: 'Busy.Finisher', loginName: 'busy.fin.login', publicKey: k.publicKey });
    const rcode = codeOf(await decrypt(rs.json().encryptedMessage, k.privateKey));
    expect((await reg.post('/v1/register/pgp/finish', {
      challengeId: rs.json().challengeId, code: rcode, deviceLabel: 'b', acceptedTerms: deps.config.termsVersion, termsSignature: SIG,
    })).statusCode).toBe(201);

    const b = new Browser(app);
    const start = await b.post('/v1/login/pgp/start', { key: k.publicKey, loginName: 'busy.fin.login' });
    expect(start.statusCode).toBe(200);
    // Someone else empties the start budget.
    for (let i = 0; ; i++) {
      const r = await app.inject({ method: 'POST', url: '/v1/login/webauthn/start', headers: { origin: ORIGIN }, payload: { loginName: `flood${i}xx` } });
      if (r.statusCode === 503) break;
    }
    const code = codeOf(await decrypt(start.json().encryptedMessage, k.privateKey));
    const fin = await b.post('/v1/login/pgp/finish', { challengeId: start.json().challengeId, code, deviceLabel: 'b' });
    expect(fin.statusCode).toBe(200);
    // Task 16: the registering browser is still logged in, so this new one is approved first.
    expect(await approvedLogin(deps, fin, (u) => b.post(u, {}))).toEqual({ status: 'ok' });
  });

  it('the exemption is bound to the device that started the login, and is used once per challenge', async () => {
    setNow(new Date('2026-10-17T16:00:00Z'));
    const k = await genKey();
    const b = new Browser(app);
    const start = await b.post('/v1/login/pgp/start', { key: k.publicKey, loginName: 'nobody-here0' }); // a decoy: still an open challenge of this device
    expect(start.statusCode).toBe(200);
    for (let i = 0; ; i++) {
      const r = await app.inject({ method: 'POST', url: '/v1/login/webauthn/start', headers: { origin: ORIGIN }, payload: { loginName: `flood${i}yy` } });
      if (r.statusCode === 503) break;
    }
    // Another browser naming the same challenge takes from the (empty) budget: busy.
    const other = await new Browser(app).post('/v1/login/pgp/finish', { challengeId: start.json().challengeId, code: 'x', deviceLabel: 'b' });
    expect(other.statusCode).toBe(503);
    // A made-up challenge id: busy.
    const junk = await b.post('/v1/login/pgp/finish', { challengeId: '00000000-0000-4000-8000-000000000000', code: 'x', deviceLabel: 'b' });
    expect(junk.statusCode).toBe(503);
    // The starting browser gets through once (its wrong code is code-invalid, not busy)...
    const mine = await b.post('/v1/login/pgp/finish', { challengeId: start.json().challengeId, code: 'AAAA-AAAA-AAAA', deviceLabel: 'b' });
    expect(mine.statusCode).toBe(401);
    // ...and naming that challenge again does not get a second free pass.
    const again = await b.post('/v1/login/pgp/finish', { challengeId: start.json().challengeId, code: 'AAAA-AAAA-AAAA', deviceLabel: 'b' });
    expect(again.statusCode).toBe(503);
  });

  it('parallel finishes of one challenge get one exemption between them', async () => {
    setNow(new Date('2026-10-17T17:00:00Z'));
    const k = await genKey();
    const b = new Browser(app);
    const start = await b.post('/v1/login/pgp/start', { key: k.publicKey, loginName: 'nobody-here0' });
    for (let i = 0; ; i++) {
      const r = await app.inject({ method: 'POST', url: '/v1/login/webauthn/start', headers: { origin: ORIGIN }, payload: { loginName: `flood${i}zz` } });
      if (r.statusCode === 503) break;
    }
    const res = await Promise.all(
      Array.from({ length: 4 }, () =>
        app.inject({
          method: 'POST', url: '/v1/login/pgp/finish', headers: { origin: ORIGIN }, cookies: b.cookies,
          payload: { challengeId: start.json().challengeId, code: 'AAAA-AAAA-AAAA', deviceLabel: 'b' },
        }),
      ),
    );
    expect(res.filter((r) => r.statusCode === 503)).toHaveLength(3);
  });
});

describe('F2 (superseded 2026-10-23): the opt-in wait is retired, so me no longer reports one', () => {
  it('has no payoutWait in me', async () => {
    setNow(new Date('2026-10-17T12:00:00Z'));
    const id = await seedAccount(deps, { loginName: 'waitoff01' });
    const b = await loggedIn(id);
    expect((await b.get('/v1/account/me')).json()).not.toHaveProperty('payoutWait');
  });
});

describe('F3: API answers are never cached', () => {
  it('every /v1 answer, errors and secrets included, carries cache-control: no-store', async () => {
    setNow(new Date('2026-10-17T12:00:00Z'));
    const id = await seedAccount(deps, { loginName: 'nostore01' });
    const b = await loggedIn(id);
    const unauth = await app.inject({ method: 'GET', url: '/v1/account/me' });
    expect(unauth.statusCode).toBe(401);
    expect(unauth.headers['cache-control']).toBe('no-store');
    expect((await b.get('/v1/account/me')).headers['cache-control']).toBe('no-store');
    expect((await b.get('/v1/wallets')).headers['cache-control']).toBe('no-store');
    expect((await app.inject({ method: 'GET', url: '/v1/nothing-here' })).headers['cache-control']).toBe('no-store');
    // Percent-escaped spelling of /v1: the router decodes it.
    const escaped = await b.get('/%761/account/me');
    expect(escaped.statusCode).toBe(200);
    expect(escaped.headers['cache-control']).toBe('no-store');
    expect((await app.inject({ method: 'GET', url: '/%761/nothing-here' })).headers['cache-control']).toBe('no-store');
    // Early replies, before any preHandler: wrong Origin (403), malformed JSON (400).
    const crossOrigin = await app.inject({ method: 'POST', url: '/v1/logout', headers: { origin: 'https://evil.test' } });
    expect(crossOrigin.statusCode).toBe(403);
    expect(crossOrigin.headers['cache-control']).toBe('no-store');
    const badJson = await app.inject({
      method: 'POST', url: '/v1/login/password', headers: { origin: ORIGIN, 'content-type': 'application/json' }, payload: '{"a":',
    });
    expect(badJson.statusCode).toBe(400);
    expect(badJson.headers['cache-control']).toBe('no-store');
    // A 204 route: ending a session.
    const other = await loggedIn(id);
    const sessions = (await b.get('/v1/account/sessions')).json() as Array<{ id: string; current: boolean }>;
    const target = sessions.find((s) => !s.current)!;
    const del = await b.delete(`/v1/account/sessions/${target.id}`);
    expect(del.statusCode).toBe(204);
    expect(del.headers['cache-control']).toBe('no-store');
    void other;
    expect((await b.post('/v1/logout')).headers['cache-control']).toBe('no-store');
  });
});

describe('F4: look-alike display names (owner decision 2026-10-23)', () => {
  it('0/o, 1/l/i and rn/m fold only against reserved names; traders that merely look alike are both allowed', () => {
    for (const name of ['adm1n.team', 'Moderat0r', 'supp0rt', 'Adrnin.k']) {
      expect(checkDisplayName(name), name).toEqual({ ok: false, reason: 'reserved' });
    }
    for (const name of ['llya.k', 'Ilya.k', 'Alice.b', 'A1ice.b', 'm0nero.fan']) {
      expect(checkDisplayName(name).ok, name).toBe(true);
    }
  });

  it('a display name folding to a staff or owner display name is refused (the API check)', async () => {
    setNow(new Date('2026-10-17T18:00:00Z'));
    await seedAccount(deps, { loginName: 'owner.secret1', displayName: 'Marlin.0', kind: 'owner' });
    const res = await new Browser(app).post('/v1/register/webauthn/start', { displayName: 'Mar1in.o', loginName: 'fan.login1', kind: 'passkey' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'display-name-reserved' });
  });
});
