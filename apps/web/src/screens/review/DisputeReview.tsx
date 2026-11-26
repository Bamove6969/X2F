/**
 * Plan 5 Task 19 (Revision 2026-10-29b, owner): dispute a review of me, `/profile/reviews/:id/dispute`.
 *
 * Reached from the "Dispute" link on my own profile (the API gives a review's id only to the person it
 * is about). It shows the review as my profile does, a required free-text reason (no reason list for
 * now, owner) and one primary action. Once sent, the review shows "Under review" at once and counts in
 * no figure until a moderator lets it stand, removes some of its comments, or removes it.
 *
 * No board yet: built from the kit (screens.css classes, Button), no styling of its own.
 */
import { useEffect, useId, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { ApiCallError } from '../../api/client.js';
import { tradeTagOf, useSession } from '../../session/useSession.js';
import { Button } from '../../ui/Button.js';
import { fetchProfile, type PublicReview } from '../profile/api.js';
import { PROFILE_COPY } from '../profile/profileCopy.js';
import { disputeReview } from './api.js';
import { DISPUTE_COPY as C } from './copy.js';
import '../screens.css';

/** The longest reason the API takes (apps/api/src/reviews/disputes.ts DISPUTE_REASON_MAX). */
export const DISPUTE_REASON_MAX = 1000;

type State =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'ready'; review: PublicReview }
  | { kind: 'sent' }
  | { kind: 'failed'; message: string; review: PublicReview };

function ReviewSummary({ review }: { review: PublicReview }) {
  const words = [...review.phrases, ...review.tradeBadges];
  const rating = review.neutral || review.stars === null ? PROFILE_COPY.neutral : PROFILE_COPY.starsLabel(review.stars);
  return (
    <section className="x2f-card" aria-label={C.title} data-part="disputed-review">
      <p className="x2f-note">
        {rating} · {review.age} · {review.method}
      </p>
      {words.length > 0 ? <p className="x2f-note">{words.join(' · ')}</p> : null}
      {review.note !== null ? <p data-part="review-note">{review.note}</p> : null}
    </section>
  );
}

export function DisputeReview({ send = disputeReview }: { send?: (id: string, reason: string) => Promise<void> }) {
  const { id = '' } = useParams();
  const session = useSession();
  const name = session.status === 'signed-in' ? tradeTagOf(session.me) : null;
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const reasonId = useId();
  const hintId = useId();

  useEffect(() => {
    if (name === null || name === '') return;
    const ctl = new AbortController();
    fetchProfile(name, ctl.signal).then(
      (p) => {
        const review = p.self ? p.reviews.find((r) => r.id === id && r.disputable === true) : undefined;
        setState(review ? { kind: 'ready', review } : { kind: 'missing' });
      },
      () => {
        if (!ctl.signal.aborted) setState({ kind: 'missing' });
      },
    );
    return () => ctl.abort();
  }, [name, id]);

  const review = state.kind === 'ready' || state.kind === 'failed' ? state.review : null;
  const text = reason.trim();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (review === null || text === '' || busy) return;
    setBusy(true);
    try {
      await send(id, text);
      setState({ kind: 'sent' });
    } catch (err) {
      const code = err instanceof ApiCallError ? err.code : null;
      if (code === 'review-disputed') setState({ kind: 'failed', message: C.already, review });
      else if (code === 'not-disputable' || code === 'not-found') setState({ kind: 'missing' });
      else setState({ kind: 'failed', message: C.failed, review });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="x2f-screen" data-screen="dispute-review">
      <h1 className="x2f-screen__title">{C.title}</h1>
      {state.kind === 'loading' ? <p className="x2f-note">{C.loading}</p> : null}
      {state.kind === 'missing' ? <p className="x2f-note" data-part="dispute-missing">{C.missing}</p> : null}
      {state.kind === 'sent' ? (
        <p role="status" data-part="dispute-sent">
          {C.sent}
        </p>
      ) : null}
      {review !== null ? (
        <form className="x2f-stack" onSubmit={(e) => void submit(e)}>
          <ReviewSummary review={review} />
          <p className="x2f-note">{C.intro}</p>
          <div className="x2f-field">
            <label htmlFor={reasonId} className="x2f-field-label">
              {C.reason}
            </label>
            <textarea
              id={reasonId}
              className="x2f-input x2f-input--message"
              rows={6}
              required
              value={reason}
              maxLength={DISPUTE_REASON_MAX}
              aria-describedby={hintId}
              onChange={(e) => setReason(e.target.value)}
            />
            <span id={hintId} className="x2f-field-count">
              {C.reasonHint}
            </span>
          </div>
          {state.kind === 'failed' ? (
            <p className="x2f-error" role="alert">
              {state.message}
            </p>
          ) : null}
          <Button variant="primary" type="submit" disabled={text === '' || busy}>
            {C.send}
          </Button>
        </form>
      ) : null}
      <Link className="x2f-button x2f-button--secondary" to="/profile" data-part="dispute-back">
        {C.cancel}
      </Link>
    </main>
  );
}
