import { useId } from 'react';
import { Button } from '../../ui/Button.js';
import { Icon } from '../../ui/icons.js';
import { Sheet } from '../../ui/Sheet.js';

/**
 * "Mark paid without proof?" (BuyerPay board, confirm=noproof; build spec j31a section 4, T-079).
 * I've paid with no payment proof attached asks first, every time: there is no "don't show again"
 * (lead's default). The body is the owner's own sentence ("proof is usually what decides which side
 * wins", kept per docs/to-lead.md 9 Nov over the spec's later redraft). "Add proof" goes back to the
 * pay screen's proof slot (the board's ProofBlur is the editor that opens from it); "Mark paid
 * without proof" goes on to the confirm sheet. COPY-UNSIGNED
 */
export function NoProofSheet({ onAddProof, onWithoutProof }: { onAddProof: () => void; onWithoutProof: () => void }) {
  const bodyId = useId();
  return (
    <Sheet open title="Mark paid without proof?" describedBy={bodyId} handle onClose={onAddProof}>
      <div className="x2f-sheet__body x2f-paid" data-sheet="no-proof">
        <p className="x2f-paid__noproof">
          <Icon name="alert" size={18} stroke={1.75} />
          <span id={bodyId}>
            You haven't added a payment screenshot. If this trade ever goes to a dispute, proof is usually what decides which side wins. It's your choice.
          </span>
        </p>
        <div className="x2f-paid__actions">
          <Button variant="primary" onClick={onAddProof}>
            Add proof
          </Button>
          <Button variant="secondary" onClick={onWithoutProof}>
            Mark paid without proof
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
