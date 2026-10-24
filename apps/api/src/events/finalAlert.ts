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
 *
 * TODO(Task 6): call this from `applyEvent` when a `request-refund` is applied (after commit),
 * store the result on the trade as `final_alert_delivered`, and report it to moderation (Task 10).
 */
export async function recordFinalAlert(deps: FinalAlertDeps, tradeCode: string, buyerAccountId: string): Promise<boolean> {
  const streamed = deps.events.publish(buyerAccountId, { type: 'trade', code: tradeCode, state: 'refund_requested' }) > 0;
  const pushed = await deps.push.send(buyerAccountId, 'trade');
  return streamed || pushed;
}
