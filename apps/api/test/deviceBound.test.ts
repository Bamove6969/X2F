// S-085 (owner, 30 Oct: "device-bound sessions, a non-copyable browser key, before mainnet"):
// docs/superpowers/specs/2026-11-12-device-bound-sessions.md. A session created with the browser's
// public key (`X2F-Session-Key`) also needs a short-lived bound cookie, renewed only with a
// signature from the browser's non-extractable private key. Behind X2F_DEVICE_BOUND_SESSIONS (off by default).
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { BOUND_COOKIE, BOUND_OVERLAP_MS, BOUND_TTL_MS, PROOF_CHALLENGE_TTL_MS, SESSION_KEY_HEADER, proofMessage } from '../src/auth/deviceBound.js';
import { SESSION_PROOF_BUCKET } from '../src/limits.js';
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

type Challenge = { challenge: string; session: string };
async function challengeOf(jar: Jar): Promise<Challenge> {
  const c = await send(jar, 'POST', '/v1/account/session/proof/challenge', {});
  expect(c.statusCode, c.body).toBe(200);
  return c.json() as Challenge;
}
/** The signature over the v2 message (S1: the origin and the session are in the signed bytes). */
const signOf = (key: Device, c: Challenge, origin = ORIGIN) =>
  sign('sha256', Buffer.from(proofMessage(origin, c.session, c.challenge), 'utf8'), { key: key.privateKey, dsaEncoding: 'ieee-p1363' });
const answer = (jar: Jar, c: Challenge, signature: Buffer) =>
  send(jar, 'POST', '/v1/account/session/proof', { challenge: c.challenge, signature: signature.toString('base64url') });

async function prove(jar: Jar, key: Device, o: { tamper?: boolean } = {}) {
  const c = await challengeOf(jar);
  let signature = signOf(key, c);
  if (o.tamper) signature = Buffer.from(signature.map((b, i) => (i === 0 ? b ^ 1 : b)));
  return { challenge: c.challenge, c, res: await answer(jar, c, signature) };
}
const sessionIdOf = async (jar: Jar): Promise<string> =>
  (await deps.db.query<{ id: string }>("select id from sessions where token_hash = sha256(convert_to($1, 'utf8'))", [jar[SESSION_COOKIE]])).rows[0]!.id;

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
    expect(errorOf(await answer(jar, first.c, signOf(key, first.c)))).toBe('proof-invalid');
    // A tampered signature fails and burns the challenge.
    const bad = await prove(jar, key, { tamper: true });
    expect(errorOf(bad.res)).toBe('proof-invalid');
    expect(errorOf(await answer(jar, bad.c, signOf(key, bad.c)))).toBe('proof-invalid');
    // Too late.
    const c = await challengeOf(jar);
    advance(PROOF_CHALLENGE_TTL_MS);
    expect(errorOf(await answer(jar, c, signOf(key, c)))).toBe('proof-invalid');
    // Malformed bodies.
    expect((await send(jar, 'POST', '/v1/account/session/proof', { challenge: c.challenge })).statusCode).toBe(400);
    expect((await send(jar, 'POST', '/v1/account/session/proof', { challenge: c.challenge, signature: 'x', extra: 1 })).statusCode).toBe(400);
  });

  it('MF1: several challenges may be outstanding at once (tabs renewing together); each is single-use', async () => {
    const key = device();
    const { jar } = await login(key);
    advance(BOUND_TTL_MS);
    const [a, b, c] = [await challengeOf(jar), await challengeOf(jar), await challengeOf(jar)];
    // Answered out of order: every one still works, once.
    for (const ch of [b, a, c]) expect((await answer(jar, ch, signOf(key, ch))).statusCode).toBe(200);
    for (const ch of [a, b, c]) expect(errorOf(await answer(jar, ch, signOf(key, ch)))).toBe('proof-invalid');
    expect((await me(jar)).statusCode).toBe(200);
  });

  it('MF1: a cookie thief asking for challenges or sending garbage cannot spoil the victim\'s renewal', async () => {
    const key = device();
    const { jar } = await login(key);
    const thief: Jar = { [SESSION_COOKIE]: jar[SESSION_COOKIE]! };
    advance(BOUND_TTL_MS);
    const mine = await challengeOf(jar);
    const theirs = await challengeOf(thief);
    expect(errorOf(await answer(thief, theirs, signOf(device(), theirs)))).toBe('proof-invalid');
    expect(errorOf(await send(thief, 'POST', '/v1/account/session/proof', { challenge: mine.challenge.replace(/.$/, (x) => (x === 'A' ? 'B' : 'A')), signature: 'A'.repeat(86) }))).toBe('proof-invalid');
    expect((await answer(jar, mine, signOf(key, mine))).statusCode).toBe(200);
    expect((await me(jar)).statusCode).toBe(200);
  });

  it('MF1: a challenge is tied to its session (one device key signs for every session of the profile)', async () => {
    const key = device();
    const one = await login(key);
    const two = await login(key);
    const c = await challengeOf(one.jar);
    // Signed over the other session's id, or sent on the other session: refused.
    expect(errorOf(await answer(two.jar, c, signOf(key, { ...c, session: await sessionIdOf(two.jar) })))).toBe('proof-invalid');
    expect(errorOf(await answer(two.jar, c, signOf(key, c)))).toBe('proof-invalid');
    expect((await answer(one.jar, c, signOf(key, c))).statusCode).toBe(200);
  });

  it('S1: the signed message is v2 and names the origin and the session', async () => {
    const key = device();
    const { jar } = await login(key);
    const c = await challengeOf(jar);
    expect(c.session).toBe(await sessionIdOf(jar));
    expect(proofMessage('https://a.example', 's', 'c')).toBe('x2f-session-proof-v2\nhttps://a.example\ns\nc');
    // The v1 bytes, another origin, or another session id: refused (each answer uses the challenge up).
    const v1 = sign('sha256', Buffer.from(`x2f-session-proof-v1:${c.challenge}`), { key: key.privateKey, dsaEncoding: 'ieee-p1363' });
    expect(errorOf(await answer(jar, c, v1))).toBe('proof-invalid');
    const c2 = await challengeOf(jar);
    expect(errorOf(await answer(jar, c2, signOf(key, c2, 'https://evil.example')))).toBe('proof-invalid');
    const c3 = await challengeOf(jar);
    expect(errorOf(await answer(jar, c3, signOf(key, { ...c3, session: '00000000-0000-4000-8000-000000000000' })))).toBe('proof-invalid');
    const c4 = await challengeOf(jar);
    expect((await answer(jar, c4, signOf(key, c4))).statusCode).toBe(200);
  });

  it('S2/R2: refused proofs spend a strict per-session budget (429 slow-down); a valid proof is never refused', async () => {
    const key = device();
    const { jar } = await login(key);
    const garbage = () => send(jar, 'POST', '/v1/account/session/proof', { challenge: 'A'.repeat(75), signature: 'A'.repeat(86) });
    for (let i = 0; i < SESSION_PROOF_BUCKET.capacity; i++) expect(errorOf(await garbage())).toBe('proof-invalid');
    const res = await garbage();
    expect({ status: res.statusCode, error: errorOf(res) }).toEqual({ status: 429, error: 'slow-down' });
    // The budget is spent, yet a valid proof still renews (a thief cannot make one).
    expect((await prove(jar, key)).res.statusCode).toBe(200);
    // Another session of the same account has its own budget.
    const other = await login(key);
    expect(errorOf(await send(other.jar, 'POST', '/v1/account/session/proof', { challenge: 'A'.repeat(75), signature: 'A'.repeat(86) }))).toBe('proof-invalid');
    advance(60_000);
    expect(errorOf(await garbage())).toBe('proof-invalid');
  });

  it('R2: challenges have no per-session cap: after a cookie thief asks for hundreds, the victim asks for a NEW challenge and renews', async () => {
    const key = device();
    const { jar } = await login(key);
    const thief: Jar = { [SESSION_COOKIE]: jar[SESSION_COOKIE]! };
    advance(BOUND_TTL_MS);
    expect(errorOf(await me(jar))).toBe('session-proof-required');
    // A challenge writes nothing, so the thief spending them costs the victim nothing.
    for (let i = 0; i < 300; i++) {
      const res = await send(thief, 'POST', '/v1/account/session/proof/challenge', {});
      if (res.statusCode !== 200) throw new Error(`thief challenge ${i}: ${res.statusCode} ${res.body}`);
    }
    const fresh = await challengeOf(jar);
    expect((await answer(jar, fresh, signOf(key, fresh))).statusCode).toBe(200);
    expect((await me(jar)).statusCode).toBe(200);
  });

  it('R1: the previous bound cookie keeps working for BOUND_OVERLAP_MS after a renewal (tabs share one cookie jar)', async () => {
    const key = device();
    const { jar } = await login(key);
    advance(60_000);
    const tabA: Jar = { ...jar };
    expect((await me(tabA)).statusCode).toBe(200);
    // Tab B renews: the shared jar now holds a new bound cookie, but tab A's request was already sent with the old one.
    expect((await prove(jar, key)).res.statusCode).toBe(200);
    expect(jar[BOUND_COOKIE]).not.toBe(tabA[BOUND_COOKIE]);
    expect((await me(tabA)).statusCode).toBe(200);
    advance(BOUND_OVERLAP_MS - 1000);
    expect((await me(tabA)).statusCode).toBe(200);
    advance(1000);
    expect(errorOf(await me(tabA))).toBe('session-proof-required');
    expect((await me(jar)).statusCode).toBe(200);
  });

  it('R1: the overlap never outlives the old cookie\'s own end, and only the one previous cookie gets it', async () => {
    const key = device();
    const { jar } = await login(key);
    const first: Jar = { ...jar };
    advance(BOUND_TTL_MS - 10_000);
    expect((await prove(jar, key)).res.statusCode).toBe(200);
    const second: Jar = { ...jar };
    expect((await me(first)).statusCode).toBe(200);
    advance(10_000);
    // `first` reached its own BOUND_TTL end before the overlap did.
    expect(errorOf(await me(first))).toBe('session-proof-required');
    expect((await prove(jar, key)).res.statusCode).toBe(200);
    // Two renewals on: the first cookie is not the previous one any more.
    expect((await me(second)).statusCode).toBe(200);
    expect(errorOf(await me(first))).toBe('session-proof-required');
  });

  it('a disabled account gets account-disabled before session-proof-required', async () => {
    const key = device();
    const { jar } = await login(key);
    advance(BOUND_TTL_MS);
    await deps.db.query("update accounts set disabled_at = $2 where id = (select account_id from sessions where token_hash = sha256(convert_to($1, 'utf8')))", [jar[SESSION_COOKIE], now]);
    const res = await me(jar);
    expect({ status: res.statusCode, error: errorOf(res) }).toEqual({ status: 403, error: 'account-disabled' });
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

  it('S5: a malformed header is refused at the top of a login route, before the login factor is checked', async () => {
    for (const bad of ['not base64!', 'AAAA']) {
      const res = await send({}, 'POST', '/v1/login/password', { loginName: 'nobody-at-all', password: 'Wrong-Password-1', deviceLabel: 'x' }, { [SESSION_KEY_HEADER]: bad });
      expect({ status: res.statusCode, error: errorOf(res) }).toEqual({ status: 400, error: 'bad-request' });
    }
    // Flag off: the header is not read at all.
    flag(false);
    const res = await send({}, 'POST', '/v1/login/password', { loginName: 'nobody-at-all', password: 'Wrong-Password-1', deviceLabel: 'x' }, { [SESSION_KEY_HEADER]: 'AAAA' });
    expect(errorOf(res)).not.toBe('bad-request');
  });

  it('a malformed header, or a key that is not P-256, is refused with 400 and no session', async () => {
    for (const bad of ['not base64!', 'AAAA', device('secp384r1').spki, 'A'.repeat(400)]) {
      const { jar, login: res } = await login(bad);
      expect({ status: res.statusCode, error: errorOf(res) }, bad.slice(0, 20)).toEqual({ status: 400, error: 'bad-request' });
      expect(jar[SESSION_COOKIE]).toBeUndefined();
    }
  });
});
