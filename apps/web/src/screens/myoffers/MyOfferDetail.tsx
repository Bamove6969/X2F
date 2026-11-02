// One of my offers in the pane beside the list (two panes; Fold-MyOffers board, right pane). Built
// from the kit and the screens' shared classes only, as MyOffers.tsx (NEEDS_DESIGN_MYOFFERS). What
// the board shows that the API has no data for is left out (not built): "Last edited", the price
// tiers, each method's own price, "Open trades on it" and the Edit offer link (no edit screen until
// Task 35).
import { useId } from 'react';
import { TIMERS } from '@x2f/trade';
import { Button } from '../../ui/Button.js';
import type { MyOffer } from './api.js';
import { marketLine, offerMethods, offerPrice, offerRange, offerTitle, statusLine, whoCanTrade } from './model.js';

export function MyOfferDetail({ offer, busy, why, onSwitch }: { offer: MyOffer; busy: boolean; why: string | undefined; onSwitch: () => void }) {
  const id = useId();
  const on = offer.status === 'live';
  return (
    <div className="x2f-screen" data-part="offer-detail" data-detail-offer={offer.id}>
      <h2 className="x2f-screen__title" id={`${id}-title`}>
        {offerTitle(offer)}
      </h2>
      <section className="x2f-row" aria-label="Status">
        <div className="x2f-stack">
          <span id={`${id}-status`} data-part="detail-status">
            {statusLine(offer)}
          </span>
          {why ? <span className="x2f-error">{why}</span> : null}
        </div>
        <Button
          variant="secondary"
          role="switch"
          id={`${id}-switch`}
          aria-checked={on}
          aria-labelledby={`${id}-switch ${id}-title ${id}-methods`}
          aria-describedby={`${id}-status`}
          disabled={busy}
          onClick={onSwitch}
          data-part="detail-switch"
        >
          {on ? 'On' : 'Off'}
        </Button>
      </section>
      <section className="x2f-stack" aria-labelledby={`${id}-price`}>
        <h3 id={`${id}-price`}>Price</h3>
        <span>{offerPrice(offer)}</span>
        <span className="x2f-note">{marketLine(offer)}</span>
      </section>
      <section className="x2f-stack" aria-labelledby={`${id}-methods-h`}>
        <h3 id={`${id}-methods-h`}>Payment methods</h3>
        <span id={`${id}-methods`}>{offerMethods(offer)}</span>
      </section>
      <dl className="x2f-stack">
        <div className="x2f-row">
          <dt className="x2f-note">Per trade</dt>
          <dd>{offerRange(offer)}</dd>
        </div>
        <div className="x2f-row">
          <dt className="x2f-note">Who can trade</dt>
          <dd>{whoCanTrade(offer)}</dd>
        </div>
        <div className="x2f-row">
          <dt className="x2f-note">Time to pay</dt>
          <dd>{TIMERS.payMin} min</dd>
        </div>
      </dl>
    </div>
  );
}
