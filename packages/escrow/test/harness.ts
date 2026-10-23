// Shared fixtures for the regtest party tests (not a test file itself).
import { ROLES, newTradeCode, type Role } from '@x2f/core';
import { generateIdentity, type Envelope, type Identity, type Participants } from '@x2f/protocol';
import { mine } from '@x2f/regtest';
import type { Relay } from '@x2f/relay';
import { createServer, connect as tcpConnect, type Server, type Socket } from 'node:net';
import {
  EscrowError,
  runParty,
  wsTransport,
  type EscrowEngine,
  type EscrowSession,
  type PartyArgs,
  type PartyHandle,
  type PartyState,
  type PartyStore,
  type Transport,
} from '../src/index.js';

export type MemoryStore = PartyStore & { current(): PartyState | null; set(s: PartyState): void; onSave?: ((x: PartyState) => void) | undefined };

export function memoryStore(): MemoryStore {
  let s: PartyState | null = null;
  const store: MemoryStore = {
    load: async () => (s ? structuredClone(s) : null),
    save: async (x) => {
      s = structuredClone(x);
      store.onSave?.(x);
    },
    current: () => s,
    set: (x) => {
      s = structuredClone(x);
    },
  };
  return store;
}

export type Tap = Transport & { inject(f: unknown): void; seen: unknown[]; out: Envelope[]; dropSend: (n: number) => boolean; sent: number };

/** A transport that can be fed extra frames, records what it received, and can drop sends. */
export function tapped(inner: Transport): Tap {
  const injected: unknown[] = [];
  const seen: unknown[] = [];
  // An injected frame wakes a reader blocked on the relay; the relay read stays pending for later.
  let pending: Promise<{ v: unknown }> | null = null;
  let wake: (() => void) | null = null;
  const read = async (): Promise<unknown> => {
    for (;;) {
      if (injected.length > 0) return injected.shift();
      pending ??= inner.next().then(
        (v) => ({ v }),
        (e: unknown) => {
          pending = null;
          throw e;
        },
      );
      const woke = new Promise<null>((r) => (wake = () => r(null)));
      const got = await Promise.race([pending, woke]);
      wake = null;
      if (got !== null) {
        pending = null;
        return got.v;
      }
    }
  };
  const t: Tap = {
    sent: 0,
    out: [],
    dropSend: () => false,
    send: (e: Envelope) => {
      t.sent += 1;
      t.out.push(e);
      if (!t.dropSend(t.sent)) inner.send(e);
    },
    next: async () => {
      const f = await read();
      seen.push(f);
      return f;
    },
    onReconnect: (cb: () => void) => inner.onReconnect(cb),
    close: () => inner.close(),
    inject: (f: unknown) => {
      injected.push(f);
      wake?.();
    },
    seen,
  };
  return t;
}

export interface Trade {
  code: string;
  ids: Record<Role, Identity>;
  participants: Participants;
  stores: Record<Role, MemoryStore>;
  parties: Record<Role, PartyHandle>;
  taps: Record<Role, Tap>;
}

/** Starts parties over a real relay; every started party is stopped by `stopAll`. */
export function partyKit(o: { relay: () => Relay; relayUrl: () => string; daemonUri: () => string; engine: EscrowEngine }) {
  const running: PartyHandle[] = [];
  const ignoredBy: Record<Role, string[]> = { buyer: [], seller: [], mod: [] };

  function startParty(t: Pick<Trade, 'code' | 'ids' | 'participants' | 'stores'>, role: Role, over: Partial<PartyArgs> = {}) {
    const tap = tapped(wsTransport({ url: o.relayUrl(), code: t.code, role, me: t.ids[role] }));
    ignoredBy[role] = [];
    const party = runParty({
      role,
      trade: t.code,
      me: t.ids[role],
      participants: t.participants,
      transport: tap,
      engine: o.engine,
      daemonUri: o.daemonUri(),
      password: `pw-${role}`,
      store: t.stores[role],
      resendMs: 500,
      resendMaxMs: 2000,
      onIgnored: (reason) => ignoredBy[role].push(reason),
      ...over,
    });
    running.push(party);
    return { party, tap };
  }

  async function newTrade(over: Partial<Record<Role, Partial<PartyArgs>>> = {}): Promise<Trade> {
    const code = newTradeCode();
    const ids = { buyer: await generateIdentity(), seller: await generateIdentity(), mod: await generateIdentity() };
    const participants = Object.fromEntries(ROLES.map((r) => [r, { signPublic: ids[r].signPublic, boxPublic: ids[r].boxPublic }])) as Participants;
    o.relay().registerTrade(code, { buyer: ids.buyer.signPublic, seller: ids.seller.signPublic, mod: ids.mod.signPublic });
    const stores = { buyer: memoryStore(), seller: memoryStore(), mod: memoryStore() };
    const base = { code, ids, participants, stores };
    const started = Object.fromEntries(ROLES.map((r) => [r, startParty(base, r, over[r])])) as Record<Role, ReturnType<typeof startParty>>;
    return {
      ...base,
      parties: { buyer: started.buyer.party, seller: started.seller.party, mod: started.mod.party },
      taps: { buyer: started.buyer.tap, seller: started.seller.tap, mod: started.mod.tap },
    };
  }

  async function stopAll(): Promise<void> {
    for (const p of running.splice(0)) await p.stop();
  }

  return { startParty, newTrade, stopAll, ignoredBy };
}

/**
 * Mine a block every `everyMs` until `p` settles. A builder counts a release as done only once
 * the tx is in a block, so tests that wait for every party need blocks to keep coming.
 */
export async function minedWhile<T>(rpcUri: string, address: string, p: Promise<T>, everyMs = 1000): Promise<T> {
  let done = false;
  const miner = (async () => {
    while (!done) {
      await new Promise((r) => setTimeout(r, everyMs));
      if (!done) await mine(rpcUri, 1, address).catch(() => undefined);
    }
  })();
  try {
    return await p;
  } finally {
    done = true;
    await miner;
  }
}

/** Wraps an engine so every session call is counted; `maxInFlight` > 1 means calls interleaved. */
export function spyEngine(inner: EscrowEngine): EscrowEngine & { calls: Record<string, number>; maxInFlight: number } {
  let inFlight = 0;
  const spy = {
    calls: {} as Record<string, number>,
    maxInFlight: 0,
    wrap(s: EscrowSession): EscrowSession {
      return new Proxy(s, {
        get(target, key, receiver) {
          const v = Reflect.get(target, key, receiver) as unknown;
          if (typeof v !== 'function' || typeof key !== 'string') return v;
          return async (...args: unknown[]) => {
            spy.calls[key] = (spy.calls[key] ?? 0) + 1;
            inFlight += 1;
            spy.maxInFlight = Math.max(spy.maxInFlight, inFlight);
            try {
              return await (v as (...a: unknown[]) => Promise<unknown>).apply(target, args);
            } finally {
              inFlight -= 1;
            }
          };
        },
      });
    },
    create: async (a: { daemonUri: string; password: string }) => spy.wrap(await inner.create(a)),
    resume: async (saved: Parameters<EscrowEngine['resume']>[0], a: { daemonUri: string; password: string }) => spy.wrap(await inner.resume(saved, a)),
  };
  return spy;
}

/**
 * Wraps an engine so chosen session methods throw a retryable error for the calls a predicate
 * picks, then delegate to the real method. `calls` counts every call (fault or not). Lets a test
 * make, say, the first `submit` fail while every other call behaves, without touching the daemon.
 */
export function faultyEngine(
  inner: EscrowEngine,
  faults: Partial<Record<string, (nthCall: number) => boolean>>,
  err: () => Error = () => new EscrowError('daemon-unavailable', 'injected fault'),
): EscrowEngine & { calls: Record<string, number> } {
  const calls: Record<string, number> = {};
  const wrap = (s: EscrowSession): EscrowSession =>
    new Proxy(s, {
      get(target, key, receiver) {
        const v = Reflect.get(target, key, receiver) as unknown;
        if (typeof v !== 'function' || typeof key !== 'string') return v;
        return async (...args: unknown[]) => {
          calls[key] = (calls[key] ?? 0) + 1;
          if (faults[key]?.(calls[key])) throw err();
          return await (v as (...a: unknown[]) => Promise<unknown>).apply(target, args);
        };
      },
    });
  return {
    calls,
    create: async (a: { daemonUri: string; password: string }) => wrap(await inner.create(a)),
    resume: async (saved: Parameters<EscrowEngine['resume']>[0], a: { daemonUri: string; password: string }) => wrap(await inner.resume(saved, a)),
  };
}

/**
 * A TCP proxy in front of monerod that can stop answering: while `hold` is on, new
 * connections are accepted and never answered, and open ones are cut. `release()` turns
 * forwarding back on and drops the held sockets so stuck calls fail fast.
 */
export async function holdableProxy(target: string): Promise<{ uri: string; hold(): void; release(): void; close(): Promise<void> }> {
  const { hostname, port } = new URL(target);
  let holding = false;
  const held = new Set<Socket>();
  const live = new Set<Socket>();
  const server: Server = createServer((client) => {
    client.on('error', () => undefined);
    if (holding) {
      held.add(client);
      client.on('close', () => held.delete(client));
      return;
    }
    const upstream = tcpConnect(Number(port), hostname);
    upstream.on('error', () => client.destroy());
    client.on('close', () => upstream.destroy());
    upstream.on('close', () => client.destroy());
    live.add(client);
    client.on('close', () => live.delete(client));
    client.pipe(upstream).pipe(client);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  const uri = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  return {
    uri,
    hold() {
      holding = true;
      for (const s of live) s.destroy();
    },
    release() {
      holding = false;
      for (const s of held) s.destroy();
    },
    async close() {
      for (const s of [...held, ...live]) s.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

/** A server that accepts connections and never answers. */
export async function blackHole(): Promise<{ uri: string; close(): Promise<void> }> {
  const held = new Set<Socket>();
  const server = createServer((s) => {
    s.on('error', () => undefined);
    held.add(s);
    s.on('close', () => held.delete(s));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  return {
    uri: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`,
    async close() {
      for (const s of held) s.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
