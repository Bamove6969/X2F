import { useCallback, useEffect, useState } from 'react';
import { fetchPendingReviews, type PendingReview } from './api.js';

export type PendingState = { status: 'loading' } | { status: 'ready'; trades: PendingReview[] } | { status: 'error' };

/**
 * The trades this trader must rate or skip before their next trade (`GET /v1/reviews/pending`,
 * the gate's own list, oldest first). Read only while `enabled` (a signed-in trader who has met
 * the gate); `reload` reads it again after a rating.
 */
export function usePendingReviews(
  enabled: boolean,
  load: (signal?: AbortSignal) => Promise<PendingReview[]> = fetchPendingReviews,
): { state: PendingState; reload: () => void } {
  const [state, setState] = useState<PendingState>({ status: 'loading' });
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const ac = new AbortController();
    setState({ status: 'loading' });
    load(ac.signal).then(
      (trades) => {
        if (!ac.signal.aborted) setState({ status: 'ready', trades });
      },
      () => {
        if (!ac.signal.aborted) setState({ status: 'error' });
      },
    );
    return () => ac.abort();
  }, [enabled, load, round]);

  const reload = useCallback(() => setRound((r) => r + 1), []);
  return { state, reload };
}
