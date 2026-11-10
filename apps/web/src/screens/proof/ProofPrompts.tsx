import { useId, useState } from 'react';
import { Button } from '../../ui/Button.js';
import { Icon } from '../../ui/icons.js';
import { Notice } from '../../ui/Notice.js';
import { Sheet } from '../../ui/Sheet.js';

// DESIGNER-REVIEW: everything in this file. Owner Q21 (2026-11-03): the designer is out, so these
// are built now from the kit (Sheet, Notice, Button and the CantDoThat dialog's classes: info tile,
// grab handle, centred dialog on Desktop), with no board; the designer restyles them later. There
// is no parity entry until a board exists.
//
// The pop-ups go to the person POSTING the proof (owner items 63 and 64, 2026-11-02 04:08); which
// one shows is `uploaderPopup` in src/proof/uploaderChecks.ts; they plug into Plan 5 Task 15's
// BlurEditor (see that file's header). They are input checks on the screenshot, not X2F rules
// refusing the person, so they are not CantDoThat refusals (no refusal code, no feedback-form link).

// COPY-UNSIGNED: the owner's wording (item 63), to sign.
export const PROOF_NOT_CURRENT = 'The screenshot submitted is not current. Please redo proof and resubmit.';
// COPY-UNSIGNED: the owner's wording (item 64), to sign; "the feedback tool below" is the comment box.
// not-a-refusal: a check on the screenshot, asking for an explanation; the proof can still be sent
export const PROOF_NO_AMOUNT = 'Our automated system was unable to detect the amount sent in your screenshot. Please use the feedback tool below and leave an explanation.';
// COPY-UNSIGNED: the owner's draft (2026-11-02 08:17).
export const PROOF_AMOUNT_HIDDEN = 'The amount is hidden, so the seller may not be able to check your payment.';
// COPY-UNSIGNED: draft, not the owner's words (OWNER-Q: the owner's line names the amount only).
export const PROOF_MEMO_HIDDEN = "The note with this trade's code is hidden, so the seller may not be able to match your payment.";
// COPY-UNSIGNED: draft (item 65, X2F's own screen sent as fake proof), for the seller's proof card
// (Task 16's SmartProofCard, beside the board's "Screenshots can be faked").
export const PROOF_FAKE_DISCLAIMER = "A screenshot can even be a copy of X2F's own payment screen. Only your bank shows whether the money arrived.";

/** The explanation's length limit (as the platform feedback note; technical call). */
export const PROOF_EXPLANATION_MAX = 500;

/**
 * Lead default pending owner p11-141 (review 2026-11-10 finding 4; owner Q43, "the buyer can say yes
 * and post it anyways"): the explanation is optional, so Send proof works with an empty box.
 */
export const PROOF_EXPLANATION_REQUIRED = false;

function InfoTile() {
  return (
    <span className="x2f-icon-tile" data-part="cant-do-tile" aria-hidden="true">
      <Icon name="info" size={20} />
    </span>
  );
}

/** Item 63: the screenshot's date is outside the trade. Its one button (and closing it) goes back to redo the proof; nothing is sent. */
export function ProofNotCurrent({ open = true, onRedo }: { open?: boolean; onRedo: () => void }) {
  const msgId = useId();
  return (
    // COPY-UNSIGNED: title and button.
    <Sheet open={open} title="Screenshot not current" lead={<InfoTile />} describedBy={msgId} closeButton={false} handle wide="dialog" onClose={onRedo}>
      <div className="x2f-stack" data-part="proof-popup" data-popup="not-current">
        <p id={msgId} data-part="proof-not-current">
          {PROOF_NOT_CURRENT}
        </p>
        <Button variant="primary" onClick={onRedo}>
          Redo proof
        </Button>
      </div>
    </Sheet>
  );
}

/**
 * Item 64: no amount found. The comment box under the owner's sentence is "the feedback tool below";
 * **Send proof** sends with the trimmed explanation, `''` when none is written
 * (`PROOF_EXPLANATION_REQUIRED`, lead default pending owner p11-141). Closing it goes back to the
 * editor; nothing is sent.
 *
 * TODO(owner p11-141): the explanation goes nowhere yet: `onSend` hands it to the caller, and no
 * caller sends it to the seller, a moderator or X2F's detection feedback. Q43's "X2F keeps these to
 * improve detection" is not built (proofs are end-to-end sealed; it needs a privacy design first).
 */
export function ProofNoAmount({
  open = true,
  onSend,
  onChooseAnother,
  onClose,
}: {
  open?: boolean;
  onSend: (explanation: string) => void;
  onChooseAnother: () => void;
  onClose: () => void;
}) {
  const msgId = useId();
  const boxId = useId();
  const [text, setText] = useState('');
  const clean = text.trim();
  return (
    // COPY-UNSIGNED: title, label and buttons.
    <Sheet open={open} title="Amount not found" lead={<InfoTile />} describedBy={msgId} closeButton={false} handle wide="dialog" onClose={onClose}>
      <div className="x2f-stack" data-part="proof-popup" data-popup="no-amount">
        <p id={msgId} data-part="proof-no-amount">
          {PROOF_NO_AMOUNT}
        </p>
        <div className="x2f-field">
          <label htmlFor={boxId} className="x2f-label">
            Your explanation
          </label>
          <textarea id={boxId} className="x2f-input" rows={4} maxLength={PROOF_EXPLANATION_MAX} value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <Button variant="primary" disabled={PROOF_EXPLANATION_REQUIRED && clean === ''} onClick={() => onSend(clean)}>
          Send proof
        </Button>
        <Button variant="secondary" onClick={onChooseAnother}>
          Choose another screenshot
        </Button>
      </div>
    </Sheet>
  );
}

/** Owner 2026-11-02 08:17: the uploader's own blur covers the amount or the memo. A warning only: posting is still allowed. */
export function ProofHiddenByYou({ hidden }: { hidden: { amount: boolean; memo: boolean } }) {
  if (!hidden.amount && !hidden.memo) return null;
  const text = [hidden.amount ? PROOF_AMOUNT_HIDDEN : null, hidden.memo ? PROOF_MEMO_HIDDEN : null].filter((t) => t !== null).join(' ');
  return (
    <Notice tone="caution" live="status" data-part="proof-hidden-by-you">
      {text}
    </Notice>
  );
}

/** Item 65: the disclaimer for the seller's proof card (Task 16). */
export function ProofFakeDisclaimer() {
  return (
    <p className="x2f-note" data-part="proof-fake-disclaimer">
      {PROOF_FAKE_DISCLAIMER}
    </p>
  );
}
