/**
 * Task 25's side of Task 22's trade-room slot interface (TradeRoom.tsx, seams.ts, api/trade.ts).
 * The view, the props and the names are Task 22's own; the screens take a narrower escrow than
 * the room's `TradeEscrow` (Task 12's `UseEscrow`), so their tests pass small fakes, and the room
 * hands them its whole handle.
 */
import type { Party, TradeState, TradeView } from '../../api/trade.js';
import type { UserSignal } from '../../escrow/signals.js';
import type { UseEscrow } from '../../escrow/useEscrow.js';
import type { TradeScreenProps } from './TradeRoom.js';

export type { Party, TradeState };
/**
 * The trade's payment method for the header (Task 22's, one copy): `profile.name` when the view
 * carries Task 3's catalog entry, else the method id (test/tradeRoom-tripwires.test.ts watches the
 * API wiring), and the profile's "What is this?" sentence.
 */
export { methodOf, publicName } from '../../api/trade.js';

/** Task 22's `TradeView` (GET /v1/trades/:code). */
export type RefundView = TradeView;

/** The signals `UseEscrow.signal` takes (Task 12, escrow/signals.ts); these screens send `trade.extend` and `trade.refund-request`. */
export type RefundSignal = Exclude<UserSignal, 'trade.paid'>;

/**
 * The parts of the room's escrow handle (Task 12's `UseEscrow`) these screens use: `signal` and
 * `buildRefund` (the runtime's `signal` and `build-refund` actions; the latter settles
 * `payoutsFor('auto-refund')`, builder seller, cosigner mod, once the view is settling as
 * `auto-refund`, the seller's cancel), and `amountAtomic`, the trade amount this device accepts
 * (`EscrowStatus.amountAtomic`), shown in place of the API's amount when the device has one.
 * `handedOff`, `phase`, `error`, `retryable` and `retry`: whether this device's part of the refund is done (the refund
 * view says to keep the page open until then; gap 4, 20 Nov).
 */
export type RefundEscrow = Pick<UseEscrow, 'buildRefund' | 'signal' | 'amountAtomic' | 'handedOff' | 'phase' | 'error' | 'retryable' | 'retry'>;

/** Task 22's `TradeScreenProps` with the narrower escrow. */
export type RefundScreenProps = Omit<TradeScreenProps, 'escrow'> & { escrow: RefundEscrow };
