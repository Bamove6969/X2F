/**
 * What a quote keeps per offer while the person is on it, above the component (review 2026-11-01
 * M1, M2). A fold or unfold moves the quote between the phone screen and the pane beside the offers
 * (OffersRoute), which mounts a new QuoteScreen; this store is how the new one carries on: the
 * typed amount and its unit, the take in flight (so a tap on the new one never takes twice), the
 * refusal on screen, "You're back" and the blocked poster.
 *
 * Kept per offer, for as long as a quote for that offer is mounted: when the last one unmounts and
 * none mounts again in the same turn (a fold mounts the new one in the same commit), the entry is
 * dropped, so leaving the quote (Back to the list, another offer) starts the next visit afresh, as
 * on a phone before. An entry with a take in flight stays until the take answers. Never stored.
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react';

export type QuoteUnit = 'fiat' | 'xmr';

export interface QuoteKept {
  /** The typed amount and its unit, or null for none typed yet. */
  amount: { text: string; unit: QuoteUnit } | null;
  /** A take is in flight for this offer. */
  busy: boolean;
  /** The last take's error (the refusal shown), or null. */
  error: unknown;
  /** The error whose CantDoThat the person closed. */
  closedError: unknown;
  /** Back from setup or Add a wallet with a matching marker: "You're back". */
  back: boolean;
  /** The person blocked the poster from this quote (Task 37). */
  blockedPoster: boolean;
  /** The header's Chat hint was asked for. */
  chatHint: boolean;
}

const EMPTY: QuoteKept = { amount: null, busy: false, error: null, closedError: null, back: false, blockedPoster: false, chatHint: false };

const store = new Map<string, QuoteKept>();
const listeners = new Map<string, Set<() => void>>();
const mounted = new Map<string, number>();

export function readQuote(offerId: string): QuoteKept {
  return store.get(offerId) ?? EMPTY;
}

function notify(offerId: string): void {
  for (const l of listeners.get(offerId) ?? []) l();
}

export function updateQuote(offerId: string, patch: Partial<QuoteKept>): void {
  store.set(offerId, { ...readQuote(offerId), ...patch });
  notify(offerId);
}

/** Drops the offer's entry when no quote for it is mounted and no take is in flight. */
export function dropIfLeft(offerId: string): void {
  if ((mounted.get(offerId) ?? 0) > 0 || readQuote(offerId).busy) return;
  if (store.delete(offerId)) notify(offerId);
}

export function useQuoteKept(offerId: string): [QuoteKept, (patch: Partial<QuoteKept>) => void] {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const set = listeners.get(offerId) ?? new Set();
      set.add(onChange);
      listeners.set(offerId, set);
      return () => {
        set.delete(onChange);
      };
    },
    [offerId],
  );
  const value = useSyncExternalStore(
    subscribe,
    () => readQuote(offerId),
    () => EMPTY,
  );
  useEffect(() => {
    mounted.set(offerId, (mounted.get(offerId) ?? 0) + 1);
    return () => {
      mounted.set(offerId, (mounted.get(offerId) ?? 1) - 1);
      // After this commit: a fold mounts the quote's new instance in the same one.
      setTimeout(() => dropIfLeft(offerId), 0);
    };
  }, [offerId]);
  const set = useCallback((patch: Partial<QuoteKept>) => updateQuote(offerId, patch), [offerId]);
  return [value, set];
}

/**
 * Forgets one offer's kept quote unless a take is in flight; true when forgotten. Back to the offer
 * list undoes the pick, so the pane's quote starts afresh (OffersRoute, lead review 2026-11-06 m1).
 */
export function forgetQuote(offerId: string): boolean {
  if (readQuote(offerId).busy) return false;
  if (store.delete(offerId)) notify(offerId);
  return true;
}

/** For tests: forget every kept quote. */
export function forgetQuotes(): void {
  const ids = [...store.keys()];
  store.clear();
  mounted.clear();
  for (const id of ids) notify(id);
}
