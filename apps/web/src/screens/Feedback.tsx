/**
 * The feedback form (Plan 5 Task 21; owner, 2026-10-29, spec 5.2), opened from the "feedback" link
 * every CantDoThat popup carries (`/feedback?from=<refusal code>`). A complaint, feedback or a
 * recommendation, sent named (staff can reach out for details) or, with "Send anonymously", with
 * no record of who sent it. `POST /v1/feedback/form`; the API keeps no account id, session or
 * address on an anonymous row and drops the refusal code from it too. The copy promises only that
 * (review M1: the database's own row order is a residual, docs/coordination.md).
 *
 * A signed-out visitor is told before typing (review M6), and a draft is kept in this tab's
 * sessionStorage through the log-in round trip; it is dropped once sent. After Send, focus moves to
 * the thank-you heading (review M7).
 *
 * No board exists for this screen yet (Claude Design brief 2026-10-29, item 5): it is built from the
 * existing kit classes only, with no styling of its own, and is matched to the board when it lands
 * (tripwire NEEDS_DESIGN_CANTDOTHAT). The owner's words are used where he gave them (the checkbox
 * and the thank-you); the rest is marked COPY-UNSIGNED.
 */
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ApiCallError, api, safeReturnTo } from '../api/client.js';
import { useSession } from '../session/useSession.js';
import { Button } from '../ui/Button.js';
import { waitSentence } from './auth/refusals.js';
import './screens.css';

export type FeedbackKind = 'complaint' | 'feedback' | 'recommendation';

export const FEEDBACK_TEXT_MAX = 2000;

/** The anonymous hint (review M1: only what is strictly true). COPY-UNSIGNED */
export const FEEDBACK_ANON_HINT = "Sent without your username. We don't record who sent it, so nobody can ask you about it.";
/** A 400 from the form. COPY-UNSIGNED */
export const FEEDBACK_BAD_TEXT = 'Your comment has a hidden character the form does not take. Retype it, or paste it as plain text.';

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

const DRAFT_KEY = 'x2f.feedback-draft';

interface Draft {
  kind: FeedbackKind;
  text: string;
  anonymous: boolean;
}

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** The draft kept through a log-in round trip (this tab only), or null. */
export function loadFeedbackDraft(): Draft | null {
  try {
    const raw = storage()?.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<Draft>;
    const kind = KINDS.find((k) => k.id === d.kind)?.id;
    if (kind === undefined || typeof d.text !== 'string' || typeof d.anonymous !== 'boolean') return null;
    return { kind, text: d.text.slice(0, FEEDBACK_TEXT_MAX * 2), anonymous: d.anonymous };
  } catch {
    return null;
  }
}

function saveDraft(d: Draft): void {
  try {
    if (d.text === '') storage()?.removeItem(DRAFT_KEY);
    else storage()?.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    // Storage can be off (private mode); the form still works without a draft.
  }
}

function clearDraft(): void {
  try {
    storage()?.removeItem(DRAFT_KEY);
  } catch {
    // As saveDraft.
  }
}

type State = { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent' } | { kind: 'signed-out' } | { kind: 'failed'; message: string };

export function Feedback() {
  const { pathname, search, key } = useLocation();
  const navigate = useNavigate();
  const from = fromCode(search);
  const session = useSession();
  const [draft] = useState(loadFeedbackDraft);
  const [kind, setKind] = useState<FeedbackKind>(draft?.kind ?? 'feedback');
  const [text, setText] = useState(draft?.text ?? '');
  const [anonymous, setAnonymous] = useState(draft?.anonymous ?? false);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const textId = useId();
  const hintId = useId();
  const thanks = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (state.kind !== 'sent') saveDraft({ kind, text, anonymous });
  }, [kind, text, anonymous, state.kind]);
  useEffect(() => {
    if (state.kind === 'sent') thanks.current?.focus();
  }, [state.kind]);
  const signedOut = session.status === 'signed-out' || state.kind === 'signed-out';
  const loginHref = `/login?returnTo=${encodeURIComponent(safeReturnTo(pathname + search))}`;

  const clean = text.trim();
  const tooLong = [...clean].length > FEEDBACK_TEXT_MAX;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (clean === '' || tooLong || state.kind === 'sending') return;
    setState({ kind: 'sending' });
    try {
      await sendFeedback({ kind, text: clean, anonymous, from });
      clearDraft();
      setState({ kind: 'sent' });
    } catch (err) {
      if (err instanceof ApiCallError && err.status === 401) setState({ kind: 'signed-out' });
      else if (err instanceof ApiCallError && (err.status === 429 || err.status === 503)) setState({ kind: 'failed', message: waitSentence(err.retryAfterSeconds) });
      // COPY-UNSIGNED. A 400: the text holds a character the form does not take (a hidden control
      // or direction mark), which retrying would never fix.
      else if (err instanceof ApiCallError && err.status === 400) setState({ kind: 'failed', message: FEEDBACK_BAD_TEXT });
      // COPY-UNSIGNED
      else setState({ kind: 'failed', message: 'That did not send. Try again in a moment.' });
    }
  };

  if (state.kind === 'sent') {
    return (
      <main className="x2f-screen" data-screen="feedback">
        <h1 className="x2f-screen__title" tabIndex={-1} ref={thanks} data-part="feedback-thanks-heading">
          Feedback sent
        </h1>
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
      {session.status === 'signed-out' && state.kind !== 'signed-out' ? (
        <p className="x2f-note" data-part="feedback-login-first">
          {/* COPY-UNSIGNED */}
          <Link className="x2f-link" to={loginHref}>
            Log in
          </Link>{' '}
          to send feedback. You can write it first: it is kept while you log in.
        </p>
      ) : null}
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
            ? FEEDBACK_ANON_HINT
            : 'Sent with your username, so X2F staff can message you for details.'}
        </p>
        {state.kind === 'signed-out' ? (
          <p className="x2f-error" role="alert">
            <Link className="x2f-link" to={loginHref}>
              Log in
            </Link>{' '}
            to send feedback. What you wrote is kept.
          </p>
        ) : null}
        {state.kind === 'failed' ? (
          <p className="x2f-error" role="alert">
            {state.message}
          </p>
        ) : null}
        <Button variant="primary" type="submit" disabled={clean === '' || tooLong || state.kind === 'sending' || signedOut} aria-busy={state.kind === 'sending'}>
          Send
        </Button>
      </form>
    </main>
  );
}
