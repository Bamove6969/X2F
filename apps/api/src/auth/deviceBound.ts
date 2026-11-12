import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify, type KeyObject } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { Config } from '../config.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { COOKIE_ATTRS } from './device.js';
import { requireSession } from './sessions.js';

/**
 * S-085 device-bound sessions (owner, 30 Oct 2026; docs/superpowers/specs/2026-11-12-device-bound-sessions.md),
 * the DBSC-style short-lived bound cookie:
 *
 * - The browser keeps a non-extractable ECDSA P-256 key (WebCrypto, in IndexedDB) and sends its
 *   public key (SPKI, base64url) in `X2F-Session-Key` with its login. `openSession` binds the new
 *   session to it (`sessions.bound_key`) and sets the first bound cookie. The key is fixed for the
 *   life of the session: no route changes or removes it.
 * - A bound session also needs `__Host-x2f_bound`, valid `BOUND_TTL_MS` (`requireSession` answers
 *   401 `session-proof-required` otherwise). Only the two proof routes here run without it: a
 *   single-use challenge, and a signature over `proofMessage(challenge)` that renews the cookie.
 *   A copied session cookie (with or without a copied bound cookie) is dead within BOUND_TTL_MS.
 * - Behind `X2F_DEVICE_BOUND_SESSIONS` (off by default): off, the header is ignored, nothing new is
 *   checked even on a bound session (the kill switch), and both routes answer 404.
 * - Trader sessions only: a staff login's header is ignored (staff-web is not wired, spec section 8).
 */

export const SESSION_KEY_HEADER = 'x2f-session-key';
export const BOUND_COOKIE = '__Host-x2f_bound';
/** How long a bound cookie proves the key (spec section 8, question 3). */
export const BOUND_TTL_MS = 10 * 60_000;
/** How long a proof challenge may be answered. */
export const PROOF_CHALLENGE_TTL_MS = 2 * 60_000;

/** The exact bytes signed (UTF-8): a fixed context string, so the key signs nothing else of ours. */
export const proofMessage = (challenge: string): string => `x2f-session-proof-v1:${challenge}`;

export const boundSessionsOn = (config: Pick<Config, 'deviceBoundSessions'>): boolean => config.deviceBoundSessions === true;

const B64URL = /^[A-Za-z0-9_-]+$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
/** An ECDSA P-256 signature in WebCrypto's IEEE-P1363 form: r || s, 32 bytes each. */
const SIG = /^[A-Za-z0-9_-]{86}$/;
const hash = (v: string): Buffer => createHash('sha256').update(v).digest();

function p256(der: Buffer): KeyObject | null {
  try {
    const k = createPublicKey({ key: der, format: 'der', type: 'spki' });
    return k.asymmetricKeyType === 'ec' && k.asymmetricKeyDetails?.namedCurve === 'prime256v1' ? k : null;
  } catch {
    return null;
  }
}

/**
 * The public key a login asks its session to be bound to, as SPKI DER, or null (flag off, a staff
 * login, or no header). A header that is there but not a P-256 SPKI key is 400 `bad-request`: the
 * browser asked for binding and must not be left believing it got it.
 */
export function sessionKeyOf(req: FastifyRequest, app: 'trader' | 'staff'): Buffer | null {
  if (!boundSessionsOn(req.server.deps.config) || app !== 'trader') return null;
  const raw = req.headers[SESSION_KEY_HEADER];
  if (raw === undefined) return null;
  if (typeof raw !== 'string' || raw.length > 300 || !B64URL.test(raw)) throw new ApiError(400, 'bad-request');
  const der = Buffer.from(raw, 'base64url');
  const key = der.length >= 26 && der.length <= 200 ? p256(der) : null;
  if (key === null) throw new ApiError(400, 'bad-request');
  return key.export({ type: 'spki', format: 'der' });
}

/** A fresh bound cookie for the session, stored as its hash; returns the setter to run after commit. */
export async function issueBoundCookie(db: Queryable, sessionId: string, now: Date, reply: FastifyReply): Promise<() => void> {
  const token = randomBytes(32).toString('base64url');
  await db.query('update sessions set bound_token_hash = $2, bound_until = $3 where id = $1', [sessionId, hash(token), new Date(now.getTime() + BOUND_TTL_MS)]);
  return () => void reply.setCookie(BOUND_COOKIE, token, { ...COOKIE_ATTRS, maxAge: Math.floor(BOUND_TTL_MS / 1000) });
}

/** Whether the request's bound cookie is the session's current one and still valid. */
export function boundCookieValid(req: FastifyRequest, stored: Buffer | null, until: Date | null, now: Date): boolean {
  const v = req.cookies?.[BOUND_COOKIE];
  if (typeof v !== 'string' || !TOKEN.test(v) || stored === null || until === null) return false;
  if (now.getTime() >= until.getTime()) return false;
  const h = hash(v);
  return h.length === stored.length && timingSafeEqual(h, stored);
}

/** 404 unless the flag is on (registered first, so a caller learns nothing more with it off). */
const flagGate: preHandlerAsyncHookHandler = async function (req) {
  if (!boundSessionsOn(req.server.deps.config)) throw new ApiError(404, 'not-found');
};

/**
 * `POST /v1/account/session/proof/challenge` → `{ challenge }` (409 `not-bound` for an unbound
 * session); `POST /v1/account/session/proof { challenge, signature }` → `{ boundUntil }` and a new
 * bound cookie, or 401 `proof-invalid`. The challenge is cleared by any answer to it (single use).
 * Both take any live session of the account, a member's, a recovery or held one, or one on stale
 * Terms (`allowUnproven`), and touch nothing: keeping the proof fresh is not the person's activity.
 */
export function deviceBoundRoutes(app: FastifyInstance): void {
  // Built here, as a literal `requireSession({ … member: … })`, so team.test.ts's source scan sees
  // these as member-allowed routes (both are recorded exemptions there: the member's own session).
  const session = requireSession({ allowRecovery: true, allowHeld: true, allowStaleTerms: true, member: 'any', touch: false, allowUnproven: true });

  app.post('/v1/account/session/proof/challenge', { preHandler: [flagGate, session] }, async (req) => {
    const b = req.body;
    if (b !== undefined && b !== null && (typeof b !== 'object' || Array.isArray(b) || Object.keys(b).length > 0)) throw new ApiError(400, 'bad-request');
    const { db, clock } = req.server.deps;
    const challenge = randomBytes(32).toString('base64url');
    const r = await db.query(
      'update sessions set proof_challenge_hash = $2, proof_challenge_until = $3 where id = $1 and bound_key is not null',
      [req.auth.sessionId, hash(challenge), new Date(clock().getTime() + PROOF_CHALLENGE_TTL_MS)],
    );
    if ((r.rowCount ?? 0) === 0) throw new ApiError(409, 'not-bound');
    return { challenge };
  });

  app.post('/v1/account/session/proof', { preHandler: [flagGate, session] }, async (req, reply) => {
    const b = req.body;
    if (b === null || typeof b !== 'object' || Array.isArray(b)) throw new ApiError(400, 'bad-request');
    const o = b as Record<string, unknown>;
    if (Object.keys(o).some((k) => k !== 'challenge' && k !== 'signature')) throw new ApiError(400, 'bad-request');
    if (typeof o.challenge !== 'string' || !TOKEN.test(o.challenge) || typeof o.signature !== 'string' || !SIG.test(o.signature)) {
      throw new ApiError(400, 'bad-request');
    }
    const { db, clock } = req.server.deps;
    const now = clock();
    // Read and clear in one statement: whatever happens next, this challenge is used up.
    const { rows } = await db.query<{ h: Buffer | null; u: Date | null; k: Buffer | null }>(
      `with old as (select proof_challenge_hash as h, proof_challenge_until as u, bound_key as k from sessions where id = $1 for update)
       update sessions s set proof_challenge_hash = null, proof_challenge_until = null from old where s.id = $1
       returning old.h, old.u, old.k`,
      [req.auth.sessionId],
    );
    const r = rows[0];
    const want = hash(o.challenge);
    const fresh = r !== undefined && r.h !== null && r.u !== null && now.getTime() < r.u.getTime() && r.h.length === want.length && timingSafeEqual(r.h, want);
    const key = fresh && r.k !== null ? p256(r.k) : null;
    const ok = key !== null && verify('sha256', Buffer.from(proofMessage(o.challenge), 'utf8'), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(o.signature, 'base64url'));
    if (!ok) throw new ApiError(401, 'proof-invalid');
    const set = await issueBoundCookie(db, req.auth.sessionId, now, reply);
    set();
    return { boundUntil: new Date(now.getTime() + BOUND_TTL_MS).toISOString() };
  });
}
