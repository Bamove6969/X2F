/**
 * Team members (Plan 2 Task 18; spec 6.7, R44; owner 2026-10-29c): invites, the member's own
 * sign-up, abilities and removal. Routes are in routes/team.ts. What a member may do is a set of
 * boxes (team/abilities.ts, Job 1c).
 *
 * - The account owner (a trader) invites up to `MAX_TEAM_MEMBERS` members (open invites count). An
 *   invite is a one-time code that lives 24 hours (as staff invites, Plan 4); only its SHA-256 is
 *   stored. The owner passes it on by hand; the web puts it in the link's #fragment, so it never
 *   reaches a server log or a Referer.
 * - The member signs up with the code: a login name of their own and two factors by the staff rule
 *   (*lead default*, owner may change): always a PGP key first, then a security key, a passkey or a
 *   second PGP key. Never a password, an authenticator code or recovery codes. Their login is an
 *   `accounts` row of kind `member`; its Trade Tag is a random placeholder nobody sees.
 * - Removing a member ends their sessions at once and deletes their login (review M6).
 */
import { createHash, randomBytes } from 'node:crypto';
import { checkNewTradeTag, checkNewLoginName, staffNameKey } from '@x2f/accounts';
import type pg from 'pg';
import type { Deps } from '../app.js';
import { addAlert } from '../alerts.js';
import { createAccount, type NewNames } from '../accounts.js';
import type { TermsSignature } from '../termsSignature.js';
import type { Config } from '../config.js';
import type { Queryable } from '../db/pool.js';
import { ESCROW_KEYS_ABILITY, dropMemberWraps } from '../escrowSync/store.js';
import { ApiError } from '../errors.js';
import { requireLiveSessionInTx, type LiveSession } from '../auth/liveSession.js';
import type { EventBus } from '../events/bus.js';
import type { RetentionJob } from '../retention.js';
import { assertVendor } from '../routes/accountType.js';
import { hasAbility, isCustomSet, legacyRoles, presetOf, sortAbilities, type PresetId, type TeamRole } from './abilities.js';
import { assistantLabel } from './label.js';
import { applyLimits, bandOf, bandView, storedHours, type LoginHours, type MemberLimits, type TradeBandView } from './limits.js';
import { MAX_TEAM_MEMBERS, STREAM_ABILITY, TRADE_PART_ABILITY } from './perms.js';

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
  tradeTag: string;
  /** The member's ticked boxes, in catalogue order (team/abilities.ts). */
  abilities: string[];
  /** The preset the boxes match exactly, or null ("Custom"). */
  preset: PresetId | null;
  /** The old roles the boxes still read as (for the web until it renders the boxes). */
  roles: TeamRole[];
  /** True when those roles do not describe the boxes exactly: the web's roles view says "Custom" (review 2026-11-09 m3). */
  custom: boolean;
  status: MemberStatus;
  /**
   * Owner p11-25 (S-105): how trade chats show this member, "<the lead's Trade Tag> Assistant N"
   * (team/label.ts); never the member's own name.
   */
  chatLabel: string;
  /** J-20 (p7-4): the trade-size band in XMR atomic units, or null (no band). */
  band: TradeBandView | null;
  /** J-20 (p7-11): working hours, "any" or the days-and-hours window; null when the stored value is invalid (the member is then always outside). */
  hours: LoginHours | null;
  /** Until when the invite (or an unfinished sign-up) can be used; null once joined. */
  inviteExpiresAt: string | null;
  joinedAt: string | null;
  createdAt: string;
}

/** A stored set as views show it: sorted, its preset, and the old roles it reads as. */
export function abilitiesView(stored: readonly string[]): { abilities: string[]; preset: PresetId | null; roles: TeamRole[] } {
  const abilities = sortAbilities(stored);
  return { abilities, preset: presetOf(abilities), roles: legacyRoles(abilities) };
}

/** Live members: not removed, and joined or still inside their invite's time. */
export const LIVE_MEMBER = `removed_at is null and (joined_at is not null or invite_expires_at > $2)`;

interface MemberRow {
  id: string;
  trade_tag: string;
  abilities: string[];
  member_account_id: string | null;
  joined_at: Date | null;
  invite_expires_at: Date;
  created_at: Date;
  assistant_no: number;
  /** The team account's Trade Tag (read by `MEMBER_COLS`). */
  lead_name: string;
  band_min_atomic: string | null;
  band_max_atomic: string | null;
  hours: unknown;
}

/** The columns a `MemberRow` reads (in a query on `team_members`, unaliased). */
const MEMBER_COLS = `id, trade_tag, abilities, member_account_id, joined_at, invite_expires_at, created_at, assistant_no,
  (select a.trade_tag from accounts a where a.id = team_members.account_id) as lead_name,
  band_min_atomic::text, band_max_atomic::text, hours`;

function toView(r: MemberRow): TeamMemberView {
  const status: MemberStatus = r.joined_at !== null ? 'active' : r.member_account_id !== null ? 'joining' : 'invited';
  return {
    id: r.id,
    tradeTag: r.trade_tag,
    ...abilitiesView(r.abilities),
    custom: isCustomSet(r.abilities),
    status,
    chatLabel: assistantLabel(r.lead_name, r.assistant_no),
    band: bandView(bandOf(r.band_min_atomic, r.band_max_atomic)),
    hours: storedHours(r.hours),
    inviteExpiresAt: r.joined_at === null ? r.invite_expires_at.toISOString() : null,
    joinedAt: r.joined_at?.toISOString() ?? null,
    createdAt: r.created_at.toISOString(),
  };
}

/** The account's live members and open invites, oldest first. */
export async function listMembers(db: Queryable, accountId: string, now: Date): Promise<TeamMemberView[]> {
  const { rows } = await db.query<MemberRow>(
    `select ${MEMBER_COLS}
       from team_members where account_id = $1 and ${LIVE_MEMBER} order by created_at, id`,
    [accountId, now],
  );
  return rows.map(toView);
}

/**
 * A member's name, as chat labels show it: the new-trade-tag rules (8–20 characters, owner note #127; no
 * spaces; no reserved words, with look-alikes) and no look-alike of a staff or owner name
 * (F4), so a label can never read like X2F staff. 400 `trade-tag-invalid` / `trade-tag-reserved`.
 * Unique within the team only (the unique index; 409 `trade-tag-taken`).
 */
export async function checkMemberName(db: Queryable, raw: unknown): Promise<{ name: string; key: string }> {
  const r = checkNewTradeTag(typeof raw === 'string' ? raw : '');
  if (!r.ok) throw new ApiError(400, r.reason === 'reserved' ? 'trade-tag-reserved' : 'trade-tag-invalid');
  // F4, review of third-signup-r3 M2: punctuation and spaces are ignored too (staffNameKey).
  const folded = staffNameKey(r.key);
  const { rows } = await db.query<{ display_key: string }>("select display_key from accounts where kind in ('staff', 'owner')");
  if (rows.some((s) => staffNameKey(s.display_key) === folded)) throw new ApiError(400, 'trade-tag-reserved');
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

/** The calling session (`req.auth`): every write below re-checks, first in its transaction, that it is still live. */
export interface Caller {
  accountId: string;
  sessionId: string;
}

/**
 * First in each team write's transaction: the account lock and a live calling session
 * (`requireLiveSessionInTx`, 401 `not-authenticated`; `LIVE_SESSION_ROUTES`). Owner 2 Nov 2026:
 * team members are for vendor accounts only. Inviting and changing boxes need a vendor (403
 * `not-vendor`); a trader's team from before migration 198 can still be removed.
 */
async function ownerWriteGate(c: Queryable, caller: Caller, now: Date, o: { vendor: boolean }): Promise<LiveSession> {
  const live = await requireLiveSessionInTx(c, caller, now);
  if (o.vendor) await assertVendor(c, caller.accountId);
  return live;
}

/**
 * Creates an invite for the account (the account owner's session; `requireSession` already
 * refused members). The account row is locked first (`ownerWriteGate`: 401 when the calling
 * session was revoked meanwhile), so two invites cannot both pass the count.
 * Invites past their time are closed first (they no longer count and free their names). 409
 * `too-many-members` at `MAX_TEAM_MEMBERS`; 409 `trade-tag-taken` for a name already in the team.

 */
export async function createInvite(
  deps: Pick<Deps, 'db' | 'clock'>,
  caller: Caller,
  a: { name: { name: string; key: string }; abilities: string[] },
): Promise<{ id: string; code: string; expiresAt: string }> {
  const { accountId } = caller;
  const now = deps.clock();
  const code = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
  try {
    const out = await inTransaction(deps.db, async (c) => {
      await ownerWriteGate(c, caller, now, { vendor: true });
      await closeExpiredInvites(c, now, accountId);
      const count = await c.query<{ n: number }>(`select count(*)::int as n from team_members where account_id = $1 and ${LIVE_MEMBER}`, [accountId, now]);
      if (count.rows[0]!.n >= MAX_TEAM_MEMBERS) throw new ApiError(409, 'too-many-members', { max: MAX_TEAM_MEMBERS });
      const { rows } = await c.query<{ id: string }>(
        `insert into team_members (account_id, trade_tag, display_key, abilities, invite_hash, invite_expires_at, created_at)
         values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [accountId, a.name.name, a.name.key, a.abilities, inviteHash(code), expiresAt, now],
      );
      return rows[0]!.id;
    });
    return { id: out, code, expiresAt: expiresAt.toISOString() };
  } catch (e) {
    if ((e as { code?: string; constraint?: string }).code === '23505' && (e as { constraint?: string }).constraint === 'team_members_live_name') {
      throw new ApiError(409, 'trade-tag-taken');
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
 * calling session was revoked meanwhile (`ownerWriteGate`, first).
 */
export async function removeMember(
  deps: Pick<Deps, 'db' | 'clock'> & { events: Pick<EventBus, 'closeSession'> },
  caller: Caller,
  memberId: string,
): Promise<void> {
  const { accountId } = caller;
  const now = deps.clock();
  const out = await inTransaction(deps.db, async (c) => {
    await ownerWriteGate(c, caller, now, { vendor: false });
    const found = await c.query('select 1 from team_members where id = $1 and account_id = $2 and removed_at is null', [memberId, accountId]);
    if (found.rows.length === 0) throw new ApiError(404, 'not-found');
    return applyMemberRemoval(c, accountId, memberId, now);
  });
  for (const id of out) deps.events.closeSession(accountId, id);
}

/**
 * The removal write: the row is
 * marked removed, the invite code dies, the member's login account is deleted and every session
 * of theirs is revoked. Returns those sessions (the caller closes their streams after commit).
 * 404 `not-found` when the member was removed meanwhile.
 */
export async function applyMemberRemoval(c: Queryable, accountId: string, memberId: string, now: Date): Promise<string[]> {
  // Review 26 Nov (finding 3): lock the member's sessions before the team_members write, whose
  // trigger takes the team log's lock; a logout locks its session row and then waits on that lock.
  await c.query('select 1 from sessions where member_id = $1 and revoked_at is null order by id for update', [memberId]);
  const { rows } = await c.query<{ member_account_id: string | null }>(
    `update team_members set removed_at = $3, invite_hash = null
      where id = $1 and account_id = $2 and removed_at is null returning member_account_id`,
    [memberId, accountId, now],
  );
  const row = rows[0];
  if (!row) throw new ApiError(404, 'not-found');
  if (row.member_account_id !== null) await deleteMemberLogin(c, row.member_account_id);
  // Escrow-key sync (migration 864): a removed member's reader key goes, with its unlocks and every wrap sealed to it.
  await c.query('delete from escrow_readers where member_id = $1', [memberId]);
  const s = await c.query<{ id: string }>('update sessions set revoked_at = $2 where member_id = $1 and revoked_at is null returning id', [memberId, now]);
  return s.rows.map((r) => r.id);
}

/** Deletes a member's login account (only ever a `member` row); the cascade takes its login methods and `team_members` keeps a null. */
async function deleteMemberLogin(c: Queryable, memberAccountId: string): Promise<void> {
  await c.query("delete from accounts where id = $1 and kind = 'member'", [memberAccountId]);
}

/**
 * Sets a live member's boxes to exactly `abilities` (takes effect on their next request). When the
 * new set no longer sees active trades, the member's live streams (which carry the account's trade
 * events) are closed after the commit (review M2). 404 for anyone else's or a removed member. 401
 * when the calling session was revoked meanwhile, 403 `not-vendor` (`ownerWriteGate`, first).
 */
export async function setAbilities(
  deps: Pick<Deps, 'db' | 'clock'> & { events: Pick<EventBus, 'closeSession'> },
  caller: Caller,
  memberId: string,
  abilities: string[],
): Promise<TeamMemberView> {
  const { accountId } = caller;
  const now = deps.clock();
  const { row, sessions } = await inTransaction(deps.db, async (c) => {
    await ownerWriteGate(c, caller, now, { vendor: true });
    const r = await updateAbilities(c, accountId, memberId, abilities, now);
    if (!r) throw new ApiError(404, 'not-found');
    return r;
  });
  // After the commit: a member who can no longer see trades loses the live streams that carry trade events.
  for (const id of sessions) deps.events.closeSession(accountId, id);
  return toView(row);
}

/**
 * J-20: sets a live member's (or open invite's) trade-size band and working hours to exactly
 * `limits`. The gate is the boxes': the account lock, a live calling session and a vendor account
 * (`ownerWriteGate`).
 * Sessions the new hours shut out end at once; their streams close after the commit.
 */
export async function setLimits(
  deps: Pick<Deps, 'db' | 'clock'> & { events: Pick<EventBus, 'closeSession'> },
  caller: Caller,
  memberId: string,
  limits: MemberLimits,
): Promise<TeamMemberView> {
  const { accountId } = caller;
  const now = deps.clock();
  const { row, ended } = await inTransaction(deps.db, async (c) => {
    await ownerWriteGate(c, caller, now, { vendor: true });
    const ended = await applyLimits(c, accountId, memberId, limits, now);
    const { rows } = await c.query<MemberRow>(`select ${MEMBER_COLS} from team_members where id = $1`, [memberId]);
    return { row: rows[0]!, ended };
  });
  for (const id of ended) deps.events.closeSession(accountId, id);
  return toView(row);
}

/**
 * The boxes write. Null for a member who is not live. Returns the member's sessions whose live
 * streams must close (the new set reads no trades part, review M2, or other parts than before, review
 * trades-list I1).
 */
async function updateAbilities(c: Queryable, accountId: string, memberId: string, abilities: string[], now: Date): Promise<{ row: MemberRow; sessions: string[] } | null> {
  const before = await c.query<{ abilities: string[] }>('select abilities from team_members where id = $1 and account_id = $2', [memberId, accountId]);
  const { rows } = await c.query<MemberRow>(
    `update team_members set abilities = $3
      where id = $1 and account_id = $4 and ${LIVE_MEMBER}
      returning ${MEMBER_COLS}`,
    [memberId, now, abilities, accountId],
  );
  const r = rows[0];
  if (!r) return null;
  // Escrow-key sync (migration 864): unticking "Hold trade keys" takes the member's copies away at
  // once (the lead's device stops sealing to them; the read route checks the box too).
  if (!hasAbility(abilities, ESCROW_KEYS_ABILITY)) await dropMemberWraps(c, memberId);
  // A stream carries the parts the boxes allowed when it opened (review trades-list I1): any change
  // to the trades boxes ends it, and the reconnect takes the new ones (or is refused without either).
  const parts = (set: readonly string[]) => Object.values(TRADE_PART_ABILITY).map((a) => hasAbility(set, a)).join();
  const changed = before.rows[0] === undefined || parts(before.rows[0].abilities) !== parts(abilities);
  const s = !changed && hasAbility(abilities, STREAM_ABILITY) ? [] : (await c.query<{ id: string }>('select id from sessions where member_id = $1', [memberId])).rows.map((x) => x.id);
  return { row: r, sessions: s };
}

/**
 * X2F's own sweep of unused invites past their time (of one account, or all): marked removed, the
 * code dies. The statement runs under the transaction-local `x2f.team_actor` = 'system', so the
 * team log records these closures as X2F's (migration 857); any other removal, the owner's
 * cancelling of an invite included, is logged as the owner's. Returns the rows closed.
 */
export async function closeExpiredInvites(c: Queryable, now: Date, accountId?: string): Promise<number> {
  await c.query("select set_config('x2f.team_actor', 'system', true)");
  const closed = await c.query(
    `update team_members set removed_at = $1, invite_hash = null
      where removed_at is null and joined_at is null and invite_expires_at <= $1
        and ($2::uuid is null or account_id = $2::uuid)`,
    [now, accountId ?? null],
  );
  // Cleared again at once, so nothing later in the transaction is taken for X2F's doing. (A failed
  // update aborts the transaction, and the setting goes with it.)
  await c.query("select set_config('x2f.team_actor', '', true)");
  return closed.rowCount ?? 0;
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
      const closed = await closeExpiredInvites(c, now);
      const gone = await c.query(
        `delete from accounts a where a.kind = 'member'
          and not exists (select 1 from team_members tm where tm.member_account_id = a.id and tm.removed_at is null)`,
      );
      return closed + (gone.rowCount ?? 0);
    });
  },
};

// ---------------------------------------------------------------------------------------------
// The member's side: an invite and the sign-up

/**
 * What an open invite shows whoever holds its code, before they join: the name the account owner
 * gave them, their roles and the deadline. Never the team account's name (review 2026-11-08 F3:
 * nothing behind the front door, the vendor's name included, reaches someone not yet inside).
 */
export interface InviteView {
  tradeTag: string;
  abilities: string[];
  preset: PresetId | null;
  roles: TeamRole[];
  expiresAt: string;
}

interface InviteRow {
  id: string;
  account_id: string;
  trade_tag: string;
  abilities: string[];
  invite_expires_at: Date;
}

/**
 * The open invite a code names: not used, not removed, not past its time, of a live trader
 * account. Anything else → 404 `not-found` (one answer for a wrong, used and expired code).
 * The team account is joined only to check it is live; its name is never loaded (review 6a5949a6 F6).
 * `lock` takes the row `for update` (inside a transaction).
 */
export async function openInvite(q: Queryable, by: { code: unknown } | { id: string }, now: Date, lock = false): Promise<InviteRow> {
  let hash: Buffer | null = null;
  if ('code' in by) {
    if (typeof by.code !== 'string' || !CODE.test(by.code)) throw new ApiError(404, 'not-found');
    hash = inviteHash(by.code);
  }
  const { rows } = await q.query<InviteRow>(
    `select tm.id, tm.account_id, tm.trade_tag, tm.abilities, tm.invite_expires_at
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
  return { tradeTag: r.trade_tag, ...abilitiesView(r.abilities), expiresAt: r.invite_expires_at.toISOString() };
}

/**
 * The member's private login name: the login-name rules, and never any account's public Trade
 * Tag (one namespace, as at sign-up). 400 `login-name-invalid`, 409 `names-unavailable`. A login
 * name already taken is found only by `createAccount` at the end (the same generic answer).
 */
export async function checkMemberLoginName(db: Queryable, raw: unknown): Promise<{ name: string; key: string }> {
  const r = checkNewLoginName(typeof raw === 'string' ? raw : '');
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
  a: { inviteId: string; names: NewNames; now: Date; terms: { version: string; signature: TermsSignature }; addKey: (memberAccountId: string) => Promise<void> },
): Promise<{ memberId: string; memberAccountId: string; teamId: string; setupUntil: Date }> {
  const invite = await openInvite(c, { id: a.inviteId }, a.now, true);
  // FU-D: the login name is stored only as its keyed tag (createAccount); the Trade Tag is the
  // random placeholder `memberNames` made, never shown.
  // The member's own acceptance of the Terms and their signature (review 2026-11-08 F1; owner 9 Nov
  // p11-14, everyone who gets a login signs), checked by `assertTermsAccepted`.
  const memberAccountId = await createAccount(c, config, {
    ...a.names, kind: 'member', termsVersion: a.terms.version, termsSignature: a.terms.signature, now: a.now,
  });
  await a.addKey(memberAccountId);
  const setupUntil = new Date(Math.max(invite.invite_expires_at.getTime(), a.now.getTime() + SETUP_MIN_MS));
  await c.query('update team_members set member_account_id = $2, invite_hash = null, invite_expires_at = $3 where id = $1', [
    invite.id, memberAccountId, setupUntil,
  ]);
  return { memberId: invite.id, memberAccountId, teamId: invite.account_id, setupUntil };
}

/**
 * A member login account's names: the checked login name's key and a random placeholder Trade
 * Tag nobody sees (accounts.trade_tag is not null and unique). The join challenge keeps them
 * only sealed (`sealNames`, FU-D), as a trader's sign-up does.
 */
export function memberNames(loginKey: string): NewNames {
  const placeholder = `m-${randomBytes(8).toString('hex')}`;
  return { tradeTag: placeholder, displayKey: placeholder, loginKey };
}

/**
 * Marks the member joined once their second factor is stored, and tells the account owner. 404
 * when the member was removed (or had already joined) meanwhile.
 */
export async function finishMember(c: Queryable, memberAccountId: string, now: Date): Promise<void> {
  const { rows } = await c.query<{ account_id: string; trade_tag: string }>(
    `update team_members set joined_at = $2
      where member_account_id = $1 and joined_at is null and removed_at is null and invite_expires_at > $2
      returning account_id, trade_tag`,
    [memberAccountId, now],
  );
  const row = rows[0];
  if (!row) throw new ApiError(404, 'not-found');
  await addAlert(c, row.account_id, 'team-member-joined', { member: row.trade_tag }, now);
}
