/**
 * Task 23's view of the trade-room slot interface: Task 22's own types, re-exported (Task 22
 * landed: `api/trade.ts`, `TradeRoom.tsx`, `seams.ts`). The room's escrow handle is Task 12's
 * `UseEscrow`; Task 23's screens show only its device figures (`amountAtomic`, `fiatCents`,
 * `deal`) as the sum to pay, never the API's (review 2026-10-27, I1).
 */
export { publicName } from '../../api/trade.js';
export type { Party, TradeState, TradeView, TraderSummary } from '../../api/trade.js';
export type { EscrowErrorCode, EscrowPhase, EscrowRefusal, TradeEscrow, UserSignal } from './seams.js';
export type { TradeScreenProps } from './TradeRoom.js';
