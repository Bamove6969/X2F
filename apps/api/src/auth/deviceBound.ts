import { createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify, type KeyObject } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { subkey, type Config } from '../config.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { COOKIE_ATTRS } from './device.js';
import { requestOrigin } from './origin.js';
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
 *   challenge, and a signature over `proofMessage(origin, session, challenge)` that renews the cookie.
 * - Challenges are stateless (review MF1): an HMAC under `subkey('session-proof')` over the session
 *   id, an expiry and a nonce, so any number may be outstanding (several tabs renewing at once) and
 *   asking for one, or answering one wrongly, never spoils another. Each is single-use: the first
 *   answer to a genuine, unexpired challenge records its nonce (`session_proof_nonces`), right or
 *   wrong. Both routes take from a per-session budget (`budgets.sessionProof`, review S2).
 *   A copied session cookie (with or without a copied bound cookie) is dead within BOUND_TTL_MS.
 * - Behind `X2F_DEVICE_BOUND_SESSIONS` (off by default): off, the header is ignored, nothing new is
 *   checked even on a bound session (the kill switch), and both routes answer 404.
 * - Trader sessions only: a staff login's header is ignored (staff-web is not wired, spec section 8).
 */

export const SESSION_KEY_HEADER = 'x2f-session-key';
export const BOUND_COOKIE = '__Host-x2f_bound';
/** How long a bound cookie proves the key (spec section 8, question 3). */
export const BOUND_TTL_MS = 10 * 60_000;
/**
 * Re-verify R1: after a renewal the previous bound cookie stays valid this long (never past its own
 * end), as the session token's `prev_token_hash` does. Every tab shares the one cookie jar, so a
 * request another tab already sent with it must not fail because this tab renewed.
 */
export const BOUND_OVERLAP_MS = 60_000;
/** How long a proof challenge may be answered. */
export const PROOF_CHALLENGE_TTL_MS = 2 * 60_000;

/**
 * The exact bytes signed (UTF-8), v2 (review S1): a fixed context string, so the key signs nothing
 * else of ours, then the origin the browser is on, the session id the challenge was issued for and
 * the challenge, one per line.
 */
export const proofMessage = (origin: string, session: string, challenge: string): string => `x2f-session-proof-v2\n${origin}\n${session}\n${challenge}`;

export const boundSessionsOn = (config: Pick<Config, 'deviceBoundSessions'>): boolean => config.deviceBoundSessions === true;

const B64URL = /^[A-Za-z0-9_-]+$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
/** nonce (16) || expiry in ms (8, big-endian) || HMAC-SHA-256 (32), base64url: 56 bytes. */
const CHALLENGE = /^[A-Za-z0-9_-]{75}$/;
const NONCE_BYTES = 16;
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

/**
 * A fresh bound cookie for the session, stored as its hash; returns the setter to run after commit.
 * The one it replaces stays valid until the earlier of its own end and now + BOUND_OVERLAP_MS (R1).
 */
export async function issueBoundCookie(db: Queryable, sessionId: string, now: Date, reply: FastifyReply): Promise<() => void> {
  const token = randomBytes(32).toString('base64url');
  await db.query(
    `update sessions set bound_prev_hash = bound_token_hash,
            bound_prev_until = case when bound_token_hash is null or bound_until is null then null else least(bound_until, $4::timestamptz) end,
            bound_token_hash = $2, bound_until = $3
      where id = $1`,
    [sessionId, hash(token), new Date(now.getTime() + BOUND_TTL_MS), new Date(now.getTime() + BOUND_OVERLAP_MS)],
  );
  return () => void reply.setCookie(BOUND_COOKIE, token, { ...COOKIE_ATTRS, maxAge: Math.floor(BOUND_TTL_MS / 1000) });
}

function challengeMac(config: Config, sessionId: string, untilAndNonce: Buffer): Buffer {
  return createHmac('sha256', subkey(config, 'session-proof')).update('x2f-proof-challenge-v1\0').update(sessionId, 'utf8').update('\0').update(untilAndNonce).digest();
}

/** A challenge for this session, valid PROOF_CHALLENGE_TTL_MS. */
export function newChallenge(config: Config, sessionId: string, now: Date): string {
  const body = Buffer.alloc(NONCE_BYTES + 8);
  randomBytes(NONCE_BYTES).copy(body, 0);
  body.writeBigUInt64BE(BigInt(now.getTime() + PROOF_CHALLENGE_TTL_MS), NONCE_BYTES);
  return Buffer.concat([body, challengeMac(config, sessionId, body)]).toString('base64url');
}

/** The challenge's nonce and expiry when it is this session's own and unexpired; else null. */
export function openChallenge(config: Config, sessionId: string, challenge: string, now: Date): { nonce: Buffer; until: Date } | null {
  if (!CHALLENGE.test(challenge)) return null;
  const raw = Buffer.from(challenge, 'base64url');
  if (raw.length !== NONCE_BYTES + 8 + 32) return null;
  const body = raw.subarray(0, NONCE_BYTES + 8);
  const mac = raw.subarray(NONCE_BYTES + 8);
  if (!timingSafeEqual(mac, challengeMac(config, sessionId, body))) return null;
  const until = Number(body.readBigUInt64BE(NONCE_BYTES));
  if (!(now.getTime() < until)) return null;
  return { nonce: Buffer.from(body.subarray(0, NONCE_BYTES)), until: new Date(until) };
}

/** Whether the request's bound cookie is the session's current one, or the previous one within its overlap (R1), and still valid. */
export function boundCookieValid(
  req: FastifyRequest,
  current: { hash: Buffer | null; until: Date | null },
  previous: { hash: Buffer | null; until: Date | null },
  now: Date,
): boolean {
  const v = req.cookies?.[BOUND_COOKIE];
  if (typeof v !== 'string' || !TOKEN.test(v)) return false;
  const h = hash(v);
  const matches = (c: { hash: Buffer | null; until: Date | null }) =>
    c.hash !== null && c.until !== null && now.getTime() < c.until.getTime() && c.hash.length === h.length && timingSafeEqual(h, c.hash);
  // Both are compared, so the time taken does not say which one matched.
  const a = matches(current);
  const b = matches(previous);
  return a || b;
}

/** 404 unless the flag is on (registered first, so a caller learns nothing more with it off). */
const flagGate: preHandlerAsyncHookHandler = async function (req) {
  if (!boundSessionsOn(req.server.deps.config)) throw new ApiError(404, 'not-found');
};

/**
 * `POST /v1/account/session/proof/challenge` → `{ challenge, session }` (409 `not-bound` for an
 * unbound session); `POST /v1/account/session/proof { challenge, signature }` → `{ boundUntil }`
 * and a new bound cookie, or 401 `proof-invalid`. The first answer to a challenge uses it up.
 * Both take any live session of the account, a member's, a recovery or held one, or one on stale
 * Terms (`allowUnproven`), and touch nothing: keeping the proof fresh is not the person's activity.
 */
export function deviceBoundRoutes(app: FastifyInstance): void {
  // Built here, as a literal `requireSession({ … member: … })`, so team.test.ts's source scan sees
  // these as member-allowed routes (both are recorded exemptions there: the member's own session).
  const session = requireSession({ allowRecovery: true, allowHeld: true, allowStaleTerms: true, member: 'any', touch: false, allowUnproven: true });
  // Review S2, re-verify R2: the per-session budget is charged only to refused proofs, so a valid
  // proof is never refused by a budget that whoever holds a copied session cookie can spend.
  // Challenges have no per-session cap at all (re-verify 2): they write nothing (one HMAC and one
  // indexed select), the app's general request limits cover them, and a per-session cap is one the
  // thief shares with the person, who needs a new challenge for every renewal.
  const refused = (req: FastifyRequest): never => {
    req.server.budgets.sessionProof.take(req.auth.sessionId);
    throw new ApiError(401, 'proof-invalid');
  };

  app.post('/v1/account/session/proof/challenge', { preHandler: [flagGate, session] }, async (req) => {
    const b = req.body;
    if (b !== undefined && b !== null && (typeof b !== 'object' || Array.isArray(b) || Object.keys(b).length > 0)) throw new ApiError(400, 'bad-request');
    const { db, clock, config } = req.server.deps;
    const r = await db.query('select 1 from sessions where id = $1 and bound_key is not null', [req.auth.sessionId]);
    if ((r.rowCount ?? 0) === 0) throw new ApiError(409, 'not-bound');
    // Nothing is written: any number may be outstanding (review MF1).
    return { challenge: newChallenge(config, req.auth.sessionId, clock()), session: req.auth.sessionId };
  });

  app.post('/v1/account/session/proof', { preHandler: [flagGate, session] }, async (req, reply) => {
    const b = req.body;
    if (b === null || typeof b !== 'object' || Array.isArray(b)) throw new ApiError(400, 'bad-request');
    const o = b as Record<string, unknown>;
    if (Object.keys(o).some((k) => k !== 'challenge' && k !== 'signature')) throw new ApiError(400, 'bad-request');
    if (typeof o.challenge !== 'string' || !CHALLENGE.test(o.challenge) || typeof o.signature !== 'string' || !SIG.test(o.signature)) {
      throw new ApiError(400, 'bad-request');
    }
    const { db, clock, config } = req.server.deps;
    const now = clock();
    const sessionId = req.auth.sessionId;
    const opened = openChallenge(config, sessionId, o.challenge, now);
    if (opened === null) return refused(req);
    // Single use: the first answer to this challenge records its nonce, whatever happens next.
    // Expired nonces of this session go at the same time (their challenges are refused by expiry anyway).
    await db.query('delete from session_proof_nonces where session_id = $1 and expires_at <= $2', [sessionId, now]);
    const used = await db.query(
      'insert into session_proof_nonces (nonce, session_id, expires_at) values ($1, $2, $3) on conflict (nonce) do nothing',
      [opened.nonce, sessionId, opened.until],
    );
    if ((used.rowCount ?? 0) === 0) return refused(req);
    const { rows } = await db.query<{ k: Buffer | null }>('select bound_key as k from sessions where id = $1', [sessionId]);
    const key = rows[0]?.k ? p256(rows[0].k) : null;
    const message = proofMessage(requestOrigin(req).origin, sessionId, o.challenge);
    const ok = key !== null && verify('sha256', Buffer.from(message, 'utf8'), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(o.signature, 'base64url'));
    if (!ok) return refused(req);
    const set = await issueBoundCookie(db, sessionId, now, reply);
    set();
    return { boundUntil: new Date(now.getTime() + BOUND_TTL_MS).toISOString() };
  });
}

/**
 * Review S5: `X2F-Session-Key` is checked at the top of every trader request that carries it (an
 * `onRequest` hook, before any body is read or any login factor is checked or spent), so a
 * malformed one is 400 `bad-request` before a code, an approval or a challenge is used up. Flag
 * off, it is not read. The staff API does not register this (it ignores the header).
 */
export const sessionKeyHook = async function (req: FastifyRequest): Promise<void> {
  if (req.headers[SESSION_KEY_HEADER] === undefined) return;
  sessionKeyOf(req, 'trader');
};
