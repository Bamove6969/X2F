import {
  awaitingCancelConfirm,
  refundDisputeWindowEndsAt,
  TRADE_KEEP_DAYS,
  tradeDeleteAt,
  tradeDeleteDue,
  type RetentionFacts,
  type Trade,
} from '@x2f/trade';
import type pg from 'pg';
import { deleteChatRowsAsPurge } from '../chat/retention.js';
import type { Queryable } from '../db/pool.js';
import { deleteDisputeRecords, DISPUTE_FACTS_SQL } from '../disputes/purge.js';
import { WATCH_LIST_CLOSED_DAYS } from '../internal/routes.js';
import type { RetentionJob } from '../retention.js';
import { detachReviews } from '../reviews/store.js';
import { FINAL_SALES_SQL } from '../traders/finalOutcome.js';
import { COMPLETED_TRADES_SQL } from '../traders/stage.js';
import { LOST_DISPUTES_SQL, WON_DISPUTES_SQL } from '../traders/summary.js';
import { PURGE_ROLE } from '../trades/purge.js';

/**
 * Plan 7 Task 2 (owner 2026-10-29, R36; Plan 4 Task 23 for the dispute half): the whole-trade
 * purge. Every trade whose `tradeDeleteDue` (@x2f/trade retention.ts) has come is deleted whole,
 * one trade per transaction: its reviews are detached (they are permanent), its chat (with the
 * shred order and purged marks purgeChats writes), its dispute records (disputes/purge.ts), its
 * identities, attestation, refusal, moderation work row, ruling statement and events, then the
 * trade row itself; the rows with `on delete cascade` (review skips, the totals' and the ledger's
 * per-trade marks, blur checks) go with it, and staff pay items lose the code (set null). Nothing
 * is kept per trade. Every delete runs as x2f_purge (`set local role`, 104 and 701).
 *
 * What it never deletes, whatever the date:
 * - an open trade (no `closed_at`), or one whose dispute or appeal is open (`tradeDeleteDue`);
 * - a trade still on the moderation watch list (attested and closed within WATCH_LIST_CLOSED_DAYS,
 *   internal/routes.ts): the moderation service watches its escrow for late coins that long, and a
 *   late-funds report needs the trade to escalate;
 * - liens and owed fees (400), freezes (208), the revenue ledger (430) and the activity log (201):
 *   account or aggregate records with no foreign key to the trade, which x2f_purge may not delete;
 * - anything during site maintenance (no pass runs; the first pass after it catches up).
 *
 * Profiles and starter limits stay the same: before the delete, under the trade's lock, the two
 * accounts' completed trades (R38, the stage), final sales (the count shown), won and lost
 * disputes are read with the readers' own SQL; after it they are read again, and the difference is
 * added to `account_traded_totals.purged_*` (701), which those readers add back. The dollar and XMR
 * totals, the buyer cancels, the fast payments and the typical times are already running totals.
 *
 * Safe under concurrency: the trade is locked `for update` (as applyEvent does), then its disputes
 * and its chat, and the facts are read again under those locks with the same clock, so a dispute
 * opened or an appeal filed since the scan keeps the trade. Logs nothing (the scheduler logs the
 * job name and a count only).
 */

/** Trades read per scan page. */
const BATCH = 200;
const DAY_MS = 86_400_000;

interface FactRow {
  code: string;
  state: Trade['state'];
  settling: Trade['settling'];
  paid_at: Date | null;
  cancel_confirmed_at: Date | null;
  closed_at: Date | null;
  dispute_by: string | null;
  total: number;
  still_open: number;
  last_closed: Date | null;
  attested: boolean;
}

const factsSql = (where: string, tail = ''): string => `
  select t.code, t.state, t.settling, t.paid_at, t.cancel_confirmed_at, t.closed_at, t.dispute_by,
         d.total, d.still_open, d.last_closed,
         exists (select 1 from trade_attestations a where a.code = t.code) as attested
    from trades t
    cross join lateral ${DISPUTE_FACTS_SQL('t')} d
   where ${where}
   ${tail}`;

function toFacts(r: FactRow): RetentionFacts {
  return {
    closedAt: r.closed_at,
    disputed: r.dispute_by !== null || r.total > 0,
    disputeOpen: r.state === 'disputed' || r.still_open > 0,
    disputeClosedAt: r.last_closed,
    refundDisputeWindowEndsAt: refundDisputeWindowEndsAt(r.state, r.closed_at),
    awaitingAction: awaitingCancelConfirm({
      state: r.state,
      settling: r.settling,
      cancelConfirmedAt: r.cancel_confirmed_at,
      dispute: r.dispute_by === null ? null : { by: 'system', at: new Date(0) },
      paidAt: r.paid_at,
    }),
    // The watch list serves an attested trade until WATCH_LIST_CLOSED_DAYS after it closed.
    watchEndsAt: r.attested && r.closed_at !== null ? new Date(r.closed_at.getTime() + WATCH_LIST_CLOSED_DAYS * DAY_MS) : null,
  };
}

/** Site maintenance is on (`site_flags.maintenance_since`); no site_flags row counts as on (fails closed). */
async function inMaintenance(q: Queryable): Promise<boolean> {
  const { rows } = await q.query<{ maintenance: boolean }>('select maintenance_since is not null as maintenance from site_flags');
  return rows.length === 0 || rows.some((r) => r.maintenance);
}

/** One trade's retention facts, or null for an unknown code. */
export async function retentionFacts(q: Queryable, code: string): Promise<RetentionFacts | null> {
  const { rows } = await q.query<FactRow>(factsSql('t.code = $1'), [code]);
  return rows[0] ? toFacts(rows[0]) : null;
}

/**
 * The trade's self-destruct date for its view (TradeView.deleteAt): null while it has none (open,
 * a dispute open, a cancel waiting) or for an unknown code. The date itself never moves for site
 * maintenance or the moderation watch; those only hold the delete back a little.
 */
export async function tradeSelfDestruct(q: Queryable, code: string): Promise<{ deleteAt: Date | null }> {
  const f = await retentionFacts(q, code);
  return { deleteAt: f === null ? null : tradeDeleteAt(f) };
}

/**
 * Deletes every trade that is due at `now`; returns how many. A trade whose delete fails rolls back
 * alone and the first error is thrown after the scan (the scheduler logs only that the job failed),
 * so one bad row never shields the rest.
 */
export async function purgeTrades(db: pg.Pool, now: Date): Promise<number> {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new RangeError('bad clock');
  if (await inMaintenance(db)) return 0;
  let removed = 0;
  let failed: unknown = null;
  let after: { closed: Date; code: string } | null = null;
  for (;;) {
    // Closed trades only, oldest close first (an open or disputed trade is never a candidate), and
    // only those closed more than TRADE_KEEP_DAYS ago: no trade is ever due sooner.
    const page: pg.QueryResult<FactRow & { closed_at: Date }> = await db.query<FactRow & { closed_at: Date }>(
      factsSql(
        `t.closed_at is not null and t.state <> 'disputed' and t.closed_at < $3
           and ($1::timestamptz is null or (t.closed_at, t.code) > ($1::timestamptz, $2::text))`,
        `order by t.closed_at, t.code limit ${BATCH}`,
      ),
      [after?.closed ?? null, after?.code ?? null, new Date(now.getTime() - TRADE_KEEP_DAYS * DAY_MS)],
    );
    const rows = page.rows;
    if (rows.length === 0) break;
    const last: FactRow & { closed_at: Date } = rows[rows.length - 1]!;
    after = { closed: last.closed_at, code: last.code };
    for (const r of rows) {
      if (!tradeDeleteDue(toFacts(r), now)) continue;
      try {
        if (await purgeOne(db, r.code, now)) removed++;
      } catch (e) {
        failed ??= e;
      }
    }
    if (rows.length < BATCH) break;
  }
  if (failed !== null) throw failed;
  return removed;
}

interface Counts {
  id: string;
  completed: string;
  sales: string;
  won: string;
  lost: string;
}

/** The figures a purged trade must leave as they were, by the readers' own SQL (alias `a`). */
async function countsOf(q: Queryable, ids: string[]): Promise<Map<string, Counts>> {
  const { rows } = await q.query<Counts>(
    `select a.id::text as id, ${COMPLETED_TRADES_SQL} as completed, ${FINAL_SALES_SQL} as sales,
            ${WON_DISPUTES_SQL} as won, ${LOST_DISPUTES_SQL} as lost
       from accounts a where a.id = any($1::uuid[])`,
    [ids],
  );
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Deletes one trade if it is still due under its lock; returns whether it was deleted. Lock order:
 * the trade, its disputes, its chat (the chat purge takes trade then chat too), then the two
 * accounts' totals rows by the upsert.
 */
async function purgeOne(db: pg.Pool, code: string, now: Date): Promise<boolean> {
  const client = await db.connect();
  try {
    await client.query('begin');
    try {
      // Locks first, under the API's role (FOR UPDATE needs rights x2f_purge does not have).
      const locked = await client.query<{ buyer: string; seller: string }>(
        'select buyer_account_id::text as buyer, seller_account_id::text as seller from trades where code = $1 for update',
        [code],
      );
      const trade = locked.rows[0];
      if (!trade) {
        await client.query('rollback');
        return false;
      }
      await client.query('select 1 from disputes where code = $1 for update', [code]);
      const chats = (await client.query<{ code: string }>('select code from chats where trade_code = $1 order by code for update', [code])).rows.map((r) => r.code);
      const facts = await retentionFacts(client, code);
      if ((await inMaintenance(client)) || facts === null || !tradeDeleteDue(facts, now)) {
        await client.query('rollback');
        return false;
      }
      const ids = [trade.buyer, trade.seller];
      const before = await countsOf(client, ids);

      const { rows: role } = await client.query<{ r: string }>(`select current_setting('role') as r`);
      // PURGE_ROLE is a compile-time constant: an SQL identifier, interpolated, not a bound parameter.
      await client.query(`set local role ${PURGE_ROLE}`);
      await detachReviews(client, code);
      await deleteDisputeRecords(client, code);
      for (const table of TRADE_CHILD_TABLES) {
        if (table === 'chats') {
          // The chat goes the way purgeChats deletes one: with its shred order for the moderation
          // service and each member's purged mark, in the same statement (123).
          if (chats.length > 0 && (await deleteChatRowsAsPurge(client, chats, now)) !== chats.length) throw new Error('trade purge: chat not deleted');
          continue;
        }
        // The table names are the constant list below, never input.
        await client.query(`delete from ${table} where code = $1`, [code]);
      }
      const gone = await client.query('delete from trades where code = $1', [code]);
      if (gone.rowCount !== 1) throw new Error('trade purge: trade row not deleted');
      // Back to the API's role for the running totals (x2f_purge deletes; it never writes a total).
      await client.query(`select set_config('role', $1, true)`, [role[0]!.r]);

      const afterCounts = await countsOf(client, ids);
      for (const id of ids) {
        const b = before.get(id);
        const a = afterCounts.get(id);
        if (!b || !a) throw new Error('trade purge: account missing');
        const d = (k: keyof Omit<Counts, 'id'>): number => {
          const n = Number(b[k]) - Number(a[k]);
          if (!Number.isSafeInteger(n) || n < 0) throw new Error('trade purge: a count rose');
          return n;
        };
        const delta = { completed: d('completed'), sales: d('sales'), won: d('won'), lost: d('lost') };
        if (delta.completed + delta.sales + delta.won + delta.lost === 0) continue;
        await client.query(
          `insert into account_traded_totals (account_id, purged_completed, purged_sales, purged_won, purged_lost)
           values ($1, $2, $3, $4, $5)
           on conflict (account_id) do update set
             purged_completed = account_traded_totals.purged_completed + excluded.purged_completed,
             purged_sales = account_traded_totals.purged_sales + excluded.purged_sales,
             purged_won = account_traded_totals.purged_won + excluded.purged_won,
             purged_lost = account_traded_totals.purged_lost + excluded.purged_lost`,
          [id, delta.completed, delta.sales, delta.won, delta.lost],
        );
      }
      await client.query('commit');
      return true;
    } catch (e) {
      await client.query('rollback');
      throw e;
    }
  } finally {
    client.release();
  }
}

/**
 * Everything else with a foreign key to trades(code) and no cascade (103, 106, 111), deleted after
 * the reviews are detached and the dispute records are gone, and before the trade row. The chat
 * (106, `trade_code`) is deleted with its shred order and marks. test/tradePurge.test.ts holds this
 * list, with DISPUTE_CHILD_TABLES, to the live schema.
 */
export const TRADE_CHILD_TABLES = ['chats', 'trade_identities', 'trade_attestations', 'trade_refusals', 'trade_work_served', 'trade_events'] as const;

/** The retention job (Plan 7 Task 2), after purgeChats on the one scheduler. */
export const purgeTradesJob: RetentionJob = { name: 'purgeTrades', run: (db, now) => purgeTrades(db, now) };
