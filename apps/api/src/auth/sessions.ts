import { createHash, randomBytes } from 'node:crypto';
import { FEW_METHODS_SQL, setupOnlyAllows, shortOfMethodsNow } from './setupOnly.js';
import { siteBanAllows } from '../banState.js';
import { UNCHOSEN_SESSION_HOURS, type AccountKind } from '@x2f/accounts';
import type { BanReasonCode } from '@x2f/staff';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { Deps } from '../app.js';
import { addAlert } from '../alerts.js';
import type { Queryable } from '../db/pool.js';
import type { EventBus } from '../events/bus.js';
import { ApiError } from '../errors.js';
import { hasAbility } from '../team/abilities.js';
import { insideHours } from '../team/limits.js';
import type { MemberAccess } from '../team/perms.js';
import { COOKIE_ATTRS, deviceHash, ensureDeviceCookie, trustDevice } from './device.js';
import { BOUND_COOKIE, boundCookieValid, boundSessionsOn, issueBoundCookie, sessionKeyOf } from './deviceBound.js';

export const SESSION_COOKIE = '__Host-x2f_session';
/** Plan 4 Task 4: the staff API's own session cookie (its own origin, so its own cookie jar too). */
export const STAFF_SESSION_COOKIE = '__Host-x2f_staff';

/**
 * Which app's sessions a Fastify instance reads and writes (Plan 4 Task 4, migration 202). A session
 * row records the app that started it, and `requireSession` accepts only its own app's rows, so a
 * staff session is refused on the trader API (and a trader session on the staff API) even when its
 * token is sent under the other app's cookie name.
 */
export interface SessionRealm {
  cookie: string;
  app: 'trader' | 'staff';
}
export const TRADER_REALM: SessionRealm = { cookie: SESSION_COOKIE, app: 'trader' };
export const STAFF_REALM: SessionRealm = { cookie: STAFF_SESSION_COOKIE, app: 'staff' };

/**
 * The account kinds the trader API's login mounts serve (`/v1/login/webauthn`, `/v1/login/pgp`).
 * Owner 2026-11-03 (Q19): staff have two separate logins, an ordinary trader account for trading and
 * the staff account, which logs in only on the staff API (`staffLoginRoutes`). A staff account is
 * not in these kinds, so the lookup treats it as not found (security review RV5 I1): start and
 * finish answer exactly as for a login name or key that does not exist (decoy options or message,
 * then 401 `webauthn-failed` / `code-invalid`), and nothing tells that the account is there. Team
 * members are vendor-side and stay. The owner is refused here the same way (owner Q13, 6 Nov: "the
 * owner uses only the staff site"); the owner's Price health moved to `GET /staff/v1/price-health`.
 */
export const TRADER_LOGIN_KINDS: readonly AccountKind[] = ['trader', 'member'];

/** The realm the request's app decorated (`buildApi`: trader; `buildStaffApi`: staff). */
export function realmOf(req: FastifyRequest): SessionRealm {
  return (req.server as { sessionRealm?: SessionRealm }).sessionRealm ?? TRADER_REALM;
}
/** 32 random bytes, base64url without padding. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

const HOUR = 3600_000;
const DAY = 24 * HOUR;
export const ONBOARDING_MS = 30 * 60_000;
/** How long a recovery-code login confirms every change without a token (owner, 26 Nov 2026; confirm.ts). */
export const RECOVERY_WINDOW_MS = 60 * 60_000;
const DEVICE_LABEL_MAX = 60;

/** Every session is a full one (owner, 26 Nov 2026: a recovery-code login is a full session too). */
export type SessionLevel = 'full';
export type LoginMethod = 'pgp' | 'passkey' | 'security-key' | 'totp' | 'recovery-code';

/** What `requireSession` puts on the request. */
export interface AuthContext {
  sessionId: string;
  accountId: string;
  kind: AccountKind;
  level: SessionLevel;
  onboardingUntil: Date | null;
  /**
   * Owner, 26 Nov 2026: a session opened with the recovery code confirms every change without a
   * token until then (RECOVERY_WINDOW_MS, confirm.ts); null for every other session.
   */
  recoveryUntil: Date | null;
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
  /** The member's ticked boxes (team/abilities.ts; empty for the account owner, who has every permission). */
  memberAbilities: readonly string[];
  /** The member's name as the chat label shows it; null for the account owner. */
  memberName: string | null;
  /**
   * Plan 4 Task 27: the account has a site ban in force (its team members' sessions included); the
   * gate (banState.ts) already let this request through, and a route that lists may narrow to what
   * finishes the unfinished (D-005: GET /v1/trades).
   */
  siteBanned: boolean;
  /**
   * The account holds fewer than two kinds of login method and the sign-up window is over, so
   * this session reaches only the set-up routes (setupOnly.ts); `me` says so.
   */
  setupOnly: boolean;
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
 * Idle and absolute lifetimes: staff and owner a fixed 2 h / 12 h. A full
 * trader session has neither (null): it lasts the length chosen at login (`expires_at`), extended
 * only by "Stay logged in?" with a login method, and has no fixed maximum (owner, 2 Nov 2026).
 */
export function sessionPolicy(kind: AccountKind, _level: SessionLevel): { idleMs: number; absoluteMs: number } | null {
  if (kind === 'trader') return null;
  return { idleMs: STAFF_IDLE_HOURS * HOUR, absoluteMs: 12 * HOUR };
}

const tokenHash = (token: string): Buffer => createHash('sha256').update(token).digest();

function presentedToken(req: FastifyRequest): string | null {
  const v = req.cookies?.[realmOf(req).cookie];
  return typeof v === 'string' && TOKEN.test(v) ? v : null;
}

/**
 * Review S-m1: "Stay logged in" gives the session a new token, inside the extend's transaction
 * (`db` a client after `begin`, the account locked by `requireLiveSessionInTx`). The token before
 * it is kept as `prev_token_hash` until `oldEnd`, the end the session had before this extend: a tab
 * whose request still carries it (sent before the new cookie arrived) is not logged out by the swap,
 * and a copied cookie dies at that old end instead of riding every extend. A token older than that
 * is dropped at once. Returns `after`, which sets the new cookie (fresh `TRADER_COOKIE_MS`
 * lifetime); the caller runs it once the transaction has committed. The session id is unchanged, so
 * its streams, confirm tokens and device row go on.
 */
export async function rotateSessionToken(
  db: Queryable,
  req: FastifyRequest,
  reply: FastifyReply,
  sessionId: string,
  oldEnd: Date,
): Promise<() => void> {
  const token = randomBytes(32).toString('base64url');
  await db.query(
    'update sessions set prev_token_hash = token_hash, prev_token_until = $3, token_hash = $2 where id = $1',
    [sessionId, tokenHash(token), oldEnd],
  );
  return () => void reply.setCookie(realmOf(req).cookie, token, { ...COOKIE_ATTRS, maxAge: Math.floor(TRADER_COOKIE_MS / 1000) });
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
}

/**
 * The statements of a new session, inside the caller's transaction (`db` a client after `begin`).
 * Always mints a new token (a presented cookie is never reused, so a planted one cannot be fixed);
 * a session cookie the request carried is revoked; the device is trusted; later logins (not the
 * first session) add an alert (a recovery-code login its own one). Returns the session id and `after`, which the caller runs once the transaction
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
  const now = deps.clock();
  const token = randomBytes(32).toString('base64url');
  const label = cleanLabel(a.deviceLabel);
  ensureDeviceCookie(req, reply);
  const device = deviceHash(req);
  const presented = presentedToken(req);
  const realm = realmOf(req);
  // S-085: the browser's public key, checked before anything is written (a malformed one is 400).
  const boundKey = sessionKeyOf(req, realm.app);

  const acct = await db.query<{ kind: AccountKind }>('select kind from accounts where id = $1', [a.accountId]);
  let row = acct.rows[0];
  if (!row) throw new ApiError(401, 'not-authenticated');
  /** Set for a team member's login (Plan 2 Task 18). */
  let member: { id: string; teamId: string; name: string } | null = null;
  // Plan 2 Task 18: a team member's login starts a session of the team account, tagged with
  // the member. Only a joined, not removed member of a live team; `for share` makes a removal
  // that runs at the same time wait, so it then ends this session too.
  if (row.kind === 'member') {
    // The team account's lock first (the order of every account write; a recovery-code login logs
    // the team out under it).
    const team = await db.query<{ account_id: string }>('select account_id from team_members where member_account_id = $1', [a.accountId]);
    if (team.rows[0]) await db.query('select 1 from accounts where id = $1 for no key update', [team.rows[0].account_id]);
    const tm = await db.query<{ id: string; account_id: string; trade_tag: string; kind: AccountKind; disabled_at: Date | null; hours: unknown }>(
      `select tm.id, tm.account_id, tm.trade_tag, t.kind, t.disabled_at, tm.hours
         from team_members tm join accounts t on t.id = tm.account_id
        where tm.member_account_id = $1 and tm.removed_at is null and tm.joined_at is not null
        for share of tm`,
      [a.accountId],
    );
    const m = tm.rows[0];
    if (!m || m.kind !== 'trader') throw new ApiError(403, 'account-disabled');
    if (m.disabled_at !== null) throw new ApiError(403, 'account-disabled');
    // J-20 (owner p7-11): outside the working hours the lead set, a member cannot log in.
    if (!insideHours(m.hours, now)) throw new ApiError(403, 'outside-login-hours');
    member = { id: m.id, teamId: m.account_id, name: m.trade_tag };
    row = { kind: m.kind };
  }
  const policy = sessionPolicy(row.kind, a.level);
  // A full trader session lasts the shortest choice until its person picks a length (`setSessionLength`).
  const expiresAt = policy ? deadline(now, now, policy) : new Date(now.getTime() + UNCHOSEN_SESSION_HOURS * HOUR);
  /** The session this browser's cookie named, revoked by this login (its streams end too). */
  let replaced: { id: string; account_id: string } | null = null;
  if (presented) {
    const old = await db.query<{ id: string; account_id: string }>(
      'update sessions set revoked_at = $2 where (token_hash = $1 or prev_token_hash = $1) and app = $3 and revoked_at is null returning id, account_id',
      [tokenHash(presented), now, realm.app],
    );
    replaced = old.rows[0] ?? null;
  }
  const { rows } = await db.query<{ id: string }>(
    `insert into sessions (account_id, token_hash, level, device_label, onboarding_until, created_at, last_seen_at, period_started_at, expires_at, member_id, app, bound_key, recovery_until)
     values ($1, $2, $3, $4, $5, $6, $6, $6, $7, $8, $9, $10, $11) returning id`,
    [
      member ? member.teamId : a.accountId, tokenHash(token), a.level, label,
      // A member's session never gets the sign-up window (its exemptions are the account owner's).
      a.firstSession && !member ? new Date(now.getTime() + ONBOARDING_MS) : null,
      now, expiresAt,
      member?.id ?? null,
      realm.app,
      boundKey,
      a.method === 'recovery-code' && !member ? new Date(now.getTime() + RECOVERY_WINDOW_MS) : null,
    ],
  );
  const sessionId = rows[0]!.id;
  // S-085: a bound session gets its first bound cookie with its session cookie.
  const setBound = boundKey !== null ? await issueBoundCookie(db, sessionId, now, reply) : null;
  // Owner answer Q77 (6 Nov 2026): a vendor account not logged into for 60 days closes
  // (accountInactivity.ts). Every login counts; a member's login counts for the team account.
  await db.query('update accounts set last_login_at = $2 where id = $1', [member ? member.teamId : a.accountId, now]);
  // A member's device is trusted for the member's own login only, never for the account owner's.
  if (device) await trustDevice({ db, clock: deps.clock }, a.accountId, device);
  /** J-20 (owner p11-27, S-107): set when this is the member's first login ever. */
  let firstMemberLogin = false;
  if (member) {
    // Owner p11-27 (S-107, replacing p7-10's first-login approval): no approval; the lead is told,
    // in the alert list, by a push and by the secure Jabber notice (when they set Jabber alerts up),
    // when a member logs in for the first time.
    const first = await db.query('update team_members set first_login_at = $2 where id = $1 and first_login_at is null returning id', [member.id, now]);
    if ((first.rowCount ?? 0) > 0) {
      firstMemberLogin = true;
      // Review F4: through jabber-notices' outbox, in this transaction (a rollback queues nothing).
      await db.query(
        "select jabber_queue(c.account_id, c.jid_sealed, 'team-member-first-login') from jabber_contacts c where c.account_id = $1 and c.enabled and c.jid_sealed is not null",
        [member.teamId],
      );
    }
    // Review F5 (Q3): a member's only first session is the join's (`firstSession`, team join
    // routes), which is their first login; finishMember's `team-member-joined` already tells the
    // lead, so the join adds no second or third alert. Every other member login is told: a first
    // login that is not the join (the join's session never opened, e.g. the process stopped between
    // the join's commit and its session) and each later one.
    if (!a.firstSession) {
      if (firstMemberLogin) await addAlert(db, member.teamId, 'team-member-first-login', { member: member.name, method: a.method, deviceLabel: label }, now);
      // The account owner is told about every member login (in the team account's alert list).
      await addAlert(db, member.teamId, 'team-member-login', { member: member.name, method: a.method, deviceLabel: label }, now);
    }
  } else if (!a.firstSession) {
    if (a.method === 'recovery-code') {
      await addAlert(db, a.accountId, 'recovery-login', { method: a.method, deviceLabel: label }, now);
    } else {
      await addAlert(db, a.accountId, 'new-login', { method: a.method, deviceLabel: label }, now);
    }
  }
  const after = () => {
    if (replaced) req.server.events.closeSession(replaced.account_id, replaced.id);
    // Task 17 (owner, 2026-10-29): every new login is pushed to the account's other devices. A
    // member's login is an alert to the account owner instead (Task 18).
    if (!a.firstSession && !member) void req.server.push.send(a.accountId, 'new-login', { exceptSession: sessionId }).catch(() => undefined);
    // J-20 (p11-27): a member's first login is pushed to the lead's devices.
    if (member && firstMemberLogin) void req.server.push.send(member.teamId, 'new-login').catch(() => undefined);
    void reply.setCookie(realm.cookie, token, { ...COOKIE_ATTRS, maxAge: Math.floor((policy ? policy.absoluteMs : TRADER_COOKIE_MS) / 1000) });
    setBound?.();
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
  recovery_until: Date | null;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  kind: AccountKind;
  disabled_at: Date | null;
  terms_version: string | null;
  member_id: string | null;
  member_live: boolean | null;
  member_abilities: string[] | null;
  member_name: string | null;
  member_disabled: boolean | null;
  member_terms_version: string | null;
  /** J-20: the member's working hours as stored (null for the account owner's sessions). */
  member_hours: unknown;
  app: SessionRealm['app'];
  /** Set when the request carried the token before the last extend (review S-m1): its own end. */
  prev_until: Date | null;
  /**
   * Plan 4 Task 27: the account's site ban in force at the request's time (one at most: placing a
   * second of the same kind is refused), read in this same query (batch 10a: one round trip).
   */
  site_ban_reason: BanReasonCode | null;
  site_ban_until: Date | null;
  /** The account may hold fewer than two kinds of login method (setupOnly.ts FEW_METHODS_SQL). */
  few_methods: boolean;
  /** S-085: the session is bound to a browser key; its bound cookie's hash and end. */
  bound: boolean;
  bound_token_hash: Buffer | null;
  bound_until: Date | null;
  /** The previous bound cookie's hash, valid until `bound_prev_until` (re-verify R1). */
  bound_prev_hash: Buffer | null;
  bound_prev_until: Date | null;
}

/** Marks the preHandlers `requireSession` returns, so the app can list the routes that run with a session. */
const SESSION_HOOK = Symbol('requireSession');

/**
 * preHandler for routes that need a logged-in account. Defaults to full sessions of any kind.
 * 401 `not-authenticated` (missing, revoked, past its chosen length, idle- or absolute-expired); 403 `account-disabled`
 * (checked on every request); 403
 * `wrong-account-kind` when `kinds` excludes the account; 403 `terms-required` `{ version }` for a
 * trader on a stale Terms version unless `allowStaleTerms` (R10: only logout, me, terms, methods
 * and sessions routes set it, plus, by lead decision 2026-10-29 (Plan 3 Task 36), the routes that
 * shut offers off or read my own: `GET /v1/account/offers`, `POST /v1/account/offers/status`
 * (turning on still checks the Terms) and `PATCH /v1/offers/:id` (relisting still checks them)). Touches `last_seen_at` (and moves `expires_at`) unless `touch: false`:
 * a long-lived or self-reconnecting request such as `GET /v1/events` must never count as activity,
 * or an open tab would keep an idle staff session alive past its idle time (review 2026-10-27, I1).
 *
 */
export function requireSession(
  opts: {
    kinds?: AccountKind[];
    allowStaleTerms?: boolean;
    touch?: boolean;
    /**
     * S-085: let a bound session through without a valid bound cookie. Only the two proof routes
     * (auth/deviceBound.ts), which are how a bound cookie is renewed, set it.
     */
    allowUnproven?: boolean;
    /**
     * Plan 2 Task 18: which team members may pass. Left out, a member's session gets 403
     * `owner-only` (fail closed: a route is the account owner's until it says otherwise); `any`
     * lets every member through; an ability (or a list: any one of them) lets through members
     * holding it (others 403 `forbidden`). Job 1c: team/abilities.ts.
     */
    member?: MemberAccess;
  } = {},
): preHandlerAsyncHookHandler {
  const handler: preHandlerAsyncHookHandler = async function (req: FastifyRequest) {
    const deps = req.server.deps;
    const token = presentedToken(req);
    if (!token) throw new ApiError(401, 'not-authenticated');
    const now = deps.clock();
    const { rows } = await deps.db.query<SessionRow>(
      `select s.id, s.account_id, s.level, s.onboarding_until, s.recovery_until, s.created_at, s.last_seen_at, s.expires_at, s.revoked_at,
              a.kind, a.disabled_at, a.terms_version, s.member_id,
              (tm.removed_at is null and tm.joined_at is not null and tm.account_id = s.account_id) as member_live,
              tm.abilities as member_abilities, tm.trade_tag as member_name, ma.disabled_at is not null as member_disabled,
              ma.terms_version as member_terms_version, tm.hours as member_hours, s.app,
              case when s.token_hash = $1 then null else s.prev_token_until end as prev_until,
              sb.reason_code as site_ban_reason, sb.until as site_ban_until,
              ${FEW_METHODS_SQL} as few_methods,
              s.bound_key is not null as bound, s.bound_token_hash, s.bound_until, s.bound_prev_hash, s.bound_prev_until
         from sessions s join accounts a on a.id = s.account_id
         left join team_members tm on tm.id = s.member_id
         left join accounts ma on ma.id = tm.member_account_id
         left join lateral (
           select b.reason_code, b.until from account_bans b
            where b.account_id = s.account_id and b.kind = 'site' and b.ended_at is null and b.lifted_at is null
              and (b.until is null or b.until > $2)
            limit 1
         ) sb on true
        where s.token_hash = $1 or s.prev_token_hash = $1`,
      [tokenHash(token), now],
    );
    const found = rows[0];
    if (!found || found.revoked_at !== null) throw new ApiError(401, 'not-authenticated');
    // Review S-m1: the token before the last extend lasts to the end it had then, never longer
    // than the session itself (a later shortening or expiry ends it too).
    const row: SessionRow =
      found.prev_until !== null && found.prev_until.getTime() < found.expires_at.getTime() ? { ...found, expires_at: found.prev_until } : found;
    // Plan 4 Task 4: only this app's sessions (a staff session on the trader API, or the reverse).
    if (row.app !== realmOf(req).app) throw new ApiError(401, 'not-authenticated');
    // Task 18 review M9(c): a member's sessions are rows of the team account (`startSession`); a
    // session of a member login account itself is never valid, whatever inserted it.
    if (row.kind === 'member') throw new ApiError(401, 'not-authenticated');
    // Team audit v2: a member's refused request is logged (routes/teamAudit.ts `installRefusalAudit`).
    if (row.member_id !== null) req.memberAttempt = { accountId: row.account_id, memberId: row.member_id };
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
    // A disabled account says so first, also to a bound session without a fresh bound cookie
    // (re-verify Info: otherwise renewal loops to the login page instead of "account disabled").
    if (row.disabled_at !== null || row.member_disabled === true) throw new ApiError(403, 'account-disabled');
    // J-20 (owner p7-11): outside the member's working hours the session ends, whatever the route.
    if (row.member_id !== null && !insideHours(row.member_hours, now)) {
      await deps.db.query('update sessions set revoked_at = $2 where id = $1 and revoked_at is null', [row.id, now]);
      req.server.events.closeSession(row.account_id, row.id);
      throw new ApiError(401, 'outside-login-hours');
    }
    // S-085: a bound session also shows a bound cookie the key renewed within BOUND_TTL_MS (or the
    // one before it, within BOUND_OVERLAP_MS of a renewal), before anything else is answered.
    if (
      row.bound && boundSessionsOn(deps.config) && !opts.allowUnproven
      && !boundCookieValid(req, { hash: row.bound_token_hash, until: row.bound_until }, { hash: row.bound_prev_hash, until: row.bound_prev_until }, now)
    ) {
      throw new ApiError(401, 'session-proof-required');
    }
    if (row.member_id !== null) {
      if (opts.member === undefined) throw new ApiError(403, 'owner-only');
      if (!hasAbility(row.member_abilities ?? [], opts.member)) throw new ApiError(403, 'forbidden');
    }
    if (opts.kinds && !opts.kinds.includes(row.kind)) throw new ApiError(403, 'wrong-account-kind');
    // Plan 4 Task 27 (2026-10-29b): a site-banned account (its team members' sessions included)
    // reaches only the notice, and while something is unfinished what finishes it (banState.ts);
    // every other route is 403 `banned` with the kind, the general reason and the end (null: lifetime).
    // The ban comes from the session query above (sb), so an account without one costs no extra read.
    if (row.kind === 'trader' && row.site_ban_reason !== null) {
      if (!(await siteBanAllows(deps.db, row.account_id, { method: req.method, url: req.routeOptions.url ?? '', params: req.params, body: req.body }))) {
        throw new ApiError(403, 'banned', { kind: 'site', reasonCode: row.site_ban_reason, until: row.site_ban_until?.toISOString() ?? null });
      }
    }
    // Owner 26 Nov 2026 (at least two kinds of login method): outside its sign-up window the session
    // of an account holding fewer reaches only the routes that set up another method
    // (setupOnly.ts); every other route is 403 `two-methods-required`.
    const windowOpen = row.onboarding_until !== null && row.onboarding_until.getTime() > now.getTime();
    const setupOnly = row.few_methods && !windowOpen && (await shortOfMethodsNow(deps, row.account_id, now));
    if (setupOnly && !setupOnlyAllows(req.method, req.routeOptions.url ?? '')) throw new ApiError(403, 'two-methods-required');
    // Review 2026-11-08 F1 (the front door: nobody gets in without signing the agreement): a team
    // member must have accepted the current Terms on their own login account too; the team
    // account's acceptance is the account owner's and never stands in for theirs.
    if (
      row.kind === 'trader' && !opts.allowStaleTerms &&
      (row.terms_version !== deps.config.termsVersion || (row.member_id !== null && row.member_terms_version !== deps.config.termsVersion))
    ) {
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
      recoveryUntil: row.recovery_until,
      // The deadline as the row had it (an untouched request did not move it).
      expiresAt: policy === null ? row.expires_at : new Date(Math.min(row.expires_at.getTime(), row.last_seen_at.getTime() + policy.idleMs)),
      memberId: row.member_id,
      memberAbilities: row.member_id !== null ? (row.member_abilities ?? []) : [],
      memberName: row.member_id !== null ? row.member_name : null,
      siteBanned: row.kind === 'trader' && row.site_ban_reason !== null,
      setupOnly,
    };
  };
  (handler as unknown as Record<symbol, true>)[SESSION_HOOK] = true;
  if (opts.member !== undefined) MEMBER_GUARDS.set(handler, opts.member);
  return handler;
}

/**
 * The person behind a session: the account itself, or for a team member's session (a session of the
 * team account, Task 18) the member's own login account. Their login methods and personal settings
 * (the idle reminder) live there. 401 `not-authenticated` when the member row is gone.
 */
export async function personAccountId(db: Queryable, auth: { accountId: string; memberId: string | null }): Promise<string> {
  if (auth.memberId === null) return auth.accountId;
  const { rows } = await db.query<{ member_account_id: string | null }>('select member_account_id from team_members where id = $1', [auth.memberId]);
  const id = rows[0]?.member_account_id;
  if (!id) throw new ApiError(401, 'not-authenticated');
  return id;
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
export function logoutRoute(app: FastifyInstance, url = '/v1/logout', config: Record<string, unknown> = {}): void {
  app.post(url, { config }, async (req, reply) => {
    const token = presentedToken(req);
    if (token) {
      const { db, clock } = req.server.deps;
      const r = await db.query<{ id: string; account_id: string }>(
        'update sessions set revoked_at = $2 where (token_hash = $1 or prev_token_hash = $1) and app = $3 and revoked_at is null returning id, account_id',
        [tokenHash(token), clock(), realmOf(req).app],
      );
      for (const row of r.rows) req.server.events.closeSession(row.account_id, row.id);
    }
    void reply.clearCookie(realmOf(req).cookie, COOKIE_ATTRS);
    // S-085 (review Info): the trader's bound cookie goes with the session (useless without its row,
    // but nothing is left behind). The staff API never sets one.
    if (realmOf(req).app === 'trader') void reply.clearCookie(BOUND_COOKIE, COOKIE_ATTRS);
    return { ok: true };
  });
}
