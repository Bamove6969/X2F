import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import {
  catalog, getMethod, getProfile, isAvailable, isGiftCard, LAUNCH_PROFILE_IDS, PROFILES, type MethodProfile,
} from '../src/methods/profiles.js';
import type { LiveOfferQuery, LiveOfferStat } from '../src/methods/routes.js';
import { seedAccount } from './helpers/accounts.js';
import { testApp } from './helpers/app.js';
import { Browser, ORIGIN, addTestLogin } from './helpers/totp.js';

const raw = JSON.parse(readFileSync(new URL('../../../data/payment-methods.json', import.meta.url), 'utf8')) as {
  methods: Array<{ id: string; name: string; group: string; giftCard?: boolean; legalReview?: string }>;
};

describe('method profiles', () => {
  it('has exactly the launch profiles', () => {
    expect(PROFILES.map((p) => p.id).sort()).toEqual([...LAUNCH_PROFILE_IDS].sort());
    expect(LAUNCH_PROFILE_IDS).toEqual(['ZELLE', 'CASH_APP', 'REVOLUT', 'TRANSFERWISE', 'ACH_TRANSFER', 'SEPA', 'PAY_BY_MAIL', 'CUSTOM']);
  });

  it('every profile id exists in the catalog, with a landsIn that never names the method', () => {
    for (const p of PROFILES) {
      const m = getMethod(p.id);
      expect(m, p.id).not.toBeNull();
      expect(p.landsIn.trim().length, p.id).toBeGreaterThan(0);
      expect(p.landsIn.toLowerCase(), p.id).not.toContain(m!.name.toLowerCase());
      expect(p.checkPrompt.toLowerCase(), p.id).not.toContain(m!.name.toLowerCase());
      expect(p.whatItIs.length, p.id).toBeGreaterThan(0);
      expect(p.fields.length, p.id).toBeGreaterThan(0);
    }
  });

  it('pins the Zelle profile and the window per arrival time', () => {
    const zelle = getProfile('ZELLE') as MethodProfile;
    expect(zelle.whatItIs).toBe('Zelle: a US bank-to-bank instant transfer built into most US banking apps.');
    expect(zelle.landsIn).toBe("your bank account, checked in your bank's app");
    expect(zelle.confirmWindowMin).toBe(120);
    expect(zelle.arrival).toBe('instant');
    for (const id of ['ACH_TRANSFER', 'SEPA']) expect(getProfile(id)!.confirmWindowMin).toBe(1440);
    for (const p of PROFILES) {
      if (p.arrival === 'instant') expect(p.confirmWindowMin, p.id).toBe(120);
      expect(p.confirmWindowMin, p.id).toBeGreaterThanOrEqual(120);
      expect(p.confirmWindowMin, p.id).toBeLessThanOrEqual(1440);
    }
  });

  it('has no profile for an unknown method', () => {
    expect(getProfile('NOPE')).toBeNull();
    expect(getProfile('VENMO')).toBeNull(); // in the catalog, but no profile yet
    expect(getMethod('NOPE')).toBeNull();
  });

  it('marks legal-review methods unavailable (P3-I20)', () => {
    for (const id of ['SBP', 'MIR', 'YOOMONEY']) expect(isAvailable(id), id).toBe(false);
    expect(isAvailable('ZELLE')).toBe(true);
    expect(isAvailable('NOPE')).toBe(false);
    for (const m of raw.methods) expect(isAvailable(m.id), m.id).toBe(m.legalReview === undefined);
  });

  it('flags exactly the "Gift cards & vouchers" group as gift cards (owner, 2026-10-21)', () => {
    const gifts = raw.methods.filter((m) => m.group === 'Gift cards & vouchers');
    expect(gifts.length).toBeGreaterThan(10);
    for (const m of raw.methods) {
      expect(m.giftCard === true, m.id).toBe(m.group === 'Gift cards & vouchers');
      expect(isGiftCard(m.id), m.id).toBe(m.group === 'Gift cards & vouchers');
      expect(getMethod(m.id)!.giftCard, m.id).toBe(m.group === 'Gift cards & vouchers');
    }
    expect(isGiftCard('AMAZON_GIFT_CARD')).toBe(true);
    expect(isGiftCard('ZELLE')).toBe(false);
  });

  it('loads every catalog entry once', () => {
    const ids = catalog().map((m) => m.id);
    expect(ids).toEqual(raw.methods.map((m) => m.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('GET /v1/methods', () => {
  let app: FastifyInstance;
  const calls: LiveOfferQuery[] = [];
  let stats: LiveOfferStat[] = [];

  beforeAll(async () => {
    const liveOffers: NonNullable<Deps['liveOffers']> = async (q) => {
      calls.push(q);
      return stats;
    };
    ({ app } = await testApp({ liveOffers }));
  });
  afterAll(async () => app.close());

  const get = (qs: string) => app.inject({ method: 'GET', url: `/v1/methods${qs}` });

  it('lists a method with one live Zelle USD offer in live; SBP, Mir and YooMoney in neither list (no cookie, P3-M9)', async () => {
    stats = [
      { methodId: 'ZELLE', offers: 1, bestCentsPerXmr: 33000n },
      // Even if offers somehow exist for them, unavailable methods never show.
      { methodId: 'SBP', offers: 4, bestCentsPerXmr: 30000n },
    ];
    const res = await get('?side=buy&currency=USD');
    expect(res.statusCode).toBe(200);
    expect(res.headers['set-cookie']).toBeUndefined();
    const body = res.json() as { live: Array<Record<string, unknown>>; all: Array<Record<string, unknown>> };
    expect(body.live).toEqual([{ id: 'ZELLE', name: 'Zelle', group: 'Payment apps', giftCard: false, offers: 1, bestRate: '33000' }]);
    for (const list of [body.live, body.all]) {
      for (const id of ['SBP', 'MIR', 'YOOMONEY']) expect(list.map((r) => r.id)).not.toContain(id);
    }
    expect(calls.at(-1)).toEqual({ side: 'buy', currency: 'USD' });
    const zelle = body.all.find((r) => r.id === 'ZELLE');
    expect(zelle).toEqual({ id: 'ZELLE', name: 'Zelle', group: 'Payment apps', giftCard: false, offers: 1, bestRate: '33000' });
    const venmo = body.all.find((r) => r.id === 'VENMO');
    expect(venmo).toEqual({ id: 'VENMO', name: 'Venmo', group: 'Payment apps', giftCard: false, offers: 0, bestRate: null });
    expect(body.all.find((r) => r.id === 'AMAZON_GIFT_CARD')?.giftCard).toBe(true);
    expect(body.all).toHaveLength(raw.methods.filter((m) => m.legalReview === undefined).length);
  });

  it('sorts "all" A-Z and "live" by buyers, rate or name', async () => {
    stats = [
      { methodId: 'ZELLE', offers: 1, bestCentsPerXmr: 34000n },
      { methodId: 'CASH_APP', offers: 3, bestCentsPerXmr: 33000n },
      { methodId: 'REVOLUT', offers: 3, bestCentsPerXmr: 33500n },
    ];
    const all = (await get('?side=buy&currency=USD')).json().all as Array<{ name: string }>;
    const names = all.map((r) => r.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));

    const ids = async (qs: string) => ((await get(qs)).json().live as Array<{ id: string }>).map((r) => r.id);
    expect(await ids('?side=buy&currency=USD')).toEqual(['CASH_APP', 'REVOLUT', 'ZELLE']);
    expect(await ids('?side=buy&currency=USD&sort=buyers')).toEqual(['CASH_APP', 'REVOLUT', 'ZELLE']);
    // Buy ads: the seller viewing them wants the highest price per XMR.
    expect(await ids('?side=buy&currency=USD&sort=rate')).toEqual(['ZELLE', 'REVOLUT', 'CASH_APP']);
    // Sell ads: the buyer viewing them wants the lowest.
    expect(await ids('?side=sell&currency=USD&sort=rate')).toEqual(['CASH_APP', 'REVOLUT', 'ZELLE']);
    expect(await ids('?side=buy&currency=USD&sort=az')).toEqual(['CASH_APP', 'REVOLUT', 'ZELLE']);
  });

  it('puts methods with no price (market offers while the feed is down) last when sorting by rate', async () => {
    stats = [
      { methodId: 'ZELLE', offers: 2, bestCentsPerXmr: null },
      { methodId: 'CASH_APP', offers: 1, bestCentsPerXmr: 33000n },
    ];
    const live = (await get('?side=sell&currency=USD&sort=rate')).json().live as Array<{ id: string; bestRate: string | null }>;
    expect(live).toMatchObject([{ id: 'CASH_APP', bestRate: '33000' }, { id: 'ZELLE', bestRate: null }]);
  });

  it('ignores stats for unknown methods and zero counts', async () => {
    stats = [{ methodId: 'NOT_A_METHOD', offers: 2, bestCentsPerXmr: 1n }, { methodId: 'ZELLE', offers: 0, bestCentsPerXmr: null }];
    const body = (await get('?side=buy&currency=EUR')).json() as { live: unknown[]; all: Array<{ id: string }> };
    expect(body.live).toEqual([]);
    expect(body.all.map((r) => r.id)).not.toContain('NOT_A_METHOD');
  });

  it.each([
    [''], ['?currency=USD'], ['?side=both&currency=USD'], ['?side=buy'], ['?side=buy&currency=usd'], ['?side=buy&currency=USDX'],
    ['?side=buy&currency=USD&sort=best'], ['?side=buy&side=sell&currency=USD'],
  ])('refuses a bad query %s with 400', async (qs) => {
    const res = await get(qs);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad-request' });
  });
});

describe('GET /v1/methods without a live-offer source', () => {
  it('lists nothing live until offers exist (Task 4 supplies the source)', async () => {
    const { app } = await testApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/v1/methods?side=sell&currency=USD' });
      expect(res.statusCode).toBe(200);
      expect(res.json().live).toEqual([]);
      expect(res.json().all.length).toBeGreaterThan(50);
    } finally {
      await app.close();
    }
  });
});

describe('POST /v1/method-suggestions', () => {
  let app: FastifyInstance;
  let deps: Deps;
  let trader: Browser;

  beforeAll(async () => {
    ({ app, deps } = await testApp());
    addTestLogin(app, deps);
    trader = new Browser(app);
    const accountId = await seedAccount(deps, { username: 'suggester' });
    expect((await trader.post('/t/login', { accountId })).statusCode).toBe(200);
  });
  afterAll(async () => app.close());

  it('stores a suggestion with no account column (P3-M3)', async () => {
    const res = await trader.post('/v1/method-suggestions', { name: '  Bank of Somewhere  ', country: 'NZ' });
    expect(res.statusCode).toBe(202);
    const { rows } = await deps.db.query('select * from method_suggestions');
    expect(rows).toEqual([{ id: expect.any(String), name: 'Bank of Somewhere', country: 'NZ', created_on: expect.any(Date) }]);
    const cols = await deps.db.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'method_suggestions' order by ordinal_position",
    );
    expect(cols.rows.map((r) => r.column_name)).toEqual(['id', 'name', 'country', 'created_on']);
    const fks = await deps.db.query(
      "select 1 from information_schema.table_constraints where table_name = 'method_suggestions' and constraint_type = 'FOREIGN KEY'",
    );
    expect(fks.rows).toEqual([]);
  });

  it('has no sequence-backed column and no time finer than a day (rows cannot be lined up with sessions)', async () => {
    const cols = await deps.db.query<{ column_name: string; data_type: string; column_default: string | null }>(
      "select column_name, data_type, column_default from information_schema.columns where table_name = 'method_suggestions'",
    );
    for (const c of cols.rows) {
      expect(c.column_default ?? '', c.column_name).not.toMatch(/nextval/);
      expect(c.data_type, c.column_name).not.toMatch(/timestamp|time|interval|serial|integer|bigint/);
    }
    expect(cols.rows.find((c) => c.column_name === 'id')?.data_type).toBe('uuid');
    expect(cols.rows.find((c) => c.column_name === 'created_on')?.data_type).toBe('date');
    const seqs = await deps.db.query(
      "select 1 from pg_depend d join pg_class s on s.oid = d.objid and s.relkind = 'S' where d.refobjid = 'method_suggestions'::regclass",
    );
    expect(seqs.rows).toEqual([]);
  });

  it('takes a name alone', async () => {
    expect((await trader.post('/v1/method-suggestions', { name: 'Paymate' })).statusCode).toBe(202);
    const { rows } = await deps.db.query("select country from method_suggestions where name = 'Paymate'");
    expect(rows).toEqual([{ country: null }]);
  });

  it.each([
    [{}], [{ name: '' }], [{ name: '   ' }], [{ name: 'x'.repeat(61) }], [{ name: 42 }], [{ name: 'Ok', country: 'nz' }],
    [{ name: 'Ok', country: 'NZL' }], [{ name: 'Ok', country: 3 }], [{ name: 'bad‮name' }], [{ name: 'tab\there' }],
    [{ name: 'Ok', extra: 1 }], [['Ok']],
  ])('refuses %j with 400', async (body) => {
    const res = await trader.post('/v1/method-suggestions', body);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad-request' });
  });

  it('accepts 60 characters, counted as characters', async () => {
    expect((await trader.post('/v1/method-suggestions', { name: 'é'.repeat(60) })).statusCode).toBe(202);
  });

  it('needs a trader session', async () => {
    const anon = await app.inject({
      method: 'POST', url: '/v1/method-suggestions', headers: { origin: ORIGIN }, payload: { name: 'Anon pay' },
    });
    expect(anon.statusCode).toBe(401);
    expect(anon.json()).toEqual({ error: 'not-authenticated' });

    const staff = new Browser(app);
    const staffId = await seedAccount(deps, { username: 'staffer', kind: 'staff' });
    await staff.post('/t/login', { accountId: staffId });
    const res = await staff.post('/v1/method-suggestions', { name: 'Staff pay' });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'wrong-account-kind' });
  });

  it('is refused without the exact Origin (CSRF)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/method-suggestions', cookies: trader.cookies, payload: { name: 'Cross site' },
    });
    expect(res.statusCode).toBe(403);
  });

  // Last in this block: it empties the shared bucket.
  it('is rate limited (one bucket for all traders, since rows carry no account)', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 40; i++) codes.push((await trader.post('/v1/method-suggestions', { name: `Spam ${i}` })).statusCode);
    expect(codes).toContain(503);
    expect(codes.filter((c) => c !== 202 && c !== 503)).toEqual([]);
  });
});
