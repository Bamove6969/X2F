/**
 * The seller's warning before the release hold (Plan 3 Task 38; board Warn-Release.dc.html on
 * wip/design-brief, whose wording wins over the plan's meaning-only text): "Before you release /
 * Is the $412.50 really in your account?", then It's in my account or I'll check again.
 *
 * SellerConfirm opens it on "Payment received", the completed hold (design proto review P2), until
 * the seller goes past it once for that trade on this device (warned.ts); "It's in my account"
 * goes on with the release. Owner p7-2: a "Do not show me this warning again" tick, handed to
 * `onOk`, skips it for this user on this device from then on (confirmSkip.ts). COPY-UNSIGNED.
 */
import { useEffect, useId, useState } from 'react';
import { Button } from '../../ui/Button.js';
import { Sheet } from '../../ui/Sheet.js';
import './pay.css';
import './warn.css';

export function ReleaseWarning({
  open,
  fiat,
  amount,
  buyer,
  methodName,
  onOk,
  onBack,
}: {
  open: boolean;
  /** This device's fiat total ("$412.50"), or null while it has none. */
  fiat: string | null;
  /** This device's XMR amount ("1.250000 XMR"), or null while it has none. */
  amount: string | null;
  buyer: string;
  methodName: string;
  /** `dontShow`: the seller ticked "Do not show me this warning again". */
  onOk(dontShow: boolean): void;
  onBack(): void;
}) {
  const textId = useId();
  const dontShowId = useId();
  const [dontShow, setDontShow] = useState(false);
  useEffect(() => {
    if (open) setDontShow(false);
  }, [open]);
  return (
    <Sheet open={open} eyebrow="Before you release" describedBy={textId} initialFocus="[data-safe]" title={fiat !== null ? `Is the ${fiat} really in your account?` : 'Is the payment really in your account?'} onClose={onBack}>
      <div className="x2f-sheet__body x2f-warn" data-warning="release">
        <div id={textId} className="x2f-warn">
        <p className="x2f-warn__text x2f-warn__text--strong">Only release once the money is really in your account.</p>
        {/* COPY-UNSIGNED: the board says "Zelle app" for its Zelle trade; other methods name their own app the same way. */}
        <p className="x2f-warn__text">Check your own bank or {methodName} app, not a screenshot. Screenshots can be faked.</p>
        <p className="x2f-warn__text x2f-warn__text--muted">
          {/* "the XMR" (COPY-UNSIGNED) only before this device has the amount; the board always has it. */}
          Once released, {amount !== null && fiat !== null ? `the ${amount} (about ${fiat})` : 'the XMR'} goes to{' '}
          {/* not-a-refusal: the warning explains that a release is final; nothing is refused here */}
          <span data-username="">{buyer}</span> and can't be taken back.
        </p>
        </div>
        <label htmlFor={dontShowId} className="x2f-paid__check x2f-paid__check--quiet">
          <input id={dontShowId} type="checkbox" checked={dontShow} onChange={(e) => setDontShow(e.target.checked)} />
          <span>Do not show me this warning again</span>
        </label>
        <div className="x2f-warn__actions">
          <Button variant="primary" onClick={() => onOk(dontShow)}>
            It's in my account
          </Button>
          <Button variant="secondary" data-safe="" onClick={onBack}>
            I'll check again
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
