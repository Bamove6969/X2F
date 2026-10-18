import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { DEVICE_COOKIE, deviceHash, ensureDeviceCookie, trustDevice } from '../src/auth/device.js';
import { dailyCap, throttleCheck, throttleFail, throttleKey, throttleReset } from '../src/auth/throttle.js';
import { ApiError } from '../src/errors.js';
import { seedAccount } from './helpers/accounts.js';
import { testApp } from './helpers/app.js';

const ORIGIN = 'https://x2f.test';
const T0 = new Date('2026-10-17T12:00:00Z');

let app: FastifyInstance;
let deps: Deps;
let now: Date;
let setNow: (d: Date) => void;

beforeAll(async () => {
  let set: (d: Date) => void;
  ({ app, deps, setNow: set } = await testApp());
  setNow = (d) => {
    now = d;
    set(d);
  };
  app.post('/t/key', async (req, reply) => {
    const b = req.body as { accountId?: string; usernameKey?: string };
    ensureDeviceCookie(req, reply);
    const account = b.accountId ? { id: b.accountId } : { usernameKey: b.usernameKey! };
    return { key: await throttleKey(deps, req, 'password', account) };
  });
  app.post('/t/trust', async (req, reply) => {
    const b = req.body as { accountId: string };
    ensureDeviceCookie(req, reply);
    await trustDevice(deps, b.accountId, deviceHash(req)!);
    return { ok: true };
  });
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  setNow(T0);
});

let n = 0;
const name = () => `thr${String(++n).padStart(4, '0')}`;
const after = (s: number) => setNow(new Date(now.getTime() + s * 1000));

async function caught(p: Promise<unknown>): Promise<ApiError | null> {
  try {
    await p;
    return null;
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
}

async function keyFor(body: { accountId?: string; usernameKey?: string }, deviceCookie?: string): Promise<string> {
  const res = await app.inject({
    method: 'POST', url: '/t/key', headers: { origin: ORIGIN }, payload: body,
    ...(deviceCookie ? { cookies: { [DEVICE_COOKIE]: deviceCookie } } : {}),
  });
  return res.json<{ key: string }>().key;
}

async function trustedCookie(accountId: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/t/trust', headers: { origin: ORIGIN }, payload: { accountId } });
  return res.cookies.find((c) => c.name === DEVICE_COOKIE)!.value;
}

const failures = async (key: string) =>
  (await deps.db.query<{ failures: number }>('select failures from login_throttle where key = $1', [key])).rows[0]?.failures ?? 0;
const lockAlerts = async (accountId: string) =>
  (await deps.db.query(`select detail from alerts where account_id = $1 and kind = 'login-locked'`, [accountId])).rows;

describe('throttle', () => {
  it('builds keys from the method, the account and the device when trusted', async () => {
    const id = await seedAccount(deps, { username: name() });
    expect(await keyFor({ accountId: id })).toBe(`password:${id}:anon`);
    expect(await keyFor({ usernameKey: 'nobody.here' })).toBe('password:name:nobody.here:anon');
    const dev = await trustedCookie(id);
    expect(await keyFor({ accountId: id }, dev)).toMatch(new RegExp(`^password:${id}:dev:[0-9a-f]{64}$`));
    expect(await keyFor({ usernameKey: 'nobody.here' }, dev)).toBe('password:name:nobody.here:anon');
  });

  it('slows down from the 4th failure, locks from the 10th with one alert, and forgets after 15 minutes', async () => {
    const id = await seedAccount(deps, { username: name() });
    const key = await keyFor({ accountId: id });
    for (let i = 0; i < 3; i++) await throttleFail(deps, key, id);
    await expect(throttleCheck(deps, key)).resolves.toBeUndefined();

    await throttleFail(deps, key, id); // 4th: wait 2 s
    expect(await caught(throttleCheck(deps, key))).toMatchObject({ status: 429, code: 'slow-down', extra: { retryAfterSeconds: 2 } });
    after(1);
    expect(await caught(throttleCheck(deps, key))).toMatchObject({ code: 'slow-down', extra: { retryAfterSeconds: 1 } });
    after(1);
    await expect(throttleCheck(deps, key)).resolves.toBeUndefined();

    // 5th..9th: waits of 4, 8, 16, 30, 30 s.
    for (const wait of [4, 8, 16, 30, 30]) {
      await throttleFail(deps, key, id);
      expect(await caught(throttleCheck(deps, key))).toMatchObject({ code: 'slow-down', extra: { retryAfterSeconds: wait } });
      after(wait);
      await expect(throttleCheck(deps, key)).resolves.toBeUndefined();
    }
    expect(await lockAlerts(id)).toEqual([]);

    await throttleFail(deps, key, id); // 10th
    const locked = await caught(throttleCheck(deps, key));
    expect(locked).toMatchObject({ status: 429, code: 'locked' });
    expect(locked!.extra!.retryAfterSeconds).toBeLessThanOrEqual(30);
    expect(locked!.extra!.retryAfterSeconds).toBeGreaterThan(0);
    expect(await lockAlerts(id)).toEqual([{ detail: { method: 'password' } }]);

    after(31);
    await expect(throttleCheck(deps, key)).resolves.toBeUndefined();
    await throttleFail(deps, key, id); // 11th: locked again, still one alert for the streak
    expect(await caught(throttleCheck(deps, key))).toMatchObject({ code: 'locked' });
    expect(await lockAlerts(id)).toHaveLength(1);

    after(15 * 60);
    await expect(throttleCheck(deps, key)).resolves.toBeUndefined();
    await throttleFail(deps, key, id);
    expect(await failures(key)).toBe(1); // the count restarted
  });

  it('refuses checks during a wait without adding failures', async () => {
    const id = await seedAccount(deps, { username: name() });
    const key = await keyFor({ accountId: id });
    for (let i = 0; i < 4; i++) await throttleFail(deps, key, id);
    for (let i = 0; i < 5; i++) expect(await caught(throttleCheck(deps, key))).toMatchObject({ code: 'slow-down' });
    expect(await failures(key)).toBe(4);
  });

  it('restarts the count on success', async () => {
    const id = await seedAccount(deps, { username: name() });
    const key = await keyFor({ accountId: id });
    for (let i = 0; i < 10; i++) await throttleFail(deps, key, id);
    await throttleReset(deps, key);
    expect(await failures(key)).toBe(0);
    await expect(throttleCheck(deps, key)).resolves.toBeUndefined();
  });

  it('works for a name: key with no account, and adds no alert', async () => {
    const key = await keyFor({ usernameKey: 'ghost.user' });
    for (let i = 0; i < 10; i++) await throttleFail(deps, key, null);
    expect(await caught(throttleCheck(deps, key))).toMatchObject({ code: 'locked' });
    after(31);
    await expect(throttleCheck(deps, key)).resolves.toBeUndefined();
    after(15 * 60);
    await throttleFail(deps, key, null);
    expect(await failures(key)).toBe(1);
  });

  it('keeps a trusted browser out of an anonymous flood; another account’s device counts as anon', async () => {
    const id = await seedAccount(deps, { username: name() });
    const anon = await keyFor({ accountId: id });
    for (let i = 0; i < 10; i++) await throttleFail(deps, anon, id);
    expect(await caught(throttleCheck(deps, anon))).toMatchObject({ code: 'locked' });

    const dev = await trustedCookie(id);
    const mine = await keyFor({ accountId: id }, dev);
    expect(mine).not.toBe(anon);
    await expect(throttleCheck(deps, mine)).resolves.toBeUndefined();
    expect(await failures(mine)).toBe(0);

    const other = await seedAccount(deps, { username: name() });
    const otherDev = await trustedCookie(other);
    expect(await keyFor({ accountId: id }, otherDev)).toBe(anon);
    // An untrusted, fresh browser is anon too.
    expect(await keyFor({ accountId: id }, 'A'.repeat(43))).toBe(anon);
  });
});

describe('dailyCap', () => {
  it('allows the limit per UTC day, then slows down until midnight UTC', async () => {
    setNow(new Date('2026-10-17T21:30:00Z'));
    for (let i = 0; i < 5; i++) await expect(dailyCap(deps, 'backup-totp:x', 5)).resolves.toBeUndefined();
    const e = await caught(dailyCap(deps, 'backup-totp:x', 5));
    expect(e).toMatchObject({ status: 429, code: 'slow-down', extra: { retryAfterSeconds: 2.5 * 3600 } });
    await expect(dailyCap(deps, 'backup-totp:y', 5)).resolves.toBeUndefined();
    setNow(new Date('2026-10-18T00:00:00Z'));
    await expect(dailyCap(deps, 'backup-totp:x', 5)).resolves.toBeUndefined();
  });
});
