import { Link } from 'react-router';
import { Button } from './Button.js';
import { feedbackHref } from './cantDoCodes.js';
import { Sheet } from './Sheet.js';

/**
 * The one popup that tells a user they can't do something (Plan 5 Task 21; owner, 2026-10-29,
 * spec 5.2). It always ends with the owner's line "If you feel this feature can be improved please
 * leave feedback", with "feedback" linking to the form at `/feedback?from=<refusal code>`.
 *
 * Every refusal in the app goes through here: `tools/copy-lint.ts` (rule `refusal`) fails a file
 * that words a refusal, or names one of CANT_DO_CODES (cantDoCodes.ts), without importing this
 * module or cantDoCodes.ts, unless the line (or the one above) says `// not-a-refusal: <why>`.
 *
 * The body sits in a `role="alert"` paragraph so a screen reader hears it when the popup opens;
 * the popup has no primary button (the screen under it keeps its one `data-primary`).
 *
 * No board exists yet (Claude Design brief 2026-10-29, item 4): built from the kit's Sheet, Button
 * and existing classes only, with no styling of its own; matched to the board when it lands
 * (tripwire NEEDS_DESIGN_CANTDOTHAT in test/CantDoThat.test.tsx).
 */

/** The owner's sentence, split around the linked word. */
export const FEEDBACK_LINE = { before: 'If you feel this feature can be improved please leave ', link: 'feedback', after: '' } as const;

export { CANT_DO_CODES, feedbackHref, isCantDoCode, type CantDoCode } from './cantDoCodes.js';

export function CantDoThat({
  open = true,
  title,
  body,
  from,
  items,
  onClose,
}: {
  open?: boolean;
  title: string;
  body: string;
  /** The refusal code, passed on to the form (`/feedback?from=`). */
  from: string;
  /** Which things were refused and why, one line each, under the body (My offers' mixed case). */
  items?: readonly string[] | undefined;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} title={title} onClose={onClose}>
      <div className="x2f-stack" data-part="cant-do-that" data-from={from}>
        <p role="alert">
          {body}
        </p>
        {items && items.length > 0 ? (
          <ul className="x2f-list" data-part="cant-do-items">
            {items.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        ) : null}
        <p className="x2f-note" data-part="feedback-line">
          {FEEDBACK_LINE.before}
          <Link className="x2f-link" to={feedbackHref(from)}>
            {FEEDBACK_LINE.link}
          </Link>
          {FEEDBACK_LINE.after}
        </p>
        <Button variant="secondary" onClick={onClose}>
          OK
        </Button>
      </div>
    </Sheet>
  );
}
