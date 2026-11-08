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
 * Laid out from the Feedback board (origin/wip/design-brief docs/design-boards/Feedback.dc.html,
 * views form and sent; design review 1 Nov shots 62-63) with UI-kit parts only: the back header,
 * "Tell us what you think", a 9-row message box with its count, "Send anonymously" as a 24px box in
 * a 44px row, and the thank-you with "Sent as <name>." and Write another. The kind is not on the
 * board and has no choice (design build review 7 Nov): a draft keeps its kind, a new message is
 * feedback. The owner's words are used where he
 * gave them (the checkbox and the thank-you); board copy is used as drawn; the rest is COPY-UNSIGNED.
 */
import { FEEDBACK_FORM_DAILY } from '@x2f/core';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ApiCallError, api, safeReturnTo } from '../api/client.js';
import { displayNameOf, useSession } from '../session/useSession.js';
import { clearFeedbackDraft, loadFeedbackDraft, saveFeedbackDraft } from './feedbackDraft.js';
import { Button } from '../ui/Button.js';
import { CheckRow } from '../ui/CheckRow.js';
import { FlowScreen } from '../ui/FlowScreen.js';
import { Icon } from '../ui/icons.js';
import { waitSentence } from './auth/refusals.js';
import './screens.css';

export type FeedbackKind = 'complaint' | 'feedback' | 'recommendation';

export const FEEDBACK_TEXT_MAX = 2000;

/** The anonymous hint (design session 2 Nov; still only what is strictly true, review M1). COPY-UNSIGNED */
// not-a-refusal: says what an anonymous message means for a reply, nothing is refused
export const FEEDBACK_ANON_HINT = "Your username isn't attached, so we can't follow up with you.";
/** The named hint (design session 2 Nov). COPY-UNSIGNED */
export const FEEDBACK_NAMED_HINT = 'Your username is attached, so we can reply in the app.';
/** A 400 from the form. COPY-UNSIGNED */
export const FEEDBACK_BAD_TEXT = 'Your comment has a hidden character the form does not take. Retype it, or paste it as plain text.';

/**
 * Owner Q67 (6 Nov 2026): at most 10 sends a day, and the 11th says the limit is there to stop spam.
 * COPY-UNSIGNED, DESIGNER-REVIEW: design words it (the owner asked design to).
 */
export const FEEDBACK_DAILY_LIMIT = `You've sent ${FEEDBACK_FORM_DAILY} today, the most for one day. The limit helps keep spam out. You can send more tomorrow.`;

/** The owner's wording, exactly (2026-10-29). copy-lint lets this one sentence keep its "!". */
export const FEEDBACK_THANKS = 'Thank you! Each and every comment is appreciated and reviewed to help make this community a better place for us all.';
/** The Feedback board sets the owner's sentence as the heading "Thank you!" and the line under it. */
const THANKS_SPLIT = FEEDBACK_THANKS.search(/[.!?] /) + 1;
const THANKS_HEAD = FEEDBACK_THANKS.slice(0, THANKS_SPLIT);
const THANKS_BODY = FEEDBACK_THANKS.slice(THANKS_SPLIT + 1);


/** The refusal code from `?from=`, when it has the API's shape; anything else is dropped. */
export { clearFeedbackDraft, loadFeedbackDraft };

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
  const session = useSession();
  // The signed-in account's public name, or null while signed out or loading; a draft another
  // account wrote is never shown (round-2 review N-M6).
  const owner = session.status === 'signed-in' ? displayNameOf(session.me) || null : null;
  const [draft, setDraft] = useState(() => loadFeedbackDraft(null));
  // The board has no kind choice: a draft keeps the kind it had, a new message is feedback.
  const [kind, setKind] = useState<FeedbackKind>(draft?.kind ?? 'feedback');
  const [text, setText] = useState(draft?.text ?? '');
  const [anonymous, setAnonymous] = useState(draft?.anonymous ?? false);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const textId = useId();
  const countId = useId();
  const formId = useId();
  const box = useRef<HTMLTextAreaElement>(null);
  const focusBox = useRef(false);
  // Who the last message went as, for the thank-you's "Sent as <name>." (Feedback board).
  const [sentAnonymously, setSentAnonymously] = useState(false);
  const thanks = useRef<HTMLHeadingElement>(null);

  // Once the account is known, a draft written by a different account is dropped.
  useEffect(() => {
    if (owner === null || draft === null || draft.owner === null || draft.owner === owner) return;
    clearFeedbackDraft();
    setDraft(null);
    setKind('feedback');
    setText('');
    setAnonymous(false);
  }, [owner, draft]);
  useEffect(() => {
    const foreign = owner !== null && draft !== null && draft.owner !== null && draft.owner !== owner;
    if (state.kind !== 'sent' && session.status !== 'loading' && !foreign) saveFeedbackDraft({ kind, text, anonymous, owner });
  }, [kind, text, anonymous, state.kind, owner, session.status, draft]);
  useEffect(() => {
    if (state.kind === 'sent') thanks.current?.focus();
    else if (focusBox.current) {
      focusBox.current = false;
      box.current?.focus();
    }
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
      clearFeedbackDraft();
      setSentAnonymously(anonymous);
      setState({ kind: 'sent' });
    } catch (err) {
      if (err instanceof ApiCallError && err.status === 401) setState({ kind: 'signed-out' });
      else if (err instanceof ApiCallError && err.status === 429 && err.extra.limit === 'daily') setState({ kind: 'failed', message: FEEDBACK_DAILY_LIMIT });
      else if (err instanceof ApiCallError && (err.status === 429 || err.status === 503)) setState({ kind: 'failed', message: waitSentence(err.retryAfterSeconds) });
      // COPY-UNSIGNED. A 400: the text holds a character the form does not take (a hidden control
      // or direction mark), which retrying would never fix.
      else if (err instanceof ApiCallError && err.status === 400) setState({ kind: 'failed', message: FEEDBACK_BAD_TEXT });
      // COPY-UNSIGNED
      else setState({ kind: 'failed', message: 'That did not send. Try again in a moment.' });
    }
  };

  const back = () => void (key === 'default' ? navigate('/sell') : navigate(-1));
  const backControl = { label: 'Back', onClick: back };

  if (state.kind === 'sent') {
    return (
      <FlowScreen
        screen="feedback"
        title="Feedback"
        titleAs="label"
        back={backControl}
        footer={
          <>
            <Button variant="primary" onClick={back}>
              Done
            </Button>
            <Button
              variant="quiet"
              onClick={() => {
                setText('');
                setState({ kind: 'idle' });
                // Review N3: focus goes to the new message box, not lost with the button.
                focusBox.current = true;
              }}
            >
              Write another
            </Button>
          </>
        }
      >
        <div className="x2f-done">
          <span className="x2f-done__mark">
            <Icon name="check" size={32} stroke={2} />
          </span>
          <div className="x2f-done__text" data-part="feedback-thanks" role="status">
            <h1 className="x2f-h2 x2f-done__title" tabIndex={-1} ref={thanks} data-part="feedback-thanks-heading">
              {THANKS_HEAD}
            </h1>{' '}
            <p className="x2f-body">{THANKS_BODY}</p>
          </div>
          {/* The board's line under the thanks: who it was sent as. */}
          <p className="x2f-fine" data-part="feedback-sent-as">
            {sentAnonymously || owner === null ? 'Sent anonymously.' : `Sent as ${owner}.`}
          </p>
        </div>
      </FlowScreen>
    );
  }

  return (
    <FlowScreen
      screen="feedback"
      title="Feedback"
      titleAs="label"
      back={backControl}
      footer={
        <Button variant="primary" type="submit" form={formId} disabled={clean === '' || tooLong || state.kind === 'sending' || signedOut} aria-busy={state.kind === 'sending'}>
          Send
        </Button>
      }
    >
      <form id={formId} onSubmit={(e) => void submit(e)}>
        <section className="x2f-stack">
          <h1 className="x2f-h2">Tell us what you think</h1>
          <p className="x2f-lead">A complaint, feedback, a recommendation, anything at all. Every message is read.</p>
        </section>
        {session.status === 'signed-out' && state.kind !== 'signed-out' ? (
          <p className="x2f-note" data-part="feedback-login-first">
            {/* COPY-UNSIGNED */}
            <Link className="x2f-link" to={loginHref}>
              Log in
            </Link>{' '}
            to send feedback. You can write it first: it is kept while you log in.
          </p>
        ) : null}
        {/* The Feedback board (design build review 7 Nov): no "What is it?" choice; a new message is sent as feedback. */}
        <div className="x2f-field">
          <label htmlFor={textId} className="x2f-field-label">
            Your message
          </label>
          <textarea
            id={textId}
            ref={box}
            className="x2f-input x2f-input--message"
            rows={9}
            value={text}
            maxLength={FEEDBACK_TEXT_MAX}
            placeholder="Write anything you like"
            aria-describedby={countId}
            onChange={(e) => setText(e.target.value)}
          />
          {/* Counts what maxLength counts (review N8). */}
          <span id={countId} className="x2f-field-count" data-part="feedback-count">
            <span className="x2f-when">{text.length}</span> of {FEEDBACK_TEXT_MAX} characters
          </span>
        </div>
        {/* COPY-UNSIGNED */}
        <CheckRow
          boxed
          part="feedback-anon"
          hintPart="anon-hint"
          checked={anonymous}
          onChange={setAnonymous}
          title="Send anonymously"
          hint={anonymous ? FEEDBACK_ANON_HINT : FEEDBACK_NAMED_HINT}
        />
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
      </form>
    </FlowScreen>
  );
}
