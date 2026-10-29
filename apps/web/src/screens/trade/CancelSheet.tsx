/**
 * Cancelling a funded trade (spec 2.3):
 * - CancelSheet: the buyer's cancel after "I've paid" asks first, with the strong warning, and
 *   cancels only on its own confirm button (before "I've paid" the buyer cancels with one tap
 *   and no sheet; BuyerPay does that).
 * - SellerCancelControls: the seller never cancels alone after funding, so the seller's room gets
 *   only Propose cancel (a mutual cancel), and Withdraw while the proposal stands.
 * - CancelProposalCard: the buyer's accept/decline card for the seller's proposal.
 */
import { useState } from 'react';
import { Button } from '../../ui/Button.js';
import { Sheet } from '../../ui/Sheet.js';
import { sellerCancelMode } from './payModel.js';
import type { TradeView } from './payTypes.js';
import { Name } from './TradeTimeline.js';
import './pay.css';

export const AFTER_PAID_WARNING =
  "Only cancel if your payment was never sent or was returned. Scammers try to talk buyers into cancelling after they've paid.";

export function CancelSheet({ open, busy, error, onConfirm, onClose }: { open: boolean; busy: boolean; error: string | null; onConfirm(): void; onClose(): void }) {
  return (
    <Sheet open={open} title="Cancel trade?" onClose={onClose}>
      <div className="x2f-sheet__body x2f-cancel">
        <p className="x2f-cancel__warning" data-tone="danger">
          {AFTER_PAID_WARNING}
        </p>
        {error !== null ? (
          <p className="x2f-paid__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="x2f-paid__actions">
          <Button variant="danger" disabled={busy} aria-busy={busy || undefined} onClick={onConfirm}>
            Cancel trade
          </Button>
          <Button variant="quiet" onClick={onClose}>
            Keep the trade
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

/** Propose cancel / Withdraw for the seller; renders nothing where no mutual cancel can be proposed. */
export function SellerCancelControls({ view, busy, onPropose, onWithdraw }: { view: TradeView; busy: boolean; onPropose(): void; onWithdraw(): void }) {
  const mode = sellerCancelMode(view);
  if (mode === 'none') return null;
  if (mode === 'propose') {
    return (
      <Button variant="quiet" disabled={busy} onClick={onPropose}>
        Propose cancel
      </Button>
    );
  }
  return (
    <span className="x2f-cancel__proposed">
      <span role="status">
        You proposed cancelling. Waiting for <Name view={view} />.
      </span>
      <Button variant="quiet" disabled={busy} onClick={onWithdraw}>
        Withdraw
      </Button>
    </span>
  );
}

/** The seller proposed a mutual cancel: the buyer accepts (the XMR goes back to the seller) or declines. */
export function CancelProposalCard({ view, busy, onAccept }: { view: TradeView; busy: boolean; onAccept(): void }) {
  const [declined, setDeclined] = useState(false);
  if (declined) return null;
  return (
    <section aria-label="Cancel proposal" className="x2f-card x2f-proposal">
      <p className="x2f-proposal__text">
        <Name view={view} /> proposed cancelling this trade.
      </p>
      <div className="x2f-proposal__actions">
        <Button variant="secondary" disabled={busy} onClick={onAccept}>
          Accept
        </Button>
        <Button variant="quiet" onClick={() => setDeclined(true)}>
          Decline
        </Button>
      </div>
    </section>
  );
}
