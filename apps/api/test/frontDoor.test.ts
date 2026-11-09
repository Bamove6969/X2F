// The front door (owner, 8 Nov 2026): "No one gets to make it past the front door and see behind the
// curtains without signing an agreement, creating an account and logging in. There are no free tours
// for outsiders." Every route that runs without a session is listed, with its reason, in
// PUBLIC_ROUTES; every marketplace read answers 401 with no data to anyone without a live session of
// a set-up trader account. Real Postgres, one database for the file.
import type { FastifyInstance, RouteOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Deps } from '../src/app.js';
import { OWN_DATA_READS, OWN_DATA_WRITES, PUBLIC_ROUTES, runsInside } from '../src/auth/frontDoor.js';
import { runsWithSession } from '../src/auth/sessions.js';
import type { MarketPrices, MarketQuote } from '../src/price/market.js';
import { makeVendor, seedAccount } from './helpers/accounts.js';
import { Browser } from './helpers/totp.js';
import { tradeApp } from './helpers/tradeApp.js';

// Every route the app registers, as Fastify's own onRoute hook sees it (as team.test.ts does).
const registered = vi.hoisted(() => [] as RouteOptions[]);
vi.mock('fastify', async (importOriginal) => {
  const m = await importOriginal<typeof import('fastify')>();
  const make = m.default as unknown as (...a: unknown[]) => FastifyInstance;
  const wrapped = Object.assign((...a: unknown[]) => {
    const app = make(...a);
    app.addHook('onRoute', (r) => {
      registered.push(r);
    });
    return app;
  }, m.default);
  return { ...m, default: wrapped, fastify: wrapped };
});

function quote(currency: string): MarketQuote | null {
  if (currency !== 'USD') return null;
  return { price: { currency, centsPerXmr: 33_000n }, at: new Date('2026-10-17T11:59:00Z'), sources: 3, exponent: 2, usdCentsPerXmr: 33_000n, fx: null };
}
const prices: MarketPrices = {
  current: (c) => quote(c)?.price ?? null,
  quote,
  health: () => ({}) as unknown as ReturnType<MarketPrices['health']>,
  poll: async () => {},
  start: () => {},
  stop: async () => {},
};

let app: FastifyInstance;
let deps: Deps;
let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];
let setNow: (d: Date) => void;
const T0 = new Date('2026-10-17T12:00:00Z');

beforeAll(async () => {
  ({ app, deps, trader, setNow } = await tradeApp({}, { prices }));
});
afterAll(async () => {
  await app.close();
});

/** A trader logged in with a recovery (backup) session, no hold. */
async function recoveryBrowser(): Promise<Browser> {
  const id = await seedAccount(deps, { loginName: `rec${Math.random().toString(36).slice(2, 10)}` });
  const b = new Browser(app);
  expect((await b.post('/t/login', { accountId: id, level: 'recovery' })).statusCode).toBe(200);
  return b;
}

/** A trader logged in on a Terms version older than the current one. */
async function staleTermsBrowser(): Promise<Browser> {
  const id = await seedAccount(deps, { loginName: `old${Math.random().toString(36).slice(2, 10)}`, termsVersion: '2020-01-01' });
  const b = new Browser(app);
  expect((await b.post('/t/login', { accountId: id })).statusCode).toBe(200);
  return b;
}

const MISSING_OFFER = '00000000-0000-4000-8000-000000000000';

// Each marketplace read, and what a signed-in, set-up trader gets.
const READS: { url: string; inside: number }[] = [
  { url: '/v1/methods?side=sell&currency=USD', inside: 200 },
  { url: '/v1/offers?side=sell&method=ZELLE&currency=USD', inside: 200 },
  { url: `/v1/offers/${MISSING_OFFER}`, inside: 404 },
  { url: '/v1/price?currency=USD', inside: 200 },
  { url: '/v1/news', inside: 200 },
];

/** `GET /v1/offers/:id` for `/v1/offers/<uuid>?x`: the route a READS url names. */
function routeOf(url: string): string {
  const path = url.split('?')[0]!;
  return `GET ${path.replace(MISSING_OFFER, ':id')}`;
}

describe('the route list', () => {
  it('every route without a session guard is a front-door route with a recorded reason, and every listed one exists', async () => {
    await app.ready();
    const open = new Set<string>();
    for (const r of registered) {
      if (r.url.startsWith('/t/')) continue; // the test login (helpers/totp.ts)
      if (runsWithSession(r.preHandler)) continue;
      for (const m of [r.method].flat()) if (m !== 'HEAD') open.add(`${m} ${r.url}`);
    }
    expect([...open].sort()).toEqual(Object.keys(PUBLIC_ROUTES).sort());
    for (const [route, why] of Object.entries(PUBLIC_ROUTES)) expect(why.length, route).toBeGreaterThan(5);
  });

  // Review 2026-11-08 F2: "some session" is not the front door. Every read behind a session either
  // runs behind `requireInside` (and is then checked below, logged out, half set up and on a
  // recovery session) or answers only the caller's own data, with the reason recorded.
  // Review 6a5949a6 F2b: every method, not only GET. A write behind a session (a "search" POST, say)
  // is behind requireInside or listed in OWN_DATA_WRITES with what it writes and answers.
  it('every session-guarded route, whatever its method, is behind requireInside or is listed as own-data-only with a reason; READS covers every requireInside route', async () => {
    await app.ready();
    const inside = new Set<string>();
    const ownReads = new Set<string>();
    const ownWrites = new Set<string>();
    for (const r of registered) {
      if (r.url.startsWith('/t/') || !runsWithSession(r.preHandler)) continue;
      for (const m of [r.method].flat()) {
        if (m === 'HEAD') continue;
        const route = `${m} ${r.url}`;
        if (runsInside(r.preHandler)) inside.add(route);
        else (m === 'GET' ? ownReads : ownWrites).add(route);
      }
    }
    expect([...ownReads].sort()).toEqual(Object.keys(OWN_DATA_READS).sort());
    expect([...ownWrites].sort()).toEqual(Object.keys(OWN_DATA_WRITES).sort());
    for (const [route, why] of Object.entries({ ...OWN_DATA_READS, ...OWN_DATA_WRITES })) expect(why.length, route).toBeGreaterThan(5);
    // Every requireInside route is a GET with its own checks below (READS); a write behind it fails here.
    expect([...inside].sort()).toEqual([...new Set(READS.map((r) => routeOf(r.url)))].sort());
    // No route is in two lists, and each list names routes that run the way it says.
    const all = [...Object.keys(PUBLIC_ROUTES), ...Object.keys(OWN_DATA_READS), ...Object.keys(OWN_DATA_WRITES), ...inside];
    expect(new Set(all).size, 'a route listed twice').toBe(all.length);
    for (const route of Object.keys(OWN_DATA_READS)) expect(route.startsWith('GET '), route).toBe(true);
    for (const route of Object.keys(OWN_DATA_WRITES)) expect(route.startsWith('GET '), route).toBe(false);
  });
});

describe('marketplace reads are behind the front door', () => {
  for (const { url, inside } of READS) {
    it(`${url}: 401 with no data logged out, ${inside} for a set-up trader`, async () => {
      const anon = await app.inject({ method: 'GET', url });
      expect(anon.statusCode).toBe(401);
      expect(anon.json()).toEqual({ error: 'not-authenticated' });

      // A made-up cookie is no session.
      const forged = await app.inject({ method: 'GET', url, cookies: { '__Host-x2f_session': 'A'.repeat(43) } });
      expect(forged.statusCode).toBe(401);
      expect(forged.json()).toEqual({ error: 'not-authenticated' });

      const t = await trader();
      expect((await t.browser.get(url)).statusCode).toBe(inside);
    });

    it(`${url}: refused, with no data, to a session that has not finished setup or is only a recovery session`, async () => {
      const stale = await (await staleTermsBrowser()).get(url);
      expect(stale.statusCode).toBe(403);
      expect(stale.json()).toEqual({ error: 'terms-required', version: deps.config.termsVersion });

      const rec = await (await recoveryBrowser()).get(url);
      expect(rec.statusCode).toBe(403);
      expect(rec.json()).toEqual({ error: 'recovery-session' });
    });
  }

  it('a logged-out offer list never reaches the database answer: the same 401 for a real offer as for none', async () => {
    const p = await trader();
    await makeVendor(deps, p.id); // batch 2 (owner 2 Nov 2026): only a vendor account posts offers
    await deps.db.query(
      `insert into wallets (account_id, app, label, address, created_at, usable_from) values ($1, 'cake', 'Main', $2, $3, $3)`,
      [p.id, `addr-${Math.random()}`, new Date(deps.clock().getTime() - 86_400_000)],
    );
    const posted = await p.browser.post('/v1/offers', {
      side: 'sell', methodId: 'ZELLE', currency: 'USD', pricing: { mode: 'market', marginBps: 0 },
      minFiatCents: '1000', maxFiatCents: '100000', minTrades: null, terms: 'Zelle only.',
    });
    expect(posted.statusCode, posted.body).toBe(201);
    const id = (posted.json() as { id: string }).id;
    for (const url of [`/v1/offers/${id}`, '/v1/offers?side=sell&method=ZELLE&currency=USD', '/v1/methods?side=sell&currency=USD']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(401);
      expect(res.body, url).not.toContain(p.displayName);
      expect(res.body, url).toBe('{"error":"not-authenticated"}');
    }
  });
});

// Review 2026-11-08 F1: a team member signs the agreement too ("No one gets to make it past the front
// door ... without signing an agreement"). Their own login account carries the Terms version they
// accepted; the team account's acceptance is the account owner's and never stands in for theirs.
describe('a team member signs the Terms themselves', () => {
  /** A joined member of a fresh team account, logged in, whose own login account accepted `terms`. */
  async function memberOn(terms: string | null) {
    const owner = await trader();
    const tag = Math.random().toString(36).slice(2, 10);
    const loginId = await seedAccount(deps, { loginName: `ml${tag}`, displayName: `m-${tag}-placeholder`, kind: 'member', termsVersion: terms });
    const now = deps.clock();
    await deps.db.query(
      `insert into team_members (account_id, display_name, display_key, roles, invite_expires_at, member_account_id, joined_at, created_at)
       values ($1, $2, $3, $4, $5, $6, $5, $5)`,
      [owner.id, `Mem${tag}`, `mem${tag}`, ['offers', 'trades'], now, loginId],
    );
    const browser = new Browser(app);
    expect((await browser.post('/t/login', { accountId: loginId })).statusCode).toBe(200);
    return { owner, loginId, browser };
  }

  it('a member on old Terms (or none) gets terms-required on every marketplace read, though the team account is current', async () => {
    for (const terms of [null, '2020-01-01']) {
      const m = await memberOn(terms);
      for (const { url } of READS) {
        const res = await m.browser.get(url);
        expect(res.statusCode, url).toBe(403);
        expect(res.json(), url).toEqual({ error: 'terms-required', version: deps.config.termsVersion });
      }
      const me = (await m.browser.get('/v1/account/me')).json() as { termsCurrent: boolean };
      expect(me.termsCurrent).toBe(false);
      // The site view is the outside one.
      expect((await m.browser.get('/v1/site')).json()).toEqual({ maintenance: null });
    }
  });

  it('the member accepts the Terms on their own login account and is inside; the team account row is untouched', async () => {
    const m = await memberOn('2020-01-01');
    const before = await deps.db.query<{ terms_accepted_at: Date | null }>('select terms_accepted_at from accounts where id = $1', [m.owner.id]);
    const wrong = await m.browser.post('/v1/account/terms', { version: '2020-01-01' });
    expect(wrong.statusCode).toBe(400);
    const ok = await m.browser.post('/v1/account/terms', { version: deps.config.termsVersion });
    expect(ok.statusCode, ok.body).toBe(204);
    const rows = await deps.db.query<{ terms_version: string | null }>('select terms_version from accounts where id = $1', [m.loginId]);
    expect(rows.rows[0]!.terms_version).toBe(deps.config.termsVersion);
    const after = await deps.db.query<{ terms_accepted_at: Date | null }>('select terms_accepted_at from accounts where id = $1', [m.owner.id]);
    expect(after.rows[0]!.terms_accepted_at?.toISOString()).toBe(before.rows[0]!.terms_accepted_at?.toISOString());
    for (const { url, inside } of READS) expect((await m.browser.get(url)).statusCode, url).toBe(inside);
    expect(((await m.browser.get('/v1/account/me')).json() as { termsCurrent: boolean }).termsCurrent).toBe(true);
  });

  it('a member on the current Terms is still outside while the team account is on old Terms (the owner accepts for the account)', async () => {
    const m = await memberOn(deps.config.termsVersion);
    await deps.db.query('update accounts set terms_version = $2 where id = $1', [m.owner.id, '2020-01-01']);
    for (const { url } of READS) expect((await m.browser.get(url)).statusCode, url).toBe(403);
    expect(((await m.browser.get('/v1/account/me')).json() as { termsCurrent: boolean }).termsCurrent).toBe(false);
    // The member's acceptance is theirs only: it does not accept for the account.
    expect((await m.browser.post('/v1/account/terms', { version: deps.config.termsVersion })).statusCode).toBe(204);
    const team = await deps.db.query<{ terms_version: string | null }>('select terms_version from accounts where id = $1', [m.owner.id]);
    expect(team.rows[0]!.terms_version).toBe('2020-01-01');
    expect((await m.browser.get('/v1/news')).statusCode).toBe(403);
  });
});

describe('GET /v1/site on both sides of the door', () => {
  it('outside: only the maintenance flag; inside: the banner and the trading pause too', async () => {
    await deps.db.query(`update site_flags set banner_text = 'Upgrade at noon', banner_kind = 'info', trading_paused = true`);
    try {
      const anon = await app.inject({ method: 'GET', url: '/v1/site' });
      expect(anon.statusCode).toBe(200);
      expect(anon.json()).toEqual({ maintenance: null });
      expect((await (await staleTermsBrowser()).get('/v1/site')).json()).toEqual({ maintenance: null });
      expect((await (await recoveryBrowser()).get('/v1/site')).json()).toEqual({ maintenance: null });

      const t = await trader();
      expect((await t.browser.get('/v1/site')).json()).toEqual({ banner: { text: 'Upgrade at noon', kind: 'info' }, tradingPaused: true, maintenance: null });
    } finally {
      await deps.db.query(`update site_flags set banner_text = null, banner_kind = null, trading_paused = false`);
    }
  });

  it('during maintenance the front door learns its kind but never its message', async () => {
    await deps.db.query(`update site_flags set maintenance_since = now(), maintenance_message = 'Back at 15:00 UTC', maintenance_kind = 'planned'`);
    try {
      const anon = await app.inject({ method: 'GET', url: '/v1/site' });
      expect(anon.json()).toEqual({ maintenance: { kind: 'planned' } });
      expect(anon.body).not.toContain('15:00');
      const t = await trader();
      expect((await t.browser.get('/v1/site')).json()).toMatchObject({ maintenance: { kind: 'planned', message: 'Back at 15:00 UTC' } });
      // Everything else is shut during maintenance, the reads behind the door included.
      expect((await t.browser.get('/v1/news')).statusCode).toBe(503);
    } finally {
      await deps.db.query(`update site_flags set maintenance_since = null, maintenance_message = null, maintenance_kind = null`);
    }
  });

  it('reading /v1/site never counts as activity on the session', async () => {
    const t = await trader();
    const before = await deps.db.query<{ last_seen_at: Date }>('select last_seen_at from sessions where account_id = $1', [t.id]);
    setNow(new Date(T0.getTime() + 60_000));
    try {
      expect((await t.browser.get('/v1/site')).statusCode).toBe(200);
      expect((await t.browser.get('/v1/news')).statusCode).toBe(200);
    } finally {
      setNow(T0);
    }
    const after = await deps.db.query<{ last_seen_at: Date }>('select last_seen_at from sessions where account_id = $1', [t.id]);
    expect(after.rows[0]!.last_seen_at.toISOString()).toBe(before.rows[0]!.last_seen_at.toISOString());
  });
});
