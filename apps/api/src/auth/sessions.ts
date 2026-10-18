import { createHash, randomBytes } from 'node:crypto';
import type { AccountKind } from '@x2f/accounts';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { Deps } from '../app.js';
import { addAlert } from '../alerts.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { COOKIE_ATTRS, deviceHash, ensureDeviceCookie, trustDevice } from './device.js';

export const SESSION_COOKIE = '__Host-x2f_session';
/** 32 random bytes, base64url without padding. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

const HOUR = 3600_000;
const DAY = 24 * HOUR;
export const ONBOARDING_MS = 30 * 60_000;
const DEVICE_LABEL_MAX = 60;

export type SessionLevel = 'full' | 'recovery';
export type LoginMethod = 'pgp' | 'passkey' | 'security-key' | 'password' | 'totp' | 'recovery-code';

/** What `requireSession` puts on the request. */
export interface AuthContext {
  sessionId: string;
  accountId: string;
  kind: AccountKind;
  level: SessionLevel;
  onboardingUntil: Date | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `requireSession`; read it only on routes behind it. */
    auth: AuthContext;
  }
}

/** Idle and absolute lifetimes: traders 7 d / 30 d; staff and owner 2 h / 12 h (owner, 2026-10-17); recovery 25 h / 48 h. */
export function sessionPolicy(kind: AccountKind, level: SessionLevel): { idleMs: number; absoluteMs: number } {
  if (level === 'recovery') return { idleMs: 25 * HOUR, absoluteMs: 48 * HOUR };
  if (kind === 'trader') return { idleMs: 7 * DAY, absoluteMs: 30 * DAY };
  return { idleMs: 2 * HOUR, absoluteMs: 12 * HOUR };
}

const tokenHash = (token: string): Buffer => createHash('sha256').update(token).digest();

function presentedToken(req: FastifyRequest): string | null {
  const v = req.cookies?.[SESSION_COOKIE];
  return typeof v === 'string' && TOKEN.test(v) ? v : null;
}

/** Trimmed, at most 60 code points; chosen by the client, never read from request headers. */
function cleanLabel(label: string): string {
  return Array.from(label.trim()).slice(0, DEVICE_LABEL_MAX).join('').trim();
}

/**
 * Starts a session after a successful login or register. Always mints a new token (a presented
 * cookie is never reused, so a planted one cannot be fixed); a session cookie the request carried
 * is revoked; the device is trusted; later logins (not the first session) add an alert.
 */
export async function startSession(
  deps: Pick<Deps, 'db' | 'clock'>,
  req: FastifyRequest,
  reply: FastifyReply,
  a: {
    accountId: string;
    level: SessionLevel;
    deviceLabel: string;
    method: LoginMethod;
    firstSession: boolean;
    holdUntil?: Date;
  },
): Promise<string> {
  const now = deps.clock();
  const token = randomBytes(32).toString('base64url');
  const label = cleanLabel(a.deviceLabel);
  ensureDeviceCookie(req, reply);
  const device = deviceHash(req);
  const presented = presentedToken(req);

  const client = await deps.db.connect();
  let sessionId: string;
  let absoluteMs: number;
  try {
    await client.query('begin');
    try {
      const acct = await client.query<{ kind: AccountKind }>('select kind from accounts where id = $1', [a.accountId]);
      const kind = acct.rows[0]?.kind;
      if (!kind) throw new ApiError(401, 'not-authenticated');
      absoluteMs = sessionPolicy(kind, a.level).absoluteMs;
      if (presented) {
        await client.query('update sessions set revoked_at = $2 where token_hash = $1 and revoked_at is null', [
          tokenHash(presented), now,
        ]);
      }
      const { rows } = await client.query<{ id: string }>(
        `insert into sessions (account_id, token_hash, level, device_label, onboarding_until, created_at, last_seen_at, expires_at)
         values ($1, $2, $3, $4, $5, $6, $6, $7) returning id`,
        [
          a.accountId, tokenHash(token), a.level, label,
          a.firstSession ? new Date(now.getTime() + ONBOARDING_MS) : null,
          now, new Date(now.getTime() + absoluteMs),
        ],
      );
      sessionId = rows[0]!.id;
      if (device) await trustDevice({ db: client, clock: deps.clock }, a.accountId, device);
      if (!a.firstSession) {
        if (a.level === 'recovery') {
          const detail: Record<string, string> = { method: a.method, deviceLabel: label };
          if (a.holdUntil) detail.holdUntil = a.holdUntil.toISOString();
          await addAlert(client, a.accountId, 'recovery-login', detail, now);
        } else {
          await addAlert(client, a.accountId, 'new-login', { method: a.method, deviceLabel: label }, now);
        }
      }
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    }
  } finally {
    client.release();
  }

  void reply.setCookie(SESSION_COOKIE, token, { ...COOKIE_ATTRS, maxAge: Math.floor(absoluteMs / 1000) });
  return sessionId;
}

interface SessionRow {
  id: string;
  account_id: string;
  level: SessionLevel;
  onboarding_until: Date | null;
  last_seen_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  kind: AccountKind;
  disabled_at: Date | null;
  terms_version: string | null;
}

/**
 * preHandler for routes that need a logged-in account. Defaults to full sessions of any kind.
 * 401 `not-authenticated` (missing, revoked, idle- or absolute-expired); 403 `account-disabled`
 * (checked on every request); 403 `recovery-session` unless `allowRecovery`; 403
 * `wrong-account-kind` when `kinds` excludes the account; 403 `terms-required` `{ version }` for a
 * trader on a stale Terms version unless `allowStaleTerms` (R10: only logout, me, terms, methods
 * and sessions routes set it). Touches `last_seen_at`.
 */
export function requireSession(
  opts: { allowRecovery?: boolean; kinds?: AccountKind[]; allowStaleTerms?: boolean } = {},
): preHandlerAsyncHookHandler {
  return async function (req: FastifyRequest) {
    const deps = req.server.deps;
    const token = presentedToken(req);
    if (!token) throw new ApiError(401, 'not-authenticated');
    const { rows } = await deps.db.query<SessionRow>(
      `select s.id, s.account_id, s.level, s.onboarding_until, s.last_seen_at, s.expires_at, s.revoked_at,
              a.kind, a.disabled_at, a.terms_version
         from sessions s join accounts a on a.id = s.account_id
        where s.token_hash = $1`,
      [tokenHash(token)],
    );
    const row = rows[0];
    const now = deps.clock();
    if (!row || row.revoked_at !== null) throw new ApiError(401, 'not-authenticated');
    const { idleMs } = sessionPolicy(row.kind, row.level);
    if (now.getTime() >= row.expires_at.getTime() || now.getTime() - row.last_seen_at.getTime() >= idleMs) {
      throw new ApiError(401, 'not-authenticated');
    }
    if (row.disabled_at !== null) throw new ApiError(403, 'account-disabled');
    if (row.level === 'recovery' && !opts.allowRecovery) throw new ApiError(403, 'recovery-session');
    if (opts.kinds && !opts.kinds.includes(row.kind)) throw new ApiError(403, 'wrong-account-kind');
    if (row.kind === 'trader' && row.terms_version !== deps.config.termsVersion && !opts.allowStaleTerms) {
      throw new ApiError(403, 'terms-required', { version: deps.config.termsVersion });
    }
    await deps.db.query('update sessions set last_seen_at = $2 where id = $1 and last_seen_at < $2', [row.id, now]);
    req.auth = {
      sessionId: row.id,
      accountId: row.account_id,
      kind: row.kind,
      level: row.level,
      onboardingUntil: row.onboarding_until,
    };
  };
}

/** Called by every login `finish` before `startSession`: 403 `account-disabled`. */
export async function assertNotDisabled(db: Queryable, accountId: string): Promise<void> {
  const { rows } = await db.query<{ disabled_at: Date | null }>('select disabled_at from accounts where id = $1', [accountId]);
  if (rows[0]?.disabled_at != null) throw new ApiError(403, 'account-disabled');
}

/** Revokes one session; returns how many were live. */
export async function endSession(deps: Pick<Deps, 'db' | 'clock'>, sessionId: string): Promise<number> {
  const r = await deps.db.query('update sessions set revoked_at = $2 where id = $1 and revoked_at is null', [sessionId, deps.clock()]);
  return r.rowCount ?? 0;
}

/** Revokes every session of the account except `keepSessionId` (after a password change or method removal). */
export async function endOtherSessions(deps: Pick<Deps, 'db' | 'clock'>, accountId: string, keepSessionId: string): Promise<number> {
  const r = await deps.db.query(
    'update sessions set revoked_at = $3 where account_id = $1 and id <> $2 and revoked_at is null',
    [accountId, keepSessionId, deps.clock()],
  );
  return r.rowCount ?? 0;
}

/** Revokes every session of the account (Plan 4 uses it when switching staff off). */
export async function endAllSessions(deps: Pick<Deps, 'db' | 'clock'>, accountId: string): Promise<number> {
  const r = await deps.db.query('update sessions set revoked_at = $2 where account_id = $1 and revoked_at is null', [
    accountId, deps.clock(),
  ]);
  return r.rowCount ?? 0;
}

/** `POST /v1/logout`: ends this session (recovery sessions and stale Terms included) and clears the cookie. */
export function logoutRoute(app: FastifyInstance): void {
  app.post('/v1/logout', { preHandler: requireSession({ allowRecovery: true, allowStaleTerms: true }) }, async (req, reply) => {
    await endSession(req.server.deps, req.auth.sessionId);
    void reply.clearCookie(SESSION_COOKIE, COOKIE_ATTRS);
    return { ok: true };
  });
}
