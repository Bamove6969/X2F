import { useId } from 'react';
import { Link } from 'react-router';
import { Button } from './Button.js';
import { Icon } from './icons.js';
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
 * The body sits in a `role="alert"` paragraph so a screen reader hears it when the popup opens.
 *
 * Boards CantDoThat / CantDoThat-Wide (design v2 batch 2, wip/design-brief 0955ab95; supersede the
 * review's X2 note): the one shared refusal dialog. Phone: a bottom sheet with a grab handle;
 * Desktop: a centred dialog (`wide="dialog"`). An info tile above the title, the title defaulting
 * to the board's "You can't do that yet", the message as the dialog's description, the feedback
 * line in an info block, and OK the one orange button. No X: OK, a tap on the scrim, a swipe down
 * and Escape close it. Built from the kit's Sheet, Button and classes only. The board is not in
 * design/x2f-app yet, so there is no parity entry (tripwire NEEDS_DESIGN_CANTDOTHAT in
 * test/cantDoThat-lint.test.ts).
 */

/** The owner's sentence, split around the linked word. */
export const FEEDBACK_LINE = { before: 'If you feel this feature can be improved please leave ', link: 'feedback', after: '' } as const;

/** The board's title, used when a refusal gives none. */
export const CANT_DO_DEFAULT_TITLE = "You can't do that yet";

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
  title?: string;
  body: string;
  /** The refusal code, passed on to the form (`/feedback?from=`). */
  from: string;
  /** Which things were refused and why, one line each, under the body (My offers' mixed case). */
  items?: readonly string[] | undefined;
  onClose: () => void;
}) {
  const msgId = useId();
  return (
    <Sheet
      open={open}
      title={title ?? CANT_DO_DEFAULT_TITLE}
      lead={
        <span className="x2f-icon-tile" data-part="cant-do-tile" aria-hidden="true">
          <Icon name="info" size={20} />
        </span>
      }
      describedBy={msgId}
      closeButton={false}
      handle
      wide="dialog"
      onClose={onClose}
    >
      <div className="x2f-stack" data-part="cant-do-that" data-from={from}>
        <p role="alert" id={msgId}>
          {body}
        </p>
        {items && items.length > 0 ? (
          <ul className="x2f-list" data-part="cant-do-items">
            {items.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        ) : null}
        <p className="x2f-info-block" data-part="feedback-line">
          {FEEDBACK_LINE.before}
          <Link className="x2f-link" to={feedbackHref(from)}>
            {FEEDBACK_LINE.link}
          </Link>
          {FEEDBACK_LINE.after}
        </p>
        <Button variant="primary" onClick={onClose}>
          OK
        </Button>
      </div>
    </Sheet>
  );
}
