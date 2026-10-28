// TRIPWIRES for what Task 25's screens stand in for until the pieces they plug into are on the
// main line. (Task 12's escrow runtime is on the line since 2026-10-27 and was checked against
// refundFlow.ts: the runtime's `build-refund` needs the view to be `refund_requested`
// (`viewSupports('auto-refund')`) and settles `payoutsFor('auto-refund')` with builder seller and
// cosigner mod (escrow/policy.ts ROUTE), so the order request-refund → trade.refund-request →
// buildRefund is the one it expects; `RefundEscrow` is now Task 12's `UseEscrow`; the e2e harness then
// ran the real `useEscrow` over a recorder client; its tripwire is retired.) Each
// tripwire below fails once its piece lands: then do what it says and delete it.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { REFUND_SLOTS, registerRefundScreens, type RefundSlot } from '../src/screens/trade/refundScreens.js';
import { buyerAlertView, sellerRequestedView, sellerView } from '../e2e/refundViews.js';
import { FinalAlert } from '../src/screens/trade/FinalAlert.js';
import { SellerRefund } from '../src/screens/trade/SellerRefund.js';
import { SellerWaiting } from '../src/screens/trade/BuyerPay.js';
import { screenFor } from '../src/screens/trade/TradeRoom.js';
import '../src/screens/trade/screens.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const has = (p: string): boolean => existsSync(ROOT + p);

describe('Task 25 stand-ins', () => {
  // NEEDS_TASK_22 retired 2026-10-27 (Task 22 landing): refundSlot.ts uses Task 22's types,
  // refundScreens.ts registers with registerTradeScreen at import, screens.ts imports it,
  // e2e/refund.spec.ts drives /trade/:code (with the 1280x800 parity), and methodOf is Task 22's.

  it("NEEDS_TASK_23: FinalAlert's I've paid opens no sheet until PaidConfirmSheet is set", () => {
    // When Task 23's PaidConfirmSheet lands: `setFinalAlertPaidSheet(PaidConfirmSheet)` where the
    // room registers its screens (or have FinalAlert render it directly), and add an e2e step:
    // FinalAlert → I've paid → Yes, I've paid → `mark-paid` posted and the `trade.paid` signal sent.
    expect(has('apps/web/src/screens/trade/PaidConfirmSheet.tsx'), "Task 23 landed: wire PaidConfirmSheet into FinalAlert's I've paid").toBe(false);
  });
  // NEEDS_TASK_19 retired 2026-10-27: POST /v1/trades/:code/final-alert-seen is on the line (204; 409
  // wrong-party / wrong-state, swallowed by FinalAlert and retried on the next visibility change).
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

describe("in Task 22's trade room (screens.ts)", () => {
  it('the room picks SellerRefund and FinalAlert; registering them collided with no other slot', () => {
    const v = sellerView();
    const after = Date.parse(v.payBy!) + 1;
    expect(screenFor(v, after)).toBe(SellerRefund);
    expect(screenFor(sellerRequestedView(), after)).toBe(SellerRefund);
    expect(screenFor(buyerAlertView(), after)).toBe(FinalAlert);
    // Before payBy the seller's secured slot is Task 23's waiting room.
    expect(screenFor(v, Date.parse(v.payBy!))).toBe(SellerWaiting);
  });
});
