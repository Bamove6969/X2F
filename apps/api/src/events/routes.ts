import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireSession } from '../auth/sessions.js';
import { ApiError } from '../errors.js';
import type { EventBus } from './bus.js';

export interface EventStreamOptions {
  /** A comment line this often keeps proxies and NATs from dropping an idle stream. */
  heartbeatMs?: number;
  /**
   * The server ends each stream after this long (or at the session's own deadline, if sooner).
   * The browser reconnects at once, and the new request runs `requireTrader` again, so a
   * logged-out, disabled or Terms-stale session stops receiving within this bound.
   */
  maxStreamMs?: number;
  /**
   * Tests only: runs after the stream is attached and before the session is checked again, the
   * window in which a revoke could otherwise go unnoticed.
   */
  afterAttach?: () => Promise<void>;
}

export const HEARTBEAT_MS = 25_000;
export const MAX_STREAM_MS = 10 * 60_000;
/** Sent as the SSE `retry:` field: how long the browser waits before reconnecting. */
const RETRY_MS = 3000;

/**
 * `GET /v1/events` (Task 19): Server-Sent Events for the session's own account only (P3-M9).
 * `requireTrader` (full session, trader, not disabled, current Terms): recovery and held sessions
 * are refused by it. Over the caps → 429 `busy`. Nothing about a stream is logged.
 *
 * The check is read-only (`touch: false`): opening or reconnecting a stream is the browser's doing,
 * not the user's, so it never refreshes `last_seen_at` or `expires_at` (spec 6.3, the logout
 * timer). A stream also ends at the session's deadline when that is sooner than `maxStreamMs`,
 * and the reconnect is then refused with 401 (review 2026-10-27, Important 1).
 */
export function eventRoutes(app: FastifyInstance, bus: EventBus, o: EventStreamOptions = {}): void {
  const heartbeatMs = o.heartbeatMs ?? HEARTBEAT_MS;
  const maxStreamMs = o.maxStreamMs ?? MAX_STREAM_MS;
  // The account owner, or a team member with Trades (Plan 2 Task 18): the stream carries the account's trade events.
  const requireTrader = requireSession({ kinds: ['trader'], touch: false, member: 'trades' });

  app.get('/v1/events', { preHandler: requireTrader }, async (req: FastifyRequest, reply: FastifyReply) => {
    const raw = reply.raw;
    let heartbeat: NodeJS.Timeout | undefined;
    let lifetime: NodeJS.Timeout | undefined;
    let ended = false;
    let started = false;
    let detach: (() => void) | null = null;
    // Events published before the headers are written wait here, then go out in order.
    const pending: string[] = [];

    const end = () => {
      if (ended) return;
      ended = true;
      clearInterval(heartbeat);
      clearTimeout(lifetime);
      detach?.();
      if (started && !raw.writableEnded) raw.end();
    };

    // The client may have gone while the session was checked: take no stream slot for it.
    if (raw.destroyed || req.raw.socket?.destroyed) {
      reply.hijack();
      return;
    }

    detach = bus.attach(req.auth.accountId, {
      send(data) {
        if (ended || raw.destroyed) throw new Error('stream closed');
        if (started) raw.write(data);
        else pending.push(data);
      },
      close: end,
    }, req.auth.sessionId, { member: req.auth.memberId !== null });
    if (!detach) throw new ApiError(429, 'busy');

    // Check the session again now that the stream is attached (security review, TOCTOU): a
    // session revoked after requireTrader read it, but before attach, would otherwise stream
    // until maxStreamMs, because its closeSession found nothing to close. A revoke after this
    // check finds the stream attached and closes it.
    await o.afterAttach?.();
    const { db, clock } = req.server.deps;
    let live = false;
    try {
      const { rows } = await db.query('select 1 from sessions where id = $1 and revoked_at is null and expires_at > $2', [
        req.auth.sessionId, clock(),
      ]);
      live = rows.length > 0;
    } catch (e) {
      end();
      throw e;
    }
    if (!live || ended) {
      end();
      throw new ApiError(401, 'not-authenticated');
    }
    if (raw.destroyed) {
      end();
      reply.hijack();
      return;
    }

    // From here fastify no longer owns the response. The headers set by the onRequest hooks
    // (SECURITY_HEADERS, cache-control) are carried over by hand.
    reply.hijack();
    started = true;
    raw.writeHead(200, {
      ...(reply.getHeaders() as Record<string, string>),
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
      connection: 'keep-alive',
    });
    raw.write(`retry: ${RETRY_MS}\n\n`);
    for (const data of pending.splice(0)) raw.write(data);
    heartbeat = setInterval(() => {
      if (!ended && !raw.destroyed) raw.write(':\n\n');
    }, heartbeatMs);
    lifetime = setTimeout(end, Math.max(0, Math.min(maxStreamMs, req.auth.expiresAt.getTime() - clock().getTime())));
    // The response's 'close' fires when the client goes away (the request's own 'close' fires as
    // soon as its empty body has been read, so it is not used).
    raw.on('close', end);
  });

  // preClose: before the server waits for its connections, or open streams would hold it up.
  app.addHook('preClose', async () => {
    bus.closeAll();
  });
}
