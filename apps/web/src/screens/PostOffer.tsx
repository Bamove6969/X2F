// PostOffer (Task 21), board design/x2f-app/PostOffer.dc.html. Price is always the market ± %: the
// vendor picks above or below and types the percentage, at most 50% (owner Q1, 6 Nov: no fixed-price
// offers; F1, 7 Nov, over the board's ±10% stepper); every price shows its US-dollar value in another
// currency (spec 11.6); the minimum completed trades is shown openly in the preview (spec 2.3).
// The form is kept in sessionStorage, so a signed-out poster (sent to setup) or one with no
// wallet (sent to Add a wallet by the API client) comes back to it filled in.
import { useEffect, useId, useMemo, useState, type ChangeEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ApiCallError, safeReturnTo } from '../api/client.js';
import { Button } from '../ui/Button.js';
import { CantDoThat, type CantDoCode } from '../ui/CantDoThat.js';
import { Icon } from '../ui/icons.js';
import { RadioChips } from './browse/RadioChips.js';
import { fetchMethods, fetchPrice, postOffer, type PickMethod, type PriceQuote, type Side } from './post/api.js';
import { COUNTRIES } from './post/countries.js';
import { UnitSwitch } from './post/UnitSwitch.js';
import { marketUpdated, otherUnit, rowsAt } from './browse/offerAmounts.js';
import { MY_OFFERS_PATH } from './myoffers/model.js';
import {
  DEFAULT_FORM,
  FEE_SENTENCE,
  GIFT_CARD_WARNING,
  MARGIN_SIDES,
  METHODS_FAILED,
  MIN_TRADES_OPTIONS,
  POST_CURRENCIES,
  PRICE_UNAVAILABLE,
  UNIT_HELP,
  afterPostPath,
  clearDraft,
  formatMoney,
  formatPrice,
  loadDraft,
  marginBpsOf,
  marginText,
  marginWord,
  parseRangeAmount,
  previewLine,
  priceWithMargin,
  POST_CANT_TITLE,
  postCantDo,
  refusalText,
  saveDraft,
  switchUnit,
  usdValue,
  validate,
  type FieldError,
  type FormState,
} from './post/offerForm.js';
import './post/PostOffer.css';
import { accountTypeOf } from '../session/member.js';
import { useSession } from '../session/useSession.js';
import { NOT_VENDOR_CODE, NOT_VENDOR_POST_TEXT } from '../ui/cantDoCodes.js';
import { ACCOUNT_TYPE_COPY, ACCOUNT_TYPE_PATH } from './settings/accountTypeCopy.js';

/** Re-asks the feed this often, so "right now" stays true while the form is open. */
const PRICE_REFRESH_MS = 60_000;

const SIDES: readonly { id: Side; label: string }[] = [
  { id: 'sell', label: 'Sell XMR' },
  { id: 'buy', label: 'Buy XMR' },
];

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

/** Where Close goes: the Buy side when the poster came from it (router state `from`, set by the tab bar), else Sell. */
export function closePath(state: unknown): string {
  const from = state !== null && typeof state === 'object' ? (state as { from?: unknown }).from : undefined;
  return typeof from === 'string' && /^\/buy(\/|\?|$)/.test(from) ? '/buy' : '/sell';
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

type Methods = { kind: 'loading' } | { kind: 'ready'; list: PickMethod[] } | { kind: 'failed' };

/** The catalog list (`all`), read once per visit and again on Retry; it does not depend on side or currency. */
function useMethods(): [Methods, () => void] {
  const [methods, setMethods] = useState<Methods>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setMethods({ kind: 'loading' });
    fetchMethods(DEFAULT_FORM.side, DEFAULT_FORM.currency).then(
      (m) => live && setMethods({ kind: 'ready', list: m }),
      () => live && setMethods({ kind: 'failed' }),
    );
    return () => {
      live = false;
    };
  }, [attempt]);
  return [methods, () => setAttempt((n) => n + 1)];
}

function PostOfferForm() {
  const location = useLocation();
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(() => initialForm(location.search));
  const [methods, retryMethods] = useMethods();
  const [errors, setErrors] = useState<Partial<Record<FieldError, string>>>({});
  const [refusal, setRefusal] = useState<string | null>(null);
  // A refusal by a rule (trading hold, maintenance) opens CantDoThat until closed (Plan 5 Task 21).
  const [cantDo, setCantDo] = useState<CantDoCode | null>(null);
  const [busy, setBusy] = useState(false);
  const quote = usePrice(form.currency);
  const ids = useId();

  // The draft is in state now; drop it so a later visit starts from its own query. (Not in the
  // useState initializer, which StrictMode runs twice.)
  useEffect(() => {
    const s = storage();
    if (s) clearDraft(s);
  }, []);

  // A method that is not on the list (unavailable, P3-I20, or unknown) is never kept selected.
  const list = methods.kind === 'ready' ? methods.list : null;
  const method = list?.find((m) => m.id === form.methodId) ?? null;
  useEffect(() => {
    if (list && form.methodId !== '' && !method) setForm((f) => ({ ...f, methodId: '' }));
  }, [list, method, form.methodId]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setRefusal(null);
    setCantDo(null);
  };
  const text = (key: 'min' | 'max' | 'marginPct' | 'terms') => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(key, e.target.value);
  // One unit per offer (lead default, 8 Nov): either box's switch swaps both, converting what is typed
  // at your price, or clearing it with no price (review H1: a typed number never changes unit).
  const changeUnit = (u: FormState['unit']) => {
    setForm((f) => switchUnit(f, u, yourPrice));
    setRefusal(null);
    setCantDo(null);
  };
  const unitSwitch = (box: string) => <UnitSwitch box={box} currency={form.currency} unit={form.unit} onChange={changeUnit} />;
  // Under each box, the other unit at your price (boards v142): "≈ $165.77 at your price (+0.5%)".
  // COPY-UNSIGNED: "≈ … at your price (+N%)" and "≈ … at your price".
  const otherLine = (raw: string) => {
    const v = parseRangeAmount(raw, form.unit);
    if (v === null || v === 0n || yourPrice === null) return null;
    const at = marginBps === null ? 'at your price' : `at your price (${marginText(marginBps)})`;
    return (
      <span className="post-muted post-other-unit" data-part="other-unit">
        {`${otherUnit(v, form.unit, form.currency, { currency: form.currency, centsPerXmr: yourPrice })} ${at}`}
      </span>
    );
  };

  const market = quote ? quote.centsPerXmr : null;
  // The typed margin in basis points, or null while the box is not a percentage from 0 to 50.
  const marginBps = marginBpsOf(form);
  const yourPrice = useMemo(() => (market === null || marginBps === null ? null : priceWithMargin(market, marginBps)), [marginBps, market]);
  const nonUsd = form.currency !== 'USD';
  const usd = (cents: bigint) => (quote && nonUsd ? formatPrice(usdValue(cents, quote), 'USD') : null);

  const min = parseRangeAmount(form.min, form.unit);
  const max = parseRangeAmount(form.max, form.unit);
  // The preview shows the range in both units at your price, as takers see it with the markup on
  // (owner, 8 Nov); the unit you typed in is exact, the other is worked out at today's rate.
  const rangeRows =
    min !== null && max !== null && min > 0n && max >= min
      ? rowsAt({ unit: form.unit, min, max }, form.currency, yourPrice === null ? null : { currency: form.currency, centsPerXmr: yourPrice })
      : null;
  const giftCard = method?.giftCard === true;

  async function submit(): Promise<void> {
    const r = validate(form, { giftCard });
    setErrors(r.errors);
    setRefusal(null);
    setCantDo(null);
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
      const code = e instanceof ApiCallError ? e.code : 'network';
      setRefusal(refusalText(code, e instanceof ApiCallError ? e.extra : undefined));
      setCantDo(postCantDo(code));
    }
  }

  const errorId = (k: FieldError) => `${ids}-${k}-error`;
  const invalid = (k: FieldError) =>
    errors[k] ? { 'aria-invalid': true as const, 'aria-describedby': errorId(k) } : {};
  // The error comes after the <label>, never inside it: it describes the control (aria-describedby)
  // and is no part of the control's name.
  const fieldError = (k: FieldError) =>
    errors[k] ? (
      <span className="post-error" id={errorId(k)}>
        {errors[k]}
      </span>
    ) : null;
  const field = (id: string, label: string, control: ReactNode, error: FieldError | null = null) => (
    <div className="post-field">
      <label htmlFor={id}>{label}</label>
      {control}
      {error ? fieldError(error) : null}
    </div>
  );

  return (
    <div className="post" data-screen="post">
      <header className="post-header">
        <Link to={closePath(location.state)} aria-label="Close" className="x2f-icon-button post-close">
          <Icon name="close" size={22} />
        </Link>
        <h1 className="x2f-screen-title">Post an offer</h1>
      </header>

      <main className="post-main">
        <div className="post-card">
          <section className="post-section">
            <span className="post-label" id={`${ids}-side`}>
              I want to
            </span>
            <RadioChips label={{ by: `${ids}-side` }} options={SIDES} value={form.side} onChange={(v) => set('side', v)} className="post-two post-choices" />
          </section>

          <section className="post-method-row">
            {methods.kind === 'failed' ? (
              <div className="post-field">
                <span className="post-caption">Payment method</span>
                <span className="post-error post-load-failed">{METHODS_FAILED}</span>
                <Button variant="secondary" onClick={retryMethods}>
                  Retry
                </Button>
              </div>
            ) : (
              field(
                'method',
                'Payment method',
                <select id="method" value={form.methodId} onChange={(e) => set('methodId', e.target.value)} {...invalid('method')}>
                  <option value="" disabled>
                    Choose a method
                  </option>
                  {(list ?? []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>,
                'method',
              )
            )}
            {field(
              'currency',
              'Currency',
              <select id="currency" value={form.currency} onChange={(e) => set('currency', e.target.value)}>
                {POST_CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>,
            )}
          </section>

          {giftCard ? (
            <>
              {field(
                'country',
                'Country',
                <select id="country" value={form.country} onChange={(e) => set('country', e.target.value)} {...invalid('country')}>
                  <option value="" disabled>
                    Choose the card's country
                  </option>
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>,
                'country',
              )}
              <p className="post-giftcard">
                <strong>{GIFT_CARD_WARNING}</strong>
              </p>
            </>
          ) : null}
        </div>

        <section className="post-section post-card">
          <span className="x2f-section-title" id={`${ids}-price`}>
            Your price
          </span>
          {/* Owner F1: above or below the market, then the percentage typed in, 0 to 50. */}
          <RadioChips
            label={{ by: `${ids}-price` }}
            options={MARGIN_SIDES}
            value={form.marginSide}
            onChange={(v) => set('marginSide', v)}
            className="post-two post-choices post-choices--small"
          />
          {/* DESIGN: wording. COPY-UNSIGNED: "Percentage". */}
          {field(
            'margin',
            'Percentage',
            <>
              <div className="post-amount post-margin-box">
                <input id="margin" type="text" inputMode="decimal" autoComplete="off" className="post-mono" value={form.marginPct} onChange={text('marginPct')} {...invalid('margin')} />
                <span className="post-margin-unit" aria-hidden="true">
                  %
                </span>
              </div>
              {marginBps !== null ? (
                <span className="post-muted" data-part="margin-reads">
                  <span className="post-mono post-ink">{marginText(marginBps)}</span> <span>{marginWord(marginBps)}</span>
                </span>
              ) : null}
            </>,
            'margin',
          )}
          {market === null || quote === undefined ? (
            <span className="post-note">{quote === undefined ? '' : PRICE_UNAVAILABLE}</span>
          ) : (
            <span className="post-note">
              Market {formatPrice(market, form.currency)}
              {quote && nonUsd ? ` (about ${formatMoney(usdValue(market, quote), 'USD')})` : ''} right now.
              {yourPrice !== null ? (
                <>
                  {' '}
                  Your price follows the market, so it's always <span className="post-ink">{formatPrice(yourPrice, form.currency)}</span> at today's rate.
                </>
              ) : null}
            </span>
          )}
          {quote && marketUpdated(quote.at) !== null ? (
            <span className="post-note" data-part="market-updated">
              {marketUpdated(quote.at)}
            </span>
          ) : null}
        </section>

        <div className="post-card">
          <section className="post-ranges">
            {field(
              'min',
              'Smallest trade',
              <>
              <div className="post-amount">
                <input id="min" type="text" inputMode="decimal" autoComplete="off" className="post-mono" value={form.min} onChange={text('min')} {...invalid('min')} />
                {unitSwitch('Smallest trade')}
              </div>
              {otherLine(form.min)}
              </>,
              'min',
            )}
            {field(
              'max',
              'Largest trade',
              <>
              <div className="post-amount">
                <input id="max" type="text" inputMode="decimal" autoComplete="off" className="post-mono" value={form.max} onChange={text('max')} {...invalid('max')} />
                {unitSwitch('Largest trade')}
              </div>
              {otherLine(form.max)}
              </>,
              'max',
            )}
            <span className="post-muted post-unit-help">{UNIT_HELP}</span>
          </section>

          {field(
            'terms',
            'Your terms (optional)',
            <textarea
              id="terms"
              rows={3}
              placeholder="e.g. Zelle only from an account in your own name. Put the trade number in the memo."
              value={form.terms}
              onChange={text('terms')}
              {...invalid('terms')}
            />,
            'terms',
          )}
        </div>

        <section className="post-section post-card">
          <span className="x2f-section-title">Who can trade with you</span>
          <span className="post-label" id={`${ids}-mintrades`}>
            Minimum completed trades
          </span>
          {/* Owner, 8 Nov: a fixed choice, No minimum (the default) or 5, 10, 25, 50. */}
          <RadioChips
            label={{ by: `${ids}-mintrades` }}
            options={MIN_TRADES_OPTIONS}
            value={MIN_TRADES_OPTIONS.find((o) => o.value === form.minTrades)!.id}
            onChange={(id) => set('minTrades', MIN_TRADES_OPTIONS.find((o) => o.id === id)!.value)}
            className="post-choices post-choices--small post-mintrades"
          />
        </section>

        <section aria-label="Preview" className="post-section">
          <span className="post-label">How others will see it</span>
          <div className="post-preview">
            <span className="post-muted">{previewLine(form.side, method?.name ?? 'your method', form.currency, form.minTrades)}</span>
            <div className="post-preview-row">
              <span className="post-preview-price">
                {/* DESIGN: wording. COPY-UNSIGNED: "Set your percentage" (while the percentage box is not 0 to 50). */}
                <span className="post-mono post-big">{yourPrice !== null ? formatPrice(yourPrice, form.currency) : marginBps === null ? 'Set your percentage' : PRICE_UNAVAILABLE}</span>
                {yourPrice !== null && usd(yourPrice) ? <span className="post-muted">{`about ${usd(yourPrice)}`}</span> : null}
              </span>
              <span className="post-preview-range">
                {rangeRows === null ? (
                  <span className="post-muted">Set your smallest and largest trade</span>
                ) : (
                  <>
                    {rangeRows.xmr !== null ? (
                      <span className="post-muted" data-part="preview-xmr">
                        {`${rangeRows.xmr} XMR`}
                      </span>
                    ) : null}
                    {rangeRows.fiat !== null ? (
                      <span className="post-muted" data-part="preview-fiat">
                        {`${rangeRows.fiat} ${form.currency}`}
                      </span>
                    ) : null}
                  </>
                )}
              </span>
            </div>
          </div>
          <span className="post-muted">{FEE_SENTENCE}</span>
        </section>

        {/* Task 36: the way to My offers (no board places it yet: NEEDS_DESIGN_MYOFFERS). */}
        <Link className="x2f-button x2f-button--quiet" to={MY_OFFERS_PATH} data-part="my-offers">
          My offers
        </Link>
      </main>

      <footer className="post-footer">
        {refusal && cantDo === null ? (
          <p role="alert" className="post-refusal">
            {refusal}
          </p>
        ) : null}
        {refusal && cantDo !== null ? <CantDoThat title={POST_CANT_TITLE} body={refusal} from={cantDo} onClose={() => setCantDo(null)} /> : null}
        <Button variant="primary" className="post-submit" onClick={() => void submit()} disabled={busy} aria-busy={busy}>
          Post offer
        </Button>
      </footer>
    </div>
  );
}

/**
 * Owner 2 Nov 2026: only vendor accounts post offers. A signed-in trader (or a member of a trader
 * account) gets the not-vendor refusal and the way to Settings > Account type instead of the form;
 * everyone else gets the form (signed out: it sends them to setup and back, as before).
 */
export function PostOffer() {
  const session = useSession();
  const navigate = useNavigate();
  if (accountTypeOf(session) !== 'trader') return <PostOfferForm />;
  return (
    <main className="x2f-screen" data-screen="post-not-vendor">
      <Link className="x2f-button x2f-button--primary" to={ACCOUNT_TYPE_PATH} data-primary="" data-part="account-type">
        {ACCOUNT_TYPE_COPY.switchButton}
      </Link>
      <CantDoThat title={POST_CANT_TITLE} body={NOT_VENDOR_POST_TEXT} from={NOT_VENDOR_CODE} onClose={() => void navigate('/sell')} />
    </main>
  );
}
