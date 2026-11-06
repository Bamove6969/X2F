import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { posterRole, type Price } from '@x2f/trade';
import { useSession } from '../../session/useSession.js';
import { addressEnd } from '../../ui/addressEnd.js';
import { BlockAction } from '../settings/BlockAction.js';
import { Button } from '../../ui/Button.js';
import { CantDoThat } from '../../ui/CantDoThat.js';
import { Icon } from '../../ui/icons.js';
import { Notice } from '../../ui/Notice.js';
import { fetchMarket, fetchMethodName, fetchOffer, fetchWallets, type PickWallet } from './api.js';
import type { ConfirmedTrade } from './confirmed.js';
import { STAGE_NAMES, amountText, currencySign, fiatWhole, formatMinor, quote, quoteExponent, xmrText, type AdSide, type MarketNow, type Quote, type QuoteOffer, type Unit } from './quoteModel.js';
import { claimTake, rememberTake } from './pendingTake.js';
import { TAKE_CANT_TITLE, takeCantDo, takeRefusal } from './takeErrors.js';
import { useQuoteKept } from './quoteKept.js';
import { useTake } from './useTake.js';
import { WalletPicker, walletName } from './WalletPicker.js';
import './quote.css';

// The quote screen both sides share (plan Task 18). BuyQuote (a buyer taking a sell ad) follows the
// BuyQuote board; SellQuote (a seller taking a buy ad) has no board and mirrors its parts. There is
// no X2F fee line anywhere: the taker pays none (spec 11 item 1); the only fee words are the
// board's footer, "Taking an offer is free. No X2F fee is added."

/** How often the market price is asked again, so a quote never sits on a stale price (spec 11.6). */
export const PRICE_REFRESH_MS = 60_000;

export interface QuoteCopy {
  /** The ad side this quote takes: 'sell' for BuyQuote, 'buy' for SellQuote. */
  adSide: AdSide;
  defaultUnit: Unit;
  showMax: boolean;
  back: (method: string) => string;
  title: (poster: ReactNode) => ReactNode;
  amountLabel: string;
  /** The board's range help: "satoshi_ghost sells $50 to $1,500 per trade." */
  range: (poster: string, min: string, max: string) => string;
  walletLegend: string;
  /** The big figure: label and the XMR it shows. */
  headline: string;
  headlineXmr: (q: Extract<Quote, { kind: 'ok' }>) => bigint;
  /** The line under the figure for a picked wallet. */
  walletLine: (name: string, end: string) => ReactNode;
  noWalletLine: string;
  signedOutWalletLine: string;
  networkFee: string;
  total: (method: string) => string;
  footnote: (poster: string) => string;
}

type Load<T> = { kind: 'loading' } | { kind: 'ready'; value: T } | { kind: 'failed' };

function useLoad<T>(run: ((signal: AbortSignal) => Promise<T>) | null, deps: unknown[]): Load<T> {
  const [load, setLoad] = useState<Load<T>>({ kind: 'loading' });
  useEffect(() => {
    if (run === null) return;
    const abort = new AbortController();
    run(abort.signal).then(
      (value) => {
        if (!abort.signal.aborted) setLoad({ kind: 'ready', value });
      },
      () => {
        if (!abort.signal.aborted) setLoad({ kind: 'failed' });
      },
    );
    return () => abort.abort();
    // The caller lists in `deps` what `run` reads.
  }, deps);
  return load;
}

/**
 * The market price for `currency`, asked again every PRICE_REFRESH_MS and on `refresh()` (after a
 * price-changed refusal); null while the feed is down.
 */
function useMarket(currency: string): { market: Load<MarketNow | null>; refresh: () => void } {
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    const id = setInterval(refresh, PRICE_REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);
  const [last, setLast] = useState<Load<MarketNow | null>>({ kind: 'loading' });
  const now = useLoad((signal) => fetchMarket(currency, signal), [currency, tick]);
  useEffect(() => {
    // Keep showing the last answer while the next one is on its way; a failure means no price.
    if (now.kind === 'ready') setLast(now);
    if (now.kind === 'failed') setLast({ kind: 'ready', value: null });
  }, [now]);
  return { market: last, refresh };
}

const perXmr = (minor: bigint, currency: string, exponent: number) => `${formatMinor(minor, currency, exponent)} / XMR`;

function rateOf(q: Quote): Price | null {
  return 'rate' in q ? q.rate : null;
}

/**
 * `pane`: the quote in the pane beside the offers (two panes, Fold-Offers). The offer comes from
 * the props, not the route (the route may be the list's), the back link is left out (the list is
 * beside it) and the screen draws no `<main>` landmark of its own (it is in the panes' aside).
 */
export function QuoteScreen({ copy, pane }: { copy: QuoteCopy; pane?: { methodId: string; offerId: string } }) {
  const route = useParams();
  const methodId = pane?.methodId ?? route.methodId ?? '';
  const offerId = pane?.offerId ?? route.offerId ?? '';
  const Main = pane ? 'div' : 'main';
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const currency = params.get('currency') ?? 'USD';
  // The amount and its unit, the take's state and the notes below live above the layout switch,
  // per offer (quoteKept.ts, review 2026-11-01 M1, M2): a fold or unfold moves the quote between
  // the screen and the pane beside the offers, and the URL may not have caught up with the last
  // keystroke yet. Picking another offer beside it carries the amount through the URL (OffersRoute).
  const [kept, keep] = useQuoteKept(offerId);
  const [text, setTextState] = useState(params.get('amount') ?? kept.amount?.text ?? '');
  const [unit, setUnitState] = useState<Unit>(
    params.get('unit') === 'xmr' ? 'xmr' : params.get('unit') === 'fiat' ? 'fiat' : (kept.amount?.unit ?? copy.defaultUnit),
  );
  const setText = (t: string) => {
    setTextState(t);
    keep({ amount: t === '' ? null : { text: t, unit } });
  };
  const [picked, setPicked] = useState<string | null>(params.get('wallet'));

  const { market, refresh: refreshMarket } = useMarket(currency);
  const { signedIn, state, take } = useTake(offerId, refreshMarket);
  const session = useSession();
  const myName = session.status === 'signed-in' ? ((session.me as { displayName?: string }).displayName ?? null) : null;
  // Task 37: once the person blocks the poster, this offer is gone for them (the take would 404).
  const { blockedPoster, closedError } = kept;
  const offer = useLoad((signal) => fetchOffer(copy.adSide, methodId, currency, offerId, signal), [copy.adSide, methodId, currency, offerId]);
  const method = useLoad((signal) => fetchMethodName(copy.adSide, methodId, currency, signal), [copy.adSide, methodId, currency]);
  const wallets = useLoad<PickWallet[]>(signedIn === true ? (signal) => fetchWallets(signal) : null, [signedIn]);

  const o: QuoteOffer | null = offer.kind === 'ready' ? offer.value : null;
  const methodName = method.kind === 'ready' ? method.value : methodId;
  const marketNow = market.kind === 'ready' ? market.value : null;
  const q: Quote | null = o && market.kind === 'ready' ? quote({ offer: o, market: marketNow, text, unit }) : null;
  const usable = wallets.kind === 'ready' ? wallets.value.filter((w) => w.usable) : [];
  const pickedWallet = usable.find((w) => w.id === picked) ?? null;

  // The amount, unit and wallet live in the URL, so any trip away (Terms, Add a wallet, setup)
  // comes back to the same quote.
  const here = useMemo(() => {
    const next = new URLSearchParams({ currency });
    if (text !== '') next.set('amount', text);
    next.set('unit', unit);
    if (pickedWallet) next.set('wallet', pickedWallet.id);
    return next;
  }, [currency, text, unit, pickedWallet]);
  // `resume` is kept until the effect below has read it once (`resumed`), then dropped for good:
  // a re-render in the same batch (the wallet it picks) must not put it back from stale params.
  const resumed = useRef(false);
  useEffect(() => {
    const resume = params.get('resume');
    const next = new URLSearchParams(here);
    if (resume !== null && !resumed.current) next.set('resume', resume);
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [here, params, setParams]);

  const path = `/${copy.adSide === 'sell' ? 'buy' : 'sell'}/${encodeURIComponent(methodId)}/${encodeURIComponent(offerId)}`;
  const pending = { offerId, unit, text };
  /**
   * This quote with `resume=<nonce>`, recording the single-use pending-take marker (pendingTake.ts).
   * Called only when the person tapped Trade or Add a wallet and is being sent away. Without
   * storage there is no marker, and the quote comes back filled in, waiting for a tap.
   */
  const resumeHref = () => {
    const n = rememberTake(pending);
    return `${path}?${n === null ? here : new URLSearchParams([...here, ['resume', n]])}`;
  };
  const backHref = `/${copy.adSide === 'sell' ? 'buy' : 'sell'}/${encodeURIComponent(methodId)}?currency=${encodeURIComponent(currency)}`;
  const addWalletHref = (resume: boolean) => `/wallets?add=1&returnTo=${encodeURIComponent(resume ? resumeHref() : `${path}?${here}`)}`;

  // Back from setup or Add a wallet with `resume=<nonce>`, and this tab holds the matching marker
  // (a crafted link is a plain quote): the quote is shown AGAIN, at the price now, for a fresh tap.
  // Nothing is ever taken without a tap: the person may be back up to 30 minutes later and the rate
  // they confirm must be the one they see (spec 2.2 step 3). With exactly one usable wallet it is
  // picked for them; with more, they pick (OD-11).
  const { back, chatHint } = kept;
  useEffect(() => {
    const nonce = params.get('resume');
    if (resumed.current || nonce === null || signedIn !== true || wallets.kind !== 'ready' || q === null) return;
    resumed.current = true;
    const next = new URLSearchParams(params);
    next.delete('resume');
    setParams(next, { replace: true });
    // The marker is cleared here whether or not it matches, so it counts once.
    if (!claimTake(pending, nonce)) return;
    keep({ back: true });
    if (usable.length === 1) setPicked(usable[0]!.id);
  });

  if (offer.kind === 'loading') return <Main className="x2f-quote" data-screen="quote" aria-busy="true" />;
  if (o === null) {
    return (
      <Main className="x2f-quote" data-screen="quote">
        <p className="x2f-quote__note">
          {/* not-a-refusal: the offer is gone */}
          {offer.kind === 'failed' ? 'The offer could not be loaded right now. Try again in a moment.' : 'This offer is no longer listed.'}
        </p>
        <Link to={backHref} className="x2f-quote__add">
          Back to the offers
        </Link>
      </Main>
    );
  }

  const poster = o.poster.displayName;
  const posterName = <span data-username="">{poster}</span>;
  // Every fiat figure below is in the currency's minor units with its exponent (whole yen, 3-place dinars).
  const exponent = quoteExponent(o, marketNow);
  const min = fiatWhole(o.minFiatCents, o.currency, exponent);
  const max = fiatWhole(o.maxFiatCents, o.currency, exponent);
  const rate = q ? rateOf(q) : null;
  const ok = q?.kind === 'ok' ? q : null;

  let help = copy.range(poster, min, max);
  let helpBad = false;
  if (q?.kind === 'too-low') [help, helpBad] = [`Too low: the smallest trade is ${min}.`, true];
  if (q?.kind === 'too-high') [help, helpBad] = [`Too high: the largest trade is ${max}.`, true];
  if (q?.kind === 'enter' && text.trim() !== '') [help, helpBad] = [`Enter an amount between ${min} and ${max}.`, true];
  if (q?.kind === 'price-unavailable') [help, helpBad] = ['Price unavailable right now', true];
  if (q?.kind === 'opens-at') [help, helpBad] = [`Opens at ${STAGE_NAMES[q.stage]}. Your account can take this offer once it reaches ${STAGE_NAMES[q.stage]}.`, true];

  const switchUnit = () => {
    const to: Unit = unit === 'fiat' ? 'xmr' : 'fiat';
    // The exact amount travels across the switch: nothing is re-rounded behind the person's back.
    const next = ok ? (to === 'xmr' ? xmrText(ok.amountAtomic) : amountText(ok.fiatCents, 'fiat', ok.rate, exponent)) : '';
    setTextState(next);
    setUnitState(to);
    keep({ amount: next === '' ? null : { text: next, unit: to } });
  };

  const noWallet = signedIn === true && wallets.kind === 'ready' && usable.length === 0;
  const canTrade = ok !== null && !state.busy && !blockedPoster && (signedIn === false || (signedIn === true && pickedWallet !== null));
  /**
   * What the trade room is handed (confirmed.ts): built from this screen's own figures, the ones the
   * person sees and taps Trade on. The taker of a sell ad is the buyer; of a buy ad, the seller.
   */
  const confirmed: ConfirmedTrade | null =
    ok && pickedWallet
      ? {
          role: copy.adSide === 'sell' ? 'buyer' : 'seller',
          ownAddress: pickedWallet.address,
          deal: { poster: posterRole(o.side), takeAmountAtomic: ok.amountAtomic, currency: o.currency, centsPerXmr: ok.rate.centsPerXmr, maxFiatCents: o.maxFiatCents },
        }
      : null;
  const refusal = state.error === null ? null : takeRefusal(state.error, o);
  // A refusal by a rule opens CantDoThat (with its feedback link) until closed; others stay inline.
  const cantDo = state.error === null ? null : takeCantDo(state.error);
  const cantDoOpen = cantDo !== null && closedError !== state.error;

  let walletLine: ReactNode = copy.noWalletLine;
  if (signedIn === false) walletLine = copy.signedOutWalletLine;
  // The ending is cut from the full address the take will confirm, never the API's addressEnd (Task 19 re-review, gap 2).
  else if (pickedWallet) walletLine = copy.walletLine(walletName(pickedWallet), `…${addressEnd(pickedWallet.address)}`);

  return (
    <div className="x2f-quote" data-screen="quote">
      <header className="x2f-quote__header">
        {pane ? null : (
          <Link to={backHref} aria-label={copy.back(methodName)} className="x2f-icon-button">
            <Icon name="chevron-left" size={24} />
          </Link>
        )}
        <div className="x2f-quote__head-text">
          <span className="x2f-quote__title x2f-screen-title">{copy.title(posterName)}</span>
          <span className="x2f-quote__muted-sm">
            {methodName} · {o.currency}
            {rate ? ` · ${perXmr(rate.centsPerXmr, o.currency, exponent)}` : ''}
          </span>
        </div>
        {/*
          Task 20 review I1 (lead decision (a), 2026-10-29): the pre-trade chat stays off here until
          the poster has a way to reach it (a chats inbox and a notice, owed: docs/coordination.md).
          aria-disabled, not disabled, so it stays focusable and reads its hint; a tap shows the hint.
        */}
        <button type="button" className="x2f-quote__chat" aria-disabled="true" aria-describedby="quote-chat-hint" onClick={() => keep({ chatHint: true })}>
          <Icon name="chat" size={18} stroke={1.75} />
          Chat
        </button>
      </header>
      <p id="quote-chat-hint" className={chatHint ? 'x2f-quote__chat-hint x2f-quote__chat-hint--shown' : 'x2f-quote__chat-hint'}>
        Chat opens once the trade starts.
      </p>

      <Main className="x2f-quote__main">
        <section aria-label="Amount" className="x2f-quote__amount">
          <div className="x2f-quote__amount-head">
            <label htmlFor="quote-amount" className="x2f-quote__label">
              {copy.amountLabel}
            </label>
            <button type="button" className="x2f-quote__switch" onClick={switchUnit}>
              {unit === 'fiat' ? 'Enter XMR' : `Enter ${o.currency}`}
            </button>
          </div>
          <div className="x2f-quote__box" data-bad={helpBad && q?.kind !== 'opens-at' ? '' : undefined}>
            {unit === 'fiat' ? (
              <span aria-hidden="true" className="x2f-quote__sign">
                {currencySign(o.currency)}
              </span>
            ) : null}
            <input
              id="quote-amount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-describedby="quote-amount-help"
              aria-invalid={helpBad}
            />
            <span className="x2f-quote__unit">{unit === 'fiat' ? o.currency : 'XMR'}</span>
            {copy.showMax && rate ? (
              <button type="button" className="x2f-quote__max" onClick={() => setText(amountText(o.maxFiatCents, unit, rate, exponent))}>
                Max
              </button>
            ) : null}
          </div>
          <span id="quote-amount-help" className={helpBad ? 'x2f-quote__help x2f-quote__help--bad' : 'x2f-quote__help'}>
            {help}
          </span>
        </section>

        {signedIn === true && wallets.kind === 'ready' ? (
          <WalletPicker legend={copy.walletLegend} wallets={wallets.value} picked={pickedWallet?.id ?? null} onPick={setPicked} addHref={addWalletHref(false)} />
        ) : null}
        {signedIn === true && wallets.kind === 'failed' ? <p className="x2f-quote__note">Your wallets could not be loaded right now. Try again in a moment.</p> : null}

        <section aria-label="What you get" className="x2f-quote__card">
          <div className="x2f-quote__figure">
            <span className="x2f-section-title">{copy.headline}</span>
            <span className="x2f-quote__xmr">
              {xmrText(ok ? copy.headlineXmr(ok) : 0n)} <span className="x2f-quote__xmr-unit">XMR</span>
            </span>
            <span className="x2f-quote__muted-sm">{walletLine}</span>
          </div>
          <div className="x2f-quote__rows">
            <div className="x2f-quote__row">
              <span className="x2f-quote__muted">Rate</span>
              <span className="x2f-quote__mono">{rate ? perXmr(rate.centsPerXmr, o.currency, exponent) : 'Price unavailable right now'}</span>
            </div>
            {ok?.usdPerXmrCents != null ? (
              <div className="x2f-quote__row">
                <span className="x2f-quote__muted">In US dollars</span>
                <span className="x2f-quote__mono">{perXmr(ok.usdPerXmrCents, 'USD', 2)}</span>
              </div>
            ) : null}
            <div className="x2f-quote__row">
              <span className="x2f-quote__muted">Network fee</span>
              <span>{copy.networkFee}</span>
            </div>
            <div className="x2f-quote__rule" />
            <div className="x2f-quote__row x2f-quote__row--total">
              <span>{copy.total(methodName)}</span>
              <span className="x2f-quote__mono">
                {formatMinor(ok ? ok.fiatCents : 0n, o.currency, exponent)} {o.currency}
              </span>
            </div>
            {ok?.usdCents != null ? (
              <div className="x2f-quote__row">
                <span className="x2f-quote__muted">In US dollars</span>
                <span className="x2f-quote__mono">About {formatMinor(ok.usdCents, 'USD', 2)} USD</span>
              </div>
            ) : null}
          </div>
        </section>
        <Notice tone="info">
          {copy.footnote(poster)}
        </Notice>
        {signedIn === true && myName !== null && myName !== poster ? (
          <BlockAction displayName={poster} onBlocked={() => keep({ blockedPoster: true })} />
        ) : null}
      </Main>

      <footer className="x2f-quote__footer">
        {back && refusal === null ? (
          <p role="status" className="x2f-quote__help">
            You&apos;re back. Check the total, then tap Trade.
          </p>
        ) : null}
        {refusal !== null && !cantDoOpen ? (
          <p role="alert" className="x2f-quote__help x2f-quote__help--bad">
            {refusal}
          </p>
        ) : null}
        {cantDo !== null && refusal !== null ? (
          <CantDoThat open={cantDoOpen} title={TAKE_CANT_TITLE} body={refusal} from={cantDo} onClose={() => keep({ closedError: state.error })} />
        ) : null}
        {noWallet ? (
          <Button variant="primary" onClick={() => void navigate(addWalletHref(true))}>
            Add a wallet
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={!canTrade}
            onClick={() => ok && take({ quote: { amountAtomic: ok.amountAtomic, centsPerXmr: ok.rate.centsPerXmr, fiatCents: ok.fiatCents }, walletId: pickedWallet?.id ?? null, confirmed, resumeHref })}
          >
            Trade
          </Button>
        )}
        <span className="x2f-quote__fine x2f-quote__fine--center">Taking an offer is free. No X2F fee is added.</span>
      </footer>
    </div>
  );
}
