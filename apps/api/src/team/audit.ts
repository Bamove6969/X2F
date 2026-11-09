/**
 * The account owner's audit log of team members' actions (Plan 2 Task 18; spec 6.7, R44).
 *
 * `auditMember` is called inside the transaction of every member action that has an effect, so
 * the row exists exactly when the action committed; for the account owner's own actions it does
 * nothing. Reads never log. The table is append-only (migration 015's triggers). Trade codes in it
 * are cleared by the database itself when the trade is deleted (R36; migration 199's trigger on
 * `trades`), so no purge can forget it.
 */
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { hasRole, type TeamRole } from './perms.js';

/** Every action the log records. */
export type AuditAction =
  // Offers role.
  | 'offer-posted'
  | 'offer-paused'
  | 'offer-relisted'
  | 'offer-removed'
  // Trades role.
  | 'trade-taken'
  | 'trade-wallet-set'
  | 'dispute-opened'
  | 'appeal-filed'
  // Trade events a member may send (MEMBER_SIGNING_EVENTS are refused before this point).
  | 'mark-paid'
  | 'extend'
  | 'request-refund'
  | 'buyer-cancel'
  | 'propose-cancel'
  | 'accept-cancel'
  | 'withdraw-cancel'
  | 'walk-away'
  | 'confirm-cancel'
  // Owner p4-8: the lead's waiting changes, by a member the lead gave hold rights.
  | 'hold-changes-cancelled'
  | 'hold-changes-approved';

/** The role each action needs (the route's `requireSession({ member })`), checked again live by `auditMember`. */
export const ACTION_ROLE: Readonly<Record<AuditAction, TeamRole>> = {
  'offer-posted': 'offers',
  'offer-paused': 'offers',
  'offer-relisted': 'offers',
  'offer-removed': 'offers',
  'trade-taken': 'trades',
  'trade-wallet-set': 'trades',
  'dispute-opened': 'trades',
  'appeal-filed': 'trades',
  'mark-paid': 'trades',
  extend: 'trades',
  'request-refund': 'trades',
  'buyer-cancel': 'trades',
  'propose-cancel': 'trades',
  'accept-cancel': 'trades',
  'withdraw-cancel': 'trades',
  'walk-away': 'trades',
  'confirm-cancel': 'trades',
  'hold-changes-cancelled': 'hold-cancel',
  'hold-changes-approved': 'hold-end',
};

/** Who acted: the session's account and member (null for the account owner). */
export interface Actor {
  accountId: string;
  memberId: string | null;
}

/**
 * Writes one audit row for a member's action (nothing for the account owner). `detail` must hold
 * no wallet address, key, token, secret, IP address or user agent: ids and plain facts only.
 *
 * Review M1: `requireSession` checked the member before the handler ran, and a removal or a role
 * change may have committed since. So the member's row is read again here `for share`, inside the
 * action's transaction: a removal or roles change (both UPDATE that row) either waits for this
 * action to commit, or has committed and this action is refused and rolls back: 401
 * `not-authenticated` for a removed member, 403 `forbidden` for one who no longer holds the role.
 */
export async function auditMember(
  q: Queryable,
  actor: Actor,
  a: { action: AuditAction; tradeCode?: string | null; detail?: Record<string, string | number | boolean | null> },
  now: Date,
): Promise<void> {
  if (actor.memberId === null) return;
  await assertLiveMember(q, actor, ACTION_ROLE[a.action]);
  await q.query(
    'insert into team_audit (account_id, member_id, at, action, trade_code, detail) values ($1, $2, $3, $4, $5, $6)',
    [actor.accountId, actor.memberId, now, a.action, a.tradeCode ?? null, JSON.stringify(a.detail ?? {})],
  );
}

/**
 * The live check alone (review round 2, n2): for a member, reads the member's row again `for
 * share` inside the caller's transaction and refuses a removed member (401 `not-authenticated`) or
 * one who no longer holds `role` (403 `forbidden`), exactly as `auditMember` does, without writing
 * a log row. For a write a member's request causes that is not itself an audited action (the
 * `return-confirmed` a member's Confirm cancel records first). Nothing for the account owner.
 */
export async function assertLiveMember(q: Queryable, actor: Actor, role: TeamRole): Promise<void> {
  if (actor.memberId === null) return;
  const { rows } = await q.query<{ roles: TeamRole[] }>(
    `select tm.roles from team_members tm
      where tm.id = $1 and tm.account_id = $2 and tm.removed_at is null and tm.joined_at is not null
      for share`,
    [actor.memberId, actor.accountId],
  );
  const live = rows[0];
  if (!live) throw new ApiError(401, 'not-authenticated');
  if (!hasRole(live.roles, role)) throw new ApiError(403, 'forbidden');
}

export interface AuditEntry {
  id: string;
  at: string;
  memberId: string;
  memberName: string;
  action: string;
  tradeCode: string | null;
  detail: unknown;
}

export const AUDIT_PAGE = 200;

/** The account's log, newest first, at most `AUDIT_PAGE` rows, optionally within [from, to) and for one member. */
export async function listAudit(
  q: Queryable,
  accountId: string,
  f: { from?: Date; to?: Date; memberId?: string } = {},
): Promise<AuditEntry[]> {
  const { rows } = await q.query<{ id: string; at: Date; member_id: string; display_name: string; action: string; trade_code: string | null; detail: unknown }>(
    `select l.id::text as id, l.at, l.member_id, m.display_name, l.action, l.trade_code, l.detail
       from team_audit l join team_members m on m.id = l.member_id
      where l.account_id = $1
        and ($2::timestamptz is null or l.at >= $2) and ($3::timestamptz is null or l.at < $3)
        and ($4::uuid is null or l.member_id = $4)
      order by l.at desc, l.id desc limit ${AUDIT_PAGE}`,
    [accountId, f.from ?? null, f.to ?? null, f.memberId ?? null],
  );
  return rows.map((r) => ({
    id: r.id, at: r.at.toISOString(), memberId: r.member_id, memberName: r.display_name, action: r.action, tradeCode: r.trade_code, detail: r.detail,
  }));
}
