import { createHash, randomBytes } from 'node:crypto';
import { UNCHOSEN_SESSION_HOURS, type AccountKind } from '@x2f/accounts';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { Deps } from '../app.js';
import { addAlert } from '../alerts.js';
import type { Queryable } from '../db/pool.js';
import type { EventBus } from '../events/bus.js';
import { ApiError } from '../errors.js';
import { hasRole, type MemberAccess, type TeamRole } from '../team/perms.js';
import { COOKIE_ATTRS, deviceHash, ensureDeviceCookie, trustDevice } from './device.js';
import type { LoginStrength } from './strength.js';

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
  /**
   * When the session ends: a full trader session at the end of its chosen length (session length,
   * owner 2 Nov 2026); other sessions if nothing touches them again (the stored deadline or the
   * idle rule, whichever is sooner).
   */
  expiresAt: Date;
  /**
   * Plan 2 Task 18: the team member acting, or null for the account owner. A member's session
   * belongs to the team account (`accountId` is the team's), so every account-keyed rule applies
   * to it; only routes that pass `member` to `requireSession` let it through.
   */
  memberId: string | null;
  /** The member's roles (empty for the account owner, who has every permission). */
  memberRoles: readonly TeamRole[];
  /** The member's name as the chat label shows it; null for the account owner. */
  memberName: string | null;
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
 * How long the browser keeps a full trader session's cookie. The server ends the session at its
 * chosen length; each "Stay logged in" sets the cookie again, so a session with no fixed maximum
 * keeps its cookie.
 */
export const TRADER_COOKIE_MS = 30 * DAY;

/**
 * Idle and absolute lifetimes: staff and owner a fixed 2 h / 12 h; recovery 25 h / 48 h. A full
 * trader session has neither (null): it lasts the length chosen at login (`expires_at`), extended
 * only by "Stay logged in?" with a login method, and has no fixed maximum (owner, 2 Nov 2026).
 */
export function sessionPolicy(kind: AccountKind, level: SessionLevel): { idleMs: number; absoluteMs: number } | null {
  if (level === 'recovery') return { idleMs: 25 * HOUR, absoluteMs: 48 * HOUR };
  if (kind === 'trader') return null;
  return { idleMs: STAFF_IDLE_HOURS * HOUR, absoluteMs: 12 * HOUR };
}

const tokenHash = (token: string): Buffer => createHash('sha256').update(token).digest();

function presentedToken(req: FastifyRequest): string | null {
  const v = req.cookies?.[SESSION_COOKIE];
  return typeof v === 'string' && TOKEN.test(v) ? v : null;
}

/**
 * Sets this request's session cookie again with a fresh browser lifetime (`TRADER_COOKIE_MS`), after
 * "Stay logged in" extended the session: the same token, so the same session goes on.
 */
export function refreshSessionCookie(req: FastifyRequest, reply: FastifyReply): void {
  const token = presentedToken(req);
  if (token !== null) void reply.setCookie(SESSION_COOKIE, token, { ...COOKIE_ATTRS, maxAge: Math.floor(TRADER_COOKIE_MS / 1000) });
}

/** The hash of the well-formed session cookie this request carries, else null (Task 16's device count). */
export function presentedTokenHash(req: FastifyRequest): Buffer | null {
  const token = presentedToken(req);
  return token === null ? null : tokenHash(token);
}

/**
 * Control and format characters (bidi overrides, zero-width, NUL) removed, then trimmed and cut to
 * 60 code points; chosen by the client, never read from request headers.
 */
export function cleanLabel(label: string): string {
  const visible = label.replace(/[\p{Cc}\p{Cf}]/gu, '').trim();
  return Array.from(visible).slice(0, DEVICE_LABEL_MAX).join('').trim();
}

/** The earlier of the absolute deadline and the idle deadline from `now`; stored as `expires_at` so idle sessions get purged. */
export function deadline(createdAt: Date, now: Date, p: { idleMs: number; absoluteMs: number }): Date {
  return new Date(Math.min(createdAt.getTime() + p.absoluteMs, now.getTime() + p.idleMs));
}

export interface NewSession {
  accountId: string;
  level: SessionLevel;
  deviceLabel: string;
  method: LoginMethod;
  firstSession: boolean;
  holdUntil?: Date;
  /**
   * Task 17: how strong the login was (`loginStrength`). Default: a passkey or security key alone
   * is strong; anything else single waits (`pgp-single` for a PGP key, else `weak-single`). A
   * password with its TOTP code passes 'strong'.
   */
  strength?: LoginStrength;
}

/**
 * The statements of a new session, inside the caller's transaction (`db` a client after `begin`).
 * Always mints a new token (a presented cookie is never reused, so a planted one cannot be fixed);
 * a session cookie the request carried is revoked; the device is trusted; later logins (not the
 * first session) add an alert. A recovery session stores `holdUntil` as its hold (Task 9's TOTP
 * backup login). Returns the session id and `after`, which the caller runs once the transaction
 * has committed: it ends the replaced session's streams, pushes `new-login` to the account's
 * other devices and sets the cookie (nothing reaches the browser if the transaction rolls back).
 */
export async function openSession(
  db: Queryable,
  deps: Pick<Deps, 'clock'>,
  req: FastifyRequest,
  reply: FastifyReply,
  a: NewSession,
): Promise<{ sessionId: string; after: () => void }> {
  const strength: LoginStrength =
    a.strength ?? (a.method === 'passkey' || a.method === 'security-key' ? 'strong' : a.method === 'pgp' ? 'pgp-single' : 'weak-single');
  const now = deps.clock();
  const token = randomBytes(32).toString('base64url');
  const label = cleanLabel(a.deviceLabel);
  ensureDeviceCookie(req, reply);
  const device = deviceHash(req);
  const presented = presentedToken(req);

  const acct = await db.query<{ kind: AccountKind }>('select kind from accounts where id = $1', [a.accountId]);
  let row = acct.rows[0];
  if (!row) throw new ApiError(401, 'not-authenticated');
  /** Set for a team member's login (Plan 2 Task 18). */
  let member: { id: string; teamId: string; name: string } | null = null;
  // Plan 2 Task 18: a team member's login starts a session of the team account, tagged with
  // the member. Only a joined, not removed member of a live team; `for share` makes a removal
  // that runs at the same time wait, so it then ends this session too.
  if (row.kind === 'member') {
    if (a.level !== 'full') throw new ApiError(401, 'not-authenticated');
    const tm = await db.query<{ id: string; account_id: string; display_name: string; kind: AccountKind; disabled_at: Date | null }>(
      `select tm.id, tm.account_id, tm.display_name, t.kind, t.disabled_at
         from team_members tm join accounts t on t.id = tm.account_id
        where tm.member_account_id = $1 and tm.removed_at is null and tm.joined_at is not null
        for share of tm`,
      [a.accountId],
    );
    const m = tm.rows[0];
    if (!m || m.kind !== 'trader') throw new ApiError(403, 'account-disabled');
    if (m.disabled_at !== null) throw new ApiError(403, 'account-disabled');
    member = { id: m.id, teamId: m.account_id, name: m.display_name };
    row = { kind: m.kind };
  }
  const policy = sessionPolicy(row.kind, a.level);
  // A full trader session lasts the shortest choice until its person picks a length (`setSessionLength`).
  const expiresAt = policy ? deadline(now, now, policy) : new Date(now.getTime() + UNCHOSEN_SESSION_HOURS * HOUR);
  /** The session this browser's cookie named, revoked by this login (its streams end too). */
  let replaced: { id: string; account_id: string } | null = null;
  if (presented) {
    const old = await db.query<{ id: string; account_id: string }>(
      'update sessions set revoked_at = $2 where token_hash = $1 and revoked_at is null returning id, account_id',
      [tokenHash(presented), now],
    );
    replaced = old.rows[0] ?? null;
  }
  const { rows } = await db.query<{ id: string }>(
    `insert into sessions (account_id, token_hash, level, device_label, onboarding_until, created_at, last_seen_at, period_started_at, expires_at, hold_until, strength, member_id)
     values ($1, $2, $3, $4, $5, $6, $6, $6, $7, $8, $9, $10) returning id`,
    [
      member ? member.teamId : a.accountId, tokenHash(token), a.level, label,
      // A member's session never gets the sign-up window (its exemptions are the account owner's).
      a.firstSession && !member ? new Date(now.getTime() + ONBOARDING_MS) : null,
      now, expiresAt,
      // Task 9: only a recovery session carries a hold (see `requireSession`'s `allowHeld`).
      a.level === 'recovery' ? (a.holdUntil ?? null) : null,
      strength,
      member?.id ?? null,
    ],
  );
  const sessionId = rows[0]!.id;
  // A member's device is trusted for the member's own login only, never for the account owner's.
  if (device) await trustDevice({ db, clock: deps.clock }, a.accountId, device);
  if (member) {
    // The account owner is told about every member login (in the team account's alert list).
    await addAlert(db, member.teamId, 'team-member-login', { member: member.name, method: a.method, deviceLabel: label }, now);
  } else if (!a.firstSession) {
    if (a.level === 'recovery') {
      const detail: Record<string, string> = { method: a.method, deviceLabel: label };
      if (a.holdUntil) detail.holdUntil = a.holdUntil.toISOString();
      await addAlert(db, a.accountId, 'recovery-login', detail, now);
    } else {
      await addAlert(db, a.accountId, 'new-login', { method: a.method, deviceLabel: label }, now);
    }
  }
  const after = () => {
    if (replaced) req.server.events.closeSession(replaced.account_id, replaced.id);
    // Task 17 (owner, 2026-10-29): every new login is pushed to the account's other devices. A
    // member's login is an alert to the account owner instead (Task 18).
    if (!a.firstSession && !member) void req.server.push.send(a.accountId, 'new-login', { exceptSession: sessionId }).catch(() => undefined);
    void reply.setCookie(SESSION_COOKIE, token, { ...COOKIE_ATTRS, maxAge: Math.floor((policy ? policy.absoluteMs : TRADER_COOKIE_MS) / 1000) });
  };
  return { sessionId, after };
}

/** `openSession` in a transaction of its own, then its `after`. Returns the session id. */
export async function startSession(
  deps: Pick<Deps, 'db' | 'clock'>,
  req: FastifyRequest,
  reply: FastifyReply,
  a: NewSession,
): Promise<string> {
  const client = await deps.db.connect();
  let opened: { sessionId: string; after: () => void };
  try {
    await client.query('begin');
    try {
      opened = await openSession(client, deps, req, reply, a);
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    }
  } finally {
    client.release();
  }
  opened.after();
  return opened.sessionId;
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
  disabled_at: Date | null;
  terms_version: string | null;
  hold_until: Date | null;
  member_id: string | null;
  member_live: boolean | null;
  member_roles: TeamRole[] | null;
  member_name: string | null;
  member_disabled: boolean | null;
}

/** Marks the preHandlers `requireSession` returns, so the app can list the routes that run with a session. */
const SESSION_HOOK = Symbol('requireSession');

/**
 * preHandler for routes that need a logged-in account. Defaults to full sessions of any kind.
 * 401 `not-authenticated` (missing, revoked, past its chosen length, idle- or absolute-expired); 403 `account-disabled`
 * (checked on every request); 403 `recovery-session` unless `allowRecovery`; 403
 * `wrong-account-kind` when `kinds` excludes the account; 403 `terms-required` `{ version }` for a
 * trader on a stale Terms version unless `allowStaleTerms` (R10: only logout, me, terms, methods
 * and sessions routes set it, plus, by lead decision 2026-10-29 (Plan 3 Task 36), the routes that
 * shut offers off or read my own: `GET /v1/account/offers`, `POST /v1/account/offers/status`
 * (turning on still checks the Terms) and `PATCH /v1/offers/:id` (relisting still checks them)). Touches `last_seen_at` (and moves `expires_at`) unless `touch: false`:
 * a long-lived or self-reconnecting request such as `GET /v1/events` must never count as activity,
 * or an open tab would keep an idle staff session alive past its idle time (review 2026-10-27, I1).
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
 * row, at most FEEDBACK_FORM_DAILY a day and one per FEEDBACK_FORM_MIN_GAP_S. Tested in
 * apps/api/test/feedbackForm.test.ts.
 */
export function requireSession(
  opts: {
    allowRecovery?: boolean;
    allowHeld?: boolean;
    kinds?: AccountKind[];
    allowStaleTerms?: boolean;
    touch?: boolean;
    /**
     * Plan 2 Task 18: which team members may pass. Left out, a member's session gets 403
     * `owner-only` (fail closed: a route is the account owner's until it says otherwise); `any`
     * lets every member through; a role lets through members holding it (others 403 `forbidden`).
     */
    member?: MemberAccess;
  } = {},
): preHandlerAsyncHookHandler {
  const handler: preHandlerAsyncHookHandler = async function (req: FastifyRequest) {
    const deps = req.server.deps;
    const token = presentedToken(req);
    if (!token) throw new ApiError(401, 'not-authenticated');
    const { rows } = await deps.db.query<SessionRow>(
      `select s.id, s.account_id, s.level, s.onboarding_until, s.created_at, s.last_seen_at, s.expires_at, s.revoked_at,
              s.hold_until, a.kind, a.disabled_at, a.terms_version, s.member_id,
              (tm.removed_at is null and tm.joined_at is not null and tm.account_id = s.account_id) as member_live,
              tm.roles as member_roles, tm.display_name as member_name, ma.disabled_at is not null as member_disabled
         from sessions s join accounts a on a.id = s.account_id
         left join team_members tm on tm.id = s.member_id
         left join accounts ma on ma.id = tm.member_account_id
        where s.token_hash = $1`,
      [tokenHash(token)],
    );
    const row = rows[0];
    const now = deps.clock();
    if (!row || row.revoked_at !== null) throw new ApiError(401, 'not-authenticated');
    // Task 18 review M9(c): a member's sessions are rows of the team account (`startSession`); a
    // session of a member login account itself is never valid, whatever inserted it.
    if (row.kind === 'member') throw new ApiError(401, 'not-authenticated');
    const policy = sessionPolicy(row.kind, row.level);
    if (
      now.getTime() >= row.expires_at.getTime() ||
      (policy !== null &&
        (now.getTime() - row.last_seen_at.getTime() >= policy.idleMs || now.getTime() - row.created_at.getTime() >= policy.absoluteMs))
    ) {
      throw new ApiError(401, 'not-authenticated');
    }
    // A removed member's session ends at once, whatever the route (Task 18).
    if (row.member_id !== null && row.member_live !== true) throw new ApiError(401, 'not-authenticated');
    if (row.disabled_at !== null || row.member_disabled === true) throw new ApiError(403, 'account-disabled');
    if (row.member_id !== null) {
      if (opts.member === undefined) throw new ApiError(403, 'owner-only');
      if (!hasRole(row.member_roles ?? [], opts.member)) throw new ApiError(403, 'forbidden');
    }
    if (row.level === 'recovery' && !opts.allowRecovery) throw new ApiError(403, 'recovery-session');
    if (row.level === 'recovery' && row.hold_until !== null && now.getTime() < row.hold_until.getTime() && !opts.allowHeld) {
      throw new ApiError(403, 'recovery-hold', { holdUntil: row.hold_until.toISOString() });
    }
    if (opts.kinds && !opts.kinds.includes(row.kind)) throw new ApiError(403, 'wrong-account-kind');
    if (row.kind === 'trader' && row.terms_version !== deps.config.termsVersion && !opts.allowStaleTerms) {
      throw new ApiError(403, 'terms-required', { version: deps.config.termsVersion });
    }
    // For staff, owner and recovery sessions expires_at is the idle deadline capped by the absolute
    // one (created_at + absolute), so purgeExpired removes idle sessions too. A full trader
    // session's end is its chosen length: a touch records the activity and never moves it.
    if (opts.touch === false) {
      // Read-only check: the request is not the user's activity.
    } else if (policy === null) {
      await deps.db.query('update sessions set last_seen_at = $2 where id = $1 and last_seen_at < $2', [row.id, now]);
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
      // The deadline as the row had it (an untouched request did not move it).
      expiresAt: policy === null ? row.expires_at : new Date(Math.min(row.expires_at.getTime(), row.last_seen_at.getTime() + policy.idleMs)),
      memberId: row.member_id,
      memberRoles: row.member_id !== null ? (row.member_roles ?? []) : [],
      memberName: row.member_id !== null ? row.member_name : null,
    };
  };
  (handler as unknown as Record<symbol, true>)[SESSION_HOOK] = true;
  if (opts.member !== undefined) MEMBER_GUARDS.set(handler, opts.member);
  return handler;
}

/** True when a route's preHandler (one hook or a list) includes `requireSession`. */
export function runsWithSession(preHandler: unknown): boolean {
  const hooks = Array.isArray(preHandler) ? preHandler : [preHandler];
  return hooks.some((h) => typeof h === 'function' && (h as unknown as Record<symbol, unknown>)[SESSION_HOOK] === true);
}

/** Which members each member-allowed guard lets through (Task 18 review round 2, n4). */
const MEMBER_GUARDS = new WeakMap<object, MemberAccess>();

/**
 * The `member` option a `requireSession` guard was built with, or undefined for an owner-only
 * guard and for anything else. Lets a test see, from the registered routes themselves (Fastify's
 * onRoute), every route a team member can reach, however it was registered.
 */
export function memberAccessOf(handler: unknown): MemberAccess | undefined {
  return typeof handler === 'function' ? MEMBER_GUARDS.get(handler) : undefined;
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
