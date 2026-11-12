import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import {
  BANNED_METHOD_IDS, catalog, getMethod, getProfile, isAvailable, isGiftCard, LAUNCH_PROFILE_IDS, loadCatalog, loadProfiles, PROFILES, tradeProfile, type MethodProfile,
} from '../src/methods/profiles.js';
import { MAX_PAY_WINDOW_MIN, TIMERS } from '@x2f/trade';
import type { LiveOfferQuery, LiveOfferStat } from '../src/methods/routes.js';
import { seedAccount } from './helpers/accounts.js';
import { testApp } from './helpers/app.js';
import { tradeApp } from './helpers/tradeApp.js';
import { Browser, ORIGIN, addTestLogin } from './helpers/totp.js';

const raw = JSON.parse(readFileSync(new URL('../../../data/payment-methods.json', import.meta.url), 'utf8')) as {
  methods: Array<{ id: string; name: string; group: string; giftCard?: boolean; legalReview?: string }>;
};

describe('method profiles', () => {
  it('has exactly the launch profiles and the F1 research table\'s (owner F9), Interac first', () => {
    expect(PROFILES.map((p) => p.id).sort()).toEqual([...LAUNCH_PROFILE_IDS].sort());
    expect(LAUNCH_PROFILE_IDS).toEqual([
      'ZELLE', 'CASH_APP', 'REVOLUT', 'TRANSFERWISE', 'ACH_TRANSFER', 'SEPA', 'PAY_BY_MAIL', 'CUSTOM',
      // Owner 2026-11-07 F9 ("give the common payment types their own profile"): research F1's table.
      'INTERAC_E_TRANSFER', 'SEPA_INSTANT', 'PAYPAL', 'VENMO', 'PIX', 'UPI', 'FASTER_PAYMENTS', 'DOMESTIC_WIRE_TRANSFER', 'SWIFT', 'OTHER_GIFT_CARD',
    ]);
    // Every profile is offered (none waits for legal review).
    for (const id of LAUNCH_PROFILE_IDS) expect(isAvailable(id), id).toBe(true);
  });

  it('gives every profile a time to pay (owner p9-6): 90 min to 24 h, fixed at take', () => {
    // Lead defaults pending the owner: 90 min for apps and instant transfers, 3 h for bank transfers,
    // 24 h for cash by mail; 90 min for a gift card too (lead default pending owner p11-130: the card's
    // code is sent like an app payment, while the 45-minute check window, G50, is the other side's).
    const want: Record<string, number> = {
      ZELLE: 90, CASH_APP: 90, REVOLUT: 90, INTERAC_E_TRANSFER: 90, FASTER_PAYMENTS: 90, SEPA_INSTANT: 90, PIX: 90, UPI: 90,
      PAYPAL: 90, VENMO: 90, TRANSFERWISE: 180, ACH_TRANSFER: 180, SEPA: 180, DOMESTIC_WIRE_TRANSFER: 180, SWIFT: 180,
      CUSTOM: 180, PAY_BY_MAIL: 1440, OTHER_GIFT_CARD: 90,
    };
    expect(Object.keys(want).sort()).toEqual([...LAUNCH_PROFILE_IDS].sort());
    for (const p of PROFILES) {
      expect(p.payWindowMin, p.id).toBe(want[p.id]);
      expect(p.payWindowMin, p.id).toBeGreaterThanOrEqual(TIMERS.payMin);
      expect(p.payWindowMin, p.id).toBeLessThanOrEqual(MAX_PAY_WINDOW_MIN);
    }
    // One lookup for the take, the picker and My offers: a method without a profile of its own gets
    // the Custom method's times; a gift card without one gets the gift-card profile's (45 min to check, 90 to send).
    expect(getProfile('CHIME')).toBeNull();
    expect(tradeProfile('CHIME')).toBe(getProfile('CUSTOM'));
    expect(tradeProfile('INTERAC_E_TRANSFER').id).toBe('INTERAC_E_TRANSFER');
    expect(tradeProfile('STEAM_GIFT_CARD')).toBe(getProfile('OTHER_GIFT_CARD'));
    expect([tradeProfile('STEAM_GIFT_CARD').confirmWindowMin, tradeProfile('STEAM_GIFT_CARD').payWindowMin]).toEqual([45, 90]);
  });

  it('refuses a profile file whose time to pay is missing or out of range', () => {
    const file = JSON.parse(readFileSync(new URL('../../../data/payment-method-profiles.json', import.meta.url), 'utf8')) as { profiles: Record<string, unknown>[] };
    for (const bad of [undefined, 89, 1441, 90.5, '90']) {
      const profiles = file.profiles.map((p) => (p.id === 'ZELLE' ? { ...p, payWindowMin: bad } : p));
      expect(() => loadProfiles({ profiles }, catalog()), String(bad)).toThrow(/ZELLE: payWindowMin/);
    }
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
    expect(zelle.confirmWindowMin).toBe(90);
    expect(zelle.arrival).toBe('instant');
    for (const p of PROFILES) {
      expect(p.confirmWindowMin, p.id).toBeGreaterThanOrEqual(isGiftCard(p.id) ? 45 : 90);
      expect(p.confirmWindowMin, p.id).toBeLessThanOrEqual(5760);
    }
  });

  it("each payment type's confirm window, which is also either side's wait before a dispute (owner 2026-11-07 F9 on research F1, p9-4)", () => {
    const H = 60;
    const D = 24 * H;
    const table: Record<string, number> = {
      // Instant: 90 minutes (owner F9, replacing the research's 30 min-1 h).
      ZELLE: 90, INTERAC_E_TRANSFER: 90, SEPA_INSTANT: 90, PAYPAL: 90, CASH_APP: 90,
      VENMO: 90, REVOLUT: 90, PIX: 90, UPI: 90,
      // Gift cards: 45 minutes to check a card (owner G50).
      OTHER_GIFT_CARD: 45,
      FASTER_PAYMENTS: 3 * H,
      // Same or next day: 24 h.
      SEPA: D, DOMESTIC_WIRE_TRANSFER: D, TRANSFERWISE: D, CUSTOM: D,
      // Slow: ACH 48 h, SWIFT 72 h (research 48-72 h, the longer end), cash by mail 4 days.
      ACH_TRANSFER: 2 * D, SWIFT: 3 * D, PAY_BY_MAIL: 4 * D,
    };
    expect(Object.keys(table).sort()).toEqual([...LAUNCH_PROFILE_IDS].sort());
    for (const [id, confirm] of Object.entries(table)) expect(getProfile(id)!.confirmWindowMin, id).toBe(confirm);
  });

  it('the profile a trade uses: its own, else a gift card\'s for any gift card, else the Custom one', () => {
    expect(tradeProfile('ZELLE').id).toBe('ZELLE');
    expect(tradeProfile('SWIFT').id).toBe('SWIFT');
    for (const id of ['AMAZON_GIFT_CARD', 'STEAM_GIFT_CARD', 'OTHER_GIFT_CARD']) expect(tradeProfile(id).id, id).toBe('OTHER_GIFT_CARD');
    for (const id of ['SPEI', 'FPS', 'TRANSFERWISE_USD', 'NOPE']) expect(tradeProfile(id).id, id).toBe('CUSTOM');
  });

  it('refuses a profile whose timing is out of range (owner 2026-11-07 F9: up to 4 days, was 24 h)', () => {
    const base = { id: 'ZELLE', whatItIs: 'x', landsIn: 'your bank account', checkPrompt: 'Check it.', arrival: 'instant', payWindowMin: 90, fields: [{ key: 'k', label: 'L', kind: 'text' }] };
    const load = (p: Record<string, unknown>) => () => loadProfiles({ profiles: [{ ...base, ...p }] }, catalog());
    expect(load({ confirmWindowMin: 5760 })).not.toThrow();
    expect(load({ confirmWindowMin: 90 })).not.toThrow();
    for (const bad of [{ confirmWindowMin: 5761 }, { confirmWindowMin: 89 }, { confirmWindowMin: 45 }, {}, { confirmWindowMin: 90.5 }]) {
      expect(load(bad), JSON.stringify(bad)).toThrow(/confirmWindowMin/);
    }
  });

  it('a gift card profile may go down to 45 minutes (owner G50), and no lower; only gift cards (the rest keep 90)', () => {
    const card = { id: 'OTHER_GIFT_CARD', whatItIs: 'x', landsIn: 'the card balance', checkPrompt: 'Check it.', arrival: 'instant', payWindowMin: 90, fields: [{ key: 'k', label: 'L', kind: 'text' }] };
    const load = (p: Record<string, unknown>) => () => loadProfiles({ profiles: [{ ...card, ...p }] }, catalog());
    expect(load({ confirmWindowMin: 45 })).not.toThrow();
    expect(load({ confirmWindowMin: 44 })).toThrow(/confirmWindowMin must be 45-5760/);
    expect(getProfile('OTHER_GIFT_CARD')!.confirmWindowMin).toBe(45);
    for (const id of ['AMAZON_GIFT_CARD', 'STEAM_GIFT_CARD']) expect(tradeProfile(id).confirmWindowMin, id).toBe(45);
  });

  it('has no profile for an unknown method', () => {
    expect(getProfile('NOPE')).toBeNull();
    expect(getProfile('SPEI')).toBeNull(); // in the catalog, but no profile of its own (the Custom one at take)
    expect(getProfile('CHIME')).toBeNull();
    expect(getMethod('NOPE')).toBeNull();
  });

  it('marks legal-review methods unavailable (P3-I20)', () => {
    // owner 12 Nov: Russian anything is banned (and the US sanction laws: Iran, Cuba, North Korea).
    // SBP, MIR and YOOMONEY are out of the catalog, not merely under review: unknown, so never available.
    for (const id of ['SBP', 'MIR', 'YOOMONEY']) {
      expect(getMethod(id), id).toBeNull();
      expect(isAvailable(id), id).toBe(false);
    }
    expect(raw.methods.filter((m) => /russia|\bmir\b|yoomoney|yandex|sber|tinkoff|qiwi|iran|shetab|cuba|north korea/i.test(`${m.id} ${m.name}`)).map((m) => m.id)).toEqual([]);
    // The catalog refuses a banned id at load, so a re-added Russian method fails at startup.
    for (const id of BANNED_METHOD_IDS) {
      expect(() => loadCatalog({ methods: [{ id, name: 'X', group: 'Payment apps' }] }), id).toThrow(/banned/);
    }
    expect([...BANNED_METHOD_IDS].sort()).toEqual(['MIR', 'SBP', 'YOOMONEY']);
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

  it('lists the owner\'s gift cards: the top 30 + Home Hardware + Canadian Tire + Other, Razer Gold dropped (J-17, T-057, owner p5-6)', () => {
    const gifts = catalog().filter((m) => m.giftCard).map((m) => m.name);
    expect(gifts).toEqual([
      'Amazon gift card', 'Apple gift card', 'Google Play gift card', 'Uber gift card', 'Uber Eats gift card', 'DoorDash gift card',
      'Walmart gift card', 'Best Buy gift card', 'Home Depot gift card', 'Steam gift card', 'PlayStation gift card', 'Xbox gift card',
      'IKEA gift card', 'Sephora gift card', 'Starbucks gift card', 'Airbnb gift card', 'Roblox gift card', 'Nintendo eShop gift card',
      'Visa prepaid gift card', 'Mastercard prepaid gift card', 'Instacart gift card', 'Air Canada gift card', 'Petro-Canada gift card',
      'Esso gift card', 'SkipTheDishes gift card', 'Sobeys gift card', 'Winners gift card', 'Lululemon gift card', 'Tim Hortons gift card',
      'Target gift card', 'Home Hardware gift card', 'Canadian Tire gift card', 'Other gift card',
    ]);
    // 32 brands + Other; nothing else in the group (PaysafeCard is not on the owner's list).
    expect(gifts).toHaveLength(33);
    for (const id of ['RAZER_GOLD_GIFT_CARD', 'PAYSAFE']) expect(getMethod(id), id).toBeNull();
    // Every one of them takes the gift-card profile (45 minutes to check, G50).
    for (const m of catalog().filter((c) => c.giftCard)) expect(tradeProfile(m.id).confirmWindowMin, m.id).toBe(45);
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
  // Behind the front door (owner, 8 Nov 2026; it needed no session under P3-M9): a signed-in trader.
  let viewer: { id: string; browser: Browser };

  beforeAll(async () => {
    const liveOffers: NonNullable<Deps['liveOffers']> = async (q) => {
      calls.push(q);
      return stats;
    };
    let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];
    ({ app, trader } = await tradeApp({}, { liveOffers }));
    viewer = await trader();
  });
  afterAll(async () => app.close());

  const get = (qs: string) => viewer.browser.get(`/v1/methods${qs}`);

  it('is 401 with no data and asks no counts without a session (the front door)', async () => {
    const before = calls.length;
    const res = await app.inject({ method: 'GET', url: '/v1/methods?side=buy&currency=USD' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'not-authenticated' });
    expect(calls.length).toBe(before);
  });

  it('lists a method with one live Zelle USD offer in live; SBP, Mir and YooMoney in neither list', async () => {
    stats = [
      { methodId: 'ZELLE', offers: 1, bestCentsPerXmr: 33000n },
      // Even if offers somehow exist for them, removed methods (owner 12 Nov: Russian anything is banned) never show.
      { methodId: 'SBP', offers: 4, bestCentsPerXmr: 30000n },
    ];
    const res = await get('?side=buy&currency=USD');
    expect(res.statusCode).toBe(200);
    expect(res.headers['set-cookie']).toBeUndefined();
    const body = res.json() as { live: Array<Record<string, unknown>>; all: Array<Record<string, unknown>> };
    expect(body.live).toEqual([{ id: 'ZELLE', name: 'Zelle', group: 'Payment apps', giftCard: false, offers: 1, bestRate: '33000', upToMin: 90, payWindowMin: 90 }]);
    for (const list of [body.live, body.all]) {
      for (const id of ['SBP', 'MIR', 'YOOMONEY']) expect(list.map((r) => r.id)).not.toContain(id);
    }
    // The viewer's blocks filter the counts (Task 37 added viewerId to the query).
    expect(calls.at(-1)).toEqual({ side: 'buy', currency: 'USD', viewerId: viewer.id });
    const zelle = body.all.find((r) => r.id === 'ZELLE');
    expect(zelle).toEqual({ id: 'ZELLE', name: 'Zelle', group: 'Payment apps', giftCard: false, offers: 1, bestRate: '33000', upToMin: 90, payWindowMin: 90 });
    const venmo = body.all.find((r) => r.id === 'VENMO');
    expect(venmo).toEqual({ id: 'VENMO', name: 'Venmo', group: 'Payment apps', giftCard: false, offers: 0, bestRate: null, upToMin: 90, payWindowMin: 90 });
    // Owner p9-4: every method says up front how long it can take; one without a profile says the Custom method's 24 h.
    expect(body.all.find((r) => r.id === 'SWIFT')).toMatchObject({ upToMin: 4320, payWindowMin: 180 });
    expect(body.all.find((r) => r.id === 'CHIME')).toMatchObject({ upToMin: 1440, payWindowMin: 180 });
    expect(body.all.find((r) => r.id === 'PAY_BY_MAIL')).toMatchObject({ upToMin: 5760, payWindowMin: 1440 });
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
    const { app, trader } = await tradeApp();
    try {
      const res = await (await trader()).browser.get('/v1/methods?side=sell&currency=USD');
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
    const accountId = await seedAccount(deps, { loginName: 'suggester' });
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
    const staffId = await seedAccount(deps, { loginName: 'staffer', kind: 'staff' });
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
