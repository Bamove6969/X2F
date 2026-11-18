import { useEffect, useId, useRef, useState } from 'react';
import { useResumeSync } from '../../session/syncFirst.js';
import { Checkbox } from '../../ui/Checkbox.js';
import { Link, useLocation, useParams } from 'react-router';
import { Icon } from '../../ui/icons.js';
import { ApiShapeError, currencyFrom, fetchMethods, fetchOffers, fetchPrice, formatMinor, sortOffers, type MethodRow, type Offer, type OfferSort, type Side } from './api.js';
import { OfferCard } from './OfferCard.js';
import { loadWithMarkup, marketUpdated, saveWithMarkup, withMarkupHint } from './offerAmounts.js';
import { RadioChips } from './RadioChips.js';
import type { BrowseCopy } from './SellCopy.js';
import './browse.css';
import { useSiteInfo } from '../../api/site.js';
import { TradingStopped } from '../../ui/TradingStopped.js';

// The SellOffers board (/sell/:methodId) and, with side="buy", the BuyOffers board (/buy/:methodId):
// the market price line, Sort, and the offer cards, kept in the chosen order whatever order the
// API sent. The first offer that can be taken (online, no
// `opensAt` from the API) carries the screen's one orange Trade.

const SORT_IDS: readonly OfferSort[] = ['best', 'online', 'trades'];

type Load<T> = { kind: 'loading' } | { kind: 'ready'; value: T } | { kind: 'failed'; shape: boolean };

/**
 * One read, again whenever `deps` change; and again on resume (C-021, session/syncFirst.ts): that
 * read must answer before the board's actions work again. A failed resume read keeps what is shown
 * (the gate says it may be out of date) and an answer for older `deps` is dropped.
 */
function useLoad<T>(run: (signal: AbortSignal) => Promise<T>, deps: unknown[]): Load<T> {
  const [load, setLoad] = useState<Load<T>>({ kind: 'loading' });
  const gen = useRef(0);
  useEffect(() => {
    const mine = ++gen.current;
    const abort = new AbortController();
    run(abort.signal).then(
      (value) => {
        if (mine === gen.current) setLoad({ kind: 'ready', value });
      },
      (err: unknown) => {
        if (abort.signal.aborted) return;
        if (err instanceof ApiShapeError) console.error(err);
        setLoad({ kind: 'failed', shape: err instanceof ApiShapeError });
      },
    );
    return () => abort.abort();
  }, deps);
  useResumeSync(async () => {
    const mine = gen.current;
    const value = await run(new AbortController().signal);
    if (mine === gen.current) setLoad({ kind: 'ready', value });
  });
  return load;
}

export interface OfferListProps {
  side: Side;
  copy: BrowseCopy;
  /** Task 18 opens the quote; Task 20 the chat; Task 26 sends the Nudge. */
  onTrade?: (offer: Offer) => void;
  onMessage?: (offer: Offer) => void;
  onNudge?: (offer: Offer) => void;
  /**
   * Two panes (Fold-Offers): the offers are rows that pick the quote the next pane shows, and the
   * list has no orange Trade (the quote has the one). `id` is the offer picked (null: none yet);
   * `onFirst` hears which offer the quote shows before one is picked: the one that would carry
   * the orange Trade on a phone.
   */
  pick?: { id: string | null; onPick: (offer: Offer) => void; onFirst: (id: string | null) => void };
}

function localStore(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** COPY-UNSIGNED (owner's words, 8 Nov): the box over the offers. */
export const WITH_MARKUP_LABEL = 'Display amounts including vendor markup';

export function OfferList({ side, copy, onTrade, onMessage, onNudge, pick }: OfferListProps) {
  // Owner, 8 Nov: off by default, remembered on this device.
  const [withMarkup, setWithMarkup] = useState(() => loadWithMarkup(localStore()));
  const markupId = useId();
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
  // Plan 4 Task 29: during the emergency stop no offer is shown (nor any Trade), only the message.
  const { tradingPaused } = useSiteInfo();
  const list = offers.kind === 'ready' && !tradingPaused ? sortOffers(offers.value, sort, side) : [];
  const market = price.kind === 'ready' ? price.value.centsPerXmr : null;
  const primaryId = list.find((o) => o.opensAt === undefined && o.poster.online)?.id;
  const onFirst = pick?.onFirst;
  const firstId = offers.kind === 'ready' ? (primaryId ?? null) : undefined;
  useEffect(() => {
    if (onFirst && firstId !== undefined) onFirst(firstId);
  }, [onFirst, firstId]);

  return (
    <div className="x2f-browse">
      <header className="x2f-browse__header">
        <div className="x2f-browse__back-row">
          <Link to={`/${side}?currency=${currency}`} aria-label="Back to payment methods" className="x2f-icon-button">
            <Icon name="chevron-left" size={24} />
          </Link>
          <div className="x2f-browse__head-text">
            {/* Never the method id from the URL: until the API names the method, the bare title. */}
            <span className="x2f-browse__head-title x2f-screen-title">{row ? copy.offersTitle(row.name) : copy.offersTitleBare}</span>
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
        {price.kind === 'ready' && marketUpdated(price.value.at) !== null ? (
          <span className="x2f-browse__muted x2f-browse__updated" data-part="market-updated">
            {marketUpdated(price.value.at)}
          </span>
        ) : null}
        <div className="x2f-browse__markup">
          <Checkbox
            id={markupId}
            checked={withMarkup}
            data-part="with-markup"
            aria-describedby={`${markupId}-hint`}
            onChange={(on) => {
              setWithMarkup(on);
              saveWithMarkup(localStore(), on);
            }}
          />
          <span className="x2f-browse__markup-text">
            <label htmlFor={markupId}>{WITH_MARKUP_LABEL}</label>
            <span className="x2f-browse__muted" id={`${markupId}-hint`}>
              {withMarkupHint(withMarkup)}
            </span>
          </span>
        </div>
        <RadioChips label={{ name: 'Sort' }} options={SORT_IDS.map((id, i) => ({ id, label: copy.offerSorts[i]! }))} value={sort} onChange={setSort}>
          <span className="x2f-browse__sort-label">Sort</span>
        </RadioChips>
      </header>

      <main className="x2f-browse__main x2f-browse__main--cards">
        {tradingPaused ? <TradingStopped /> : null}
        {method.kind === 'ready' && method.value === null ? <p className="x2f-browse__note">{/* not-a-refusal: a catalog fact (the method is off the list) */}This payment method is not available.</p> : null}
        {offers.kind === 'failed' ? (
          <p className="x2f-browse__note">
            {offers.shape
              ? 'This version of X2F could not read the offers. Reload the page to get the latest version.'
              : 'Offers could not be loaded right now. Try again in a moment.'}
          </p>
        ) : null}
        {offers.kind === 'ready' && !tradingPaused && list.length === 0 ? <p className="x2f-browse__note">{copy.noOffers(currency)}</p> : null}
        {list.map((o) => (
          <OfferCard
            key={o.id}
            offer={o}
            currency={currency}
            copy={copy}
            primary={pick ? false : o.id === primaryId}
            now={now}
            market={market}
            withMarkup={withMarkup}
            {...(onTrade ? { onTrade } : {})}
            {...(onMessage ? { onMessage } : {})}
            {...(onNudge ? { onNudge } : {})}
            {...(pick ? { pick: { pressed: o.id === pick.id, onPick: pick.onPick } } : {})}
          />
        ))}
        {copy.offersFooter !== undefined && offers.kind === 'ready' && !tradingPaused ? <p className="x2f-browse__footer">{copy.offersFooter}</p> : null}
      </main>
    </div>
  );
}
