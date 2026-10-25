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

// ---- Task 12: copied from wip/second-p3-t12 apps/web/src/escrow/runtime.ts (types only) ----

export type EscrowPhase = 'idle' | 'registering' | 'verifying' | 'setting-up' | 'ready' | 'signing' | 'done' | 'settled-without-device' | 'error';
export type EscrowErrorCode = 'participants-mismatch' | 'deal-mismatch' | 'not-confirmed' | 'escrow-failed' | 'unsupported-browser';
export type EscrowRefusal = 'amount-out-of-range' | 'amount-changed' | 'paid-amount-refused' | 'paid-amount-waiting' | 'amount-unknown' | 'attempts-exhausted';
export type UserSignal = 'trade.paid' | 'trade.cancel' | 'trade.extend' | 'trade.refund-request';

/**
 * What the user confirmed on the take or accept screen (Tasks 18/19), handed to the escrow the
 * first time a trade starts on this device. Opaque to the room: Tasks 18/19 navigate to
 * `/trade/:code` with `{ state: { confirmed } }` and the room passes it through.
 */
export type ConfirmedTrade = unknown;

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
export function integrityFailed(e: Pick<TradeEscrow, 'error' | 'escrowAddress'>, view?: { funding: { escrowAddress: string | null } | null }): boolean {
  if (e.error === 'participants-mismatch' || e.error === 'deal-mismatch') return true;
  const theirs = view?.funding?.escrowAddress ?? null;
  return theirs !== null && e.escrowAddress !== null && theirs !== e.escrowAddress;
}

/**
 * The escrow address this device verified and may show for funding, or null: only once the
 * runtime is ready with check words and its own derived address, with no error, and only when the
 * API's address (if it sends one) is the same.
 */
export function verifiedEscrowAddress(e: TradeEscrow, view: { funding: { escrowAddress: string | null } | null }): string | null {
  if (e.phase !== 'ready' || e.error !== null || e.checkWords === null || e.escrowAddress === null) return null;
  if (integrityFailed(e, view)) return null;
  return e.escrowAddress;
}

const notYet = (): Promise<void> => Promise.reject(new Error('escrow runtime not wired (Task 12)'));

/** The stand-in until Task 12 merges: idle, no check words, every action refused. */
export const PENDING_ESCROW: TradeEscrow = {
  phase: 'idle',
  escrowAddress: null,
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
