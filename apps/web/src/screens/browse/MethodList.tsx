import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Icon } from '../../ui/icons.js';
import { CURRENCIES, adSide, currencyFrom, fetchMethods, formatMinor, type MethodLists, type MethodRow, type MethodSort, type Side } from './api.js';
import type { BrowseCopy } from './SellCopy.js';
import { SuggestMethodSheet } from './SuggestMethodSheet.js';
import './browse.css';

// The Main board (/sell) and, with side="buy", the BuyMain board (/buy): the methods with live offers
// in the chosen currency first, then every other method A–Z, a currency picker, search and Sort.

/** The sort ids in the order of `copy.methodSorts`. */
const SORT_IDS: readonly MethodSort[] = ['buyers', 'rate', 'az'];

type Load = { kind: 'loading' } | { kind: 'ready'; lists: MethodLists } | { kind: 'failed' };

/** The order the API uses for `sort`, for search hits (taken from `all`). */
function compareFor(sort: MethodSort, side: Side): (a: MethodRow, b: MethodRow) => number {
  const name = (a: MethodRow, b: MethodRow) => a.name.localeCompare(b.name, 'en');
  if (sort === 'az') return name;
  if (sort === 'buyers') return (a, b) => b.offers - a.offers || name(a, b);
  // Buy ads pay the seller: highest first. Sell ads charge the buyer: lowest first.
  const highFirst = adSide(side) === 'buy';
  return (a, b) => {
    if (a.bestRate === b.bestRate) return name(a, b);
    if (a.bestRate === null) return 1;
    if (b.bestRate === null) return -1;
    const asc = a.bestRate < b.bestRate ? -1 : 1;
    return highFirst ? -asc : asc;
  };
}

export function MethodList({ side, copy }: { side: Side; copy: BrowseCopy }) {
  const { search } = useLocation();
  const navigate = useNavigate();
  const currency = currencyFrom(search);
  const [sort, setSort] = useState<MethodSort>('buyers');
  const [query, setQuery] = useState('');
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [suggesting, setSuggesting] = useState(false);

  useEffect(() => {
    const abort = new AbortController();
    setLoad((l) => (l.kind === 'ready' ? l : { kind: 'loading' }));
    fetchMethods(side, currency, sort, abort.signal).then(
      (lists) => setLoad({ kind: 'ready', lists }),
      () => {
        if (!abort.signal.aborted) setLoad({ kind: 'failed' });
      },
    );
    return () => abort.abort();
  }, [side, currency, sort]);

  const q = query.trim();
  const sections = useMemo(() => {
    if (load.kind !== 'ready') return [];
    const { live, all } = load.lists;
    if (q !== '') {
      const needle = q.toLowerCase();
      const hits = all.filter((m) => m.name.toLowerCase().includes(needle)).sort(compareFor(sort, side));
      return hits.length === 0 ? [] : [{ title: `${hits.length} ${hits.length === 1 ? 'match' : 'matches'}`, rows: hits }];
    }
    const liveIds = new Set(live.map((m) => m.id));
    const rest = all.filter((m) => !liveIds.has(m.id));
    return [
      ...(live.length > 0 ? [{ title: copy.liveTitle(currency), rows: live }] : []),
      { title: 'All payment methods', rows: rest },
    ];
  }, [load, q, sort, side, currency, copy]);

  const sub = (m: MethodRow) =>
    m.offers > 0 ? copy.liveRow(m.offers, currency, m.bestRate === null ? null : formatMinor(m.bestRate, currency)) : copy.emptyRow(currency);
  const withCurrency = (path: string) => `${path}?currency=${currency}`;
  const total = load.kind === 'ready' ? load.lists.all.length : null;

  return (
    <div className="x2f-browse">
      <header className="x2f-browse__header">
        <div className="x2f-browse__bar">
          <span className="x2f-wordmark">X2F</span>
          <div role="tablist" aria-label="Buy or sell" className="x2f-segment">
            {(['buy', 'sell'] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={side === s}
                className="x2f-segment__tab"
                onClick={() => {
                  if (s !== side) void navigate(withCurrency(`/${s}`));
                }}
              >
                {s === 'buy' ? 'Buy' : 'Sell'}
              </button>
            ))}
          </div>
        </div>
        <h1 className="x2f-browse__title">{copy.heading}</h1>
        <div role="radiogroup" aria-labelledby="browse-currency" className="x2f-browse__sorts">
          <span id="browse-currency" className="x2f-visually-hidden">
            Currency
          </span>
          {CURRENCIES.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={currency === c}
              className="x2f-chip-button"
              onClick={() => void navigate(`?currency=${c}`, { replace: true })}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="x2f-browse__filters">
          <label htmlFor="browse-search" className="x2f-visually-hidden">
            Search payment methods
          </label>
          <input
            id="browse-search"
            className="x2f-input x2f-browse__search"
            type="search"
            value={query}
            placeholder={total === null ? 'Search payment methods' : `Search ${total} payment methods`}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div role="radiogroup" aria-label="Sort" className="x2f-browse__sorts">
          <span className="x2f-browse__sort-label">Sort</span>
          {SORT_IDS.map((id, i) => (
            <button key={id} type="button" role="radio" aria-checked={sort === id} className="x2f-chip-button" onClick={() => setSort(id)}>
              {copy.methodSorts[i]}
            </button>
          ))}
        </div>
      </header>

      <main className="x2f-browse__main">
        {load.kind === 'failed' ? <p className="x2f-browse__note">Payment methods could not be loaded right now. Try again in a moment.</p> : null}
        {sections.map((sec) => (
          <section key={sec.title} className="x2f-browse__section">
            <h2 className="x2f-browse__section-title">{sec.title}</h2>
            {sec.rows.map((m) => (
              <Link key={m.id} to={withCurrency(`/${side}/${encodeURIComponent(m.id)}`)} className="x2f-method">
                <span className="x2f-method__text">
                  <span className="x2f-method__name" data-part="name">
                    {m.name}
                  </span>
                  <span className="x2f-method__sub">{sub(m)}</span>
                </span>
                <Icon name="chevron-right" size={18} />
              </Link>
            ))}
          </section>
        ))}
        {load.kind === 'ready' && q !== '' && sections.length === 0 ? (
          <p className="x2f-browse__empty">
            No method called "{q}" yet. You can post an offer with a custom payment method.{' '}
            <button type="button" className="x2f-text-button" onClick={() => setSuggesting(true)}>
              Suggest it
            </button>
          </p>
        ) : null}
      </main>
      <SuggestMethodSheet open={suggesting} initialName={q} onClose={() => setSuggesting(false)} />
    </div>
  );
}
