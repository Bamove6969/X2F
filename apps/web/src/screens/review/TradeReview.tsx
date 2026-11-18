import { useEffect, useState } from 'react';
import { shouldAskFeedback, type Side } from '@x2f/reputation';
import { FeedbackCard } from './FeedbackCard.js';
import { RatingSaved, ReviewCard, type ReviewOutcome } from './ReviewCard.js';
import { fetchCompletedTrades, fetchTradeReview, type TradeReviewView } from './api.js';

/**
 * The rating on a finished trade's own screen (Plan 5 Task 6): under Released, and on the dispute
 * ruling once the dispute is closed. The API decides whether this side may still rate
 * (`GET /v1/trades/:code/review`.reviewable: a released trade, or a disputed one once closed,
 * and not yet rated or skipped by this side), so the card shows exactly when the rate-first gate
 * would count the trade. Nothing shows while it loads, when it fails (the gate's sheet still asks
 * before the next trade), or when this side is done.
 *
 * After a star or Neutral rating: the board's "Rating saved" card, then "How's X2F doing?" when
 * `shouldAskFeedback` says so for the trader's completed trades now (P5-A19: the 1st and every
 * 10th), never before the rating is saved. After Skip review: nothing (it shows nothing to anyone).
 */
export function TradeReview({
  code,
  counterparty,
  rated,
  load = fetchTradeReview,
  completed = fetchCompletedTrades,
}: {
  code: string;
  counterparty: string;
  /** The side being rated: the other trader's role. */
  rated: Side;
  load?: (code: string, signal?: AbortSignal) => Promise<TradeReviewView>;
  completed?: () => Promise<number | null>;
}) {
  const [view, setView] = useState<TradeReviewView | null>(null);
  const [outcome, setOutcome] = useState<ReviewOutcome | null>(null);
  const [ask, setAsk] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    load(code, ac.signal).then(
      (v) => {
        if (!ac.signal.aborted) setView(v);
      },
      () => undefined,
    );
    return () => ac.abort();
  }, [code, load]);

  useEffect(() => {
    if (outcome !== 'rated' && outcome !== 'neutral') return;
    let live = true;
    completed().then(
      (n) => {
        if (live && n !== null && shouldAskFeedback(n)) setAsk(true);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [outcome, completed]);

  if (outcome === 'skipped') return null;
  if (outcome !== null) {
    return (
      <div data-part="trade-review">
        <RatingSaved counterparty={counterparty} />
        {ask ? <FeedbackCard /> : null}
      </div>
    );
  }
  if (view === null || !view.reviewable) return null;
  return (
    <div data-part="trade-review">
      <ReviewCard code={code} counterparty={counterparty} rated={rated} onDone={setOutcome} />
    </div>
  );
}
