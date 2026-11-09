import { AsyncLocalStorage } from 'node:async_hooks';
import { newTradeCode } from '@x2f/core';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { findByPublicName, PUBLIC_NAME, PUBLIC_NAME_KEY, publicNameOf } from '../src/nudge/names.js';
import { canonicalTimeZone, FORMATTER_CAP, formatterCacheSize, inQuietHours, localMinutes } from '../src/nudge/quiet.js';
import {
  NUDGE_GAP_MS, NUDGE_RETENTION_MS, RECIPIENT_LIMIT_PER_HOUR, purgeNudges, type NudgeEvent, type NudgeWiring,
} from '../src/nudge/routes.js';
import { chatSharedContext, pendingNudgeWiring, productionNudgeWiring, tradeSharedContext } from '../src/nudge/wiring.js';
import { seedAccount } from './helpers/accounts.js';
import { testApp } from './helpers/app.js';
import { testDb } from './helpers/db.js';
import { applyEvent } from '../src/trades/store.js';
import { driveTo, seedTrade } from './helpers/trades.js';
import { Browser, addTestLogin } from './helpers/totp.js';

const T0 = new Date('2026-10-17T12:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// ---- Fakes for Task 19 (publish, sendPush) and Tasks 6/20 (shared context) ----

const published: Array<[string, NudgeEvent]> = [];
const pushed: Array<unknown[]> = [];
const shared = new Set<string>();
/** Shared contexts that are an open trade between the two (a block does not stop those, review N1). */
const sharedTrades = new Set<string>();
/** When set, publish and sendPush never return (a slow push service): the response must not wait. */
let hang = false;
let publishThrows = false;

const ctxKey = (from: string, to: string, context: string) => `${from}|${to}|${context}`;

const fakeWiring: NudgeWiring = {
  async hasSharedContext(fromId, toId, context) {
    if (sharedTrades.has(ctxKey(fromId, toId, context))) return 'open-trade';
    return shared.has(ctxKey(fromId, toId, context));
  },
  publish(accountId, ev) {
    if (publishThrows) throw new Error(`publish failed for ${JSON.stringify(ev)}`);
    published.push([accountId, ev]);
    if (hang) return new Promise<void>(() => undefined);
  },
  async sendPush(...args) {
    pushed.push(args);
    if (hang) await new Promise<void>(() => undefined);
    return true;
  },
};

// ---- A pool that records every SQL statement, to show drops and deliveries run the same queries ----

/**
 * The statements of one request only: a query is recorded when it is issued inside `recorded(fn)`'s
 * async context. Work another request left running (the new-login push of the login before it,
 * Plan 2 Task 17) is issued in that request's context and never counted, however it interleaves
 * (review 2026-10-30 I7: the recording window, not the comparison).
 */
const requestSql = new AsyncLocalStorage<string[]>();

async function recorded<T>(fn: () => Promise<T>): Promise<{ result: T; sql: string[] }> {
  const sql: string[] = [];
  const result = await requestSql.run(sql, fn);
  // Copied when the response is back: delivery the request queued for later is not part of it.
  return { result, sql: [...sql] };
}

function recordingPool(pool: pg.Pool): pg.Pool {
  const wrapQuery = (target: { query: (...a: unknown[]) => unknown }) =>
    (...a: unknown[]) => {
      requestSql.getStore()?.push(typeof a[0] === 'string' ? a[0] : JSON.stringify(a[0]));
      return target.query(...a);
    };
  return new Proxy(pool, {
    get(t, prop, recv) {
      if (prop === 'query') return wrapQuery(t as never);
      if (prop === 'connect') {
        return async () => {
          const client = await t.connect();
          return new Proxy(client, {
            get(c, p, r) {
              if (p === 'query') return wrapQuery(c as never);
              const v = Reflect.get(c, p, r);
              return typeof v === 'function' ? v.bind(c) : v;
            },
          });
        };
      }
      const v = Reflect.get(t, prop, recv);
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
}

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let logs: string[];
let now = T0;
let step = 0;
let n = 0;
let rawDb: pg.Pool;

beforeAll(async () => {
  rawDb = await testDb();
  let set: (d: Date) => void;
  ({ app, deps, setNow: set, logs } = await testApp({ db: recordingPool(rawDb), nudges: fakeWiring }));
  setNow = (d) => {
    now = d;
    set(d);
  };
  addTestLogin(app, deps);
});

afterAll(async () => {
  await app.close();
  await rawDb.end();
});

beforeEach(() => {
  setNow(new Date(T0.getTime() + ++step * 2 * DAY));
  published.length = 0;
  pushed.length = 0;
  hang = false;
  publishThrows = false;
});

const at = (ms: number) => new Date(now.getTime() + ms);
const uniq = (p = 'ndg') => `${p}${String(++n).padStart(4, '0')}`;

async function trader(o: { kind?: 'trader' | 'staff' } = {}) {
  const name = uniq();
  const id = await seedAccount(deps, { displayName: name, loginName: `L${name}`, ...(o.kind ? { kind: o.kind } : {}) });
  const b = new Browser(app);
  const res = await b.post('/t/login', { accountId: id });
  expect(res.statusCode).toBe(200);
  return { id, name, b };
}

type Trader = Awaited<ReturnType<typeof trader>>;

/** A sender and a recipient who share an open chat or trade `context`. */
async function pair(context = 'K7Q2-M9XW') {
  const from = await trader();
  const to = await trader();
  shared.add(ctxKey(from.id, to.id, context));
  return { from, to, context };
}

const nudge = (from: Trader, to: string, context = 'K7Q2-M9XW') => from.b.post('/v1/nudges', { to, context });

/** Lets fire-and-forget delivery run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
}

/** What a sender can observe of a response: status, body and every header except the date. */
function observable(res: LightMyRequestResponse) {
  const { date: _date, ...headers } = res.headers;
  return { status: res.statusCode, body: res.body, headers };
}

async function delivered(): Promise<ReturnType<typeof observable>> {
  const p = await pair();
  const res = await nudge(p.from, p.to.name, p.context);
  expect(res.statusCode).toBe(202);
  return observable(res);
}

describe('POST /v1/nudges: delivery (spec 2.4)', () => {
  it('a nudge to someone sharing a chat or trade is accepted with 202 and delivered by SSE and push', async () => {
    const p = await pair();
    const res = await nudge(p.from, p.to.name, p.context);
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ ok: true });
    await settle();
    expect(published).toEqual([[p.to.id, { type: 'nudge', from: p.from.name, context: p.context }]]);
    expect(pushed).toEqual([[p.to.id, 'nudge']]);
  });

  it('finds the recipient by public name case-insensitively', async () => {
    const p = await pair();
    const res = await nudge(p.from, p.to.name.toUpperCase(), p.context);
    expect(res.statusCode).toBe(202);
    await settle();
    expect(published.map(([id]) => id)).toEqual([p.to.id]);
  });

  it('the push carries only the kind: never a name, a context or an amount', async () => {
    const p = await pair();
    await nudge(p.from, p.to.name, p.context);
    await settle();
    expect(pushed).toHaveLength(1);
    const sent = JSON.stringify(pushed[0]);
    expect(sent).not.toContain(p.from.name);
    expect(sent).not.toContain(p.to.name);
    expect(sent).not.toContain(p.context);
    expect(pushed[0]).toEqual([p.to.id, 'nudge']);
  });

  it('answers before delivery finishes (a slow push service cannot be timed)', async () => {
    hang = true;
    const p = await pair();
    const res = await nudge(p.from, p.to.name, p.context);
    expect(res.statusCode).toBe(202);
    await settle();
    expect(pushed).toHaveLength(1);
  });

  it('a failing delivery still answers 202 and logs no name or context', async () => {
    publishThrows = true;
    const p = await pair();
    const before = logs.length;
    const res = await nudge(p.from, p.to.name, p.context);
    expect(res.statusCode).toBe(202);
    await settle();
    const lines = logs.slice(before).join('\n');
    expect(lines).not.toContain(p.from.name);
    expect(lines).not.toContain(p.to.name);
    expect(lines).not.toContain(p.context);
    // The push is still tried after SSE failed.
    expect(pushed).toEqual([[p.to.id, 'nudge']]);
  });
});

describe('POST /v1/nudges: the sender\'s own refusals', () => {
  it('no shared chat or trade → 403 no-shared-context, nothing delivered', async () => {
    const from = await trader();
    const to = await trader();
    const res = await nudge(from, to.name);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'no-shared-context' });
    await settle();
    expect(published).toEqual([]);
    expect(pushed).toEqual([]);
  });

  it('a context shared with someone else does not count', async () => {
    const p = await pair('AAAA-BBBB');
    const other = await trader();
    const res = await nudge(p.from, other.name, 'AAAA-BBBB');
    expect(res.json()).toEqual({ error: 'no-shared-context' });
  });

  it('an unknown name and the sender themself look exactly like no shared context', async () => {
    const from = await trader();
    const to = await trader();
    const ref = observable(await nudge(from, to.name));
    expect(observable(await nudge(from, uniq('ghost')))).toEqual(ref);
    expect(observable(await nudge(from, 'x'))).toEqual(ref);
    shared.add(ctxKey(from.id, from.id, 'K7Q2-M9XW'));
    expect(observable(await nudge(from, from.name))).toEqual(ref);
  });

  it('a second nudge within 15 minutes → 429 too-soon with Retry-After; at 15 minutes it goes (owner, 7 Nov)', async () => {
    const p = await pair();
    expect((await nudge(p.from, p.to.name, p.context)).statusCode).toBe(202);
    setNow(at(4 * MIN));
    const res = await nudge(p.from, p.to.name, p.context);
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ error: 'too-soon', retryAfterSeconds: 660 });
    expect(res.headers['retry-after']).toBe('660');
    setNow(at(10 * MIN));
    expect((await nudge(p.from, p.to.name, p.context)).statusCode).toBe(429);
    setNow(at(11 * MIN));
    expect((await nudge(p.from, p.to.name, p.context)).statusCode).toBe(202);
    expect(NUDGE_GAP_MS).toBe(15 * MIN);
  });

  it('no cap on the number: every 15 minutes, as many times as needed (owner, 7 Nov)', async () => {
    const p = await pair();
    for (let i = 0; i < 8; i++) {
      expect((await nudge(p.from, p.to.name, p.context)).statusCode).toBe(202);
      setNow(at(NUDGE_GAP_MS));
    }
  });

  it('the 15 minutes are per sender and recipient: a vendor can nudge each silent buyer at once (lead, 7 Nov)', async () => {
    const p = await pair();
    const third = await trader();
    shared.add(ctxKey(p.from.id, third.id, 'ZZZZ-YYYY'));
    expect((await nudge(p.from, p.to.name, p.context)).statusCode).toBe(202);
    expect((await nudge(p.from, third.name, 'ZZZZ-YYYY')).statusCode).toBe(202);
    // Each counterpart has their own 15 minutes.
    expect((await nudge(p.from, p.to.name, p.context)).statusCode).toBe(429);
    expect((await nudge(p.from, third.name, 'ZZZZ-YYYY')).statusCode).toBe(429);
    // The recipient's own nudge back is a different pair.
    shared.add(ctxKey(p.to.id, p.from.id, p.context));
    expect((await nudge(p.to, p.from.name, p.context)).statusCode).toBe(202);
  });

  it('a silently dropped nudge still counts for too-soon (else too-soon would reveal the drop)', async () => {
    const p = await pair();
    expect((await p.to.b.put('/v1/account/nudges', { enabled: false, quietFrom: null, quietTo: null, tz: null })).statusCode).toBe(200);
    expect((await nudge(p.from, p.to.name, p.context)).statusCode).toBe(202);
    expect((await nudge(p.from, p.to.name, p.context)).statusCode).toBe(429);
  });

  it('a refused nudge (no shared context) does not start the 15 minutes', async () => {
    const p = await pair();
    const stranger = await trader();
    expect((await nudge(p.from, stranger.name)).statusCode).toBe(403);
    expect((await nudge(p.from, p.to.name, p.context)).statusCode).toBe(202);
  });

  it('checks the body: missing or malformed fields → 400 bad-request', async () => {
    const p = await pair();
    for (const body of [{}, { to: p.to.name }, { context: p.context }, { to: 1, context: p.context }, { to: p.to.name, context: 'a b' },
      { to: p.to.name, context: 'x'.repeat(65) }, { to: 'y'.repeat(65), context: p.context }]) {
      const res = await p.from.b.post('/v1/nudges', body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
  });

  it('needs a full trader session', async () => {
    const anon = new Browser(app);
    expect((await anon.post('/v1/nudges', { to: 'someone1', context: 'K7Q2-M9XW' })).statusCode).toBe(401);
    const staff = await trader({ kind: 'staff' });
    const res = await staff.b.post('/v1/nudges', { to: 'someone1', context: 'K7Q2-M9XW' });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'wrong-account-kind' });
  });
});

describe('POST /v1/nudges: silent drops look exactly like a delivered nudge (P3-M5)', () => {
  /** Runs one nudge that the recipient's state should drop, and checks it against a delivered one. */
  async function expectSilentDrop(setup: (p: Awaited<ReturnType<typeof pair>>) => Promise<void>) {
    const ref = await delivered();
    published.length = 0;
    pushed.length = 0;

    // The SQL a delivered nudge runs, recorded on a fresh pair.
    const q = await pair();
    const { result: sent, sql: deliveredSql } = await recorded(() => nudge(q.from, q.to.name, q.context));
    expect(sent.statusCode).toBe(202);
    // The request's own statements were seen (the comparison below is not of two empty lists).
    expect(deliveredSql.length).toBeGreaterThan(3);
    await settle();
    published.length = 0;
    pushed.length = 0;

    const p = await pair();
    await setup(p);
    const { result: res, sql: droppedSql } = await recorded(() => nudge(p.from, p.to.name, p.context));
    expect(observable(res)).toEqual(ref);
    // Same statements in the same order: no early return for a drop (timing-equivalent).
    expect(droppedSql).toEqual(deliveredSql);
    await settle();
    expect(published).toEqual([]);
    expect(pushed).toEqual([]);
  }

  it('the recipient blocked the sender', async () => {
    await expectSilentDrop(async (p) => {
      expect((await p.to.b.post('/v1/account/blocks', { displayName: p.from.name })).statusCode).toBe(204);
    });
  });

  it('the recipient turned nudges off', async () => {
    await expectSilentDrop(async (p) => {
      expect((await p.to.b.put('/v1/account/nudges', { enabled: false, quietFrom: null, quietTo: null, tz: null })).statusCode).toBe(200);
    });
  });

  it('the recipient is in quiet hours', async () => {
    await expectSilentDrop(async (p) => {
      // now is 12:00 UTC: 11:00-13:00 UTC is quiet.
      expect((await p.to.b.put('/v1/account/nudges', { enabled: true, quietFrom: '11:00', quietTo: '13:00', tz: 'UTC' })).statusCode).toBe(200);
    });
  });

  it('the recipient already got 3 nudges this hour (recipient-busy)', async () => {
    expect(RECIPIENT_LIMIT_PER_HOUR).toBe(3);
    await expectSilentDrop(async (p) => {
      for (let i = 0; i < 3; i++) {
        const other = await trader();
        shared.add(ctxKey(other.id, p.to.id, p.context));
        expect((await nudge(other, p.to.name, p.context)).statusCode).toBe(202);
        setNow(at(5 * MIN));
      }
      await settle();
      expect(published).toHaveLength(3);
      published.length = 0;
      pushed.length = 0;
    });
  });

  it('recipient-busy counts only the last hour, and only delivered nudges', async () => {
    const p = await pair();
    for (let i = 0; i < 3; i++) {
      const other = await trader();
      shared.add(ctxKey(other.id, p.to.id, p.context));
      expect((await nudge(other, p.to.name, p.context)).statusCode).toBe(202);
    }
    setNow(at(HOUR));
    expect((await nudge(p.from, p.to.name, p.context)).statusCode).toBe(202);
    await settle();
    expect(published.filter(([id]) => id === p.to.id)).toHaveLength(4);

    // Dropped nudges (here: blocked senders) do not use up the recipient's three.
    const q = await pair();
    for (let i = 0; i < 3; i++) {
      const blocked = await trader();
      shared.add(ctxKey(blocked.id, q.to.id, q.context));
      expect((await q.to.b.post('/v1/account/blocks', { displayName: blocked.name })).statusCode).toBe(204);
      expect((await nudge(blocked, q.to.name, q.context)).statusCode).toBe(202);
    }
    published.length = 0;
    expect((await nudge(q.from, q.to.name, q.context)).statusCode).toBe(202);
    await settle();
    expect(published.map(([id]) => id)).toEqual([q.to.id]);
  });

  // Where the cap is lifted (a real trade that is secured or paid) is checked
  // with real trades below: "review finding 4".

  it('a disabled recipient is dropped silently too', async () => {
    const ref = await delivered();
    const p = await pair();
    await deps.db.query('update accounts set disabled_at = $2 where id = $1', [p.to.id, now]);
    expect(observable(await nudge(p.from, p.to.name, p.context))).toEqual(ref);
    await settle();
    expect(published.filter(([id]) => id === p.to.id)).toEqual([]);
  });
});

describe('quiet hours in the recipient\'s time zone', () => {
  const quiet = (p: Awaited<ReturnType<typeof pair>>, quietFrom: string, quietTo: string, tz: string) =>
    p.to.b.put('/v1/account/nudges', { enabled: true, quietFrom, quietTo, tz });

  /**
   * Moves the clock and logs the sender in again: the jumps here outlast a trader's logout timer
   * (2-12 hours idle, FU-B), and an expired sender would get 401 before quiet hours are reached.
   */
  const jump = async (p: Awaited<ReturnType<typeof pair>>, d: Date) => {
    setNow(d);
    expect((await p.from.b.post('/t/login', { accountId: p.from.id })).statusCode).toBe(200);
  };

  /** UTC midnight after the test clock's current day, plus `h` hours (the clock only moves forward). */
  const utcDay = (h: number) => {
    const d = new Date(now);
    d.setUTCHours(24, 0, 0, 0);
    return new Date(d.getTime() + h * HOUR);
  };

  it('01:00-07:00 in Tokyo (UTC+9): 17:30 UTC is 02:30 there (dropped), 02:30 UTC is 11:30 there (delivered)', async () => {
    const p = await pair();
    expect((await quiet(p, '01:00', '07:00', 'Asia/Tokyo')).statusCode).toBe(200);
    await jump(p, utcDay(17.5));
    expect((await nudge(p.from, p.to.name, p.context)).statusCode).toBe(202);
    await settle();
    expect(published).toEqual([]);
    await jump(p, utcDay(2.5));
    expect((await nudge(p.from, p.to.name, p.context)).statusCode).toBe(202);
    await settle();
    expect(published.map(([id]) => id)).toEqual([p.to.id]);
  });

  it('a window across midnight (22:00-06:00 Bogotá, UTC-5) holds both sides of midnight', async () => {
    const p = await pair();
    expect((await quiet(p, '22:00', '06:00', 'America/Bogota')).statusCode).toBe(200);
    const base = utcDay(0);
    const cases: Array<[number, boolean]> = [
      [27, false], // 22:00 local: quiet starts
      [28.5, false], // 23:30
      [33, false], // 04:00
      [34.75, false], // 05:45
      [35, true], // 06:00: quiet ends
      [50 + 59 / 60, true], // 21:59 the next evening
    ];
    for (const [h, delivers] of cases) {
      const iso = new Date(base.getTime() + h * HOUR).toISOString();
      published.length = 0;
      await jump(p, new Date(iso));
      expect((await nudge(p.from, p.to.name, p.context)).statusCode).toBe(202);
      await settle();
      expect(published.length, iso).toBe(delivers ? 1 : 0);
    }
  });

  it('inQuietHours: same-day window, crossing midnight, and no window', () => {
    const t = new Date('2026-10-20T12:00:00Z');
    expect(inQuietHours({ quietFrom: 11 * 60, quietTo: 13 * 60, tz: 'UTC' }, t)).toBe(true);
    expect(inQuietHours({ quietFrom: 12 * 60 + 1, quietTo: 13 * 60, tz: 'UTC' }, t)).toBe(false);
    expect(inQuietHours({ quietFrom: 13 * 60, quietTo: 12 * 60, tz: 'UTC' }, t)).toBe(false); // 13:00-12:00 next day: 12:00 is the end
    expect(inQuietHours({ quietFrom: 13 * 60, quietTo: 12 * 60 + 1, tz: 'UTC' }, t)).toBe(true);
    expect(inQuietHours({ quietFrom: null, quietTo: null, tz: null }, t)).toBe(false);
    // 12:00 UTC is 21:00 in Tokyo and 08:00 in New York (EDT).
    expect(localMinutes(t, 'Asia/Tokyo')).toBe(21 * 60);
    expect(localMinutes(t, 'America/New_York')).toBe(8 * 60);
    expect(inQuietHours({ quietFrom: 20 * 60, quietTo: 2 * 60, tz: 'Asia/Tokyo' }, t)).toBe(true);
    expect(inQuietHours({ quietFrom: 20 * 60, quietTo: 2 * 60, tz: 'America/New_York' }, t)).toBe(false);
  });

  it('follows daylight saving time: 01:00-07:00 Berlin before and after the clocks change', () => {
    // 2026-10-25 03:00 CEST → 02:00 CET. 05:30 UTC is 07:30 CEST the day before, 06:30 CET after.
    const q = { quietFrom: 60, quietTo: 7 * 60, tz: 'Europe/Berlin' };
    expect(inQuietHours(q, new Date('2026-10-24T05:30:00Z'))).toBe(false);
    expect(inQuietHours(q, new Date('2026-10-26T05:30:00Z'))).toBe(true);
  });
});

describe('time zones: only supported zones, stored and cached by canonical name', () => {
  it('case and alias variants map to one canonical name', () => {
    expect(canonicalTimeZone('asia/tokyo')).toBe('Asia/Tokyo');
    expect(canonicalTimeZone('ASIA/TOKYO')).toBe('Asia/Tokyo');
    expect(canonicalTimeZone('US/Eastern')).toBe('America/New_York');
    for (const z of ['utc', 'UTC', 'Etc/UTC', 'GMT']) expect(canonicalTimeZone(z), z).toBe('UTC');
    for (const z of ['Not/AZone', 'Mars/Olympus', '', 'x'.repeat(65), 5, null]) expect(canonicalTimeZone(z), String(z)).toBeNull();
  });

  it('alias and case variants share one formatter cache entry; the cache is capped at the zone count', () => {
    const t = new Date('2026-10-20T12:00:00Z');
    localMinutes(t, 'Pacific/Auckland');
    const size = formatterCacheSize();
    for (const z of ['pacific/auckland', 'PACIFIC/AUCKLAND', 'Pacific/AUCKLAND', 'NZ', 'nz']) localMinutes(t, z);
    expect(formatterCacheSize()).toBe(size);
    expect(FORMATTER_CAP).toBeLessThan(1000);
    expect(() => localMinutes(t, 'Not/AZone')).toThrow(RangeError);
    expect(formatterCacheSize()).toBe(size);
  });

  it('PUT stores the canonical name, and refuses an unknown zone with 400', async () => {
    const t = await trader();
    const res = await t.b.put('/v1/account/nudges', { enabled: true, quietFrom: '01:00', quietTo: '07:00', tz: 'us/eastern' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ tz: 'America/New_York' });
    const { rows } = await deps.db.query<{ tz: string }>('select tz from nudge_settings where account_id = $1', [t.id]);
    expect(rows[0]!.tz).toBe('America/New_York');
    const bad = await t.b.put('/v1/account/nudges', { enabled: true, quietFrom: '01:00', quietTo: '07:00', tz: 'Not/AZone' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ error: 'bad-request' });
  });
});

describe('PUT/GET /v1/account/nudges', () => {
  it('nudges are on by default with no quiet hours', async () => {
    const t = await trader();
    const res = await t.b.get('/v1/account/nudges');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enabled: true, quietFrom: null, quietTo: null, tz: null });
  });

  it('saves and returns the settings', async () => {
    const t = await trader();
    const body = { enabled: true, quietFrom: '01:00', quietTo: '07:30', tz: 'Europe/Berlin' };
    const res = await t.b.put('/v1/account/nudges', body);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(body);
    expect((await t.b.get('/v1/account/nudges')).json()).toEqual(body);
    const off = { enabled: false, quietFrom: null, quietTo: null, tz: null };
    expect((await t.b.put('/v1/account/nudges', off)).json()).toEqual(off);
    expect((await t.b.get('/v1/account/nudges')).json()).toEqual(off);
  });

  it('refuses malformed settings with 400 bad-request', async () => {
    const t = await trader();
    const bad = [
      {},
      { enabled: 'yes', quietFrom: null, quietTo: null, tz: null },
      { enabled: true, quietFrom: '01:00', quietTo: null, tz: 'UTC' },
      { enabled: true, quietFrom: '01:00', quietTo: '07:00', tz: null },
      { enabled: true, quietFrom: '01:00', quietTo: '01:00', tz: 'UTC' },
      { enabled: true, quietFrom: '24:00', quietTo: '07:00', tz: 'UTC' },
      { enabled: true, quietFrom: '1:00', quietTo: '07:00', tz: 'UTC' },
      { enabled: true, quietFrom: '01:00', quietTo: '07:00', tz: 'Mars/Olympus' },
      { enabled: true, quietFrom: '01:00', quietTo: '07:00', tz: 'x'.repeat(65) },
      { enabled: true, quietFrom: null, quietTo: null, tz: 5 },
    ];
    for (const body of bad) {
      const res = await t.b.put('/v1/account/nudges', body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json()).toEqual({ error: 'bad-request' });
    }
  });

  it('needs a trader session', async () => {
    expect((await new Browser(app).get('/v1/account/nudges')).statusCode).toBe(401);
    expect((await new Browser(app).put('/v1/account/nudges', { enabled: true })).statusCode).toBe(401);
  });
});

describe('POST /v1/account/blocks', () => {
  it('blocks by public name; repeating is harmless', async () => {
    const a = await trader();
    const b = await trader();
    expect((await a.b.post('/v1/account/blocks', { displayName: b.name })).statusCode).toBe(204);
    expect((await a.b.post('/v1/account/blocks', { displayName: b.name.toUpperCase() })).statusCode).toBe(204);
    const { rows } = await deps.db.query('select 1 from account_blocks where account_id = $1 and blocked_id = $2', [a.id, b.id]);
    expect(rows).toHaveLength(1);
  });

  it('an unknown name → 404 not-found; yourself or a malformed body → 400', async () => {
    const a = await trader();
    expect((await a.b.post('/v1/account/blocks', { displayName: uniq('ghost') })).json()).toEqual({ error: 'not-found' });
    expect((await a.b.post('/v1/account/blocks', { displayName: a.name })).statusCode).toBe(400);
    expect((await a.b.post('/v1/account/blocks', {})).statusCode).toBe(400);
    expect((await a.b.post('/v1/account/blocks', { displayName: 7 })).statusCode).toBe(400);
    // The old `{ username }` field is gone, and the private login name blocks nobody.
    const b = await trader();
    expect((await a.b.post('/v1/account/blocks', { username: b.name })).statusCode).toBe(400);
    expect((await a.b.post('/v1/account/blocks', { displayName: `L${b.name}` })).json()).toEqual({ error: 'not-found' });
  });

  it('a block only stops nudges from the blocked person', async () => {
    const p = await pair();
    const other = await trader();
    shared.add(ctxKey(other.id, p.to.id, p.context));
    expect((await p.to.b.post('/v1/account/blocks', { displayName: p.from.name })).statusCode).toBe(204);
    expect((await nudge(other, p.to.name, p.context)).statusCode).toBe(202);
    await settle();
    expect(published.map(([id]) => id)).toEqual([p.to.id]);
  });

  it('Task 37 review N1: inside an open trade a block either way does not stop nudges', async () => {
    const p = await pair();
    const key = (a: Trader, b: Trader) => ctxKey(a.id, b.id, p.context);
    sharedTrades.add(key(p.from, p.to));
    sharedTrades.add(key(p.to, p.from));
    // The seller (to) blocked the buyer (from) mid-trade; the buyer paid and nudges to release.
    expect((await p.to.b.post('/v1/account/blocks', { displayName: p.from.name })).statusCode).toBe(204);
    expect((await nudge(p.from, p.to.name, p.context)).statusCode).toBe(202);
    // And the blocker can still nudge the person they blocked about the trade.
    expect((await nudge(p.to, p.from.name, p.context)).statusCode).toBe(202);
    await settle();
    expect(published).toEqual([
      [p.to.id, { type: 'nudge', from: p.from.name, context: p.context }],
      [p.from.id, { type: 'nudge', from: p.to.name, context: p.context }],
    ]);
    const { rows } = await deps.db.query<{ delivered: boolean }>(
      'select delivered from nudges where from_id = any($1::uuid[]) order by sent_at',
      [[p.from.id, p.to.id]],
    );
    expect(rows.map((r) => r.delivered)).toEqual([true, true]);
  });

  it('Task 37 review N1: outside a trade (an offer chat) a block either way drops the nudge silently', async () => {
    const p = await pair();
    shared.add(ctxKey(p.to.id, p.from.id, p.context));
    expect((await p.to.b.post('/v1/account/blocks', { displayName: p.from.name })).statusCode).toBe(204);
    for (const [a, b] of [[p.from, p.to], [p.to, p.from]] as const) {
      const res = await nudge(a, b.name, p.context);
      expect(res.statusCode).toBe(202);
      expect(res.json()).toEqual({ ok: true });
    }
    await settle();
    expect(published).toEqual([]);
  });

  it('Task 37 review M6: the blocker cannot nudge the person they blocked either (dropped silently)', async () => {
    const p = await pair();
    // The sender blocked the recipient: same 202 as a delivered nudge, nothing delivered.
    expect((await p.from.b.post('/v1/account/blocks', { displayName: p.to.name })).statusCode).toBe(204);
    const res = await nudge(p.from, p.to.name, p.context);
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ ok: true });
    await settle();
    expect(published).toEqual([]);
    const { rows } = await deps.db.query<{ delivered: boolean }>('select delivered from nudges where from_id = $1', [p.from.id]);
    expect(rows.map((r) => r.delivered)).toEqual([false]);
  });
});

describe('purgeNudges', () => {
  it('keeps nudge records only as long as the longest limit (1 hour)', async () => {
    expect(NUDGE_RETENTION_MS).toBe(HOUR);
    const p = await pair();
    expect((await nudge(p.from, p.to.name, p.context)).statusCode).toBe(202);
    const count = async () =>
      Number((await deps.db.query<{ n: string }>('select count(*) as n from nudges where from_id = $1', [p.from.id])).rows[0]!.n);
    // Earlier tests' records are days old and go on the first run; this one stays until it is an hour old.
    await purgeNudges.run(rawDb, at(HOUR - 1));
    expect(await count()).toBe(1);
    expect(await purgeNudges.run(rawDb, at(HOUR + 1))).toBeGreaterThanOrEqual(1);
    expect(await count()).toBe(0);
  });
});

describe('the public name helper (display name, never the login name)', () => {
  it('recipient lookup uses the public name column through one constant', async () => {
    const t = await trader();
    expect(await findByPublicName(deps.db, t.name.toUpperCase())).toEqual({ id: t.id, name: t.name, disabled: false });
    expect(await findByPublicName(deps.db, uniq('ghost'))).toBeNull();
    expect(await findByPublicName(deps.db, 'bad name!')).toBeNull();
  });

  it('the private login name finds nobody, and is never what the lookup returns', async () => {
    const t = await trader();
    expect(await findByPublicName(deps.db, `L${t.name}`)).toBeNull();
    expect(await publicNameOf(deps.db, t.id)).toBe(t.name);
  });

  it('the public name columns are display_name / display_key (never login_name / login_key)', async () => {
    expect([PUBLIC_NAME, PUBLIC_NAME_KEY]).toEqual(['display_name', 'display_key']);
    const { rows } = await deps.db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name = 'accounts' and column_name in ($1, $2)`,
      [PUBLIC_NAME, PUBLIC_NAME_KEY],
    );
    expect(rows.map((r) => r.column_name).sort()).toEqual(['display_key', 'display_name']);
  });
});

describe('shared context from real trades (Task 6)', () => {
  it('the buyer and the seller of an open trade share it, either way round and in any spelling of the code', async () => {
    const a = await trader();
    const b = await trader();
    const c = await trader();
    const { code } = await seedTrade(deps, { sellerId: a.id, buyerId: b.id, poster: 'seller' });
    const shares = tradeSharedContext(deps.db);
    expect(await shares(a.id, b.id, code)).toBe('open-trade');
    expect(await shares(b.id, a.id, code)).toBe('open-trade');
    expect(await shares(a.id, b.id, code.toLowerCase().replace(/-/g, ''))).toBe('open-trade');
    expect(await shares(a.id, c.id, code)).toBe(false);
    expect(await shares(c.id, b.id, code)).toBe(false);
    expect(await shares(a.id, a.id, code)).toBe(false);
    expect(await shares(a.id, b.id, 'K7Q2-M9XW')).toBe(false);
  });

  it('a closed trade is no longer a shared context; a disputed one still is', async () => {
    const a = await trader();
    const b = await trader();
    const shares = tradeSharedContext(deps.db);
    const done = await seedTrade(deps, { sellerId: a.id, buyerId: b.id, poster: 'buyer' });
    await driveTo(deps, done.trade, 'released');
    expect(await shares(a.id, b.id, done.code)).toBe(false);
    const open = await seedTrade(deps, { sellerId: a.id, buyerId: b.id, poster: 'buyer' });
    await deps.db.query("update trades set state = 'disputed', closed_at = null where code = $1", [open.code]);
    expect(await shares(b.id, a.id, open.code)).toBe('open-trade');
  });

  it('end to end: a nudge about an open trade goes through the production check', async () => {
    const a = await trader();
    const b = await trader();
    const { code } = await seedTrade(deps, { sellerId: a.id, buyerId: b.id, poster: 'seller' });
    const real = productionNudgeWiring(deps.db);
    const saved = fakeWiring.hasSharedContext;
    fakeWiring.hasSharedContext = real.hasSharedContext;
    try {
      expect((await nudge(a, b.name, code)).statusCode).toBe(202);
      await settle();
      expect(published).toEqual([[b.id, { type: 'nudge', from: a.name, context: code }]]);
      const stranger = await trader();
      expect((await nudge(stranger, b.name, code)).json()).toEqual({ error: 'no-shared-context' });
      // Review N1: a block between the two does not stop nudges about their open trade.
      published.length = 0;
      expect((await a.b.post('/v1/account/blocks', { displayName: b.name })).statusCode).toBe(204);
      expect((await nudge(b, a.name, code)).statusCode).toBe(202);
      await settle();
      expect(published).toEqual([[a.id, { type: 'nudge', from: b.name, context: code }]]);
    } finally {
      fakeWiring.hasSharedContext = saved;
    }
  });
});

describe('the seller\'s nudge unlocks the refund (owner G2, g66; migration 119)', () => {
  const nudgedAt = async (code: string): Promise<Date | null> =>
    (await deps.db.query<{ t: Date | null }>('select seller_nudged_at as t from trades where code = $1', [code])).rows[0]!.t;

  async function withRealWiring<T>(fn: () => Promise<T>): Promise<T> {
    const saved = fakeWiring.hasSharedContext;
    fakeWiring.hasSharedContext = productionNudgeWiring(deps.db).hasSharedContext;
    try {
      return await fn();
    } finally {
      fakeWiring.hasSharedContext = saved;
    }
  }

  it('the seller\'s accepted nudge in a secured trade sets it once; later nudges keep the first time', async () => {
    const seller = await trader();
    const buyer = await trader();
    const s = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
    await driveTo(deps, s.trade, 'secured');
    expect(await nudgedAt(s.code)).toBeNull();
    await withRealWiring(async () => {
      const first = now;
      expect((await nudge(seller, buyer.name, s.code)).statusCode).toBe(202);
      expect(await nudgedAt(s.code)).toEqual(first);
      setNow(at(NUDGE_GAP_MS));
      expect((await nudge(seller, buyer.name, s.code.toLowerCase().replace(/-/g, ''))).statusCode).toBe(202);
      expect(await nudgedAt(s.code)).toEqual(first);
    });
  });

  it('set even when the nudge is dropped silently (nudges off): the seller did nudge, and sees the same 202', async () => {
    const seller = await trader();
    const buyer = await trader();
    const s = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
    await driveTo(deps, s.trade, 'secured');
    expect((await buyer.b.put('/v1/account/nudges', { enabled: false, quietFrom: null, quietTo: null, tz: null })).statusCode).toBe(200);
    await withRealWiring(async () => {
      expect((await nudge(seller, buyer.name, s.code)).statusCode).toBe(202);
    });
    await settle();
    expect(published).toEqual([]);
    expect(await nudgedAt(s.code)).toEqual(now);
  });

  it('through the trade\'s linked chat too', async () => {
    const seller = await trader();
    const buyer = await trader();
    const s = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
    await driveTo(deps, s.trade, 'secured');
    const chat = newTradeCode();
    await deps.db.query(
      'insert into chats (code, offer_id, buyer_account_id, seller_account_id, trade_code, created_at) values ($1, $2, $3, $4, $5, now())',
      [chat, s.trade.offerId, buyer.id, seller.id, s.code],
    );
    await withRealWiring(async () => {
      expect((await nudge(seller, buyer.name, chat)).statusCode).toBe(202);
    });
    expect(await nudgedAt(s.code)).toEqual(now);
  });

  it('not by the buyer, not before the escrow is secured, and not when refused too-soon', async () => {
    const seller = await trader();
    const buyer = await trader();
    const s = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
    await driveTo(deps, s.trade, 'securing');
    await withRealWiring(async () => {
      // Before secured: the nudge goes, but it does not count for the refund.
      expect((await nudge(seller, buyer.name, s.code)).statusCode).toBe(202);
      expect(await nudgedAt(s.code)).toBeNull();
      const funds = s.trade.sellerFundsAtomic;
      await applyEvent(deps, s.code, { type: 'chain', receivedAtomic: funds, unlockedAtomic: funds, confirmations: 10 }, 'system');
      // Within the seller's 15 minutes: refused, nothing recorded.
      expect((await nudge(seller, buyer.name, s.code)).statusCode).toBe(429);
      expect(await nudgedAt(s.code)).toBeNull();
      // The buyer's nudge never counts as the seller's.
      expect((await nudge(buyer, seller.name, s.code)).statusCode).toBe(202);
      expect(await nudgedAt(s.code)).toBeNull();
      setNow(at(NUDGE_GAP_MS));
      expect((await nudge(seller, buyer.name, s.code)).statusCode).toBe(202);
      expect(await nudgedAt(s.code)).toEqual(now);
    });
  });

  it('the trade view shows it', async () => {
    const seller = await trader();
    const buyer = await trader();
    const s = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
    await driveTo(deps, s.trade, 'secured');
    const view = async () => (await seller.b.get(`/v1/trades/${s.code}`)).json() as { sellerNudgedAt: string | null };
    expect((await view()).sellerNudgedAt).toBeNull();
    await withRealWiring(async () => {
      expect((await nudge(seller, buyer.name, s.code)).statusCode).toBe(202);
    });
    expect((await view()).sellerNudgedAt).toBe(now.toISOString());
  });

  it('nudges are optional (owner 8 Nov, p6-1): the seller cancels after the time to pay with no nudge at all', async () => {
    const seller = await trader();
    const buyer = await trader();
    const s = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
    const funds = s.trade.sellerFundsAtomic;
    await driveTo(deps, s.trade, 'securing');
    const refund = () => seller.b.post(`/v1/trades/${s.code}/events`, { type: 'request-refund' });
    const secured = await applyEvent(deps, s.code, { type: 'chain', receivedAtomic: funds, unlockedAtomic: funds, confirmations: 10 }, 'system');
    // Before the time to pay is over: too early, nudge or not.
    setNow(new Date(secured.payBy!.getTime() - MIN));
    const early = await refund();
    expect(early.statusCode).toBe(409);
    expect(early.json()).toEqual({ error: 'too-early' });
    setNow(new Date(secured.payBy!.getTime() + MIN));
    const ok = await refund();
    expect(ok.statusCode, ok.body).toBe(200);
    expect(await nudgedAt(s.code)).toBeNull();
    const row = (await deps.db.query<{ state: string; settling: string | null }>('select state, settling from trades where code = $1', [s.code])).rows[0]!;
    expect(row).toEqual({ state: 'settling', settling: 'auto-refund' });
  });

  it('a nudge is still one per 15 minutes per counterpart, with no count cap, after the time to pay too', async () => {
    const seller = await trader();
    const buyer = await trader();
    const s = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
    const secured = await driveTo(deps, s.trade, 'secured');
    // The time to pay outlasts the seller's first session (2 hours): log in again at its end; the
    // loop's 90 minutes fit in the new one.
    setNow(secured.payBy!);
    expect((await seller.b.post('/t/login', { accountId: seller.id })).statusCode).toBe(200);
    await withRealWiring(async () => {
      for (let i = 0; i < 6; i++) {
        setNow(new Date(secured.payBy!.getTime() + i * NUDGE_GAP_MS));
        // The test login's 2 h session (main 307/313) ends during the loop: a fresh one each pass.
        expect((await seller.b.post('/t/login', { accountId: seller.id })).statusCode).toBe(200);
        expect((await nudge(seller, buyer.name, s.code)).statusCode, `nudge ${i}`).toBe(202);
        setNow(new Date(secured.payBy!.getTime() + i * NUDGE_GAP_MS + NUDGE_GAP_MS - 1));
        expect((await nudge(seller, buyer.name, s.code)).statusCode, `too soon ${i}`).toBe(429);
      }
    });
  });

  it('review finding 2: the nudge locks the trade row before the accounts, the same order as trade events (no deadlock)', async () => {
    const seller = await trader();
    const buyer = await trader();
    const s = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
    await driveTo(deps, s.trade, 'secured');
    // An events transaction: the trade row first, then the actor's account (store.applyEvent, hold.lockAccount).
    const ev = await rawDb.connect();
    try {
      await ev.query('begin');
      await ev.query('select 1 from trades where code = $1 for update', [s.code]);
      const pending = withRealWiring(() => nudge(seller, buyer.name, s.code));
      // Wait until the nudge is blocked (on the trade row, with no account locked).
      for (let i = 0; i < 100; i++) {
        const { rows } = await ev.query<{ n: number }>(
          `select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and pid <> pg_backend_pid() and datname = current_database()`,
        );
        if (rows[0]!.n > 0) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      // Had the nudge locked the accounts first, this would deadlock (40P01).
      await ev.query('select id from accounts where id = $1 for no key update', [buyer.id]);
      await ev.query('commit');
      expect((await pending).statusCode).toBe(202);
    } finally {
      ev.release();
    }
    expect((await deps.db.query<{ t: Date | null }>('select seller_nudged_at as t from trades where code = $1', [s.code])).rows[0]!.t).toEqual(now);
  });

  it('review finding 4: the 3-per-hour cap is lifted only while the trade is secured or paid; kept in settling, disputed and lapsed', async () => {
    const seller = await trader();
    const buyer = await trader();
    const s = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
    await driveTo(deps, s.trade, 'secured');
    const filler = await trader();
    const cases: [string, boolean][] = [['secured', true], ['paid', true], ['settling', false], ['disputed', false], ['lapsed', false], ['securing', false]];
    await withRealWiring(async () => {
      for (const [state, delivered] of cases) {
        setNow(at(NUDGE_GAP_MS));
        await deps.db.query('update trades set state = $2, closed_at = null where code = $1', [s.code, state]);
        // The buyer already got 3 delivered nudges this hour from someone else.
        for (let i = 0; i < RECIPIENT_LIMIT_PER_HOUR; i++) {
          await deps.db.query('insert into nudges (from_id, to_id, sent_at, delivered) values ($1, $2, $3, true)', [filler.id, buyer.id, at(-i * MIN)]);
        }
        published.length = 0;
        expect((await nudge(seller, buyer.name, s.code)).statusCode, state).toBe(202);
        await settle();
        expect(published.filter(([id]) => id === buyer.id).length, state).toBe(delivered ? 1 : 0);
      }
    });
  });
});

describe('shared context from open chats (Task 20)', () => {
  /** A chat between `seller` (who posted a sell offer) and `buyer`, inserted directly. */
  async function seedChat(sellerId: string, buyerId: string, tradeCode: string | null = null): Promise<string> {
    const { rows } = await deps.db.query<{ id: string }>(
      `insert into offers (account_id, side, method_id, currency, price_mode, margin_bps, min_fiat_cents, max_fiat_cents, min_trades, terms, status, created_at, updated_at)
       values ($1, 'sell', 'zelle', 'USD', 'market', 100, 1000, 100000, null, '', 'live', now(), now()) returning id`,
      [sellerId],
    );
    const code = newTradeCode();
    await deps.db.query(
      'insert into chats (code, offer_id, buyer_account_id, seller_account_id, trade_code, created_at) values ($1, $2, $3, $4, $5, now())',
      [code, rows[0]!.id, buyerId, sellerId, tradeCode],
    );
    return code;
  }

  it('the two sides of an open pre-trade chat share it, either way round and in any spelling', async () => {
    const a = await trader();
    const b = await trader();
    const c = await trader();
    const chat = await seedChat(a.id, b.id);
    const shares = chatSharedContext(deps.db);
    expect(await shares(a.id, b.id, chat)).toBe(true);
    expect(await shares(b.id, a.id, chat.toLowerCase().replace(/-/g, ''))).toBe(true);
    expect(await shares(a.id, c.id, chat)).toBe(false);
    expect(await shares(a.id, a.id, chat)).toBe(false);
    expect(await shares(a.id, b.id, 'K7Q2-M9XW')).toBe(false);
    expect(await productionNudgeWiring(deps.db).hasSharedContext(b.id, a.id, chat)).toBe(true);
    expect(await pendingNudgeWiring.hasSharedContext(a.id, b.id, chat)).toBe(false);
  });

  it("a chat whose trade closed is no longer a shared context; an open trade's chat still is", async () => {
    const a = await trader();
    const b = await trader();
    const shares = chatSharedContext(deps.db);
    const done = await seedTrade(deps, { sellerId: a.id, buyerId: b.id, poster: 'seller' });
    await driveTo(deps, done.trade, 'released');
    expect(await shares(a.id, b.id, await seedChat(a.id, b.id, done.code))).toBe(false);
    const open = await seedTrade(deps, { sellerId: a.id, buyerId: b.id, poster: 'seller' });
    // Linked to an open trade: it answers like the trade itself, so a block does not drop the nudge (lead 2026-10-29).
    expect(await shares(a.id, b.id, await seedChat(a.id, b.id, open.code))).toBe('open-trade');
  });

  it("under a block, a nudge from a chat linked to an open trade gets through like a trade nudge; a pre-trade chat's is dropped", async () => {
    const a = await trader();
    const b = await trader();
    const open = await seedTrade(deps, { sellerId: a.id, buyerId: b.id, poster: 'seller' });
    const tradeChat = await seedChat(a.id, b.id, open.code);
    const offerChat = await seedChat(a.id, b.id);
    const saved = fakeWiring.hasSharedContext;
    fakeWiring.hasSharedContext = productionNudgeWiring(deps.db).hasSharedContext;
    try {
      expect((await a.b.post('/v1/account/blocks', { displayName: b.name })).statusCode).toBe(204);
      expect((await nudge(b, a.name, tradeChat)).statusCode).toBe(202);
      await settle();
      expect(published).toEqual([[a.id, { type: 'nudge', from: b.name, context: tradeChat }]]);
      published.length = 0;
      setNow(at(NUDGE_GAP_MS + MIN));
      // The same 202, but nothing reaches the blocker.
      expect((await nudge(b, a.name, offerChat)).statusCode).toBe(202);
      await settle();
      expect(published).toEqual([]);
    } finally {
      fakeWiring.hasSharedContext = saved;
    }
  });

  it('delivery is left to Task 19 (no publish or sendPush stub)', () => {
    // Left out on purpose: nudge/routes.ts then delivers over app.events and app.push (test/nudge-delivery.test.ts).
    expect(pendingNudgeWiring.publish).toBeUndefined();
    expect(pendingNudgeWiring.sendPush).toBeUndefined();
    expect(productionNudgeWiring(deps.db).publish).toBeUndefined();
    expect(productionNudgeWiring(deps.db).sendPush).toBeUndefined();
  });
});
