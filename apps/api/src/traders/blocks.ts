import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';

/**
 * Plan 3 Task 37: the trader-to-trader block (spec 2.4, owner 2026-10-29: "You have the right to
 * do business with who you choose ... safe from bullying"). `account_blocks` (107_nudge.sql) holds
 * one row per (blocker, blocked).
 *
 * Business between two traders stops when EITHER has blocked the other: neither lists, opens or
 * takes the other's offers, and neither can open or write to a chat with the other (the blocker's
 * own take of the blocked person's offer is refused too: lead default 2026-10-29, owner may
 * change). Presence is one-way: only the blocked person loses the blocker's online status
 * (traders/summary.ts `lastSeenSql`). Every refusal looks like "not found", so nothing tells the
 * blocked person about the block. Trades already open continue to the end (escrow must finish);
 * blocking never touches coins.
 *
 * Every route that lets one trader reach another goes through this file: Task 5's take and
 * Task 20's chat routes (`assertNotBlocked`), Plan 5's `GET /v1/traders/:name` (`hasBlocked`).
 * Tripwires in apps/api/test/block-tripwires.test.ts.
 *
 * A logged-out view cannot be identified, so it is never treated as blocked: it lists every offer
 * (P3-M9) with Task 4's coarse public presence (`lastSeenAt` floored to 5 minutes, `online` by
 * 5-minute bucket). A blocked person who logs out (or uses another account) sees what any
 * stranger sees; the block binds the account (Task 37 decision, documented in coordination.md).
 */

/**
 * In SQL: true when `a` and `b` (uuid expressions; `b` may be null for a logged-out viewer) have
 * blocked each other in either direction. Both lookups are primary-key lookups.
 */
export function blockedEitherWaySql(a: string, b: string): string {
  return `(${b} is not null and exists (select 1 from account_blocks bl
    where (bl.account_id = ${a} and bl.blocked_id = ${b}) or (bl.account_id = ${b} and bl.blocked_id = ${a})))`;
}

/** True when either trader has blocked the other. */
export async function blockedEitherWay(q: Queryable, a: string, b: string): Promise<boolean> {
  const { rows } = await q.query<{ blocked: boolean }>(`select ${blockedEitherWaySql('$1::uuid', '$2::uuid')} as blocked`, [a, b]);
  return rows[0]?.blocked === true;
}

/**
 * Refuses an action of `actor` toward `other` (a take, a new chat, a chat message)
 * while either has blocked the other, with the same 404 `not-found` an unknown offer, chat or name
 * gets, so the blocked person cannot tell a block from something that does not exist.
 */
export async function assertNotBlocked(q: Queryable, actor: string, other: string): Promise<void> {
  if (await blockedEitherWay(q, actor, other)) throw new ApiError(404, 'not-found');
}

/**
 * True when `blocker` has blocked `viewer` (one way). For what only the blocked person loses:
 * Plan 5's profile (`GET /v1/traders/:name` answers 404 to someone the trader blocked, lead
 * default 2026-10-29; the blocker still opens the blocked person's profile, where Unblock is).
 */
export async function hasBlocked(q: Queryable, blocker: string, viewer: string | null): Promise<boolean> {
  if (viewer === null) return false;
  const { rows } = await q.query('select 1 from account_blocks where account_id = $1 and blocked_id = $2', [blocker, viewer]);
  return rows.length > 0;
}

/** One block between two traders, for staff. */
export interface BlockBetween {
  blockerId: string;
  blockedId: string;
  since: Date;
}

/**
 * The blocks between the two parties of a dispute, for the moderator's dispute view (Plan 4).
 * Blocks are private: staff see them ONLY in a dispute between the two (lead default 2026-10-29,
 * owner may change), so call this only from a dispute route that has checked that the dispute is
 * between `a` and `b`; there is no staff list of anyone's blocks.
 */
export async function blocksBetween(q: Queryable, a: string, b: string): Promise<BlockBetween[]> {
  const { rows } = await q.query<{ account_id: string; blocked_id: string; created_at: Date }>(
    `select account_id, blocked_id, created_at from account_blocks
      where (account_id = $1 and blocked_id = $2) or (account_id = $2 and blocked_id = $1)
      order by created_at, account_id`,
    [a, b],
  );
  return rows.map((r) => ({ blockerId: r.account_id, blockedId: r.blocked_id, since: r.created_at }));
}
