// PostOffer (Task 21; J-16, Plan 3 Tasks 34/35: flexible offers), board design/x2f-app/PostOffer.dc.html
// and FlexOffer-Post. An offer lists up to 5 currencies, each with up to 3 amount bands (owner Q23),
// and up to 5 payment methods (owner Q23), each with its own price change and payment instructions.
// Every band's price is the market ± %: the vendor picks above or below and types the percentage, at
// most 50% (owner Q1, 6 Nov: no fixed-price offers; F1, 7 Nov, over the board's ±10% stepper); every
// price shows its US-dollar value in another currency (spec 11.6); each band's minimum completed
// trades is shown openly (spec 2.3). The form is kept in sessionStorage, so a signed-out poster
// (sent to setup) or one with no wallet (sent to Add a wallet by the API client) comes back to it.
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import type { CurrencyChoice } from '@x2f/trade';
import { ApiCallError, safeReturnTo } from '../api/client.js';
import { Button } from '../ui/Button.js';
import { CantDoThat, type CantDoCode } from '../ui/CantDoThat.js';
import { Icon } from '../ui/icons.js';
import { RadioChips } from './browse/RadioChips.js';
import { fetchCurrencies, fetchMethods, fetchPrice, postOffer, type PickMethod, type PriceQuote, type Side } from './post/api.js';
import { COUNTRIES } from './post/countries.js';
import { UnitSwitch } from './post/UnitSwitch.js';
import { marketUpdated, otherUnit, rowsAt } from './browse/offerAmounts.js';
import { MY_OFFERS_PATH } from './myoffers/model.js';
import {
  DEFAULT_FORM,
  FEE_SENTENCE,
  GIFT_CARD_WARNING,
  MARGIN_SIDES,
  MAX_BANDS,
  MAX_CURRENCIES,
  MAX_METHODS,
  METHODS_FAILED,
  MIN_TRADES_OPTIONS,
  POST_COPY,
  POST_CURRENCIES,
  PRICE_UNAVAILABLE,
  UNIT_HELP,
  addBand,
  addCurrency,
  addMethod,
  adjustText,
  afterPostPath,
  canSwitchUnit,
  clearDraft,
  currencyLabel,
  currencyOptions,
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
  removeBand,
  removeCurrency,
  removeMethod,
  saveDraft,
  setBand,
  setMethod,
  stepAdjust,
  switchUnit,
  usdValue,
  validate,
  type BandDraft,
  type FormErrors,
  type FormState,
  type MinTrades,
} from './post/offerForm.js';
import './post/PostOffer.css';
import { accountTypeOf } from '../session/member.js';
import { useSession } from '../session/useSession.js';
import { NOT_VENDOR_CODE, NOT_VENDOR_POST_TEXT } from '../ui/cantDoCodes.js';
import { ACCOUNT_TYPE_COPY, ACCOUNT_TYPE_PATH } from './settings/accountTypeCopy.js';

/** Re-asks the feed this often, so "right now" stays true while the form is open. */
const PRICE_REFRESH_MS = 60_000;
/**
 * Re-asks GET /v1/currencies this often, so a currency whose rate comes back is offered again
 * without a reload (owner Q24: "comes back in an instant"); a picked currency is back the moment its
 * own price arrives (`currencyOptions`' `priced`).
 */
const CURRENCIES_REFRESH_MS = 30_000;

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
  const method = q.get('method');
  let f: FormState = { ...DEFAULT_FORM, side: side === 'buy' ? 'buy' : 'sell' };
  if (currency !== null && POST_CURRENCIES.includes(currency) && currency !== f.currencies[0]) {
    const first = f.currencies[0]!;
    f = removeCurrency(addCurrency(f, currency), first);
  }
  return method === null || method === '' ? f : addMethod(f, method);
}

/** Where Close goes: the Buy side when the poster came from it (router state `from`, set by the tab bar), else Sell. */
export function closePath(state: unknown): string {
  const from = state !== null && typeof state === 'object' ? (state as { from?: unknown }).from : undefined;
  return typeof from === 'string' && /^\/buy(\/|\?|$)/.test(from) ? '/buy' : '/sell';
}

/** Each picked currency's market price: undefined while loading, null when the feed has none. */
function usePrices(currencies: readonly string[]): Record<string, PriceQuote | null | undefined> {
  const [quotes, setQuotes] = useState<Record<string, PriceQuote | null>>({});
  const key = currencies.join(',');
  useEffect(() => {
    const ctl = new AbortController();
    const list = key === '' ? [] : key.split(',');
    const load = () => {
      for (const currency of list) {
        void fetchPrice(currency, ctl.signal).then(
          (q) => setQuotes((all) => ({ ...all, [currency]: q?.currency === currency ? q : null })),
          () => undefined,
        );
      }
    };
    load();
    const t = window.setInterval(load, PRICE_REFRESH_MS);
    return () => {
      ctl.abort();
      window.clearInterval(t);
    };
  }, [key]);
  const out: Record<string, PriceQuote | null | undefined> = {};
  for (const c of currencies) out[c] = quotes[c];
  return out;
}

/** GET /v1/currencies, read now and every CURRENCIES_REFRESH_MS; null until it first answers (or while it fails). */
function useCurrencyChoices(): CurrencyChoice[] | null {
  const [choices, setChoices] = useState<CurrencyChoice[] | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    const load = () => void fetchCurrencies(ctl.signal).then(setChoices, () => undefined);
    load();
    const t = window.setInterval(load, CURRENCIES_REFRESH_MS);
    return () => {
      ctl.abort();
      window.clearInterval(t);
    };
  }, []);
  return choices;
}

type Methods = { kind: 'loading' } | { kind: 'ready'; list: PickMethod[] } | { kind: 'failed' };

/** The catalog list (`all`), read once per visit and again on Retry; it does not depend on side or currency. */
function useMethods(): [Methods, () => void] {
  const [methods, setMethods] = useState<Methods>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setMethods({ kind: 'loading' });
    fetchMethods(DEFAULT_FORM.side, DEFAULT_FORM.currencies[0]!).then(
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
  const [errors, setErrors] = useState<FormErrors>({});
  const [refusal, setRefusal] = useState<string | null>(null);
  // A refusal by a rule (trading hold, maintenance) opens CantDoThat until closed (Plan 5 Task 21).
  const [cantDo, setCantDo] = useState<CantDoCode | null>(null);
  const [busy, setBusy] = useState(false);
  const quotes = usePrices(form.currencies);
  const choices = useCurrencyChoices();
  const ids = useId();

  // The draft is in state now; drop it so a later visit starts from its own query. (Not in the
  // useState initializer, which StrictMode runs twice.)
  useEffect(() => {
    const s = storage();
    if (s) clearDraft(s);
  }, []);

  // A method that is not on the list (unavailable, P3-I20, or unknown) is never kept on the offer.
  const list = methods.kind === 'ready' ? methods.list : null;
  const nameOf = (id: string) => list?.find((m) => m.id === id)?.name ?? id;
  useEffect(() => {
    if (!list) return;
    const gone = form.methods.filter((m) => !list.some((x) => x.id === m.methodId));
    if (gone.length > 0) setForm((f) => gone.reduce((g, m) => removeMethod(g, m.methodId), f));
  }, [list, form.methods]);

  const edit = (change: (f: FormState) => FormState) => {
    setForm(change);
    setRefusal(null);
    setCantDo(null);
  };
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => edit((f) => ({ ...f, [key]: value }));

  const marketOf = (c: string): bigint | null => quotes[c]?.centsPerXmr ?? null;
  const markets: Record<string, bigint | null> = {};
  for (const c of form.currencies) markets[c] = marketOf(c);
  // One unit per offer (lead default, 8 Nov): the switch converts every band at its own price, or
  // clears it with no price (review H1: a typed number never changes unit). In XMR a currency has one band.
  const changeUnit = (u: FormState['unit']) => edit((f) => switchUnit(f, u, markets));
  const xmrBlocked = form.unit === 'fiat' && !canSwitchUnit(form, 'xmr');
  const unitLabel = form.currencies.length === 1 ? form.currencies[0]! : 'Currency'; // COPY-UNSIGNED: the fiat side of the switch with several currencies

  const options = currencyOptions(choices, (c) => quotes[c] != null);
  const picked = new Set(form.currencies);
  const optionOf = (c: string) => options.find((o) => o.code === c);
  const giftCard = form.methods.some((m) => list?.find((x) => x.id === m.methodId)?.giftCard === true);

  async function submit(): Promise<void> {
    const r = validate(form, { giftCard: (id) => list?.find((m) => m.id === id)?.giftCard === true });
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
      void navigate(afterPostPath(form.side, form.methods[0]!.methodId, form.currencies[0]!));
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
      setRefusal(refusalText(code));
      setCantDo(postCantDo(code));
    }
  }

  // The error comes after the <label>, never inside it: it describes the control (aria-describedby)
  // and is no part of the control's name.
  const errorId = (k: string) => `${ids}-${k}-error`;
  const invalid = (k: string, e: string | undefined) => (e ? { 'aria-invalid': true as const, 'aria-describedby': errorId(k) } : {});
  const fieldError = (k: string, e: string | undefined) =>
    e ? (
      <span className="post-error" id={errorId(k)}>
        {e}
      </span>
    ) : null;
  const field = (id: string, label: string, control: ReactNode, error?: string) => (
    <div className="post-field">
      <label htmlFor={id}>{label}</label>
      {control}
      {fieldError(id, error)}
    </div>
  );

  /** One band of `currency`: its two ends, its price above or below the market, and its trade rule. */
  const bandRow = (currency: string, b: BandDraft, i: number, count: number) => {
    const quote = quotes[currency];
    const market = quote ? quote.centsPerXmr : null;
    const bps = marginBpsOf(b);
    const price = market === null || bps === null ? null : priceWithMargin(market, bps);
    const e = errors.bands?.[currency]?.rows[b.key] ?? {};
    const id = (part: string) => `${currency}-${b.key}-${part}`;
    const change = (patch: Partial<Omit<BandDraft, 'key'>>) => edit((f) => setBand(f, currency, b.key, patch));
    // Under each box, the other unit at this band's price (boards v142). COPY-UNSIGNED: "≈ … at your price (+N%)".
    const other = (raw: string) => {
      const v = parseRangeAmount(raw, form.unit);
      if (v === null || v === 0n || price === null) return null;
      const minor = form.unit === 'fiat' ? v * 100n : v;
      return (
        <span className="post-muted post-other-unit" data-part="other-unit">
          {`${otherUnit(minor, form.unit, currency, { currency, centsPerXmr: price })} at your price (${marginText(bps!)})`}
        </span>
      );
    };
    const box = (part: 'min' | 'max', label: string) =>
      field(
        id(part),
        label,
        <>
          <div className="post-amount">
            <input id={id(part)} type="text" inputMode="decimal" autoComplete="off" className="post-mono" value={b[part]} onChange={(ev) => change({ [part]: ev.target.value })} {...invalid(id(part), e[part])} />
            <UnitSwitch box={label} currency={unitLabel} unit={form.unit} onChange={changeUnit} />
          </div>
          {other(b[part])}
        </>,
        e[part],
      );
    return (
      <div className="post-band" key={b.key} data-part="band" data-currency={currency}>
        {count > 1 ? (
          <div className="post-band-head">
            {/* COPY-UNSIGNED: "Band N". */}
            <span className="post-label">{`Band ${i + 1}`}</span>
            <Button variant="quiet" onClick={() => edit((f) => removeBand(f, currency, b.key))} aria-label={`${POST_COPY.removeBand} (${currency}, band ${i + 1})`}>
              {POST_COPY.removeBand}
            </Button>
          </div>
        ) : null}
        <section className="post-ranges">
          {box('min', 'Smallest trade')}
          {box('max', 'Largest trade')}
        </section>
        <span className="post-label" id={`${ids}-${id('side')}`}>
          Your price
        </span>
        {/* Owner F1: above or below the market, then the percentage typed in, 0 to 50. */}
        <RadioChips label={{ by: `${ids}-${id('side')}` }} options={MARGIN_SIDES} value={b.marginSide} onChange={(v) => change({ marginSide: v })} className="post-two post-choices post-choices--small" />
        {/* DESIGN: wording. COPY-UNSIGNED: "Percentage". */}
        {field(
          id('margin'),
          'Percentage',
          <>
            <div className="post-amount post-margin-box">
              <input id={id('margin')} type="text" inputMode="decimal" autoComplete="off" className="post-mono" value={b.marginPct} onChange={(ev) => change({ marginPct: ev.target.value })} {...invalid(id('margin'), e.margin)} />
              <span className="post-margin-unit" aria-hidden="true">
                %
              </span>
            </div>
            {bps !== null ? (
              <span className="post-muted" data-part="margin-reads">
                <span className="post-mono post-ink">{marginText(bps)}</span> <span>{marginWord(bps)}</span>
                {price !== null ? <span>{` · ${formatPrice(price, currency)}`}</span> : null}
              </span>
            ) : null}
          </>,
          e.margin,
        )}
        <span className="post-label" id={`${ids}-${id('mintrades')}`}>
          {POST_COPY.whoCanTrade}
        </span>
        {/* Owner, 8 Nov: a fixed choice, No minimum (the default) or 5, 10, 25, 50 (O-017). */}
        <RadioChips
          label={{ by: `${ids}-${id('mintrades')}` }}
          options={MIN_TRADES_OPTIONS}
          value={MIN_TRADES_OPTIONS.find((o) => o.value === b.minTrades)!.id}
          onChange={(v) => change({ minTrades: MIN_TRADES_OPTIONS.find((o) => o.id === v)!.value })}
          className="post-choices post-choices--small post-mintrades"
        />
      </div>
    );
  };

  /** A picked currency's card: its market line and its bands. */
  const currencyCard = (currency: string) => {
    const quote = quotes[currency];
    const market = quote ? quote.centsPerXmr : null;
    const bands = form.bands[currency] ?? [];
    const all = errors.bands?.[currency]?.all;
    const opt = optionOf(currency);
    return (
      <section key={currency} className="post-section post-card" data-part="currency" data-currency={currency} aria-labelledby={`${ids}-${currency}-title`}>
        <span className="x2f-section-title" id={`${ids}-${currency}-title`}>
          {opt ? currencyLabel(opt) : currency}
        </span>
        {market === null || quote === undefined ? (
          <span className="post-note">{quote === undefined ? '' : PRICE_UNAVAILABLE}</span>
        ) : (
          <span className="post-note">
            Market {formatPrice(market, currency)}
            {quote && currency !== 'USD' ? ` (about ${formatMoney(usdValue(market, quote), 'USD')})` : ''} right now. Your prices follow the market.
          </span>
        )}
        {quote && marketUpdated(quote.at) !== null ? (
          <span className="post-note" data-part="market-updated">
            {marketUpdated(quote.at)}
          </span>
        ) : null}
        {bands.map((b, i) => bandRow(currency, b, i, bands.length))}
        {all ? (
          <span className="post-error" role="alert" data-part="bands-error">
            {all}
          </span>
        ) : null}
        {form.unit === 'fiat' ? (
          bands.length < MAX_BANDS ? (
            <Button variant="secondary" onClick={() => edit((f) => addBand(f, currency))} data-part="add-band">
              {POST_COPY.addBand}
            </Button>
          ) : (
            <span className="post-muted">{POST_COPY.bandsFull}</span>
          )
        ) : (
          <span className="post-muted">{POST_COPY.xmrOneBand}</span>
        )}
      </section>
    );
  };

  // The preview: the first currency, its lowest band's price with the first method's change.
  const first = form.currencies[0];
  const firstQuote = first === undefined ? undefined : quotes[first];
  const firstBand = first === undefined ? undefined : form.bands[first]?.[0];
  const firstBps = firstBand === undefined ? null : marginBpsOf(firstBand);
  const adjust = form.methods[0]?.adjustBps ?? 0;
  const previewPrice = firstQuote && firstBps !== null ? priceWithMargin(firstQuote.centsPerXmr, firstBps + adjust) : null;
  // The preview's trade sizes in both units (owner #11, 8 Nov; boards v142): the first currency's
  // envelope, its lowest band start to its highest band end, as that currency's card shows it. The
  // typed unit is exact, the other is worked out at the preview's price; null while a box is not an
  // amount yet.
  const previewRange = (() => {
    if (first === undefined) return null;
    let min: bigint | null = null;
    let max: bigint | null = null;
    for (const b of form.bands[first] ?? []) {
      const lo = parseRangeAmount(b.min, form.unit);
      const hi = parseRangeAmount(b.max, form.unit);
      if (lo === null || hi === null || lo === 0n || hi < lo) return null;
      if (min === null || lo < min) min = lo;
      if (max === null || hi > max) max = hi;
    }
    if (min === null || max === null) return null;
    // Fiat boxes are whole units (O-018); rowsAt takes minor units (the form's currencies are two-decimal, as `other`).
    const minor = (v: bigint) => (form.unit === 'fiat' ? v * 100n : v);
    return rowsAt({ unit: form.unit, min: minor(min), max: minor(max) }, first, previewPrice === null ? null : { currency: first, centsPerXmr: previewPrice });
  })();
  const lowestRule = (): MinTrades => {
    const rules = form.currencies.flatMap((c) => (form.bands[c] ?? []).map((b) => b.minTrades));
    if (rules.length === 0 || rules.some((r) => r === null)) return null;
    return Math.min(...(rules as number[])) as MinTrades;
  };

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

          <section className="post-section" data-part="currencies" aria-label="Currencies">
            <span className="post-label">Currencies</span>
            <span className="post-muted">{POST_COPY.currenciesHelp}</span>
            <div className="post-picked">
              {form.currencies.map((c) => {
                const opt = optionOf(c);
                return (
                  <Button key={c} variant="secondary" onClick={() => edit((f) => removeCurrency(f, c))} aria-label={`Remove ${c}`} data-part="picked-currency">
                    {opt ? currencyLabel(opt) : c} <Icon name="close" size={16} />
                  </Button>
                );
              })}
            </div>
            {form.currencies.length < MAX_CURRENCIES ? (
              field(
                'currency',
                POST_COPY.addCurrency,
                <select
                  id="currency"
                  value=""
                  onChange={(e) => {
                    const c = e.target.value;
                    if (c !== '') edit((f) => addCurrency(f, c));
                  }}
                  {...invalid('currency', errors.currencies)}
                >
                  <option value="" disabled>
                    {POST_COPY.addCurrency}
                  </option>
                  {options
                    .filter((o) => !picked.has(o.code))
                    .map((o) => (
                      <option key={o.code} value={o.code} data-available={o.available ? 'true' : 'false'}>
                        {currencyLabel(o)}
                      </option>
                    ))}
                </select>,
                errors.currencies,
              )
            ) : (
              <span className="post-muted">{POST_COPY.currenciesFull}</span>
            )}
          </section>
        </div>

        <section className="post-section post-card" data-part="methods" aria-label="Payment methods">
          <span className="x2f-section-title">Payment methods</span>
          <span className="post-muted">{POST_COPY.methodsHelp}</span>
          {form.methods.map((m) => {
            const name = nameOf(m.methodId);
            const mid = (part: string) => `method-${m.methodId}-${part}`;
            return (
              <div key={m.methodId} className="post-method" data-part="method" data-method={m.methodId}>
                <div className="post-band-head">
                  <span className="post-ink">{name}</span>
                  <Button variant="quiet" onClick={() => edit((f) => removeMethod(f, m.methodId))} aria-label={`${POST_COPY.removeMethod} ${name}`}>
                    {POST_COPY.removeMethod}
                  </Button>
                </div>
                <span className="post-label" id={`${ids}-${mid('adjust')}`}>
                  {POST_COPY.priceChange}
                </span>
                <div className="post-stepper" role="group" aria-labelledby={`${ids}-${mid('adjust')}`}>
                  <Button variant="secondary" aria-label={`Lower the price change for ${name}`} onClick={() => edit((f) => setMethod(f, m.methodId, { adjustBps: stepAdjust(m.adjustBps, -1) }))}>
                    −
                  </Button>
                  <span className="post-mono" data-part="adjust">
                    {adjustText(m.adjustBps)}
                  </span>
                  <Button variant="secondary" aria-label={`Raise the price change for ${name}`} onClick={() => edit((f) => setMethod(f, m.methodId, { adjustBps: stepAdjust(m.adjustBps, 1) }))}>
                    +
                  </Button>
                </div>
                {form.currencies.length > 1 ? (
                  <label className="post-check">
                    <input type="checkbox" checked={m.same} onChange={(e) => edit((f) => setMethod(f, m.methodId, { same: e.target.checked }))} />
                    {POST_COPY.sameForAll}
                  </label>
                ) : null}
                {m.same || form.currencies.length <= 1
                  ? field(
                      mid('instructions'),
                      POST_COPY.instructions,
                      <textarea id={mid('instructions')} rows={3} placeholder={POST_COPY.instructionsHint} value={m.instructions} onChange={(e) => edit((f) => setMethod(f, m.methodId, { instructions: e.target.value }))} />,
                    )
                  : form.currencies.map((c) =>
                      field(
                        mid(`instructions-${c}`),
                        `${POST_COPY.instructions} (${c})`,
                        <textarea
                          id={mid(`instructions-${c}`)}
                          rows={3}
                          placeholder={POST_COPY.instructionsFor(c)}
                          value={m.byCurrency[c] ?? ''}
                          onChange={(e) => edit((f) => setMethod(f, m.methodId, { byCurrency: { ...m.byCurrency, [c]: e.target.value } }))}
                        />,
                      ),
                    )}
              </div>
            );
          })}
          {methods.kind === 'failed' ? (
            <div className="post-field">
              <span className="post-caption">Payment method</span>
              <span className="post-error post-load-failed">{METHODS_FAILED}</span>
              <Button variant="secondary" onClick={retryMethods}>
                Retry
              </Button>
            </div>
          ) : form.methods.length < MAX_METHODS ? (
            field(
              'method',
              POST_COPY.addMethod,
              <select
                id="method"
                value=""
                onChange={(e) => {
                  const id = e.target.value;
                  if (id !== '') edit((f) => addMethod(f, id));
                }}
                {...invalid('method', errors.methods)}
              >
                <option value="" disabled>
                  Choose a method
                </option>
                {(list ?? [])
                  .filter((m) => !form.methods.some((x) => x.methodId === m.id))
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </select>,
              errors.methods,
            )
          ) : (
            <>
              <span className="post-muted">{POST_COPY.methodsFull}</span>
              {fieldError('method', errors.methods)}
            </>
          )}

          {giftCard ? (
            <>
              {field(
                'country',
                'Country',
                <select id="country" value={form.country} onChange={(e) => set('country', e.target.value)} {...invalid('country', errors.country)}>
                  <option value="" disabled>
                    Choose the card's country
                  </option>
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>,
                errors.country,
              )}
              <p className="post-giftcard">
                <strong>{GIFT_CARD_WARNING}</strong>
              </p>
            </>
          ) : null}
        </section>

        <div className="post-card">
          <span className="x2f-section-title">Trade sizes and prices</span>
          <span className="post-muted">{POST_COPY.bandsHelp}</span>
          <span className="post-muted post-unit-help">{UNIT_HELP}</span>
          {xmrBlocked ? <span className="post-muted">{POST_COPY.noXmrWithBands}</span> : null}
        </div>
        {form.currencies.map(currencyCard)}

        <div className="post-card">
          {field(
            'terms',
            'Your terms (optional)',
            <textarea
              id="terms"
              rows={3}
              placeholder="e.g. Zelle only from an account in your own name. Put the trade number in the memo."
              value={form.terms}
              onChange={(e) => set('terms', e.target.value)}
              {...invalid('terms', errors.terms)}
            />,
            errors.terms,
          )}
        </div>

        <section aria-label="Preview" className="post-section">
          <span className="post-label">How others will see it</span>
          <div className="post-preview">
            <span className="post-muted">
              {previewLine(
                form.side,
                form.methods.length === 0 ? ['your method'] : form.methods.map((m) => nameOf(m.methodId)),
                form.currencies,
                lowestRule(),
              )}
            </span>
            <div className="post-preview-row">
              <span className="post-preview-price">
                {/* DESIGN: wording. COPY-UNSIGNED: "Set your percentage" (while the first band's percentage box is not 0 to 50). */}
                <span className="post-mono post-big">
                  {previewPrice !== null && first !== undefined ? formatPrice(previewPrice, first) : firstBps === null ? 'Set your percentage' : PRICE_UNAVAILABLE}
                </span>
                {previewPrice !== null && firstQuote && first !== 'USD' ? <span className="post-muted">{`about ${formatPrice(usdValue(previewPrice, firstQuote), 'USD')}`}</span> : null}
              </span>
              <span className="post-preview-range">
                {previewRange === null ? (
                  <span className="post-muted">Set your smallest and largest trade</span>
                ) : (
                  <>
                    {previewRange.xmr !== null ? (
                      <span className="post-muted" data-part="preview-xmr">
                        {`${previewRange.xmr} XMR`}
                      </span>
                    ) : null}
                    {previewRange.fiat !== null ? (
                      <span className="post-muted" data-part="preview-fiat">
                        {`${previewRange.fiat} ${first}`}
                      </span>
                    ) : null}
                  </>
                )}
              </span>
            </div>
            <span className="post-muted" data-part="preview-methods">
              {form.methods.length === 0 ? '' : form.methods.map((m) => (m.adjustBps === 0 ? nameOf(m.methodId) : `${nameOf(m.methodId)} ${adjustText(m.adjustBps)}`)).join(' · ')}
            </span>
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
