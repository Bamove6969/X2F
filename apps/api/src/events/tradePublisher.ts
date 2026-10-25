import type { By, Trade, TradeEvent } from '@x2f/trade';
import type { Queryable } from '../db/pool.js';
import type { TradePublisher } from '../trades/store.js';
import type { EventBus } from './bus.js';
import { recordFinalAlert, type FinalAlertDeps } from './finalAlert.js';

export interface TradePublisherDeps extends FinalAlertDeps {
  db: Queryable;
  events: Pick<EventBus, 'publish' | 'delivered'>;
}

/**
 * Task 19's delivery of a committed trade event (the store's `publish` hook):
 * - `request-refund`: the buyer's final alert (`recordFinalAlert`), its result stored as
 *   `trades.final_alert_delivered` for moderation (Task 10); the seller gets the live event.
 * - any other event: `{type:'trade', code, state}` to both sides' open streams, and the generic
 *   trade push to each side that did not cause it and has no stream open.
 */
export function tradeEventPublisher(deps: TradePublisherDeps): TradePublisher {
  return async (t: Trade, e: TradeEvent, by: By) => {
    const ev = { type: 'trade' as const, code: t.code, state: t.state };
    if (e.type === 'request-refund') {
      deps.events.publish(t.sellerId, ev);
      const delivered = await recordFinalAlert(deps, t.code, t.buyerId);
      await deps.db.query('update trades set final_alert_delivered = $2 where code = $1', [t.code, delivered]);
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
