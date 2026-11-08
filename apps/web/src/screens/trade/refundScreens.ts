/**
 * Task 25's trade-room slots (Task 22's slot interface, TradeRoom.tsx), registered at import
 * (screens.ts imports this file). Owner 8 Nov (p6-1, p9-2): the seller's cancel after the time to
 * pay starts the refund at once (`settling` as `auto-refund`); there is no final alert.
 * - seller × `secured`, guarded by `sellerRefundOpen` (past `payBy` by the server clock, unpaid,
 *   not paused): SellerRefund. Task 23's unguarded seller × `secured` waiting room shows otherwise.
 * - seller × `settling` and `refunded`, guarded by `isSellerCancel`: SellerRefund's refund in
 *   progress and refunded views (Task 24's settling slot is guarded to `release`, Task 39's to
 *   `buyer-cancel`).
 * - buyer × `settling`, guarded by `isSellerCancel`: SellerCancelled (Task 23's buyer × `settling`
 *   is guarded to the buyer's and the mutual cancel). The buyer × `refunded` is Task 27's.
 * None of these collides with another task's slot (TradeRoom.tsx's ownership list; a collision
 * throws at registration).
 */
import type { ReactNode } from 'react';
import { isSellerCancel, sellerRefundOpen } from './refundRules.js';
import type { Party, RefundScreenProps, RefundView, TradeState } from './refundSlot.js';
import { SellerCancelled } from './SellerCancelled.js';
import { SellerRefund } from './SellerRefund.js';
import { registerTradeScreen } from './TradeRoom.js';

/** Task 22's `TradeSlot`, with these screens' narrower props (assignable to it). */
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
  { owner: 'Task 25', role: 'seller', states: ['settling', 'refunded'], when: isSellerCancel, screen: SellerRefund },
  { owner: 'Task 25', role: 'buyer', states: ['settling'], when: isSellerCancel, screen: SellerCancelled },
];

/** Registers every Task 25 slot with Task 22's `registerTradeScreen`; returns a function that removes them. */
export function registerRefundScreens(register: (slot: RefundSlot) => () => void): () => void {
  const offs = REFUND_SLOTS.map((s) => register(s));
  return () => {
    for (const off of offs) off();
  };
}

registerRefundScreens(registerTradeScreen);
