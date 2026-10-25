// Tripwires for Task 23's seams: each fails the day the piece it waits for lands on this branch,
// and says what to change. None of them is a bug in Task 23; they keep a stand-in from outliving
// the real thing.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const has = (p: string) => existsSync(`${SRC}${p}`);

describe('Task 23 tripwires', () => {
  it('registered in TradeRoom once Task 22 merges', () => {
    // Task 22 (wip/lead-p3-task22) owns TradeRoom.tsx and the slot registry.
    if (!has('screens/trade/TradeRoom.tsx')) return;
    const screens = has('screens/trade/screens.ts') ? readFileSync(`${SRC}screens/trade/screens.ts`, 'utf8') : '';
    const buyerPay = readFileSync(`${SRC}screens/trade/BuyerPay.tsx`, 'utf8');
    const types = readFileSync(`${SRC}screens/trade/payTypes.ts`, 'utf8');
    const problems: string[] = [];
    if (!/^import '\.\/BuyerPay\.js';$/m.test(screens)) problems.push("screens/trade/screens.ts: put `import './BuyerPay.js';` on Task 23's reserved line");
    if (!/registerTradeScreen\(/.test(buyerPay)) problems.push('BuyerPay.tsx: call registerTradeScreen(slot) for each of TASK23_SLOTS at module top level');
    if (/^export interface TradeView\b/m.test(types)) {
      problems.push("payTypes.ts: replace the copied types with re-exports from '../../api/trade.js', './TradeRoom.js' and './seams.js'");
    }
    if (!existsSync(fileURLToPath(new URL('../e2e/pay.spec.ts', import.meta.url)))) {
      problems.push('e2e: move pay.harness.ts to pay.spec.ts against /trade/:code (the room) and drop the fixtures harness route');
    }
    expect(problems, 'Task 22 merged: wire Task 23 into the trade room').toEqual([]);
  });

  it("Task 12's escrow runtime exposes the moderator's ack of trade.paid", () => {
    // Task 12 (wip/second-p3-t12) EscrowStatus has no ack field yet, so "Marked as paid" waits for
    // `setPaidAckSource` (paySeams.ts). Once Task 12 merges, install a source from its status.
    if (!has('escrow/useEscrow.ts')) return;
    const app = [has('App.tsx') ? readFileSync(`${SRC}App.tsx`, 'utf8') : '', has('main.tsx') ? readFileSync(`${SRC}main.tsx`, 'utf8') : ''].join('\n');
    expect(app.includes('setPaidAckSource'), 'Task 12 merged: install setPaidAckSource from the escrow status (trade.ack of trade.paid)').toBe(true);
  });

  it("Task 20's ChatPanel is installed as the trade chat", () => {
    if (!has('chat/ChatPanel.tsx')) return;
    const app = [has('App.tsx') ? readFileSync(`${SRC}App.tsx`, 'utf8') : '', has('main.tsx') ? readFileSync(`${SRC}main.tsx`, 'utf8') : ''].join('\n');
    expect(app.includes('setTradeChat'), 'Task 20 merged: setTradeChat(ChatPanel) in the app shell').toBe(true);
  });

  it('the trade view carries the method name (Tasks 3/6), so methodOf stops falling back to the id', () => {
    // The API's TradeView (Task 6) has methodId and Task 3's profile, which has no name. When it
    // gains one, read it in methodOf (paySeams.ts) and drop the fallback.
    const view = fileURLToPath(new URL('../../api/src/trades/view.ts', import.meta.url));
    const src = readFileSync(view, 'utf8');
    if (!/\bmethodName\b|\bmethod: \{/.test(src)) return;
    const seams = readFileSync(`${SRC}screens/trade/paySeams.ts`, 'utf8');
    expect(seams.includes('view.methodName') || seams.includes('view.method'), 'TradeView has the method name now: read it in methodOf').toBe(true);
  });
});
