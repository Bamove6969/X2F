import { createHmac, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Deps } from '../app.js';
import { subkey } from '../config.js';
import type { Queryable } from '../db/pool.js';

/** Attributes every X2F cookie carries; `__Host-` names also require Secure, Path=/ and no Domain. */
export const COOKIE_ATTRS = { httpOnly: true, secure: true, sameSite: 'strict', path: '/' } as const;

export const DEVICE_COOKIE = '__Host-x2f_dev';
const DEVICE_MAX_AGE_S = 400 * 24 * 3600;
/** 32 random bytes, base64url without padding. */
const VALUE = /^[A-Za-z0-9_-]{43}$/;

/** Device cookies minted while handling a request, so the same request can use the new value. */
const minted = new WeakMap<FastifyRequest, string>();

function cookieValue(req: FastifyRequest): string | null {
  const v = req.cookies?.[DEVICE_COOKIE];
  if (typeof v === 'string' && VALUE.test(v)) return v;
  return minted.get(req) ?? null;
}

/**
 * HMAC-SHA-256 of this browser's device cookie under `subkey('device')` (the cookie itself is never
 * stored), or null when the request has none. A cookie set earlier in the same request counts.
 */
export function deviceHash(req: FastifyRequest): Buffer | null {
  const value = cookieValue(req);
  if (value === null) return null;
  return createHmac('sha256', subkey(req.server.deps.config, 'device')).update(value).digest();
}

/** Gives the browser a fresh random device cookie when it has none (or a malformed one). */
export function ensureDeviceCookie(req: FastifyRequest, reply: FastifyReply): void {
  if (cookieValue(req) !== null) return;
  const value = randomBytes(32).toString('base64url');
  minted.set(req, value);
  void reply.setCookie(DEVICE_COOKIE, value, { ...COOKIE_ATTRS, maxAge: DEVICE_MAX_AGE_S });
}

/** Marks the device as known for the account (after each successful login or register). */
export async function trustDevice(deps: { db: Queryable; clock: () => Date }, accountId: string, hash: Buffer): Promise<void> {
  const now = deps.clock();
  await deps.db.query(
    `insert into trusted_devices (account_id, device_hash, created_at, last_used_at) values ($1, $2, $3, $3)
     on conflict (account_id, device_hash) do update set last_used_at = excluded.last_used_at`,
    [accountId, hash, now],
  );
}

/** Devices unused this long stop counting as known (and `purgeExpired` deletes them). */
export const TRUSTED_DEVICE_TTL_MS = 90 * 24 * 3600_000;

export async function isTrusted(deps: Pick<Deps, 'db' | 'clock'>, accountId: string, hash: Buffer): Promise<boolean> {
  const since = new Date(deps.clock().getTime() - TRUSTED_DEVICE_TTL_MS);
  const { rows } = await deps.db.query(
    'select 1 from trusted_devices where account_id = $1 and device_hash = $2 and last_used_at > $3',
    [accountId, hash, since],
  );
  return rows.length > 0;
}
