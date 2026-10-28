import { createECDH, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { PUBLIC_NAME_COLUMN } from '../src/events/publicName.js';
import { PUBLIC_NAME } from '../src/nudge/names.js';
import { PUSH_PAYLOADS, type PushCall, type PushTransport } from '../src/push/send.js';
import { seedAccount } from './helpers/accounts.js';
import { testApp } from './helpers/app.js';
import { openEvents, until, type SseStream } from './helpers/sse.js';
import { Browser } from './helpers/totp.js';

/**
 * Task 26's nudges over Task 19's real channels (no fake publish or sendPush): the recipient's
 * open stream gets `{type:'nudge', from, context}` with the sender's PUBLIC name, and with no
 * stream open the recipient's devices get only the generic "Someone nudged you on X2F" push.
 */

const T0 = new Date('2026-10-17T12:00:00Z');
const DAY = 24 * 3600_000;
const CONTEXT = 'K7Q2-M9XW';

const calls: PushCall[] = [];
const fakeTransport: PushTransport = async (call) => {
  calls.push(call);
  return { statusCode: 201 };
};

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let step = 0;
let n = 0;
const open: SseStream[] = [];

beforeAll(async () => {
  // Only the shared-context check is stubbed; publish and sendPush are the app's own.
  ({ app, deps, setNow } = await testApp({ nudges: { hasSharedContext: async () => true } }, { pushTransport: fakeTransport }));
  app.post('/t/login', async (req, reply) => {
    const { startSession } = await import('../src/auth/sessions.js');
    const b = req.body as { accountId: string };
    return {
      sessionId: await startSession(deps, req, reply, {
        accountId: b.accountId, level: 'full', deviceLabel: 'Test browser', method: 'passkey', firstSession: false,
      }),
    };
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
});

afterAll(async () => {
  for (const s of open) s.close();
  await app.close();
});

beforeEach(async () => {
  calls.length = 0;
  for (const s of open.splice(0)) s.close();
  await until(() => app.events.size === 0);
  // A fresh day each test: no sender's 10 minutes or recipient's hourly 3 carry over.
  setNow(new Date(T0.getTime() + ++step * DAY));
});

async function trader() {
  const name = `Nd_${String(++n).padStart(4, '0')}`;
  const id = await seedAccount(deps, { loginName: `${name}.lg`, displayName: name });
  const b = new Browser(app);
  expect((await b.post('/t/login', { accountId: id })).statusCode).toBe(200);
  return { id, b, name };
}

async function subscribe(b: Browser) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const sub = {
    endpoint: `https://fcm.googleapis.com/fcm/send/${randomBytes(24).toString('base64url')}`,
    keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') },
  };
  expect((await b.post('/v1/account/push', sub)).statusCode).toBeLessThan(300);
  return sub;
}

async function stream(b: Browser): Promise<SseStream> {
  const s = await openEvents(app, b.cookies);
  open.push(s);
  expect(s.status).toBe(200);
  return s;
}

describe('nudges over the real live events and Web Push (Tasks 19 + 26)', () => {
  it('the name in the event is the public name column the events use', () => {
    expect(PUBLIC_NAME).toBe(PUBLIC_NAME_COLUMN);
  });

  it("an open stream gets {type:'nudge', from: <public name>, context} and nothing else", async () => {
    const from = await trader();
    const to = await trader();
    const bystander = await trader();
    const s = await stream(to.b);
    const other = await stream(bystander.b);
    expect((await from.b.post('/v1/nudges', { to: to.name, context: CONTEXT })).statusCode).toBe(202);
    const ev = await s.waitFor((e) => (e as { type?: string }).type === 'nudge');
    expect(ev).toEqual({ type: 'nudge', from: from.name, context: CONTEXT });
    expect(other.events).toEqual([]);
  });

  it('with no stream open, the recipient gets only the generic push', async () => {
    const from = await trader();
    const to = await trader();
    const sub = await subscribe(to.b);
    expect((await from.b.post('/v1/nudges', { to: to.name, context: CONTEXT })).statusCode).toBe(202);
    await until(() => calls.length > 0);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.subscription.endpoint).toBe(sub.endpoint);
    expect(calls[0]!.payload).toBe('Someone nudged you on X2F');
    expect(calls[0]!.payload).toBe(PUSH_PAYLOADS.nudge);
    expect(calls[0]!.payload).not.toContain(from.name);
    expect(calls[0]!.payload).not.toContain(CONTEXT);
  });

  it('a recipient whose stream has closed gets the push; while it is open, the stream alone', async () => {
    const from = await trader();
    const to = await trader();
    await subscribe(to.b);
    const s = await stream(to.b);
    expect((await from.b.post('/v1/nudges', { to: to.name, context: CONTEXT })).statusCode).toBe(202);
    await s.waitFor((e) => (e as { type?: string }).type === 'nudge');
    // Delivery runs after the answer: give the push leg time to (not) run.
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toEqual([]);

    s.close();
    await until(() => app.events.size === 0);
    setNow(new Date(T0.getTime() + step * DAY + 11 * 60_000));
    expect((await from.b.post('/v1/nudges', { to: to.name, context: CONTEXT })).statusCode).toBe(202);
    await until(() => calls.length > 0);
    expect(calls.map((c) => c.payload)).toEqual(['Someone nudged you on X2F']);
  });
});
