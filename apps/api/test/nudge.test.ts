import { existsSync } from 'node:fs';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { findByPublicName, PUBLIC_NAME, PUBLIC_NAME_KEY } from '../src/nudge/names.js';
import { inQuietHours, localMinutes } from '../src/nudge/quiet.js';
import {
  NUDGE_GAP_MS, NUDGE_RETENTION_MS, RECIPIENT_LIMIT_PER_HOUR, purgeNudges, type NudgeEvent, type NudgeWiring,
} from '../src/nudge/routes.js';
import { pendingNudgeWiring } from '../src/nudge/wiring.js';
import { seedAccount } from './helpers/accounts.js';
import { testApp } from './helpers/app.js';
import { testDb } from './helpers/db.js';
import { Browser, addTestLogin } from './helpers/totp.js';

const T0 = new Date('2026-10-17T12:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// ---- Fakes for Task 19 (publish, sendPush) and Tasks 6/20 (shared context) ----

const published: Array<[string, NudgeEvent]> = [];
const pushed: Array<unknown[]> = [];
const shared = new Set<string>();
/** When set, publish and sendPush never return (a slow push service): the response must not wait. */
let hang = false;
let publishThrows = false;

const ctxKey = (from: string, to: string, context: string) => `${from}|${to}|${context}`;

const fakeWiring: NudgeWiring = {
  async hasSharedContext(fromId, toId, context) {
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

let recording: string[] | null = null;

function recordingPool(pool: pg.Pool): pg.Pool {
  const wrapQuery = (target: { query: (...a: unknown[]) => unknown }) =>
    (...a: unknown[]) => {
      if (recording) recording.push(typeof a[0] === 'string' ? a[0] : JSON.stringify(a[0]));
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
  recording = null;
});

const at = (ms: number) => new Date(now.getTime() + ms);
const uniq = (p = 'ndg') => `${p}${String(++n).padStart(4, '0')}`;

async function trader(o: { kind?: 'trader' | 'staff' } = {}) {
  const name = uniq();
  const id = await seedAccount(deps, { username: name, ...(o.kind ? { kind: o.kind } : {}) });
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

  it('a second nudge within 10 minutes → 429 too-soon with Retry-After; at 10 minutes it goes', async () => {
    const p = await pair();
    expect((await nudge(p.from, p.to.name, p.context)).statusCode).toBe(202);
    setNow(at(4 * MIN));
    const res = await nudge(p.from, p.to.name, p.context);
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ error: 'too-soon', retryAfterSeconds: 360 });
    expect(res.headers['retry-after']).toBe('360');
    setNow(at(6 * MIN));
    expect((await nudge(p.from, p.to.name, p.context)).statusCode).toBe(202);
    expect(NUDGE_GAP_MS).toBe(10 * MIN);
  });

  it('one nudge per sender per 10 minutes, whoever it is to', async () => {
    const p = await pair();
    const third = await trader();
    shared.add(ctxKey(p.from.id, third.id, 'ZZZZ-YYYY'));
    expect((await nudge(p.from, p.to.name, p.context)).statusCode).toBe(202);
    expect((await nudge(p.from, third.name, 'ZZZZ-YYYY')).statusCode).toBe(429);
  });

  it('a silently dropped nudge still counts for too-soon (else too-soon would reveal the drop)', async () => {
    const p = await pair();
    expect((await p.to.b.put('/v1/account/nudges', { enabled: false, quietFrom: null, quietTo: null, tz: null })).statusCode).toBe(200);
    expect((await nudge(p.from, p.to.name, p.context)).statusCode).toBe(202);
    expect((await nudge(p.from, p.to.name, p.context)).statusCode).toBe(429);
  });

  it('a refused nudge (no shared context) does not start the 10 minutes', async () => {
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
    recording = [];
    expect((await nudge(q.from, q.to.name, q.context)).statusCode).toBe(202);
    const deliveredSql = recording;
    recording = null;
    await settle();
    published.length = 0;
    pushed.length = 0;

    const p = await pair();
    await setup(p);
    recording = [];
    const res = await nudge(p.from, p.to.name, p.context);
    const droppedSql = recording;
    recording = null;
    expect(observable(res)).toEqual(ref);
    // Same statements in the same order: no early return for a drop (timing-equivalent).
    expect(droppedSql).toEqual(deliveredSql);
    await settle();
    expect(published).toEqual([]);
    expect(pushed).toEqual([]);
  }

  it('the recipient blocked the sender', async () => {
    await expectSilentDrop(async (p) => {
      expect((await p.to.b.post('/v1/account/blocks', { username: p.from.name })).statusCode).toBe(204);
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
      expect((await q.to.b.post('/v1/account/blocks', { username: blocked.name })).statusCode).toBe(204);
      expect((await nudge(blocked, q.to.name, q.context)).statusCode).toBe(202);
    }
    published.length = 0;
    expect((await nudge(q.from, q.to.name, q.context)).statusCode).toBe(202);
    await settle();
    expect(published.map(([id]) => id)).toEqual([q.to.id]);
  });

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

  /** UTC midnight after the test clock's current day, plus `h` hours (the clock only moves forward). */
  const utcDay = (h: number) => {
    const d = new Date(now);
    d.setUTCHours(24, 0, 0, 0);
    return new Date(d.getTime() + h * HOUR);
  };

  it('01:00-07:00 in Tokyo (UTC+9): 17:30 UTC is 02:30 there (dropped), 02:30 UTC is 11:30 there (delivered)', async () => {
    const p = await pair();
    expect((await quiet(p, '01:00', '07:00', 'Asia/Tokyo')).statusCode).toBe(200);
    setNow(utcDay(17.5));
    expect((await nudge(p.from, p.to.name, p.context)).statusCode).toBe(202);
    await settle();
    expect(published).toEqual([]);
    setNow(utcDay(2.5));
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
      setNow(new Date(iso));
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
    expect((await a.b.post('/v1/account/blocks', { username: b.name })).statusCode).toBe(204);
    expect((await a.b.post('/v1/account/blocks', { username: b.name.toUpperCase() })).statusCode).toBe(204);
    const { rows } = await deps.db.query('select 1 from account_blocks where account_id = $1 and blocked_id = $2', [a.id, b.id]);
    expect(rows).toHaveLength(1);
  });

  it('an unknown name → 404 not-found; yourself or a malformed body → 400', async () => {
    const a = await trader();
    expect((await a.b.post('/v1/account/blocks', { username: uniq('ghost') })).json()).toEqual({ error: 'not-found' });
    expect((await a.b.post('/v1/account/blocks', { username: a.name })).statusCode).toBe(400);
    expect((await a.b.post('/v1/account/blocks', {})).statusCode).toBe(400);
    expect((await a.b.post('/v1/account/blocks', { username: 7 })).statusCode).toBe(400);
  });

  it('a block only stops nudges from the blocked person', async () => {
    const p = await pair();
    const other = await trader();
    shared.add(ctxKey(other.id, p.to.id, p.context));
    expect((await p.to.b.post('/v1/account/blocks', { username: p.from.name })).statusCode).toBe(204);
    expect((await nudge(other, p.to.name, p.context)).statusCode).toBe(202);
    await settle();
    expect(published.map(([id]) => id)).toEqual([p.to.id]);
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

describe('the public name helper (wip/lead-p2-fua renames username → display_name)', () => {
  it('recipient lookup uses the public name column through one constant', async () => {
    const t = await trader();
    expect(await findByPublicName(deps.db, t.name.toUpperCase())).toEqual({ id: t.id, name: t.name, disabled: false });
    expect(await findByPublicName(deps.db, uniq('ghost'))).toBeNull();
    expect(await findByPublicName(deps.db, 'bad name!')).toBeNull();
  });

  it('TRIPWIRE (fua): the public name column is still `username`', async () => {
    const { rows } = await deps.db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name = 'accounts' and column_name in ($1, $2)`,
      [PUBLIC_NAME, PUBLIC_NAME_KEY],
    );
    // When wip/lead-p2-fua merges (username → display_name), set PUBLIC_NAME / PUBLIC_NAME_KEY in
    // apps/api/src/nudge/names.ts to display_name / display_key: never the private login name.
    expect(rows.map((r) => r.column_name).sort(), 'fua merged: update apps/api/src/nudge/names.ts').toEqual(
      [PUBLIC_NAME, PUBLIC_NAME_KEY].sort(),
    );
  });
});

describe('TRIPWIRES: real wiring for Tasks 6, 19 and 20', () => {
  it('the production stand-in shares no context and delivers nothing', async () => {
    expect(await pendingNudgeWiring.hasSharedContext('a', 'b', 'K7Q2-M9XW')).toBe(false);
  });

  it('Task 6 (trades) is not merged yet: wire hasSharedContext to active trades in nudge/wiring.ts', async () => {
    const { rows } = await deps.db.query<{ t: string | null }>(`select to_regclass('public.trades')::text as t`);
    expect(rows[0]!.t, 'Task 6 merged: hasSharedContext must check active trades (apps/api/src/nudge/wiring.ts)').toBeNull();
  });

  it('Task 20 (chats) is not merged yet: wire hasSharedContext to open chats in nudge/wiring.ts', async () => {
    const { rows } = await deps.db.query<{ t: string | null }>(`select to_regclass('public.chats')::text as t`);
    expect(rows[0]!.t, 'Task 20 merged: hasSharedContext must check open chats (apps/api/src/nudge/wiring.ts)').toBeNull();
  });

  it('Task 19 (events bus, Web Push) is not merged yet: wire publish and sendPush in nudge/wiring.ts', () => {
    const src = new URL('../src/', import.meta.url);
    expect(existsSync(new URL('events/bus.ts', src)), 'Task 19 merged: publish → events/bus.ts (nudge/wiring.ts)').toBe(false);
    expect(existsSync(new URL('push/send.ts', src)), 'Task 19 merged: sendPush → push/send.ts (nudge/wiring.ts)').toBe(false);
  });
});
