import type { Queryable } from '../db/pool.js';
import { PUBLIC_NAME_COLUMN } from '../events/publicName.js';
import { COMPLETED_TRADES_SQL, loadStarterSettings, stageFor, type Stage, type StarterSettings } from './stage.js';

/**
 * A trader as anyone else sees them (plan Task 4): on offer cards (`GET /v1/offers`), the
 * single-offer route and the trade view's counterparty. Plan 5 fills `typicalMinutes`,
 * `positivePct` and `badges`.
 *
 * `username` is the PUBLIC display name (spec 6.1), read through events/publicName.ts's column.
 * Plan 2 follow-up FU-A (wip/lead-p2-fua) renames the column to `display_name` and this field to
 * `displayName`; the web parsers (apps/web/src/screens/browse/api.ts parsePoster, quote/api.ts)
 * switch with it. Never the private login name.
 */
export interface TraderSummary {
  username: string;
  completedTrades: number;
  online: boolean;
  lastSeenAt: string | null;
  typicalMinutes: number | null;
  positivePct: number | null;
  badges: string[];
  /** The starter-limits stage (spec 2.3; plan Task 4 Revision 2026-10-26): the New badge shows until 'graduated'. */
  stage: Stage;
}

/** Someone counts as online when one of their sessions was used this recently. */
export const ONLINE_MS = 5 * 60_000;

/** The summaries of `accountIds` (unknown ids are left out), in one query. */
export async function traderSummaries(
  q: Queryable,
  accountIds: readonly string[],
  now: Date,
  settings?: StarterSettings,
): Promise<Map<string, TraderSummary>> {
  const out = new Map<string, TraderSummary>();
  const ids = [...new Set(accountIds)];
  if (ids.length === 0) return out;
  const s = settings ?? (await loadStarterSettings(q));
  // The name column is a constant, never input.
  const { rows } = await q.query<{ id: string; name: string; created_at: Date; completed: string; last_seen: Date | null }>(
    `select a.id, a.${PUBLIC_NAME_COLUMN} as name, a.created_at,
            ${COMPLETED_TRADES_SQL} as completed,
            (select max(s.last_seen_at) from sessions s where s.account_id = a.id and s.revoked_at is null) as last_seen
       from accounts a where a.id = any($1::uuid[])`,
    [ids],
  );
  for (const r of rows) {
    const completed = Number(r.completed);
    out.set(r.id, {
      username: r.name,
      completedTrades: completed,
      online: r.last_seen !== null && now.getTime() - r.last_seen.getTime() < ONLINE_MS,
      lastSeenAt: r.last_seen?.toISOString() ?? null,
      typicalMinutes: null,
      positivePct: null,
      badges: [],
      stage: stageFor(s, completed, r.created_at, now),
    });
  }
  return out;
}

/** One trader's summary; throws for an unknown account. */
export async function traderSummary(q: Queryable, accountId: string, now: Date): Promise<TraderSummary> {
  const t = (await traderSummaries(q, [accountId], now)).get(accountId);
  if (!t) throw new Error('trader missing');
  return t;
}
