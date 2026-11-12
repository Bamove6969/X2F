import { useEffect, useId, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Icon } from '../../ui/icons.js';
import { ScreenHeader } from '../../ui/ScreenHeader.js';
import { ApiShapeError, CURRENCIES, adSide, currencyFrom, fetchMethods, formatMinor, type MethodLists, type MethodRow, type MethodSort, type Side } from './api.js';
import { MethodPicker, methodShown } from './MethodPicker.js';
import { methodUpToLine } from './methodTime.js';
import { RadioChips } from './RadioChips.js';
import type { BrowseCopy } from './SellCopy.js';
import { SuggestMethodSheet } from './SuggestMethodSheet.js';
import './browse.css';
import { NewsBell } from '../../ui/NewsBell.js';

// The Main board (/sell) and, with side="buy", the BuyMain board (/buy): one card for the methods with
// live offers in the chosen currency (a picker of them, MethodPicker.tsx; owner 2026-11-08), then every
// other method A–Z, a currency picker, search and Sort. Search lists every match as rows.

/** The sort ids in the order of `copy.methodSorts`. */
const SORT_IDS: readonly MethodSort[] = ['buyers', 'rate', 'az'];

// A ready list remembers the side and currency it is for: while another currency loads, the old
// rows stay hidden rather than read with the new currency's words and symbol. A sort change keeps
// showing the old order until the new one lands.
type Load = { kind: 'loading' } | { kind: 'ready'; side: Side; currency: string; lists: MethodLists } | { kind: 'failed'; shape: boolean };

/**
 * A section: `pick` is the live card (MethodPicker); `collapsed` is All payment methods, the methods
 * with no live offer here, folded into one line until opened (design review 8 Nov, item 7: the ~106
 * "No USD buyers right now" rows read as a dead list).
 */
type Section = { title: string; rows: MethodRow[]; pick?: boolean; collapsed?: { more: boolean } };

/** COPY-UNSIGNED: the folded line, "106 more payment methods" under live ones, else "106 payment methods". */
export function allMethodsLine(n: number, more: boolean): string {
  return `${n.toLocaleString('en-US')} ${more ? 'more ' : ''}payment ${n === 1 ? 'method' : 'methods'}`;
}

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
  // The method picked on the live card; null (or one with no live offer here) shows the first.
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    setLoad((l) => (l.kind === 'ready' ? l : { kind: 'loading' }));
    fetchMethods(side, currency, sort, abort.signal).then(
      (lists) => setLoad({ kind: 'ready', side, currency, lists }),
      (err: unknown) => {
        if (abort.signal.aborted) return;
        if (err instanceof ApiShapeError) console.error(err);
        setLoad({ kind: 'failed', shape: err instanceof ApiShapeError });
      },
    );
    return () => abort.abort();
  }, [side, currency, sort]);

  const q = query.trim();
  const sections = useMemo((): Section[] => {
    if (load.kind !== 'ready' || load.side !== side || load.currency !== currency) return [];
    const { live, all } = load.lists;
    if (q !== '') {
      const needle = q.toLowerCase();
      const hits = all.filter((m) => m.name.toLowerCase().includes(needle)).sort(compareFor(sort, side));
      return hits.length === 0 ? [] : [{ title: `${hits.length} ${hits.length === 1 ? 'match' : 'matches'}`, rows: hits }];
    }
    const liveIds = new Set(live.map((m) => m.id));
    const rest = all.filter((m) => !liveIds.has(m.id));
    return [
      ...(live.length > 0 ? [{ title: copy.liveTitle(currency), rows: live, pick: true }] : []),
      ...(rest.length > 0 ? [{ title: 'All payment methods', rows: rest, collapsed: { more: live.length > 0 } }] : []),
    ];
  }, [load, q, sort, side, currency, copy]);
  const [allOpen, setAllOpen] = useState(false);
  const allId = useId();

  const sub = (m: MethodRow) =>
    m.offers > 0 ? copy.liveRow(m.offers, currency, m.bestRate === null ? null : formatMinor(m.bestRate, currency)) : copy.emptyRow(currency);
  // Owner p9-4: how long the method can take, up front where it is picked.
  const upTo = (m: MethodRow) => (m.upToMin === null ? null : methodUpToLine(m.upToMin));
  const withCurrency = (path: string) => `${path}?currency=${currency}`;
  const total = load.kind === 'ready' ? load.lists.all.length : null;
  const current = load.kind === 'ready' && load.side === side && load.currency === currency;

  return (
    <div className="x2f-browse">
      <header className="x2f-browse__header">
        <div className="x2f-browse__bar">
          <div className="x2f-brand x2f-browse__brand">
            <div className="x2f-browse__logo">
              {/* Owner demo notes 12 Nov #37 (DESIGNER-REVIEW): the shared header, logo D with the screen name.
                  Drawn as a div: this bar is already inside the browse header (review 12 Nov, L5). */}
              <ScreenHeader as="div" />
            </div>
            <NewsBell />
          </div>
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
        <h1 className="x2f-browse__title x2f-screen-title">{copy.heading}</h1>
        <RadioChips
          label={{ by: 'browse-currency' }}
          options={CURRENCIES.map((c) => ({ id: c, label: c }))}
          value={currency}
          onChange={(c) => void navigate(`?currency=${c}`, { replace: true })}
        >
          <span id="browse-currency" className="x2f-visually-hidden">
            Currency
          </span>
        </RadioChips>
        <div className="x2f-browse__filters">
          <label htmlFor="browse-search" className="x2f-visually-hidden">
            Search payment methods
          </label>
          <span className="x2f-browse__search-box">
            <Icon name="search" size={20} stroke={1.75} />
            <input
              id="browse-search"
              className="x2f-input x2f-browse__search"
              type="search"
              value={query}
              placeholder={total === null ? 'Search payment methods' : `Search ${total} payment methods`}
              onChange={(e) => setQuery(e.target.value)}
            />
          </span>
        </div>
        <RadioChips label={{ name: 'Sort' }} options={SORT_IDS.map((id, i) => ({ id, label: copy.methodSorts[i]! }))} value={sort} onChange={setSort}>
          <span className="x2f-browse__sort-label">Sort</span>
        </RadioChips>
      </header>

      <main className="x2f-browse__main">
        {load.kind === 'failed' ? (
          <p className="x2f-browse__note">
            {load.shape
              ? 'This version of X2F could not read the payment methods. Reload the page to get the latest version.'
              : 'Payment methods could not be loaded right now. Try again in a moment.'}
          </p>
        ) : null}
        {sections.map((sec) => (
          <section key={sec.title} className="x2f-browse__section">
            <h2 className="x2f-browse__section-title x2f-section-title">{sec.title}</h2>
            {sec.pick ? (
              <MethodPicker
                live={sec.rows}
                value={methodShown(sec.rows, picked)!}
                onChange={setPicked}
                title={sec.title}
                sub={sub}
                upTo={upTo}
                href={(m) => withCurrency(`/${side}/${encodeURIComponent(m.id)}`)}
              />
            ) : null}
            {sec.collapsed ? (
              <button
                type="button"
                className="x2f-method x2f-browse__all-toggle"
                aria-expanded={allOpen}
                aria-controls={allId}
                onClick={() => setAllOpen((o) => !o)}
              >
                <span className="x2f-method__text">
                  <span className="x2f-method__name">{allMethodsLine(sec.rows.length, sec.collapsed.more)}</span>
                  <span className="x2f-method__sub">{copy.emptyRow(currency)}</span>
                </span>
                <Icon name="chevron-down" size={18} />
              </button>
            ) : null}
            {sec.pick || (sec.collapsed && !allOpen) ? null : (
              <div id={sec.collapsed ? allId : undefined} className="x2f-browse__rows">
                {sec.rows.map((m) => (
                  <Link key={m.id} to={withCurrency(`/${side}/${encodeURIComponent(m.id)}`)} className="x2f-method">
                    <span className="x2f-method__text">
                      <span className="x2f-method__name" data-part="name">
                        {m.name}
                      </span>
                      {/* Opened, the folded rows drop the line the toggle already said once. */}
                      {sec.collapsed ? null : <span className="x2f-method__sub">{sub(m)}</span>}
                      {/* Owner p9-4: how long the method can take, where it is picked. */}
                      {upTo(m) === null ? null : (
                        <span className="x2f-method__sub" data-part="up-to">
                          {upTo(m)}
                        </span>
                      )}
                    </span>
                    <Icon name="chevron-right" size={18} />
                  </Link>
                ))}
              </div>
            )}
          </section>
        ))}
        {current && q !== '' && sections.length === 0 ? (
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
