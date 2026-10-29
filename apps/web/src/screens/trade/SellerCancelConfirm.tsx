/**
 * The seller's side of a buyer's cancel (owner 2026-10-29: option B with a seller confirm step).
 * The buyer cancels before "I've paid" and the XMR goes back to the seller's locked refund address
 * at once (the buyer's app and the moderation service sign; the seller need not be online). The
 * trade says "Cancelling" until the seller taps Confirm cancel, which stays greyed out until the
 * returned XMR has all its confirmations (10, the count the trade uses for funding and release);
 * the API checks the count itself on its own node (`confirm-cancel`, too-early before 10).
 * If the seller never taps, the trade stays among their active trades with "Your input is needed
 * to cancel this trade." and closes as cancelled by itself SELLER_CONFIRM_CANCEL_TIMEOUT_H (48)
 * hours after the button became available (`cancelConfirmableAt`; the server's timer, owner
 * 2026-10-29). No board draws this screen: COPY-UNSIGNED.
 */
import { useState } from 'react';
import { SELLER_CONFIRM_CANCEL_TIMEOUT_H } from '@x2f/trade';
import { ApiCallError } from '../../api/client.js';
import { postTradeEvent } from '../../api/trade.js';
import { Button } from '../../ui/Button.js';
import { StatusChip } from '../../ui/StatusChip.js';
import { TradeHeader } from '../../ui/TradeHeader.js';
import { payMethodOf } from './paySeams.js';
import { publicName } from './payTypes.js';
import { useConfirmations } from './release/seams.js';
import { registerTradeScreen, type TradeScreenProps } from './TradeRoom.js';
import './pay.css';

/** The return of a buyer's cancel is complete and the seller may confirm it (pure, for the screen and tests). */
export function confirmCancelReady(state: string, confirmations: number | null, target: number): boolean {
  return state === 'refunded' && confirmations !== null && confirmations >= target;
}

export function SellerCancelConfirm({ code, view, refresh }: TradeScreenProps) {
  const method = payMethodOf(view);
  const buyer = publicName(view.counterparty);
  const got = useConfirmations(view);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmed = view.cancelConfirmedAt !== null;
  const target = got?.target ?? 10;
  const count = got?.confirmations ?? null;
  // The server's word that the return is complete counts too (it recorded the moment), so the
  // button never waits for this device's own read of the count.
  const ready = confirmCancelReady(view.state, count, target) || (view.state === 'refunded' && view.cancelConfirmableAt !== null);
  const closesAt = view.cancelConfirmableAt === null ? null : new Date(Date.parse(view.cancelConfirmableAt) + SELLER_CONFIRM_CANCEL_TIMEOUT_H * 3_600_000);

  const confirm = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await postTradeEvent(code, { type: 'confirm-cancel' });
      await refresh();
    } catch (e) {
      setError(
        e instanceof ApiCallError && e.code === 'too-early'
          ? "The returned XMR doesn't have all its confirmations yet. Try again in a few minutes."
          : "Couldn't confirm the cancel. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="x2f-pay" data-layout="phone" data-seller-cancel="">
      <TradeHeader
        title={
          <>
            Selling to <span data-username="">{buyer}</span>
          </>
        }
        code={view.code}
        method={method}
        backTo="/sell"
      />
      <div className="x2f-pay__main">
        {confirmed ? (
          <>
            <StatusChip tone="escrow" icon="check" label="Cancelled" />
            <section aria-label="Cancel" className="x2f-card x2f-wait">
              <p className="x2f-wait__title">Trade cancelled</p>
              <p>
                <span data-username="">{buyer}</span> cancelled before paying. All the XMR is back at your refund address.
              </p>
            </section>
          </>
        ) : (
          <>
            <StatusChip tone="caution" icon="clock" label="Cancelling" />
            <section aria-label="Cancel" className="x2f-card x2f-wait">
              <p className="x2f-wait__title">Cancelling: returning the XMR to you</p>
              <p>
                <span data-username="">{buyer}</span> cancelled before paying, so the XMR in escrow is going back to your refund address. Confirm
                the cancel once it has all its confirmations.
              </p>
              <p className="x2f-wait__left" data-return-confirmations="">
                {view.state !== 'refunded'
                  ? 'Waiting for the refund to be sent'
                  : count === null
                    ? 'Confirmations: checking…'
                    : `Confirmations ${Math.min(count, target)} of ${target}`}
              </p>
            </section>
          </>
        )}
        {!confirmed && ready ? (
          <p className="x2f-room__grown" role="status" data-input-needed="">
            Your input is needed to cancel this trade.
            {closesAt !== null
              ? ` If you don't confirm, it closes as cancelled by itself on ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(closesAt)}.`
              : ''}
          </p>
        ) : null}
        {error !== null ? (
          <p className="x2f-room__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      {confirmed ? null : (
        <footer className="x2f-pay__footer">
          <Button variant="primary" disabled={!ready || busy} aria-busy={busy || undefined} onClick={() => void confirm()}>
            Confirm cancel
          </Button>
          {ready ? null : <span className="x2f-room__hint">You can confirm once the returned XMR has all {target} confirmations.</span>}
        </footer>
      )}
    </div>
  );
}

registerTradeScreen({
  owner: 'Task 39',
  role: 'seller',
  states: ['settling', 'refunded'],
  when: (v) => v.settling === 'buyer-cancel',
  screen: SellerCancelConfirm,
});
