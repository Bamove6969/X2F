import type { EventBus } from './bus.js';
import type { PushKind } from '../push/send.js';

/** What `recordFinalAlert` needs; the built app (`app.events`, `app.push`) satisfies it. */
export interface FinalAlertDeps {
  events: Pick<EventBus, 'publish'>;
  push: { send(accountId: string, kind: PushKind): Promise<boolean> };
}

/**
 * The buyer's final alert on `request-refund` (P3-I13, spec 2.3): publishes the trade's new state
 * to the buyer's open streams and sends the generic trade push. Returns
 * `final_alert_delivered = (a stream was open) || (a push service accepted the push)`, the proof
 * the moderation service needs before any auto-refund (Task 10); false means it escalates.
 * Called by `tradeEventPublisher` after a `request-refund` commits; the result is stored as
 * `trades.final_alert_delivered`. TODO(Task 10): report it to moderation.
 */
export async function recordFinalAlert(deps: FinalAlertDeps, tradeCode: string, buyerAccountId: string): Promise<boolean> {
  const streamed = deps.events.publish(buyerAccountId, { type: 'trade', code: tradeCode, state: 'refund_requested' }) > 0;
  const pushed = await deps.push.send(buyerAccountId, 'trade');
  return streamed || pushed;
}
