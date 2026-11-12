// S-085 (owner, 30 Oct: "device-bound sessions, a non-copyable browser key, before mainnet"):
// docs/superpowers/specs/2026-11-12-device-bound-sessions.md. A session created with the browser's
// public key (`X2F-Session-Key`) also needs a short-lived bound cookie, renewed only with a
// signature from the browser's non-extractable private key. Behind X2F_DEVICE_BOUND_SESSIONS (off by default).
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { BOUND_COOKIE, BOUND_TTL_MS, PROOF_CHALLENGE_TTL_MS, SESSION_KEY_HEADER, proofMessage } from '../src/auth/deviceBound.js';
import { SESSION_COOKIE } from '../src/auth/sessions.js';
import type { Config } from '../src/config.js';
import { seedAccount } from './helpers/accounts.js';
import { tradeApp } from './helpers/tradeApp.js';
import { ORIGIN } from './helpers/totp.js';

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
const START = new Date('2026-11-12T12:00:00Z');
let now = START;
const advance = (ms: number) => setNow((now = new Date(now.getTime() + ms)));
const flag = (on: boolean) => {
  (deps.config as Config & { deviceBoundSessions?: boolean }).deviceBoundSessions = on;
};

beforeAll(async () => {
  ({ app, deps, setNow } = await tradeApp());
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  now = START;
  setNow(START);
  flag(true);
});

interface Device {
  publicKey: KeyObject;
  privateKey: KeyObject;
  spki: string;
}
function device(curve = 'prime256v1'): Device {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: curve });
  return { publicKey, privateKey, spki: publicKey.export({ type: 'spki', format: 'der' }).toString('base64url') };
}

type Jar = Record<string, string>;
const keep = (jar: Jar, res: LightMyRequestResponse): LightMyRequestResponse => {
  for (const c of res.cookies) {
    if (c.maxAge === 0 || c.value === '') delete jar[c.name];
    else jar[c.name] = c.value;
  }
  return res;
};
const send = async (jar: Jar, method: 'GET' | 'POST', url: string, payload?: unknown, headers: Record<string, string> = {}) =>
  keep(jar, await app.inject({ method, url, cookies: jar, headers: { origin: ORIGIN, ...headers }, ...(payload !== undefined ? { payload: payload as object } : {}) }));
const errorOf = (res: LightMyRequestResponse) => (res.body === '' ? undefined : (res.json() as { error?: string }).error);

/** A logged-in browser; with `key`, its login carries the session-key header. */
async function login(key?: Device | string): Promise<{ jar: Jar; login: LightMyRequestResponse }> {
  const accountId = await seedAccount(deps, { loginName: `bound${Math.random().toString(36).slice(2, 10)}` });
  const jar: Jar = {};
  const headers = key === undefined ? {} : { [SESSION_KEY_HEADER]: typeof key === 'string' ? key : key.spki };
  const res = await send(jar, 'POST', '/t/login', { accountId }, headers);
  return { jar, login: res };
}
const me = (jar: Jar) => send(jar, 'GET', '/v1/account/me');

async function prove(jar: Jar, key: Device, o: { tamper?: boolean } = {}) {
  const c = await send(jar, 'POST', '/v1/account/session/proof/challenge', {});
  expect(c.statusCode, c.body).toBe(200);
  const challenge = (c.json() as { challenge: string }).challenge;
  let signature = sign('sha256', Buffer.from(proofMessage(challenge), 'utf8'), { key: key.privateKey, dsaEncoding: 'ieee-p1363' });
  if (o.tamper) signature = Buffer.from(signature.map((b, i) => (i === 0 ? b ^ 1 : b)));
  return { challenge, res: await send(jar, 'POST', '/v1/account/session/proof', { challenge, signature: signature.toString('base64url') }) };
}

describe('flag off (the default)', () => {
  it('ignores the header: no bound cookie, nothing new is checked, both proof routes are 404', async () => {
    flag(false);
    const key = device();
    const { jar, login: res } = await login(key);
    expect(res.statusCode).toBe(200);
    expect(jar[BOUND_COOKIE]).toBeUndefined();
    expect((await me(jar)).statusCode).toBe(200);
    expect((await send(jar, 'POST', '/v1/account/session/proof/challenge', {})).statusCode).toBe(404);
    expect((await send(jar, 'POST', '/v1/account/session/proof', { challenge: 'x', signature: 'y' })).statusCode).toBe(404);
    const { rows } = await deps.db.query('select bound_key from sessions where token_hash is not null and bound_key is not null');
    expect(rows).toEqual([]);
  });
});

describe('a bound session', () => {
  it('gets a bound cookie at login; a copy of the session cookie alone is refused', async () => {
    const key = device();
    const { jar } = await login(key);
    expect(jar[BOUND_COOKIE]).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await me(jar)).statusCode).toBe(200);
    const copied: Jar = { [SESSION_COOKIE]: jar[SESSION_COOKIE]! };
    const res = await me(copied);
    expect({ status: res.statusCode, error: errorOf(res) }).toEqual({ status: 401, error: 'session-proof-required' });
    const wrong: Jar = { ...copied, [BOUND_COOKIE]: 'A'.repeat(43) };
    expect(errorOf(await me(wrong))).toBe('session-proof-required');
  });

  it('a copy of both cookies dies at BOUND_TTL; the key holder renews with a signature over a fresh challenge', async () => {
    const key = device();
    const { jar } = await login(key);
    const thief: Jar = { ...jar };
    advance(BOUND_TTL_MS - 1000);
    expect((await me(thief)).statusCode).toBe(200);
    advance(1000);
    expect(errorOf(await me(thief))).toBe('session-proof-required');
    expect(errorOf(await me(jar))).toBe('session-proof-required');
    // The thief can ask for a challenge but cannot sign it with the device's key.
    const theirs = device();
    expect(errorOf((await prove(thief, theirs)).res)).toBe('proof-invalid');
    const { res } = await prove(jar, key);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ boundUntil: new Date(now.getTime() + BOUND_TTL_MS).toISOString() });
    expect((await me(jar)).statusCode).toBe(200);
    expect(errorOf(await me(thief))).toBe('session-proof-required');
  });

  it('a challenge is single-use, expires, and a bad signature clears it', async () => {
    const key = device();
    const { jar } = await login(key);
    const first = await prove(jar, key);
    expect(first.res.statusCode).toBe(200);
    const sig = sign('sha256', Buffer.from(proofMessage(first.challenge)), { key: key.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    expect(errorOf(await send(jar, 'POST', '/v1/account/session/proof', { challenge: first.challenge, signature: sig }))).toBe('proof-invalid');
    // A tampered signature fails and burns the challenge.
    const bad = await prove(jar, key, { tamper: true });
    expect(errorOf(bad.res)).toBe('proof-invalid');
    const retry = sign('sha256', Buffer.from(proofMessage(bad.challenge)), { key: key.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    expect(errorOf(await send(jar, 'POST', '/v1/account/session/proof', { challenge: bad.challenge, signature: retry }))).toBe('proof-invalid');
    // Too late.
    const c = (await send(jar, 'POST', '/v1/account/session/proof/challenge', {})).json() as { challenge: string };
    advance(PROOF_CHALLENGE_TTL_MS);
    const late = sign('sha256', Buffer.from(proofMessage(c.challenge)), { key: key.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    expect(errorOf(await send(jar, 'POST', '/v1/account/session/proof', { challenge: c.challenge, signature: late }))).toBe('proof-invalid');
    // Malformed bodies.
    expect((await send(jar, 'POST', '/v1/account/session/proof', { challenge: c.challenge })).statusCode).toBe(400);
    expect((await send(jar, 'POST', '/v1/account/session/proof', { challenge: c.challenge, signature: 'x', extra: 1 })).statusCode).toBe(400);
  });

  it('logout needs no proof', async () => {
    const key = device();
    const { jar } = await login(key);
    advance(BOUND_TTL_MS);
    expect((await send(jar, 'POST', '/v1/logout', {})).statusCode).toBe(200);
    expect(errorOf(await me(jar))).toBe('not-authenticated');
  });

  it('turning the flag off is the kill switch: a bound session works without the bound cookie', async () => {
    const key = device();
    const { jar } = await login(key);
    const copied: Jar = { [SESSION_COOKIE]: jar[SESSION_COOKIE]! };
    flag(false);
    expect((await me(copied)).statusCode).toBe(200);
  });

  it('the proof routes still need a live session', async () => {
    expect(errorOf(await send({}, 'POST', '/v1/account/session/proof/challenge', {}))).toBe('not-authenticated');
  });
});

describe('binding at login', () => {
  it('a login without the header is unbound and works as today; its challenge is 409 not-bound', async () => {
    const { jar } = await login();
    expect(jar[BOUND_COOKIE]).toBeUndefined();
    advance(BOUND_TTL_MS * 3);
    expect((await me({ [SESSION_COOKIE]: jar[SESSION_COOKIE]! })).statusCode).toBe(200);
    const res = await send(jar, 'POST', '/v1/account/session/proof/challenge', {});
    expect({ status: res.statusCode, error: errorOf(res) }).toEqual({ status: 409, error: 'not-bound' });
  });

  it('a malformed header, or a key that is not P-256, is refused with 400 and no session', async () => {
    for (const bad of ['not base64!', 'AAAA', device('secp384r1').spki, 'A'.repeat(400)]) {
      const { jar, login: res } = await login(bad);
      expect({ status: res.statusCode, error: errorOf(res) }, bad.slice(0, 20)).toEqual({ status: 400, error: 'bad-request' });
      expect(jar[SESSION_COOKIE]).toBeUndefined();
    }
  });
});
