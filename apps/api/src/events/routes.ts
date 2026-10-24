import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireSession } from '../auth/sessions.js';
import { ApiError } from '../errors.js';
import type { EventBus } from './bus.js';

export interface EventStreamOptions {
  /** A comment line this often keeps proxies and NATs from dropping an idle stream. */
  heartbeatMs?: number;
  /**
   * The server ends each stream after this long. The browser reconnects at once, and the new
   * request runs `requireTrader` again, so a logged-out, disabled or Terms-stale session stops
   * receiving within this bound.
   */
  maxStreamMs?: number;
}

export const HEARTBEAT_MS = 25_000;
export const MAX_STREAM_MS = 10 * 60_000;
/** Sent as the SSE `retry:` field: how long the browser waits before reconnecting. */
const RETRY_MS = 3000;

/**
 * `GET /v1/events` (Task 19): Server-Sent Events for the session's own account only (P3-M9).
 * `requireTrader` (full session, trader, not disabled, current Terms): recovery and held sessions
 * are refused by it. Over the caps → 429 `busy`. Nothing about a stream is logged.
 */
export function eventRoutes(app: FastifyInstance, bus: EventBus, o: EventStreamOptions = {}): void {
  const heartbeatMs = o.heartbeatMs ?? HEARTBEAT_MS;
  const maxStreamMs = o.maxStreamMs ?? MAX_STREAM_MS;
  const requireTrader = requireSession({ kinds: ['trader'] });

  app.get('/v1/events', { preHandler: requireTrader }, (req: FastifyRequest, reply: FastifyReply) => {
    const raw = reply.raw;
    let heartbeat: NodeJS.Timeout | undefined;
    let lifetime: NodeJS.Timeout | undefined;
    let ended = false;
    let detach: (() => void) | null = null;

    const end = () => {
      if (ended) return;
      ended = true;
      clearInterval(heartbeat);
      clearTimeout(lifetime);
      detach?.();
      if (!raw.writableEnded) raw.end();
    };

    detach = bus.attach(req.auth.accountId, {
      send(data) {
        if (ended || raw.destroyed) throw new Error('stream closed');
        raw.write(data);
      },
      close: end,
    });
    if (!detach) throw new ApiError(429, 'busy');

    // From here fastify no longer owns the response. The headers set by the onRequest hooks
    // (SECURITY_HEADERS, cache-control) are carried over by hand.
    reply.hijack();
    raw.writeHead(200, {
      ...(reply.getHeaders() as Record<string, string>),
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
      connection: 'keep-alive',
    });
    raw.write(`retry: ${RETRY_MS}\n\n`);
    heartbeat = setInterval(() => {
      if (!ended && !raw.destroyed) raw.write(':\n\n');
    }, heartbeatMs);
    lifetime = setTimeout(end, maxStreamMs);
    // The response's 'close' fires when the client goes away (the request's own 'close' fires as
    // soon as its empty body has been read, so it is not used).
    raw.on('close', end);
  });

  // preClose: before the server waits for its connections, or open streams would hold it up.
  app.addHook('preClose', async () => {
    bus.closeAll();
  });
}
