/**
 * Team members (Plan 2 Task 18; spec 6.7, R44; owner 2026-10-29c): invites, the member's own
 * sign-up, roles and removal. Routes are in routes/team.ts.
 *
 * - The account owner (a trader) invites up to `MAX_TEAM_MEMBERS` members (open invites count). An
 *   invite is a one-time code that lives 24 hours (as staff invites, Plan 4); only its SHA-256 is
 *   stored. The owner passes it on by hand; the web puts it in the link's #fragment, so it never
 *   reaches a server log or a Referer.
 * - The member signs up with the code: a login name of their own and two factors by the staff rule
 *   (*lead default*, owner may change): always a PGP key first, then a security key, a passkey or a
 *   second PGP key. Never a password, an authenticator code or recovery codes. Their login is an
 *   `accounts` row of kind `member`; its display name is a random placeholder nobody sees.
 * - Removing a member ends their sessions at once and deletes their login (review M6).
 */
import { createHash, randomBytes } from 'node:crypto';
import { checkDisplayName, checkLoginName, lookAlikeKey } from '@x2f/accounts';
import type pg from 'pg';
import type { Deps } from '../app.js';
import { addAlert } from '../alerts.js';
import { createAccount, type NewNames } from '../accounts.js';
import type { Config } from '../config.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { holdInTx, holdRefusal, requireLiveSessionInTx, weakRefusal, type LiveSession, type SettleDeps } from '../auth/hold.js';
import { waits } from '../auth/strength.js';
import type { EventBus } from '../events/bus.js';
import type { RetentionJob } from '../retention.js';
import { MAX_TEAM_MEMBERS, type TeamRole } from './perms.js';

/** An invite lives this long (as Plan 4's staff invites). */
export const INVITE_TTL_MS = 24 * 3_600_000;
/** A member who proved their PGP key has at least this long to add the second factor. */
export const SETUP_MIN_MS = 30 * 60_000;
/** The invite code: 32 random bytes, base64url without padding. */
const CODE = /^[A-Za-z0-9_-]{43}$/;

export const inviteHash = (code: string): Buffer => createHash('sha256').update(`team-invite/${code}`).digest();

/** A member's status as the account owner sees it. */
export type MemberStatus = 'invited' | 'joining' | 'active';

export interface TeamMemberView {
  id: string;
  displayName: string;
  roles: TeamRole[];
  status: MemberStatus;
  /** Until when the invite (or an unfinished sign-up) can be used; null once joined. */
  inviteExpiresAt: string | null;
  joinedAt: string | null;
  createdAt: string;
}

/** Live members: not removed, and joined or still inside their invite's time. */
export const LIVE_MEMBER = `removed_at is null and (joined_at is not null or invite_expires_at > $2)`;

interface MemberRow {
  id: string;
  display_name: string;
  roles: TeamRole[];
  member_account_id: string | null;
  joined_at: Date | null;
  invite_expires_at: Date;
  created_at: Date;
}

function toView(r: MemberRow): TeamMemberView {
  const status: MemberStatus = r.joined_at !== null ? 'active' : r.member_account_id !== null ? 'joining' : 'invited';
  return {
    id: r.id,
    displayName: r.display_name,
    roles: r.roles,
    status,
    inviteExpiresAt: r.joined_at === null ? r.invite_expires_at.toISOString() : null,
    joinedAt: r.joined_at?.toISOString() ?? null,
    createdAt: r.created_at.toISOString(),
  };
}

/** The account's live members and open invites, oldest first. */
export async function listMembers(db: Queryable, accountId: string, now: Date): Promise<TeamMemberView[]> {
  const { rows } = await db.query<MemberRow>(
    `select id, display_name, roles, member_account_id, joined_at, invite_expires_at, created_at
       from team_members where account_id = $1 and ${LIVE_MEMBER} order by created_at, id`,
    [accountId, now],
  );
  return rows.map(toView);
}

/**
 * A member's name, as chat labels show it: the display-name rules (5–20 ASCII letters, digits,
 * `.`, `-`, `_`; no reserved words, with look-alikes) and no look-alike of a staff or owner name
 * (F4), so a label can never read like X2F staff. 400 `display-name-invalid` / `display-name-reserved`.
 * Unique within the team only (the unique index; 409 `display-name-taken`).
 */
export async function checkMemberName(db: Queryable, raw: unknown): Promise<{ name: string; key: string }> {
  const r = checkDisplayName(typeof raw === 'string' ? raw : '');
  if (!r.ok) throw new ApiError(400, r.reason === 'reserved' ? 'display-name-reserved' : 'display-name-invalid');
  const folded = lookAlikeKey(r.key);
  const { rows } = await db.query<{ display_key: string }>("select display_key from accounts where kind in ('staff', 'owner')");
  if (rows.some((s) => lookAlikeKey(s.display_key) === folded)) throw new ApiError(400, 'display-name-reserved');
  return { name: r.name, key: r.key };
}

async function inTransaction<T>(db: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('begin');
    try {
      const out = await fn(client);
      await client.query('commit');
      return out;
    } catch (e) {
      await client.query('rollback');
      throw e;
    }
  } finally {
    client.release();
  }
}

/**
 * The calling session (`req.auth`) and its settle deps (`settleOf(req)`): every write below
 * re-checks, first in its transaction, that the session is still live and the account not held.
 */
export interface Caller {
  accountId: string;
  sessionId: string;
  settle: SettleDeps;
}

/**
 * First in each team write's transaction: the account lock and a live calling session
 * (`requireLiveSessionInTx`, 401 `not-authenticated`; `LIVE_SESSION_ROUTES`), then no running
 * hold: owner 2026-10-30, during a 24-hour hold every team change waits (invites, role changes and
 * removals alike), refused with 403 `recovery-hold` `{ holdUntil }` as the other changes refused
 * during a hold (`HOLD_BLOCKED_ROUTES`; the routes also carry `requireNotHeld`, so no confirm
 * token is spent). A hold whose time is up ends here (`holdInTx`) and the change goes ahead.
 *
 * `strong` (owner 1 Nov 2026, landing review I1): inviting a member and changing a member's roles
 * need a strong session (`waits(strength)` false, strength.ts), at any time, so a weak foothold
 * (a password and a copied device cookie) cannot mint a lasting strong member login. A weak
 * session gets 403 `weak-session`; the routes check it first in a preHandler too
 * (`requireStrongSession`, routes/team.ts), so no confirm token is spent. Removal needs no strong
 * session (it only takes access away).
 *
 * Hold model v3 (owner 2 Nov 2026): during an account hold (a recovery-code login) every session of
 * the account is logged out, so no owner session is left to ask; the 1 Nov wish that a removal
 * asked for during a hold waits for its end has no case left. A role change by a username-and-
 * password session is staged and waits 24 h (routes/team.ts, `gateChange`). A removal by one is staged
 * too and the member keeps their access until it applies (owner p5-7, 7 Nov, replacing G5).
 */
async function ownerWriteGate(c: Queryable, caller: Caller, now: Date, o: { strong: boolean }): Promise<LiveSession> {
  const live = await requireLiveSessionInTx(c, caller, now);
  const hold = await holdInTx(c, caller.settle, caller.accountId, now);
  if (hold !== null) throw holdRefusal(hold.holdUntil);
  if (o.strong && waits(live.strength)) throw weakRefusal();
  return live;
}

/**
 * Creates an invite for the account (the account owner's session; `requireSession` already
 * refused members). The account row is locked first (`ownerWriteGate`: 401 when the calling
 * session was revoked meanwhile, 403 `recovery-hold` during a hold, 403 `weak-session` for a
 * session that is not strong), so two invites cannot both pass the count.
 * Invites past their time are closed first (they no longer count and free their names). 409
 * `too-many-members` at `MAX_TEAM_MEMBERS`; 409 `display-name-taken` for a name already in the team.
 */
export async function createInvite(
  deps: Pick<Deps, 'db' | 'clock'>,
  caller: Caller,
  a: { name: { name: string; key: string }; roles: TeamRole[] },
): Promise<{ id: string; code: string; expiresAt: string }> {
  const { accountId } = caller;
  const now = deps.clock();
  const code = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
  try {
    const id = await inTransaction(deps.db, async (c) => {
      await ownerWriteGate(c, caller, now, { strong: true });
      await c.query(
        `update team_members set removed_at = $2, invite_hash = null
          where account_id = $1 and removed_at is null and joined_at is null and invite_expires_at <= $2`,
        [accountId, now],
      );
      const count = await c.query<{ n: number }>(`select count(*)::int as n from team_members where account_id = $1 and ${LIVE_MEMBER}`, [accountId, now]);
      if (count.rows[0]!.n >= MAX_TEAM_MEMBERS) throw new ApiError(409, 'too-many-members', { max: MAX_TEAM_MEMBERS });
      const { rows } = await c.query<{ id: string }>(
        `insert into team_members (account_id, display_name, display_key, roles, invite_hash, invite_expires_at, created_at)
         values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [accountId, a.name.name, a.name.key, a.roles, inviteHash(code), expiresAt, now],
      );
      return rows[0]!.id;
    });
    return { id, code, expiresAt: expiresAt.toISOString() };
  } catch (e) {
    if ((e as { code?: string; constraint?: string }).code === '23505' && (e as { constraint?: string }).constraint === 'team_members_live_name') {
      throw new ApiError(409, 'display-name-taken');
    }
    throw e;
  }
}

/**
 * Removes a member or cancels an invite: the row is marked removed, the invite code dies, the
 * member's login account is deleted (its login name, PGP keys, security keys and passkeys; review
 * M6: nothing of a removed member's login is kept) and every session of theirs is revoked, in one
 * transaction; their live streams are closed after the commit. The row itself stays, so the audit
 * log keeps the member's name. 404 for anyone else's or an already removed one. 401 when the
 * calling session was revoked meanwhile, 403 `recovery-hold` during a hold (`ownerWriteGate`, first).
 */
export async function removeMember(
  deps: Pick<Deps, 'db' | 'clock'> & { events: Pick<EventBus, 'closeSession'> },
  caller: Caller,
  memberId: string,
  /**
   * Owner p5-7 (7 Nov 2026, replacing G5): the route's `gateChange`, run after the member is found.
   * When it stages the removal (a username-and-password session) nothing else is written: the
   * member keeps their access until the change applies 24 h after it is submitted.
   */
  gate: (c: Queryable) => Promise<{ changeId: string } | null> = async () => null,
): Promise<{ changeId: string } | null> {
  const { accountId } = caller;
  const now = deps.clock();
  const out = await inTransaction(deps.db, async (c) => {
    await ownerWriteGate(c, caller, now, { strong: false });
    const found = await c.query('select 1 from team_members where id = $1 and account_id = $2 and removed_at is null', [memberId, accountId]);
    if (found.rows.length === 0) throw new ApiError(404, 'not-found');
    const staged = await gate(c);
    if (staged !== null) return { staged, ended: [] as string[] };
    return { staged: null, ended: await applyMemberRemoval(c, accountId, memberId, now) };
  });
  for (const id of out.ended) deps.events.closeSession(accountId, id);
  return out.staged;
}

/**
 * The removal write (the route's, or a waiting one applied when its 24 h are up): the row is
 * marked removed, the invite code dies, the member's login account is deleted and every session
 * of theirs is revoked. Returns those sessions (the caller closes their streams after commit).
 * 404 `not-found` when the member was removed meanwhile (a waiting removal is then dropped).
 */
export async function applyMemberRemoval(c: Queryable, accountId: string, memberId: string, now: Date): Promise<string[]> {
  const { rows } = await c.query<{ member_account_id: string | null }>(
    `update team_members set removed_at = $3, invite_hash = null
      where id = $1 and account_id = $2 and removed_at is null returning member_account_id`,
    [memberId, accountId, now],
  );
  const row = rows[0];
  if (!row) throw new ApiError(404, 'not-found');
  if (row.member_account_id !== null) await deleteMemberLogin(c, row.member_account_id);
  const s = await c.query<{ id: string }>('update sessions set revoked_at = $2 where member_id = $1 and revoked_at is null returning id', [memberId, now]);
  return s.rows.map((r) => r.id);
}

/** Deletes a member's login account (only ever a `member` row); the cascade takes its login methods and `team_members` keeps a null. */
async function deleteMemberLogin(c: Queryable, memberAccountId: string): Promise<void> {
  await c.query("delete from accounts where id = $1 and kind = 'member'", [memberAccountId]);
}

/**
 * Sets a live member's roles (takes effect on their next request). When the new roles leave out
 * Trades, the member's live streams (which carry the account's trade events) are closed after the
 * commit (review M2). 404 for anyone else's or a removed member. 401 when the calling session
 * was revoked meanwhile, 403 `recovery-hold` during a hold, 403 `weak-session` for a session that
 * is not strong (`ownerWriteGate`, first).
 */
export async function setRoles(
  deps: Pick<Deps, 'db' | 'clock'> & { events: Pick<EventBus, 'closeSession'> },
  caller: Caller,
  memberId: string,
  roles: TeamRole[],
): Promise<TeamMemberView> {
  const { accountId } = caller;
  const now = deps.clock();
  const { row, sessions } = await inTransaction(deps.db, async (c) => {
    await ownerWriteGate(c, caller, now, { strong: true });
    const r = await updateRoles(c, accountId, memberId, roles, now);
    if (!r) throw new ApiError(404, 'not-found');
    return r;
  });
  // After the commit: a member who lost Trades loses the live streams that carry trade events.
  for (const id of sessions) deps.events.closeSession(accountId, id);
  return toView(row);
}

/** The roles write (the route's, or a waiting one applied 24 h after a username-and-password session submitted it). Null for a member who is not live. */
async function updateRoles(c: Queryable, accountId: string, memberId: string, roles: TeamRole[], now: Date): Promise<{ row: MemberRow; sessions: string[] } | null> {
  const { rows } = await c.query<MemberRow>(
    `update team_members set roles = $3
      where id = $1 and account_id = $4 and ${LIVE_MEMBER}
      returning id, display_name, roles, member_account_id, joined_at, invite_expires_at, created_at`,
    [memberId, now, roles, accountId],
  );
  const r = rows[0];
  if (!r) return null;
  const s = roles.includes('trades') ? [] : (await c.query<{ id: string }>('select id from sessions where member_id = $1', [memberId])).rows.map((x) => x.id);
  return { row: r, sessions: s };
}

/**
 * Hold model v3: a member's roles waiting from a username-and-password session, applied when their 24 h
 * are up (hold.ts `applyChange`, account locked). Throws 404 `not-found` (the change is dropped)
 * when the member is no longer live. Returns the member's sessions whose live streams must close.
 */
export async function applyRoles(c: Queryable, accountId: string, memberId: string, roles: TeamRole[], now: Date = new Date()): Promise<string[]> {
  const r = await updateRoles(c, accountId, memberId, roles, now);
  if (!r) throw new ApiError(404, 'not-found');
  return r.sessions;
}

/** True when `memberId` is a live member (or open invite) of the account: a role change for it can be staged. */
export async function liveMember(c: Queryable, accountId: string, memberId: string, now: Date): Promise<boolean> {
  const { rows } = await c.query(`select 1 from team_members where id = $1 and account_id = $3 and ${LIVE_MEMBER}`, [memberId, now, accountId]);
  return rows.length > 0;
}

/**
 * Retention (review M6), every 10 minutes with the other jobs: closes sign-ups that ran out before
 * the member finished (and invites past their time), and deletes every member login account that no
 * live member uses: a removed member's (normally already gone at removal), an expired sign-up's,
 * and one whose team account was deleted. Returns the rows touched.
 */
export const purgeTeamLeftovers: RetentionJob = {
  name: 'purgeTeamLeftovers',
  async run(db: pg.Pool, now: Date): Promise<number> {
    return inTransaction(db, async (c) => {
      const closed = await c.query(
        `update team_members set removed_at = $1, invite_hash = null
          where removed_at is null and joined_at is null and invite_expires_at <= $1`,
        [now],
      );
      const gone = await c.query(
        `delete from accounts a where a.kind = 'member'
          and not exists (select 1 from team_members tm where tm.member_account_id = a.id and tm.removed_at is null)`,
      );
      return (closed.rowCount ?? 0) + (gone.rowCount ?? 0);
    });
  },
};

// ---------------------------------------------------------------------------------------------
// The member's side: an invite and the sign-up

export interface InviteView {
  /** The team account's public display name. */
  team: string;
  displayName: string;
  roles: TeamRole[];
  expiresAt: string;
}

interface InviteRow {
  id: string;
  account_id: string;
  team: string;
  display_name: string;
  roles: TeamRole[];
  invite_expires_at: Date;
}

/**
 * The open invite a code names: not used, not removed, not past its time, of a live trader
 * account. Anything else → 404 `not-found` (one answer for a wrong, used and expired code).
 * `lock` takes the row `for update` (inside a transaction).
 */
export async function openInvite(q: Queryable, by: { code: unknown } | { id: string }, now: Date, lock = false): Promise<InviteRow> {
  let hash: Buffer | null = null;
  if ('code' in by) {
    if (typeof by.code !== 'string' || !CODE.test(by.code)) throw new ApiError(404, 'not-found');
    hash = inviteHash(by.code);
  }
  const { rows } = await q.query<InviteRow>(
    `select tm.id, tm.account_id, t.display_name as team, tm.display_name, tm.roles, tm.invite_expires_at
       from team_members tm join accounts t on t.id = tm.account_id
      where ($1::bytea is null or tm.invite_hash = $1) and ($3::uuid is null or tm.id = $3) and tm.invite_hash is not null
        and tm.removed_at is null and tm.member_account_id is null and tm.invite_expires_at > $2
        and t.kind = 'trader' and t.disabled_at is null
      ${lock ? 'for update of tm' : ''}`,
    [hash, now, 'id' in by ? by.id : null],
  );
  const row = rows[0];
  if (!row) throw new ApiError(404, 'not-found');
  return row;
}

export function inviteView(r: InviteRow): InviteView {
  return { team: r.team, displayName: r.display_name, roles: r.roles, expiresAt: r.invite_expires_at.toISOString() };
}

/**
 * The member's private login name: the login-name rules, and never any account's public display
 * name (one namespace, as at sign-up). 400 `login-name-invalid`, 409 `names-unavailable`. A login
 * name already taken is found only by `createAccount` at the end (the same generic answer).
 */
export async function checkMemberLoginName(db: Queryable, raw: unknown): Promise<{ name: string; key: string }> {
  const r = checkLoginName(typeof raw === 'string' ? raw : '');
  if (!r.ok) throw new ApiError(400, 'login-name-invalid');
  const { rows } = await db.query('select 1 from accounts where display_key = $1', [r.key]);
  if (rows.length > 0) throw new ApiError(409, 'names-unavailable');
  return { name: r.name, key: r.key };
}

/**
 * The first factor proved: creates the member's login account with that PGP key, binds it to the
 * invite (the code dies), and gives the member at least `SETUP_MIN_MS` to add the second factor.
 * Returns the member account and the time the setup must finish by. The invite is locked and
 * checked again here, so one code makes one member.
 */
export async function startMember(
  c: Queryable,
  config: Config,
  a: { inviteId: string; names: NewNames; now: Date; addKey: (memberAccountId: string) => Promise<void> },
): Promise<{ memberId: string; memberAccountId: string; teamId: string; setupUntil: Date }> {
  const invite = await openInvite(c, { id: a.inviteId }, a.now, true);
  // FU-D: the login name is stored only as its keyed tag (createAccount); the display name is the
  // random placeholder `memberNames` made, never shown.
  const memberAccountId = await createAccount(c, config, { ...a.names, kind: 'member', termsVersion: null, now: a.now });
  await a.addKey(memberAccountId);
  const setupUntil = new Date(Math.max(invite.invite_expires_at.getTime(), a.now.getTime() + SETUP_MIN_MS));
  await c.query('update team_members set member_account_id = $2, invite_hash = null, invite_expires_at = $3 where id = $1', [
    invite.id, memberAccountId, setupUntil,
  ]);
  return { memberId: invite.id, memberAccountId, teamId: invite.account_id, setupUntil };
}

/**
 * A member login account's names: the checked login name's key and a random placeholder display
 * name nobody sees (accounts.display_name is not null and unique). The join challenge keeps them
 * only sealed (`sealNames`, FU-D), as a trader's sign-up does.
 */
export function memberNames(loginKey: string): NewNames {
  const placeholder = `m-${randomBytes(8).toString('hex')}`;
  return { displayName: placeholder, displayKey: placeholder, loginKey };
}

/**
 * Marks the member joined once their second factor is stored, and tells the account owner. 404
 * when the member was removed (or had already joined) meanwhile.
 */
export async function finishMember(c: Queryable, memberAccountId: string, now: Date): Promise<void> {
  const { rows } = await c.query<{ account_id: string; display_name: string }>(
    `update team_members set joined_at = $2
      where member_account_id = $1 and joined_at is null and removed_at is null and invite_expires_at > $2
      returning account_id, display_name`,
    [memberAccountId, now],
  );
  const row = rows[0];
  if (!row) throw new ApiError(404, 'not-found');
  await addAlert(c, row.account_id, 'team-member-joined', { member: row.display_name }, now);
}
