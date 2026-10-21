import websocket from '@fastify/websocket';
import { ROLES, normalizeTradeCode, type Role } from '@x2f/core';
import { joinMessage } from '@x2f/protocol';
import Fastify, { type FastifyInstance } from 'fastify';
import sodium from 'libsodium-wrappers';
import type { RawData, WebSocket } from 'ws';
import { buildRelayAdmin, type AdminOptions } from './admin.js';
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
const PUMP_RETRY_MAX_MS = 1000;
/** After a close frame, wait this long for the client's reply, then cut the TCP connection. */
const CLOSE_GRACE_MS = 1000;

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
  pumpDelay: number;
  /** Replaced by a newer socket for the same role: an idle one is told 4409, a backlogged one cut. */
  retired(): void;
}

interface TradeState {
  keys: Record<Role, Uint8Array>;
  queues: Record<Role, { frame: Buffer; from: Role }[]>;
  queuedBytes: number;
  queuedFrames: number;
  /** Queued bytes per sender, so one party cannot fill the trade's whole queue share. */
  queuedBy: Record<Role, number>;
  sockets: Partial<Record<Role, Conn>>;
  closed: boolean;
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
  /**
   * The private admin listener (moderator-signed register and close), or null when built
   * without admin options. Listen on a private interface only.
   */
  admin: FastifyInstance | null;
}

/**
 * A blind relay for one trade's three parties. It authenticates each socket with a signed
 * join challenge, then passes envelopes byte for byte to the other two parties, queueing
 * for anyone offline until the trade closes. It never decrypts or verifies envelopes.
 * Delivery is at most once and in order per recipient; senders resend by seq.
 */
export async function buildRelay(overrides: Partial<RelayOptions> = {}, log: RelayLog = () => {}, admin?: AdminOptions): Promise<Relay> {
  await sodium.ready;
  const limits = deriveLimits(overrides);
  const trades = new Map<string, TradeState>();
  let connections = 0;
  let unauthenticated = 0;
  let totalQueuedBytes = 0;

  const app = Fastify({ logger: false });
  await app.register(websocket, { options: { maxPayload: limits.maxEnvelopeBytes } });
  app.get('/healthz', async () => ({ ok: true }));

  function dropQueue(trade: TradeState): void {
    totalQueuedBytes -= trade.queuedBytes;
    trade.queuedBytes = 0;
    trade.queuedFrames = 0;
    for (const r of ROLES) {
      trade.queues[r] = [];
      trade.queuedBy[r] = 0;
    }
  }

  /** Close with a code the client can read, then cut the connection if it doesn't answer. */
  function closeSoon(ws: WebSocket, code: number): void {
    if (ws.readyState === ws.OPEN) ws.close(code);
    setTimeout(() => ws.terminate(), CLOSE_GRACE_MS).unref();
  }

  /** Send queued frames while the peer's buffer has room; retry with backoff while any remain. */
  function pump(trade: TradeState, conn: Conn): void {
    const q = trade.queues[conn.role];
    let sent = 0;
    while (q.length > 0 && conn.ws.readyState === conn.ws.OPEN) {
      const { frame: next, from } = q[0]!;
      if (conn.ws.bufferedAmount + next.length > limits.maxPeerBufferedBytes) break;
      q.shift();
      trade.queuedBytes -= next.length;
      trade.queuedBy[from] -= next.length;
      trade.queuedFrames -= 1;
      totalQueuedBytes -= next.length;
      conn.ws.send(next, { binary: false });
      sent += 1;
    }
    conn.pumpDelay = sent > 0 ? PUMP_RETRY_MS : Math.min(conn.pumpDelay * 2, PUMP_RETRY_MAX_MS);
    if (q.length > 0 && conn.ws.readyState === conn.ws.OPEN && conn.pumpTimer === undefined) {
      conn.pumpTimer = setTimeout(() => {
        conn.pumpTimer = undefined;
        if (trade.sockets[conn.role] === conn) pump(trade, conn);
      }, conn.pumpDelay);
      conn.pumpTimer.unref();
    }
  }

  /** Deliver live if the recipient is caught up, else queue. False when the queue is full. */
  function deliver(trade: TradeState, to: Role, frame: Buffer, from: Role): boolean {
    if (trade.closed) return false;
    let peer = trade.sockets[to];
    // A peer that is closing would drop the frame silently; treat it as offline and queue.
    if (peer && peer.ws.readyState !== peer.ws.OPEN) {
      delete trade.sockets[to];
      peer = undefined;
    }
    const q = trade.queues[to];
    if (peer && q.length === 0) {
      if (peer.ws.bufferedAmount + frame.length <= limits.maxPeerBufferedBytes) {
        peer.ws.send(frame, { binary: false });
        return true;
      }
      log({ reason: 'slow-peer-4408' });
      delete trade.sockets[to];
      peer.ws.terminate();
    }
    if (
      trade.queuedFrames + 1 > limits.maxQueuedPerTrade ||
      trade.queuedBytes + frame.length > limits.perTradeQueueBytes ||
      trade.queuedBy[from] + frame.length > limits.perTradeQueueBytes / 2 ||
      totalQueuedBytes + frame.length > limits.totalQueueBytes
    ) {
      log({ reason: 'queue-full' });
      return false;
    }
    q.push({ frame, from });
    trade.queuedBytes += frame.length;
    trade.queuedBy[from] += frame.length;
    trade.queuedFrames += 1;
    totalQueuedBytes += frame.length;
    const live = trade.sockets[to];
    if (live && live.ws.readyState === live.ws.OPEN) pump(trade, live);
    return true;
  }

  app.get('/v1/trade/:code', { websocket: true }, (ws, req) => {
    if (connections >= limits.maxConnections || unauthenticated >= limits.maxUnauthenticated) {
      log({ reason: 'at-capacity' });
      closeSoon(ws, CLOSE.full);
      return;
    }
    connections += 1;
    unauthenticated += 1;
    let conn: Conn | undefined;
    let trade: TradeState | undefined;
    let joinTimer: NodeJS.Timeout | undefined;
    let dead = false;

    // Once rejected, a socket is dead: ws keeps emitting messages until the close handshake
    // ends, so every handler checks `dead` and nothing it sends is used.
    const fail = (code: number, reason: string): void => {
      if (dead) return;
      dead = true;
      log({ reason });
      clearTimeout(joinTimer);
      if (conn && trade && trade.sockets[conn.role] === conn) delete trade.sockets[conn.role];
      closeSoon(ws, code);
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
        old.retired();
      }
      unauthenticated -= 1;
      trade = t;
      conn = { ws, role, tokens: limits.rateBurst, refilledAt: Date.now(), pumpTimer: undefined, pumpDelay: PUMP_RETRY_MS, retired };
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
      for (const to of ROLES) if (to !== c.role && !deliver(t, to, frame, c.role)) full = true;
      if (full && ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'queue-full', seq: env.seq }));
    };

    const retired = (): void => {
      if (dead) return;
      dead = true;
      if (ws.bufferedAmount === 0) closeSoon(ws, CLOSE.replaced);
      else ws.terminate();
    };

    ws.on('message', (data: RawData, isBinary: boolean) => {
      if (dead || ws.readyState !== ws.OPEN) return;
      if (trade && trades.get(code) !== trade) return; // the trade was closed
      if (isBinary) {
        fail(conn ? CLOSE.badEnvelope : CLOSE.badJoin, 'binary-frame');
        return;
      }
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

  const relay: Omit<Relay, 'admin'> = {
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
      trades.set(code, { keys, queues: { buyer: [], seller: [], mod: [] }, queuedBytes: 0, queuedFrames: 0, queuedBy: { buyer: 0, seller: 0, mod: 0 }, sockets: {}, closed: false });
    },
    closeTrade(rawCode) {
      const code = normalizeTradeCode(rawCode);
      const t = code === null ? undefined : trades.get(code);
      if (!t || code === null) return;
      trades.delete(code);
      t.closed = true;
      dropQueue(t);
      for (const r of ROLES) {
        const s = t.sockets[r];
        delete t.sockets[r];
        if (s) closeSoon(s.ws, CLOSE.unknownTrade);
      }
    },
    stats() {
      let queuedFrames = 0;
      for (const t of trades.values()) queuedFrames += t.queuedFrames;
      return { trades: trades.size, connections, unauthenticated, queuedBytes: totalQueuedBytes, queuedFrames };
    },
  };
  return { ...relay, admin: admin ? await buildRelayAdmin(relay, admin, log) : null };
}
