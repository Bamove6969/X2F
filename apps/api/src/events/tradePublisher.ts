import type { By, Trade, TradeEvent } from '@x2f/trade';
import type { TradePublisher } from '../trades/store.js';
import type { EventBus } from './bus.js';
import { recordFinalAlert, type FinalAlertDeps } from './finalAlert.js';

export interface TradePublisherDeps extends FinalAlertDeps {
  events: Pick<EventBus, 'publish'>;
}

/**
 * Task 19's delivery of a committed trade event (the store's `publish` hook):
 * - `request-refund`: the buyer's final alert (`recordFinalAlert`); the seller gets the live event.
 *   Nothing is stored here: only the buyer's seen-receipt sets `trades.final_alert_delivered`.
 * - any other event: `{type:'trade', code, state}` to both sides' open streams, and the generic
 *   trade push to each side that did not cause it and has no stream open.
 */
export function tradeEventPublisher(deps: TradePublisherDeps): TradePublisher {
  return async (t: Trade, e: TradeEvent, by: By) => {
    const ev = { type: 'trade' as const, code: t.code, state: t.state };
    if (e.type === 'return-confirmed') {
      // Task 39: the seller's Confirm cancel is available; the owner's own notification text
      // ("Your input is needed to cancel this trade.") goes to the seller when no stream is open.
      deps.events.publish(t.buyerId, ev);
      if (deps.events.publish(t.sellerId, ev) === 0) await deps.push.send(t.sellerId, 'cancel-confirm');
      return;
    }
    if (e.type === 'request-refund') {
      deps.events.publish(t.sellerId, ev);
      await recordFinalAlert(deps, t.code, t.buyerId);
      return;
    }
    const sides: Array<['buyer' | 'seller', string]> = [['seller', t.sellerId], ['buyer', t.buyerId]];
    await Promise.all(
      sides.map(async ([side, id]) => {
        const streamed = deps.events.publish(id, ev) > 0;
        if (!streamed && side !== by) await deps.push.send(id, 'trade');
      }),
    );
  };
}
