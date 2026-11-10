import {
  SESSION_CHOICE_WINDOW_MS, UNCHOSEN_SESSION_HOURS, checkLoginName, isIdleReminderMinutes, isSessionHours, sessionHoursFor, type AccountKind, type ConfirmAction,
  type MethodType, type SessionAccountType,
} from '@x2f/accounts';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { Deps } from '../app.js';
import { SIGNED_BODY_LIMIT, checkTermsSignature, sealTermsSignature } from '../termsSignature.js';
import { lockNames, loginNameTaken, loginTags, setLoginName } from '../accounts.js';
import type { Config } from '../config.js';
import type { Queryable } from '../db/pool.js';
import { tradeCap, type Stage } from '../traders/stage.js';
import { ApiError } from '../errors.js';
import { addAlert } from '../alerts.js';
import { abilitiesView } from '../team/members.js';
import { assertSessionEndInHours, endWithinHours, ownLimitsView, type MemberLimitsView } from '../team/limits.js';
import type { PresetId, TeamRole } from '../team/abilities.js';
import { requireConfirm } from '../auth/confirm.js';
import { maxDevices } from '../auth/approval.js';
import { changesWait, pendingSummary } from '../auth/holdChanges.js';
import { revealDue } from '../auth/recovery.js';
import { waits, type LoginStrength } from '../auth/strength.js';
import { gateChange, stagedReply, holdUntil, requireLiveSessionInTx, requireNotHeld, weakOf, weakRefusal, withTx } from '../auth/hold.js';
import { personAccountId, requireSession, rotateSessionToken, type SessionLevel } from '../auth/sessions.js';

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
  termsCurrent: boolean;
  /** The end of the account's 24-hour hold (a recovery-code login, hold model v3) while one runs, else null. */
  accountHoldUntil: string | null;
  /** Hold model v3: the account's changes waiting their 24 h (the banner "N changes take effect on <date>"), else null. */
  pendingChanges: { count: number; takesEffectAt: string } | null;
  /**
   * Owner p4-8: for a team member, while the lead's changes wait, when they take effect (the
   * member's banner "A hold is on"; no count, nothing listed); null otherwise and for the lead.
   */
  teamHold: { takesEffectAt: string } | null;
  /** Hold model v3: this session's changes are staged and wait 24 h (the pop-up warns before the first one). */
  changesWait: boolean;
  /** Hold model v3: a recovery code replaced a used one and this session may show it once (`POST /v1/account/recovery-code/reveal`). */
  recoveryCodeToShow: boolean;
  /**
   * Owner 2 Nov 2026: 'trader' (takes offers) or 'vendor' (posts offers, may have team members,
   * pays the 1% fee). For a team member, the type of the account they work for.
   */
  accountType: 'trader' | 'vendor';
  /**
   * Plan 2 Task 18: set when the caller is a team member (the overview is then of the account
   * they work for, with their own login methods); null for the account owner.
   */
  member: MemberOverview | null;
  /**
   * The calling session's length (owner, 2 Nov 2026): set for a full trader session (a team
   * member's included), null for staff, owner and backup (recovery) sessions, which keep their
   * fixed rules.
   */
  session: SessionInfo | null;
  /**
   * The person's idle reminder (owner, Q75, 6 Nov 2026): minutes without activity before the app
   * reminds them, or null when off (the default). A team member's is their own (their login
   * account's), never the account owner's. Null for staff and owner accounts, which have none.
   */
  idleReminderMinutes: number | null;
}

/** A full trader session's length, as `GET /v1/account/me` and the session routes return it. */
export interface SessionInfo {
  /** The hours chosen for this session, or null until its person chooses (it then lasts `UNCHOSEN_SESSION_HOURS`). */
  lengthHours: number | null;
  /** What this account may choose, shortest first (from the account type). */
  choices: number[];
  /** When the session ends unless "Stay logged in" extends it. */
  expiresAt: string;
  /**
   * True for every full trader session: the person (a team member too, owner Q73, 6 Nov 2026)
   * extends it by re-proving one of their own login methods. Kept as a field so a later rule can
   * turn it off for some sessions.
   */
  canExtend: boolean;
  /** The server's time as it answered, for the prompt's countdown (`serverClock`). */
  serverNow: string;
}

/**
 * Which session lengths an account gets (owner G23, 7 Nov 2026; review M7): its
 * `accounts.account_type` ('trader' | 'vendor', Settings > Account type). The column comes with the
 * vendor work (wip/lead-vendor's 198_account_type); read through `to_jsonb` so this works before and
 * after it lands, and anything but 'vendor' (no column, no row) answers 'trader'. A team member's
 * session is a session of the team account (`accountId`), so it gets the team account's choices.
 */
export async function sessionAccountType(db: Queryable, accountId: string): Promise<SessionAccountType> {
  const { rows } = await db.query<{ account_type: string | null }>(`select to_jsonb(a) ->> 'account_type' as account_type from accounts a where a.id = $1`, [accountId]);
  return rows[0]?.account_type === 'vendor' ? 'vendor' : 'trader';
}

/** `sessionInfo` for the calling session; a team member's end is capped at their working window's end (J-20 review F6). */
async function callerSessionInfo(
  db: Queryable, auth: { accountId: string; memberId: string | null }, row: { length_hours: number | null; expires_at: Date }, now: Date,
): Promise<SessionInfo> {
  const expires_at = await endWithinHours(db, auth.memberId, now, row.expires_at);
  return sessionInfo(await sessionAccountType(db, auth.accountId), { length_hours: row.length_hours, expires_at }, now);
}

function sessionInfo(type: SessionAccountType, row: { length_hours: number | null; expires_at: Date }, now: Date): SessionInfo {
  return {
    lengthHours: row.length_hours,
    choices: [...sessionHoursFor(type)],
    expiresAt: row.expires_at.toISOString(),
    canExtend: true,
    serverNow: now.toISOString(),
  };
}

export interface MemberOverview {
  /** The member's name, as chat labels show it. */
  name: string;
  /** The member's ticked boxes (team/abilities.ts; `GET /v1/team/permissions` names them). */
  abilities: string[];
  preset: PresetId | null;
  /** The old roles the boxes read as (the web's Post offer tab and room still read these). */
  roles: TeamRole[];
  /**
   * J-20 review F8: the member's own trade-size band (XMR atomic, null: none) and working hours, as
   * the lead set them. Absent while MEMBER_SEES_OWN_LIMITS is off (owner question p11-136).
   */
  limits?: MemberLimitsView;
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

/** Owner p4-8: the lead's waiting changes as a member's banner sees them: only the date. */
async function teamHoldOf(db: Queryable, accountId: string): Promise<{ takesEffectAt: string } | null> {
  const p = await pendingSummary(db, accountId);
  return p === null ? null : { takesEffectAt: p.takesEffectAt };
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

async function idleReminderOf(db: Queryable, personId: string): Promise<number | null> {
  const { rows } = await db.query<{ m: number | null }>('select idle_reminder_minutes as m from accounts where id = $1', [personId]);
  return rows[0]?.m ?? null;
}

/**
 * Checks `hours` of `POST /v1/account/session/extend` before `requireConfirm`, so a bad choice never
 * uses up the confirm token (as R17 asks of the wallet route). Absent: the session's own length.
 */
const extendHoursValid: preHandlerAsyncHookHandler = async function (req) {
  const body = req.body;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'bad-request');
  const hours = (body as { hours?: unknown }).hours;
  if (hours !== undefined && !isSessionHours(await sessionAccountType(req.server.deps.db, req.auth.accountId), hours)) throw new ApiError(400, 'bad-request');
};

async function overview(deps: Deps, req: FastifyRequest): Promise<AccountOverview> {
  const { accountId, sessionId } = req.auth;
  // A member's own login methods (its own login account); the account owner's are not theirs to see.
  let methodsOf = accountId;
  // A member's own Terms acceptance (review 2026-11-08 F1); null for the account owner.
  let memberTerms: string | null = null;
  if (req.auth.memberId !== null) {
    const m = await deps.db.query<{ member_account_id: string; terms_version: string | null }>(
      'select tm.member_account_id, a.terms_version from team_members tm join accounts a on a.id = tm.member_account_id where tm.id = $1',
      [req.auth.memberId],
    );
    if (!m.rows[0]) throw new ApiError(401, 'not-authenticated');
    methodsOf = m.rows[0].member_account_id;
    memberTerms = m.rows[0].terms_version;
  }
  const { rows } = await deps.db.query<{
    display_name: string;
    legacy_login_name: boolean;
    kind: AccountKind;
    terms_version: string | null;
    level: SessionLevel;
    hold_until: Date | null;
    length_hours: number | null;
    expires_at: Date;
    account_type: 'trader' | 'vendor';
  }>(
    `select a.display_name, a.legacy_login_name, a.kind, a.terms_version, s.level, s.hold_until, s.length_hours, s.expires_at, a.account_type
       from accounts a join sessions s on s.account_id = a.id
      where a.id = $1 and s.id = $2`,
    [accountId, sessionId],
  );
  const row = rows[0];
  if (!row) throw new ApiError(401, 'not-authenticated');
  const counts = await methodCounts(deps.db, methodsOf);
  const now = deps.clock();
  let member: MemberOverview | null = null;
  if (req.auth.memberId !== null) {
    member = { name: req.auth.memberName ?? '', ...abilitiesView(req.auth.memberAbilities) };
    // J-20 review F8 (owner question p11-136; MEMBER_SEES_OWN_LIMITS): the member's own band and hours.
    const limits = await ownLimitsView(deps.db, req.auth.memberId);
    if (limits !== undefined) member.limits = limits;
  }
  const held = row.level === 'recovery' && row.hold_until !== null && now.getTime() < row.hold_until.getTime();
  return {
    displayName: row.display_name,
    needsLoginName: row.legacy_login_name,
    kind: row.kind,
    level: row.level,
    holdUntil: held ? row.hold_until!.toISOString() : null,
    stage: row.kind === 'trader' ? (await tradeCap(deps.db, accountId, now)).stage : null,
    methods: methodTypes(counts),
    // A member logs in with two factors by the staff rule: nothing to suggest.
    hasBackup: member !== null ? true : hasBackup(counts),
    suggestions: member !== null ? [] : suggestionsFor(counts),
    // Staff and owner accounts carry no Terms version (R10).
    // A team member is current only when both the account and their own login account are.
    termsCurrent:
      row.kind !== 'trader' ||
      (row.terms_version === deps.config.termsVersion && (member === null || memberTerms === deps.config.termsVersion)),
    accountHoldUntil: (await holdUntil(deps, accountId, req.server.events))?.toISOString() ?? null,
    accountType: row.account_type,
    pendingChanges: member !== null ? null : await pendingSummary(deps.db, accountId),
    teamHold: member === null ? null : await teamHoldOf(deps.db, accountId),
    changesWait: member !== null ? false : await changesWait(req),
    recoveryCodeToShow: member !== null ? false : await revealDue(deps.db, accountId, sessionId, deps.clock()),
    member,
    // The end this request's token has (review S-m1: the token before an extend keeps the old end).
    session: row.kind === 'trader' && row.level === 'full'
      ? await callerSessionInfo(deps.db, req.auth, { ...row, expires_at: new Date(Math.min(row.expires_at.getTime(), req.auth.expiresAt.getTime())) }, now)
      : null,
    idleReminderMinutes: row.kind === 'trader' ? await idleReminderOf(deps.db, methodsOf) : null,
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
 * name on `POST /v1/account/login-name`: a taken key or tag (23505 on `accounts_login_key_key`,
 * `accounts_login_tag_key` or the `name_keys` primary key), or a deadlock (40P01). Since FU-D every
 * name write serialises on one advisory lock and checks both namespaces first (`setLoginName`), so
 * these are only a backstop; a deadlock between two pre-009 accounts swapping names was the case
 * before FU-D (FU-A round-2 Minor 1). Either way the answer is a clash, never a 500.
 */
export function isLoginNameClash(e: unknown): boolean {
  if (e === null || typeof e !== 'object') return false;
  const err = e as { code?: unknown; constraint?: unknown };
  if (err.code === '40P01') return true;
  return (
    err.code === '23505' &&
    (err.constraint === 'accounts_login_key_key' || err.constraint === 'accounts_login_tag_key' || err.constraint === 'name_keys_pkey')
  );
}

/** The confirm action of `PUT /v1/account/security/one-device`: the body's `on` must be a boolean (else 400, before any token is spent). */
function oneDeviceAction(req: FastifyRequest): ConfirmAction {
  const body = req.body;
  const on = body !== null && typeof body === 'object' && !Array.isArray(body) ? (body as { on?: unknown }).on : undefined;
  if (typeof on !== 'boolean') throw new ApiError(400, 'bad-request');
  return { kind: 'set-one-device', on: on ? 'on' : 'off' };
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
   * `names-unavailable` for a name taken in either namespace (`setLoginName`, FU-D: stored only as
   * its tag under `X2F_LOGIN_NAME_KEYS`, checked under every key of the ring). Each call
   * takes a register-budget token: a taken name answers like a sign-up's, at the same cost
   * (plan-2-review residual (b)); the login name is never echoed.
   */
  app.post('/v1/account/login-name', { preHandler: [requireSession(), requireNotHeld, requireConfirm({ kind: 'set-login-name' })] }, async (req, reply) => {
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
    let held: { changeId: string } | null = null;
    try {
      await client.query('begin');
      try {
        // Refused at once when taken; FU-D: only the name's keyed tag may wait in the hold, never the name.
        if (await loginNameTaken(client, d.config, req.auth.accountId, r.key)) throw new ApiError(409, 'names-unavailable');
        const tag = loginTags(d.config, r.key).current;
        held = await gateChange(client, req, { kind: 'login-name', tag: tag.toString('base64'), keyId: d.config.loginNameKeys.current });
        if (held === null) {
          await setLoginName(client, d.config, req.auth.accountId, r.key);
          await addAlert(client, req.auth.accountId, 'login-name-set', {}, d.clock());
        }
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
    if (held !== null) {
      return reply.code(202).send(stagedReply(held));
    }
    return { ok: true };
  });

  app.post(
    '/v1/account/terms',
    // Task 17 (lead decision 2026-10-30): accepting the Terms is allowed during the hold (not a
    // security change; refusing it could block finishing open trades). A changed version asks for
    // a new signature too (owner, 8 Nov 2026): `{ version, signature }`, the signature replacing
    // the one before (checkTermsSignature's 400s), with nothing else recorded about the signing.
    // Only a changed version writes: repeating the current one answers 204 and changes nothing, so
    // a session can't rewrite what was signed or when.
    // Review 2026-11-08 F1: a team member accepts for themselves, on their own login account; the
    // team account's acceptance stays the account owner's (a member never accepts for the account).
    { bodyLimit: SIGNED_BODY_LIMIT, preHandler: requireSession({ allowRecovery: true, allowStaleTerms: true, member: 'any' }) },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const d = deps();
      const version = d.config.termsVersion;
      const body = req.body as { version?: unknown; signature?: unknown } | null | undefined;
      const given = body !== null && typeof body === 'object' ? body.version : undefined;
      if (given !== version) throw new ApiError(400, 'terms-not-accepted', { version });
      const signature = checkTermsSignature(body !== null && typeof body === 'object' ? body.signature : undefined);
      const now = d.clock();
      await withTx(d.db, async (db) => {
        // Review round 4: the accepting session must still be live where it writes.
        await requireLiveSessionInTx(db, req.auth, now);
        if (req.auth.memberId !== null) {
          // The member signs too (owner 9 Nov 2026, p11-14), sealed to their own login account; only
          // a changed version writes, as for a trader.
          const { rows } = await db.query<{ member_account_id: string | null }>('select member_account_id from team_members where id = $1', [
            req.auth.memberId,
          ]);
          const memberAccountId = rows[0]?.member_account_id ?? null;
          if (memberAccountId !== null) {
            await db.query(
              `update accounts set terms_version = $2, terms_accepted_at = $3, terms_signature = $4
                where id = $1 and kind = 'member' and terms_version is distinct from $2`,
              [memberAccountId, version, now, sealTermsSignature(d.config, signature, memberAccountId)],
            );
          }
        } else {
          await db.query('update accounts set terms_version = $2, terms_accepted_at = $3, terms_signature = $5 where id = $1 and kind = $4 and terms_version is distinct from $2', [
            req.auth.accountId, version, now, 'trader', sealTermsSignature(d.config, signature, req.auth.accountId),
          ]);
        }
      });
      return reply.code(204).send();
    },
  );

  // Every team member may read who they are and what they may do (Task 18).
  app.get('/v1/account/me', { preHandler: requireSession({ ...readAny, allowStaleTerms: true, member: 'any' }) }, async (req) =>
    overview(deps(), req),
  );

  /**
   * Session length (owner, 2 Nov 2026; boards SessionLength, Devices). `PUT /v1/account/session/length
   * { hours }` sets the calling session's own length, this session only (owner F18): full trader
   * sessions only, a team member's included (its own login); 400 `bad-request` unless `hours` is one
   * of the account type's choices (owner G23). The new length starts now (owner G24): the session
   * ends `now + hours`, never in the past (review M3).
   * - A shorter end, or the first choice within SESSION_CHOICE_WINDOW_MS of the login (the question
   *   after every login), applies at once.
   * - A later end otherwise needs a login method (lead decision 6 Nov 2026: a stolen cookie must not
   *   stretch a session): 403 `confirm-required` `{ action: 'extend-session' }`, nothing changed;
   *   the app then confirms it's them and calls `POST /v1/account/session/extend` with `hours`.
   * A shortened session's live streams are ended (review M1); the app reconnects with the new end.
   * Not a held change: it only ends this session sooner, or sets its length at the login itself.
   * Hold model v3 (lead reading of owner p11-26, 9 Nov 2026, "the 24-hour hold is really just a hold
   * on the changes you are implementing; everything else functions as normal"; the owner is asked
   * on page 11): a username-and-password session's session length, extend and idle reminder are
   * never staged, since they change nothing about the account's security. Extend keeps its confirm.
   */
  app.put(
    '/v1/account/session/length',
    { preHandler: requireSession({ kinds: ['trader'], allowStaleTerms: true, member: 'any' }) },
    async (req) => {
      const d = deps();
      const body = req.body;
      if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'bad-request');
      const hours = (body as { hours?: unknown }).hours;
      if (!isSessionHours(await sessionAccountType(d.db, req.auth.accountId), hours)) throw new ApiError(400, 'bad-request');
      const now = d.clock();
      const { info, shortened } = await withTx(d.db, async (db) => {
        // Tasks 16-17: the calling session must still be live where it writes.
        await requireLiveSessionInTx(db, req.auth, now);
        const cur = await db.query<{ length_hours: number | null; expires_at: Date; period_started_at: Date }>(
          'select length_hours, expires_at, period_started_at from sessions where id = $1 for update',
          [req.auth.sessionId],
        );
        const old = cur.rows[0]!;
        const end = new Date(now.getTime() + hours * 3_600_000);
        // The free first choice: the length was never chosen and the login was a moment ago. An
        // extend sets the length, so an unchosen session's period is still its login.
        const firstChoice = old.length_hours === null && now.getTime() < old.period_started_at.getTime() + SESSION_CHOICE_WINDOW_MS;
        if (end.getTime() > old.expires_at.getTime() && !firstChoice) throw new ApiError(403, 'confirm-required', { action: 'extend-session' });
        // J-20 (team working hours, p7-11; review S-m4, owner G9): a member's session never gets a
        // later end past their working window ("they won't be able to extend the session anyway").
        await assertSessionEndInHours(db, req.auth.memberId, now, end, old.expires_at);
        const { rows } = await db.query<{ length_hours: number | null; expires_at: Date }>(
          `update sessions set period_started_at = $3, expires_at = $4, length_hours = $2 where id = $1
        returning length_hours, expires_at`,
          [req.auth.sessionId, hours, now, end],
        );
        return { info: await callerSessionInfo(db, req.auth, rows[0]!, now), shortened: end.getTime() < old.expires_at.getTime() };
      });
      // Review M1: a stream opened before keeps the old end as its lifetime; end it now.
      if (shortened) req.server.events.closeSession(req.auth.accountId, req.auth.sessionId);
      return info;
    },
  );

  /**
   * `POST /v1/account/session/extend { confirmToken, hours? }`: "Stay logged in?" (owner, 2 Nov
   * 2026, board SessionExtend; Q73, 6 Nov), and a longer length chosen partway (owner G24). The
   * person re-proves one of their own login methods on the server (a confirm token for
   * `extend-session` from a confirm route: passkey, security key, PGP key, or the password, alone
   * even when the account has an authenticator code, owner G10; a team member with their own PGP
   * key, passkey or security key), and the session lasts `hours` from now (one of the account
   * type's choices; absent, its own length, or the shortest choice if none was chosen). That time
   * becomes the session's length (review M4). No fixed maximum. Each extend issues a new session
   * token (review S-m1, `rotateSessionToken`): the cookie is set to it with a fresh lifetime, and the
   * token before it works only until the session's old end, so a copied cookie dies there. An account in a 24-hour hold may extend (owner G8), and extending raises no alert
   * (owner G9). Full trader sessions only, a team member's included; recovery sessions are refused
   * (`recovery-session`). Bad `hours` → 400 `bad-request` before the token is spent.
   */
  app.post(
    '/v1/account/session/extend',
    {
      preHandler: [
        requireSession({ kinds: ['trader'], allowStaleTerms: true, member: 'any' }),
        extendHoursValid,
        requireConfirm({ kind: 'extend-session' }),
      ],
    },
    async (req, reply) => {
      const d = deps();
      const now = d.clock();
      const hours = (req.body as { hours?: number }).hours ?? null;
      const { info, setCookie } = await withTx(d.db, async (db) => {
        await requireLiveSessionInTx(db, req.auth, now);
        const cur = await db.query<{ expires_at: Date; length_hours: number | null }>('select expires_at, length_hours from sessions where id = $1 for update', [req.auth.sessionId]);
        // J-20 (team working hours, p7-11; review S-m4, owner G9): a member's session never gets a
        // later end past their working window, refused before any write (the token is not rotated).
        const wanted = new Date(now.getTime() + (hours ?? cur.rows[0]!.length_hours ?? UNCHOSEN_SESSION_HOURS) * 3_600_000);
        await assertSessionEndInHours(db, req.auth.memberId, now, wanted, cur.rows[0]!.expires_at);
        // Review S-m1: a new token, the one before it valid only to this old end.
        const setCookie = await rotateSessionToken(db, req, reply, req.auth.sessionId, cur.rows[0]!.expires_at);
        const { rows } = await db.query<{ length_hours: number | null; expires_at: Date }>(
          `update sessions
              set period_started_at = $2,
                  length_hours = coalesce($4::smallint, length_hours, $3),
                  expires_at = $2::timestamptz + coalesce($4::smallint, length_hours, $3) * interval '1 hour'
            where id = $1
        returning length_hours, expires_at`,
          [req.auth.sessionId, now, UNCHOSEN_SESSION_HOURS, hours],
        );
        return { info: await callerSessionInfo(db, req.auth, rows[0]!, now), setCookie };
      });
      setCookie();
      return info;
    },
  );

  /**
   * `PUT /v1/account/idle-reminder { minutes }` (owner, Q75, 6 Nov 2026): the person's own idle
   * reminder, one of IDLE_REMINDER_MINUTES, or null to turn it off (the default). A reminder only:
   * it never logs anyone out and never moves a session's end. It is the person's: a team member's
   * is stored on their own login account, never the account owner's. Trader sessions only (a team
   * member's included); not a held change (it touches no login, session or security state).
   */
  app.put(
    '/v1/account/idle-reminder',
    { preHandler: requireSession({ kinds: ['trader'], allowStaleTerms: true, member: 'any' }) },
    async (req) => {
      const d = deps();
      const body = req.body;
      if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'bad-request');
      const minutes = (body as { minutes?: unknown }).minutes;
      if (minutes !== null && !isIdleReminderMinutes(minutes)) throw new ApiError(400, 'bad-request');
      const person = await personAccountId(d.db, req.auth);
      await d.db.query('update accounts set idle_reminder_minutes = $2 where id = $1', [person, minutes]);
      return { idleReminderMinutes: minutes };
    },
  );

  const DEVICES = '/v1/account/security/devices';

  // Task 16: the device limit and "One device at a time". Reading changes nothing.
  app.get(DEVICES, { preHandler: requireSession({ ...readAny, allowStaleTerms: true, kinds: ['trader'] }) }, async (req) => {
    const d = deps();
    const { rows } = await d.db.query<{ one_device: boolean }>('select one_device from accounts where id = $1', [req.auth.accountId]);
    return { oneDevice: rows[0]!.one_device, maxDevices: await maxDevices(d.db) };
  });

  /**
   * `PUT /v1/account/security/one-device { on, confirmToken }` (Task 16): full trader sessions only,
   * behind confirm-it's-you for exactly that change (`set-one-device`, `on: 'on' | 'off'`). It ends
   * no session by itself: the next approved device does. Alert `one-device-set { on }`.
   */
  app.put(
    '/v1/account/security/one-device',
    { preHandler: [requireSession({ kinds: ['trader'] }), requireNotHeld, requireConfirm(oneDeviceAction)] },
    async (req, reply) => {
      const d = deps();
      const on = req.confirmedAction?.kind === 'set-one-device' && req.confirmedAction.on === 'on';
      const client = await d.db.connect();
      let held: { changeId: string } | null = null;
      try {
        await client.query('begin');
        try {
          held = await gateChange(client, req, { kind: 'one-device', on });
          if (held === null) await applyOneDevice(client, req.auth.accountId, on, d.clock());
          await client.query('commit');
        } catch (e) {
          await client.query('rollback');
          throw e;
        }
      } finally {
        client.release();
      }
      if (held !== null) {
        return reply.code(202).send(stagedReply(held));
      }
      return { oneDevice: on, maxDevices: await maxDevices(d.db) };
    },
  );

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
      const now = d.clock();
      const ended = await withTx(d.db, async (db) => {
        // Review round 4: the calling session must still be live where it writes.
        const caller = await requireLiveSessionInTx(db, req.auth, now);
        const { rows } = await db.query('select 1 from sessions where id = $1 and account_id = $2', [id, req.auth.accountId]);
        if (rows.length === 0) throw new ApiError(404, 'not-found');
        // Review round 2 N-I3, round 3 R3-M2 (lead decision 2026-10-30): a session whose login waits
        // may not log out an older or a stronger session (403 `weak-session`): the owner's weak
        // phone keeps its session, and with it the push subscription that carries the hold's
        // warning. Owner g64 (lead review 8 Nov I4): it may end the account owner's own
        // username-and-password sessions that are NEWER than itself, so the real owner's older
        // session kicks out a thief's, and the thief's newer one never kicks the owner (as R4-M1
        // for backup sessions). Alert `sessions-ended` `{ count: 1, reason: 'older-session' }`.
        let kicked = false;
        if (id !== req.auth.sessionId && weakOf(caller, now)) {
          const t = await db.query<{ created_at: Date; strength: LoginStrength | null; level: string; member_id: string | null }>(
            'select created_at, strength, level, member_id from sessions where id = $1 and revoked_at is null', [id],
          );
          const target = t.rows[0];
          if (!target || req.auth.memberId !== null || target.level !== 'full' || target.member_id !== null || !waits(target.strength) || target.created_at.getTime() <= caller.created_at.getTime()) {
            throw weakRefusal();
          }
          kicked = true;
        }
        const r = await db.query('update sessions set revoked_at = $2 where id = $1 and revoked_at is null', [id, now]);
        const ended = (r.rowCount ?? 0) > 0;
        if (ended && kicked) {
          await addAlert(db, req.auth.accountId, 'sessions-ended', { count: 1, reason: 'older-session' }, now);
          req.log.info({ reason: 'weak-session-ended-newer' }, 'session ended');
        }
        return ended;
      });
      // Its streams end once the revocation has committed.
      if (ended) req.server.events.closeSession(req.auth.accountId, id);
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
      const now = d.clock();
      await withTx(d.db, async (db) => {
        // Review round 4: the calling session must still be live where it writes.
        const caller = await requireLiveSessionInTx(db, req.auth, now);
        // Review round 2 N-M3: a session whose login waits cannot hide the warnings meant for the
        // owner (the hold's alerts and the login alerts) by marking them seen (403 `weak-session`).
        const weak = weakOf(caller, now);
        const r = await db.query<{ kind: string }>(
          `update alerts set seen_at = coalesce(seen_at, $3) where id = $1 and account_id = $2 and not ($4::boolean and kind = any($5::text[])) returning kind`,
          [id, req.auth.accountId, now, weak, OWNER_WARNINGS],
        );
        if ((r.rowCount ?? 0) === 0) {
          const exists = await db.query('select 1 from alerts where id = $1 and account_id = $2', [id, req.auth.accountId]);
          if (exists.rows.length > 0) throw weakRefusal();
          throw new ApiError(404, 'not-found');
        }
      });
      return reply.code(204).send();
    },
  );
}

/** The alerts a weak session may not mark seen (review round 2 N-M3): the hold's own and the login alerts. */
export const OWNER_WARNINGS: readonly string[] = [
  'hold-started', 'hold-ended', 'hold-extended', 'hold-changes-submitted', 'hold-changes-cancelled', 'hold-changes-discarded', 'hold-changes-applied',
  'recovery-code-renewed', 'new-login', 'recovery-login', 'login-approval', 'login-blocked', 'logged-out-by-new-device', 'sessions-ended',
];

/**
 * A pre-009 account's login name waiting out the hold, applied when the hold ends by time (FU-D:
 * only its keyed tag was kept). Under `NAMES_LOCK` (review round 2 N-M1; `namesTaken` also counts
 * the pending tag, so no other sign-up took it meanwhile). 409 `names-unavailable` when another
 * account took that tag meanwhile or the tag's key is no longer the ring's current one (a tag
 * under a rotated key could clash with a name taken under the new key, or match nothing once the
 * old key is retired), 409 `login-name-set` when the account chose its names already. Either way
 * the change is dropped (alert `hold-ended` `applied: false`).
 */
export async function applyLoginName(db: Queryable, config: Config, accountId: string, tag: Buffer, keyId: number, now: Date): Promise<void> {
  await lockNames(db);
  if (keyId !== config.loginNameKeys.current) throw new ApiError(409, 'names-unavailable');
  const taken = await db.query('select 1 from accounts where login_tag_key_id = $2 and login_tag = $3 and id <> $1', [accountId, keyId, tag]);
  if (taken.rows.length > 0) throw new ApiError(409, 'names-unavailable');
  const updated = await db.query(
    `update accounts set login_tag = $2, login_tag_key_id = $3, login_name = null, login_key = null, legacy_login_name = false
      where id = $1 and legacy_login_name`,
    [accountId, tag, keyId],
  );
  if ((updated.rowCount ?? 0) === 0) throw new ApiError(409, 'login-name-set');
  await addAlert(db, accountId, 'login-name-set', {}, now);
}

/** The write of "One device at a time" (the route's, or a pending one when the hold ends by time): alert `one-device-set { on }`. */
export async function applyOneDevice(db: Queryable, accountId: string, on: boolean, now: Date): Promise<void> {
  await db.query('update accounts set one_device = $2 where id = $1', [accountId, on]);
  await addAlert(db, accountId, 'one-device-set', { on }, now);
}
