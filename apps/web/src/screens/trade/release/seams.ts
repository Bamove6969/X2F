import { useEffect, useState } from 'react';
import { ApiCallError, api } from '../../../api/client.js';
import type { Confirmations, ReleaseEscrow } from './view.js';

/**
 * SEAM (Task 12, wip/second-p3-t12, not on the main line yet): the escrow handle for a release.
 * Task 12's `useEscrow(code)` (apps/web/src/escrow/useEscrow.ts) returns `release()`, which has
 * the seller's app build and sign the release and the buyer's app co-sign it through
 * `cosignPolicy`. Until it lands there is no escrow runtime in the browser, so `release()` here
 * does nothing; the API's `release-started` is still posted first. Tripwire:
 * apps/web/test/release-tripwires.test.ts fails once useEscrow.ts exists; then return
 * `useEscrow(code)` here and delete this stand-in.
 */
export function useReleaseEscrow(_code: string): ReleaseEscrow {
  return NO_ESCROW_RUNTIME;
}

const NO_ESCROW_RUNTIME: ReleaseEscrow = { release: async () => undefined };

/** How often the released screen asks for confirmations (each answer is cached by the API for 10 s). */
export const CONFIRMATIONS_POLL_MS = 15_000;

/**
 * The released screen's live confirmations from X2F's own node (`GET
 * /v1/trades/:code/confirmations`), asked now and every CONFIRMATIONS_POLL_MS until the count
 * reaches its target (10). A refusal (the trade has no settlement tx yet) stops asking; a network
 * failure keeps the last answer and tries again on the next tick.
 */
export function useConfirmations(code: string): Confirmations | null {
  const [got, setGot] = useState<Confirmations | null>(null);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ask = async () => {
      let next: Confirmations | null = null;
      try {
        next = await api<Confirmations>(`/v1/trades/${encodeURIComponent(code)}/confirmations`);
      } catch (err) {
        if (err instanceof ApiCallError && err.status >= 400 && err.status < 500) stopped = true;
      }
      if (stopped) return;
      if (next !== null) setGot(next);
      if (next !== null && next.confirmations !== null && next.confirmations >= next.target) return;
      timer = setTimeout(() => void ask(), CONFIRMATIONS_POLL_MS);
    };
    void ask();
    return () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [code]);
  return got;
}
