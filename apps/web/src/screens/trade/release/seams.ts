import { useEffect, useState } from 'react';
import { ApiCallError, api } from '../../../api/client.js';
import type { Confirmations, ReleaseTrade } from './view.js';

/** How often the released screen asks for confirmations (each answer is cached by the API for 10 s). */
export const CONFIRMATIONS_POLL_MS = 15_000;
/** After this many answers in a row with no count (no node configured, or the node is down), the asks back off. */
export const NO_COUNT_BEFORE_BACKOFF = 3;
/** The longest wait between asks while backing off. */
export const CONFIRMATIONS_MAX_POLL_MS = 240_000;

/**
 * The released screen's live confirmations from X2F's own node (`GET
 * /v1/trades/:code/confirmations`). It asks only once the trade is `released` with a settlement
 * tx (before that the API answers 409), and asks again whenever the trade's state or tx changes:
 * the same Released element stays mounted from `settling` to `released`, in the interim route
 * and in Task 22's TradeRoom alike (review 2026-10-27, I2). Then every CONFIRMATIONS_POLL_MS until
 * the count reaches its target (10). A 409 is "not yet" (asked again on the next tick); any other
 * 4xx (signed out, not a participant) stops. After NO_COUNT_BEFORE_BACKOFF answers with no count
 * the wait doubles each time, up to CONFIRMATIONS_MAX_POLL_MS (Minor 3).
 */
export function useConfirmations(t: Pick<ReleaseTrade, 'code' | 'state' | 'txHash'>): Confirmations | null {
  const [got, setGot] = useState<Confirmations | null>(null);
  const { code, state, txHash } = t;
  const ready = state === 'released' && txHash !== null;
  useEffect(() => {
    if (!ready) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let noCount = 0;
    const ask = async () => {
      let next: Confirmations | null = null;
      try {
        next = await api<Confirmations>(`/v1/trades/${encodeURIComponent(code)}/confirmations`);
      } catch (err) {
        if (err instanceof ApiCallError && err.status >= 400 && err.status < 500 && err.status !== 409) stopped = true;
      }
      if (stopped) return;
      if (next !== null) setGot(next);
      if (next !== null && next.confirmations !== null && next.confirmations >= next.target) return;
      noCount = next !== null && next.confirmations === null ? noCount + 1 : 0;
      const over = noCount - NO_COUNT_BEFORE_BACKOFF;
      const wait = over > 0 ? Math.min(CONFIRMATIONS_POLL_MS * 2 ** over, CONFIRMATIONS_MAX_POLL_MS) : CONFIRMATIONS_POLL_MS;
      timer = setTimeout(() => void ask(), wait);
    };
    void ask();
    return () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [code, ready, txHash]);
  return got;
}
