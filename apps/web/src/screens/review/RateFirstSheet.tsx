import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { Side } from '@x2f/reputation';
import { Button } from '../../ui/Button.js';
import { FEEDBACK_LINE } from '../../ui/CantDoThat.js';
import { RATE_FIRST, REVIEW_PENDING_CODE, feedbackHref } from '../../ui/cantDoCodes.js';
import { Sheet } from '../../ui/Sheet.js';
import { ReviewCard, type ReviewOutcome } from './ReviewCard.js';
import { fetchPendingReviews, fetchRatedSide, nothingToRate, postSkip, type PendingReview } from './api.js';
import { REVIEW_COPY } from './copy.js';
import { usePendingReviews } from './usePendingReviews.js';
import './review.css';

export interface RateFirstLoaders {
  loadPending?: (signal?: AbortSignal) => Promise<PendingReview[]>;
  loadRated?: (code: string, signal?: AbortSignal) => Promise<Side | null>;
  /** Skip review (`POST /v1/trades/:code/review/skip`), also offered when the side is unknown. */
  skip?: (code: string) => Promise<void>;
}

/**
 * How the list emptied: `rated` once at least one trade got a star or Neutral rating here;
 * `skipped` when it emptied by Skip review alone (or by trades done elsewhere meanwhile); `empty`
 * when it was empty from the start. The quote takes again by itself only after `rated` (lead,
 * 18 Nov); the poster's wallet pick goes again after `rated` or `skipped`.
 */
export type RateFirstCleared = 'rated' | 'skipped' | 'empty';

/**
 * The rate-first gate's content (Plan 5 Task 6; spec 5.1, P5-A4; owner 2026-11-01: "submit a
 * review or tap Skip to complete the trade and clear it"). It says why ("Rate your last trade to
 * continue"), then shows the ReviewCard for the oldest trade the gate counts (`GET
 * /v1/reviews/pending`), one at a time, and calls `onCleared` once the list is empty, saying how
 * (RateFirstCleared), so the caller decides whether to resume what was refused (the take, or the
 * poster's wallet pick). Nothing is retried when the list was empty from the start. When the
 * trade's own view cannot be read (the side decides the chips), the sheet still offers Skip
 * review beside Try again, since a skip needs no side (review m3). Like every refusal it ends with
 * the owner's feedback line (Task 21).
 */
export function RateFirst({
  onCleared,
  loadPending = fetchPendingReviews,
  loadRated = fetchRatedSide,
  skip = postSkip,
}: { onCleared: (how: RateFirstCleared) => void } & RateFirstLoaders) {
  const { state, reload } = usePendingReviews(true, loadPending);
  const [rated, setRated] = useState<{ code: string; side: Side | null } | null>(null);
  const [skipping, setSkipping] = useState(false);
  const cleared = useRef(false);
  // What was done here: a gate that refused with nothing on the list would otherwise refuse,
  // reopen and retry for ever, so `empty` retries nothing.
  const did = useRef<RateFirstCleared>('empty');
  const finished = (o: ReviewOutcome) => {
    if (o === 'rated' || o === 'neutral') did.current = 'rated';
    else if (did.current === 'empty') did.current = 'skipped';
    reload();
  };
  const current = state.status === 'ready' ? (state.trades[0] ?? null) : null;
  const currentCode = current?.code ?? null;

  useEffect(() => {
    if (state.status === 'ready' && state.trades.length === 0 && !cleared.current) {
      cleared.current = true;
      onCleared(did.current);
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
          skip={skip}
          onDone={finished}
        />
      ) : failed ? (
        <>
          <p role="alert" className="x2f-review__error">
            {REVIEW_COPY.failed}
          </p>
          <Button variant="secondary" disabled={skipping} onClick={reload}>
            {REVIEW_COPY.retry}
          </Button>
          {current !== null ? (
            <Button
              variant="quiet"
              disabled={skipping}
              onClick={() => {
                const code = current.code;
                setSkipping(true);
                skip(code).then(
                  () => {
                    setSkipping(false);
                    finished('skipped');
                  },
                  (e: unknown) => {
                    setSkipping(false);
                    // Done elsewhere meanwhile: the list read again shows what is left.
                    if (nothingToRate(e)) finished('gone');
                  },
                );
              }}
            >
              {REVIEW_COPY.skip}
            </Button>
          ) : null}
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
export function RateFirstSheet({ open, onCleared, onClose, ...loaders }: { open: boolean; onCleared: (how: RateFirstCleared) => void; onClose: () => void } & RateFirstLoaders) {
  return (
    <Sheet open={open} title={RATE_FIRST.title} onClose={onClose}>
      {open ? <RateFirst onCleared={onCleared} {...loaders} /> : <span />}
    </Sheet>
  );
}
