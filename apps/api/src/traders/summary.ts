import type { Queryable } from '../db/pool.js';
import { PUBLIC_NAME_COLUMN } from '../events/publicName.js';
import { tradedOverUsd, tradedTotalSql } from './tradedTotal.js';
import { COMPLETED_TRADES_SQL, loadStarterSettings, stageFor, type Stage, type StarterSettings } from './stage.js';

/**
 * A trader as anyone else sees them (plan Task 4): on offer cards (`GET /v1/offers`), the
 * single-offer route and the trade view's counterparty. Plan 5 fills `typicalMinutes`,
 * `positivePct` and `badges`.
 *
 * `displayName` is the PUBLIC display name (spec 6.1, FU-A), read through events/publicName.ts's
 * column; never the private login name.
 */
export interface TraderSummary {
  /** The public display name; the private login name is never shown to anyone. */
  displayName: string;
  completedTrades: number;
  online: boolean;
  lastSeenAt: string | null;
  typicalMinutes: number | null;
  positivePct: number | null;
  badges: string[];
  /** The starter-limits stage (spec 2.3; plan Task 4 Revision 2026-10-26): the New badge shows until 'graduated'. */
  stage: Stage;
  /**
   * C12b (owner 2026-11-01/02): "Completed over $X in trades to date", X in whole US dollars, the
   * largest step strictly below the total (@x2f/reputation `tradedBucketUsd`, review M1); null
   * unless the trader opted in and the total is over $10,000. Never the exact total.
   */
  tradedOverUsd: number | null;
}

/** Someone counts as online when one of their sessions was used this recently (to the 5-minute bucket: see `onlineSince`). */
export const ONLINE_MS = 5 * 60_000;

/** `lastSeenAt` is rounded down to this step. */
export const LAST_SEEN_STEP_MS = 5 * 60_000;

/**
 * Online means a session was used in the current or the previous 5-minute bucket (round-2 review
 * Minor 2): so for 5 to 10 minutes after the last request, and the answer only changes on a bucket
 * boundary. An exact "less than 5 minutes ago" flipped to offline exactly 5 minutes after the last
 * request, so anyone polling an offer learned that request's time, which flooring `lastSeenAt`
 * hides. `online` is therefore a function of the public `lastSeenAt` and the clock.
 */
export function onlineSince(now: Date): Date {
  return new Date((Math.floor(now.getTime() / LAST_SEEN_STEP_MS) * LAST_SEEN_STEP_MS) - ONLINE_MS);
}

/**
 * The newest use of `account`'s live sessions, in SQL; null to a `viewer` (a uuid expression, may
 * be null) the account has blocked. Online status is private data (owner ruling 2026-10-28): a
 * blocked person must not even see that someone is online, so to them the account looks like one
 * with no live session (as after logging out everywhere), which does not tell them about the block.
 */
export function lastSeenSql(account: string, viewer: string): string {
  return `(select max(s.last_seen_at) from sessions s where s.account_id = ${account} and s.revoked_at is null
    and not exists (select 1 from account_blocks b where b.account_id = ${account} and b.blocked_id = ${viewer}))`;
}

/**
 * The summaries of `accountIds` (unknown ids are left out), in one query, as `viewerId` (the signed-in
 * trader asking, or null) may see them: `online` and `lastSeenAt` are hidden from someone the
 * account has blocked.
 */
export async function traderSummaries(
  q: Queryable,
  accountIds: readonly string[],
  now: Date,
  viewerId: string | null,
  settings?: StarterSettings,
): Promise<Map<string, TraderSummary>> {
  const out = new Map<string, TraderSummary>();
  const ids = [...new Set(accountIds)];
  if (ids.length === 0) return out;
  const s = settings ?? (await loadStarterSettings(q));
  // The name column is a constant, never input.
  const { rows } = await q.query<{ id: string; name: string; created_at: Date; completed: string; last_seen: Date | null; show_traded: boolean; traded: string }>(
    `select a.id, a.${PUBLIC_NAME_COLUMN} as name, a.created_at,
            ${COMPLETED_TRADES_SQL} as completed,
            ${lastSeenSql('a.id', '$2::uuid')} as last_seen,
            a.show_traded_total as show_traded, ${tradedTotalSql('a.id')} as traded
       from accounts a where a.id = any($1::uuid[])`,
    [ids, viewerId],
  );
  const since = onlineSince(now).getTime();
  for (const r of rows) {
    const completed = Number(r.completed);
    out.set(r.id, {
      displayName: r.name,
      completedTrades: completed,
      online: r.last_seen !== null && r.last_seen.getTime() >= since,
      // Public, so only to the 5 minutes, floored (review M3): enough for "last seen", not for timing someone's requests.
      lastSeenAt: r.last_seen === null ? null : new Date(Math.floor(r.last_seen.getTime() / LAST_SEEN_STEP_MS) * LAST_SEEN_STEP_MS).toISOString(),
      typicalMinutes: null,
      positivePct: null,
      badges: [],
      stage: stageFor(s, completed, r.created_at, now),
      tradedOverUsd: tradedOverUsd(r.show_traded, r.traded),
    });
  }
  return out;
}

/** One trader's summary as `viewerId` may see it; throws for an unknown account. */
export async function traderSummary(q: Queryable, accountId: string, now: Date, viewerId: string | null): Promise<TraderSummary> {
  const t = (await traderSummaries(q, [accountId], now, viewerId)).get(accountId);
  if (!t) throw new Error('trader missing');
  return t;
}
