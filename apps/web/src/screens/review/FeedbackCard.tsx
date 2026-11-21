import { useId, useState } from 'react';
import { ApiCallError } from '../../api/client.js';
import { Button } from '../../ui/Button.js';
import { postMood, type Mood } from './api.js';
import { FEEDBACK_COPY } from './copy.js';
import './review.css';

/** The note's limit, as the API's (apps/api/src/feedback/mood.ts FEEDBACK_NOTE_MAX). */
export const FEEDBACK_NOTE_MAX = 500;

/** The characters the API refuses in a note, as its own rule (apps/api/src/feedback/form.ts HIDDEN). */
export const FEEDBACK_HIDDEN = /(?![\n\t\u200c\u200d])[\p{Cc}\p{Cf}]/u;

/**
 * "How's X2F doing?" (Plan 5 Task 4 / Task 6, board Review.dc.html; P5-A19, spec 5.2). The caller
 * shows it only after a rating was saved and only when `shouldAskFeedback(completedTrades)` (the
 * 1st completed trade and every 10th), so it is never stacked with the required rating. Great / OK
 * / Needs work, an optional note, **Send feedback** (the board's outlined button, not a primary:
 * it is optional) and **Not now**.
 *
 * The request body is exactly `{ mood, note }`: no username, no trade code, nothing about the
 * trade it follows (the card is given none of it). Not now closes it; a send the API took (202,
 * which it answers even over its daily limit) leaves a thank-you line. A send that failed says it
 * could not be sent and offers to send again (review m4); a 400 for a note holding a hidden
 * character says what to fix.
 */
export function FeedbackCard({ onDone, send = postMood }: { onDone?: () => void; send?: (mood: Mood, note: string) => Promise<void> }) {
  const [mood, setMood] = useState<Mood | null>(null);
  const [note, setNote] = useState('');
  const [state, setState] = useState<'open' | 'sending' | 'sent' | 'closed'>('open');
  const [error, setError] = useState<string | null>(null);
  const noteId = useId();

  if (state === 'closed') return null;
  if (state === 'sent') {
    return (
      <p role="status" className="x2f-review__sub x2f-review__sub--body x2f-review__saved" data-part="feedback-sent">
        {FEEDBACK_COPY.sent}
      </p>
    );
  }

  const submit = async () => {
    if (mood === null || state !== 'open') return;
    setState('sending');
    setError(null);
    const line = note.trim();
    try {
      await send(mood, line);
    } catch (e) {
      // Not sent: the card stays, with what was picked, so it can go again.
      const hidden = e instanceof ApiCallError && e.status === 400 && FEEDBACK_HIDDEN.test(line);
      setError(hidden ? FEEDBACK_COPY.hidden : FEEDBACK_COPY.failed);
      setState('open');
      return;
    }
    setState('sent');
    onDone?.();
  };

  return (
    <div className="x2f-review x2f-review__feedback" data-part="feedback-card">
      <section aria-label={FEEDBACK_COPY.heading} className="x2f-review__card">
        <div className="x2f-review__head">
          <h2 className="x2f-review__title">{FEEDBACK_COPY.heading}</h2>
          <span className="x2f-review__sub x2f-review__sub--body">{FEEDBACK_COPY.sub}</span>
        </div>
        <div role="radiogroup" aria-label={FEEDBACK_COPY.moodsLabel} className="x2f-review__moods">
          {FEEDBACK_COPY.moods.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={mood === m.id} className="x2f-review__mood" onClick={() => setMood(m.id as Mood)}>
              {m.label}
            </button>
          ))}
        </div>
        <label htmlFor={noteId} className="x2f-review__label">
          {FEEDBACK_COPY.note}
          <textarea
            id={noteId}
            rows={3}
            className="x2f-review__input"
            maxLength={FEEDBACK_NOTE_MAX}
            placeholder={FEEDBACK_COPY.notePlaceholder}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <span className="x2f-review__fine">{FEEDBACK_COPY.privacy}</span>
        {error !== null ? (
          <p role="alert" className="x2f-review__error">
            {error}
          </p>
        ) : null}
      </section>
      <footer className="x2f-review__footer">
        <Button variant="secondary" disabled={mood === null || state !== 'open'} onClick={() => void submit()}>
          {error === null ? FEEDBACK_COPY.send : FEEDBACK_COPY.retry}
        </Button>
        <Button
          variant="quiet"
          onClick={() => {
            setState('closed');
            onDone?.();
          }}
        >
          {FEEDBACK_COPY.later}
        </Button>
      </footer>
    </div>
  );
}
