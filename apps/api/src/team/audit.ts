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
import { hasAbility, type AbilityNeed } from './abilities.js';

/** Every action the log records. */
export type AuditAction =
  // Offers boxes.
  | 'offer-posted'
  | 'offer-paused'
  | 'offer-relisted'
  | 'offer-removed'
  // Trades boxes.
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
  // Owner p4-8: the lead's waiting changes, by a member the lead gave a hold box.
  | 'hold-changes-cancelled'
  | 'hold-changes-approved'
  // Notes on traders (S-094): added, never deleted by a member.
  | 'note-added';

/**
 * Actions only the account owner takes that the team log still records (T-076, p7-1: every
 * release is logged with name and amount; members never release, so the name is the lead's).
 * Written only on a team account (one with a live member or open invite).
 */
export type LeadAuditAction = 'release-started';

/** The box each action needs (the route's `requireSession({ member })`), checked again live by `auditMember`. */
export const ACTION_ABILITY: Readonly<Record<AuditAction, string>> = {
  'offer-posted': 'offers-post',
  'offer-paused': 'offers-pause',
  'offer-relisted': 'offers-pause',
  'offer-removed': 'offers-delete',
  'trade-taken': 'trades-take',
  'trade-wallet-set': 'trades-accept',
  // Never a member's (D-066: the route is owner-only); named so the map is total.
  'dispute-opened': 'disputes-open',
  'appeal-filed': 'disputes-appeal',
  'mark-paid': 'trades-mark-paid',
  extend: 'trades-extend',
  'request-refund': 'trades-cancel-no-show',
  'buyer-cancel': 'trades-cancel',
  'propose-cancel': 'trades-cancel',
  'accept-cancel': 'trades-cancel',
  'withdraw-cancel': 'trades-cancel',
  'walk-away': 'trades-cancel',
  'confirm-cancel': 'trades-confirm-cancel',
  // A stronger hold box includes the weaker ones (`effectiveAbilities`).
  'hold-changes-cancelled': 'hold-cancel',
  'hold-changes-approved': 'hold-end',
  'note-added': 'notes-add',
};

/** Who acted: the session's account and member (null for the account owner). */
export interface Actor {
  accountId: string;
  memberId: string | null;
}

/** A trade's amount, for its log rows ("every action logged with name and amount", T-076). */
async function tradeAmount(q: Queryable, code: string): Promise<Record<string, string>> {
  const { rows } = await q.query<{ amount_atomic: string; fiat_cents: string; locked_currency: string }>(
    'select amount_atomic::text, fiat_cents::text, locked_currency from trades where code = $1',
    [code],
  );
  const r = rows[0];
  return r ? { amountAtomic: r.amount_atomic, fiatCents: r.fiat_cents, currency: r.locked_currency } : {};
}

type Detail = Record<string, string | number | boolean | null>;

/**
 * Writes one audit row for a member's action (nothing for the account owner). `detail` must hold
 * no wallet address, key, token, secret, IP address or user agent: ids and plain facts only. On a
 * trade the row also gets the trade's amount (XMR atomic, fiat cents and currency); the member's
 * name is the log's join on `team_members` (the row stays after removal).
 *
 * Review M1: `requireSession` checked the member before the handler ran, and a removal or a box
 * change may have committed since. So the member's row is read again here `for share`, inside the
 * action's transaction: a removal or abilities change (both UPDATE that row) either waits for this
 * action to commit, or has committed and this action is refused and rolls back: 401
 * `not-authenticated` for a removed member, 403 `forbidden` for one who no longer holds the box.
 */
export async function auditMember(
  q: Queryable,
  actor: Actor,
  a: { action: AuditAction; tradeCode?: string | null; detail?: Detail },
  now: Date,
): Promise<void> {
  if (actor.memberId === null) return;
  await assertLiveMember(q, actor, ACTION_ABILITY[a.action]);
  const detail = { ...(a.tradeCode ? await tradeAmount(q, a.tradeCode) : {}), ...(a.detail ?? {}) };
  await q.query(
    'insert into team_audit (account_id, member_id, at, action, trade_code, detail) values ($1, $2, $3, $4, $5, $6)',
    [actor.accountId, actor.memberId, now, a.action, a.tradeCode ?? null, JSON.stringify(detail)],
  );
}

/**
 * The account owner's own action that the team log records (`LeadAuditAction`), with the trade's
 * amount; only on a team account (a live member or open invite now), and never for a member (who
 * cannot take these actions at all). The row's `member_id` is null: "the lead".
 */
export async function auditLead(q: Queryable, actor: Actor, a: { action: LeadAuditAction; tradeCode: string }, now: Date): Promise<void> {
  if (actor.memberId !== null) return;
  const { rows } = await q.query('select 1 from team_members where account_id = $1 and removed_at is null and (joined_at is not null or invite_expires_at > $2) limit 1', [
    actor.accountId, now,
  ]);
  if (rows.length === 0) return;
  await q.query('insert into team_audit (account_id, member_id, at, action, trade_code, detail) values ($1, null, $2, $3, $4, $5)', [
    actor.accountId, now, a.action, a.tradeCode, JSON.stringify(await tradeAmount(q, a.tradeCode)),
  ]);
}

/**
 * The live check alone (review round 2, n2): for a member, reads the member's row again `for
 * share` inside the caller's transaction and refuses a removed member (401 `not-authenticated`) or
 * one who no longer holds `need` (403 `forbidden`), exactly as `auditMember` does, without writing
 * a log row. For a write a member's request causes that is not itself an audited action (the
 * `return-confirmed` a member's Confirm cancel records first). Nothing for the account owner.
 */
export async function assertLiveMember(q: Queryable, actor: Actor, need: AbilityNeed): Promise<void> {
  if (actor.memberId === null) return;
  const { rows } = await q.query<{ abilities: string[] }>(
    `select tm.abilities from team_members tm
      where tm.id = $1 and tm.account_id = $2 and tm.removed_at is null and tm.joined_at is not null
      for share`,
    [actor.memberId, actor.accountId],
  );
  const live = rows[0];
  if (!live) throw new ApiError(401, 'not-authenticated');
  if (!hasAbility(live.abilities, need)) throw new ApiError(403, 'forbidden');
}

export interface AuditEntry {
  id: string;
  at: string;
  /** Null for the account owner's own row (`auditLead`). */
  memberId: string | null;
  memberName: string | null;
  byLead: boolean;
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
  const { rows } = await q.query<{ id: string; at: Date; member_id: string | null; display_name: string | null; action: string; trade_code: string | null; detail: unknown }>(
    `select l.id::text as id, l.at, l.member_id, m.display_name, l.action, l.trade_code, l.detail
       from team_audit l left join team_members m on m.id = l.member_id
      where l.account_id = $1
        and ($2::timestamptz is null or l.at >= $2) and ($3::timestamptz is null or l.at < $3)
        and ($4::uuid is null or l.member_id = $4)
      order by l.at desc, l.id desc limit ${AUDIT_PAGE}`,
    [accountId, f.from ?? null, f.to ?? null, f.memberId ?? null],
  );
  return rows.map((r) => ({
    id: r.id, at: r.at.toISOString(), memberId: r.member_id, memberName: r.display_name, byLead: r.member_id === null,
    action: r.action, tradeCode: r.trade_code, detail: r.detail,
  }));
}
