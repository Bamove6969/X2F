import { createECDH, randomBytes } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import webpush from 'web-push';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { EventBus } from '../src/events/bus.js';
import { recordFinalAlert } from '../src/events/finalAlert.js';
import { canonicalEndpoint, isPublicAddress, publicOnlyLookup } from '../src/push/endpoint.js';
import { ownerAlertSink, pushOwnerAlert } from '../src/push/ownerAlert.js';
import {
  PUSH_PAYLOADS, PUSH_SUBSCRIPTION_CAP, makeWebPushTransport, pushRequestOptions, type PushCall, type PushTransport,
} from '../src/push/send.js';
import { seedAccount } from './helpers/accounts.js';
import { testApp } from './helpers/app.js';
import { Browser, ORIGIN } from './helpers/totp.js';

const T0 = new Date('2026-10-17T12:00:00Z');
const DAY = 24 * 3600_000;

/** What the fake push service answers next, per endpoint (default 201). */
const answers = new Map<string, number | 'throw'>();
const calls: PushCall[] = [];
const fakeTransport: PushTransport = async (call) => {
  calls.push(call);
  const a = answers.get(call.subscription.endpoint) ?? 201;
  if (a === 'throw') throw Object.assign(new Error(`connect ECONNREFUSED ${call.subscription.endpoint}`), { endpoint: call.subscription.endpoint });
  return { statusCode: a };
};

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let logs: string[];
let step = 0;
let n = 0;
/** Every endpoint and key handed to the API in this file, to grep logs and responses for. */
const secrets: string[] = [];
const bodies: string[] = [];

beforeAll(async () => {
  ({ app, deps, setNow, logs } = await testApp({}, { pushTransport: fakeTransport }));
  app.post('/t/login', async (req, reply) => {
    const { startSession } = await import('../src/auth/sessions.js');
    const b = req.body as { accountId: string; level?: 'full' | 'recovery' };
    return {
      sessionId: await startSession(deps, req, reply, {
        accountId: b.accountId, level: b.level ?? 'full', deviceLabel: 'Test browser', method: 'passkey', firstSession: false,
      }),
    };
  });
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  calls.length = 0;
  answers.clear();
  setNow(new Date(T0.getTime() + ++step * DAY));
});

const errorOf = (res: LightMyRequestResponse) => (res.json() as { error?: string }).error;

async function trader(o: { kind?: 'trader' | 'staff' | 'owner'; level?: 'full' | 'recovery' } = {}) {
  const id = await seedAccount(deps, { loginName: `Pu_${String(++n).padStart(4, '0')}`, ...(o.kind ? { kind: o.kind } : {}) });
  const b = new Browser(app);
  expect((await b.post('/t/login', { accountId: id, ...(o.level ? { level: o.level } : {}) })).statusCode).toBe(200);
  return { id, b };
}

/**
 * The one owner account (migration 109's `one_owner`), seeded once; each test logs it in afresh,
 * because beforeEach moves the clock a day and an owner session lives 12 hours.
 */
let ownerId: Promise<string> | undefined;
async function owner(): Promise<{ id: string; b: Browser }> {
  const id = await (ownerId ??= seedAccount(deps, { loginName: 'Pu_owner', kind: 'owner' }));
  const b = new Browser(app);
  expect((await b.post('/t/login', { accountId: id })).statusCode).toBe(200);
  return { id, b };
}

/** A browser-shaped subscription with a real P-256 key, on an FCM-like endpoint. */
function subscription(host = 'fcm.googleapis.com') {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const s = {
    endpoint: `https://${host}/fcm/send/${randomBytes(24).toString('base64url')}`,
    keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') },
  };
  secrets.push(s.endpoint, s.endpoint.split('/').at(-1)!, s.keys.p256dh, s.keys.auth);
  return s;
}

async function post(b: Browser, body: unknown) {
  const res = await b.post('/v1/account/push', body);
  bodies.push(res.body);
  return res;
}

async function del(b: Browser, body?: unknown) {
  const res = await app.inject({
    method: 'DELETE', url: '/v1/account/push', headers: { origin: ORIGIN }, cookies: b.cookies,
    ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
  });
  bodies.push(res.body);
  return res;
}

async function stored(accountId: string): Promise<string[]> {
  const { rows } = await deps.db.query<{ endpoint: string }>(
    'select endpoint from push_subscriptions where account_id = $1 order by created_at, id', [accountId],
  );
  return rows.map((r) => r.endpoint);
}

describe('POST and DELETE /v1/account/push: who may call', () => {
  it('needs a session', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/account/push', headers: { origin: ORIGIN }, payload: subscription() });
    expect(res.statusCode).toBe(401);
    const d = await app.inject({ method: 'DELETE', url: '/v1/account/push', headers: { origin: ORIGIN } });
    expect(d.statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/v1/account/push' })).statusCode).toBe(401);
  });

  it('refuses recovery sessions and staff accounts', async () => {
    const rec = await trader({ level: 'recovery' });
    expect(errorOf(await post(rec.b, subscription()))).toBe('recovery-session');
    const staff = await trader({ kind: 'staff' });
    expect(errorOf(await post(staff.b, subscription()))).toBe('wrong-account-kind');
  });

  it('the owner may subscribe, read the key and unsubscribe (price-health push, spec 11.6)', async () => {
    const o = await owner();
    expect((await o.b.get('/v1/account/push')).statusCode).toBe(200);
    expect((await post(o.b, subscription())).statusCode).toBe(204);
    expect(await stored(o.id)).toHaveLength(1);
    expect((await del(o.b)).statusCode).toBe(204);
    expect(await stored(o.id)).toEqual([]);
  });
});

describe("the owner's price-health push (review 2026-10-27, Important 3)", () => {
  const ALERT = 'Something needs your attention';
  // What main.ts hands the sink once the app is built: the pool, the clock and `app.push` (here on the fake push service).
  const pushDeps = () => ({ db: deps.db, clock: deps.clock, push: app.push });

  it('an urgent alert sends one generic push per owner subscription, with no detail', async () => {
    const o = await owner();
    await post(o.b, subscription());
    await post(o.b, subscription());
    const detail = { urgent: true as const, currencies: ['EUR'], message: 'EUR market prices paused' };
    await ownerAlertSink(pushDeps())({ kind: 'market-prices-paused', detail });
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.payload)).toEqual([ALERT, ALERT]);
    expect(JSON.stringify(calls)).not.toContain('EUR');
    // The in-app alert is still recorded.
    const { rows } = await deps.db.query<{ detail: unknown }>(
      "select detail from alerts where account_id = $1 and kind = 'market-prices-paused'", [o.id],
    );
    expect(rows).toEqual([{ detail }]);
    await del(o.b);
  });

  it('a failing source pushes too; a recovery or a trader alert kind pushes nothing', async () => {
    const o = await owner();
    await post(o.b, subscription());
    await pushOwnerAlert(pushDeps(), 'price-source-failing');
    expect(calls).toHaveLength(1);
    calls.length = 0;
    for (const kind of ['price-source-recovered', 'market-prices-resumed', 'new-login', 'wallet-added'] as const) {
      await pushOwnerAlert(pushDeps(), kind);
    }
    expect(calls).toEqual([]);
    await del(o.b);
  });

  it('the alert payload is exactly the fixed string', () => {
    expect(PUSH_PAYLOADS.alert).toBe(ALERT);
    expect(Object.keys(PUSH_PAYLOADS).sort()).toEqual(['alert', 'login', 'nudge', 'trade']);
  });
});

describe('POST /v1/account/push', () => {
  it('stores a subscription and answers with nothing that came in', async () => {
    const t = await trader();
    const s = subscription();
    const res = await post(t.b, s);
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(await stored(t.id)).toEqual([s.endpoint]);
  });

  it('the same endpoint twice is one subscription; posted by another account it moves to that account', async () => {
    const a = await trader();
    const b = await trader();
    const s = subscription();
    await post(a.b, s);
    await post(a.b, s);
    expect(await stored(a.id)).toEqual([s.endpoint]);
    expect((await post(b.b, s)).statusCode).toBe(204);
    expect(await stored(a.id)).toEqual([]);
    expect(await stored(b.id)).toEqual([s.endpoint]);
  });

  it(`keeps at most ${PUSH_SUBSCRIPTION_CAP} per account, dropping the oldest`, async () => {
    const t = await trader();
    const subs = [];
    for (let i = 0; i <= PUSH_SUBSCRIPTION_CAP; i++) {
      const s = subscription();
      subs.push(s);
      setNow(new Date(T0.getTime() + step * DAY + i * 1000));
      expect((await post(t.b, s)).statusCode).toBe(204);
    }
    expect(await stored(t.id)).toEqual(subs.slice(1).map((s) => s.endpoint));
  });

  it.each([
    ['plain http', { endpoint: 'http://fcm.googleapis.com/fcm/send/abc' }],
    ['not a URL', { endpoint: 'fcm.googleapis.com/fcm/send/abc' }],
    ['a host that is not a push service', { endpoint: 'https://evil.example/fcm/send/abc' }],
    ['a look-alike host', { endpoint: 'https://fcm.googleapis.com.evil.example/x' }],
    ['an IP address', { endpoint: 'https://127.0.0.1/x' }],
    ['credentials in the URL', { endpoint: 'https://u:p@fcm.googleapis.com/fcm/send/abc' }],
    ['another port', { endpoint: 'https://fcm.googleapis.com:8443/fcm/send/abc' }],
    ['an over-long endpoint', { endpoint: `https://fcm.googleapis.com/${'a'.repeat(2048)}` }],
    // Parser tricks (security review, HIGH): only the canonical WHATWG href of an allowed host passes.
    ['an allowed host as userinfo', { endpoint: 'https://fcm.googleapis.com@evil.example/fcm/send/abc' }],
    ['an allowed host as userinfo, encoded', { endpoint: 'https://fcm.googleapis.com%40evil.example/fcm/send/abc' }],
    ['a backslash before the host', { endpoint: 'https:\\\\fcm.googleapis.com/fcm/send/abc' }],
    ['a backslash after the host', { endpoint: 'https://evil.example\\@fcm.googleapis.com/fcm/send/abc' }],
    ['a backslash in the path', { endpoint: 'https://fcm.googleapis.com\\fcm/send/abc' }],
    ['percent-encoded dots in the host', { endpoint: 'https://fcm%2egoogleapis%2ecom/fcm/send/abc' }],
    ['a percent-encoded host', { endpoint: 'https://%66cm.googleapis.com/fcm/send/abc' }],
    ['an upper-case host', { endpoint: 'https://FCM.googleapis.com/fcm/send/abc' }],
    ['a trailing-dot host', { endpoint: 'https://fcm.googleapis.com./fcm/send/abc' }],
    ['an explicit default port', { endpoint: 'https://fcm.googleapis.com:443/fcm/send/abc' }],
    ['an IPv6 literal', { endpoint: 'https://[::1]/fcm/send/abc' }],
    ['a hex IPv4 literal', { endpoint: 'https://0x7f.0.0.1/fcm/send/abc' }],
    ['a decimal IPv4 literal', { endpoint: 'https://2130706433/fcm/send/abc' }],
    ['a numeric subdomain of an allowed host', { endpoint: 'https://127.0.0.1.fcm.googleapis.com.evil/x' }],
    ['a leading space', { endpoint: ' https://fcm.googleapis.com/fcm/send/abc' }],
    ['a tab inside the host', { endpoint: 'https://fcm.google\tapis.com/fcm/send/abc' }],
    ['a fragment', { endpoint: 'https://fcm.googleapis.com/fcm/send/abc#x' }],
    ['a non-ASCII host', { endpoint: 'https://fcm.googleapis.com\u3002evil.example/x' }],
    ['an empty label', { endpoint: 'https://fcm..googleapis.com/fcm/send/abc' }],
    ['a p256dh that is not a P-256 point', { keys: { p256dh: randomBytes(65).toString('base64url') } }],
    ['a short auth secret', { keys: { auth: randomBytes(8).toString('base64url') } }],
    ['missing keys', { keys: undefined }],
    ['an extra field', { extra: 1 }],
  ])('refuses %s with 400 bad-request', async (_name, change) => {
    const t = await trader();
    const s = subscription();
    const body = {
      ...s, ...change,
      ...('keys' in change ? { keys: change.keys === undefined ? undefined : { ...s.keys, ...change.keys } } : {}),
    };
    const res = await post(t.b, body);
    expect(res.statusCode).toBe(400);
    expect(errorOf(res)).toBe('bad-request');
    expect(await stored(t.id)).toEqual([]);
  });

  it.each(['updates.push.services.mozilla.com', 'web.push.apple.com', 'wns2-by3p.notify.windows.com', 'android.googleapis.com'])(
    'accepts the push service %s',
    async (host) => {
      const t = await trader();
      expect((await post(t.b, subscription(host))).statusCode).toBe(204);
    },
  );

  it('GET gives the VAPID public key and nothing else', async () => {
    const t = await trader();
    await post(t.b, subscription());
    const res = await t.b.get('/v1/account/push');
    bodies.push(res.body);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ vapidPublic: deps.config.vapidPublic });
  });
});

describe('endpoint checks (shared by the routes and the sender)', () => {
  it('stores exactly the canonical href it validated', async () => {
    const t = await trader();
    const s = subscription();
    await post(t.b, s);
    expect(await stored(t.id)).toEqual([new URL(s.endpoint).href]);
  });

  it.each([
    ['https://fcm.googleapis.com/fcm/send/abc', true],
    ['https://wns2-by3p.notify.windows.com/w/?token=BQYAAA%2b%2f', true],
    ['https://fcm.googleapis.com@evil.example/x', false],
    ['https://evil.example/x', false],
    ['https://notify.windows.com.evil/x', false],
    ['https://-bad.notify.windows.com/x', false],
    ['https://fcm.googleapis.com:443/x', false],
  ])('canonicalEndpoint(%s) is allowed: %s', (raw, ok) => {
    const url = canonicalEndpoint(raw);
    expect(url !== null).toBe(ok);
    if (url) expect(url.href).toBe(raw);
  });
});

describe('a subscription lives only as long as the session that posted it (review minor 4)', () => {
  it("logout deletes that browser's subscriptions and no other session's", async () => {
    const t = await trader();
    const other = new Browser(app);
    expect((await other.post('/t/login', { accountId: t.id })).statusCode).toBe(200);
    const mine = subscription();
    const theirs = subscription();
    await post(t.b, mine);
    await post(other, theirs);
    expect((await t.b.post('/v1/logout', {})).statusCode).toBe(200);
    expect(await stored(t.id)).toEqual([theirs.endpoint]);
  });

  it('every revoke path drops them (the trigger): endAllSessions leaves none', async () => {
    const t = await trader();
    await post(t.b, subscription());
    const { endAllSessions } = await import('../src/auth/sessions.js');
    await endAllSessions({ ...deps, events: app.events }, t.id);
    expect(await stored(t.id)).toEqual([]);
  });

  it('an expired session is never pushed to, and its row is deleted at send', async () => {
    const t = await trader();
    await post(t.b, subscription());
    await deps.db.query('update sessions set expires_at = $2 where account_id = $1', [t.id, new Date(0)]);
    expect(await app.push.send(t.id, 'trade')).toBe(false);
    expect(calls).toEqual([]);
    expect(await stored(t.id)).toEqual([]);
  });
});

describe("owner subscriptions belong to the account: an owner who is away still gets the push (re-review I3)", () => {
  const HOUR = 3600_000;
  const owners = async () => {
    const { rows } = await deps.db.query<{ session_id: string | null }>(
      "select p.session_id from push_subscriptions p join accounts a on a.id = p.account_id where a.kind = 'owner'",
    );
    return rows;
  };

  it('subscribe, let the owner session idle out (2 h), fire market-prices-paused: one push is sent', async () => {
    const o = await owner();
    await post(o.b, subscription());
    setNow(new Date(deps.clock().getTime() + 3 * HOUR));
    // The owner's session has idled out: the owner is away.
    expect((await o.b.get('/v1/account/push')).statusCode).toBe(401);
    await pushOwnerAlert({ db: deps.db, push: app.push }, 'market-prices-paused');
    expect(calls.map((c) => c.payload)).toEqual(['Something needs your attention']);
    // The expired session row being purged keeps the subscription (session_id goes null).
    const { purgeExpired } = await import('../src/auth/challenges.js');
    await purgeExpired.run(deps.db, deps.clock());
    expect(await owners()).toEqual([{ session_id: null }]);
    calls.length = 0;
    await pushOwnerAlert({ db: deps.db, push: app.push }, 'market-prices-paused');
    expect(calls).toHaveLength(1);
    // Unsubscribe from a new session drops it.
    const back = await owner();
    expect((await del(back.b)).statusCode).toBe(204);
    expect(await owners()).toEqual([]);
  });

  it("an owner's explicit logout and endAllSessions still drop that browser's subscription", async () => {
    const o = await owner();
    await post(o.b, subscription());
    expect((await o.b.post('/v1/logout', {})).statusCode).toBe(200);
    expect(await owners()).toEqual([]);
    const o2 = await owner();
    await post(o2.b, subscription());
    const { endAllSessions } = await import('../src/auth/sessions.js');
    await endAllSessions({ ...deps, events: app.events }, o2.id);
    expect(await owners()).toEqual([]);
  });

  it('an orphaned owner row (its session purged) goes on "log out everywhere" from another browser (round 3)', async () => {
    const a = await owner();
    await post(a.b, subscription());
    setNow(new Date(deps.clock().getTime() + 3 * HOUR));
    const { purgeExpired } = await import('../src/auth/challenges.js');
    await purgeExpired.run(deps.db, deps.clock());
    expect(await owners()).toEqual([{ session_id: null }]);
    const b = await owner();
    const { endAllSessions } = await import('../src/auth/sessions.js');
    await endAllSessions({ ...deps, events: app.events }, b.id);
    expect(await owners()).toEqual([]);
  });

  it('disabling the account drops its orphaned owner rows (round 3)', async () => {
    const a = await owner();
    await post(a.b, subscription());
    setNow(new Date(deps.clock().getTime() + 3 * HOUR));
    const { purgeExpired } = await import('../src/auth/challenges.js');
    await purgeExpired.run(deps.db, deps.clock());
    expect(await owners()).toEqual([{ session_id: null }]);
    await deps.db.query('update accounts set disabled_at = $2 where id = $1', [a.id, deps.clock()]);
    try {
      expect(await owners()).toEqual([]);
    } finally {
      await deps.db.query('update accounts set disabled_at = null where id = $1', [a.id]);
    }
  });

  it("a trader's subscription still goes with its session when the session row is purged", async () => {
    const t = await trader();
    await post(t.b, subscription());
    await deps.db.query('delete from sessions where account_id = $1', [t.id]);
    expect(await stored(t.id)).toEqual([]);
  });
});

describe('DELETE /v1/account/push', () => {
  it("with an endpoint removes that subscription, and never another account's", async () => {
    const a = await trader();
    const b = await trader();
    const sa = subscription();
    const sa2 = subscription();
    const sb = subscription();
    await post(a.b, sa);
    await post(a.b, sa2);
    await post(b.b, sb);
    expect((await del(a.b, { endpoint: sb.endpoint })).statusCode).toBe(204);
    expect(await stored(b.id)).toEqual([sb.endpoint]);
    expect((await del(a.b, { endpoint: sa.endpoint })).statusCode).toBe(204);
    expect(await stored(a.id)).toEqual([sa2.endpoint]);
  });

  it("with no body removes all of the caller's subscriptions", async () => {
    const a = await trader();
    const b = await trader();
    await post(a.b, subscription());
    await post(a.b, subscription());
    const sb = subscription();
    await post(b.b, sb);
    expect((await del(a.b)).statusCode).toBe(204);
    expect(await stored(a.id)).toEqual([]);
    expect(await stored(b.id)).toEqual([sb.endpoint]);
  });
});

describe('sendPush', () => {
  it('sends exactly the fixed text for each kind, with VAPID from config, to each subscription', async () => {
    const t = await trader();
    const s1 = subscription();
    const s2 = subscription('updates.push.services.mozilla.com');
    await post(t.b, s1);
    await post(t.b, s2);
    expect(await app.push.send(t.id, 'nudge')).toBe(true);
    expect(calls.map((c) => c.payload)).toEqual(['Someone nudged you on X2F', 'Someone nudged you on X2F']);
    expect(calls.map((c) => c.subscription.endpoint).sort()).toEqual([s1.endpoint, s2.endpoint].sort());
    expect(calls[0]!.subscription.keys).toEqual(s1.endpoint === calls[0]!.subscription.endpoint ? s1.keys : s2.keys);
    expect(calls[0]!.options.vapidDetails).toEqual({
      subject: ORIGIN, publicKey: deps.config.vapidPublic, privateKey: deps.config.vapidPrivate,
    });
    calls.length = 0;
    expect(await app.push.send(t.id, 'trade')).toBe(true);
    expect(calls.map((c) => c.payload)).toEqual(['Something changed in a trade on X2F', 'Something changed in a trade on X2F']);
  });

  it('the four payloads are exactly the fixed strings: no code, amount, name, detail or URL', () => {
    expect(PUSH_PAYLOADS).toEqual({
      nudge: 'Someone nudged you on X2F', trade: 'Something changed in a trade on X2F', alert: 'Something needs your attention',
      // Plan 2 Task 16: a new device asks to log in.
      login: 'Someone is logging in. Is this you?',
    });
  });

  it('is false with no subscription, and false when no push service answered 201', async () => {
    const t = await trader();
    expect(await app.push.send(t.id, 'trade')).toBe(false);
    expect(calls).toEqual([]);
    const s = subscription();
    await post(t.b, s);
    answers.set(s.endpoint, 500);
    expect(await app.push.send(t.id, 'trade')).toBe(false);
    answers.set(s.endpoint, 'throw');
    expect(await app.push.send(t.id, 'trade')).toBe(false);
    // Neither a 500 nor a network error drops the subscription.
    expect(await stored(t.id)).toEqual([s.endpoint]);
  });

  it('a push service 410 or 404 deletes that subscription; the others stay', async () => {
    const t = await trader();
    const gone = subscription();
    const missing = subscription();
    const fine = subscription();
    for (const s of [gone, missing, fine]) await post(t.b, s);
    answers.set(gone.endpoint, 410);
    answers.set(missing.endpoint, 404);
    expect(await app.push.send(t.id, 'trade')).toBe(true);
    expect(await stored(t.id)).toEqual([fine.endpoint]);
  });

  it('re-checks every stored endpoint before sending: a bad row is never sent to and is deleted', async () => {
    const t = await trader();
    const good = subscription();
    await post(t.b, good);
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    const bad = ['https://127.0.0.1/x', 'https://fcm.googleapis.com@evil.example/x', 'http://fcm.googleapis.com/x', 'https://evil.example/x'];
    for (const endpoint of bad) {
      secrets.push(endpoint);
      await deps.db.query(
        `insert into push_subscriptions (account_id, session_id, endpoint, p256dh, auth, created_at)
         select $1, id, $2, $3, $4, $5 from sessions where account_id = $1 and revoked_at is null limit 1`,
        [t.id, endpoint, ecdh.getPublicKey().toString('base64url'), randomBytes(16).toString('base64url'), new Date()],
      );
    }
    expect(await app.push.send(t.id, 'trade')).toBe(true);
    expect(calls.map((c) => c.subscription.endpoint)).toEqual([good.endpoint]);
    expect(await stored(t.id)).toEqual([good.endpoint]);
  });

  it('builds a real encrypted Web Push request: VAPID from config, aes128gcm, no plaintext in the body', async () => {
    const s = subscription();
    const options = pushRequestOptions(deps.config);
    const details = webpush.generateRequestDetails(s, PUSH_PAYLOADS.trade, options);
    expect(details.endpoint).toBe(s.endpoint);
    expect(details.headers['Content-Encoding']).toBe('aes128gcm');
    expect(String(details.headers.Authorization)).toContain(`k=${deps.config.vapidPublic}`);
    expect(Buffer.from(details.body!).toString('utf8')).not.toContain('X2F');
  });
});

describe('the real transport refuses non-public addresses', () => {
  it.each([
    ['127.0.0.1', false], ['10.1.2.3', false], ['172.16.0.1', false], ['192.168.1.1', false], ['169.254.169.254', false],
    ['100.64.0.1', false], ['0.0.0.0', false], ['224.0.0.1', false], ['::1', false], ['::', false], ['fe80::1', false],
    ['fd00::1', false], ['::ffff:127.0.0.1', false], ['::ffff:10.0.0.1', false], ['64:ff9b::7f00:1', false],
    ['142.250.180.10', true], ['2a00:1450:4001:80b::200a', true],
  ])('isPublicAddress(%s) is %s', (ip, ok) => {
    expect(isPublicAddress(ip)).toBe(ok);
  });

  type Addr = { address: string; family: number };
  const fakeDns = (answer: Addr[]) =>
    ((_h: string, _o: unknown, cb: (e: Error | null, a: Addr[]) => void) => cb(null, answer)) as never;

  it('a host that resolves to any private address is refused; a public one is passed on', async () => {
    const refuse = await new Promise<Error | null>((done) =>
      publicOnlyLookup(fakeDns([{ address: '142.250.180.10', family: 4 }, { address: '10.0.0.5', family: 4 }]))(
        'fcm.googleapis.com', {}, (e) => done(e)),
    );
    expect(refuse?.message).toBe('push: refused address');
    const one = await new Promise<[Error | null, unknown, unknown]>((done) =>
      publicOnlyLookup(fakeDns([{ address: '142.250.180.10', family: 4 }]))('fcm.googleapis.com', {}, (e, a, f) => done([e, a, f])),
    );
    expect(one).toEqual([null, '142.250.180.10', 4]);
    const all = await new Promise<[Error | null, unknown]>((done) =>
      publicOnlyLookup(fakeDns([{ address: '142.250.180.10', family: 4 }]))('fcm.googleapis.com', { all: true }, (e, a) => done([e, a])),
    );
    expect(all).toEqual([null, [{ address: '142.250.180.10', family: 4 }]]);
  });

  it('webPushTransport never connects to an allowed host that resolves to loopback', async () => {
    const s = subscription();
    const asked: string[] = [];
    const send = makeWebPushTransport(((h: string, _o: unknown, cb: (e: Error | null, a: Addr[]) => void) => {
      asked.push(h);
      cb(null, [{ address: '127.0.0.1', family: 4 }]);
    }) as never);
    await expect(send({ subscription: s, payload: PUSH_PAYLOADS.trade, options: pushRequestOptions(deps.config) })).rejects.toThrow(
      'push: network error',
    );
    expect(asked).toEqual([new URL(s.endpoint).hostname]);
  });

  it('webPushTransport refuses an endpoint that fails the checks, before any lookup', async () => {
    let looked = false;
    const send = makeWebPushTransport(((_h: string, _o: unknown, cb: (e: Error | null, a: Addr[]) => void) => {
      looked = true;
      cb(null, [{ address: '142.250.180.10', family: 4 }]);
    }) as never);
    const s = { ...subscription(), endpoint: 'https://fcm.googleapis.com@evil.example/x' };
    await expect(send({ subscription: s, payload: PUSH_PAYLOADS.trade, options: pushRequestOptions(deps.config) })).rejects.toThrow(
      'push: invalid endpoint',
    );
    expect(looked).toBe(false);
  });
});

describe('recordFinalAlert (request-refund; wired in by Task 6/10)', () => {
  const CODE = 'X2F-REFD-0001';

  it('is false with no stream and no subscription', async () => {
    const t = await trader();
    expect(await recordFinalAlert(app, CODE, t.id)).toBe(false);
  });

  it('is true with an open stream and no subscription, and publishes the trade event to the buyer only', async () => {
    const buyer = await trader();
    const seller = await trader();
    const bus = new EventBus({ perAccount: 2, global: 10 });
    const got: Record<string, string[]> = { buyer: [], seller: [] };
    bus.attach(buyer.id, { send: (d) => void got.buyer!.push(d), close: () => undefined });
    bus.attach(seller.id, { send: (d) => void got.seller!.push(d), close: () => undefined });
    expect(await recordFinalAlert({ events: bus, push: app.push }, CODE, buyer.id)).toBe(true);
    expect(got.buyer!.map((f) => JSON.parse(f.slice(6)))).toEqual([{ type: 'trade', code: CODE, state: 'refund_requested' }]);
    expect(got.seller).toEqual([]);
  });

  it('is true with no stream when a push service accepted the push (201), and pushes the trade text', async () => {
    const t = await trader();
    await post(t.b, subscription());
    expect(await recordFinalAlert(app, CODE, t.id)).toBe(true);
    expect(calls.map((c) => c.payload)).toEqual([PUSH_PAYLOADS.trade]);
  });

  it('is false when the only push service refused', async () => {
    const t = await trader();
    const s = subscription();
    await post(t.b, s);
    answers.set(s.endpoint, 410);
    expect(await recordFinalAlert(app, CODE, t.id)).toBe(false);
  });

  it.todo('Task 10: the API records final_alert_delivered from recordFinalAlert on request-refund and reports it to moderation');
});

describe('privacy', () => {
  it('no endpoint or key ever appears in a log line or a response', async () => {
    // Runs last: covers every request and push made above, failures included.
    const t = await trader();
    const s = subscription();
    await post(t.b, s);
    answers.set(s.endpoint, 'throw');
    await app.push.send(t.id, 'trade');
    answers.set(s.endpoint, 500);
    await app.push.send(t.id, 'trade');
    expect(logs.length).toBeGreaterThan(0);
    const all = logs.join('\n') + bodies.join('\n');
    for (const secret of secrets) expect(all).not.toContain(secret);
    expect(all).not.toContain('fcm/send');
  });
});
