import { useId, useState } from 'react';
import { Button } from '../../ui/Button.js';

// DESIGNER-REVIEW: no board yet (P-012/P-013); built from the kit like ProofPrompts.tsx.
// Owner Q47: "Was this proof posted with confidential information blurred correctly? ... or ask
// design for help in wording that. And if they say no, it'll ask them for comment and say, 'Please
// help us improve the system'". p9-8: both parties are asked. All strings COPY-UNSIGNED.

// COPY-UNSIGNED: the question (design words it; owner Q47's sense).
export const BLUR_CHECK_QUESTION = 'Did our privacy tool hide the right details on this proof?';
// COPY-UNSIGNED: the comment box after a No (owner Q47: "Please help us improve the system").
export const BLUR_CHECK_COMMENT_LABEL = 'Please help us improve: what was wrong?';
// COPY-UNSIGNED: after an answer.
export const BLUR_CHECK_THANKS = 'Thanks, this helps us improve.';
/** As the API's limit (@x2f/proof BLUR_CHECK_COMMENT_MAX). */
export const BLUR_CHECK_COMMENT_MAX = 500;

export type BlurCheckAnswer = { correct: true } | { correct: false; comment?: string };

/**
 * One tap for Yes. No opens an optional comment box; Send hands over the trimmed comment, or none.
 * `onAnswer` sends it (api/blurCheck.ts `answerBlurCheck`).
 */
export function BlurCheck({ onAnswer }: { onAnswer: (a: BlurCheckAnswer) => Promise<void> }) {
  const boxId = useId();
  const [step, setStep] = useState<'ask' | 'comment' | 'done'>('ask');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (a: BlurCheckAnswer) => {
    setBusy(true);
    try {
      await onAnswer(a);
      setStep('done');
    } finally {
      setBusy(false);
    }
  };
  if (step === 'done') {
    return (
      <p className="x2f-note" data-part="blur-check-thanks">
        {BLUR_CHECK_THANKS}
      </p>
    );
  }
  return (
    <section className="x2f-stack" data-part="blur-check" aria-label="Proof privacy check">
      <p data-part="blur-check-question">{BLUR_CHECK_QUESTION}</p>
      {step === 'ask' ? (
        <div className="x2f-stack" data-part="blur-check-answers">
          {/* COPY-UNSIGNED: Yes and No. */}
          <Button variant="primary" disabled={busy} onClick={() => void send({ correct: true })}>
            Yes
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => setStep('comment')}>
            No
          </Button>
        </div>
      ) : (
        <>
          <div className="x2f-field">
            <label htmlFor={boxId} className="x2f-label">
              {BLUR_CHECK_COMMENT_LABEL}
            </label>
            <textarea id={boxId} className="x2f-input" rows={3} maxLength={BLUR_CHECK_COMMENT_MAX} value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          {/* COPY-UNSIGNED: Send. */}
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              const c = text.trim();
              void send(c === '' ? { correct: false } : { correct: false, comment: c });
            }}
          >
            Send
          </Button>
        </>
      )}
    </section>
  );
}
