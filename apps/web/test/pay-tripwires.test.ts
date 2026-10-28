// Tripwires for Task 23's seams: each fails the day the piece it waits for lands on this branch,
// and says what to change. None of them is a bug in Task 23; they keep a stand-in from outliving
// the real thing.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const has = (p: string) => existsSync(`${SRC}${p}`);

describe('Task 23 tripwires', () => {
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
