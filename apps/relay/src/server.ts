import websocket from '@fastify/websocket';
import { ROLES, normalizeTradeCode, type Role } from '@x2f/core';
import { joinMessage } from '@x2f/protocol';
import Fastify, { type FastifyInstance } from 'fastify';
import sodium from 'libsodium-wrappers';
import type { RawData, WebSocket } from 'ws';
import { deriveLimits, type RelayLimits, type RelayOptions } from './limits.js';

/** WebSocket close codes the relay uses. */
export const CLOSE = {
  tooLarge: 1009,
  full: 1013,
  badEnvelope: 4400,
  badJoin: 4401,
  unknownTrade: 4404,
  slowPeer: 4408,
  replaced: 4409,
  rateLimited: 4429,
} as const;

const ENVELOPE_KEYS = ['v', 'trade', 'from', 'seq', 'slots', 'nonce', 'kh', 'ct', 'ctNonce', 'sig'] as const;
const PUMP_RETRY_MS = 10;
const REPLACE_GRACE_MS = 1000;

export class RelayAtCapacityError extends Error {
  constructor() {
    super('relay is at its trade limit');
    this.name = 'RelayAtCapacityError';
  }
}

/** Log events carry a reason and counts only: never contents, IPs or trade codes. */
export type RelayLog = (event: { reason: string }) => void;

/**
 * A frame copied into its own exact-size buffer. Buffer.from pools small frames into
 * shared 8 KiB slabs, so a queued 300-byte frame could keep a whole slab alive.
 */
export function exactCopy(data: Uint8Array): Buffer {
  const out = Buffer.allocUnsafeSlow(data.length);
  out.set(data);
  return out;
}

function toBytes(data: RawData): Buffer {
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.isBuffer(data) ? data : Buffer.from(data);
}

function isRole(x: unknown): x is Role {
  return typeof x === 'string' && (ROLES as readonly string[]).includes(x);
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const proto = Object.getPrototypeOf(x) as unknown;
  return proto === Object.prototype || proto === null;
}

function hasExactKeys(o: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(o);
  return own.length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(o, k));
}

interface Conn {
  ws: WebSocket;
  role: Role;
  tokens: number;
  refilledAt: number;
  pumpTimer: NodeJS.Timeout | undefined;
}

interface TradeState {
  keys: Record<Role, Uint8Array>;
  queues: Record<Role, Buffer[]>;
  queuedBytes: number;
  queuedFrames: number;
  sockets: Partial<Record<Role, Conn>>;
}

export interface RelayStats {
  trades: number;
  connections: number;
  unauthenticated: number;
  queuedBytes: number;
  queuedFrames: number;
}

export interface Relay {
  app: FastifyInstance;
  limits: RelayLimits;
  /** Register a trade's participants by their Ed25519 signing keys (hex). In-process only. */
  registerTrade(code: string, signPublics: Record<Role, string>): void;
  /** The trade ended (completed, cancelled, refunded or ruled): delete its queue, close sockets. */
  closeTrade(code: string): void;
  stats(): RelayStats;
}

/**
 * A blind relay for one trade's three parties. It authenticates each socket with a signed
 * join challenge, then passes envelopes byte for byte to the other two parties, queueing
 * for anyone offline until the trade closes. It never decrypts or verifies envelopes.
 * Delivery is at most once and in order per recipient; senders resend by seq.
 */
export async function buildRelay(overrides: Partial<RelayOptions> = {}, log: RelayLog = () => {}): Promise<Relay> {
  await sodium.ready;
  const limits = deriveLimits(overrides);
  const trades = new Map<string, TradeState>();
  let connections = 0;
  let unauthenticated = 0;
  let totalQueuedBytes = 0;

  const app = Fastify({ logger: false, disableRequestLogging: true });
  await app.register(websocket, { options: { maxPayload: limits.maxEnvelopeBytes } });
  app.get('/healthz', async () => ({ ok: true }));

  function dropQueue(trade: TradeState): void {
    totalQueuedBytes -= trade.queuedBytes;
    trade.queuedBytes = 0;
    trade.queuedFrames = 0;
    for (const r of ROLES) trade.queues[r] = [];
  }

  /** Send queued frames while the peer's buffer has room; retry shortly while any remain. */
  function pump(trade: TradeState, conn: Conn): void {
    const q = trade.queues[conn.role];
    while (q.length > 0 && conn.ws.readyState === conn.ws.OPEN) {
      const next = q[0]!;
      if (conn.ws.bufferedAmount + next.length > limits.maxPeerBufferedBytes) break;
      q.shift();
      trade.queuedBytes -= next.length;
      trade.queuedFrames -= 1;
      totalQueuedBytes -= next.length;
      conn.ws.send(next, { binary: false });
    }
    if (q.length > 0 && conn.ws.readyState === conn.ws.OPEN && conn.pumpTimer === undefined) {
      conn.pumpTimer = setTimeout(() => {
        conn.pumpTimer = undefined;
        if (trade.sockets[conn.role] === conn) pump(trade, conn);
      }, PUMP_RETRY_MS);
      conn.pumpTimer.unref();
    }
  }

  /** Deliver live if the recipient is caught up, else queue. False when the queue is full. */
  function deliver(trade: TradeState, to: Role, frame: Buffer): boolean {
    const peer = trade.sockets[to];
    const q = trade.queues[to];
    if (peer && q.length === 0) {
      if (peer.ws.bufferedAmount + frame.length <= limits.maxPeerBufferedBytes) {
        peer.ws.send(frame, { binary: false });
        return true;
      }
      log({ reason: 'slow-peer' });
      peer.ws.terminate();
    }
    if (
      trade.queuedFrames + 1 > limits.maxQueuedPerTrade ||
      trade.queuedBytes + frame.length > limits.perTradeQueueBytes ||
      totalQueuedBytes + frame.length > limits.totalQueueBytes
    ) {
      log({ reason: 'queue-full' });
      return false;
    }
    q.push(frame);
    trade.queuedBytes += frame.length;
    trade.queuedFrames += 1;
    totalQueuedBytes += frame.length;
    const live = trade.sockets[to];
    if (live && live.ws.readyState === live.ws.OPEN) pump(trade, live);
    return true;
  }

  app.get('/v1/trade/:code', { websocket: true }, (ws, req) => {
    if (connections >= limits.maxConnections || unauthenticated >= limits.maxUnauthenticated) {
      log({ reason: 'at-capacity' });
      ws.close(CLOSE.full);
      return;
    }
    connections += 1;
    unauthenticated += 1;
    let conn: Conn | undefined;
    let trade: TradeState | undefined;
    let joinTimer: NodeJS.Timeout | undefined;

    const fail = (code: number, reason: string): void => {
      log({ reason });
      ws.close(code);
    };

    ws.on('close', () => {
      connections -= 1;
      if (!conn) unauthenticated -= 1;
      clearTimeout(joinTimer);
      if (conn?.pumpTimer) clearTimeout(conn.pumpTimer);
      if (conn && trade && trade.sockets[conn.role] === conn) delete trade.sockets[conn.role];
    });
    ws.on('error', (e: Error & { code?: string }) => {
      log({ reason: e.code === 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH' ? 'too-large' : 'socket-error' });
    });

    const raw = (req.params as { code?: unknown }).code;
    const code = typeof raw === 'string' ? normalizeTradeCode(raw) : null;
    if (code === null) {
      fail(CLOSE.badEnvelope, 'bad-code');
      return;
    }
    const challenge = sodium.to_base64(sodium.randombytes_buf(32), sodium.base64_variants.ORIGINAL);
    ws.send(JSON.stringify({ type: 'challenge', challenge }));
    joinTimer = setTimeout(() => fail(CLOSE.badJoin, 'join-timeout'), limits.joinTimeoutMs);
    joinTimer.unref();

    const join = (bytes: Buffer): void => {
      clearTimeout(joinTimer);
      let msg: unknown;
      try {
        msg = JSON.parse(bytes.toString('utf8'));
      } catch {
        fail(CLOSE.badJoin, 'bad-join');
        return;
      }
      if (!isPlainObject(msg) || !hasExactKeys(msg, ['role', 'sig']) || !isRole(msg.role) || typeof msg.sig !== 'string') {
        fail(CLOSE.badJoin, 'bad-join');
        return;
      }
      const role = msg.role;
      let sig: Uint8Array;
      try {
        sig = sodium.from_base64(msg.sig, sodium.base64_variants.ORIGINAL);
      } catch {
        fail(CLOSE.badJoin, 'bad-join');
        return;
      }
      const t = trades.get(code);
      if (!t) {
        fail(CLOSE.unknownTrade, 'unknown-trade');
        return;
      }
      if (sig.length !== 64 || !sodium.crypto_sign_verify_detached(sig, joinMessage(code, role, challenge), t.keys[role])) {
        fail(CLOSE.badJoin, 'bad-join');
        return;
      }
      if (trades.get(code) !== t) {
        fail(CLOSE.unknownTrade, 'unknown-trade');
        return;
      }
      // One live socket per (trade, role): an idle old socket is told politely, a backlogged one cut.
      const old = t.sockets[role];
      if (old) {
        log({ reason: 'replaced' });
        if (old.ws.bufferedAmount === 0) {
          old.ws.close(CLOSE.replaced);
          setTimeout(() => old.ws.terminate(), REPLACE_GRACE_MS).unref();
        } else {
          old.ws.terminate();
        }
      }
      unauthenticated -= 1;
      trade = t;
      conn = { ws, role, tokens: limits.rateBurst, refilledAt: Date.now(), pumpTimer: undefined };
      t.sockets[role] = conn;
      ws.send(JSON.stringify({ type: 'joined' }));
      pump(t, conn);
    };

    const relay = (bytes: Buffer, c: Conn, t: TradeState): void => {
      const now = Date.now();
      c.tokens = Math.min(limits.rateBurst, c.tokens + ((now - c.refilledAt) / 1000) * limits.rateRefillPerSec);
      c.refilledAt = now;
      if (c.tokens < 1) {
        fail(CLOSE.rateLimited, 'rate-limited');
        return;
      }
      c.tokens -= 1;
      let env: unknown;
      try {
        env = JSON.parse(bytes.toString('utf8'));
      } catch {
        fail(CLOSE.badEnvelope, 'bad-envelope');
        return;
      }
      if (!isPlainObject(env) || !hasExactKeys(env, ENVELOPE_KEYS) || env.trade !== code || env.from !== c.role) {
        fail(CLOSE.badEnvelope, 'bad-envelope');
        return;
      }
      const frame = exactCopy(bytes);
      let full = false;
      for (const to of ROLES) if (to !== c.role && !deliver(t, to, frame)) full = true;
      if (full && ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'queue-full', seq: env.seq }));
    };

    ws.on('message', (data: RawData) => {
      const bytes = toBytes(data);
      // The first message must be the join; a failed join closes the socket, so nothing
      // sent before authentication is ever queued or forwarded.
      if (!conn || !trade) {
        join(bytes);
        return;
      }
      relay(bytes, conn, trade);
    });
  });

  return {
    app,
    limits,
    registerTrade(rawCode, signPublics) {
      const code = normalizeTradeCode(rawCode);
      if (code === null) throw new TypeError('registerTrade: invalid trade code');
      if (trades.has(code)) throw new Error('registerTrade: trade already registered');
      if (trades.size >= limits.maxTrades) throw new RelayAtCapacityError();
      const keys = {} as Record<Role, Uint8Array>;
      for (const r of ROLES) {
        const hex = signPublics[r];
        if (typeof hex !== 'string' || !/^[0-9a-f]{64}$/.test(hex)) throw new TypeError(`registerTrade: bad key for ${r}`);
        keys[r] = sodium.from_hex(hex);
      }
      trades.set(code, { keys, queues: { buyer: [], seller: [], mod: [] }, queuedBytes: 0, queuedFrames: 0, sockets: {} });
    },
    closeTrade(rawCode) {
      const code = normalizeTradeCode(rawCode);
      const t = code === null ? undefined : trades.get(code);
      if (!t || code === null) return;
      trades.delete(code);
      dropQueue(t);
      for (const r of ROLES) t.sockets[r]?.ws.close(CLOSE.unknownTrade);
    },
    stats() {
      let queuedFrames = 0;
      for (const t of trades.values()) queuedFrames += t.queuedFrames;
      return { trades: trades.size, connections, unauthenticated, queuedBytes: totalQueuedBytes, queuedFrames };
    },
  };
}
