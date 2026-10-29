import { checkLoginName, isIdleHours, type AccountKind, type IdleHours, type MethodType } from '@x2f/accounts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Deps } from '../app.js';
import type { Queryable } from '../db/pool.js';
import { tradeCap, type Stage } from '../traders/stage.js';
import { ApiError } from '../errors.js';
import { addAlert } from '../alerts.js';
import type { TeamRole } from '../team/perms.js';
import { requireConfirm } from '../auth/confirm.js';
import { STAFF_IDLE_HOURS, deadline, endSession, requireSession, sessionPolicy, type SessionLevel } from '../auth/sessions.js';

export type Suggestion = 'add-authenticator' | 'add-backup';

export interface AccountOverview {
  /** The public display name. The private login name is never sent, not even to its owner. */
  displayName: string;
  /**
   * True for an account made before login names existed (migration 009): it still logs in by its
   * public display name until `POST /v1/account/login-name` sets a private one (review I3).
   */
  needsLoginName: boolean;
  kind: AccountKind;
  /** The calling session's level. */
  level: SessionLevel;
  /** The calling recovery session's hold while it is still ahead (Task 9), else null. */
  holdUntil: string | null;
  /** A trader's starter-limits stage (spec 2.3; plan Task 4 Revision 2026-10-26), the same as on their offers; null for staff and owner. */
  stage: Stage | null;
  methods: MethodType[];
  hasBackup: boolean;
  suggestions: Suggestion[];
  logoutTimer: LogoutTimer;
  termsCurrent: boolean;
  /**
   * Plan 2 Task 18: set when the caller is a team member (the overview is then of the account
   * they work for, with their own login methods); null for the account owner.
   */
  member: MemberOverview | null;
}

export interface MemberOverview {
  /** The member's name, as chat labels show it. */
  name: string;
  roles: TeamRole[];
}

/**
 * The logout timer (owner, 2026-10-23): how many idle hours end a session. A trader chooses 2, 4,
 * 6, 8, 10 or 12 (`adjustable`); staff and owner accounts are fixed at 2 hours.
 */
export interface LogoutTimer {
  idleHours: number;
  adjustable: boolean;
}

export function logoutTimerOf(kind: AccountKind, idleHours: IdleHours): LogoutTimer {
  return kind === 'trader' ? { idleHours, adjustable: true } : { idleHours: STAFF_IDLE_HOURS, adjustable: false };
}

/** How many of each login method an account holds (read straight from the method tables). */
export interface MethodCounts {
  pgp: number;
  passkey: number;
  securityKey: number;
  password: boolean;
  totp: boolean;
  /** Recovery codes not yet used. */
  recoveryCodes: number;
}

/**
 * The account's method counts. Kept to one query here rather than built on Task 10's `listMethods`,
 * so `hasBackup` counts every credential (two passkeys are two) and spent recovery codes are none.
 */
export async function methodCounts(db: Queryable, accountId: string): Promise<MethodCounts> {
  const { rows } = await db.query<{ pgp: number; passkey: number; security_key: number; password: boolean; totp: boolean; recovery: number }>(
    `select (select count(*)::int from pgp_keys where account_id = $1) as pgp,
            (select count(*)::int from webauthn_credentials where account_id = $1 and kind = 'passkey') as passkey,
            (select count(*)::int from webauthn_credentials where account_id = $1 and kind = 'security-key') as security_key,
            exists (select 1 from passwords where account_id = $1) as password,
            exists (select 1 from totp where account_id = $1) as totp,
            (select count(*)::int from recovery_codes where account_id = $1 and used_at is null) as recovery`,
    [accountId],
  );
  const r = rows[0]!;
  return { pgp: r.pgp, passkey: r.passkey, securityKey: r.security_key, password: r.password, totp: r.totp, recoveryCodes: r.recovery };
}

/** The method types present, in `MethodType` order; spent recovery codes are not a method. */
export function methodTypes(c: MethodCounts): MethodType[] {
  const out: MethodType[] = [];
  if (c.pgp > 0) out.push('pgp');
  if (c.passkey > 0) out.push('passkey');
  if (c.securityKey > 0) out.push('security-key');
  if (c.password) out.push('password');
  if (c.totp) out.push('totp');
  if (c.recoveryCodes > 0) out.push('recovery-codes');
  return out;
}

/**
 * R11 (owner, 2026-10-17): a backup is TOTP, unused recovery codes, a second PGP key, or a security
 * key or passkey that is not the account's only primary credential (each PGP key, security key and
 * passkey counts once, a password once). A password is a primary method only and never the backup
 * itself: password + PGP has no backup, password + passkey does (the passkey is the backup).
 */
export function hasBackup(c: MethodCounts): boolean {
  if (c.totp || c.recoveryCodes > 0 || c.pgp >= 2) return true;
  const webauthn = c.passkey + c.securityKey;
  const primaries = c.pgp + webauthn + (c.password ? 1 : 0);
  return webauthn >= 1 && primaries >= 2;
}

export function suggestionsFor(c: MethodCounts): Suggestion[] {
  const out: Suggestion[] = [];
  if (c.password && !c.totp) out.push('add-authenticator');
  if (!hasBackup(c)) out.push('add-backup');
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A route `:id` that is not a UUID can name no row: 404 like any other id the caller does not own. */
function idParam(req: FastifyRequest): string {
  const id = (req.params as { id?: unknown }).id;
  if (typeof id !== 'string' || !UUID.test(id)) throw new ApiError(404, 'not-found');
  return id;
}

async function overview(deps: Deps, req: FastifyRequest): Promise<AccountOverview> {
  const { accountId, sessionId } = req.auth;
  // A member's own login methods (its own login account); the account owner's are not theirs to see.
  let methodsOf = accountId;
  if (req.auth.memberId !== null) {
    const m = await deps.db.query<{ member_account_id: string }>('select member_account_id from team_members where id = $1', [req.auth.memberId]);
    if (!m.rows[0]) throw new ApiError(401, 'not-authenticated');
    methodsOf = m.rows[0].member_account_id;
  }
  const { rows } = await deps.db.query<{
    display_name: string;
    legacy_login_name: boolean;
    kind: AccountKind;
    idle_hours: IdleHours;
    terms_version: string | null;
    level: SessionLevel;
    hold_until: Date | null;
  }>(
    `select a.display_name, a.legacy_login_name, a.kind, a.idle_hours, a.terms_version, s.level, s.hold_until
       from accounts a join sessions s on s.account_id = a.id
      where a.id = $1 and s.id = $2`,
    [accountId, sessionId],
  );
  const row = rows[0];
  if (!row) throw new ApiError(401, 'not-authenticated');
  const counts = await methodCounts(deps.db, methodsOf);
  const now = deps.clock();
  const member = req.auth.memberId !== null ? { name: req.auth.memberName ?? '', roles: [...req.auth.memberRoles] } : null;
  const held = row.level === 'recovery' && row.hold_until !== null && now.getTime() < row.hold_until.getTime();
  return {
    displayName: row.display_name,
    needsLoginName: row.legacy_login_name,
    kind: row.kind,
    level: row.level,
    holdUntil: held ? row.hold_until!.toISOString() : null,
    stage: row.kind === 'trader' ? (await tradeCap(deps.db, accountId, now)).stage : null,
    methods: methodTypes(counts),
    // A member logs in with two factors by the staff rule: nothing to suggest, and only the account owner sets the timer.
    hasBackup: member !== null ? true : hasBackup(counts),
    suggestions: member !== null ? [] : suggestionsFor(counts),
    logoutTimer: member !== null ? { idleHours: row.idle_hours, adjustable: false } : logoutTimerOf(row.kind, row.idle_hours),
    // Staff and owner accounts carry no Terms version (R10).
    termsCurrent: row.kind !== 'trader' || row.terms_version === deps.config.termsVersion,
    member,
  };
}

/**
 * Task 11: account overview, sessions (devices), alerts and the Terms of Service. Nothing here
 * reads or returns an IP address or user agent; device labels were cleaned by `startSession`.
 *
 * Read routes and marking an alert seen take `allowRecovery` and `allowHeld`, so a held recovery
 * session can see its hold and its alerts (it signs out with `POST /v1/logout`). Ending a session
 * needs a full session: a recovery session must not sign the real owner out during the hold.
 * Accepting the Terms is a change, so it is held like the other changes.
 */
/**
 * True for a database error that means the chosen login name clashes with another account's
 * name on `POST /v1/account/login-name`: a taken key (23505 on `accounts_login_key_key` or the
 * `name_keys` primary key), or a deadlock (40P01). Two pre-009 accounts setting each other's
 * display name as their login name at the same moment each wait on the other's old login key
 * (legacy rows have login key = display key); the victim is a clash too, never a 500 (FU-A
 * round-2 Minor 1).
 */
export function isLoginNameClash(e: unknown): boolean {
  if (e === null || typeof e !== 'object') return false;
  const err = e as { code?: unknown; constraint?: unknown };
  if (err.code === '40P01') return true;
  return err.code === '23505' && (err.constraint === 'accounts_login_key_key' || err.constraint === 'name_keys_pkey');
}

export function accountRoutes(app: FastifyInstance): void {
  const deps = (): Deps => app.deps;
  const readAny = { allowRecovery: true, allowHeld: true } as const;

  app.get('/v1/terms', async () => ({ version: deps().config.termsVersion }));

  /**
   * A pre-009 account sets its private login name, once (review I3). Full session only (a held
   * recovery session may not change how the account logs in) and behind a confirm token for
   * `set-login-name` (re-review 2: a stolen session must not quietly change how the account logs
   * in); a `login-name-set` alert (without the name) is written in the same transaction. 400 `login-name-invalid` /
   * `names-same`, 409 `login-name-set` when the account already chose its names, 409
   * `names-unavailable` for a name taken in either namespace (the `name_keys` trigger). Each call
   * takes a register-budget token: a taken name answers like a sign-up's, at the same cost
   * (plan-2-review residual (b)); the login name is never echoed.
   */
  app.post('/v1/account/login-name', { preHandler: [requireSession(), requireConfirm({ kind: 'set-login-name' })] }, async (req) => {
    const d = deps();
    req.server.budgets.register.take();
    const body = req.body;
    const input = body !== null && typeof body === 'object' ? (body as { loginName?: unknown }).loginName : undefined;
    const r = checkLoginName(typeof input === 'string' ? input : '');
    if (!r.ok) throw new ApiError(400, 'login-name-invalid');
    const { rows } = await d.db.query<{ display_key: string; legacy_login_name: boolean }>(
      'select display_key, legacy_login_name from accounts where id = $1',
      [req.auth.accountId],
    );
    const row = rows[0];
    if (!row) throw new ApiError(401, 'not-authenticated');
    if (!row.legacy_login_name) throw new ApiError(409, 'login-name-set');
    if (r.key === row.display_key) throw new ApiError(400, 'names-same');
    const client = await d.db.connect();
    try {
      await client.query('begin');
      try {
        const updated = await client.query(
          'update accounts set login_name = $2, login_key = $3, legacy_login_name = false where id = $1 and legacy_login_name',
          [req.auth.accountId, r.name, r.key],
        );
        if ((updated.rowCount ?? 0) === 0) throw new ApiError(409, 'login-name-set');
        await addAlert(client, req.auth.accountId, 'login-name-set', {}, d.clock());
        await client.query('commit');
      } catch (e) {
        await client.query('rollback');
        throw e;
      }
    } catch (e) {
      if (isLoginNameClash(e)) throw new ApiError(409, 'names-unavailable');
      throw e;
    } finally {
      client.release();
    }
    return { ok: true };
  });

  app.post(
    '/v1/account/terms',
    { preHandler: requireSession({ allowRecovery: true, allowStaleTerms: true }) },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const d = deps();
      const version = d.config.termsVersion;
      const body = req.body as { version?: unknown } | null | undefined;
      const given = body !== null && typeof body === 'object' ? body.version : undefined;
      if (given !== version) throw new ApiError(400, 'terms-not-accepted', { version });
      await d.db.query('update accounts set terms_version = $2, terms_accepted_at = $3 where id = $1 and kind = $4', [
        req.auth.accountId, version, d.clock(), 'trader',
      ]);
      return reply.code(204).send();
    },
  );

  // Every team member may read who they are and what they may do (Task 18).
  app.get('/v1/account/me', { preHandler: requireSession({ ...readAny, allowStaleTerms: true, member: 'any' }) }, async (req) =>
    overview(deps(), req),
  );

  const LOGOUT_TIMER = '/v1/account/security/logout-timer';

  // Reading changes nothing: any session, even a held recovery one, may see the timer.
  app.get(LOGOUT_TIMER, { preHandler: requireSession({ ...readAny, allowStaleTerms: true }) }, async (req) => {
    const { rows } = await deps().db.query<{ kind: AccountKind; idle_hours: IdleHours }>(
      'select kind, idle_hours from accounts where id = $1',
      [req.auth.accountId],
    );
    return logoutTimerOf(rows[0]!.kind, rows[0]!.idle_hours);
  });

  /**
   * `PUT /v1/account/security/logout-timer { idleHours }`: full trader sessions only (a recovery
   * session, held or not, gets 403 `recovery-session`; staff and owner 403 `wrong-account-kind`).
   * The new timer applies at once: every live full session of the account gets its idle deadline
   * moved to `last_seen_at + idleHours` (capped by the 30-day absolute limit); a session already
   * idle that long is refused at its next request by `requireSession`.
   */
  app.put(LOGOUT_TIMER, { preHandler: requireSession({ kinds: ['trader'] }) }, async (req) => {
    const d = deps();
    const body = req.body;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'bad-request');
    const idleHours = (body as { idleHours?: unknown }).idleHours;
    if (!isIdleHours(idleHours)) throw new ApiError(400, 'bad-request');
    const now = d.clock();
    const policy = sessionPolicy('trader', 'full', idleHours);
    const client = await d.db.connect();
    try {
      await client.query('begin');
      try {
        await client.query('update accounts set idle_hours = $2 where id = $1', [req.auth.accountId, idleHours]);
        const { rows } = await client.query<{ id: string; created_at: Date; last_seen_at: Date }>(
          `select id, created_at, last_seen_at from sessions
            where account_id = $1 and level = 'full' and revoked_at is null and expires_at > $2
            for update`,
          [req.auth.accountId, now],
        );
        for (const s of rows) {
          await client.query('update sessions set expires_at = $2 where id = $1', [s.id, deadline(s.created_at, s.last_seen_at, policy)]);
        }
        await client.query('commit');
      } catch (e) {
        await client.query('rollback');
        throw e;
      }
    } finally {
      client.release();
    }
    return logoutTimerOf('trader', idleHours);
  });

  app.get('/v1/account/sessions', { preHandler: requireSession({ ...readAny, allowStaleTerms: true }) }, async (req) => {
    const d = deps();
    const { rows } = await d.db.query<{ id: string; device_label: string; level: SessionLevel; created_at: Date; last_seen_at: Date; member: string | null }>(
      `select s.id, s.device_label, s.level, s.created_at, s.last_seen_at, tm.display_name as member
         from sessions s left join team_members tm on tm.id = s.member_id
        where s.account_id = $1 and s.revoked_at is null and s.expires_at > $2
        order by s.last_seen_at desc, s.created_at desc, s.id`,
      [req.auth.accountId, d.clock()],
    );
    return rows.map((s) => ({
      id: s.id,
      deviceLabel: s.device_label,
      level: s.level,
      createdAt: s.created_at.toISOString(),
      lastSeenAt: s.last_seen_at.toISOString(),
      current: s.id === req.auth.sessionId,
      // Task 18: a team member's session names the member (the account owner can end it here too).
      member: s.member,
    }));
  });

  app.delete(
    '/v1/account/sessions/:id',
    { preHandler: requireSession({ allowStaleTerms: true }) },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const d = deps();
      const id = idParam(req);
      const { rows } = await d.db.query('select 1 from sessions where id = $1 and account_id = $2', [id, req.auth.accountId]);
      if (rows.length === 0) throw new ApiError(404, 'not-found');
      await endSession({ ...d, events: req.server.events }, id);
      return reply.code(204).send();
    },
  );

  app.get('/v1/account/alerts', { preHandler: requireSession(readAny) }, async (req) => {
    const { rows } = await deps().db.query<{ id: string; kind: string; detail: unknown; created_at: Date; seen_at: Date | null }>(
      `select id, kind, detail, created_at, seen_at from alerts
        where account_id = $1 order by created_at desc, id desc limit 50`,
      [req.auth.accountId],
    );
    return rows.map((a) => ({
      id: a.id,
      kind: a.kind,
      detail: a.detail,
      createdAt: a.created_at.toISOString(),
      seenAt: a.seen_at?.toISOString() ?? null,
    }));
  });

  app.post(
    '/v1/account/alerts/:id/seen',
    // Marking seen is a change: a recovery session must not hide its own recovery-login alert from the owner.
    { preHandler: requireSession() },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const d = deps();
      const id = idParam(req);
      const r = await d.db.query('update alerts set seen_at = coalesce(seen_at, $3) where id = $1 and account_id = $2', [
        id, req.auth.accountId, d.clock(),
      ]);
      if ((r.rowCount ?? 0) === 0) throw new ApiError(404, 'not-found');
      return reply.code(204).send();
    },
  );
}
