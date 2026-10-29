// TRIPWIRE (Plan 3 Task 5 / Task 20): a take reuses the pair's open pre-trade chat. Task 20's
// `linkChatToTrade(q, { offerId, buyerAccountId, sellerAccountId, tradeCode })` (apps/api/src/chat/routes.ts,
// on wip/second-p3-task20-rest) links it, and Task 5's take must call it inside its own transaction,
// right after insertTrade (apps/api/src/trades/take.ts). Task 20 is not on this tree yet. Checks the
// local tree only: it fails once Task 20's chat routes are here and the take does not call it yet;
// then add the call with a test and delete this file.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (p: string): string => (existsSync(ROOT + p) ? readFileSync(ROOT + p, 'utf8') : '');

describe('the take links the pre-trade chat', () => {
  it('NEEDS_TASK_20_LINK: take.ts calls linkChatToTrade once Task 20 provides it', () => {
    const provided = /export\s+async\s+function\s+linkChatToTrade\b/.test(read('apps/api/src/chat/routes.ts'));
    const called = /linkChatToTrade\(/.test(read('apps/api/src/trades/take.ts'));
    expect(!provided || called, 'Task 20 landed: call linkChatToTrade(c, ...) in the take transaction after insertTrade').toBe(true);
  });
});
