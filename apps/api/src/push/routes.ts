import { createECDH } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { requireSession } from '../auth/sessions.js';
import { ApiError } from '../errors.js';
import { canonicalEndpoint } from './endpoint.js';
import { PUSH_SUBSCRIPTION_CAP } from './send.js';

const B64URL_P256 = /^[A-Za-z0-9_-]{87}$/;
const B64URL_AUTH = /^[A-Za-z0-9_-]{22}$/;

function refuse(): never {
  throw new ApiError(400, 'bad-request');
}

/** A push-service endpoint in canonical form (see `canonicalEndpoint`); anything else is refused. */
function checkEndpoint(raw: unknown): string {
  const url = canonicalEndpoint(raw);
  if (!url) refuse();
  return url.href;
}

/** The browser's P-256 public key: base64url of an uncompressed point that is on the curve. */
function checkP256dh(raw: unknown): string {
  if (typeof raw !== 'string' || !B64URL_P256.test(raw)) refuse();
  const point = Buffer.from(raw, 'base64url');
  if (point.length !== 65 || point[0] !== 0x04) refuse();
  try {
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    ecdh.computeSecret(point); // throws for a point that is not on the curve
  } catch {
    refuse();
  }
  return raw;
}

function checkAuth(raw: unknown): string {
  if (typeof raw !== 'string' || !B64URL_AUTH.test(raw) || Buffer.from(raw, 'base64url').length !== 16) refuse();
  return raw;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** `{ endpoint, keys: { p256dh, auth } }`, as `PushSubscription.toJSON()` gives it (its `expirationTime` allowed). */
function parseSubscription(body: unknown): { endpoint: string; p256dh: string; auth: string } {
  if (!isObject(body)) refuse();
  for (const k of Object.keys(body)) if (k !== 'endpoint' && k !== 'keys' && k !== 'expirationTime') refuse();
  const exp = body.expirationTime;
  if (exp !== undefined && exp !== null && typeof exp !== 'number') refuse();
  const keys = body.keys;
  if (!isObject(keys)) refuse();
  for (const k of Object.keys(keys)) if (k !== 'p256dh' && k !== 'auth') refuse();
  return { endpoint: checkEndpoint(body.endpoint), p256dh: checkP256dh(keys.p256dh), auth: checkAuth(keys.auth) };
}

/**
 * Task 19: `GET /v1/account/push` → `{ vapidPublic }` (what the browser subscribes with);
 * `POST /v1/account/push { endpoint, keys }` → 204; `DELETE /v1/account/push` with `{ endpoint }`
 * drops that subscription of the caller's, with no body all of them → 204. All `requireTrader`.
 * No answer ever repeats an endpoint or a key, and none is logged (the request body is redacted
 * from every log line by buildApi). A subscription belongs to the session that posted it and goes
 * when that session ends (migration 105's trigger; push/send.ts skips expired sessions).
 */
export function pushRoutes(app: FastifyInstance): void {
  const requireTrader = requireSession({ kinds: ['trader'] });

  app.get('/v1/account/push', { preHandler: requireTrader }, async () => ({ vapidPublic: app.deps.config.vapidPublic }));

  app.post('/v1/account/push', { preHandler: requireTrader }, async (req, reply) => {
    const sub = parseSubscription(req.body);
    const { db, clock } = app.deps;
    const accountId = req.auth.accountId;
    const client = await db.connect();
    try {
      await client.query('begin');
      try {
        // Serialises this account's posts, so the cap holds under concurrent requests.
        await client.query('select id from accounts where id = $1 for update', [accountId]);
        // The last account to post a browser's endpoint owns it (a shared or handed-on browser).
        await client.query(
          `insert into push_subscriptions (account_id, session_id, endpoint, p256dh, auth, created_at) values ($1, $2, $3, $4, $5, $6)
           on conflict (endpoint) do update
             set account_id = excluded.account_id, session_id = excluded.session_id, p256dh = excluded.p256dh,
                 auth = excluded.auth, created_at = excluded.created_at`,
          [accountId, req.auth.sessionId, sub.endpoint, sub.p256dh, sub.auth, clock()],
        );
        await client.query(
          `delete from push_subscriptions where id in (
             select id from push_subscriptions where account_id = $1 order by created_at desc, id desc offset $2)`,
          [accountId, PUSH_SUBSCRIPTION_CAP],
        );
        await client.query('commit');
      } catch (e) {
        await client.query('rollback');
        throw e;
      }
    } finally {
      client.release();
    }
    return reply.code(204).send();
  });

  app.delete('/v1/account/push', { preHandler: requireTrader }, async (req, reply) => {
    const body: unknown = req.body;
    if (body === undefined || body === null) {
      await app.deps.db.query('delete from push_subscriptions where account_id = $1', [req.auth.accountId]);
    } else {
      if (!isObject(body) || Object.keys(body).some((k) => k !== 'endpoint') || typeof body.endpoint !== 'string') refuse();
      await app.deps.db.query('delete from push_subscriptions where account_id = $1 and endpoint = $2', [
        req.auth.accountId, body.endpoint,
      ]);
    }
    return reply.code(204).send();
  });
}
