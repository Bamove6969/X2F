import { checkUsername } from '@x2f/accounts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { START_BUCKET } from '../src/limits.js';
import { seedAccount } from './helpers/accounts.js';
import { testApp } from './helpers/app.js';
import { Browser, ORIGIN, addTestLogin } from './helpers/totp.js';

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

describe('F1: the request budgets are global (Important; residual, needs a per-source limit in front)', () => {
  it('one anonymous client spending the start budget makes every other login answer 503 busy', async () => {
    // The budget is per process, not per source: the API stores no IPs (R5), so it cannot tell
    // the flooder from anyone else. This test pins today's behaviour; when a per-source limit
    // exists, a legitimate login must survive the flood and this test is to be inverted.
    for (let i = 0; i < START_BUCKET.capacity; i++) {
      const res = await app.inject({
        method: 'POST', url: '/v1/login/webauthn/start', headers: { origin: ORIGIN }, payload: { username: `nobody${i}xx` },
      });
      expect(res.statusCode).toBe(200);
    }
    const victim = await new Browser(app).post('/v1/login/password', { username: 'realuser1', password: 'x', deviceLabel: 'b' });
    expect(victim.statusCode).toBe(503);
    expect(victim.json()).toMatchObject({ error: 'busy' });
    // The owner's security-key login start is refused the same way.
    const owner = await new Browser(app).post('/v1/login/webauthn/start', { username: 'theowner1' });
    expect(owner.statusCode).toBe(503);
  });
});

describe('F2: GET /v1/account/me shows the 24-hour wait the way the wallet routes apply it', () => {
  it('after a scheduled switch-off has taken effect, the wait is reported as off', async () => {
    const t0 = new Date('2026-10-17T12:00:00Z');
    setNow(t0);
    const id = await seedAccount(deps, { username: 'waitoff01' });
    const offAt = new Date(t0.getTime() + 24 * HOUR);
    await deps.db.query('update accounts set payout_wait = true, payout_wait_off_at = $2 where id = $1', [id, offAt]);
    const b = await loggedIn(id);
    expect((await b.get('/v1/account/me')).json().payoutWait).toEqual({ enabled: true, offAt: offAt.toISOString() });
    setNow(new Date(offAt.getTime() + 1000));
    // Same account, the wait no longer applies to a new wallet (payoutWaitActive): me must say so.
    expect((await b.get('/v1/account/me')).json().payoutWait).toEqual({ enabled: false, offAt: null });
  });
});

describe('F3: API answers are never cached', () => {
  it('every /v1 answer, errors and secrets included, carries cache-control: no-store', async () => {
    setNow(new Date('2026-10-17T12:00:00Z'));
    const id = await seedAccount(deps, { username: 'nostore01' });
    const b = await loggedIn(id);
    const unauth = await app.inject({ method: 'GET', url: '/v1/account/me' });
    expect(unauth.statusCode).toBe(401);
    expect(unauth.headers['cache-control']).toBe('no-store');
    expect((await b.get('/v1/account/me')).headers['cache-control']).toBe('no-store');
    expect((await b.get('/v1/wallets')).headers['cache-control']).toBe('no-store');
    expect((await b.post('/v1/logout')).headers['cache-control']).toBe('no-store');
    expect((await app.inject({ method: 'GET', url: '/v1/nothing-here' })).headers['cache-control']).toBe('no-store');
  });
});

describe('F4: look-alike usernames beyond case and non-ASCII (Minor; owner decision, plan-2-review.md "For the owner")', () => {
  it('digit and capital-I look-alikes of staff words and of each other are accepted today', () => {
    // Pins today's rule (Task 1: case-insensitive uniqueness, ASCII only, reserved tokens/prefixes).
    // Whether to fold 0/o, 1/l/i, rn/m before the uniqueness and reserved checks trades scams
    // against false refusals of real names, so it is the owner's call; invert these when decided.
    for (const name of ['adm1n.team', 'Moderat0r', 'supp0rt', 'llya.k', 'Ilya.k']) {
      expect(checkUsername(name).ok, name).toBe(true);
    }
    expect(checkUsername('Alice.b').ok && checkUsername('A1ice.b').ok).toBe(true);
  });
});
