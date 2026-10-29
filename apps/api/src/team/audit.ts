/**
 * The account owner's audit log of team members' actions (Plan 2 Task 18; spec 6.7, R44).
 *
 * `auditMember` is called inside the transaction of every member action that has an effect, so
 * the row exists exactly when the action committed; for the account owner's own actions it does
 * nothing. Reads never log. The table is append-only (migration 015's trigger). Trade codes in it
 * are cleared when the trade is deleted (R36): Plan 7's purge calls `forgetAuditTrade` in the same
 * transaction (tripwire in apps/api/test/team.test.ts).
 */
import type { Queryable } from '../db/pool.js';

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
  | 'final-alert-seen'
  | 'dispute-opened'
  | 'appeal-filed'
  // Trade events a member may send (MEMBER_SIGNING_EVENTS are refused before this point).
  | 'mark-paid'
  | 'extend'
  | 'request-refund'
  | 'buyer-cancel'
  | 'propose-cancel'
  | 'accept-cancel'
  | 'withdraw-cancel';

/** Who acted: the session's account and member (null for the account owner). */
export interface Actor {
  accountId: string;
  memberId: string | null;
}

/**
 * Writes one audit row for a member's action (nothing for the account owner). `detail` must hold
 * no wallet address, key, token, secret, IP address or user agent: ids and plain facts only.
 */
export async function auditMember(
  q: Queryable,
  actor: Actor,
  a: { action: AuditAction; tradeCode?: string | null; detail?: Record<string, string | number | boolean | null> },
  now: Date,
): Promise<void> {
  if (actor.memberId === null) return;
  await q.query(
    'insert into team_audit (account_id, member_id, at, action, trade_code, detail) values ($1, $2, $3, $4, $5, $6)',
    [actor.accountId, actor.memberId, now, a.action, a.tradeCode ?? null, JSON.stringify(a.detail ?? {})],
  );
}

/** R36: a deleted trade's code leaves the log (the rest of each row stays with the account). */
export async function forgetAuditTrade(q: Queryable, tradeCode: string): Promise<number> {
  const r = await q.query('update team_audit set trade_code = null where trade_code = $1', [tradeCode]);
  return r.rowCount ?? 0;
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
