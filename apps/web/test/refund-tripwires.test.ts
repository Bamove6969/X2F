// TRIPWIRES for what Task 25's screens stand in for until the pieces they plug into are on the
// main line. (Task 12's escrow runtime is on the line since 2026-10-27 and was checked against
// refundFlow.ts: the runtime's `build-refund` needs the view to be settling as `auto-refund`
// (`viewSupports('auto-refund')`, the seller's cancel, owner 8 Nov) and settles `payoutsFor('auto-refund')` with builder seller and
// cosigner mod (escrow/policy.ts ROUTE), so the order request-refund → trade.refund-request →
// buildRefund is the one it expects; `RefundEscrow` is now Task 12's `UseEscrow`; the e2e harness then
// ran the real `useEscrow` over a recorder client; its tripwire is retired.) Each
// tripwire below fails once its piece lands: then do what it says and delete it.
import { describe, expect, it } from 'vitest';
import { REFUND_SLOTS, registerRefundScreens, type RefundSlot } from '../src/screens/trade/refundScreens.js';
import { buyerCancelledView, sellerRefundedView, sellerRequestedView, sellerView } from '../e2e/refundViews.js';
import { SellerCancelled } from '../src/screens/trade/SellerCancelled.js';
import { SellerRefund } from '../src/screens/trade/SellerRefund.js';
import { SellerWaiting } from '../src/screens/trade/BuyerPay.js';
import { screenFor } from '../src/screens/trade/TradeRoom.js';
import '../src/screens/trade/screens.js';

// Task 25 stand-ins: all retired.
// NEEDS_TASK_22 retired 2026-10-27 (Task 22 landing): refundSlot.ts uses Task 22's types,
// refundScreens.ts registers with registerTradeScreen at import, screens.ts imports it,
// e2e/refund.spec.ts drives /trade/:code (with the 1280x800 parity), and methodOf is Task 22's.

// NEEDS_TASK_23 and NEEDS_TASK_19 retired; FinalAlert and its seen-receipt are gone with the
// owner's 8 Nov reversal (no final alert: the seller's cancel starts the refund at once).

describe('the slots Task 25 registers', () => {
  it("a guarded seller × secured slot, and guarded slots for the seller's cancel on both sides", () => {
    const got: RefundSlot[] = [];
    const off = registerRefundScreens((s) => {
      got.push(s);
      return () => got.splice(got.indexOf(s), 1);
    });
    expect(got.map((s) => [s.role, s.states.join(','), s.when ? 'guarded' : 'open'])).toEqual([
      ['seller', 'secured', 'guarded'],
      ['seller', 'settling,refunded', 'guarded'],
      ['buyer', 'settling', 'guarded'],
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
    // No nudge needed (owner 8 Nov): the same with or without one.
    expect(guard({ ...v, sellerNudgedAt: null }, payBy + 1)).toBe(true);
  });

  it("the cancel guards open only for the seller's cancel (auto-refund), never another settlement", () => {
    for (const slot of REFUND_SLOTS.slice(1)) {
      expect(slot.when!(sellerRequestedView(), 0)).toBe(true);
      for (const settling of ['release', 'buyer-cancel', 'mutual-cancel', 'lapse-refund'] as const) expect(slot.when!(sellerRequestedView({ settling }), 0)).toBe(false);
    }
  });
});

describe("in Task 22's trade room (screens.ts)", () => {
  it('the room picks SellerRefund and SellerCancelled; registering them collided with no other slot', () => {
    const v = sellerView();
    const after = Date.parse(v.payBy!) + 1;
    expect(screenFor(v, after)).toBe(SellerRefund);
    expect(screenFor(sellerRequestedView(), after)).toBe(SellerRefund);
    expect(screenFor(sellerRefundedView(), after)).toBe(SellerRefund);
    expect(screenFor(buyerCancelledView(), after)).toBe(SellerCancelled);
    // Before payBy the seller's secured slot is Task 23's waiting room.
    expect(screenFor(v, Date.parse(v.payBy!))).toBe(SellerWaiting);
  });
});
