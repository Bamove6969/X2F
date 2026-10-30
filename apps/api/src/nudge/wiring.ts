import { normalizeTradeCode } from '@x2f/core';
import type { Queryable } from '../db/pool.js';
import type { NudgeWiring } from './routes.js';

/**
 * Task 6: the two accounts are the buyer and the seller of the trade `context` names, and it has
 * not closed. A trade stays open while disputed, and lapsed with funds still in the escrow
 * (`closed_at` is null), so a nudge can still wake the other side then. Any spelling the trade
 * code normaliser accepts (lower case, no hyphens) names the same trade. Answers `'open-trade'`,
 * so a block between the two does not drop the nudge (Task 37 review N1).
 */
export function tradeSharedContext(db: Queryable): NudgeWiring['hasSharedContext'] {
  return async (fromId, toId, context) => {
    const code = normalizeTradeCode(context);
    if (code === null) return false;
    const { rows } = await db.query(
      `select 1 from trades
        where code = $1 and closed_at is null
          and ((seller_account_id = $2 and buyer_account_id = $3) or (seller_account_id = $3 and buyer_account_id = $2))`,
      [code, fromId, toId],
    );
    return rows.length > 0 ? 'open-trade' : false;
  };
}

/**
 * Stand-in for what is not merged yet (tripwire in test/nudge.test.ts): Task 20 (open chats), so
 * a chat code is not yet a shared context. Delivery is Task 19's real SSE bus and Web Push
 * (`liveDelivery` in routes.ts), used whenever `publish` / `sendPush` are left out, as here.
 */
export const pendingNudgeWiring: NudgeWiring = {
  hasSharedContext: async () => false,
};

/** What main.ts uses: real trades (Task 6) and real delivery (Task 19); chats (Task 20) still pending. */
export function productionNudgeWiring(db: Queryable): NudgeWiring {
  return { ...pendingNudgeWiring, hasSharedContext: tradeSharedContext(db) };
}
