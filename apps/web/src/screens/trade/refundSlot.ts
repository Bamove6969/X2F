/**
 * Task 25's side of the trade-room slot interface (Task 22, wip/lead-p3-task22
 * `apps/web/src/screens/trade/TradeRoom.tsx`, `seams.ts`, `apps/web/src/api/trade.ts`). Task 22
 * owns those files and builds in parallel, so the types below are the parts of its interface these
 * screens read, copied field for field. Task 22's `TradeView`, `TradeEscrow` and
 * `TradeScreenProps` are assignable to them, so SellerRefund and FinalAlert register as they are.
 *
 * The escrow side is no copy: `RefundEscrow` is Task 12's `UseEscrow` (on the line since
 * 2026-10-27), narrowed to what these screens use.
 *
 * TRIPWIRE (test/refund-tripwires.test.ts): once TradeRoom.tsx is on this branch, import the real
 * types instead of these copies, call `registerRefundScreens(registerTradeScreen)` at the top of
 * refundScreens.ts, and import refundScreens.js on the Task 25 line of `screens.ts`.
 */
import type { UserSignal } from '../../escrow/signals.js';
import type { UseEscrow } from '../../escrow/useEscrow.js';

export type Party = 'buyer' | 'seller';

/** Task 22's `TradeState` (packages/trade `TradeState`). */
export type TradeState =
  | 'setup'
  | 'funding'
  | 'securing'
  | 'secured'
  | 'paid'
  | 'refund_requested'
  | 'settling'
  | 'released'
  | 'refunded'
  | 'lapsed'
  | 'cancelled'
  | 'disputed';

/** The counterparty's PUBLIC names as the API sends them (FU-A): `displayName` after the rename, `username` (the public column) before. */
export interface PublicNames {
  displayName?: string;
  username?: string;
}

/** The fields of Task 22's `TradeView` (GET /v1/trades/:code, Task 6) that these screens read. */
export interface RefundView {
  code: string;
  role: Party;
  poster: Party;
  state: TradeState;
  counterparty: PublicNames;
  methodId: string;
  profile: unknown;
  amountAtomic: string;
  fiatCents: string;
  lockedRate: { currency: string; centsPerXmr: string };
  maxFiatCents: string;
  receivedAtomic: string;
  confirmations: number;
  releasable: boolean;
  extensions: number;
  cancelProposedBy: Party | null;
  settling: 'release' | 'mutual-cancel' | 'buyer-cancel' | 'auto-refund' | 'lapse-refund' | null;
  txHash: string | null;
  takenAt: string;
  setupBy: string | null;
  fundBy: string | null;
  fundingSeenAt: string | null;
  securedAt: string | null;
  payBy: string | null;
  paidAt: string | null;
  confirmBy: string | null;
  finalAlertAt: string | null;
  settleBy: string | null;
  pausedAt: string | null;
  closedAt: string | null;
  nextDeadline: string | null;
  serverNow: string;
}

/** The signals `UseEscrow.signal` takes (Task 12, escrow/signals.ts); these screens send `trade.extend` and `trade.refund-request`. */
export type RefundSignal = Exclude<UserSignal, 'trade.paid'>;

/**
 * The parts of Task 22's `TradeEscrow` (Task 12's `UseEscrow`, escrow/useEscrow.ts) these screens
 * use: `signal` and `buildRefund` (the runtime's `signal` and `build-refund` actions; the latter
 * settles `payoutsFor('auto-refund')`, builder seller, cosigner mod, once the view is
 * `refund_requested`), and `amountAtomic`, the trade amount this device accepts
 * (`EscrowStatus.amountAtomic`), shown in place of the API's amount when the device has one.
 */
export type RefundEscrow = Pick<UseEscrow, 'buildRefund' | 'signal' | 'amountAtomic'>;

/** Task 22's `TradeScreenProps`, narrowed to what these screens read. */
export interface RefundScreenProps {
  view: RefundView;
  escrow: RefundEscrow;
  refresh(): Promise<void>;
  serverClock(): Date;
  wide: boolean;
}

/** Task 22's `publicName`: the counterparty's public display name, never a login name. */
export function publicName(t: PublicNames): string {
  return t.displayName ?? t.username ?? '';
}

/**
 * The method's name and "What is this?" sentence for the trade header. The view carries only
 * `methodId` and Task 3's profile (which has `whatItIs` but no name), so the name falls back to
 * the id until the view or the room provides it (reported to the lead).
 */
export function methodOf(v: Pick<RefundView, 'methodId' | 'profile'>): { name: string; whatItIs: string } {
  const p = v.profile !== null && typeof v.profile === 'object' ? (v.profile as Record<string, unknown>) : {};
  const name = typeof p.name === 'string' && p.name !== '' ? p.name : v.methodId;
  const whatItIs = typeof p.whatItIs === 'string' ? p.whatItIs : '';
  return { name, whatItIs };
}
