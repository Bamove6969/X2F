import type pg from 'pg';
import type { RetentionJob } from '../retention.js';

/** A closed trade's payout and refund addresses are kept this long (P3-I12; spec 4.1). */
export const TRADE_ADDRESS_RETENTION_MS = 90 * 24 * 3_600_000;

/** The database role the purge runs as (104_trade_retention.sql). */
export const PURGE_ROLE = 'x2f_purge';

/**
 * Nulls `buyer_payout` and `seller_refund` on every trade closed more than 90 days ago, never on a
 * trade whose dispute is open (state `disputed`, which includes a closed trade escalated or
 * disputed after its refund). Runs as `x2f_purge`, which may update only those two columns and
 * only to null. Returns the number of trades changed.
 *
 * Strictly more. The buyer's dispute after a refund now closes 48 hours after it (owner
 * 2026-10-29, TIMERS.disputeAfterRefundHours; it was 90 days), so the addresses outlive that
 * window by far; Plan 7 may shorten this retention.
 */
export async function purgeTradeAddresses(db: pg.Pool, now: Date): Promise<number> {
  const client = await db.connect();
  try {
    await client.query('begin');
    try {
      // PURGE_ROLE must stay a compile-time constant: it is an SQL identifier, interpolated here, not a bound parameter.
      await client.query(`set local role ${PURGE_ROLE}`);
      const { rowCount } = await client.query(
        `update trades set buyer_payout = null, seller_refund = null
          where closed_at < $1 and state <> 'disputed' and (buyer_payout is not null or seller_refund is not null)`,
        [new Date(now.getTime() - TRADE_ADDRESS_RETENTION_MS)],
      );
      await client.query('commit');
      return rowCount ?? 0;
    } catch (e) {
      await client.query('rollback');
      throw e;
    }
  } finally {
    client.release();
  }
}

export const purgeTradeAddressesJob: RetentionJob = { name: 'purgeTradeAddresses', run: purgeTradeAddresses };
