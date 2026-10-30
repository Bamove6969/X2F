import { awaitingCancelConfirm, refundDisputeWindowEndsAt, tradeDeleteAt, tradeDeleteDue, type RetentionFacts, type Trade } from '@x2f/trade';
import type pg from 'pg';
import type { Queryable } from '../db/pool.js';
import type { RetentionJob } from '../retention.js';
import { COMPLETED_TRADE_SQL } from '../traders/stage.js';
import { PURGE_ROLE } from '../trades/purge.js';

/**
 * Plan 7 Task 2: the whole-trade purge (owner 2026-10-29, R36). Every trade whose
 * `tradeDeleteDue` (@x2f/trade) has come is deleted whole, one trade per transaction, as
 * `x2f_purge`: its dispute records, identities, attestation, refusal, moderation work row, chat
 * (once Plan 3 Task 20's `chats` exists), events and the trade row itself. Nothing is kept per
 * trade. Before the delete, in the same transaction, the trade's completed-trade count moves to
 * both accounts (`accounts.completed_trades_purged`), so a profile and a starter-limit stage are
 * the same before and after.
 *
 * Safe under concurrency: each trade is locked (`for update`, as every state change through
 * `applyEvent` does) and its facts are read AGAIN under that lock with the same clock, so a dispute
 * opened, an appeal filed or a trade re-escalated since the scan keeps it. An active trade is never
 * deleted: the rule refuses any trade without `closedAt` or with an open dispute.
 *
 * Logs nothing (the scheduler logs the job name and a count only).
 *
 * Plan 3 Task 38: a buyer-cancel refund still waiting for the seller's Confirm cancel
 * (`cancel_confirmed_at` null, @x2f/trade `awaitingCancelConfirm`) sets `awaitingAction`, so it is
 * never deleted while it waits.
 *
 * OFF unless `X2F_TRADE_PURGE=on` (`setTradePurge`, from config in main.ts): the job is registered
 * but deletes nothing (lead decision 2026-10-30). It goes default-on only once the seams below land.
 *
 * SEAMS still owed before this job may go live in production (Plan 7 "Dependencies"; tripwires in
 * apps/api/test/tradePurge-tripwires.test.ts):
 * - Plan 4 Task 32 revenue ledger and Plan 7 Task 14 `collectDailyStats`: both must hold the
 *   trade before it goes (the ledger counts released trades and settled disputes, never cancels).
 * - Plan 5 Task 20 running totals (won/lost disputes and the rest) replace `completed_trades_purged`.
 * - Plan 5 reviews: null the trade code on the trade's reviews (reviews are permanent).
 * - Plan 5 Task 14 `trade_proofs`: delete the trade's proofs here.
 * - Plan 4 must move a dispute to `final` or `closed` (or leave `ruled` with a lapsed appeal
 *   window); until then a disputed trade is kept (fail-safe, never early).
 */

/** Trades read per scan page. */
const BATCH = 200;

interface FactRow {
  code: string;
  state: string;
  settling: Trade['settling'];
  paid_at: Date | null;
  cancel_confirmed_at: Date | null;
  closed_at: Date | null;
  dispute_at: Date | null;
  dispute_opened_at: Date | null;
  dispute_pending: boolean;
}

/**
 * The retention facts of the trades matching `where` (alias `t`), as of `$1` (now). A dispute is
 * pending while it is open, appealed, or ruled with its round-1 appeal window not yet over (or no
 * ruling row to say so); `final` and `closed` are done. The trade's own `dispute_at` stands in for
 * a dispute whose rows are missing.
 */
const factsSql = (where: string, tail = ''): string => `
  select t.code, t.state, t.settling, t.paid_at, t.cancel_confirmed_at, t.closed_at, t.dispute_at,
         greatest(t.dispute_at, (select max(d.opened_at) from disputes d where d.code = t.code)) as dispute_opened_at,
         exists (
           select 1 from disputes d
            where d.code = t.code
              and (d.status in ('open', 'appealed')
                or (d.status = 'ruled' and not exists (
                      select 1 from dispute_rulings r
                       where r.code = d.code and r.seq = d.seq and r.round = 1 and r.appeal_until < $1)))
         ) as dispute_pending
    from trades t
   where ${where}
   ${tail}`;

function toFacts(r: FactRow): RetentionFacts {
  const disputed = r.dispute_opened_at !== null;
  return {
    closedAt: r.closed_at,
    disputeOpenedAt: r.dispute_opened_at,
    disputeClosed: r.state !== 'disputed' && !r.dispute_pending,
    refundDisputeWindowEndsAt: refundDisputeWindowEndsAt(r.state, r.closed_at, disputed),
    // Task 38: a buyer's cancel the seller has not confirmed yet is still in their active trades.
    awaitingAction: awaitingCancelConfirm({
      state: r.state as Trade['state'],
      settling: r.settling,
      cancelConfirmedAt: r.cancel_confirmed_at,
      dispute: r.dispute_at === null ? null : { by: 'system', at: r.dispute_at },
      paidAt: r.paid_at,
    }),
  };
}

/** One trade's retention facts as of `now`, or null for an unknown code. */
export async function retentionFacts(q: Queryable, code: string, now: Date): Promise<RetentionFacts | null> {
  const { rows } = await q.query<FactRow>(factsSql('t.code = $2'), [now, code]);
  return rows[0] ? toFacts(rows[0]) : null;
}

/** When the trade self-destructs as of `now` (TradeView.deleteAt), or null while it is kept with no date. */
export async function tradeDeleteDate(q: Queryable, code: string, now: Date): Promise<Date | null> {
  const f = await retentionFacts(q, code, now);
  return f === null ? null : tradeDeleteAt(f);
}

/**
 * Deletes every trade that is due at `now`. Returns the number of trades deleted. A trade whose
 * delete fails rolls back alone and the error is thrown after the scan (the scheduler logs only
 * that the job failed), so one bad row never shields the rest.
 */
export async function purgeTrades(db: pg.Pool, now: Date): Promise<number> {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new RangeError('bad clock');
  let removed = 0;
  let failed: unknown = null;
  let after: { closed: Date; code: string } | null = null;
  for (;;) {
    // Ended trades only (an open or disputed trade is never a candidate), oldest end first.
    const page: pg.QueryResult<FactRow & { closed_at: Date }> = await db.query<FactRow & { closed_at: Date }>(
      factsSql(
        `t.closed_at is not null and t.state <> 'disputed'
           and ($2::timestamptz is null or (t.closed_at, t.code) > ($2::timestamptz, $3::text))`,
        `order by t.closed_at, t.code limit ${BATCH}`,
      ),
      [now, after?.closed ?? null, after?.code ?? null],
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

/** Deletes one trade if it is still due under its lock. Returns whether it was deleted. */
async function purgeOne(db: pg.Pool, code: string, now: Date): Promise<boolean> {
  const client = await db.connect();
  try {
    await client.query('begin');
    try {
      // Locks first, as the API's role: the trade (as applyEvent does), then its disputes.
      const locked = await client.query<{ buyer_account_id: string; seller_account_id: string; completed: boolean }>(
        `select buyer_account_id, seller_account_id, ${COMPLETED_TRADE_SQL('t')} as completed from trades t where code = $1 for update`,
        [code],
      );
      const trade = locked.rows[0];
      if (!trade) {
        await client.query('rollback');
        return false;
      }
      await client.query('select 1 from disputes where code = $1 for update', [code]);
      const facts = await retentionFacts(client, code, now);
      if (facts === null || !tradeDeleteDue(facts, now)) {
        await client.query('rollback');
        return false;
      }
      await client.query(`set local role ${PURGE_ROLE}`);
      if (trade.completed) {
        await client.query('update accounts set completed_trades_purged = completed_trades_purged + 1 where id = any($1::uuid[])', [
          [trade.buyer_account_id, trade.seller_account_id],
        ]);
      }
      for (const sql of await deleteOrder(client)) await client.query(sql, [code]);
      const gone = await client.query('delete from trades where code = $1', [code]);
      if (gone.rowCount !== 1) throw new Error('trade purge: trade row not deleted');
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
 * Everything hanging from a trade, deleted before the trade row in this order (108 and 111 keep no
 * cascade). `TRADE_CHILD_TABLES` names each table with a foreign key to trades(code); the test
 * holds it to the live schema.
 */
export const TRADE_CHILD_TABLES = [
  'dispute_appeals',
  'dispute_rulings',
  'disputes',
  'trade_identities',
  'trade_attestations',
  'trade_refusals',
  'trade_work_served',
  'chats',
  'trade_events',
] as const;

const DELETE_SQL: Record<(typeof TRADE_CHILD_TABLES)[number], string> = {
  dispute_appeals: 'delete from dispute_appeals where code = $1',
  dispute_rulings: 'delete from dispute_rulings where code = $1',
  disputes: 'delete from disputes where code = $1',
  trade_identities: 'delete from trade_identities where code = $1',
  trade_attestations: 'delete from trade_attestations where code = $1',
  trade_refusals: 'delete from trade_refusals where code = $1',
  trade_work_served: 'delete from trade_work_served where code = $1',
  // Plan 3 Task 20 (106_chat.sql, wip/second-p3-task20-rest): the chat linked to the trade; its
  // identities, attestation, refusal, work row and envelopes go by 106's cascade. 106 grants
  // x2f_purge select and delete on all of them.
  chats: 'delete from chats where trade_code = $1',
  trade_events: 'delete from trade_events where code = $1',
};

/** The delete statements in order, leaving out a table this database does not have yet (`chats` before Task 20). */
async function deleteOrder(q: Queryable): Promise<string[]> {
  const { rows } = await q.query<{ name: string }>(
    `select c.relname as name from pg_class c where c.relkind = 'r' and c.relname = any($1) and pg_table_is_visible(c.oid)`,
    [[...TRADE_CHILD_TABLES]],
  );
  const present = new Set(rows.map((r) => r.name));
  return TRADE_CHILD_TABLES.filter((t) => present.has(t)).map((t) => DELETE_SQL[t]);
}

let purgeOn = false;

/** Turns the whole-trade purge on or off for this process (`X2F_TRADE_PURGE`, config.tradePurge). */
export function setTradePurge(on: boolean): void {
  purgeOn = on;
}

/** The retention job: deletes nothing (and touches no row) unless `setTradePurge(true)`. */
export const purgeTradesJob: RetentionJob = { name: 'purgeTrades', run: (db, now) => (purgeOn ? purgeTrades(db, now) : Promise.resolve(0)) };
