/**
 * Task 25's trade-room slots (Task 22's slot interface; refundSlot.ts explains the copy):
 * - seller × `secured`, guarded by `sellerRefundOpen` (past `payBy` by the server clock, unpaid,
 *   not paused): SellerRefund. Task 23's unguarded seller × `secured` waiting room shows otherwise.
 * - seller × `refund_requested`: SellerRefund's "final alert sent" view (no other task owns it).
 * - buyer × `refund_requested`: FinalAlert.
 *
 * TRIPWIRE (test/refund-tripwires.test.ts): when TradeRoom.tsx lands, call
 * `registerRefundScreens(registerTradeScreen)` at the top level of this file and replace the
 * Task 25 comment in screens.ts with `import './refundScreens.js';`.
 */
import type { ReactNode } from 'react';
import { FinalAlert } from './FinalAlert.js';
import { sellerRefundOpen } from './refundRules.js';
import type { Party, RefundScreenProps, RefundView, TradeState } from './refundSlot.js';
import { SellerRefund } from './SellerRefund.js';

/** Task 22's `TradeSlot`, with these screens' narrower props. */
export interface RefundSlot {
  owner: string;
  role: Party | 'any';
  states: readonly TradeState[];
  when?: (view: RefundView, nowMs: number) => boolean;
  /** A function component (assignable to Task 22's `TradeScreen`, which a component class with narrower props is not). */
  screen: (props: RefundScreenProps) => ReactNode;
}

export const REFUND_SLOTS: readonly RefundSlot[] = [
  { owner: 'Task 25', role: 'seller', states: ['secured'], when: sellerRefundOpen, screen: SellerRefund },
  { owner: 'Task 25', role: 'seller', states: ['refund_requested'], screen: SellerRefund },
  { owner: 'Task 25', role: 'buyer', states: ['refund_requested'], screen: FinalAlert },
];

/** Registers every Task 25 slot with Task 22's `registerTradeScreen`; returns a function that removes them. */
export function registerRefundScreens(register: (slot: RefundSlot) => () => void): () => void {
  const offs = REFUND_SLOTS.map((s) => register(s));
  return () => {
    for (const off of offs) off();
  };
}
