// Plan 4 Task 8: the site controls. The emergency stop (a tapped staff action) refuses new offers
// and takes while existing trades go on; the 140-character banner; maintenance, during which the
// trader API answers 503 `maintenance` except GET /v1/site, while the staff API still answers; and
// GET /v1/site, which answers anyone but shows the banner and the trading pause only to a signed-in,
// set-up trader (the front door, owner 8 Nov 2026; test/frontDoor.test.ts).
import { fiatCents } from '@x2f/trade';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import type { MarketPrices, MarketQuote } from '../src/price/market.js';
import { buildStaffApi } from '../src/staff/app.js';
import { applyEvent, loadTrade } from '../src/trades/store.js';
import { MODERATION_STUB, STAFF_ORIGIN, StaffBrowser, errorOf, insertSession, logEntries, seedStaff, seedTap } from './helpers/staffApp.js';
import { tradeApp } from './helpers/tradeApp.js';
import { XMR, driveTo, fakeAddress, seedTrade } from './helpers/trades.js';
import { makeVendor } from './helpers/accounts.js';
import { flexBody } from './helpers/offers.js';

const T0 = new Date('2026-11-02T12:00:00Z');
const MIN = 60_000;
const DAY = 86_400_000;

function quote(currency: string): MarketQuote | null {
  if (currency !== 'USD') return null;
  return { price: { currency, centsPerXmr: 33_000n }, at: new Date(T0.getTime() - MIN), sources: 3, exponent: 2, usdCentsPerXmr: 33_000n, fx: null };
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
let staff: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];
let owner: StaffBrowser;
let ownerId: string;

beforeAll(async () => {
  ({ app, deps, trader, setNow } = await tradeApp({}, { prices }));
  setNow(T0);
  staff = await buildStaffApi({ ...deps, staffOrigin: STAFF_ORIGIN, moderation: MODERATION_STUB });
  ownerId = (await seedStaff(deps, { role: 'owner' })).id;
  owner = new StaffBrowser(staff).withSession((await insertSession(deps, ownerId, 'staff')).token);
});
afterAll(async () => {
  await staff.close();
  await app.close();
});

/** GET /v1/site as a signed-in trader sees it (a fresh one each time, so no session outlives a clock jump). */
const site = async () => (await (await trader()).browser.get('/v1/site')).json() as Record<string, unknown>;
/** GET /v1/site as the front door sees it (no session). */
const outside = async () => (await app.inject({ method: 'GET', url: '/v1/site' })).json() as Record<string, unknown>;
const relogin = async (...who: { id: string; browser: { post(u: string, b: unknown): Promise<{ statusCode: number }> } }[]) => {
  for (const w of who) expect((await w.browser.post('/t/login', { accountId: w.id })).statusCode).toBe(200);
};

/** A trader with one usable wallet. */
async function person() {
  const t = await trader();
  const { rows } = await deps.db.query<{ id: string }>(
    `insert into wallets (account_id, app, label, address, created_at, usable_from) values ($1, 'feather', 'Main', $2, $3, $4) returning id`,
    [t.id, fakeAddress(), new Date(deps.clock().getTime() - 2 * DAY), new Date(deps.clock().getTime() - DAY)],
  );
  return { ...t, wallet: rows[0]!.id };
}

const OFFER = {
  side: 'sell', methodId: 'ZELLE', currency: 'USD', pricing: { mode: 'market', marginBps: 0 },
  minFiatCents: '1000', maxFiatCents: '100000', minTrades: null, terms: 'Zelle only.',
};

describe('GET /v1/site', () => {
  it('answers without a session with the maintenance flag only, and says nothing is on', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/site' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toEqual({ maintenance: null, plannedMaintenance: null });
    expect(await site()).toEqual({ banner: null, tradingPaused: false, maintenance: null, plannedMaintenance: null });
  });
});

describe('emergency stop', () => {
  it('needs a tap for emergency-stop; while stopped, take and post refuse trading-paused and existing trades go on; resume needs its own tap', async () => {
    setNow(T0);
    const seller = await person();
    // Only a vendor posts offers (account types, owner 2 Nov).
    await makeVendor(deps, seller.id);
    const buyer = await person();
    const posted = await seller.browser.post('/v1/offers', flexBody(OFFER));
    expect(posted.statusCode, posted.body).toBe(201);
    const offerId = (posted.json() as { id: string }).id;

    // Existing trades: one paid (the seller releases), one secured past payBy (the seller asks for a refund),
    // one paid whose confirm window will end (the buyer opens a dispute).
    const s = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
    const paid = await driveTo(deps, s.trade, 'paid');
    const r = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
    const secured = await driveTo(deps, r.trade, 'secured');
    const d = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
    await driveTo(deps, d.trade, 'paid');

    const stopsBefore = (await logEntries(deps, 'site.stopped')).length;
    for (const body of [{}, { tapId: await seedTap(deps, ownerId, { kind: 'resume-trading' }) }]) {
      const res = await owner.post('/staff/v1/site/stop', body);
      expect({ status: res.statusCode, error: errorOf(res) }).toEqual({ status: 403, error: 'tap-invalid' });
    }
    expect((await site()).tradingPaused).toBe(false);

    const tapId = await seedTap(deps, ownerId, { kind: 'emergency-stop' });
    const stop = await owner.post('/staff/v1/site/stop', { tapId });
    expect(stop.statusCode, stop.body).toBe(200);
    expect(stop.json()).toMatchObject({ tradingPaused: true, stoppedAt: T0.toISOString() });
    expect((await site()).tradingPaused).toBe(true);
    expect((await logEntries(deps, 'site.stopped')).length).toBe(stopsBefore + 1);
    expect(errorOf(await owner.post('/staff/v1/site/stop', { tapId }))).toBe('tap-invalid');

    try {
      const amount = XMR / 20n;
      const take = await buyer.browser.post(`/v1/offers/${offerId}/take`, {
        amountAtomic: amount.toString(), walletId: buyer.wallet, centsPerXmr: '33000',
        fiatCents: fiatCents(amount, { currency: 'USD', centsPerXmr: 33_000n }).toString(), methodId: 'ZELLE', currency: 'USD',
      });
      expect({ status: take.statusCode, error: errorOf(take) }).toEqual({ status: 409, error: 'trading-paused' });
      const post = await seller.browser.post('/v1/offers', flexBody(OFFER));
      expect({ status: post.statusCode, error: errorOf(post) }).toEqual({ status: 409, error: 'trading-paused' });

      const release = await seller.browser.post(`/v1/trades/${paid.code}/events`, { type: 'release-started' });
      expect(release.statusCode, release.body).toBe(200);
      expect((await loadTrade(deps.db, paid.code))!.state).toBe('settling');

      setNow(new Date(Math.max(secured.payBy!.getTime(), T0.getTime() + 120 * MIN) + MIN));
      await relogin(seller, buyer);
      const refund = await seller.browser.post(`/v1/trades/${secured.code}/events`, { type: 'request-refund' });
      expect(refund.statusCode, refund.body).toBe(200);
      const dispute = await buyer.browser.post(`/v1/trades/${d.code}/dispute`, { reason: 'paid', note: '' });
      expect(dispute.statusCode, dispute.body).toBe(200);
      expect((await loadTrade(deps.db, d.code))!.state).toBe('disputed');
    } finally {
      setNow(T0);
      const wrong = await owner.post('/staff/v1/site/resume', { tapId: await seedTap(deps, ownerId, { kind: 'emergency-stop' }) });
      expect(errorOf(wrong)).toBe('tap-invalid');
      const resume = await owner.post('/staff/v1/site/resume', { tapId: await seedTap(deps, ownerId, { kind: 'resume-trading' }) });
      expect(resume.statusCode, resume.body).toBe(200);
      expect(resume.json()).toMatchObject({ tradingPaused: false, stoppedAt: null });
    }
    expect((await site()).tradingPaused).toBe(false);
    expect((await logEntries(deps, 'site.resumed')).length).toBeGreaterThan(0);
    // The settling trade still finishes.
    expect((await applyEvent(deps, paid.code, { type: 'settled', kind: 'release', txHash: 'ab'.repeat(32) }, 'system')).state).toBe('released');
  });
});

describe('banner', () => {
  it('sets a banner of up to 140 characters, refuses 141 with banner-too-long, shows it on GET /v1/site and removes it', async () => {
    const long = await owner.send('PUT', '/staff/v1/site/banner', { text: 'a'.repeat(141), kind: 'info' });
    expect({ status: long.statusCode, error: errorOf(long) }).toEqual({ status: 400, error: 'banner-too-long' });
    // 140 characters, counted as Postgres counts them (an emoji is one).
    const text = `${'🛠'.repeat(10)}${'b'.repeat(130)}`;
    const ok = await owner.send('PUT', '/staff/v1/site/banner', { text, kind: 'warning' });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await site()).banner).toEqual({ text, kind: 'warning' });
    expect(await outside()).toEqual({ maintenance: null, plannedMaintenance: null });
    const entries = await logEntries(deps, 'site.banner-set');
    expect(entries.at(-1)!.detail).toBe('{"kind":"warning"}');

    for (const body of [{ text: 'x', kind: 'danger' }, { text: '   ', kind: 'info' }, { text: 'two\nlines', kind: 'info' }, { text: 5, kind: 'info' }, { text: 'x', kind: 'info', extra: 1 }]) {
      const res = await owner.send('PUT', '/staff/v1/site/banner', body);
      expect({ status: res.statusCode, error: errorOf(res) }, JSON.stringify(body)).toEqual({ status: 400, error: 'bad-request' });
    }
    expect((await owner.send('DELETE', '/staff/v1/site/banner')).statusCode).toBe(204);
    expect((await site()).banner).toBeNull();
    expect((await logEntries(deps, 'site.banner-removed')).length).toBe(1);
    // Removing no banner logs nothing.
    expect((await owner.send('DELETE', '/staff/v1/site/banner')).statusCode).toBe(204);
    expect((await logEntries(deps, 'site.banner-removed')).length).toBe(1);
  });
});

describe('the 60-day close switch (security review 8 Nov M1)', () => {
  it('POST /staff/v1/site/auto-close/resume turns the close back on and logs it; when it is on, it changes and logs nothing', async () => {
    await deps.db.query('update site_flags set auto_close_off_at = $1', [T0]);
    const res = await owner.post('/staff/v1/site/auto-close/resume', {});
    expect([res.statusCode, res.json()]).toEqual([200, { autoClose: 'on' }]);
    expect((await deps.db.query('select auto_close_off_at from site_flags')).rows).toEqual([{ auto_close_off_at: null }]);
    expect((await logEntries(deps, 'site.auto-close-resumed')).length).toBe(1);
    expect((await owner.post('/staff/v1/site/auto-close/resume', {})).statusCode).toBe(200);
    expect((await logEntries(deps, 'site.auto-close-resumed')).length).toBe(1);
    expect(errorOf(await owner.post('/staff/v1/site/auto-close/resume', { on: true }))).toBe('bad-request');
  });
});

describe('maintenance', () => {
  it('turns the trader API to 503 maintenance except GET /v1/site; the staff API still answers; off again restores it', async () => {
    setNow(T0);
    const t = await trader();
    // Owner G19: no default kind (an emergency is internal): turning it on without one is 400.
    expect((await owner.send('PUT', '/staff/v1/site/maintenance', { on: true })).statusCode).toBe(400);
    const on = await owner.send('PUT', '/staff/v1/site/maintenance', { on: true, message: 'Upgrading the database. Back by 14:00 UTC.', kind: 'planned' });
    expect(on.statusCode, on.body).toBe(200);
    expect(on.json()).toMatchObject({ maintenance: { since: T0.toISOString(), message: 'Upgrading the database. Back by 14:00 UTC.', kind: 'planned', backBy: null } });
    try {
      for (const url of ['/v1/offers?side=sell&method=ZELLE&currency=USD', '/v1/news', '/v1/methods?side=sell&currency=USD', '/%761/news']) {
        const res = await app.inject({ method: 'GET', url });
        expect({ status: res.statusCode, error: errorOf(res) }, url).toEqual({ status: 503, error: 'maintenance' });
      }
      const signedIn = await t.browser.get('/v1/account/me');
      expect(signedIn.statusCode).toBe(503);
      expect(await site()).toEqual({
        banner: null,
        tradingPaused: false,
        maintenance: { message: 'Upgrading the database. Back by 14:00 UTC.', kind: 'planned', since: T0.toISOString(), backBy: null },
        plannedMaintenance: null,
      });
      expect(await outside()).toEqual({ maintenance: { kind: 'planned' }, plannedMaintenance: null });
      expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
      // The staff API is a separate server: still answering.
      expect((await owner.get('/staff/v1/site')).statusCode).toBe(200);
      expect((await owner.get('/staff/v1/me')).statusCode).toBe(200);

      // Turning it on again keeps the start (the timers shift by the whole maintenance) and logs nothing new.
      setNow(new Date(T0.getTime() + 10 * MIN));
      const again = await owner.send('PUT', '/staff/v1/site/maintenance', { on: true, kind: 'unplanned' });
      expect(again.json()).toMatchObject({ maintenance: { since: T0.toISOString(), message: null, kind: 'unplanned' } });
      expect((await logEntries(deps, 'site.maintenance-on')).map((e) => e.detail)).toEqual(['{"kind":"planned"}']);
      const { rows } = await deps.db.query<{ since: Date }>('select maintenance_since as since from site_flags');
      expect(rows[0]!.since).toEqual(T0);
    } finally {
      const off = await owner.send('PUT', '/staff/v1/site/maintenance', { on: false });
      expect(off.statusCode, off.body).toBe(200);
      expect(off.json()).toMatchObject({ maintenance: null });
    }
    expect((await t.browser.get('/v1/offers?side=sell&method=ZELLE&currency=USD')).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/v1/offers?side=sell&method=ZELLE&currency=USD' })).statusCode).toBe(401);
    expect((await site()).maintenance).toBeNull();
    expect((await logEntries(deps, 'site.maintenance-off')).length).toBe(1);
    const { rows } = await deps.db.query('select maintenance_since, maintenance_message, maintenance_kind, maintenance_back_by from site_flags');
    expect(rows[0]).toEqual({ maintenance_since: null, maintenance_message: null, maintenance_kind: null, maintenance_back_by: null });
  });

  // Owner G19 (7 Nov): "Maintenance notices do not default to emergency ... that is only known
  // internally". The two kinds are planned and unplanned; "emergency" is no kind at all.
  it('has two kinds, planned and unplanned; emergency is refused, and no stored row reads as emergency', async () => {
    setNow(T0);
    const em = await owner.send('PUT', '/staff/v1/site/maintenance', { on: true, kind: 'emergency' });
    expect({ status: em.statusCode, error: errorOf(em), field: (em.json() as { field?: string }).field }).toEqual({ status: 400, error: 'bad-request', field: 'kind' });
    expect((await site()).maintenance).toBeNull();
    try {
      for (const kind of ['planned', 'unplanned'] as const) {
        const res = await owner.send('PUT', '/staff/v1/site/maintenance', { on: true, kind });
        expect(res.statusCode, res.body).toBe(200);
        expect(((await site()).maintenance as { kind: string }).kind).toBe(kind);
      }
      // The database holds no kind but these two, and none at all is no longer possible while it is on.
      await expect(deps.db.query("update site_flags set maintenance_kind = 'emergency'")).rejects.toThrow(/check constraint/);
      await expect(deps.db.query('update site_flags set maintenance_kind = null')).rejects.toThrow(/check constraint/);
    } finally {
      expect((await owner.send('PUT', '/staff/v1/site/maintenance', { on: false })).statusCode).toBe(200);
    }
  });

  // Owner G19: unplanned maintenance gives "the minimal but needed information and our best guess as
  // to when we hope to have it back up".
  it('unplanned: an optional best guess of when it is back (backBy), after now; shown to every visitor; off clears it', async () => {
    setNow(T0);
    const backBy = new Date(T0.getTime() + 90 * MIN).toISOString();
    for (const bad of ['soon', T0.toISOString(), new Date(T0.getTime() - MIN).toISOString(), 5]) {
      const res = await owner.send('PUT', '/staff/v1/site/maintenance', { on: true, kind: 'unplanned', backBy: bad });
      expect({ status: res.statusCode, error: errorOf(res), field: (res.json() as { field?: string }).field }, String(bad)).toEqual({ status: 400, error: 'bad-request', field: 'backBy' });
    }
    try {
      const on = await owner.send('PUT', '/staff/v1/site/maintenance', { on: true, kind: 'unplanned', message: 'A database fault. Trades are paused.', backBy });
      expect(on.statusCode, on.body).toBe(200);
      expect((await site()).maintenance).toEqual({ kind: 'unplanned', message: 'A database fault. Trades are paused.', since: T0.toISOString(), backBy });
      // A new guess replaces the old one; null clears it.
      setNow(new Date(T0.getTime() + 30 * MIN));
      const later = new Date(T0.getTime() + 3 * 60 * MIN).toISOString();
      await owner.send('PUT', '/staff/v1/site/maintenance', { on: true, kind: 'unplanned', backBy: later });
      expect(((await site()).maintenance as { backBy: string | null }).backBy).toBe(later);
      await owner.send('PUT', '/staff/v1/site/maintenance', { on: true, kind: 'unplanned', backBy: null });
      expect(((await site()).maintenance as { backBy: string | null }).backBy).toBeNull();
    } finally {
      expect((await owner.send('PUT', '/staff/v1/site/maintenance', { on: false })).statusCode).toBe(200);
    }
    expect((await deps.db.query('select maintenance_back_by from site_flags')).rows).toEqual([{ maintenance_back_by: null }]);
  });

  // Owner G19: "for actual maintenance, we will plan it and try and give 24-hour notice". The plan
  // (start, end, message of up to 500 characters) is shown to every visitor ahead of time.
  it('planned: announced ahead with a start, an end and a message; shown until it ends; replaced, removed, logged', async () => {
    setNow(T0);
    const startsAt = new Date(T0.getTime() + 24 * 60 * MIN).toISOString();
    const endsAt = new Date(T0.getTime() + 26 * 60 * MIN).toISOString();
    const message = `Planned upgrade.\n${'m'.repeat(480)}`;
    const ok = await owner.send('PUT', '/staff/v1/site/maintenance/planned', { startsAt, endsAt, message });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ planned: { startsAt, endsAt, message }, maintenance: null });
    expect((await site()).plannedMaintenance).toEqual({ startsAt, endsAt, message });
    // Outside the front door too (lead default, owner p11-120): the plan, and nothing else.
    expect(await outside()).toEqual({ maintenance: null, plannedMaintenance: { startsAt, endsAt, message } });
    // Announcing it does not start it: the trader API still answers.
    // (A set-up trader's read: logged out, the front door answers 401 whatever the site state.)
    expect((await (await trader()).browser.get('/v1/news')).statusCode).toBe(200);
    expect(JSON.parse((await logEntries(deps, 'site.maintenance-planned')).at(-1)!.detail)).toEqual({ startsAt, endsAt });

    // Without a message is fine; a new plan replaces the old one.
    const startsAt2 = new Date(T0.getTime() + 48 * 60 * MIN).toISOString();
    const endsAt2 = new Date(T0.getTime() + 49 * 60 * MIN).toISOString();
    expect((await owner.send('PUT', '/staff/v1/site/maintenance/planned', { startsAt: startsAt2, endsAt: endsAt2 })).statusCode).toBe(200);
    expect((await site()).plannedMaintenance).toEqual({ startsAt: startsAt2, endsAt: endsAt2, message: null });

    // Once its end has passed (never switched on), visitors no longer see it.
    setNow(new Date(Date.parse(endsAt2) + 1));
    expect((await site()).plannedMaintenance).toBeNull();
    expect((await outside()).plannedMaintenance).toBeNull();
    setNow(T0);
    expect((await site()).plannedMaintenance).not.toBeNull();

    expect((await owner.send('DELETE', '/staff/v1/site/maintenance/planned')).statusCode).toBe(204);
    expect((await site()).plannedMaintenance).toBeNull();
    expect((await logEntries(deps, 'site.maintenance-plan-removed')).length).toBe(1);
    // Removing no plan logs nothing.
    expect((await owner.send('DELETE', '/staff/v1/site/maintenance/planned')).statusCode).toBe(204);
    expect((await logEntries(deps, 'site.maintenance-plan-removed')).length).toBe(1);

    const bads: [unknown, string][] = [
      [{ startsAt: T0.toISOString(), endsAt }, 'startsAt'], // not after now
      [{ startsAt: 'tomorrow', endsAt }, 'startsAt'],
      [{ startsAt, endsAt: startsAt }, 'endsAt'], // not after the start
      [{ startsAt, endsAt: 'later' }, 'endsAt'],
      [{ startsAt, endsAt, message: 'x'.repeat(501) }, 'message'],
      [{ startsAt, endsAt, message: 5 }, 'message'],
    ];
    for (const [body, field] of bads) {
      const res = await owner.send('PUT', '/staff/v1/site/maintenance/planned', body);
      expect({ status: res.statusCode, error: errorOf(res), field: (res.json() as { field?: string }).field }, JSON.stringify(body)).toEqual({ status: 400, error: 'bad-request', field });
    }
    expect(errorOf(await owner.send('PUT', '/staff/v1/site/maintenance/planned', { startsAt, endsAt, extra: 1 }))).toBe('bad-request');
    expect((await site()).plannedMaintenance).toBeNull();
  });

  it("switching planned maintenance on takes the plan's end as the time it is back and its message, and retires the plan; unplanned leaves a plan alone", async () => {
    setNow(T0);
    const startsAt = new Date(T0.getTime() + 60 * MIN).toISOString();
    const endsAt = new Date(T0.getTime() + 180 * MIN).toISOString();
    expect((await owner.send('PUT', '/staff/v1/site/maintenance/planned', { startsAt, endsAt, message: 'Upgrade.' })).statusCode).toBe(200);
    try {
      // An unplanned maintenance meanwhile keeps the plan for later.
      await owner.send('PUT', '/staff/v1/site/maintenance', { on: true, kind: 'unplanned' });
      expect((await site()).plannedMaintenance).toEqual({ startsAt, endsAt, message: 'Upgrade.' });
      await owner.send('PUT', '/staff/v1/site/maintenance', { on: false });

      setNow(new Date(Date.parse(startsAt)));
      const on = await owner.send('PUT', '/staff/v1/site/maintenance', { on: true, kind: 'planned' });
      expect(on.statusCode, on.body).toBe(200);
      expect(await site()).toMatchObject({
        maintenance: { kind: 'planned', message: 'Upgrade.', since: startsAt, backBy: endsAt },
        plannedMaintenance: null,
      });
    } finally {
      expect((await owner.send('PUT', '/staff/v1/site/maintenance', { on: false })).statusCode).toBe(200);
      await owner.send('DELETE', '/staff/v1/site/maintenance/planned');
    }
  });

  it('refuses a bad body with bad-request', async () => {
    for (const body of [{}, { on: 'yes' }, { on: true, kind: 'surprise' }, { on: true, message: 5 }, { on: true, message: 'x'.repeat(501) }, { on: false, message: 'x' }, { on: true, extra: 1 }]) {
      const res = await owner.send('PUT', '/staff/v1/site/maintenance', body);
      expect({ status: res.statusCode, error: errorOf(res) }, JSON.stringify(body)).toEqual({ status: 400, error: 'bad-request' });
    }
    expect((await site()).maintenance).toBeNull();
  });
});
