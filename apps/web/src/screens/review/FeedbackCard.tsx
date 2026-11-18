import { useId, useState } from 'react';
import { Button } from '../../ui/Button.js';
import { postMood, type Mood } from './api.js';
import { FEEDBACK_COPY } from './copy.js';
import './review.css';

/** The note's limit, as the API's (apps/api/src/feedback/mood.ts FEEDBACK_NOTE_MAX). */
export const FEEDBACK_NOTE_MAX = 500;

/**
 * "How's X2F doing?" (Plan 5 Task 4 / Task 6, board Review.dc.html; P5-A19, spec 5.2). The caller
 * shows it only after a rating was saved and only when `shouldAskFeedback(completedTrades)` (the
 * 1st completed trade and every 10th), so it is never stacked with the required rating. Great / OK
 * / Needs work, an optional note, **Send feedback** (the board's outlined button, not a primary:
 * it is optional) and **Not now**.
 *
 * The request body is exactly `{ mood, note }`: no username, no trade code, nothing about the
 * trade it follows (the card is given none of it). Not now closes it; a send leaves a thank-you line. A failed send closes the card like a sent one:
 * the API answers 202 even over its daily limit, and a courtesy prompt never shows an error.
 */
export function FeedbackCard({ onDone, send = postMood }: { onDone?: () => void; send?: (mood: Mood, note: string) => Promise<void> }) {
  const [mood, setMood] = useState<Mood | null>(null);
  const [note, setNote] = useState('');
  const [state, setState] = useState<'open' | 'sending' | 'sent' | 'closed'>('open');
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
    try {
      await send(mood, note.trim());
    } catch {
      // Nothing to fix for the person: the prompt just closes.
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
      </section>
      <footer className="x2f-review__footer">
        <Button variant="secondary" disabled={mood === null || state !== 'open'} onClick={() => void submit()}>
          {FEEDBACK_COPY.send}
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
