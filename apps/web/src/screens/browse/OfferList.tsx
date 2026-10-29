import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { Icon } from '../../ui/icons.js';
import { ApiShapeError, currencyFrom, fetchMethods, fetchOffers, fetchPrice, formatMinor, sortOffers, type MethodRow, type Offer, type OfferSort, type Side } from './api.js';
import { OfferCard } from './OfferCard.js';
import { RadioChips } from './RadioChips.js';
import type { BrowseCopy } from './SellCopy.js';
import './browse.css';

// The SellOffers board (/sell/:methodId) and, with side="buy", the BuyOffers board (/buy/:methodId):
// the market price line, Sort, and the offer cards, kept in the chosen order whatever order the
// API sent. The first offer that can be taken (online, no
// `opensAt` from the API) carries the screen's one orange Trade.

const SORT_IDS: readonly OfferSort[] = ['best', 'online', 'trades'];

type Load<T> = { kind: 'loading' } | { kind: 'ready'; value: T } | { kind: 'failed'; shape: boolean };

function useLoad<T>(run: (signal: AbortSignal) => Promise<T>, deps: unknown[]): Load<T> {
  const [load, setLoad] = useState<Load<T>>({ kind: 'loading' });
  useEffect(() => {
    const abort = new AbortController();
    run(abort.signal).then(
      (value) => setLoad({ kind: 'ready', value }),
      (err: unknown) => {
        if (abort.signal.aborted) return;
        if (err instanceof ApiShapeError) console.error(err);
        setLoad({ kind: 'failed', shape: err instanceof ApiShapeError });
      },
    );
    return () => abort.abort();
  }, deps);
  return load;
}

export interface OfferListProps {
  side: Side;
  copy: BrowseCopy;
  /** Task 18 opens the quote; Task 20 the chat; Task 26 sends the Nudge. */
  onTrade?: (offer: Offer) => void;
  onMessage?: (offer: Offer) => void;
  onNudge?: (offer: Offer) => void;
}

export function OfferList({ side, copy, onTrade, onMessage, onNudge }: OfferListProps) {
  const { methodId = '' } = useParams();
  const { search } = useLocation();
  const currency = currencyFrom(search);
  const [sort, setSort] = useState<OfferSort>('best');

  const method = useLoad<MethodRow | null>(
    async (signal) => {
      const lists = await fetchMethods(side, currency, 'buyers', signal);
      return lists.all.find((m) => m.id === methodId) ?? lists.live.find((m) => m.id === methodId) ?? null;
    },
    [side, currency, methodId],
  );
  const price = useLoad((signal) => fetchPrice(currency, signal), [currency]);
  const offers = useLoad((signal) => fetchOffers(side, methodId, currency, sort, signal), [side, methodId, currency, sort]);

  const row = method.kind === 'ready' ? method.value : null;
  const now = new Date();
  const list = offers.kind === 'ready' ? sortOffers(offers.value, sort, side) : [];
  const market = price.kind === 'ready' ? price.value.centsPerXmr : null;
  const primaryId = list.find((o) => o.opensAt === undefined && o.poster.online)?.id;

  return (
    <div className="x2f-browse">
      <header className="x2f-browse__header">
        <div className="x2f-browse__back-row">
          <Link to={`/${side}?currency=${currency}`} aria-label="Back to payment methods" className="x2f-icon-button">
            <Icon name="chevron-left" size={24} />
          </Link>
          <div className="x2f-browse__head-text">
            {/* Never the method id from the URL: until the API names the method, the bare title. */}
            <span className="x2f-browse__head-title">{row ? copy.offersTitle(row.name) : copy.offersTitleBare}</span>
            {row ? <span className="x2f-browse__head-sub">{copy.offersCount(row.offers, currency)}</span> : null}
          </div>
        </div>
        <div className="x2f-browse__market">
          <span className="x2f-browse__muted">Market price</span>
          {price.kind === 'ready' ? (
            <span>
              <span className="x2f-browse__mono">{formatMinor(price.value.centsPerXmr, currency)}</span>{' '}
              <span className="x2f-browse__muted">/ XMR</span>
            </span>
          ) : price.kind === 'failed' ? (
            <span className="x2f-browse__muted">Price unavailable right now</span>
          ) : null}
        </div>
        <RadioChips label={{ name: 'Sort' }} options={SORT_IDS.map((id, i) => ({ id, label: copy.offerSorts[i]! }))} value={sort} onChange={setSort}>
          <span className="x2f-browse__sort-label">Sort</span>
        </RadioChips>
      </header>

      <main className="x2f-browse__main x2f-browse__main--cards">
        {method.kind === 'ready' && method.value === null ? <p className="x2f-browse__note">{/* not-a-refusal: a catalog fact (the method is off the list) */}This payment method is not available.</p> : null}
        {offers.kind === 'failed' ? (
          <p className="x2f-browse__note">
            {offers.shape
              ? 'This version of X2F could not read the offers. Reload the page to get the latest version.'
              : 'Offers could not be loaded right now. Try again in a moment.'}
          </p>
        ) : null}
        {offers.kind === 'ready' && list.length === 0 ? <p className="x2f-browse__note">{copy.noOffers(currency)}</p> : null}
        {list.map((o) => (
          <OfferCard
            key={o.id}
            offer={o}
            currency={currency}
            copy={copy}
            primary={o.id === primaryId}
            now={now}
            market={market}
            {...(onTrade ? { onTrade } : {})}
            {...(onMessage ? { onMessage } : {})}
            {...(onNudge ? { onNudge } : {})}
          />
        ))}
        {copy.offersFooter !== undefined && offers.kind === 'ready' ? <p className="x2f-browse__footer">{copy.offersFooter}</p> : null}
      </main>
    </div>
  );
}
