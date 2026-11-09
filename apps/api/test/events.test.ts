import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { UNCHOSEN_SESSION_HOURS } from '@x2f/accounts';
import type { Deps } from '../src/app.js';
import { EventBus, type LiveEvent } from '../src/events/bus.js';
import { PUBLIC_NAME_COLUMN, acceptedEvent, publicName } from '../src/events/publicName.js';
import { SECURITY_HEADERS } from '../src/static/serve.js';
import { seedAccount } from './helpers/accounts.js';
import { testApp } from './helpers/app.js';
import { openEvents, until, type SseStream } from './helpers/sse.js';
import { Browser, ORIGIN } from './helpers/totp.js';

const T0 = new Date('2026-10-17T12:00:00Z');
const DAY = 24 * 3600_000;
const CODE = 'X2F-7KQ4-M9TD';

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let logs: string[];
let step = 0;
let n = 0;
const open: SseStream[] = [];
/** Runs inside GET /v1/events between attach and the session re-check (the TOCTOU window). */
let afterAttach: () => Promise<void> = async () => undefined;

beforeAll(async () => {
  ({ app, deps, setNow, logs } = await testApp({}, {
    events: { perAccount: 2, global: 4, heartbeatMs: 40, maxStreamMs: 60_000, afterAttach: () => afterAttach() },
  }));
  app.post('/t/login', async (req, reply) => {
    const { startSession } = await import('../src/auth/sessions.js');
    const b = req.body as { accountId: string; level?: 'full' | 'recovery'; holdUntil?: string };
    const sessionId = await startSession(deps, req, reply, {
      accountId: b.accountId, level: b.level ?? 'full', deviceLabel: 'Test browser', method: 'passkey', firstSession: false,
      ...(b.holdUntil ? { holdUntil: new Date(b.holdUntil) } : {}),
    });
    return { sessionId };
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
});

afterAll(async () => {
  for (const s of open) s.close();
  await app.close();
});

beforeEach(async () => {
  afterAttach = async () => undefined;
  for (const s of open.splice(0)) s.close();
  await until(() => app.events.size === 0);
  setNow(new Date(T0.getTime() + ++step * DAY));
});

const errorOf = (res: LightMyRequestResponse) => (res.json() as { error?: string }).error;

async function trader(o: { kind?: 'trader' | 'staff'; level?: 'full' | 'recovery'; holdUntil?: Date; termsVersion?: string } = {}) {
  const displayName = `Ev_${String(++n).padStart(4, '0')}`;
  const id = await seedAccount(deps, {
    loginName: `${displayName}.lg`, displayName, ...(o.kind ? { kind: o.kind } : {}), ...(o.termsVersion ? { termsVersion: o.termsVersion } : {}),
  });
  const b = new Browser(app);
  const res = await b.post('/t/login', {
    accountId: id, ...(o.level ? { level: o.level } : {}), ...(o.holdUntil ? { holdUntil: o.holdUntil.toISOString() } : {}),
  });
  expect(res.statusCode).toBe(200);
  return { id, b, displayName };
}

async function stream(b: Browser): Promise<SseStream> {
  const s = await openEvents(app, b.cookies);
  open.push(s);
  return s;
}

const accepted = (code = CODE): LiveEvent => ({ type: 'accepted', code, by: 'mira.k' });

describe('EventBus', () => {
  const sink = () => {
    const got: string[] = [];
    return { got, send: (d: string) => void got.push(d), close: () => undefined };
  };

  it('delivers only to the named account and counts the streams written', () => {
    const bus = new EventBus({ perAccount: 3, global: 10 });
    const a1 = sink();
    const a2 = sink();
    const b1 = sink();
    bus.attach('a', a1);
    bus.attach('a', a2);
    bus.attach('b', b1);
    expect(bus.publish('a', accepted())).toBe(2);
    expect(a1.got).toHaveLength(1);
    expect(a2.got).toHaveLength(1);
    expect(b1.got).toEqual([]);
    expect(bus.publish('nobody', accepted())).toBe(0);
  });

  it('delivered() is true only while the account has an open stream', () => {
    const bus = new EventBus({ perAccount: 3, global: 10 });
    expect(bus.delivered('a')).toBe(false);
    const detach = bus.attach('a', sink())!;
    expect(bus.delivered('a')).toBe(true);
    expect(bus.delivered('b')).toBe(false);
    detach();
    expect(bus.delivered('a')).toBe(false);
    expect(bus.size).toBe(0);
  });

  it('refuses a stream past the per-account cap and past the global cap', () => {
    const bus = new EventBus({ perAccount: 2, global: 3 });
    expect(bus.attach('a', sink())).not.toBeNull();
    const second = bus.attach('a', sink());
    expect(second).not.toBeNull();
    expect(bus.attach('a', sink())).toBeNull();
    expect(bus.attach('b', sink())).not.toBeNull();
    expect(bus.attach('c', sink())).toBeNull();
    second!();
    expect(bus.attach('c', sink())).not.toBeNull();
  });

  it('a sink that throws is dropped and does not stop the others', () => {
    const bus = new EventBus({ perAccount: 3, global: 10 });
    const good = sink();
    let closed = false;
    bus.attach('a', { send: () => { throw new Error('socket gone'); }, close: () => void (closed = true) });
    bus.attach('a', good);
    expect(bus.publish('a', accepted())).toBe(1);
    expect(good.got).toHaveLength(1);
    expect(closed).toBe(true);
    expect(bus.size).toBe(1);
  });

  it('serialises each event as one SSE data line, so names cannot inject fields', () => {
    const bus = new EventBus({ perAccount: 1, global: 1 });
    const s = sink();
    bus.attach('a', s);
    bus.publish('a', { type: 'accepted', code: CODE, by: 'x\n\ndata: {"type":"evil"}' });
    expect(s.got).toHaveLength(1);
    const frame = s.got[0]!;
    expect(frame.endsWith('\n\n')).toBe(true);
    expect(frame.slice(0, -2)).not.toContain('\n');
    expect(JSON.parse(frame.slice('data: '.length))).toEqual({ type: 'accepted', code: CODE, by: 'x\n\ndata: {"type":"evil"}' });
  });
});

describe('GET /v1/events: who may open a stream', () => {
  it('needs a session', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/events' });
    expect(res.statusCode).toBe(401);
    expect(errorOf(res)).toBe('not-authenticated');
  });

  it('refuses a recovery session, held or not', async () => {
    const plain = await trader({ level: 'recovery' });
    const held = await trader({ level: 'recovery', holdUntil: new Date(T0.getTime() + 400 * DAY) });
    for (const t of [plain, held]) {
      const res = await t.b.get('/v1/events');
      expect(res.statusCode).toBe(403);
      expect(errorOf(res)).toBe('recovery-session');
    }
  });

  it('refuses staff accounts and traders on stale Terms', async () => {
    const staff = await trader({ kind: 'staff' });
    expect(errorOf(await staff.b.get('/v1/events'))).toBe('wrong-account-kind');
    const stale = await trader({ termsVersion: '2020-01-01' });
    expect(errorOf(await stale.b.get('/v1/events'))).toBe('terms-required');
  });
});

describe('GET /v1/events: the stream', () => {
  it('answers text/event-stream with no caching and the security headers', async () => {
    const a = await trader();
    const s = await stream(a.b);
    expect(s.status).toBe(200);
    expect(s.headers['content-type']).toBe('text/event-stream; charset=utf-8');
    expect(s.headers['cache-control']).toBe('no-store');
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(s.headers[k]).toBe(v);
  });

  it('delivers accepted to the poster within 1 s and never to a third account (P3-M9)', async () => {
    const poster = await trader();
    const other = await trader();
    const sp = await stream(poster.b);
    const so = await stream(other.b);
    await until(() => app.events.delivered(poster.id) && app.events.delivered(other.id));
    const t = Date.now();
    expect(app.events.publish(poster.id, accepted())).toBe(1);
    expect(await sp.waitFor((e) => (e as LiveEvent).type === 'accepted', 1000)).toEqual(accepted());
    expect(Date.now() - t).toBeLessThan(1000);
    // A heartbeat or two later, the other account still has no event.
    await so.waitForRaw((c) => c.startsWith(':'), 1000);
    expect(so.events).toEqual([]);
  });

  it("each of an account's streams gets its events; another account's events never arrive", async () => {
    const a = await trader();
    const b = await trader();
    const a1 = await stream(a.b);
    const a2 = await stream(a.b);
    const b1 = await stream(b.b);
    await until(() => app.events.size === 3);
    app.events.publish(b.id, { type: 'trade', code: 'X2F-BBBB-BBBB', state: 'funding' });
    app.events.publish(a.id, { type: 'trade', code: CODE, state: 'secured' });
    for (const s of [a1, a2]) {
      await s.waitFor((e) => (e as { code?: string }).code === CODE);
      expect(s.events).toEqual([{ type: 'trade', code: CODE, state: 'secured' }]);
    }
    await b1.waitFor((e) => (e as { code?: string }).code === 'X2F-BBBB-BBBB');
    expect(b1.events).toEqual([{ type: 'trade', code: 'X2F-BBBB-BBBB', state: 'funding' }]);
  });

  it('sends heartbeat comments', async () => {
    const a = await trader();
    const s = await stream(a.b);
    await s.waitForRaw((c) => c.startsWith(':'), 1000);
  });

  it('enforces the per-account cap with 429 busy, and frees the slot when a stream closes', async () => {
    const a = await trader();
    const s1 = await stream(a.b);
    await stream(a.b);
    const third = await stream(a.b);
    expect(third.status).toBe(429);
    expect(third.body).toEqual({ error: 'busy' });
    s1.close();
    await until(() => app.events.size === 1);
    expect((await stream(a.b)).status).toBe(200);
  });

  it('enforces the global cap', async () => {
    const ts = await Promise.all([trader(), trader(), trader()]);
    await stream(ts[0]!.b);
    await stream(ts[0]!.b);
    await stream(ts[1]!.b);
    await stream(ts[1]!.b);
    const refused = await stream(ts[2]!.b);
    expect(refused.status).toBe(429);
    expect(refused.body).toEqual({ error: 'busy' });
  });

  it('cleans up on close: delivered() turns false and publish reaches no one', async () => {
    const a = await trader();
    const s = await stream(a.b);
    await until(() => app.events.delivered(a.id));
    s.close();
    await until(() => !app.events.delivered(a.id));
    expect(app.events.publish(a.id, accepted())).toBe(0);
  });

  it('the server ends a stream after maxStreamMs, so the client reconnects and its session is checked again', async () => {
    const short = await testApp({}, { events: { perAccount: 2, global: 4, heartbeatMs: 1000, maxStreamMs: 80 } });
    try {
      const id = await seedAccount(short.deps, { loginName: 'Ev_short.lg', displayName: 'Ev_short' });
      const { startSession } = await import('../src/auth/sessions.js');
      short.app.post('/t/login', async (req, reply) => ({
        sessionId: await startSession(short.deps, req, reply, {
          accountId: id, level: 'full', deviceLabel: 'Test', method: 'passkey', firstSession: false,
        }),
      }));
      await short.app.listen({ host: '127.0.0.1', port: 0 });
      const b = new Browser(short.app);
      await b.post('/t/login');
      const s = await openEvents(short.app, b.cookies);
      expect(s.status).toBe(200);
      await s.ended;
      await until(() => short.app.events.size === 0);
    } finally {
      await short.app.close();
    }
  });

  it('closing the app ends open streams', async () => {
    const other = await testApp({}, { events: { perAccount: 2, global: 4, heartbeatMs: 1000, maxStreamMs: 60_000 } });
    const id = await seedAccount(other.deps, { loginName: 'Ev_close.lg', displayName: 'Ev_close' });
    const { startSession } = await import('../src/auth/sessions.js');
    other.app.post('/t/login', async (req, reply) => ({
      sessionId: await startSession(other.deps, req, reply, {
        accountId: id, level: 'full', deviceLabel: 'Test', method: 'passkey', firstSession: false,
      }),
    }));
    await other.app.listen({ host: '127.0.0.1', port: 0 });
    const b = new Browser(other.app);
    await b.post('/t/login');
    const s = await openEvents(other.app, b.cookies);
    expect(s.status).toBe(200);
    await other.app.close();
    await s.ended;
  });

  it('logs nothing about a stream or its events (no trade code, no account id)', async () => {
    const a = await trader();
    const s = await stream(a.b);
    app.events.publish(a.id, accepted('X2F-LOGS-TEST'));
    await s.waitFor((e) => (e as { code?: string }).code === 'X2F-LOGS-TEST');
    s.close();
    await until(() => !app.events.delivered(a.id));
    const all = logs.join('\n');
    expect(all).not.toContain('X2F-LOGS-TEST');
    expect(all).not.toContain(a.id);
  });
});

describe('public names in events', () => {
  it('events name an account only by its public display name', async () => {
    const a = await trader();
    expect(await publicName(deps.db, a.id)).toBe(a.displayName);
    expect(await acceptedEvent(deps.db, CODE, a.id)).toEqual({ type: 'accepted', code: CODE, by: a.displayName });
  });

  it('an unknown account has no name', async () => {
    expect(await publicName(deps.db, '00000000-0000-4000-8000-000000000000')).toBeNull();
  });

  // FU-A (migration 009) renamed accounts.username to display_name and added a private login_name:
  // PUBLIC_NAME_COLUMN must be the display name, never the login name.
  it('reads the public-name column that exists in the schema (display_name since FU-A)', async () => {
    const { rows } = await deps.db.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'accounts' and column_name in ('username', 'display_name')",
    );
    expect(rows.map((r) => r.column_name)).toEqual([PUBLIC_NAME_COLUMN]);
    expect(PUBLIC_NAME_COLUMN).not.toMatch(/login/);
  });
});

describe('ending sessions ends their streams (review minor 3)', () => {
  const sink = () => {
    const s = { closed: false, send: () => undefined, close: () => void (s.closed = true) };
    return s;
  };

  it('bus.closeAccount ends every stream of the account, sparing `keep`; closeSession only that session', () => {
    const bus = new EventBus({ perAccount: 5, global: 10 });
    const [a1, a2, a3, b1] = [sink(), sink(), sink(), sink()];
    bus.attach('a', a1, 's1');
    bus.attach('a', a2, 's2');
    bus.attach('a', a3, 's2');
    bus.attach('b', b1, 's9');
    expect(bus.closeSession('a', 's1')).toBe(1);
    expect([a1.closed, a2.closed, a3.closed]).toEqual([true, false, false]);
    expect(bus.closeAccount('a', 's2')).toBe(0);
    expect(bus.closeAccount('a')).toBe(2);
    expect([a2.closed, a3.closed, b1.closed]).toEqual([true, true, false]);
    expect(bus.size).toBe(1);
    expect(bus.delivered('a')).toBe(false);
    expect(bus.closeAccount('nobody')).toBe(0);
  });

  it("POST /v1/logout ends that session's streams at once and no other session's", async () => {
    const t = await trader();
    const other = new Browser(app);
    expect((await other.post('/t/login', { accountId: t.id })).statusCode).toBe(200);
    const mine = await stream(t.b);
    const theirs = await stream(other);
    expect(app.events.size).toBe(2);
    expect((await t.b.post('/v1/logout', {})).statusCode).toBe(200);
    await mine.ended;
    expect(app.events.size).toBe(1);
    expect(app.events.publish(t.id, accepted())).toBe(1);
    await theirs.waitFor((e) => (e as { type?: string }).type === 'accepted');
  });

  it('endAllSessions (log out everywhere, disable) ends every stream of the account', async () => {
    const t = await trader();
    const u = await trader();
    const other = new Browser(app);
    await other.post('/t/login', { accountId: t.id });
    const s1 = await stream(t.b);
    const s2 = await stream(other);
    await stream(u.b);
    const { endAllSessions } = await import('../src/auth/sessions.js');
    expect(await endAllSessions({ ...deps, events: app.events }, t.id)).toBe(2);
    await Promise.all([s1.ended, s2.ended]);
    expect(app.events.size).toBe(1);
    expect(app.events.delivered(u.id)).toBe(true);
  });

  it('DELETE /v1/account/sessions/:id ends that session\'s streams at once', async () => {
    const t = await trader();
    const other = new Browser(app);
    const id = ((await other.post('/t/login', { accountId: t.id })).json() as { sessionId: string }).sessionId;
    const keep = await stream(t.b);
    const gone = await stream(other);
    const res = await app.inject({ method: 'DELETE', url: `/v1/account/sessions/${id}`, headers: { origin: ORIGIN }, cookies: t.b.cookies });
    expect(res.statusCode).toBe(204);
    await gone.ended;
    expect(app.events.size).toBe(1);
    expect(app.events.publish(t.id, accepted())).toBe(1);
    await keep.waitFor((e) => (e as { type?: string }).type === 'accepted');
  });

  it('endOtherSessions (password change, method removal) keeps the current session streaming', async () => {
    const t = await trader();
    const other = new Browser(app);
    const res = await other.post('/t/login', { accountId: t.id });
    const keep = (res.json() as { sessionId: string }).sessionId;
    const gone = await stream(t.b);
    await stream(other);
    const { endOtherSessions } = await import('../src/auth/sessions.js');
    expect(await endOtherSessions({ ...deps, events: app.events }, t.id, keep)).toBe(1);
    await gone.ended;
    expect(app.events.size).toBe(1);
    expect(app.events.delivered(t.id)).toBe(true);
  });
});

describe('a session revoked between requireTrader and attach (security review MEDIUM, TOCTOU)', () => {
  it('gets no stream: 401, the slot is freed, and nothing is delivered', async () => {
    const t = await trader();
    // A revoke whose closeSession ran before this stream was attached (so it closed nothing).
    afterAttach = async () => {
      await deps.db.query('update sessions set revoked_at = $2 where account_id = $1', [t.id, deps.clock()]);
    };
    const s = await stream(t.b);
    expect(s.status).toBe(401);
    expect(s.body).toEqual({ error: 'not-authenticated' });
    await until(() => app.events.size === 0);
    expect(app.events.publish(t.id, accepted())).toBe(0);
  });

  it('an expired session in that window is refused the same way', async () => {
    const t = await trader();
    afterAttach = async () => {
      await deps.db.query('update sessions set expires_at = $2 where account_id = $1', [t.id, new Date(0)]);
    };
    const s = await stream(t.b);
    expect(s.status).toBe(401);
    expect(app.events.size).toBe(0);
  });

  it('a closeSession that lands during the re-check also ends it with 401', async () => {
    const t = await trader();
    const sessionId = (await deps.db.query<{ id: string }>('select id from sessions where account_id = $1', [t.id])).rows[0]!.id;
    afterAttach = async () => {
      app.events.closeSession(t.id, sessionId);
    };
    const s = await stream(t.b);
    expect(s.status).toBe(401);
    expect(app.events.size).toBe(0);
  });

  it('a session shortened in that window ends the stream at the new, earlier end (review S-m2)', async () => {
    const t = await trader();
    // `PUT session/length` shortened the session (its closeSession found nothing to close yet): the
    // stream must not live on to the old end that requireTrader read.
    afterAttach = async () => {
      await deps.db.query('update sessions set expires_at = $2 where account_id = $1', [t.id, new Date(deps.clock().getTime() + 200)]);
    };
    const s = await stream(t.b);
    expect(s.status).toBe(200);
    const started = Date.now();
    await Promise.race([s.ended, new Promise((_, fail) => setTimeout(() => fail(new Error('stream outlived the shortened session')), 2000))]);
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('an event published before the headers go out is delivered after them, in order', async () => {
    const t = await trader();
    afterAttach = async () => {
      app.events.publish(t.id, accepted('X2F-AAAA-AAAA'));
      app.events.publish(t.id, accepted('X2F-BBBB-BBBB'));
    };
    const s = await stream(t.b);
    expect(s.status).toBe(200);
    await s.waitFor((e) => (e as { code?: string }).code === 'X2F-BBBB-BBBB');
    expect(s.events.map((e) => (e as { code: string }).code)).toEqual(['X2F-AAAA-AAAA', 'X2F-BBBB-BBBB']);
  });
});

describe('GET /v1/events never refreshes the session (review 2026-10-27, Important 1)', () => {
  const HOUR = 3600_000;

  /** An app whose streams end fast, with a trader whose session length is not chosen yet (UNCHOSEN_SESSION_HOURS). */
  async function shortApp(maxStreamMs: number, loginAt: Date) {
    const short = await testApp({}, { events: { perAccount: 2, global: 4, heartbeatMs: 1000, maxStreamMs } });
    short.setNow(loginAt);
    const id = await seedAccount(short.deps, { loginName: `Ev_idle_${maxStreamMs}.lg`, displayName: `Ev_idle_${maxStreamMs}` });
    const { startSession } = await import('../src/auth/sessions.js');
    short.app.post('/t/login', async (req, reply) => ({
      sessionId: await startSession(short.deps, req, reply, {
        accountId: id, level: 'full', deviceLabel: 'Test', method: 'passkey', firstSession: false,
      }),
    }));
    await short.app.listen({ host: '127.0.0.1', port: 0 });
    const b = new Browser(short.app);
    await b.post('/t/login');
    const session = async () => {
      const { rows } = await short.deps.db.query<{ last_seen_at: Date; expires_at: Date }>(
        'select last_seen_at, expires_at from sessions where account_id = $1', [id],
      );
      return rows[0]!;
    };
    return { ...short, b, session };
  }

  it('an open stream reconnecting until past the session length still ends with an expired session', async () => {
    const start = new Date(T0.getTime() + 500 * DAY);
    const short = await shortApp(80, start);
    try {
      const before = await short.session();
      // Session length (owner, 2 Nov 2026): the session ends UNCHOSEN_SESSION_HOURS after the login.
      // At hour 0 and just before the end the tab is open and reconnecting; the user touches nothing.
      for (const hours of [0, UNCHOSEN_SESSION_HOURS - 0.25]) {
        short.setNow(new Date(start.getTime() + hours * HOUR));
        const s = await openEvents(short.app, short.b.cookies);
        expect(s.status, `hour ${hours}`).toBe(200);
        await s.ended;
        await until(() => short.app.events.size === 0);
      }
      // No stream touched the session: last_seen_at and expires_at are what the login wrote.
      expect(await short.session()).toEqual(before);
      // Past the session's end the reconnect is refused and nothing else revives it.
      short.setNow(new Date(start.getTime() + (UNCHOSEN_SESSION_HOURS + 1) * HOUR));
      const s = await openEvents(short.app, short.b.cookies);
      expect(s.status).toBe(401);
      expect(s.body).toEqual({ error: 'not-authenticated' });
      expect((await short.b.get('/v1/account/me')).statusCode).toBe(401);
    } finally {
      await short.app.close();
    }
  });

  it("a stream ends at the session's end when that comes before maxStreamMs", async () => {
    const short = await shortApp(60_000, new Date(T0.getTime() + 501 * DAY));
    try {
      const { expires_at } = await short.session();
      // 150 ms before the deadline the stream opens; it must end at the deadline, not a minute later.
      short.setNow(new Date(expires_at.getTime() - 150));
      const s = await openEvents(short.app, short.b.cookies);
      expect(s.status).toBe(200);
      const t = Date.now();
      await Promise.race([s.ended, new Promise((_, fail) => setTimeout(() => fail(new Error('stream outlived the session end')), 2000))]);
      expect(Date.now() - t).toBeLessThan(1500);
    } finally {
      await short.app.close();
    }
  });
});
