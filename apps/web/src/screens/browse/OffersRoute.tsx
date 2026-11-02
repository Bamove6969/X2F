import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { hasPanes, useFoldLayout } from '../../ui/fold.js';
import { Panes } from '../../ui/Panes.js';
import { BUY_QUOTE_COPY } from '../quote/BuyQuote.js';
import { QuoteScreen } from '../quote/Quote.js';
import { quotePath } from '../quote/quoteModel.js';
import { SELL_QUOTE_COPY } from '../quote/SellQuote.js';
import { adSide, currencyFrom, type Offer, type Side } from './api.js';
import { OfferList } from './OfferList.js';
import type { BrowseCopy } from './SellCopy.js';

/** What a picked offer's quote keeps from the one before: the currency, the amount, its unit and the wallet. */
const KEPT = ['currency', 'amount', 'unit', 'wallet'] as const;

/**
 * The offers and their quote: `/buy/:methodId` and `/sell/:methodId` (the offer list, Tasks 16/17)
 * and `/buy/:methodId/:offerId`, `/sell/:methodId/:offerId` (the quote, Task 18). Both routes
 * render this one component, so moving between them keeps it mounted.
 *
 * - Phone, flip cover and wide: the list, or the quote on a quote route, as before. The list's
 *   Trade opens the quote.
 * - Two panes (600-999 px, or a book fold's two segments) and three: Fold-Offers. The list in the
 *   first pane, its rows picking the offer; the picked offer's quote in the next pane, with the one
 *   orange Trade. Before one is picked the quote shows the offer the phone's orange Trade is on
 *   (the board's first row). Picking goes to that offer's quote route, so folding back shows the
 *   quote the person was looking at; the amount, its unit and the wallet go with it.
 */
export function OffersRoute({ side, copy }: { side: Side; copy: BrowseCopy }) {
  const { methodId = '', offerId } = useParams();
  const { search } = useLocation();
  const navigate = useNavigate();
  const layout = useFoldLayout();
  const [first, setFirst] = useState<string | null>(null);
  const currency = currencyFrom(search);
  const quoteCopy = side === 'buy' ? BUY_QUOTE_COPY : SELL_QUOTE_COPY;
  const onTrade = (o: Offer) => void navigate(quotePath(adSide(side), methodId, o.id, currency));

  if (!hasPanes(layout)) {
    return <Panes layout={layout} main={offerId !== undefined ? <QuoteScreen copy={quoteCopy} /> : <OfferList side={side} copy={copy} onTrade={onTrade} />} />;
  }

  const shown = offerId ?? first;
  const onPick = (o: Offer) => {
    const now = new URLSearchParams(search);
    const next = new URLSearchParams(KEPT.flatMap((k) => (now.get(k) !== null ? [[k, now.get(k)!]] : [])));
    if (!next.has('currency')) next.set('currency', currency);
    const path = quotePath(adSide(side), methodId, o.id, currency).split('?')[0]!;
    // From the list, a step forward (Back returns to the list, as on a phone); between quotes, a swap.
    void navigate(`${path}?${next}`, { replace: offerId !== undefined });
  };
  return (
    <Panes
      layout={layout}
      main={<OfferList side={side} copy={copy} onTrade={onTrade} pick={{ id: shown, onPick, onFirst: setFirst }} />}
      side={shown !== null ? <QuoteScreen key={shown} copy={quoteCopy} pane={{ methodId, offerId: shown }} /> : <div />}
      sideLabel="Quote"
    />
  );
}
