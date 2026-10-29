// Plan 2 Task 17 (owner, 2026-10-29): login strength and the 24-hour cooling-off. One block per row
// of the owner's rule.
import { readFileSync } from 'node:fs';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deps } from '../src/app.js';
import { issueConfirmToken } from '../src/auth/confirm.js';
import {
  COOLING_BLOCKED_ROUTES, COOLING_OFF_MS, RECOVERY_CODE_ALONE_WAITS, SECURITY_CHANGE_ROUTES, loginStrength, startCooling,
} from '../src/auth/strength.js';
import { approvedLogin } from './helpers/approval.js';
import { fixtureLeakedList } from './helpers/leaked.js';
import { createSoftAuthenticator, type SoftAuthenticator } from './helpers/softAuthenticator.js';
import { FIAT, driveTo, seedTrade } from './helpers/trades.js';
import { tradeApp } from './helpers/tradeApp.js';
import { Browser, codeAt } from './helpers/totp.js';

const ORIGIN = 'https://x2f.test';
const TERMS = '2026-10-17';
const GOOD = 'Correct-Horse-9';
const HOUR = 3600_000;
const T0 = new Date('2026-10-17T12:00:00Z');

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let now = T0;
let step = 0;
let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const fixture = await fixtureLeakedList();
  cleanup = fixture.cleanup;
  let set: (d: Date) => void;
  ({ app, deps, setNow: set, trader } = await tradeApp({}, { leaked: fixture.list }));
  setNow = (d) => {
    now = d;
    set(d);
  };
});

afterAll(async () => {
  await app.close();
  await cleanup();
});

beforeEach(() => {
  setNow(new Date(T0.getTime() + ++step * 48 * HOUR));
  vi.restoreAllMocks();
});

let seq = 0;
const unique = (p: string) => `${p}${++seq}x`;
const errorOf = (r: LightMyRequestResponse) => (r.json() as { error?: string }).error;

async function cooling(accountId: string): Promise<string | null> {
  const { rows } = await deps.db.query<{ cooling_until: Date | null }>('select cooling_until from accounts where id = $1', [accountId]);
  const u = rows[0]!.cooling_until;
  return u !== null && u.getTime() > now.getTime() ? u.toISOString() : null;
}

const in24h = () => new Date(now.getTime() + COOLING_OFF_MS).toISOString();

/** A password trader signed up in `b` (its sign-up session stays open there). */
async function passwordTrader(b = new Browser(app)) {
  const name = unique('cool');
  const res = await b.post('/v1/register/password', { displayName: `P${name}`, loginName: name, password: GOOD, deviceLabel: 'Laptop', acceptedTerms: TERMS });
  expect(res.statusCode).toBe(201);
  const { rows } = await deps.db.query<{ id: string }>('select id from accounts where login_key = $1', [name.toLowerCase()]);
  return { b, name, id: rows[0]!.id };
}

const passwordLogin = (b: Browser, name: string) => b.post('/v1/login/password', { loginName: name, password: GOOD, deviceLabel: 'Browser on Linux' });

/** A confirm token for `action` on the session of browser `b` (the confirm routes are tested elsewhere). */
async function tokenFor(b: Browser, accountId: string, action: Parameters<typeof issueConfirmToken>[1]['action']) {
  const s = (await b.get('/v1/account/me')).statusCode;
  expect(s).toBe(200);
  const { rows } = await deps.db.query<{ id: string }>(
    'select id from sessions where account_id = $1 and revoked_at is null order by created_at desc limit 1',
    [accountId],
  );
  return issueConfirmToken(deps, { sessionId: rows[0]!.id, accountId, action, method: 'password' });
}

/** Signs up a passkey trader in `b`; returns its authenticator. */
async function passkeyTrader(b = new Browser(app)): Promise<{ b: Browser; id: string; auth: SoftAuthenticator }> {
  const auth = createSoftAuthenticator({ backedUp: true, userVerified: true });
  const name = unique('passkeyuser');
  const startRes = await b.post('/v1/register/webauthn/start', { displayName: `D.${name}`, loginName: name, kind: 'passkey' });
  expect(startRes.json()).toHaveProperty('options');
  const start = startRes.json();
  expect((await b.post('/v1/register/webauthn/finish', { challengeId: start.challengeId, response: auth.register(start.options, ORIGIN), deviceLabel: 'Phone', acceptedTerms: TERMS })).statusCode).toBe(201);
  const { rows } = await deps.db.query<{ id: string }>('select id from accounts where login_key = $1', [name.toLowerCase()]);
  return { b, id: rows[0]!.id, auth };
}

async function passkeyLogin(b: Browser, auth: SoftAuthenticator) {
  const s = (await b.post('/v1/login/webauthn/start', {})).json();
  return b.post('/v1/login/webauthn/finish', { challengeId: s.challengeId, response: auth.authenticate(s.options, ORIGIN), deviceLabel: 'Phone' });
}

describe('login strength', () => {
  it('two factors, or a PGP key, passkey or security key alone, are strong; one weak way is weak', () => {
    expect(loginStrength(['password', 'totp'])).toBe('two-factor');
    expect(loginStrength(['pgp', 'passkey'])).toBe('two-factor');
    expect(loginStrength(['passkey'])).toBe('strong-single');
    expect(loginStrength(['security-key'])).toBe('strong-single');
    expect(loginStrength(['pgp'])).toBe('strong-single');
    expect(loginStrength(['password'])).toBe('weak-single');
    expect(loginStrength(['totp'])).toBe('weak-single');
    expect(RECOVERY_CODE_ALONE_WAITS).toBe(true);
    expect(loginStrength(['recovery-code'])).toBe('weak-single');
  });
});

describe('good security: no wait', () => {
  it('a passkey on its own on a new device with nothing logged in', async () => {
    const { b, id, auth } = await passkeyTrader();
    await b.post('/v1/logout');
    const fresh = new Browser(app);
    expect((await passkeyLogin(fresh, auth)).json()).toEqual({ status: 'ok' });
    expect(await cooling(id)).toBeNull();
  });

  it('a password with its authenticator code on a new device with nothing logged in', async () => {
    const { b, name, id } = await passwordTrader();
    const s = (await b.post('/v1/account/totp/start', {})).json() as { challengeId: string; secret: string };
    expect((await b.post('/v1/account/totp/finish', { challengeId: s.challengeId, code: codeAt(s.secret, now) })).statusCode).toBe(200);
    await b.post('/v1/logout');
    setNow(new Date(now.getTime() + 60_000));
    const fresh = new Browser(app);
    const first = (await passwordLogin(fresh, name)).json() as { pendingId: string };
    expect((await fresh.post('/v1/login/second-factor', { pendingId: first.pendingId, code: codeAt(s.secret, now) })).json()).toEqual({ status: 'ok' });
    expect(await cooling(id)).toBeNull();
  });

  it('a strong session changing its login methods starts no wait', async () => {
    const { b, id } = await passkeyTrader();
    setNow(new Date(now.getTime() + HOUR)); // past the sign-up window
    const token = await tokenFor(b, id, { kind: 'new-recovery-codes' });
    expect((await b.post('/v1/account/recovery-codes', { confirmToken: token })).statusCode).toBe(200);
    expect(await cooling(id)).toBeNull();
  });
});

describe('one weak way', () => {
  it('a password alone that then changes the password cools the account off for 24 hours', async () => {
    const { b, name, id } = await passwordTrader();
    await b.post('/v1/logout');
    // The same (trusted) browser logs in again with the password alone: no wait yet.
    expect((await passwordLogin(b, name)).json()).toEqual({ status: 'ok' });
    expect(await cooling(id)).toBeNull();
    const token = await tokenFor(b, id, { kind: 'set-password' });
    expect((await b.put('/v1/account/password', { password: 'Another-Horse-8', confirmToken: token })).statusCode).toBe(200);
    expect(await cooling(id)).toBe(in24h());
    expect((await b.get('/v1/account/me')).json()).toMatchObject({ coolingUntil: in24h() });
    const { rows } = await deps.db.query("select detail from alerts where account_id = $1 and kind = 'cooling-off-started'", [id]);
    expect(rows).toEqual([{ detail: { until: in24h(), reason: 'weak-login-changed-security' } }]);
  });

  it('the sign-up session setting the account up starts no wait', async () => {
    const { b, id } = await passwordTrader();
    expect((await b.post('/v1/account/recovery-codes', {})).statusCode).toBe(200);
    expect(await cooling(id)).toBeNull();
  });

  it('a password alone on a new device with nothing logged in to approve it waits 24 hours at once', async () => {
    const { b, name, id } = await passwordTrader();
    await b.post('/v1/logout');
    const fresh = new Browser(app);
    expect((await passwordLogin(fresh, name)).json()).toEqual({ status: 'ok' });
    expect(await cooling(id)).toBe(in24h());
  });

  it('a password alone on a new device approved by a logged-in device: no wait at login', async () => {
    const { name, id } = await passwordTrader();
    const fresh = new Browser(app);
    expect(await approvedLogin(deps, await passwordLogin(fresh, name), (u) => fresh.post(u))).toEqual({ status: 'ok' });
    expect(await cooling(id)).toBeNull();
  });

  it('an authenticator code alone (backup login): held, and the account cools off', async () => {
    const { b, name, id } = await passwordTrader();
    const s = (await b.post('/v1/account/totp/start', {})).json() as { challengeId: string; secret: string };
    expect((await b.post('/v1/account/totp/finish', { challengeId: s.challengeId, code: codeAt(s.secret, now) })).statusCode).toBe(200);
    setNow(new Date(now.getTime() + 60_000));
    const res = await new Browser(app).post('/v1/login/backup', { loginName: name, kind: 'totp', code: codeAt(s.secret, now), deviceLabel: 'X' });
    expect(res.json()).toMatchObject({ status: 'ok', level: 'recovery', holdUntil: in24h() });
    expect(await cooling(id)).toBe(in24h());
  });

  it('a recovery code alone (backup login): held, and the account cools off (RECOVERY_CODE_ALONE_WAITS)', async () => {
    const { b, name, id } = await passwordTrader();
    const { codes } = (await b.post('/v1/account/recovery-codes', {})).json() as { codes: string[] };
    const res = await new Browser(app).post('/v1/login/backup', { loginName: name, kind: 'recovery-code', code: codes[0]!, deviceLabel: 'X' });
    expect(res.json()).toEqual({ status: 'ok', level: 'recovery', holdUntil: in24h() });
    expect(await cooling(id)).toBe(in24h());
  });
});

describe('during the cooling-off', () => {
  it('no new trades or offers, no wallet changes; pausing an offer is fine', async () => {
    const t = await trader();
    await startCooling(deps.db, t.id, now, 'weak-login-new-device');
    const until = in24h();
    const take = await t.browser.post('/v1/offers/00000000-0000-4000-8000-000000000000/take', {});
    expect(take.json()).toEqual({ error: 'cooling-off', coolingUntil: until });
    expect(errorOf(await t.browser.post('/v1/offers', {}))).toBe('cooling-off');
    expect(errorOf(await t.browser.post('/v1/wallets', {}))).toBe('cooling-off');
    expect(errorOf(await t.browser.delete('/v1/wallets/00000000-0000-4000-8000-000000000000'))).toBe('cooling-off');
    const { rows } = await deps.db.query<{ id: string }>(
      `insert into offers (account_id, side, method_id, currency, price_mode, margin_bps, min_fiat_cents, max_fiat_cents, min_trades, terms, status, created_at, updated_at)
       values ($1, 'sell', 'zelle', 'USD', 'market', 0, 1000, 100000, 0, '', 'paused', $2, $2) returning id`,
      [t.id, now],
    );
    expect(errorOf(await t.browser.patch(`/v1/offers/${rows[0]!.id}`, { status: 'live' }))).toBe('cooling-off');
    const removed = await t.browser.patch(`/v1/offers/${rows[0]!.id}`, { status: 'removed' });
    expect(removed.statusCode).toBeLessThan(300);
  });

  it('a trade already open can still be finished (mark paid)', async () => {
    const seller = await trader();
    const buyer = await trader();
    const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
    const t = await driveTo(deps, trade, 'secured');
    await startCooling(deps.db, buyer.id, now, 'weak-login-new-device');
    const res = await buyer.browser.post(`/v1/trades/${t.code}/events`, { type: 'mark-paid', fiatCents: FIAT.toString() });
    expect(res.statusCode).toBe(200);
    const { rows } = await deps.db.query<{ state: string }>('select state from trades where code = $1', [t.code]);
    expect(rows[0]!.state).toBe('paid');
  });

  it('no approving a new device (blocking it is still possible)', async () => {
    const { b, name, id } = await passwordTrader();
    const w1 = (await passwordLogin(new Browser(app), name)).json() as { approvalId: string; number: number };
    await startCooling(deps.db, id, now, 'weak-login-changed-security');
    const r = await b.post(`/v1/account/approvals/${w1.approvalId}`, { choice: w1.number });
    expect(r.json()).toEqual({ error: 'cooling-off', coolingUntil: in24h() });
    expect((await b.post(`/v1/account/approvals/${w1.approvalId}`, { block: true })).json()).toEqual({ outcome: 'blocked' });
  });

  it('ends after 24 hours', async () => {
    const t = await trader();
    await startCooling(deps.db, t.id, now, 'weak-login-new-device');
    setNow(new Date(now.getTime() + COOLING_OFF_MS));
    expect(errorOf(await t.browser.post('/v1/offers/00000000-0000-4000-8000-000000000000/take', {}))).not.toBe('cooling-off');
  });
});

describe('a strong login by the real owner ends it', () => {
  it('with a passkey held before the cooling started: straight in on a new device, and the wait ends', async () => {
    const { b, id, auth } = await passkeyTrader();
    setNow(new Date(now.getTime() + HOUR));
    await startCooling(deps.db, id, now, 'weak-login-changed-security');
    // Another device is logged in (b), yet the owner's own passkey needs no approval during the cooling.
    const fresh = new Browser(app);
    expect((await passkeyLogin(fresh, auth)).json()).toEqual({ status: 'ok' });
    expect(await cooling(id)).toBeNull();
    const { rows } = await deps.db.query("select 1 from alerts where account_id = $1 and kind = 'cooling-off-ended'", [id]);
    expect(rows).toHaveLength(1);
    // And can sign the other session out.
    const list = (await fresh.get('/v1/account/sessions')).json() as Array<{ id: string; current: boolean }>;
    for (const s of list.filter((x) => !x.current)) expect((await fresh.delete(`/v1/account/sessions/${s.id}`)).statusCode).toBe(204);
    expect((await b.get('/v1/account/me')).statusCode).toBe(401);
  });

  it('a passkey added during the cooling never ends it', async () => {
    const { b, id, auth } = await passkeyTrader();
    setNow(new Date(now.getTime() + HOUR));
    await startCooling(deps.db, id, now, 'weak-login-changed-security');
    await deps.db.query('update webauthn_credentials set created_at = $2 where account_id = $1', [id, new Date(now.getTime() + 1000)]);
    setNow(new Date(now.getTime() + 2000));
    await b.post('/v1/logout');
    expect((await passkeyLogin(new Browser(app), auth)).json()).toEqual({ status: 'ok' });
    expect(await cooling(id)).not.toBeNull();
  });
});

describe('every new login is pushed', () => {
  it('"New login to your account"', async () => {
    const send = vi.spyOn(app.push, 'send');
    const { b, name, id } = await passwordTrader();
    expect(send).not.toHaveBeenCalled(); // a sign-up is not a new login
    await b.post('/v1/logout');
    await passwordLogin(b, name);
    expect(send).toHaveBeenCalledWith(id, 'new-login');
  });
});

describe('the route lists', () => {
  it('name routes that exist, and each blocked route carries the cooling check', () => {
    for (const r of [...SECURITY_CHANGE_ROUTES, ...COOLING_BLOCKED_ROUTES]) {
      const [method, url] = r.split(' ') as ['GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', string];
      expect(app.hasRoute({ method, url }), r).toBe(true);
    }
    const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
    expect(src('trades/take.ts')).toContain("'/v1/offers/:id/take', { preHandler: [requireTrader, requireNotCooling] }");
    expect(src('offers/routes.ts')).toContain("'/v1/offers', { preHandler: [requireTrader, requireNotCooling] }");
    expect(src('wallets/routes.ts')).toContain("'/v1/wallets/:id', { preHandler: [session, requireNotCooling] }");
    // The trade-finishing routes stay open during the cooling.
    for (const f of ['trades/routes.ts', 'disputes/routes.ts']) expect(src(f)).not.toContain('requireNotCooling');
  });
});

