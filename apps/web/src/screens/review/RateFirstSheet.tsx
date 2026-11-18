import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { Side } from '@x2f/reputation';
import { Button } from '../../ui/Button.js';
import { FEEDBACK_LINE } from '../../ui/CantDoThat.js';
import { RATE_FIRST, REVIEW_PENDING_CODE, feedbackHref } from '../../ui/cantDoCodes.js';
import { Sheet } from '../../ui/Sheet.js';
import { ReviewCard } from './ReviewCard.js';
import { fetchPendingReviews, fetchRatedSide, type PendingReview } from './api.js';
import { REVIEW_COPY } from './copy.js';
import { usePendingReviews } from './usePendingReviews.js';
import './review.css';

export interface RateFirstLoaders {
  loadPending?: (signal?: AbortSignal) => Promise<PendingReview[]>;
  loadRated?: (code: string, signal?: AbortSignal) => Promise<Side | null>;
}

/**
 * The rate-first gate's content (Plan 5 Task 6; spec 5.1, P5-A4; owner 2026-11-01: "submit a
 * review or tap Skip to complete the trade and clear it"). It says why ("Rate your last trade to
 * continue"), then shows the ReviewCard for the oldest trade the gate counts (`GET
 * /v1/reviews/pending`), one at a time, and calls `onCleared(true)` once the list is empty, so the
 * caller resumes what was refused (the take, or the poster's wallet pick); `onCleared(false)` when
 * the list was empty from the start (nothing was rated here, so nothing is retried). Like every refusal it
 * ends with the owner's feedback line (Task 21).
 */
export function RateFirst({ onCleared, loadPending = fetchPendingReviews, loadRated = fetchRatedSide }: { onCleared: (rated: boolean) => void } & RateFirstLoaders) {
  const { state, reload } = usePendingReviews(true, loadPending);
  const [rated, setRated] = useState<{ code: string; side: Side | null } | null>(null);
  const cleared = useRef(false);
  // Whether a trade was rated or skipped here: only then does the caller try again (a gate that
  // refused with nothing on the list would otherwise refuse, reopen and retry for ever).
  const didRate = useRef(false);
  const current = state.status === 'ready' ? (state.trades[0] ?? null) : null;
  const currentCode = current?.code ?? null;

  useEffect(() => {
    if (state.status === 'ready' && state.trades.length === 0 && !cleared.current) {
      cleared.current = true;
      onCleared(didRate.current);
    }
  }, [state, onCleared]);

  useEffect(() => {
    if (currentCode === null) return;
    const ac = new AbortController();
    loadRated(currentCode, ac.signal).then(
      (side) => {
        if (!ac.signal.aborted) setRated({ code: currentCode, side });
      },
      () => {
        if (!ac.signal.aborted) setRated({ code: currentCode, side: null });
      },
    );
    return () => ac.abort();
    // Read again on every fresh pending list (a Try again after a failed read included).
  }, [state, currentCode, loadRated]);

  const n = state.status === 'ready' ? state.trades.length : 0;
  const ready = current !== null && rated !== null && rated.code === current.code && rated.side !== null;
  const failed = state.status === 'error' || (current !== null && rated !== null && rated.code === current.code && rated.side === null);

  return (
    <div className="x2f-rate-first" data-part="rate-first">
      <p className="x2f-review__sub x2f-review__sub--body" data-part="rate-first-body">
        {RATE_FIRST.body}
      </p>
      {n > 1 ? (
        <span className="x2f-review__sub" data-part="rate-first-count">
          {RATE_FIRST.count(n)}
        </span>
      ) : null}
      {ready ? (
        <ReviewCard
          key={current.code}
          code={current.code}
          counterparty={current.counterparty}
          rated={rated.side!}
          onDone={() => {
            didRate.current = true;
            reload();
          }}
        />
      ) : failed ? (
        <>
          <p role="alert" className="x2f-review__error">
            {REVIEW_COPY.failed}
          </p>
          <Button variant="secondary" onClick={reload}>
            {REVIEW_COPY.retry}
          </Button>
        </>
      ) : null}
      <p className="x2f-info-block" data-part="feedback-line">
        {FEEDBACK_LINE.before}
        <Link className="x2f-link" to={feedbackHref(REVIEW_PENDING_CODE)}>
          {FEEDBACK_LINE.link}
        </Link>
        {FEEDBACK_LINE.after}
      </p>
    </div>
  );
}

/**
 * RateFirst in a sheet (the quote's take refusal). Closing it without rating leaves the
 * refusal's line on the screen (RATE_FIRST.inline); the gate asks again at the next tap.
 */
export function RateFirstSheet({ open, onCleared, onClose, ...loaders }: { open: boolean; onCleared: (rated: boolean) => void; onClose: () => void } & RateFirstLoaders) {
  return (
    <Sheet open={open} title={RATE_FIRST.title} onClose={onClose}>
      {open ? <RateFirst onCleared={onCleared} {...loaders} /> : <span />}
    </Sheet>
  );
}
