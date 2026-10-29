/**
 * The feedback form (Plan 5 Task 21; owner, 2026-10-29, spec 5.2), opened from the "feedback" link
 * every CantDoThat popup carries (`/feedback?from=<refusal code>`). A complaint, feedback or a
 * recommendation, sent named (staff can reach out for details) or, with "Send anonymously", with
 * nothing that says who sent it. `POST /v1/feedback/form`; the API keeps no account id, session or
 * address on an anonymous row and drops the refusal code from it too.
 *
 * No board exists for this screen yet (Claude Design brief 2026-10-29, item 5): it is built from the
 * existing kit classes only, with no styling of its own, and is matched to the board when it lands
 * (tripwire NEEDS_DESIGN_CANTDOTHAT). The owner's words are used where he gave them (the checkbox
 * and the thank-you); the rest is marked COPY-UNSIGNED.
 */
import { useId, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ApiCallError, api, safeReturnTo } from '../api/client.js';
import { Button } from '../ui/Button.js';
import { waitSentence } from './auth/refusals.js';
import './screens.css';

export type FeedbackKind = 'complaint' | 'feedback' | 'recommendation';

export const FEEDBACK_TEXT_MAX = 2000;

/** The owner's wording, exactly (2026-10-29). copy-lint lets this one sentence keep its "!". */
export const FEEDBACK_THANKS = 'Thank you! Each and every comment is appreciated and reviewed to help make this community a better place for us all.';

const KINDS: readonly { id: FeedbackKind; label: string }[] = [
  { id: 'complaint', label: 'Complaint' },
  { id: 'feedback', label: 'Feedback' },
  { id: 'recommendation', label: 'Recommendation' },
];

/** The refusal code from `?from=`, when it has the API's shape; anything else is dropped. */
export function fromCode(search: string): string | null {
  const v = new URLSearchParams(search).get('from');
  return v !== null && /^[a-z0-9-]{1,40}$/.test(v) ? v : null;
}

export function sendFeedback(b: { kind: FeedbackKind; text: string; anonymous: boolean; from: string | null }): Promise<unknown> {
  // An anonymous send leaves the refusal code off (the API would drop it anyway).
  return api('/v1/feedback/form', { method: 'POST', body: b.from === null || b.anonymous ? { kind: b.kind, text: b.text, anonymous: b.anonymous } : b });
}

type State = { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent' } | { kind: 'signed-out' } | { kind: 'failed'; message: string };

export function Feedback() {
  const { pathname, search, key } = useLocation();
  const navigate = useNavigate();
  const from = fromCode(search);
  const [kind, setKind] = useState<FeedbackKind>('feedback');
  const [text, setText] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const textId = useId();
  const hintId = useId();

  const clean = text.trim();
  const tooLong = [...clean].length > FEEDBACK_TEXT_MAX;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (clean === '' || tooLong || state.kind === 'sending') return;
    setState({ kind: 'sending' });
    try {
      await sendFeedback({ kind, text: clean, anonymous, from });
      setState({ kind: 'sent' });
    } catch (err) {
      if (err instanceof ApiCallError && err.status === 401) setState({ kind: 'signed-out' });
      else if (err instanceof ApiCallError && (err.status === 429 || err.status === 503)) setState({ kind: 'failed', message: waitSentence(err.retryAfterSeconds) });
      // COPY-UNSIGNED
      else setState({ kind: 'failed', message: 'That did not send. Try again in a moment.' });
    }
  };

  if (state.kind === 'sent') {
    return (
      <main className="x2f-screen" data-screen="feedback">
        <h1 className="x2f-screen__title">Feedback</h1>
        <p role="status" data-part="feedback-thanks">
          {FEEDBACK_THANKS}
        </p>
        <Button variant="primary" onClick={() => void (key === 'default' ? navigate('/sell') : navigate(-1))}>
          Done
        </Button>
      </main>
    );
  }

  return (
    <main className="x2f-screen" data-screen="feedback">
      <h1 className="x2f-screen__title">Feedback</h1>
      {/* COPY-UNSIGNED */}
      <p className="x2f-note">A complaint, feedback, a recommendation, anything. Every comment is read.</p>
      <form className="x2f-stack" onSubmit={(e) => void submit(e)}>
        <fieldset className="x2f-field">
          <legend className="x2f-label">What is it?</legend>
          <div className="x2f-row">
            {KINDS.map((k) => (
              <label key={k.id}>
                <input type="radio" name="feedback-kind" value={k.id} checked={kind === k.id} onChange={() => setKind(k.id)} />
                {k.label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="x2f-field">
          <label htmlFor={textId} className="x2f-label">
            Your comment
          </label>
          <textarea
            id={textId}
            className="x2f-input"
            rows={6}
            value={text}
            maxLength={FEEDBACK_TEXT_MAX}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <label className="x2f-row">
          <input type="checkbox" checked={anonymous} aria-describedby={hintId} onChange={(e) => setAnonymous(e.target.checked)} />
          Send anonymously
        </label>
        {/* COPY-UNSIGNED */}
        <p id={hintId} className="x2f-note" data-part="anon-hint">
          {anonymous
            ? 'Sent without your username, so nobody at X2F knows it was you, and nobody can ask you about it.'
            : 'Sent with your username, so X2F staff can message you for details.'}
        </p>
        {state.kind === 'signed-out' ? (
          <p className="x2f-error" role="alert">
            <Link className="x2f-link" to={`/login?returnTo=${encodeURIComponent(safeReturnTo(pathname + search))}`}>
              Log in
            </Link>{' '}
            to send feedback.
          </p>
        ) : null}
        {state.kind === 'failed' ? (
          <p className="x2f-error" role="alert">
            {state.message}
          </p>
        ) : null}
        <Button variant="primary" type="submit" disabled={clean === '' || tooLong || state.kind === 'sending'} aria-busy={state.kind === 'sending'}>
          Send
        </Button>
      </form>
    </main>
  );
}
