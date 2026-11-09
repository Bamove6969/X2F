import { TradeRuleError, UNLOCK_CONFIRMATIONS, awaitingCancelConfirm, type Trade } from '@x2f/trade';
import type { Deps } from '../app.js';
import type { TxConfirmations } from './chain.js';
import { applyEvent, rowToTrade, type TradePublisher, type TradeRow } from './store.js';

/**
 * The seller's Confirm cancel becomes available once X2F's own node counts all the confirmations
 * of a buyer-cancel refund (owner 2026-10-29). This records that moment once (`return-confirmed`,
 * a system event): from it the trade closes as cancelled by itself 48 hours later (the machine's
 * tick, SELLER_CONFIRM_CANCEL_TIMEOUT_H), and the seller gets the trade push. Called with a count
 * already read (the confirmations route, Confirm cancel) and by `watchCancelReturns`. A race with
 * another recorder is a rule refusal and is ignored. Returns whether it recorded the moment.
 */
export async function recordReturnConfirmed(
  deps: Pick<Deps, 'db' | 'clock'> & { publish?: TradePublisher },
  row: TradeRow,
  confirmations: number | null,
  within?: Parameters<typeof applyEvent>[4],
): Promise<boolean> {
  if (confirmations === null || confirmations < UNLOCK_CONFIRMATIONS) return false;
  const t = rowToTrade(row);
  if (!awaitingCancelConfirm(t) || t.cancelConfirmableAt !== null) return false;
  try {
    // `within` runs in the record's own transaction before it commits (a team member's live check, Task 18 n2).
    await applyEvent(deps, row.code, { type: 'return-confirmed', confirmations }, 'system', within);
    return true;
  } catch (err) {
    if (err instanceof TradeRuleError) return false;
    throw err;
  }
}

/** How long the watch keeps asking about a refund (review M3): 10 confirmations take about 20 min. */
export const CANCEL_RETURN_MAX_WAIT_H = 24;
/** At most this many refunds per pass (oldest first); the rest wait for the next pass. */
export const CANCEL_RETURN_BATCH = 100;

const AWAITING = `state = 'refunded' and settling = 'buyer-cancel' and cancel_confirmed_at is null
        and cancel_confirmable_at is null and dispute_by is null and paid_at is null and tx_hash is not null`;

/**
 * One pass over the buyer's cancels waiting for the seller (refunded, `buyer-cancel`, not
 * confirmed, the moment not recorded yet): asks the node for each refund's confirmations and
 * records the moment for those that have them all. A failed lookup leaves that trade for the next
 * pass. Bounded (review M3): at most CANCEL_RETURN_BATCH per pass, and only refunds that settled
 * within CANCEL_RETURN_MAX_WAIT_H; one still not fully confirmed after that (the node never finds
 * the tx: dropped, reorged) is escalated to a moderator (`escalate`, the trade becomes `disputed`)
 * instead of being polled forever. Returns how many it recorded.
 *
 * The escalation (review round 2, N2 and N3) needs this pass's own lookup of that refund to have
 * succeeded and still come back short (null or under UNLOCK_CONFIRMATIONS): a node that is down,
 * busy or unreachable escalates nothing. Nothing is escalated during site maintenance
 * (`site_flags.maintenance_since`) or for a paused trade; a stale refund that turns out fully
 * confirmed is recorded as usual. Inside the escalation's transaction the locked trade must still
 * be waiting for the seller with the moment unrecorded and not paused, so a Confirm cancel or a
 * `return-confirmed` that commits after the SELECT wins (the escalate is then a rule refusal).
 */
export async function watchCancelReturns(deps: Pick<Deps, 'db' | 'clock'> & { publish?: TradePublisher }, lookup: TxConfirmations): Promise<number> {
  const cutoff = new Date(deps.clock().getTime() - CANCEL_RETURN_MAX_WAIT_H * 3_600_000);
  let n = 0;
  const flags = await deps.db.query<{ maintenance: boolean }>('select maintenance_since is not null as maintenance from site_flags');
  // The API does not start without exactly one site_flags row (assertOneSiteFlagsRow, review M1), so
  // a missing row reads as no maintenance here, as in every other maintenance reader.
  const maintenance = flags.rows[0]?.maintenance === true;
  if (!maintenance) {
    const stale = await deps.db.query<TradeRow>(
      `select * from trades where ${AWAITING} and paused_at is null and closed_at < $1 order by closed_at limit $2`,
      [cutoff, CANCEL_RETURN_BATCH],
    );
    for (const row of stale.rows) {
      let count: number | null;
      try {
        count = await lookup(row.tx_hash!);
      } catch {
        continue; // the node could not be asked: no evidence the refund is missing
      }
      if (count !== null && count >= UNLOCK_CONFIRMATIONS) {
        if (await recordReturnConfirmed(deps, row, count)) n++;
        continue;
      }
      try {
        await applyEvent(deps, row.code, { type: 'escalate' }, 'system', stillWaiting);
      } catch (err) {
        // A race (another pass, a Confirm cancel, the moment recorded, a pause) is a rule refusal.
        if (!(err instanceof TradeRuleError)) throw err;
      }
    }
  }
  const { rows } = await deps.db.query<TradeRow>(`select * from trades where ${AWAITING} and closed_at >= $1 order by closed_at limit $2`, [
    cutoff,
    CANCEL_RETURN_BATCH,
  ]);
  for (const row of rows) {
    let count: number | null = null;
    try {
      count = await lookup(row.tx_hash!);
    } catch {
      continue;
    }
    if (await recordReturnConfirmed(deps, row, count)) n++;
  }
  return n;
}

/** The escalation's in-transaction guard (review round 2, N2): the locked trade is still waiting. */
async function stillWaiting(_client: unknown, prev: Trade): Promise<void> {
  if (!awaitingCancelConfirm(prev) || prev.cancelConfirmableAt !== null || prev.pausedAt !== null) {
    throw new TradeRuleError('wrong-state');
  }
}

/** How often `startCancelReturnWatch` looks (the 48 hours start at most this late). */
export const CANCEL_RETURN_WATCH_MS = 60_000;

/** Runs `watchCancelReturns` every `everyMs` (unref'd; one pass at a time). Returns `stop`. */
export function startCancelReturnWatch(
  deps: Pick<Deps, 'db' | 'clock'> & { publish?: TradePublisher },
  lookup: TxConfirmations,
  onError: (err: unknown) => void,
  everyMs = CANCEL_RETURN_WATCH_MS,
): () => Promise<void> {
  let inFlight: Promise<unknown> | null = null;
  let stopped = false;
  const timer = setInterval(() => {
    if (inFlight || stopped) return;
    const p = watchCancelReturns(deps, lookup).catch(onError);
    inFlight = p;
    void p.finally(() => {
      if (inFlight === p) inFlight = null;
    });
  }, everyMs);
  timer.unref();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await inFlight;
  };
}
