/**
 * The trade room's seams to the escrow runtime and the live events.
 *
 * - Task 12 (browser escrow runtime, on the main line): `useTradeEscrow` is its
 *   `useEscrow(code, confirmed)` (apps/web/src/escrow/useEscrow.ts); the types are its own,
 *   re-exported from escrow/runtime.ts and escrow/policy.ts (as quote/confirmed.ts does).
 * - Task 19 (live events, on the main line): App.tsx's `LiveAccepted` fans its single
 *   `/v1/events` connection out to the room: it sets `liveFanOut.source` with `setLiveSource`
 *   and passes each `trade` event to `liveFanOut.emit`.
 *
 * Tests (and the board fixtures) install fakes with `setTradeEscrowHook` / `setLiveSource`.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { escrowPlan } from '@x2f/trade';
import type { Deal } from '../../escrow/policy.js';
import type { ConfirmedTrade, EscrowErrorCode, EscrowPhase, EscrowRefusal } from '../../escrow/runtime.js';
import type { UserSignal } from '../../escrow/signals.js';
import { useEscrow, type UseEscrow } from '../../escrow/useEscrow.js';

export type { ConfirmedTrade, Deal, EscrowErrorCode, EscrowPhase, EscrowRefusal, UserSignal };

/**
 * The room's one escrow handle per trade: Task 12's `UseEscrow`. TradeFund reads its funding
 * facts from it: `escrowAddress` (the only address ever shown or put in a `monero:` link or QR
 * code; the API's is only compared with it), `deal` (the funding amount is worked out from it,
 * never taken from the API), `receivedAtomic` (after a short payment the remainder comes from it,
 * never from the API's `receivedAtomic`, review 2026-10-27 I1) and `confirmedAtomic` (the only
 * device reading that may set the `funded` mark for good; a 0-conf tx can be dropped).
 * `confirmed` (`{ role, ownAddress, deal }`) is needed the first time a trade starts on a device
 * (else `not-confirmed`); the room passes `location.state.confirmed`, else the copy the quote or
 * the accept sheet stored (quote/confirmed.ts `readConfirmed`).
 */
export type TradeEscrow = UseEscrow;

/**
 * Integrity failures: the trade must not be funded or settled from this device (SetupStatus
 * danger). Besides the runtime's own codes, an API whose escrow address differs from the one this
 * device derived is one: a lying server must never steer the seller's coins.
 */
export function integrityFailed(e: Pick<TradeEscrow, 'error' | 'escrowAddress' | 'deal' | 'sellerLienRecoveryAtomic'>, view?: FundingFacts): boolean {
  if (e.error === 'participants-mismatch' || e.error === 'deal-mismatch') return true;
  const theirs = view?.funding?.escrowAddress ?? null;
  if (theirs !== null && e.escrowAddress !== null && theirs !== e.escrowAddress) return true;
  // The amount to fund must be a plain amount whatever this device knows yet (Minor 5), and,
  // once the device has its deal, exactly what it works out from that deal.
  if (view?.funding) {
    if (!/^[0-9]{1,30}$/.test(view.funding.sellerFundsAtomic)) return true;
    if (e.deal) {
      const mine = expectedFundsAtomic(e.deal, e.sellerLienRecoveryAtomic ?? 0n);
      if (mine === null || view.poster !== e.deal.poster || BigInt(view.funding.sellerFundsAtomic) !== mine) return true;
    }
  }
  return false;
}

/** The view facts the funding checks read. */
export interface FundingFacts {
  poster: 'seller' | 'buyer';
  funding: { escrowAddress: string | null; sellerFundsAtomic: string } | null;
}

/**
 * What the seller must fund, from this device's own deal (@x2f/trade escrowPlan: the amount at
 * take, plus the 1% fee when the seller posted the ad, plus the seller's own lien recovery: the
 * extra this device accepted, docs/lien-recovery.md "Debtor is the seller"). Before funding the
 * trade cannot have grown (growth needs releasable coins, plan Revision 2026-10-21), so this is
 * the whole amount. Null for a deal escrowPlan refuses.
 */
export function expectedFundsAtomic(deal: { poster: 'seller' | 'buyer'; takeAmountAtomic: bigint }, sellerLienRecoveryAtomic = 0n): bigint | null {
  try {
    return escrowPlan({ amountAtomic: deal.takeAmountAtomic, poster: deal.poster, sellerLienRecoveryAtomic }).sellerFundsAtomic;
  } catch {
    return null;
  }
}

/**
 * The funding this device verified and may show, or null: only once the runtime is ready with
 * check words, its own derived address and its own deal, with no error, and only when the API's
 * address and amount are exactly the device's. The address and amount returned are the device's.
 */
export function verifiedFunding(e: TradeEscrow, view: FundingFacts): VerifiedFunding | null {
  if (e.phase !== 'ready' || e.error !== null || e.checkWords === null || e.escrowAddress === null || e.deal === null) return null;
  if (view.funding === null || integrityFailed(e, view)) return null;
  const fundsAtomic = expectedFundsAtomic(e.deal, e.sellerLienRecoveryAtomic ?? 0n);
  if (fundsAtomic === null || fundsAtomic <= 0n) return null;
  return { address: e.escrowAddress, fundsAtomic, receivedAtomic: e.receivedAtomic };
}

/** The device's address and amount to fund, and what the device itself has seen arrive (null without a reading). */
export interface VerifiedFunding {
  address: string;
  fundsAtomic: bigint;
  receivedAtomic: bigint | null;
}

/**
 * The amount the wallet link, QR code and "Copy amount" carry right now (review 2026-10-27, I1):
 * the whole funding while nothing has arrived; the remainder once THIS device has seen part of it;
 * and null, nothing with an amount at all, while the API reports a short payment this device has
 * not seen yet (or the device's reading already covers the funding). The API's figure only says
 * that the payment is short; the remainder is never computed from it.
 */
export function amountToSend(v: Pick<VerifiedFunding, 'fundsAtomic' | 'receivedAtomic'>, apiReceivedAtomic: bigint): bigint | null {
  const mine = v.receivedAtomic;
  // The API has seen more than this device: its reading lags, and a remainder from it would ask
  // for too much. Show the address only until the device catches up (re-review 2026-10-27).
  if (mine !== null && apiReceivedAtomic > mine) return null;
  if (mine !== null && mine > 0n) return mine < v.fundsAtomic ? v.fundsAtomic - mine : null;
  if (apiReceivedAtomic > 0n && apiReceivedAtomic < v.fundsAtomic) return null;
  return v.fundsAtomic;
}

const notYet = (): Promise<void> => Promise.reject(new Error('no escrow runtime in this fake'));

/** An idle handle with every action refused: the base for test fakes and the board fixtures. */
export const PENDING_ESCROW: TradeEscrow = {
  phase: 'idle',
  escrowAddress: null,
  deal: null,
  methodId: null,
  paymentInstructions: null,
  instructionsMismatch: false,
  receivedAtomic: null,
  confirmedAtomic: null,
  paidRecorded: false,
  intentKind: null,
  handedOff: false,
  amountAtomic: null,
  fiatCents: null,
  error: null,
  retryable: false,
  refusal: null,
  checkWords: null,
  keepOpen: false,
  release: notYet,
  buildRefund: notYet,
  buyerCancel: notYet,
  proposeCancelSign: notYet,
  markPaid: notYet,
  retry: () => undefined,
  signal: notYet,
};

export type TradeEscrowHook = (code: string, confirmed?: ConfirmedTrade) => TradeEscrow;

let escrowHook: TradeEscrowHook = useEscrow;

/** Replaces the hook the room calls once per trade (a test fake, or the board fixtures); null restores Task 12's `useEscrow`. Set it before the room mounts. */
export function setTradeEscrowHook(h: TradeEscrowHook | null): void {
  escrowHook = h ?? useEscrow;
}

/** The room's one escrow handle per trade (Task 12's `useEscrow`). Must be called unconditionally, like any hook. */
export function useTradeEscrow(code: string, confirmed?: ConfirmedTrade): TradeEscrow {
  return escrowHook(code, confirmed);
}

// ---- Task 19: live events ----

/** The `trade` live event (wip/lead-p3-task19 apps/web/src/api/events.ts `LiveEvent`). */
export interface TradeLiveEvent {
  type: 'trade';
  code: string;
  state: string;
}

/** Subscribes to live trade events; returns stop(). */
export type LiveSource = (onEvent: (e: TradeLiveEvent) => void) => () => void;

let liveSource: LiveSource | null = null;
const liveSubs = new Set<() => void>();

/** Sets the live source (Task 19's `connectEvents`, or a test fake); null removes it (the room then only polls). */
export function setLiveSource(s: LiveSource | null): void {
  liveSource = s;
  for (const cb of liveSubs) cb();
}

const fanOutListeners = new Set<(e: TradeLiveEvent) => void>();

/**
 * Task 19's single `/v1/events` connection, fanned out to the room. App.tsx's `LiveAccepted`
 * (mounted only for a trader) sets `liveFanOut.source` as the live source while it is mounted and
 * hands every `trade` event to `liveFanOut.emit`; the room never opens a second EventSource.
 */
export const liveFanOut: { source: LiveSource; emit(e: TradeLiveEvent): void } = {
  source(onEvent) {
    fanOutListeners.add(onEvent);
    return () => {
      fanOutListeners.delete(onEvent);
    };
  },
  emit(e) {
    for (const l of [...fanOutListeners]) l(e);
  },
};

/** How often the room re-reads the trade with no live event (and always, as a backstop). */
export const POLL_MS = 15_000;

/**
 * Calls `onChange` whenever a live event says this trade changed. Codes compare without dashes
 * and case (the relay and API normalise them the same way).
 */
export function useTradeLive(code: string, onChange: () => void): void {
  const cb = useRef(onChange);
  cb.current = onChange;
  const source = useSyncExternalStore(
    (notify) => {
      liveSubs.add(notify);
      return () => liveSubs.delete(notify);
    },
    () => liveSource,
  );
  useEffect(() => {
    if (!source) return;
    const want = norm(code);
    return source((e) => {
      if (e.type === 'trade' && norm(e.code) === want) cb.current();
    });
  }, [source, code]);
}

const norm = (c: string): string => c.replace(/-/g, '').toUpperCase();
