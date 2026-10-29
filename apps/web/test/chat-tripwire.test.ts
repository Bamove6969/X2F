// TRIPWIRE for Task 20's wiring into a room that is not merged yet. The chat API, the device store,
// the attestation check and ChatPanel are built (apps/web/src/chat/); Task 23's wide room and
// phone Chat sheet take the panel through their own seam. The check fails once that seam lands:
// then install the panel and delete it.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const has = (p: string): boolean => existsSync(ROOT + p);

describe('Task 20 wiring still waits for Task 23', () => {
  it("NEEDS_TASK_23_CHAT: Task 23's setTradeChat seam (screens/trade/paySeams.ts) is not on this branch", () => {
    // Then: call setTradeChat(TradeChatPanel) once at start-up (TradeChatPanel already takes
    // Task 23's TradeChatProps `{ code, name }`), so BuyerPay's sheet and the wide room's aside show
    // the trade's chat; SellerRefund's `#chat` link keeps working through TradeRoom's #chat section.
    expect(has('apps/web/src/screens/trade/paySeams.ts'), "Task 23 landed: install TradeChatPanel with setTradeChat").toBe(false);
  });
});
