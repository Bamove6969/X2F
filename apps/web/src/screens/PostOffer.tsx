// PostOffer (Task 21), board design/x2f-app/PostOffer.dc.html. Price is Market ± % (the default)
// or Fixed price per XMR (spec 2.2 step 5); every price shows its US-dollar value in another
// currency (spec 11.6); the minimum completed trades is shown openly in the preview (spec 2.3).
// The form is kept in sessionStorage, so a signed-out poster (sent to setup) or one with no
// wallet (sent to Add a wallet by the API client) comes back to it filled in.
import { useEffect, useId, useMemo, useState, type ChangeEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ApiCallError, safeReturnTo } from '../api/client.js';
import { Button } from '../ui/Button.js';
import { Icon } from '../ui/icons.js';
import { fetchMethods, fetchPrice, postOffer, type PickMethod, type PriceQuote } from './post/api.js';
import {
  DEFAULT_FORM,
  FEE_SENTENCE,
  FIXED_STALE_WARNING,
  GIFT_CARD_WARNING,
  MIN_TRADES,
  POST_CURRENCIES,
  PRICE_UNAVAILABLE,
  afterPostPath,
  clearDraft,
  formatAmount,
  formatPrice,
  loadDraft,
  marginText,
  marginWord,
  parseAmount,
  previewLine,
  priceWithMargin,
  refusalText,
  saveDraft,
  stepMargin,
  usdValue,
  validate,
  type FieldError,
  type FormState,
  type MinTrades,
} from './post/offerForm.js';
import './post/PostOffer.css';

/** Re-asks the feed this often, so "right now" stays true while the form is open. */
const PRICE_REFRESH_MS = 60_000;

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * The draft saved by a Post offer that was sent on to setup or Add a wallet (dropped once read,
 * see the mount effect), else the board defaults with any ?side, ?method, ?currency applied.
 */
function initialForm(search: string): FormState {
  const s = storage();
  const draft = s ? loadDraft(s) : null;
  if (draft) return draft;
  const q = new URLSearchParams(search);
  const side = q.get('side');
  const currency = q.get('currency');
  return {
    ...DEFAULT_FORM,
    side: side === 'buy' ? 'buy' : 'sell',
    methodId: q.get('method') ?? '',
    currency: currency !== null && POST_CURRENCIES.includes(currency) ? currency : DEFAULT_FORM.currency,
  };
}

function usePrice(currency: string): PriceQuote | null | undefined {
  const [quote, setQuote] = useState<{ currency: string; q: PriceQuote | null } | undefined>();
  useEffect(() => {
    const ctl = new AbortController();
    const load = () =>
      void fetchPrice(currency, ctl.signal).then(
        (q) => setQuote({ currency, q: q?.currency === currency ? q : null }),
        () => undefined,
      );
    load();
    const t = window.setInterval(load, PRICE_REFRESH_MS);
    return () => {
      ctl.abort();
      window.clearInterval(t);
    };
  }, [currency]);
  // undefined while loading this currency's price, null when the feed has none.
  return quote?.currency === currency ? quote.q : undefined;
}

export function PostOffer() {
  const location = useLocation();
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(() => initialForm(location.search));
  const [methods, setMethods] = useState<PickMethod[] | null>(null);
  const [errors, setErrors] = useState<Partial<Record<FieldError, string>>>({});
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const quote = usePrice(form.currency);
  const ids = useId();

  // The draft is in state now; drop it so a later visit starts from its own query. (Not in the
  // useState initializer, which StrictMode runs twice.)
  useEffect(() => {
    const s = storage();
    if (s) clearDraft(s);
  }, []);

  useEffect(() => {
    let live = true;
    fetchMethods(form.side, form.currency).then(
      (m) => live && setMethods(m),
      () => live && setMethods([]),
    );
    return () => {
      live = false;
    };
    // The catalog list (`all`) does not depend on side or currency; one read per visit is enough.
  }, []);

  // A method that is not on the list (unavailable, P3-I20, or unknown) is never kept selected.
  const method = methods?.find((m) => m.id === form.methodId) ?? null;
  useEffect(() => {
    if (methods && form.methodId !== '' && !method) setForm((f) => ({ ...f, methodId: '' }));
  }, [methods, method, form.methodId]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setRefusal(null);
  };
  const text = (key: 'min' | 'max' | 'fixed' | 'terms') => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(key, e.target.value);

  const market = quote ? quote.centsPerXmr : null;
  const yourPrice = useMemo(() => {
    if (form.priceMode === 'fixed') {
      const p = parseAmount(form.fixed);
      return p !== null && p > 0n ? p : null;
    }
    return market === null ? null : priceWithMargin(market, form.marginBps);
  }, [form.priceMode, form.fixed, form.marginBps, market]);
  const nonUsd = form.currency !== 'USD';
  const usd = (cents: bigint) => (quote && nonUsd ? formatPrice(usdValue(cents, quote), 'USD') : null);

  const min = parseAmount(form.min);
  const max = parseAmount(form.max);
  const range = min !== null && max !== null ? `${formatAmount(min, form.currency)} – ${formatAmount(max, form.currency)}` : 'Set your smallest and largest trade';

  async function submit(): Promise<void> {
    const r = validate(form);
    setErrors(r.errors);
    setRefusal(null);
    if (!r.body) return;
    // Kept until the offer is posted, in case the API sends the page to setup or Add a wallet.
    const s = storage();
    if (s) saveDraft(s, form);
    setBusy(true);
    try {
      await postOffer(r.body);
      if (s) clearDraft(s);
      void navigate(afterPostPath(form.side, form.methodId, form.currency));
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiCallError && e.status === 401) {
        const back = safeReturnTo(location.pathname + location.search);
        void navigate(`/setup?returnTo=${encodeURIComponent(back)}`);
        return;
      }
      // terms-required and no-wallet have already sent the page on (api client); the draft waits.
      if (e instanceof ApiCallError && (e.code === 'terms-required' || e.code === 'no-wallet')) return;
      setRefusal(refusalText(e instanceof ApiCallError ? e.code : 'network'));
    }
  }

  const errorId = (k: FieldError) => `${ids}-${k}-error`;
  const invalid = (k: FieldError) =>
    errors[k] ? { 'aria-invalid': true as const, 'aria-describedby': errorId(k) } : {};
  const fieldError = (k: FieldError) =>
    errors[k] ? (
      <span className="post-error" id={errorId(k)}>
        {errors[k]}
      </span>
    ) : null;
  const sideButton = (side: 'sell' | 'buy', label: string) => (
    <button type="button" role="radio" aria-checked={form.side === side} className="post-choice" onClick={() => set('side', side)}>
      {label}
    </button>
  );
  const modeButton = (mode: 'market' | 'fixed', label: string) => (
    <button type="button" role="radio" aria-checked={form.priceMode === mode} className="post-choice post-choice--small" onClick={() => set('priceMode', mode)}>
      {label}
    </button>
  );

  return (
    <div className="post" data-screen="post">
      <header className="post-header">
        <Link to="/sell" aria-label="Close" className="post-close">
          <Icon name="close" size={22} />
        </Link>
        <h1>Post an offer</h1>
      </header>

      <main className="post-main">
        <section className="post-section">
          <span className="post-label">I want to</span>
          <div role="radiogroup" aria-label="I want to" className="post-two">
            {sideButton('sell', 'Sell XMR')}
            {sideButton('buy', 'Buy XMR')}
          </div>
        </section>

        <section className="post-method-row">
          <label htmlFor="method" className="post-field">
            Payment method
            <select id="method" value={form.methodId} onChange={(e) => set('methodId', e.target.value)} {...invalid('method')}>
              <option value="" disabled>
                Choose a method
              </option>
              {(methods ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            {fieldError('method')}
          </label>
          <label htmlFor="currency" className="post-field">
            Currency
            <select id="currency" value={form.currency} onChange={(e) => set('currency', e.target.value)}>
              {POST_CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </section>

        {method?.giftCard ? (
          <p className="post-giftcard">
            <strong>{GIFT_CARD_WARNING}</strong>
          </p>
        ) : null}

        <section className="post-section">
          <span className="post-label">Your price</span>
          <div role="radiogroup" aria-label="Price" className="post-two">
            {modeButton('market', 'Market ± %')}
            {modeButton('fixed', 'Fixed price per XMR')}
          </div>
          {form.priceMode === 'market' ? (
            <div className="post-margin">
              <button type="button" aria-label="Lower margin by 0.1%" className="post-step" onClick={() => set('marginBps', stepMargin(form.marginBps, -1))}>
                −
              </button>
              <div className="post-margin-value">
                <span className="post-mono post-big">{marginText(form.marginBps)}</span>
                <span className="post-muted">{marginWord(form.marginBps)}</span>
              </div>
              <button type="button" aria-label="Raise margin by 0.1%" className="post-step" onClick={() => set('marginBps', stepMargin(form.marginBps, 1))}>
                +
              </button>
            </div>
          ) : (
            <label htmlFor="fixed" className="post-field">
              Your price per XMR
              <input id="fixed" type="text" inputMode="decimal" autoComplete="off" value={form.fixed} onChange={text('fixed')} {...invalid('fixed')} />
              {fieldError('fixed')}
            </label>
          )}
          {market === null || quote === undefined ? (
            <span className="post-note">{quote === undefined ? '' : PRICE_UNAVAILABLE}</span>
          ) : (
            <span className="post-note">
              Market {formatPrice(market, form.currency)}
              {nonUsd ? ` (about ${usd(market)})` : ''} right now.
              {form.priceMode === 'market' && yourPrice !== null ? (
                <>
                  {' '}
                  Your price follows the market, so it's always <span className="post-ink">{formatPrice(yourPrice, form.currency)}</span> at today's rate.
                </>
              ) : null}
            </span>
          )}
          {form.priceMode === 'fixed' ? (
            <span className="post-caution">
              <Icon name="alert" size={20} />
              {FIXED_STALE_WARNING}
            </span>
          ) : null}
        </section>

        <section className="post-two">
          <label htmlFor="min" className="post-field">
            Smallest trade
            <input id="min" type="text" inputMode="decimal" autoComplete="off" className="post-mono" value={form.min} onChange={text('min')} {...invalid('min')} />
            {fieldError('min')}
          </label>
          <label htmlFor="max" className="post-field">
            Largest trade
            <input id="max" type="text" inputMode="decimal" autoComplete="off" className="post-mono" value={form.max} onChange={text('max')} {...invalid('max')} />
            {fieldError('max')}
          </label>
        </section>

        <label htmlFor="terms" className="post-field">
          Your terms (optional)
          <textarea
            id="terms"
            rows={3}
            placeholder="e.g. Zelle only from an account in your own name. Put the trade number in the memo."
            value={form.terms}
            onChange={text('terms')}
          />
        </label>

        <section className="post-section">
          <span className="post-label">Who can trade with you</span>
          <label htmlFor="mintrades" className="post-inline">
            Minimum completed trades
            <select id="mintrades" value={form.minTrades} onChange={(e) => set('minTrades', Number(e.target.value) as MinTrades)}>
              {MIN_TRADES.map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? 'Anyone' : `${n}+`}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section aria-label="Preview" className="post-section">
          <span className="post-label">How others will see it</span>
          <div className="post-preview">
            <span className="post-muted">{previewLine(form.side, method?.name ?? 'your method', form.currency, form.minTrades)}</span>
            <div className="post-preview-row">
              <span className="post-preview-price">
                <span className="post-mono post-big">{yourPrice !== null ? formatPrice(yourPrice, form.currency) : form.priceMode === 'fixed' ? 'Set your price' : PRICE_UNAVAILABLE}</span>
                {yourPrice !== null && usd(yourPrice) ? <span className="post-muted">{`about ${usd(yourPrice)}`}</span> : null}
              </span>
              <span className="post-muted">{range}</span>
            </div>
          </div>
          <span className="post-muted">{FEE_SENTENCE}</span>
        </section>
      </main>

      <footer className="post-footer">
        {refusal ? (
          <p role="alert" className="post-refusal">
            {refusal}
          </p>
        ) : null}
        <Button variant="primary" className="post-submit" onClick={() => void submit()} disabled={busy} aria-busy={busy}>
          Post offer
        </Button>
      </footer>
    </div>
  );
}
