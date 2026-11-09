/**
 * Cancelling a funded trade (spec 2.3). The buyer cancels with one tap before "I've paid"
 * (BuyerPay); after it there is no cancel of any kind (owner, Revision 2026-10-29b), so the
 * after-paid CancelSheet and its warning are gone (Task 39).
 * - SellerCancelControls: the seller's waiting room offers no cancel at all (design proto review
 *   P2, 8 Nov: no Propose cancel while waiting for payment; the seller's own cancel after the time
 *   to pay is SellerRefund's). Only Withdraw, for a proposal that already stands.
 * - CancelProposalCard: the buyer's accept/decline card for the seller's proposal.
 */
import { useState } from 'react';
import { Button } from '../../ui/Button.js';
import { sellerCancelMode } from './payModel.js';
import type { TradeView } from './payTypes.js';
import { Name } from './TradeTimeline.js';
import './pay.css';

/** Withdraw for the seller's standing mutual-cancel proposal; nothing otherwise (no Propose cancel, proto review P2). */
export function SellerCancelControls({ view, busy, onWithdraw }: { view: TradeView; busy: boolean; onWithdraw(): void }) {
  if (sellerCancelMode(view) !== 'proposed') return null;
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
