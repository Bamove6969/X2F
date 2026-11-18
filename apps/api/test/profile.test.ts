// Plan 5 Task 5 (stats, public profiles, badge settings) and Task 12's record routes. Real Postgres,
// one database for the file.
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import * as openpgp from 'openpgp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { RECORD_HEADER } from '../src/reputation/record.js';
import { insertReview } from '../src/reviews/store.js';
import { traderSummaries } from '../src/traders/summary.js';
import { makeVendor } from './helpers/accounts.js';
import { testDb } from './helpers/db.js';
import { flexBody } from './helpers/offers.js';
import { spySql } from './helpers/sqlSpy.js';
import { tradeApp } from './helpers/tradeApp.js';
import { ORIGIN } from './helpers/totp.js';
import { driveTo, seedTrade } from './helpers/trades.js';

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];
type Who = Awaited<ReturnType<typeof trader>>;

const START = new Date('2026-10-17T12:00:00Z');

beforeAll(async () => {
  ({ app, deps, trader, setNow } = await tradeApp({}, { db: await testDb() }));
  setNow(START);
});
afterAll(async () => {
  await app.close();
  await deps.db.end();
});

/** Earns Veteran (an account two years old), PGP verified and Security key verified, with no trade. */
async function veteranWithKeys(who: Who): Promise<string> {
  await deps.db.query('update accounts set created_at = $2 where id = $1', [who.id, new Date('2024-09-01T00:00:00Z')]);
  const fingerprint = randomBytes(20).toString('hex');
  await deps.db.query('insert into pgp_keys (account_id, fingerprint, armored_enc, created_at) values ($1, $2, $3, $4)', [who.id, fingerprint, randomBytes(40), START]);
  await deps.db.query(
    `insert into webauthn_credentials (account_id, credential_id, public_key, counter, kind, backed_up, device_type, label, created_at)
     values ($1, $2, $3, 0, 'security-key', false, 'singleDevice', 'key', $4)`,
    [who.id, randomBytes(32), randomBytes(77), START],
  );
  return fingerprint;
}

/** A released trade between the two, and `reviewer`'s review of the other side. */
async function reviewed(seller: Who, buyer: Who, reviewer: 'buyer' | 'seller', input: Parameters<typeof insertReview>[1]['input']) {
  const { trade: t } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller', methodId: 'ZELLE' });
  await driveTo(deps, t, 'released');
  await insertReview(deps.db, {
    tradeCode: t.code, reviewerId: reviewer === 'buyer' ? buyer.id : seller.id, subjectId: reviewer === 'buyer' ? seller.id : buyer.id,
    reviewerRole: reviewer, input, methodId: 'ZELLE', createdAt: deps.clock(),
  });
  // The other side skips, so nothing gates either of them.
  await deps.db.query('insert into review_skips (trade_code, side) values ($1, $2)', [t.code, reviewer === 'buyer' ? 'seller' : 'buyer']);
  return t.code;
}

const profile = (viewer: Who, name: string) => viewer.browser.get(`/v1/traders/${encodeURIComponent(name)}`);

describe('GET /v1/traders/:name', () => {
  it('answers the public profile by display name, with the stats, badges, reviews and nothing private', async () => {
    const seller = await trader();
    const buyer = await trader();
    const viewer = await trader();
    const fingerprint = await veteranWithKeys(seller);
    const code = await reviewed(seller, buyer, 'buyer', { neutral: false, stars: 5, phrases: ['Fast release'], tradeBadges: [], note: 'Smooth trade' });

    const res = await profile(viewer, seller.displayName.toLowerCase());
    expect(res.statusCode, res.body).toBe(200);
    const p = res.json() as Record<string, unknown> & { stats: Record<string, unknown>; badges: { featured: string[]; more: string[] }; reviews: unknown[] };
    expect(p).toMatchObject({
      displayName: seller.displayName, self: false, memberSince: '2024-09', pgpProtected: true, recordPublic: false, offers: 0,
      stats: { completedTrades: 1, positivePct: 100, ratedReviews: 1, reviewCount: 1, disputes: { won: 0, lost: 0 } },
    });
    // New (starter) is featured first; Veteran takes the other slot by default (spec 5.4).
    expect(p.badges.featured).toEqual(['new', 'veteran-1']);
    expect(p.badges.more).toEqual(['pgp', 'security-key']);
    expect(p.reviews).toEqual([{ neutral: false, stars: 5, phrases: ['Fast release'], tradeBadges: [], note: 'Smooth trade', method: 'Zelle', age: 'Oct 2026' }]);
    // Share the bare minimum: no login name, account id, trade code, fingerprint, amount or exact
    // time other than the coarse lastSeenAt (the only ISO time in the body).
    for (const bad of [seller.loginName, seller.id, buyer.id, buyer.displayName, code, fingerprint, 'usd', 'amount', 'cancel', 'username', 'login']) {
      expect(res.body.toLowerCase(), bad).not.toContain(bad.toLowerCase());
    }
    expect(res.body.match(/\d{4}-\d{2}-\d{2}T/g) ?? []).toHaveLength(p.lastSeenAt === null ? 0 : 1);
  });

  it('own profile says self; a login name, an unknown name, a staff name and a blocker all get the same 404', async () => {
    const me = await trader();
    const own = await profile(me, me.displayName);
    expect(own.json()).toMatchObject({ self: true, displayName: me.displayName });

    const unknown = await profile(me, 'NoSuchTrader9');
    expect(unknown.statusCode).toBe(404);
    const byLogin = await profile(me, me.loginName);
    expect(byLogin.statusCode).toBe(404);
    expect(byLogin.body).toBe(unknown.body);
    const staff = await trader('staff');
    expect((await profile(me, staff.displayName)).body).toBe(unknown.body);

    // The trader who blocked me answers as an unknown name; I still see the person I blocked.
    const blocker = await trader();
    expect((await blocker.browser.post('/v1/account/blocks', { displayName: me.displayName })).statusCode).toBe(204);
    const blocked = await profile(me, blocker.displayName);
    expect(blocked.statusCode).toBe(404);
    expect(blocked.body).toBe(unknown.body);
    expect((await profile(blocker, me.displayName)).statusCode).toBe(200);
  });

  it('counts the live offers anyone may see', async () => {
    const p = await trader();
    const viewer = await trader();
    await makeVendor(deps, p.id);
    await deps.db.query(
      `insert into wallets (account_id, app, label, address, created_at, usable_from) values ($1, 'cake', 'Main', $2, $3, $3)`,
      [p.id, `addr-${Math.random()}`, new Date(deps.clock().getTime() - 86_400_000)],
    );
    const posted = await p.browser.post('/v1/offers', flexBody({
      side: 'sell', methodId: 'ZELLE', currency: 'USD', pricing: { mode: 'market', marginBps: 0 },
      minFiatCents: '1000', maxFiatCents: '100000', minTrades: null, terms: 'Zelle only.',
    }));
    expect(posted.statusCode, posted.body).toBe(201);
    expect((await profile(viewer, p.displayName)).json()).toMatchObject({ offers: 1 });
  });
});

describe('badge settings', () => {
  const settings = (who: Who) => who.browser.get('/v1/account/badges');
  const choose = (who: Who, id: string, level: string) => who.browser.put('/v1/account/badges', { id, level });

  it('lists earned badges with their levels and the next milestones', async () => {
    const me = await trader();
    await veteranWithKeys(me);
    const res = await settings(me);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      earned: [
        { id: 'new', level: 'featured' }, { id: 'veteran-1', level: 'featured' }, { id: 'pgp', level: 'hover' }, { id: 'security-key', level: 'hover' },
      ],
      featured: ['new', 'veteran-1'],
      more: ['pgp', 'security-key'],
      nextMilestones: [{ label: '10 trades', have: 0, need: 10 }, { label: 'Clean record', have: 0, need: 100 }],
    });
  });

  it('featuring one more than the slots bumps the oldest with the board notice; New and unearned badges are refused', async () => {
    const me = await trader();
    await veteranWithKeys(me);
    const put = await choose(me, 'pgp', 'featured');
    expect(put.statusCode, put.body).toBe(200);
    expect(put.json()).toMatchObject({ featured: ['new', 'pgp'], more: ['veteran-1', 'security-key'], notice: 'Veteran moved to On hover. Only 2 badges can be featured.' });

    const fixed = await choose(me, 'new', 'hidden');
    expect([fixed.statusCode, fixed.json()]).toEqual([400, { error: 'new-is-fixed' }]);
    const unearned = await choose(me, 'trusted', 'featured');
    expect([unearned.statusCode, unearned.json()]).toEqual([400, { error: 'not-earned' }]);
    for (const bad of [{ id: 'made-up', level: 'featured' }, { id: 'pgp', level: 'pinned' }, { id: 'pgp' }, null]) {
      expect((await me.browser.put('/v1/account/badges', bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
    // Nothing a refusal saw was saved.
    expect((await settings(me)).json()).toMatchObject({ featured: ['new', 'pgp'] });
  });

  it('a Hidden badge is gone from the profile, the offer card summary and the "+N" list; New shows whatever the row says', async () => {
    const me = await trader();
    const viewer = await trader();
    await veteranWithKeys(me);
    const hidden = await choose(me, 'pgp', 'hidden');
    expect(hidden.json()).toMatchObject({ featured: ['new', 'veteran-1'], more: ['security-key'], notice: null });

    const p = (await profile(viewer, me.displayName)).json() as { badges: unknown; pgpProtected: boolean };
    // P5-A17: hiding the PGP badge hides the "Account protected with PGP" line too.
    expect(p).toMatchObject({ badges: { featured: ['new', 'veteran-1'], more: ['security-key'] }, pgpProtected: false });
    const summary = (await traderSummaries(deps.db, [me.id], deps.clock(), viewer.id)).get(me.id)!;
    expect([summary.badges, summary.featuredBadges]).toEqual([['new', 'veteran-1', 'security-key'], 2]);

    // A row forced by SQL to hide New still shows it, first.
    await deps.db.query(`update badge_prefs set levels = levels || '{"new": "hidden"}'::jsonb, featured_order = array['veteran-1'] where account_id = $1`, [me.id]);
    expect((await traderSummaries(deps.db, [me.id], deps.clock(), viewer.id)).get(me.id)!.badges[0]).toBe('new');
  });

  it('summaries of many traders cost one query whatever their number', async () => {
    const people = await Promise.all(Array.from({ length: 12 }, () => trader()));
    for (const p of people.slice(0, 6)) await veteranWithKeys(p);
    await choose(people[0]!, 'pgp', 'featured');
    const count = async (ids: string[]) => {
      const spy = spySql(deps.db);
      try {
        await traderSummaries(deps.db, ids, deps.clock(), null);
        return spy.sql().length;
      } finally {
        spy.restore();
      }
    };
    const few = await count(people.slice(0, 2).map((p) => p.id));
    expect(await count(people.map((p) => p.id))).toBe(few);
  });

  it('is the account owner\'s own: logged out gets 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/account/badges' })).statusCode).toBe(401);
    // From the site's own origin (a write from anywhere else stops at the origin check first).
    const put = await app.inject({ method: 'PUT', url: '/v1/account/badges', headers: { origin: ORIGIN }, payload: { id: 'pgp', level: 'hidden' } });
    expect(put.statusCode).toBe(401);
  });
});

describe('the signed record (Task 12)', () => {
  const key = () => openpgp.readKey({ armoredKey: deps.pgpSigner.publicArmored });
  async function verified(armored: string): Promise<string> {
    const message = await openpgp.readCleartextMessage({ cleartextMessage: armored });
    const v = await openpgp.verify({ message, verificationKeys: await key(), expectSigned: true });
    return v.data as string;
  }

  it('is signed by X2F, starts with the record header and lists no amount, method, counterparty, note or fingerprint', async () => {
    const seller = await trader();
    const buyer = await trader();
    const fingerprint = await veteranWithKeys(seller);
    await reviewed(seller, buyer, 'buyer', { neutral: false, stars: 4, phrases: ['Friendly'], tradeBadges: [], note: 'Secret note here' });
    // The other way round: the trader bought, and the other side (selling) left a Neutral.
    await reviewed(buyer, seller, 'seller', { neutral: true });
    const res = await seller.browser.get('/v1/account/record');
    expect(res.statusCode, res.body).toBe(200);
    const text = await verified((res.json() as { text: string }).text);
    expect(text.split('\n')[0]).toBe(RECORD_HEADER);
    expect(text).toContain(`Display name: ${seller.displayName}`);
    expect(text).toContain('Member since: Sep 2024');
    expect(text).toContain('Completed trades: 2');
    expect(text).toContain('Oct 2026 · seller · 4 stars · Friendly');
    expect(text).toContain('Oct 2026 · buyer · Neutral');
    for (const bad of ['Secret note', 'Zelle', buyer.displayName, seller.loginName, fingerprint, fingerprint.toUpperCase(), '$']) expect(text, bad).not.toContain(bad);

    // Once a minute per account.
    const again = await seller.browser.get('/v1/account/record');
    expect(again.statusCode).toBe(429);
    expect(again.json()).toMatchObject({ error: 'slow-down' });
    // Asked for at export, the private copy lists the fingerprint (P5-A35).
    setNow(new Date(deps.clock().getTime() + 61_000));
    const withPgp = await verified(((await seller.browser.get('/v1/account/record?pgp=1')).json() as { text: string }).text);
    expect(withPgp).toContain(`PGP fingerprint: ${fingerprint.toUpperCase()}`);
  });

  it('the public copy is a 404 identical to an unknown name until shown, and never lists a fingerprint', async () => {
    const me = await trader();
    const viewer = await trader();
    await veteranWithKeys(me);
    const unknown = await viewer.browser.get('/v1/traders/NoSuchTrader9/record');
    const priv = await viewer.browser.get(`/v1/traders/${me.displayName}/record`);
    expect([unknown.statusCode, priv.statusCode]).toEqual([404, 404]);
    expect(priv.body).toBe(unknown.body);

    const on = await me.browser.put('/v1/account/record/public', { on: true });
    expect([on.statusCode, on.json()]).toEqual([200, { on: true }]);
    expect((await profile(viewer, me.displayName)).json()).toMatchObject({ recordPublic: true });
    const pub = await viewer.browser.get(`/v1/traders/${me.displayName}/record`);
    expect(pub.statusCode, pub.body).toBe(200);
    const text = await verified((pub.json() as { text: string }).text);
    expect(text.startsWith(RECORD_HEADER)).toBe(true);
    expect(text).not.toMatch(/\b[0-9a-f]{40}\b|\b[0-9a-f]{64}\b/i);
    expect(text).not.toContain('PGP fingerprint');

    expect((await me.browser.put('/v1/account/record/public', { on: 'yes' })).statusCode).toBe(400);
    await me.browser.put('/v1/account/record/public', { on: false });
    expect((await viewer.browser.get(`/v1/traders/${me.displayName}/record`)).body).toBe(unknown.body);
  });
});
