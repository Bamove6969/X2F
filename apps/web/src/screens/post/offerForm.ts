// PostOffer's form logic (Task 21; board PostOffer.dc.html; spec 2.2 step 5, 2.3, 11.6). Fiat is
// bigint minor units; the form takes only two-decimal currencies until formatFiat takes the
// currency's exponent (Revision 2026-10-20).
import type { PostOfferBody, PriceQuote, Side } from './api.js';

export const MIN_TRADES = [0, 5, 10, 50] as const;
export type MinTrades = (typeof MIN_TRADES)[number];
export type PriceMode = 'market' | 'fixed';

export interface FormState {
  side: Side;
  methodId: string;
  currency: string;
  priceMode: PriceMode;
  marginBps: number;
  /** The fixed price per XMR as typed. */
  fixed: string;
  min: string;
  max: string;
  terms: string;
  minTrades: MinTrades;
}

/** The board's starting state: Sell XMR, USD, market +0.5%. */
export const DEFAULT_FORM: FormState = {
  side: 'sell',
  methodId: '',
  currency: 'USD',
  priceMode: 'market',
  marginBps: 50,
  fixed: '',
  min: '',
  max: '',
  terms: '',
  minTrades: 0,
};

/**
 * The two-decimal currencies Task 3's feed prices (its CURRENCY_EXPONENTS), the board's USD, EUR
 * and GBP first. Zero- and three-decimal ones (JPY, KRW, CLP, VND, KWD, BHD) wait for formatFiat.
 */
export const POST_CURRENCIES: readonly string[] = [
  'USD', 'EUR', 'GBP',
  'AED', 'ARS', 'AUD', 'BDT', 'BMD', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'GEL', 'HKD', 'HUF', 'IDR', 'ILS',
  'INR', 'LKR', 'MMK', 'MXN', 'MYR', 'NGN', 'NOK', 'NZD', 'PHP', 'PKR', 'PLN', 'RUB', 'SAR', 'SEK', 'SGD', 'THB',
  'TRY', 'TWD', 'UAH', 'ZAR',
];

export const FIXED_STALE_WARNING = 'A fixed price goes stale when the market moves.';
export const PRICE_UNAVAILABLE = 'Price unavailable right now.';
/** OD-7 (P3-M4), under the preview. */
export const FEE_SENTENCE = 'You pay X2F 1% of each completed trade from your own ads. Taking an offer is free.';
/** Owner, 2026-10-21 (spec 11.8): the one bold warning on gift-card offers. */
export const GIFT_CARD_WARNING = 'When trading Monero for gift cards, you accept all risks and responsibilities that come with gift cards. Buyer beware.';

/** The board's margin limits (±10%) and step (0.1%). */
export const MARGIN_LIMIT_BPS = 1000;
export const MARGIN_STEP_BPS = 10;

/** "$2,000", "2000", "12.50", "€0.99" in minor units; null for anything else. */
export function parseAmount(raw: string): bigint | null {
  const s = raw.trim().replace(/^[^\d.\-]{1,4}/, '').replaceAll(',', '');
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  return BigInt(m[1]!) * 100n + BigInt((m[2] ?? '').padEnd(2, '0'));
}

export function stepMargin(bps: number, dir: 1 | -1): number {
  return Math.max(-MARGIN_LIMIT_BPS, Math.min(MARGIN_LIMIT_BPS, bps + dir * MARGIN_STEP_BPS));
}

export function marginText(bps: number): string {
  return `${bps > 0 ? '+' : ''}${(bps / 100).toFixed(1)}%`;
}

export function marginWord(bps: number): string {
  if (bps === 0) return 'at market';
  return bps > 0 ? 'above market' : 'below market';
}

/** n / d rounded half up, for n >= 0 and d > 0. */
const divHalfUp = (n: bigint, d: bigint): bigint => (n * 2n + d) / (d * 2n);

/** The market price moved by the margin, rounded half up (as Task 1's rateFor). */
export function priceWithMargin(marketCents: bigint, bps: number): bigint {
  return divHalfUp(marketCents * BigInt(10_000 + bps), 10_000n);
}

/** What `localCents` per XMR is worth in US cents at the feed's own rate (spec 11.6). */
export function usdValue(localCents: bigint, quote: PriceQuote): bigint {
  return divHalfUp(localCents * quote.usdCentsPerXmr, quote.centsPerXmr);
}

function money(cents: bigint, currency: string, decimals: 0 | 2): string {
  const nf = new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const whole = cents / 100n;
  const frac = (cents % 100n).toString().padStart(2, '0');
  return nf
    .formatToParts(whole)
    .map((p) => (p.type === 'fraction' ? frac : p.value))
    .join('');
}

/** "$331.55 / XMR". */
export function formatPrice(cents: bigint, currency: string): string {
  return `${money(cents, currency, 2)} / XMR`;
}

/** A trade size: "$50", "$2,000", "$12.50". */
export function formatAmount(cents: bigint, currency: string): string {
  return money(cents, currency, cents % 100n === 0n ? 0 : 2);
}

export function previewLine(side: Side, methodName: string, currency: string, minTrades: MinTrades): string {
  const base = `${side === 'sell' ? 'Selling XMR' : 'Buying XMR'} via ${methodName} · ${currency} · you`;
  return minTrades === 0 ? base : `${base} · ${minTrades}+ completed trades`;
}

/** Where takers see the new offer: buyers browse sell ads (/buy), sellers browse buy ads (/sell). */
export function afterPostPath(side: Side, methodId: string, currency: string): string {
  return `/${side === 'sell' ? 'buy' : 'sell'}/${encodeURIComponent(methodId)}?currency=${encodeURIComponent(currency)}`;
}

export type FieldError = 'method' | 'min' | 'max' | 'fixed';

export function validate(f: FormState): { errors: Partial<Record<FieldError, string>>; body?: PostOfferBody } {
  const errors: Partial<Record<FieldError, string>> = {};
  if (f.methodId === '') errors.method = 'Choose a payment method.';
  const min = parseAmount(f.min);
  const max = parseAmount(f.max);
  const amountError = 'Enter an amount, like 50 or 2,000.';
  if (min === null || min === 0n) errors.min = amountError;
  if (max === null || max === 0n) errors.max = amountError;
  if (min !== null && max !== null && min > 0n && max > 0n && min > max) errors.min = "The smallest trade can't be more than the largest.";
  let fixed: bigint | null = null;
  if (f.priceMode === 'fixed') {
    fixed = parseAmount(f.fixed);
    if (fixed === null || fixed === 0n) errors.fixed = 'Enter your price per XMR.';
  }
  if (Object.keys(errors).length > 0) return { errors };
  return {
    errors,
    body: {
      side: f.side,
      methodId: f.methodId,
      currency: f.currency,
      pricing: f.priceMode === 'fixed' ? { mode: 'fixed', centsPerXmr: fixed! } : { mode: 'market', marginBps: f.marginBps },
      minFiatCents: min!,
      maxFiatCents: max!,
      minTrades: f.minTrades,
      terms: f.terms.trim(),
    },
  };
}

/** The API refusals a poster can meet (plan Task 4), as plain text. */
export function refusalText(code: string): string {
  switch (code) {
    case 'trading-hold':
      return "Your account has a trading hold while a dispute is open, so you can't post offers until it's resolved.";
    case 'trading-paused':
      return 'Trading is paused for maintenance. Your offer was not posted. Try again soon.';
    case 'method-unavailable':
      return "This payment method isn't available right now. Choose another one.";
    default:
      return "Something went wrong and your offer wasn't posted. Try again.";
  }
}

const DRAFT_KEY = 'x2f.post-draft';

/** Keeps the form for this tab while the user signs up or adds a wallet (spec 6.4). */
export function saveDraft(storage: Storage, f: FormState): void {
  try {
    storage.setItem(DRAFT_KEY, JSON.stringify(f));
  } catch {
    // Storage can be off (private mode, blocked site data); the form still works without a draft.
  }
}

export function clearDraft(storage: Storage): void {
  try {
    storage.removeItem(DRAFT_KEY);
  } catch {
    // As saveDraft.
  }
}

const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

export function loadDraft(storage: Storage): FormState | null {
  let raw: unknown;
  try {
    const text = storage.getItem(DRAFT_KEY);
    if (text === null) return null;
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  const ok =
    (d.side === 'sell' || d.side === 'buy') &&
    str(d.methodId, 64) &&
    typeof d.currency === 'string' &&
    POST_CURRENCIES.includes(d.currency) &&
    (d.priceMode === 'market' || d.priceMode === 'fixed') &&
    typeof d.marginBps === 'number' &&
    Number.isInteger(d.marginBps) &&
    Math.abs(d.marginBps) <= MARGIN_LIMIT_BPS &&
    str(d.fixed, 32) &&
    str(d.min, 32) &&
    str(d.max, 32) &&
    str(d.terms, 4000) &&
    MIN_TRADES.includes(d.minTrades as MinTrades);
  if (!ok) return null;
  return {
    side: d.side as Side,
    methodId: d.methodId as string,
    currency: d.currency as string,
    priceMode: d.priceMode as PriceMode,
    marginBps: d.marginBps as number,
    fixed: d.fixed as string,
    min: d.min as string,
    max: d.max as string,
    terms: d.terms as string,
    minTrades: d.minTrades as MinTrades,
  };
}
