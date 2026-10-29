import { createHash, randomBytes } from 'node:crypto';
import { DEFAULT_IDLE_HOURS, type AccountKind, type IdleHours } from '@x2f/accounts';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { Deps } from '../app.js';
import { addAlert } from '../alerts.js';
import type { Queryable } from '../db/pool.js';
import type { EventBus } from '../events/bus.js';
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
  /** When the session expires if nothing touches it again (the stored deadline or the idle rule, whichever is sooner). */
  expiresAt: Date;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `requireSession`; read it only on routes behind it. */
    auth: AuthContext;
  }
}

/** The fixed idle and absolute lifetimes of staff and owner sessions (owner, 2026-10-17). */
export const STAFF_IDLE_HOURS = 2;

/**
 * Idle and absolute lifetimes: traders their chosen logout timer (`idleHours`, 2-12 hours,
 * default 12; owner, 2026-10-23) / 30 d; staff and owner a fixed 2 h / 12 h whatever the account
 * stores; recovery 25 h / 48 h.
 */
export function sessionPolicy(
  kind: AccountKind,
  level: SessionLevel,
  idleHours: IdleHours = DEFAULT_IDLE_HOURS,
): { idleMs: number; absoluteMs: number } {
  if (level === 'recovery') return { idleMs: 25 * HOUR, absoluteMs: 48 * HOUR };
  if (kind === 'trader') return { idleMs: idleHours * HOUR, absoluteMs: 30 * DAY };
  return { idleMs: STAFF_IDLE_HOURS * HOUR, absoluteMs: 12 * HOUR };
}

const tokenHash = (token: string): Buffer => createHash('sha256').update(token).digest();

function presentedToken(req: FastifyRequest): string | null {
  const v = req.cookies?.[SESSION_COOKIE];
  return typeof v === 'string' && TOKEN.test(v) ? v : null;
}

/**
 * Control and format characters (bidi overrides, zero-width, NUL) removed, then trimmed and cut to
 * 60 code points; chosen by the client, never read from request headers.
 */
function cleanLabel(label: string): string {
  const visible = label.replace(/[\p{Cc}\p{Cf}]/gu, '').trim();
  return Array.from(visible).slice(0, DEVICE_LABEL_MAX).join('').trim();
}

/** The earlier of the absolute deadline and the idle deadline from `now`; stored as `expires_at` so idle sessions get purged. */
export function deadline(createdAt: Date, now: Date, p: { idleMs: number; absoluteMs: number }): Date {
  return new Date(Math.min(createdAt.getTime() + p.absoluteMs, now.getTime() + p.idleMs));
}

/**
 * Starts a session after a successful login or register. Always mints a new token (a presented
 * cookie is never reused, so a planted one cannot be fixed); a session cookie the request carried
 * is revoked; the device is trusted; later logins (not the first session) add an alert. A
 * recovery session stores `holdUntil` as its hold (Task 9's TOTP backup login).
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
  /** The session this browser's cookie named, revoked by this login (its streams end too). */
  let replaced: { id: string; account_id: string } | null = null;
  let absoluteMs: number;
  let expiresAt: Date;
  try {
    await client.query('begin');
    try {
      const acct = await client.query<{ kind: AccountKind; idle_hours: IdleHours }>(
        'select kind, idle_hours from accounts where id = $1',
        [a.accountId],
      );
      const row = acct.rows[0];
      if (!row) throw new ApiError(401, 'not-authenticated');
      const policy = sessionPolicy(row.kind, a.level, row.idle_hours);
      absoluteMs = policy.absoluteMs;
      expiresAt = deadline(now, now, policy);
      if (presented) {
        const old = await client.query<{ id: string; account_id: string }>(
          'update sessions set revoked_at = $2 where token_hash = $1 and revoked_at is null returning id, account_id',
          [tokenHash(presented), now],
        );
        replaced = old.rows[0] ?? null;
      }
      const { rows } = await client.query<{ id: string }>(
        `insert into sessions (account_id, token_hash, level, device_label, onboarding_until, created_at, last_seen_at, expires_at, hold_until)
         values ($1, $2, $3, $4, $5, $6, $6, $7, $8) returning id`,
        [
          a.accountId, tokenHash(token), a.level, label,
          a.firstSession ? new Date(now.getTime() + ONBOARDING_MS) : null,
          now, expiresAt,
          // Task 9: only a recovery session carries a hold (see `requireSession`'s `allowHeld`).
          a.level === 'recovery' ? (a.holdUntil ?? null) : null,
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
  if (replaced) req.server.events.closeSession(replaced.account_id, replaced.id);

  void reply.setCookie(SESSION_COOKIE, token, { ...COOKIE_ATTRS, maxAge: Math.floor(absoluteMs / 1000) });
  return sessionId;
}

interface SessionRow {
  id: string;
  account_id: string;
  level: SessionLevel;
  onboarding_until: Date | null;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  kind: AccountKind;
  idle_hours: IdleHours;
  disabled_at: Date | null;
  terms_version: string | null;
  hold_until: Date | null;
}

/**
 * preHandler for routes that need a logged-in account. Defaults to full sessions of any kind.
 * 401 `not-authenticated` (missing, revoked, idle- or absolute-expired); 403 `account-disabled`
 * (checked on every request); 403 `recovery-session` unless `allowRecovery`; 403
 * `wrong-account-kind` when `kinds` excludes the account; 403 `terms-required` `{ version }` for a
 * trader on a stale Terms version unless `allowStaleTerms` (R10: only logout, me, terms, methods
 * and sessions routes set it). Touches `last_seen_at` (and moves `expires_at`) unless `touch: false`:
 * a long-lived or self-reconnecting request such as `GET /v1/events` must never count as activity,
 * or an open tab would keep an idle session alive past its logout timer (review 2026-10-27, I1).
 *
 * The 24-hour hold of a TOTP backup login fails closed (Task 9, P2-I1): a recovery session whose
 * `hold_until` is still ahead gets 403 `recovery-hold` `{ holdUntil }` on every recovery-allowed
 * route unless that route also sets `allowHeld` (only routes that change nothing, such as reading
 * the account or its methods). So every add-method route (PGP, WebAuthn, password) is held without
 * a per-route check; at exactly `hold_until` the session passes.
 *
 * One recorded exception (owner, 2026-10-29; Plan 5 Task 21): `POST /v1/feedback/form` sets
 * `allowHeld` although it writes a row, because the owner wants everyone who is refused, a held
 * backup session included, to be able to say so. It changes nothing about the account: a feedback
 * row, at most FEEDBACK_FORM_DAILY a day. Tested in apps/api/test/feedbackForm.test.ts.
 */
export function requireSession(
  opts: { allowRecovery?: boolean; allowHeld?: boolean; kinds?: AccountKind[]; allowStaleTerms?: boolean; touch?: boolean } = {},
): preHandlerAsyncHookHandler {
  return async function (req: FastifyRequest) {
    const deps = req.server.deps;
    const token = presentedToken(req);
    if (!token) throw new ApiError(401, 'not-authenticated');
    const { rows } = await deps.db.query<SessionRow>(
      `select s.id, s.account_id, s.level, s.onboarding_until, s.created_at, s.last_seen_at, s.expires_at, s.revoked_at,
              s.hold_until, a.kind, a.idle_hours, a.disabled_at, a.terms_version
         from sessions s join accounts a on a.id = s.account_id
        where s.token_hash = $1`,
      [tokenHash(token)],
    );
    const row = rows[0];
    const now = deps.clock();
    if (!row || row.revoked_at !== null) throw new ApiError(401, 'not-authenticated');
    // The account's current logout timer: a change applies to every live session at its next request.
    const policy = sessionPolicy(row.kind, row.level, row.idle_hours);
    if (
      now.getTime() >= row.expires_at.getTime() ||
      now.getTime() - row.last_seen_at.getTime() >= policy.idleMs ||
      now.getTime() - row.created_at.getTime() >= policy.absoluteMs
    ) {
      throw new ApiError(401, 'not-authenticated');
    }
    if (row.disabled_at !== null) throw new ApiError(403, 'account-disabled');
    if (row.level === 'recovery' && !opts.allowRecovery) throw new ApiError(403, 'recovery-session');
    if (row.level === 'recovery' && row.hold_until !== null && now.getTime() < row.hold_until.getTime() && !opts.allowHeld) {
      throw new ApiError(403, 'recovery-hold', { holdUntil: row.hold_until.toISOString() });
    }
    if (opts.kinds && !opts.kinds.includes(row.kind)) throw new ApiError(403, 'wrong-account-kind');
    if (row.kind === 'trader' && row.terms_version !== deps.config.termsVersion && !opts.allowStaleTerms) {
      throw new ApiError(403, 'terms-required', { version: deps.config.termsVersion });
    }
    // expires_at is the idle deadline capped by the absolute one (created_at + absolute), so
    // purgeExpired removes idle sessions too.
    if (opts.touch === false) {
      // Read-only check: the request is not the user's activity.
    } else if (row.kind === 'trader' && row.level === 'full') {
      // The logout timer can change while this request runs (PUT /v1/account/security/logout-timer
      // moves every session's deadline in its transaction). The idle hours are read again here,
      // under a share lock, so this touch never writes back a deadline from the timer read above:
      // a share lock waits for a pending change and then sees the committed value.
      await deps.db.query(
        `update sessions s
            set last_seen_at = $2,
                expires_at = least($3::timestamptz,
                  $2::timestamptz + (select a.idle_hours from accounts a where a.id = s.account_id for share) * interval '1 hour')
          where s.id = $1 and s.last_seen_at < $2`,
        [row.id, now, new Date(row.created_at.getTime() + policy.absoluteMs)],
      );
    } else {
      await deps.db.query(
        'update sessions set last_seen_at = $2, expires_at = $3 where id = $1 and last_seen_at < $2',
        [row.id, now, deadline(row.created_at, now, policy)],
      );
    }
    req.auth = {
      sessionId: row.id,
      accountId: row.account_id,
      kind: row.kind,
      level: row.level,
      onboardingUntil: row.onboarding_until,
      // The deadline as the row had it (an untouched request did not move it); the idle rule above
      // may be stricter than the stored deadline after a logout-timer change, so take the earlier.
      expiresAt: new Date(Math.min(row.expires_at.getTime(), row.last_seen_at.getTime() + policy.idleMs)),
    };
  };
}

/** Called by every login `finish` before `startSession`: 403 `account-disabled`. */
export async function assertNotDisabled(db: Queryable, accountId: string): Promise<void> {
  const { rows } = await db.query<{ disabled_at: Date | null }>('select disabled_at from accounts where id = $1', [accountId]);
  if (rows[0]?.disabled_at != null) throw new ApiError(403, 'account-disabled');
}

/**
 * Ending sessions must end their live streams too, so the bus is required (pass `app.events`):
 * a caller cannot forget it and leave a revoked session streaming.
 *
 * Call with the pool, or call closeAccount after commit. The streams are ended at once, so with
 * `db` a client inside a transaction a rollback would leave the sessions live with their streams
 * gone, and a stream opened before the commit (the session still looks live) would outlive the
 * revocation. In a transaction, pass a no-op bus and call `app.events.closeAccount` (or
 * `closeSession`) once it has committed.
 */
type EndDeps = Pick<Deps, 'db' | 'clock'> & { events: Pick<EventBus, 'closeAccount' | 'closeSession'> };

/** Revokes one session and ends its streams; returns how many were live. */
export async function endSession(deps: EndDeps, sessionId: string): Promise<number> {
  const r = await deps.db.query<{ account_id: string }>(
    'update sessions set revoked_at = $2 where id = $1 and revoked_at is null returning account_id',
    [sessionId, deps.clock()],
  );
  for (const row of r.rows) deps.events.closeSession(row.account_id, sessionId);
  return r.rowCount ?? 0;
}

/** Revokes every session of the account except `keepSessionId` (after a password change or method removal). */
export async function endOtherSessions(deps: EndDeps, accountId: string, keepSessionId: string): Promise<number> {
  const r = await deps.db.query(
    'update sessions set revoked_at = $3 where account_id = $1 and id <> $2 and revoked_at is null',
    [accountId, keepSessionId, deps.clock()],
  );
  deps.events.closeAccount(accountId, keepSessionId);
  return r.rowCount ?? 0;
}

/**
 * Revokes every session of the account and ends all its streams (log out everywhere; Plan 4 uses
 * it when disabling an account or switching staff off: pass `events: app.events`).
 */
export async function endAllSessions(deps: EndDeps, accountId: string): Promise<number> {
  const r = await deps.db.query('update sessions set revoked_at = $2 where account_id = $1 and revoked_at is null', [
    accountId, deps.clock(),
  ]);
  deps.events.closeAccount(accountId);
  return r.rowCount ?? 0;
}

/**
 * `POST /v1/logout`: revokes the session the cookie names, whatever its state (live, recovery,
 * stale Terms, expired, disabled account), and always clears the cookie. Never 401: a browser
 * holding a dead cookie can still get rid of it.
 */
export function logoutRoute(app: FastifyInstance): void {
  app.post('/v1/logout', async (req, reply) => {
    const token = presentedToken(req);
    if (token) {
      const { db, clock } = req.server.deps;
      const r = await db.query<{ id: string; account_id: string }>(
        'update sessions set revoked_at = $2 where token_hash = $1 and revoked_at is null returning id, account_id',
        [tokenHash(token), clock()],
      );
      for (const row of r.rows) req.server.events.closeSession(row.account_id, row.id);
    }
    void reply.clearCookie(SESSION_COOKIE, COOKIE_ATTRS);
    return { ok: true };
  });
}
