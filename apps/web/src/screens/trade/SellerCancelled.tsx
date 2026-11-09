/**
 * SellerCancelled (owner 8 Nov, p6-1, p9-2; replaces Task 25's FinalAlert): the buyer's screen
 * while the seller's cancel refund settles (`settling` as `auto-refund`). The time to pay ended
 * before the buyer tapped "I've paid" and the seller cancelled, so the XMR is going back to the
 * seller at once: there is no final warning and nothing for the buyer to sign. A buyer who paid
 * late anyway can open a dispute at once (the machine allows the buyer's `open-dispute` here). In
 * the usual case it does not stop the refund: the moderator co-signs within seconds of the cancel
 * and a refund already handed out still lands, so the case goes on as an after-refund dispute (the
 * seller is asked to send the XMR as agreed; review I1, 8 Nov). Only a dispute opened before the
 * moderator's pass keeps the coins in escrow. With no dispute, once the refund lands the trade is
 * `refunded` and Task 27's RefundedSlot takes over (its 48-hour dispute window).
 *
 * COPY-UNSIGNED: no board draws this screen yet.
 */
import { Button } from '../../ui/Button.js';
import { Icon } from '../../ui/icons.js';
import { StatusChip } from '../../ui/StatusChip.js';
import { TradeHeader } from '../../ui/TradeHeader.js';
import { tradeFromView } from '../dispute/api.js';
import { DisputeEntry } from '../dispute/DisputeEntry.js';
import { methodOf, publicName, type RefundScreenProps } from './refundSlot.js';
import { useServerNow } from './refundUi.js';
import './refund.css';

export function SellerCancelled({ view, serverClock }: RefundScreenProps) {
  const name = publicName(view.counterparty);
  const now = useServerNow(serverClock);
  const trade = tradeFromView(view);
  return (
    <div className="x2f-refund" data-screen-part="seller-cancelled">
      <TradeHeader
        title={
          <>
            Buying from <span data-username="">{name}</span>
          </>
        }
        code={view.code}
        method={methodOf(view)}
        backTo="/buy"
      />
      <section className="x2f-refund__body">
        <div>
          <StatusChip tone="caution" icon="clock" label="Cancelled by the seller" />
        </div>
        <section className="x2f-refund__intro">
          <h1 className="x2f-refund__title">
            <span data-username="">{name}</span> cancelled the trade
          </h1>
          <p className="x2f-refund__lead">
            The time to pay ended before you tapped I've paid, so the XMR is going back to <span data-username="">{name}</span>. Please don't send a
            payment now.
          </p>
        </section>
        <section aria-label="If you already paid" className="x2f-refund__card" data-seller-cancelled-dispute="">
          <h2 className="x2f-refund__card-title">Did you pay already?</h2>
          <p className="x2f-refund__late">
            Open a dispute now. A moderator checks both sides, and if your payment reached <span data-username="">{name}</span>, they are asked to
            send you the XMR as agreed.
          </p>
          <DisputeEntry trade={trade} now={now} />
        </section>
        <section className="x2f-refund__check">
          <span className="x2f-refund__check-icon">
            <Icon name="shield" size={20} />
          </span>
          <p>Keep your payment receipt: the moderator will ask for it.</p>
        </section>
      </section>
      <footer className="x2f-refund__footer">
        <Button variant="primary" href="/buy">
          Back to my trades
        </Button>
      </footer>
    </div>
  );
}
