import { TradeRuleError, UNLOCK_CONFIRMATIONS, awaitingCancelConfirm } from '@x2f/trade';
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
): Promise<boolean> {
  if (confirmations === null || confirmations < UNLOCK_CONFIRMATIONS) return false;
  const t = rowToTrade(row);
  if (!awaitingCancelConfirm(t) || t.cancelConfirmableAt !== null) return false;
  try {
    await applyEvent(deps, row.code, { type: 'return-confirmed', confirmations }, 'system');
    return true;
  } catch (err) {
    if (err instanceof TradeRuleError) return false;
    throw err;
  }
}

/**
 * One pass over the buyer's cancels waiting for the seller (refunded, `buyer-cancel`, not
 * confirmed, the moment not recorded yet): asks the node for each refund's confirmations and
 * records the moment for those that have them all. A failed lookup leaves that trade for the next
 * pass. Returns how many it recorded.
 */
export async function watchCancelReturns(deps: Pick<Deps, 'db' | 'clock'> & { publish?: TradePublisher }, lookup: TxConfirmations): Promise<number> {
  const { rows } = await deps.db.query<TradeRow>(
    `select * from trades where state = 'refunded' and settling = 'buyer-cancel' and cancel_confirmed_at is null
        and cancel_confirmable_at is null and dispute_by is null and tx_hash is not null`,
  );
  let n = 0;
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
