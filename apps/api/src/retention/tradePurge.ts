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
import { deleteChatRowsAsPurge, LIEN_FACTS_SQL } from '../chat/retention.js';
import type { Queryable } from '../db/pool.js';
import { deleteDisputeRecords, DISPUTE_FACTS_SQL } from '../disputes/purge.js';
import { WATCH_LIST_CLOSED_DAYS } from '../internal/routes.js';
import type { RetentionJob } from '../retention.js';
import { detachReviews } from '../reviews/store.js';
import { finalSalesLiveSql } from '../traders/finalOutcome.js';
import { completedTradesLiveSql } from '../traders/stage.js';
import { lostDisputesLiveSql, wonDisputesLiveSql } from '../traders/summary.js';
import { PURGE_ROLE } from '../trades/purge.js';

/**
 * Plan 7 Task 2 (owner 2026-10-29, R36; Plan 4 Task 23 for the dispute half): the whole-trade
 * purge. Every trade whose `tradeDeleteDue` (@x2f/trade retention.ts) has come is deleted whole,
 * one trade per transaction: its reviews are detached (they are permanent), its chat (with the
 * shred order and purged marks purgeChats writes), its dispute records (disputes/purge.ts), its
 * identities, attestation, refusal, moderation work row, ruling statement and events, then the
 * trade row itself; the rows with `on delete cascade` (review skips, the totals' and the ledger's
 * per-trade marks, blur checks) go with it, and staff pay items lose the code (set null). Nothing
 * is kept per trade. Every delete runs as x2f_purge (`set local role`, 104 and 701). The trade row's
 * delete writes the trade's shred order for the moderation service in the same statement (761):
 * moderation destroys its own per-trade records (signed terms, keys, watch state) on its own checks,
 * then reports `trade-shredded`, which removes the order (internal/routes.ts).
 *
 * What it never deletes, whatever the date:
 * - an open trade (no `closed_at`), or one whose dispute or appeal is open (`tradeDeleteDue`);
 * - a trade still on the moderation watch list (attested and closed within WATCH_LIST_CLOSED_DAYS,
 *   internal/routes.ts): the moderation service watches its escrow for late coins that long, and a
 *   late-funds report needs the trade to escalate;
 * - a trade with an unpaid lien (owner 26 Nov 2026: no delete date until the lien is repaid, voided
 *   or written off as uncollectible, then DISPUTE_KEEP_DAYS more), through `tradeDeleteDue`;
 * - liens and owed fees (400), freezes (208), the revenue ledger (430) and the activity log (201):
 *   account or aggregate records with no foreign key to the trade, which x2f_purge may not delete;
 * - anything during site maintenance (no pass runs; the first pass after it catches up).
 *
 * Profiles and starter limits stay the same: before the delete, under the trade's lock and in one
 * repeatable-read snapshot, what THIS trade adds to the two accounts' completed trades (R38, the
 * stage), final sales (the count shown), won and lost disputes is read with the readers' own
 * predicates limited to its code, and added to `account_traded_totals.purged_*` (701), which those
 * readers add back. The dollar and XMR
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
  lien_open: boolean;
  lien_ended: Date | null;
}

const factsSql = (where: string, tail = ''): string => `
  select t.code, t.state, t.settling, t.paid_at, t.cancel_confirmed_at, t.closed_at, t.dispute_by,
         d.total, d.still_open, d.last_closed,
         exists (select 1 from trade_attestations a where a.code = t.code) as attested,
         ${LIEN_FACTS_SQL('t.code')}
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
    // Owner 26 Nov 2026: an unpaid lien keeps the trade with no delete date; an ended one, 90 days more.
    lienOpen: r.lien_open,
    lienEndedAt: r.lien_ended,
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

/**
 * What trade `code` itself adds to each account's figures, by the readers' own predicates limited
 * to that one trade (`and t.code = $2`; review round 1, I1). Read once, before the deletes: a
 * difference of two whole-account reads would also take in any other trade of the account that
 * changed in between and lose a count for good.
 */
async function shareOf(q: Queryable, ids: string[], code: string): Promise<Map<string, Counts>> {
  const only = 'and t.code = $2';
  const { rows } = await q.query<Counts>(
    `select a.id::text as id, ${completedTradesLiveSql(only)} as completed, ${finalSalesLiveSql(only)} as sales,
            ${wonDisputesLiveSql(only)} as won, ${lostDisputesLiveSql(only)} as lost
       from accounts a where a.id = any($1::uuid[])`,
    [ids, code],
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
    // Review round 1, I1: one snapshot for every read of this transaction (with its own deletes). A
    // trade changed by another transaction since the snapshot makes its FOR UPDATE fail with 40001;
    // it is then skipped and picked up on the next pass.
    await client.query('begin isolation level repeatable read');
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
      const share = await shareOf(client, ids, code);

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
      // The trade goes with its shred order for the moderation service, in one statement (761): no
      // trade is ever gone without it (moderation then destroys its own records on its own checks).
      const gone = await client.query<{ n: number }>(
        `with gone as (delete from trades where code = $1 returning code),
              ordered as (insert into trade_shred_orders (trade, purged_at) select code, $2 from gone on conflict (trade) do nothing)
         select count(*)::int as n from gone`,
        [code, now],
      );
      if (gone.rows[0]?.n !== 1) throw new Error('trade purge: trade row not deleted');
      // Back to the API's role for the running totals (x2f_purge deletes; it never writes a total).
      await client.query(`select set_config('role', $1, true)`, [role[0]!.r]);

      for (const id of ids) {
        const b = share.get(id);
        if (!b) throw new Error('trade purge: account missing');
        const d = (k: keyof Omit<Counts, 'id'>): number => {
          const n = Number(b[k]);
          if (!Number.isSafeInteger(n) || n < 0) throw new Error('trade purge: bad count');
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
      // Serialization failure under repeatable read: another transaction changed the trade first.
      if ((e as { code?: unknown } | null)?.code === '40001') return false;
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
