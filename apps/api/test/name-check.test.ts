// `POST /v1/register/name-check` (design real-app review item 6, lead job 2026-11-08): the live
// "is available" tick on the sign-up's private username. It answers whether a login name is free,
// so it is an enumeration oracle by nature; these tests hold its limits (a per-device bucket and a
// site-wide budget), its one-namespace answer and that it never logs or echoes the name.
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { DEVICE_COOKIE } from '../src/auth/device.js';
import { NAME_CHECK_BUCKET, NAME_CHECK_DEVICE_BUCKET } from '../src/limits.js';
import { seedAccount } from './helpers/accounts.js';
import { testApp } from './helpers/app.js';

const ORIGIN = 'https://x2f.test';
const T0 = new Date('2026-11-08T12:00:00Z');
const HOUR = 3600_000;

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let logs: string[];
let step = 0;
let n = 0;

beforeAll(async () => {
  ({ app, deps, setNow, logs } = await testApp());
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  // Each test starts an hour later: every bucket is full again.
  setNow(new Date(T0.getTime() + ++step * HOUR));
});

const unique = (p: string) => `${p}${process.pid % 1000}x${++n}`;
const cookie = (res: LightMyRequestResponse) => res.cookies.find((c) => c.name === DEVICE_COOKIE)?.value;

function check(payload: unknown, device?: string) {
  return app.inject({
    method: 'POST', url: '/v1/register/name-check', headers: { origin: ORIGIN },
    cookies: device !== undefined ? { [DEVICE_COOKIE]: device } : {}, payload: payload as Record<string, unknown>,
  });
}

/** A device cookie the server minted, for the per-device tests. */
async function device(): Promise<string> {
  const res = await check({ loginName: unique('dev') });
  expect(res.statusCode).toBe(200);
  return cookie(res)!;
}

describe('POST /v1/register/name-check', () => {
  it('a free name is available; the browser gets a device cookie; nothing is cached', async () => {
    const res = await check({ loginName: unique('free') });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ available: true });
    expect(cookie(res)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it("a name some account logs in with is taken, whatever its case", async () => {
    const login = unique('owl');
    await seedAccount(deps, { loginName: login, displayName: unique('Shown') });
    expect((await check({ loginName: login })).json()).toEqual({ available: false });
    expect((await check({ loginName: login.toUpperCase() })).json()).toEqual({ available: false });
  });

  it("a name that is some account's public display name is taken too (one namespace)", async () => {
    const shown = unique('shown');
    await seedAccount(deps, { loginName: unique('priv'), displayName: shown });
    expect((await check({ loginName: shown })).json()).toEqual({ available: false });
  });

  it('a name of the wrong shape is refused before any lookup', async () => {
    for (const loginName of ['abcd', 'x'.repeat(21), 'has space', 'naïve-name']) {
      const res = await check({ loginName });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'login-name-invalid' });
    }
    expect((await check({ loginName: 12345 })).statusCode).toBe(400);
    expect((await check({})).statusCode).toBe(400);
  });

  it('answers only { available }: never the name, an account or a display name', async () => {
    const login = unique('quiet');
    await seedAccount(deps, { loginName: login, displayName: unique('Loud') });
    const res = await check({ loginName: login });
    expect(Object.keys(res.json())).toEqual(['available']);
    expect(res.body).not.toContain(login);
  });

  it('never writes the name to the log', async () => {
    const login = unique('secret');
    logs.length = 0;
    await check({ loginName: login });
    await check({ loginName: 'bad shape!' });
    expect(logs.join('\n')).not.toContain(login);
    expect(logs.join('\n')).not.toContain('bad shape!');
  });

  it(`one device gets ${NAME_CHECK_DEVICE_BUCKET.capacity} checks at once, then 429 slow-down with a wait; another device is unaffected`, async () => {
    const mine = await device();
    for (let i = 1; i < NAME_CHECK_DEVICE_BUCKET.capacity; i++) expect((await check({ loginName: unique('a') }, mine)).statusCode).toBe(200);
    const over = await check({ loginName: unique('a') }, mine);
    expect(over.statusCode).toBe(429);
    expect(over.json()).toMatchObject({ error: 'slow-down' });
    expect(over.json().retryAfterSeconds).toBeGreaterThan(0);
    // A wrong-shape name costs a check too, so it cannot be used to probe the budget for free.
    expect((await check({ loginName: 'bad' }, mine)).statusCode).toBe(429);
    expect((await check({ loginName: unique('b') }, await device())).statusCode).toBe(200);
  });

  it('the bucket refills with time', async () => {
    const mine = await device();
    for (let i = 1; i < NAME_CHECK_DEVICE_BUCKET.capacity; i++) await check({ loginName: unique('r') }, mine);
    expect((await check({ loginName: unique('r') }, mine)).statusCode).toBe(429);
    setNow(new Date(T0.getTime() + step * HOUR + 60_000));
    expect((await check({ loginName: unique('r') }, mine)).statusCode).toBe(200);
  });

  // Review F3 (signup-team review, 8 Nov): the site budget is spent only by requests that passed
  // their device's limit, so a device over its pace never drains it for everyone else.
  it('a device over its limit does not spend the site budget', async () => {
    const mine = await device();
    for (let i = 1; i < NAME_CHECK_DEVICE_BUCKET.capacity; i++) expect((await check({ loginName: unique('o') }, mine)).statusCode).toBe(200);
    for (let i = 0; i < 3 * NAME_CHECK_BUCKET.capacity; i++) expect((await check({ loginName: unique('o') }, mine)).statusCode).toBe(429);
    // The site has spent only this device's own allowance: the rest is still there for others.
    let ok = 0;
    for (let i = 0; i < NAME_CHECK_BUCKET.capacity; i++) if ((await check({ loginName: unique('o') })).statusCode === 200) ok++;
    expect(ok).toBe(NAME_CHECK_BUCKET.capacity - NAME_CHECK_DEVICE_BUCKET.capacity);
  });

  it('a made-up but well-formed cookie is a fresh device (R29: device cookies are chosen by the client)', async () => {
    const madeUp = 'A'.repeat(43);
    for (let i = 0; i < NAME_CHECK_DEVICE_BUCKET.capacity; i++) expect((await check({ loginName: unique('m') }, madeUp)).statusCode).toBe(200);
    expect((await check({ loginName: unique('m') }, madeUp)).statusCode).toBe(429);
    expect((await check({ loginName: unique('m') }, 'B'.repeat(43))).statusCode).toBe(200);
  });

  // Review F2: the counts live in Postgres, so every API process (and a restart) shares them.
  describe('with a second API process on the same database', () => {
    let other: FastifyInstance;

    beforeAll(async () => {
      ({ app: other } = await testApp({ db: deps.db, clock: deps.clock, config: deps.config }));
    });

    afterAll(async () => {
      await other.close();
    });

    const checkOn = (on: FastifyInstance, device?: string) =>
      on.inject({
        method: 'POST', url: '/v1/register/name-check', headers: { origin: ORIGIN },
        cookies: device !== undefined ? { [DEVICE_COOKIE]: device } : {}, payload: { loginName: unique('p') },
      });

    it("one device's allowance is shared across processes", async () => {
      const mine = await device();
      for (let i = 1; i < NAME_CHECK_DEVICE_BUCKET.capacity; i++) {
        expect((await checkOn(i % 2 === 0 ? app : other, mine)).statusCode).toBe(200);
      }
      expect((await checkOn(other, mine)).statusCode).toBe(429);
      expect((await checkOn(app, mine)).statusCode).toBe(429);
    });

    it('the site budget is shared across processes, and a new process does not refill it', async () => {
      let ok = 0;
      for (let i = 0; i < NAME_CHECK_BUCKET.capacity; i++) if ((await checkOn(i % 2 === 0 ? app : other)).statusCode === 200) ok++;
      expect(ok).toBe(NAME_CHECK_BUCKET.capacity);
      expect((await checkOn(app)).statusCode).toBe(503);
      expect((await checkOn(other)).statusCode).toBe(503);
      const { app: third } = await testApp({ db: deps.db, clock: deps.clock, config: deps.config });
      try {
        expect((await checkOn(third)).statusCode).toBe(503);
      } finally {
        await third.close();
      }
    });
  });

  it(`the whole site gets ${NAME_CHECK_BUCKET.capacity} checks at once, however many cookies a script throws away: then 503 busy`, async () => {
    let busy: LightMyRequestResponse | undefined;
    // Every request without a cookie gets a fresh device, so only the site-wide budget stops it.
    for (let i = 0; i <= NAME_CHECK_BUCKET.capacity && busy === undefined; i++) {
      const res = await check({ loginName: unique('s') });
      if (res.statusCode !== 200) busy = res;
    }
    expect(busy?.statusCode).toBe(503);
    expect(busy?.json()).toMatchObject({ error: 'busy' });
    expect(busy?.json().retryAfterSeconds).toBeGreaterThan(0);
  });
});
