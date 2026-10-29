import type { EventBus } from './bus.js';
import type { PushKind } from '../push/send.js';

/** What `recordFinalAlert` needs; the built app (`app.events`, `app.push`) satisfies it. */
export interface FinalAlertDeps {
  events: Pick<EventBus, 'publish'>;
  push: { send(accountId: string, kind: PushKind): Promise<boolean> };
}

/**
 * The buyer's final alert on `request-refund` (P3-I13, spec 2.3): publishes the trade's new state
 * to the buyer's open streams and sends the generic trade push. Returns whether either was handed
 * on (a stream written to, or a push service answered 201). That is NOT proof the buyer saw it,
 * and is never stored: only the buyer's seen-receipt (`POST /v1/trades/:code/final-alert-seen`, from
 * Task 25's FinalAlert while the alert is on screen) sets
 * `trades.final_alert_delivered = true`. Called by `tradeEventPublisher` after the event commits.
 */
export async function recordFinalAlert(deps: FinalAlertDeps, tradeCode: string, buyerAccountId: string): Promise<boolean> {
  const streamed = deps.events.publish(buyerAccountId, { type: 'trade', code: tradeCode, state: 'refund_requested' }) > 0;
  const pushed = await deps.push.send(buyerAccountId, 'trade');
  return streamed || pushed;
}
