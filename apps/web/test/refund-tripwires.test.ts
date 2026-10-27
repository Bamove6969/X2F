// TRIPWIRES for what Task 25's screens stand in for until the pieces they plug into are on the
// main line. (Task 12's escrow runtime is on the line since 2026-10-27 and was checked against
// refundFlow.ts: the runtime's `build-refund` needs the view to be `refund_requested`
// (`viewSupports('auto-refund')`) and settles `payoutsFor('auto-refund')` with builder seller and
// cosigner mod (escrow/policy.ts ROUTE), so the order request-refund → trade.refund-request →
// buildRefund is the one it expects; `RefundEscrow` is now Task 12's `UseEscrow` and the e2e
// harness runs the real `useEscrow` over a recorder client; its tripwire is retired.) Each
// tripwire below fails once its piece lands: then do what it says and delete it.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { REFUND_SLOTS, registerRefundScreens, type RefundSlot } from '../src/screens/trade/refundScreens.js';
import { sellerView } from '../e2e/harness/refundViews.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const has = (p: string): boolean => existsSync(ROOT + p);

describe('Task 25 stand-ins', () => {
  it('NEEDS_TASK_22: SellerRefund and FinalAlert are not registered in the trade room yet', () => {
    // When TradeRoom.tsx lands (wip/lead-p3-task22):
    // 1. refundSlot.ts: replace the copied types with Task 22's (`TradeView`, `TradeScreenProps`
    //    from api/trade.ts, seams.ts and TradeRoom.tsx; `publicName` from api/trade.ts; `RefundEscrow`
    //    is already Task 12's `UseEscrow`, which Task 22's `TradeEscrow` is).
    // 2. refundScreens.ts: add `registerRefundScreens(registerTradeScreen);` at top level.
    // 3. screens.ts: replace `// Task 25: import './SellerRefund.js';` with `import './refundScreens.js';`.
    // 4. e2e/refund.spec.ts: drive /trade/:code instead of the harness, and run the 1280x800 parity.
    // 5. methodOf(): take the method's name from the room once the view or the room carries it.
    expect(has('apps/web/src/screens/trade/TradeRoom.tsx'), 'Task 22 landed: register the refund screens (see the steps above)').toBe(false);
  });

  it("NEEDS_TASK_23: FinalAlert's I've paid opens no sheet until PaidConfirmSheet is set", () => {
    // When Task 23's PaidConfirmSheet lands: `setFinalAlertPaidSheet(PaidConfirmSheet)` where the
    // room registers its screens (or have FinalAlert render it directly), and add an e2e step:
    // FinalAlert → I've paid → Yes, I've paid → `mark-paid` posted and the `trade.paid` signal sent.
    expect(has('apps/web/src/screens/trade/PaidConfirmSheet.tsx'), "Task 23 landed: wire PaidConfirmSheet into FinalAlert's I've paid").toBe(false);
  });

  it("NEEDS_TASK_19: the final-alert seen-receipt route is on Task 19's branch only", () => {
    // FinalAlert posts POST /v1/trades/:code/final-alert-seen (wip/lead-p3-task19
    // apps/api/src/trades/routes.ts). Once merged, confirm the path and the 204/409 answers.
    const routes = readFileSync(ROOT + 'apps/api/src/trades/routes.ts', 'utf8');
    expect(routes.includes('final-alert-seen'), 'Task 19 landed: check the seen-receipt route FinalAlert posts').toBe(false);
  });
});

describe('the slots Task 25 registers', () => {
  it('a guarded seller × secured slot, and both sides of refund_requested', () => {
    const got: RefundSlot[] = [];
    const off = registerRefundScreens((s) => {
      got.push(s);
      return () => got.splice(got.indexOf(s), 1);
    });
    expect(got.map((s) => [s.role, s.states.join(','), s.when ? 'guarded' : 'open'])).toEqual([
      ['seller', 'secured', 'guarded'],
      ['seller', 'refund_requested', 'open'],
      ['buyer', 'refund_requested', 'open'],
    ]);
    off();
    expect(got).toEqual([]);
  });

  it('the secured guard opens only past payBy by the server clock', () => {
    const guard = REFUND_SLOTS[0]!.when!;
    const v = sellerView();
    const payBy = Date.parse(v.payBy!);
    expect(guard(v, payBy)).toBe(false);
    expect(guard(v, payBy + 1)).toBe(true);
    expect(guard({ ...v, paidAt: v.payBy }, payBy + 1)).toBe(false);
  });
});
