import { useId, useState, type KeyboardEvent } from 'react';
import { BAD_PHRASES, GOOD_PHRASES, REVIEW_NOTE_MAX, STAR_MAX, type ReviewInput, type Side, type Stars } from '@x2f/reputation';
import { ApiCallError } from '../../api/client.js';
import { Button } from '../../ui/Button.js';
import { nothingToRate, postReview, postSkip } from './api.js';
import { REVIEW_COPY } from './copy.js';
import './review.css';

/**
 * How the card finished: a star rating, Neutral, Skip review (shows nothing to anyone), or `gone`:
 * a 409 `review-exists` or `not-reviewable`, so nothing was saved by this tap (review m2).
 */
export type ReviewOutcome = 'rated' | 'neutral' | 'skipped' | 'gone';

const STAR_PATH = 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z';
const STAR_VALUES = Array.from({ length: STAR_MAX }, (_, i) => (i + 1) as Stars);

/**
 * The rating card (Plan 5 Task 6; board Review.dc.html "How was trading with <name>?"; spec 5.1).
 * Five stars, the phrase chips for the side being rated (P5-A7: "Fast payment" when rating a
 * buyer, "Fast release" when rating a seller; good teal, bad rose), a one-line note, **Submit
 * rating** (disabled until a star is picked), **Neutral, skip details** (sends `{ neutral: true }`
 * and nothing else) and **Skip review** (owner 2026-11-01: clears the trade, shows nothing).
 *
 * The body never names a reviewer, a side or an amount: the server takes them from the trade and
 * the session. A 409 `review-exists` or `not-reviewable` means there is nothing left to rate here
 * (another tab did it, or a dispute was opened), so the card finishes as `gone`, never as saved. The note's rules are the package's
 * (one line, at most REVIEW_NOTE_MAX characters); the server's personal-details check answers 400
 * `note-personal-details`.
 */
export function ReviewCard({
  code,
  counterparty,
  rated,
  onDone,
  submit = postReview,
  skip = postSkip,
}: {
  code: string;
  /** The other trader's public display name. */
  counterparty: string;
  /** The side being rated (the other trader's role). */
  rated: Side;
  onDone: (outcome: ReviewOutcome) => void;
  submit?: (code: string, body: ReviewInput) => Promise<void>;
  skip?: (code: string) => Promise<void>;
}) {
  const [stars, setStars] = useState<Stars | null>(null);
  const [picked, setPicked] = useState<readonly string[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteId = useId();
  const good = GOOD_PHRASES(rated);
  const phrases = [...good.map((p) => ({ p, tone: 'good' as const })), ...BAD_PHRASES.map((p) => ({ p, tone: 'bad' as const }))];

  const send = async (outcome: ReviewOutcome, call: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await call();
    } catch (e) {
      if (nothingToRate(e)) {
        onDone('gone');
        return;
      }
      setBusy(false);
      setError(e instanceof ApiCallError && e.code === 'note-personal-details' ? REVIEW_COPY.personalDetails : REVIEW_COPY.failed);
      return;
    }
    onDone(outcome);
  };

  const rate = () => {
    if (stars === null) return;
    // Phrases in the board's order, whatever order they were tapped in.
    const chosen = phrases.map((x) => x.p).filter((p) => picked.includes(p));
    const line = note.trim();
    const body: ReviewInput = { neutral: false, stars, phrases: chosen, tradeBadges: [], ...(line === '' ? {} : { note: line }) };
    void send('rated', () => submit(code, body));
  };

  const toggle = (p: string) => setPicked((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));

  // A radio group: the arrow keys move the pick (WAI-ARIA radio pattern).
  const onStarKey = (e: KeyboardEvent<HTMLButtonElement>, n: Stars) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const next = Math.min(STAR_MAX, Math.max(1, n + step)) as Stars;
    setStars(next);
    const group = e.currentTarget.parentElement;
    group?.querySelector<HTMLButtonElement>(`[data-star="${next}"]`)?.focus();
  };

  return (
    <div className="x2f-review" data-part="review-card">
      <section aria-label={REVIEW_COPY.rateLabel(counterparty)} className="x2f-review__card">
        <div className="x2f-review__head">
          <h2 className="x2f-review__title">
            How was trading with <span data-username="">{counterparty}</span>?
          </h2>
          <span className="x2f-review__sub">{REVIEW_COPY.shown}</span>
        </div>
        <div role="radiogroup" aria-label={REVIEW_COPY.starsLabel} className="x2f-review__stars">
          {STAR_VALUES.map((n) => {
            const on = stars !== null && n <= stars;
            return (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={stars === n}
                aria-label={REVIEW_COPY.star(n)}
                data-star={n}
                // One tab stop for the group: the picked star, else the first.
                tabIndex={(stars ?? 1) === n ? 0 : -1}
                className="x2f-review__star"
                onClick={() => setStars(n)}
                onKeyDown={(e) => onStarKey(e, n)}
              >
                <svg width="40" height="40" viewBox="0 0 24 24" aria-hidden="true">
                  <path d={STAR_PATH} data-on={on ? '' : undefined} />
                </svg>
              </button>
            );
          })}
        </div>
        <div role="group" aria-label={REVIEW_COPY.phrasesLabel} className="x2f-review__phrases">
          {phrases.map(({ p, tone }) => (
            <button key={p} type="button" aria-pressed={picked.includes(p)} data-tone={tone} className="x2f-review__phrase" onClick={() => toggle(p)}>
              {p}
            </button>
          ))}
        </div>
        <label htmlFor={noteId} className="x2f-review__label">
          {REVIEW_COPY.note}
          <input
            id={noteId}
            type="text"
            className="x2f-review__input"
            maxLength={REVIEW_NOTE_MAX}
            placeholder={REVIEW_COPY.notePlaceholder}
            value={note}
            // One line (P5-A6): a pasted line break becomes a space.
            onChange={(e) => setNote(e.target.value.replace(/[\r\n]+/g, ' '))}
          />
        </label>
        {error !== null ? (
          <p role="alert" className="x2f-review__error">
            {error}
          </p>
        ) : null}
      </section>
      <footer className="x2f-review__footer">
        <Button variant="primary" disabled={stars === null || busy} onClick={rate}>
          {REVIEW_COPY.submit}
        </Button>
        <Button variant="quiet" disabled={busy} onClick={() => void send('neutral', () => submit(code, { neutral: true }))}>
          {REVIEW_COPY.neutral}
        </Button>
        <Button variant="quiet" disabled={busy} onClick={() => void send('skipped', () => skip(code))}>
          {REVIEW_COPY.skip}
        </Button>
      </footer>
    </div>
  );
}

/** The board's "Rating saved." card, shown in place of the rating card. */
export function RatingSaved({ counterparty }: { counterparty: string }) {
  return (
    <section aria-label="Rating saved" className="x2f-review__saved" data-part="rating-saved">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M5 12l4 4 10-10" />
      </svg>
      <p role="status">
        {REVIEW_COPY.saved(counterparty)}
      </p>
    </section>
  );
}
