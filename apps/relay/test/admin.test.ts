import { ROLES, newTradeCode, type Role } from '@x2f/core';
import { canonicalJson, generateIdentity, joinMessage, type Identity } from '@x2f/protocol';
import sodium from 'libsodium-wrappers';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { ADMIN_MAX_AGE_MS, CLOSE, adminMessage, buildRelay, type Relay } from '../src/index.js';

type Ids = Record<Role, Identity>;

const relays: Relay[] = [];
const sockets: WebSocket[] = [];
let logs: { reason: string }[] = [];
let mod: { publicKey: Uint8Array; privateKey: Uint8Array };
let now = Date.UTC(2026, 9, 18, 12);

beforeAll(async () => {
  await sodium.ready;
  mod = sodium.crypto_sign_keypair();
});

afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  for (const r of relays.splice(0)) {
    await r.app.close();
    await r.admin?.close();
  }
  logs = [];
});

async function start(): Promise<{ relay: Relay; url: string }> {
  const relay = await buildRelay({}, (e) => logs.push(e), { modSigningPublic: sodium.to_hex(mod.publicKey), now: () => now });
  relays.push(relay);
  await relay.app.listen({ host: '127.0.0.1', port: 0 });
  const addr = relay.app.server.address();
  return { relay, url: `ws://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}` };
}

async function ids(): Promise<Ids> {
  return { buyer: await generateIdentity(), seller: await generateIdentity(), mod: await generateIdentity() };
}

const keysOf = (i: Ids): Record<Role, string> => ({ buyer: i.buyer.signPublic, seller: i.seller.signPublic, mod: i.mod.signPublic });
const b64 = (b: Uint8Array): string => sodium.to_base64(b, sodium.base64_variants.ORIGINAL);

/** Built by hand from the documented format, so the relay's own helper is checked too. */
function signed(kind: 'register' | 'close', body: Record<string, unknown>, key = mod.privateKey): Record<string, unknown> {
  const domain = kind === 'register' ? 'x2f/relay-register/v1\0' : 'x2f/relay-close/v1\0';
  const msg = sodium.from_string(domain + canonicalJson(body));
  return { ...body, sig: b64(sodium.crypto_sign_detached(msg, key)) };
}

function post(relay: Relay, url: string, payload: unknown) {
  return relay.admin!.inject({ method: 'POST', url, payload: payload as Record<string, unknown> });
}

function register(relay: Relay, channel: string, i: Ids, at = now) {
  return post(relay, '/v1/admin/trades', signed('register', { channel, signPublics: keysOf(i), at }));
}

interface Client {
  ws: WebSocket;
  next(): Promise<string>;
  closed: Promise<number>;
}

function connect(url: string, code: string): Client {
  const ws = new WebSocket(`${url}/v1/trade/${code}`);
  sockets.push(ws);
  const frames: string[] = [];
  const waiters: ((f: string) => void)[] = [];
  ws.on('message', (d) => {
    const f = d.toString();
    const w = waiters.shift();
    if (w) w(f);
    else frames.push(f);
  });
  const closed = new Promise<number>((resolve) => ws.on('close', (c) => resolve(c)));
  return {
    ws,
    next: () => {
      const f = frames.shift();
      return f !== undefined ? Promise.resolve(f) : new Promise((resolve) => waiters.push(resolve));
    },
    closed,
  };
}

async function tryJoin(url: string, code: string, role: Role, id: Identity): Promise<Client & { first: unknown }> {
  const c = connect(url, code);
  const { challenge } = JSON.parse(await c.next()) as { challenge: string };
  const sig = sodium.crypto_sign_detached(joinMessage(code, role, challenge), id.signSecret);
  c.ws.send(JSON.stringify({ role, sig: b64(sig) }));
  const first = await Promise.race([c.next().then((f) => JSON.parse(f) as unknown), c.closed.then((code) => ({ closed: code }))]);
  return { ...c, first };
}

function envelope(code: string, from: Role, seq: number): string {
  return JSON.stringify({ v: 1, trade: code, from, seq, slots: { buyer: 'a', seller: 'b', mod: 'c' }, nonce: 'n', kh: 'k', ct: 'ct', ctNonce: 'cn', sig: 's' });
}

describe('relay admin listener', () => {
  it('signs exactly the documented bytes', () => {
    const body = { channel: newTradeCode(), signPublics: { buyer: 'a', seller: 'b', mod: 'c' }, at: 1 };
    expect(sodium.to_string(adminMessage('register', body))).toBe('x2f/relay-register/v1\0' + canonicalJson(body));
    const close = { channel: body.channel, at: 1 };
    expect(sodium.to_string(adminMessage('close', close))).toBe('x2f/relay-close/v1\0' + canonicalJson(close));
  });

  it('a valid signed registration lets the parties join', async () => {
    const { relay, url } = await start();
    const channel = newTradeCode();
    const i = await ids();
    expect((await register(relay, channel, i)).statusCode).toBe(201);
    for (const r of ROLES) expect((await tryJoin(url, channel, r, i[r])).first).toEqual({ type: 'joined' });
    expect(relay.stats().trades).toBe(1);
  });

  it('a valid signed close deletes the queue and closes the sockets with 4404', async () => {
    const { relay, url } = await start();
    const channel = newTradeCode();
    const i = await ids();
    await register(relay, channel, i);
    const b = await tryJoin(url, channel, 'buyer', i.buyer);
    const s = await tryJoin(url, channel, 'seller', i.seller);
    b.ws.send(envelope(channel, 'buyer', 1));
    await expect.poll(() => relay.stats().queuedFrames).toBe(1); // queued for the offline mod
    const res = await post(relay, '/v1/admin/trades/close', signed('close', { channel, at: now }));
    expect(res.statusCode).toBe(200);
    expect(await b.closed).toBe(CLOSE.unknownTrade);
    expect(await s.closed).toBe(CLOSE.unknownTrade);
    expect(relay.stats()).toMatchObject({ trades: 0, queuedFrames: 0, queuedBytes: 0 });
    expect((await tryJoin(url, channel, 'mod', i.mod)).first).toEqual({ closed: CLOSE.unknownTrade });
  });

  it('refuses a bad signature, another key, and a signature over other fields', async () => {
    const { relay } = await start();
    const channel = newTradeCode();
    const i = await ids();
    const other = sodium.crypto_sign_keypair();
    const good = signed('register', { channel, signPublics: keysOf(i), at: now });
    const cases = [
      { ...good, sig: b64(new Uint8Array(64)) },
      signed('register', { channel, signPublics: keysOf(i), at: now }, other.privateKey),
      { ...good, channel: newTradeCode() },
      { ...good, signPublics: { ...keysOf(i), mod: i.buyer.signPublic } },
      { ...good, at: now - 1 },
      // A close signature does not register, and a register signature does not close.
      { ...signed('close', { channel, at: now }), signPublics: keysOf(i) },
    ];
    for (const c of cases) expect((await post(relay, '/v1/admin/trades', c)).statusCode).toBe(401);
    expect((await post(relay, '/v1/admin/trades/close', { channel, at: now, sig: good.sig })).statusCode).toBe(401);
    expect(relay.stats().trades).toBe(0);
  });

  it(`refuses an "at" older than ${ADMIN_MAX_AGE_MS / 1000} s, or as far in the future`, async () => {
    const { relay } = await start();
    const i = await ids();
    expect((await register(relay, newTradeCode(), i, now - ADMIN_MAX_AGE_MS - 1)).statusCode).toBe(401);
    expect((await register(relay, newTradeCode(), i, now + ADMIN_MAX_AGE_MS + 1)).statusCode).toBe(401);
    expect((await register(relay, newTradeCode(), i, now - ADMIN_MAX_AGE_MS)).statusCode).toBe(201);
    const channel = newTradeCode();
    await register(relay, channel, i);
    expect((await post(relay, '/v1/admin/trades/close', signed('close', { channel, at: now - ADMIN_MAX_AGE_MS - 1 }))).statusCode).toBe(401);
    expect(relay.stats().trades).toBe(2);
  });

  it('refuses a replayed registration after the trade closed', async () => {
    const { relay, url } = await start();
    const channel = newTradeCode();
    const i = await ids();
    const reg = signed('register', { channel, signPublics: keysOf(i), at: now });
    expect((await post(relay, '/v1/admin/trades', reg)).statusCode).toBe(201);
    expect((await post(relay, '/v1/admin/trades', reg)).statusCode).toBe(409);
    expect((await post(relay, '/v1/admin/trades/close', signed('close', { channel, at: now }))).statusCode).toBe(200);
    expect((await post(relay, '/v1/admin/trades', reg)).statusCode).toBe(409);
    // Even re-encoded: the replay check is on the signed message, not on the sig's spelling.
    expect((await post(relay, '/v1/admin/trades', { ...reg, sig: ` ${String(reg.sig)}` })).statusCode).not.toBe(201);
    expect((await tryJoin(url, channel, 'buyer', i.buyer)).first).toEqual({ closed: CLOSE.unknownTrade });
    // A fresh signed registration later is fine.
    now += 1000;
    expect((await register(relay, channel, i)).statusCode).toBe(201);
  });

  it('refuses malformed bodies with 400', async () => {
    const { relay } = await start();
    const i = await ids();
    const channel = newTradeCode();
    const good = signed('register', { channel, signPublics: keysOf(i), at: now });
    const bad = [
      'not json',
      [],
      { ...good, extra: 1 },
      { channel, signPublics: keysOf(i), at: now },
      { ...good, at: String(now) },
      { ...good, at: now + 0.5 },
      { ...good, channel: 'nope' },
      { ...good, signPublics: { buyer: i.buyer.signPublic, seller: i.seller.signPublic } },
      { ...good, signPublics: { ...keysOf(i), mod: 'zz' } },
      { ...good, sig: 'not base64!' },
    ];
    for (const b of bad) {
      const res = await relay.admin!.inject({ method: 'POST', url: '/v1/admin/trades', headers: { 'content-type': 'application/json' }, payload: typeof b === 'string' ? b : JSON.stringify(b) });
      expect(res.statusCode).toBe(400);
    }
  });

  it('a second registration for a live channel is refused with 409', async () => {
    const { relay } = await start();
    const i = await ids();
    const channel = newTradeCode();
    expect((await register(relay, channel, i)).statusCode).toBe(201);
    now += 1;
    expect((await register(relay, channel, i)).statusCode).toBe(409);
  });

  it('the public listener has no admin route', async () => {
    const { relay } = await start();
    const i = await ids();
    const channel = newTradeCode();
    for (const [path, body] of [
      ['/v1/admin/trades', signed('register', { channel, signPublics: keysOf(i), at: now })],
      ['/v1/admin/trades/close', signed('close', { channel, at: now })],
    ] as const) {
      expect((await relay.app.inject({ method: 'POST', url: path, payload: body })).statusCode).toBe(404);
    }
    expect(relay.stats().trades).toBe(0);
  });

  it('a signed join for a channel nobody registered closes the socket (4404, R20)', async () => {
    const { url } = await start();
    const i = await ids();
    expect((await tryJoin(url, newTradeCode(), 'buyer', i.buyer)).first).toEqual({ closed: CLOSE.unknownTrade });
  });

  it('logs reasons only: no channel IDs, keys or signatures', async () => {
    const { relay } = await start();
    const i = await ids();
    const channel = newTradeCode();
    await register(relay, channel, i);
    await register(relay, channel, i, now - ADMIN_MAX_AGE_MS - 1);
    await post(relay, '/v1/admin/trades/close', signed('close', { channel, at: now }));
    expect(logs.length).toBeGreaterThan(0);
    const text = JSON.stringify(logs);
    expect(text).not.toContain(channel);
    expect(text).not.toContain(channel.replaceAll('-', ''));
    for (const r of ROLES) expect(text).not.toContain(i[r].signPublic);
    for (const e of logs) expect(Object.keys(e)).toEqual(['reason']);
  });

  it('without admin options there is no admin listener', async () => {
    const relay = await buildRelay();
    relays.push(relay);
    expect(relay.admin).toBeNull();
  });

  it('refuses a bad moderator key at build time', async () => {
    await expect(buildRelay({}, () => {}, { modSigningPublic: 'zz' })).rejects.toThrow(TypeError);
  });
});
