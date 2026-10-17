import { newTradeCode, type Role } from '@x2f/core';
import { generateIdentity, joinMessage, type Identity } from '@x2f/protocol';
import sodium from 'libsodium-wrappers';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { CLOSE, RelayAtCapacityError, buildRelay, exactCopy, type Relay, type RelayOptions } from '../src/index.js';

type Ids = Record<Role, Identity>;

interface Client {
  ws: WebSocket;
  frames: string[];
  next(): Promise<string>;
  closed: Promise<number>;
}

const relays: Relay[] = [];
const sockets: WebSocket[] = [];
let logs: { reason: string }[] = [];

beforeAll(async () => {
  await sodium.ready;
});

afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  for (const r of relays.splice(0)) await r.app.close();
  logs = [];
});

async function start(o: Partial<RelayOptions> = {}): Promise<{ relay: Relay; url: string }> {
  const relay = await buildRelay(o, (e) => logs.push(e));
  relays.push(relay);
  await relay.app.listen({ host: '127.0.0.1', port: 0 });
  const addr = relay.app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { relay, url: `ws://127.0.0.1:${port}` };
}

async function ids(): Promise<Ids> {
  return { buyer: await generateIdentity(), seller: await generateIdentity(), mod: await generateIdentity() };
}

function register(relay: Relay, code: string, i: Ids): void {
  relay.registerTrade(code, { buyer: i.buyer.signPublic, seller: i.seller.signPublic, mod: i.mod.signPublic });
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
    frames,
    next: () => {
      const f = frames.shift();
      return f !== undefined ? Promise.resolve(f) : new Promise((resolve) => waiters.push(resolve));
    },
    closed,
  };
}

function sign(id: Identity, code: string, role: Role, challenge: string): string {
  const sig = sodium.crypto_sign_detached(joinMessage(code, role, challenge), id.signSecret);
  return sodium.to_base64(sig, sodium.base64_variants.ORIGINAL);
}

async function join(url: string, code: string, role: Role, id: Identity): Promise<Client> {
  const c = connect(url, code);
  const { challenge } = JSON.parse(await c.next()) as { challenge: string };
  c.ws.send(JSON.stringify({ role, sig: sign(id, code, role, challenge) }));
  expect(JSON.parse(await c.next())).toEqual({ type: 'joined' });
  return c;
}

function envelope(code: string, from: Role, seq: number, extra = ''): string {
  return JSON.stringify({ v: 1, trade: code, from, seq, slots: { buyer: 'a', seller: 'b', mod: 'c' }, nonce: 'n', kh: 'k', ct: `ct${extra}`, ctNonce: 'cn', sig: 's' });
}

describe('relay', () => {
  it('passes envelopes byte for byte between joined parties, both ways', async () => {
    const { relay, url } = await start();
    const code = newTradeCode();
    const i = await ids();
    register(relay, code, i);
    const [b, s, m] = await Promise.all([join(url, code, 'buyer', i.buyer), join(url, code, 'seller', i.seller), join(url, code, 'mod', i.mod)]);
    const e1 = envelope(code, 'buyer', 1, ' with  odd   spacing');
    b.ws.send(e1);
    expect(await s.next()).toBe(e1);
    expect(await m.next()).toBe(e1);
    const e2 = envelope(code, 'seller', 1);
    s.ws.send(e2);
    expect(await b.next()).toBe(e2);
  });

  it('accepts the code in the path with or without dashes, in lower case', async () => {
    const { relay, url } = await start();
    const code = newTradeCode();
    const i = await ids();
    register(relay, code, i);
    const c = connect(url, code.replaceAll('-', '').toLowerCase());
    const { challenge } = JSON.parse(await c.next()) as { challenge: string };
    c.ws.send(JSON.stringify({ role: 'buyer', sig: sign(i.buyer, code, 'buyer', challenge) }));
    expect(JSON.parse(await c.next())).toEqual({ type: 'joined' });
  });

  it('queues for an offline party and delivers in order when it joins', async () => {
    const { relay, url } = await start();
    const code = newTradeCode();
    const i = await ids();
    register(relay, code, i);
    const b = await join(url, code, 'buyer', i.buyer);
    const sent = [1, 2, 3, 4, 5].map((n) => envelope(code, 'buyer', n));
    for (const e of sent) b.ws.send(e);
    await expect.poll(() => relay.stats().queuedFrames).toBe(10);
    const s = await join(url, code, 'seller', i.seller);
    for (const e of sent) expect(await s.next()).toBe(e);
  });

  it('drains a queue larger than the peer buffer, in order, exactly once', async () => {
    const { relay, url } = await start({ maxEnvelopeBytes: 16_384 });
    const code = newTradeCode();
    const i = await ids();
    register(relay, code, i);
    const b = await join(url, code, 'buyer', i.buyer);
    const pad = 'x'.repeat(12_000);
    const sent = Array.from({ length: 12 }, (_, n) => envelope(code, 'buyer', n + 1, pad));
    for (const e of sent) b.ws.send(e);
    await expect.poll(() => relay.stats().queuedFrames).toBe(24);
    const s = await join(url, code, 'seller', i.seller);
    for (const e of sent) expect(await s.next()).toBe(e);
    const live = envelope(code, 'buyer', 13);
    b.ws.send(live);
    expect(await s.next()).toBe(live);
    expect(s.frames).toEqual([]);
  });

  it('keeps a queue until the trade closes, then deletes it and closes sockets', async () => {
    const { relay, url } = await start();
    const code = newTradeCode();
    const i = await ids();
    register(relay, code, i);
    const b = await join(url, code, 'buyer', i.buyer);
    b.ws.send(envelope(code, 'buyer', 1));
    await expect.poll(() => relay.stats().queuedFrames).toBe(2);
    relay.closeTrade(code);
    expect(await b.closed).toBe(CLOSE.unknownTrade);
    expect(relay.stats()).toMatchObject({ trades: 0, queuedFrames: 0, queuedBytes: 0 });
  });

  it('closes 4400 on an envelope for another trade, from another role, malformed, or with extra keys', async () => {
    const { relay, url } = await start();
    const code = newTradeCode();
    const i = await ids();
    register(relay, code, i);
    const bad = [
      envelope(newTradeCode(), 'buyer', 1),
      envelope(code, 'seller', 1),
      'not json',
      JSON.stringify({ ...JSON.parse(envelope(code, 'buyer', 1)), extra: 1 }),
      JSON.stringify([1, 2]),
    ];
    for (const frame of bad) {
      const b = await join(url, code, 'buyer', i.buyer);
      b.ws.send(frame);
      expect(await b.closed).toBe(CLOSE.badEnvelope);
    }
  });

  it('closes 1009 on an oversized frame', async () => {
    const { relay, url } = await start({ maxEnvelopeBytes: 4096 });
    const code = newTradeCode();
    const i = await ids();
    register(relay, code, i);
    const b = await join(url, code, 'buyer', i.buyer);
    b.ws.send(envelope(code, 'buyer', 1, 'x'.repeat(5000)));
    expect(await b.closed).toBe(CLOSE.tooLarge);
  });

  it('refuses a bad join signature, a signature for another challenge, and another role\'s key', async () => {
    const { relay, url } = await start();
    const code = newTradeCode();
    const i = await ids();
    register(relay, code, i);

    const forged = connect(url, code);
    await forged.next();
    forged.ws.send(JSON.stringify({ role: 'buyer', sig: sodium.to_base64(new Uint8Array(64), sodium.base64_variants.ORIGINAL) }));
    expect(await forged.closed).toBe(CLOSE.badJoin);

    const first = connect(url, code);
    const { challenge } = JSON.parse(await first.next()) as { challenge: string };
    const replay = connect(url, code);
    await replay.next();
    replay.ws.send(JSON.stringify({ role: 'buyer', sig: sign(i.buyer, code, 'buyer', challenge) }));
    expect(await replay.closed).toBe(CLOSE.badJoin);

    const wrongRole = connect(url, code);
    const w = JSON.parse(await wrongRole.next()) as { challenge: string };
    wrongRole.ws.send(JSON.stringify({ role: 'seller', sig: sign(i.buyer, code, 'seller', w.challenge) }));
    expect(await wrongRole.closed).toBe(CLOSE.badJoin);
  });

  it('closes 4404 for an unknown trade, after the challenge', async () => {
    const { url } = await start();
    const code = newTradeCode();
    const i = await ids();
    const c = connect(url, code);
    const { challenge } = JSON.parse(await c.next()) as { challenge: string };
    c.ws.send(JSON.stringify({ role: 'buyer', sig: sign(i.buyer, code, 'buyer', challenge) }));
    expect(await c.closed).toBe(CLOSE.unknownTrade);
  });

  it('closes 4401 when no join arrives in time, and never forwards pre-auth frames', async () => {
    const { relay, url } = await start({ joinTimeoutMs: 200 });
    const code = newTradeCode();
    const i = await ids();
    register(relay, code, i);
    const s = await join(url, code, 'seller', i.seller);
    const idle = connect(url, code);
    await idle.next();
    expect(await idle.closed).toBe(CLOSE.badJoin);
    const early = connect(url, code);
    await early.next();
    early.ws.send(envelope(code, 'buyer', 1));
    expect(await early.closed).toBe(CLOSE.badJoin);
    expect(s.frames).toEqual([]);
    expect(relay.stats().queuedFrames).toBe(0);
  });

  it('replaces an older socket for the same role with close 4409', async () => {
    const { relay, url } = await start();
    const code = newTradeCode();
    const i = await ids();
    register(relay, code, i);
    const old = await join(url, code, 'buyer', i.buyer);
    const fresh = await join(url, code, 'buyer', i.buyer);
    expect(await old.closed).toBe(CLOSE.replaced);
    const s = await join(url, code, 'seller', i.seller);
    const e = envelope(code, 'seller', 1);
    s.ws.send(e);
    expect(await fresh.next()).toBe(e);
  });

  it('tells the sender when a queue is full and never evicts older frames', async () => {
    const { relay, url } = await start({ maxQueuedPerTrade: 4 });
    const code = newTradeCode();
    const i = await ids();
    register(relay, code, i);
    const b = await join(url, code, 'buyer', i.buyer);
    for (const n of [1, 2, 3]) b.ws.send(envelope(code, 'buyer', n));
    expect(JSON.parse(await b.next())).toEqual({ type: 'queue-full', seq: 3 });
    const s = await join(url, code, 'seller', i.seller);
    expect(await s.next()).toBe(envelope(code, 'buyer', 1));
    expect(await s.next()).toBe(envelope(code, 'buyer', 2));
  });

  it('closes 4429 when a client sends too fast', async () => {
    const { relay, url } = await start({ rateBurst: 3, rateRefillPerSec: 0.001 });
    const code = newTradeCode();
    const i = await ids();
    register(relay, code, i);
    const b = await join(url, code, 'buyer', i.buyer);
    for (const n of [1, 2, 3, 4]) b.ws.send(envelope(code, 'buyer', n));
    expect(await b.closed).toBe(CLOSE.rateLimited);
  });

  it('caps unauthenticated sockets with close 1013', async () => {
    const { url } = await start({ maxUnauthenticated: 1 });
    const code = newTradeCode();
    const first = connect(url, code);
    await first.next();
    const second = connect(url, code);
    expect(await second.closed).toBe(CLOSE.full);
  });

  it('refuses trades beyond its limit and bad registrations', async () => {
    const { relay } = await start();
    const i = await ids();
    for (let n = 0; n < relay.limits.maxTrades; n++) register(relay, newTradeCode(), i);
    expect(() => register(relay, newTradeCode(), i)).toThrow(RelayAtCapacityError);
    const { relay: r2 } = await start();
    const code = newTradeCode();
    register(r2, code, i);
    expect(() => register(r2, code, i)).toThrow(/already registered/);
    expect(() => r2.registerTrade('nope', { buyer: '', seller: '', mod: '' })).toThrow(TypeError);
    expect(() => r2.registerTrade(newTradeCode(), { buyer: 'zz', seller: i.seller.signPublic, mod: i.mod.signPublic })).toThrow(TypeError);
  });

  it('never logs trade codes, contents or addresses', async () => {
    const { relay, url } = await start({ maxEnvelopeBytes: 4096 });
    const code = newTradeCode();
    const i = await ids();
    register(relay, code, i);
    const b = await join(url, code, 'buyer', i.buyer);
    b.ws.send(envelope(code, 'buyer', 1, 'secret-content'));
    b.ws.send('garbage');
    await b.closed;
    const text = JSON.stringify(logs);
    expect(logs.length).toBeGreaterThan(0);
    for (const needle of [code, code.replaceAll('-', ''), 'secret-content', '127.0.0.1']) expect(text).not.toContain(needle);
    for (const e of logs) expect(Object.keys(e)).toEqual(['reason']);
  });

  it('answers the health check', async () => {
    const { relay } = await start();
    const res = await relay.app.inject({ method: 'GET', url: '/healthz' });
    expect(res.json()).toEqual({ ok: true });
  });
});

describe('exactCopy', () => {
  it('copies into a buffer of exactly the frame size', () => {
    for (const n of [300, 200_000]) {
      const big = Buffer.alloc(n + 100, 7);
      const slice = big.subarray(50, 50 + n);
      const copy = exactCopy(slice);
      expect(copy.byteOffset).toBe(0);
      expect(copy.buffer.byteLength).toBe(n);
      expect(copy.equals(slice)).toBe(true);
    }
  });
});
