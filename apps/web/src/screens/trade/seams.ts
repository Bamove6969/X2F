/**
 * Seams for two pieces the trade room needs that are not merged yet. Each has a stand-in so the
 * room builds and runs now, and a tripwire in test/tradeRoom-tripwires.test.ts that fails the
 * day the real piece lands, naming the line to change.
 *
 * - Task 12 (browser escrow runtime, wip/second-p3-t12): `apps/web/src/escrow/useEscrow.ts`.
 *   `TradeEscrow` below copies its `UseEscrow` shape exactly; once merged, `useTradeEscrow`
 *   becomes `useEscrow` (and the copied types become re-exports).
 * - Task 19 (live events, wip/lead-p3-task19): `apps/web/src/api/events.ts`. Once merged,
 *   `useTradeLive` subscribes through its `useLiveEvents`.
 *
 * Tests (and the board fixtures) install fakes with `setTradeEscrowHook` / `setLiveSource`.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { escrowPlan } from '@x2f/trade';

// ---- Task 12: copied from wip/second-p3-t12 apps/web/src/escrow/runtime.ts (types only) ----

export type EscrowPhase = 'idle' | 'registering' | 'verifying' | 'setting-up' | 'ready' | 'signing' | 'done' | 'settled-without-device' | 'error';
export type EscrowErrorCode = 'participants-mismatch' | 'deal-mismatch' | 'not-confirmed' | 'escrow-failed' | 'unsupported-browser';
export type EscrowRefusal = 'amount-out-of-range' | 'amount-changed' | 'paid-amount-refused' | 'paid-amount-waiting' | 'amount-unknown' | 'attempts-exhausted' | 'view-mismatch';
export type UserSignal = 'trade.paid' | 'trade.cancel' | 'trade.extend' | 'trade.refund-request';

/** Task 12's `Deal` (wip/lead-p3-task12-fixes apps/web/src/escrow/policy.ts): what both sides sign in trade.terms, fixed at take. */
export interface ConfirmedDeal {
  poster: 'seller' | 'buyer';
  takeAmountAtomic: bigint;
  currency: string;
  centsPerXmr: bigint;
  maxFiatCents: bigint;
}

/**
 * Task 12's `ConfirmedTrade` (runtime.ts): what the user saw and confirmed on the take or accept
 * screen (Tasks 18/19), their role, their own address (buyer payout / seller refund) and the deal.
 * It is the only source of what this device signs; the first start of a trade on a device without
 * it fails with `not-confirmed` (runtime.ts:405-406). Tasks 18/19 navigate to `/trade/:code` with
 * `{ state: { confirmed } }` and the room passes it through (review 2026-10-27, I4; the tripwire
 * in test/tradeRoom-tripwires.test.ts watches their navigations). History state does not survive
 * opening the trade from a push notification, so those tasks should start the escrow, or persist
 * `confirmed` through Task 12's store, before navigating.
 */
export interface ConfirmedTrade {
  role: 'buyer' | 'seller';
  ownAddress: string;
  deal: ConfirmedDeal;
}

/**
 * `UseEscrow` from wip/second-p3-t12 apps/web/src/escrow/useEscrow.ts, field for field, plus
 * `escrowAddress` (see below), which Task 12 must add before it merges.
 */
export interface TradeEscrow {
  phase: EscrowPhase;
  /**
   * The multisig address THIS device derived (`party.ready()` in Task 12's runtime, the address
   * its check words are computed from), or null until then. The only address TradeFund ever shows
   * or puts in a `monero:` link or QR code; the API's `funding.escrowAddress` is only compared with
   * it. ADDITION to Task 12's UseEscrow (it is not in EscrowStatus yet); the tripwire in
   * test/tradeRoom-tripwires.test.ts names it.
   */
  escrowAddress: string | null;
  /**
   * The deal THIS device confirmed on the take or accept screen (Task 12's stored `Deal`: who
   * posted and the amount at take), or null until the runtime has it. The funding amount is
   * worked out from it, never taken from the API. ADDITION to Task 12's UseEscrow, like
   * `escrowAddress`.
   */
  deal: { poster: 'seller' | 'buyer'; takeAmountAtomic: bigint } | null;
  /**
   * What THIS device's escrow party has seen arrive at the escrow address (the `balance` Task 12's
   * runtime reads with `party.funds()` on every tick, confirmed or not), or null until it has a
   * reading. After a short payment the remainder the seller still sends is worked out from it,
   * never from the API's `receivedAtomic` (review 2026-10-27, I1): a full-amount link, QR code or
   * copy on top of a partial payment would overfund the escrow and grow the trade. ADDITION to
   * Task 12's EscrowStatus, like `escrowAddress`; the tripwire names it.
   */
  receivedAtomic: bigint | null;
  error: EscrowErrorCode | null;
  retryable: boolean;
  refusal: EscrowRefusal | null;
  checkWords: string[] | null;
  keepOpen: boolean;
  release(): Promise<void>;
  buildRefund(): Promise<void>;
  buyerCancel(): Promise<void>;
  proposeCancelSign(): Promise<void>;
  markPaid(fiatCents: bigint): Promise<void>;
  retry(): void;
  signal(type: Exclude<UserSignal, 'trade.paid'>): Promise<void>;
}

/**
 * Integrity failures: the trade must not be funded or settled from this device (SetupStatus
 * danger). Besides the runtime's own codes, an API whose escrow address differs from the one this
 * device derived is one: a lying server must never steer the seller's coins.
 */
export function integrityFailed(e: Pick<TradeEscrow, 'error' | 'escrowAddress' | 'deal'>, view?: FundingFacts): boolean {
  if (e.error === 'participants-mismatch' || e.error === 'deal-mismatch') return true;
  const theirs = view?.funding?.escrowAddress ?? null;
  if (theirs !== null && e.escrowAddress !== null && theirs !== e.escrowAddress) return true;
  // The amount to fund: the API's must be exactly what this device works out from its own deal.
  if (view?.funding && e.deal) {
    const mine = expectedFundsAtomic(e.deal);
    if (mine === null || view.poster !== e.deal.poster || !/^[0-9]{1,30}$/.test(view.funding.sellerFundsAtomic) || BigInt(view.funding.sellerFundsAtomic) !== mine) {
      return true;
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
 * take, plus the 1% fee when the seller posted the ad). Before funding the trade cannot have grown
 * (growth needs releasable coins, plan Revision 2026-10-21), so this is the whole amount. Null for
 * a deal escrowPlan refuses.
 */
export function expectedFundsAtomic(deal: { poster: 'seller' | 'buyer'; takeAmountAtomic: bigint }): bigint | null {
  try {
    return escrowPlan({ amountAtomic: deal.takeAmountAtomic, poster: deal.poster }).sellerFundsAtomic;
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
  const fundsAtomic = expectedFundsAtomic(e.deal);
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
  if (mine !== null && mine > 0n) return mine < v.fundsAtomic ? v.fundsAtomic - mine : null;
  if (apiReceivedAtomic > 0n && apiReceivedAtomic < v.fundsAtomic) return null;
  return v.fundsAtomic;
}

const notYet = (): Promise<void> => Promise.reject(new Error('escrow runtime not wired (Task 12)'));

/** The stand-in until Task 12 merges: idle, no check words, every action refused. */
export const PENDING_ESCROW: TradeEscrow = {
  phase: 'idle',
  escrowAddress: null,
  deal: null,
  receivedAtomic: null,
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

let escrowHook: TradeEscrowHook = () => PENDING_ESCROW;

/** Sets the hook the room calls once per trade (Task 12's `useEscrow`, or a test fake); null restores the stand-in. */
export function setTradeEscrowHook(h: TradeEscrowHook | null): void {
  escrowHook = h ?? (() => PENDING_ESCROW);
}

/** The room's one escrow handle per trade. Must be called unconditionally, like any hook. */
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
