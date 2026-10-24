import { createECDH, randomBytes } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import webpush from 'web-push';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { EventBus } from '../src/events/bus.js';
import { recordFinalAlert } from '../src/events/finalAlert.js';
import {
  PUSH_PAYLOADS, PUSH_SUBSCRIPTION_CAP, pushRequestOptions, type PushCall, type PushTransport,
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

async function trader(o: { kind?: 'trader' | 'staff'; level?: 'full' | 'recovery' } = {}) {
  const id = await seedAccount(deps, { username: `Pu_${String(++n).padStart(4, '0')}`, ...(o.kind ? { kind: o.kind } : {}) });
  const b = new Browser(app);
  expect((await b.post('/t/login', { accountId: id, ...(o.level ? { level: o.level } : {}) })).statusCode).toBe(200);
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

  it('the two payloads are exactly the fixed strings: no code, amount, name or URL', () => {
    expect(PUSH_PAYLOADS).toEqual({ nudge: 'Someone nudged you on X2F', trade: 'Something changed in a trade on X2F' });
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
