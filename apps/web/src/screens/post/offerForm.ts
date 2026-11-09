// PostOffer's form logic (Task 21; board PostOffer.dc.html; spec 2.2 step 5, 2.3, 11.6). Fiat is
// bigint minor units; the form takes only two-decimal currencies until formatFiat takes the
// currency's exponent (Revision 2026-10-20).
import { CANT_DO_TITLE, isCantDoCode, postCantDoText, type CantDoCode } from '../../ui/cantDoCodes.js';
import type { AmountUnit } from '@x2f/trade';
import { CURRENCIES } from '../browse/api.js';
import type { PostOfferBody, PriceQuote, Side } from './api.js';
import { isCountryCode } from './countries.js';

/**
 * "Minimum completed trades" is a fixed choice (owner, 8 Nov: "This will be 5, 10, 25, 50"); null is
 * No minimum, the default (lead default). The API takes exactly these (apps/api/src/offers/routes.ts
 * MIN_TRADES_CHOICES).
 */
export const MIN_TRADES = [null, 5, 10, 25, 50] as const;
export type MinTrades = (typeof MIN_TRADES)[number];
/** The segmented control's options: string ids for RadioChips. COPY-UNSIGNED: "No minimum" (owner's list, lead's label). */
export const MIN_TRADES_OPTIONS: readonly { id: string; label: string; value: MinTrades }[] = MIN_TRADES.map((n) => ({
  id: n === null ? 'none' : String(n),
  label: n === null ? 'No minimum' : String(n),
  value: n,
}));
export type PriceMode = 'market' | 'fixed';

export interface FormState {
  side: Side;
  methodId: string;
  currency: string;
  priceMode: PriceMode;
  marginBps: number;
  /** The fixed price per XMR as typed. */
  fixed: string;
  /**
   * The unit both range boxes are in (owner, 8 Nov: an XMR / currency switch at each box's right
   * edge, XMR by default; lead default: Smallest and Largest switch together, one unit per offer).
   */
  unit: AmountUnit;
  min: string;
  max: string;
  terms: string;
  minTrades: MinTrades;
  /** The card's country (ISO 3166-1 alpha-2) for a gift-card method; '' until chosen. */
  country: string;
}

/** The board's starting state: Sell XMR, USD, market +0.5%. */
export const DEFAULT_FORM: FormState = {
  side: 'sell',
  methodId: '',
  currency: 'USD',
  priceMode: 'market',
  marginBps: 50,
  fixed: '',
  unit: 'xmr',
  min: '',
  max: '',
  terms: '',
  minTrades: null,
  country: '',
};

/**
 * The one currency list, shared with the browse screens (lead, Task 21 review 2026-10-27): a poster
 * returns to the list that shows the offer's currency, so the picker here offers exactly what the
 * lists can show. It grows with browse's CURRENCIES (all two-decimal until formatFiat takes the
 * currency's exponent; Task 3's feed prices 39 two-decimal currencies).
 */
export const POST_CURRENCIES: readonly string[] = CURRENCIES;

export const FIXED_STALE_WARNING = 'A fixed price goes stale when the market moves.';
export const PRICE_UNAVAILABLE = 'Price unavailable right now.';
/** OD-7 (P3-M4), under the preview. */
export const FEE_SENTENCE = 'You pay X2F 1% of each completed trade from your own ads. Taking an offer is free.';
/** Owner, 2026-10-21 (spec 11.8): the one bold warning on gift-card offers. */
export const GIFT_CARD_WARNING = 'When trading Monero for gift cards, you accept all risks and responsibilities that come with gift cards. Buyer beware.';

/** The inline refusal when a gift-card offer names no country (Revision 2026-10-21). */
export const COUNTRY_REQUIRED = "Choose the card's country.";
/** Shown with a Retry button when GET /v1/methods fails, instead of an empty picker. */
export const METHODS_FAILED = "The payment methods didn't load.";

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

/**
 * "0.5", "2", "1,000.25", "XMR 1.5" as atomic units (12 decimals at most); null for anything else.
 * At most 8 whole digits (far above the supply): the API takes at most 20 digits of atomic units
 * (apps/api/src/offers/routes.ts ATOMIC), so a larger amount is a field error here, not a 400 (review L2).
 */
export function parseXmrAmount(raw: string): bigint | null {
  const s = raw.trim().replace(/^xmr\s*/i, '').replace(/\s*xmr$/i, '').replaceAll(',', '');
  const m = /^(\d{1,8})(?:\.(\d{1,12}))?$/.exec(s) ?? /^()\.(\d{1,12})$/.exec(s);
  if (!m) return null;
  return BigInt(m[1] === '' ? '0' : m[1]!) * 1_000_000_000_000n + BigInt((m[2] ?? '').padEnd(12, '0'));
}

/** A range box's text in the form's unit: atomic units for XMR, minor units for fiat. */
export function parseRangeAmount(raw: string, unit: AmountUnit): bigint | null {
  return unit === 'xmr' ? parseXmrAmount(raw) : parseAmount(raw);
}

/** XMR typed in the boxes after a switch: six places (the card's), with no trailing zeros. */
const SWITCH_XMR_PLACES = 6n;
const ATOMIC_PER_XMR = 1_000_000_000_000n;

const divUp = (n: bigint, d: bigint): bigint => (n + d - 1n) / d;

/** `units` with `places` decimals as plain box text: "0.033333", "1.5", "330". */
function decimalText(units: bigint, places: bigint): string {
  const scale = 10n ** places;
  const frac = (units % scale).toString().padStart(Number(places), '0').replace(/0+$/, '');
  return frac === '' ? `${units / scale}` : `${units / scale}.${frac}`;
}

/** One box converted to `to` at `rate` (minor units per XMR): the min rounded up, the max down. */
function convertBox(raw: string, from: AmountUnit, to: AmountUnit, rate: bigint, dir: 'up' | 'down'): string {
  const v = parseRangeAmount(raw, from);
  if (v === null || v === 0n) return '';
  const div = dir === 'up' ? divUp : (n: bigint, d: bigint) => n / d;
  if (to === 'xmr') {
    // Minor units to millionths of an XMR.
    return decimalText(div(v * 10n ** SWITCH_XMR_PLACES, rate), SWITCH_XMR_PLACES);
  }
  return decimalText(div(v * rate, ATOMIC_PER_XMR), 2n);
}

/**
 * The form after the poster picks `to` for the range (review H1): both boxes converted at your price
 * (`rate`, minor units per XMR), the smallest trade rounded up and the largest down, so the range
 * never grows (except that a largest rounded below the smallest is set to the smallest); once
 * converted, the new unit is exact. With no price, both boxes are cleared, so a
 * number typed in one unit is never read in the other.
 */
export function switchUnit(f: FormState, to: AmountUnit, rate: bigint | null): FormState {
  if (f.unit === to) return f;
  if (rate === null || rate <= 0n) return { ...f, unit: to, min: '', max: '' };
  const min = convertBox(f.min, f.unit, to, rate, 'up');
  const max = convertBox(f.max, f.unit, to, rate, 'down');
  // Equal (or nearly equal) boxes can cross after rounding: the largest is set to the smallest, so
  // the switch never leaves an error the poster didn't cause (review 2, M2).
  const lo = parseRangeAmount(min, to);
  const hi = parseRangeAmount(max, to);
  return { ...f, unit: to, min, max: lo !== null && hi !== null && lo > hi ? min : max };
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

/** Always two decimals: "$329.90". */
export function formatMoney(cents: bigint, currency: string): string {
  return money(cents, currency, 2);
}

/** "$331.55 / XMR". */
export function formatPrice(cents: bigint, currency: string): string {
  return `${money(cents, currency, 2)} / XMR`;
}

/** A trade size: "$50", "$2,000", "$12.50". */
export function formatAmount(cents: bigint, currency: string): string {
  return money(cents, currency, cents % 100n === 0n ? 0 : 2);
}

/** A fixed price this far off the market (in bps) gets a caution line; this far gets refused. */
export const FIXED_CAUTION_BPS = 1000n;
export const FIXED_REFUSE_BPS = 5000n;

export type FixedPriceCheck = { kind: 'ok' } | { kind: 'caution'; text: string } | { kind: 'refuse'; text: string };

/**
 * A fixed price against the market (Task 21 review 2026-10-27): within 10% nothing is said; from 10%
 * off, a caution line with the percentage and the direction (paired with a caution icon by the
 * screen); from 50% off (a missed decimal point, a stale number) the price is refused inline, naming
 * the market price. `fixed` and `market` are minor units of `currency`, market > 0.
 */
export function fixedPriceCheck(fixed: bigint, market: bigint, currency: string): FixedPriceCheck {
  const diff = fixed > market ? fixed - market : market - fixed;
  const bps = (diff * 10_000n) / market;
  if (bps < FIXED_CAUTION_BPS) return { kind: 'ok' };
  if (bps >= FIXED_REFUSE_BPS) return { kind: 'refuse', text: `Check your price: the market is ${formatPrice(market, currency)}` };
  const pct = Number(bps) / 100;
  const shown = Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(1)}%`;
  return { kind: 'caution', text: `Caution: that is ${shown} ${fixed > market ? 'above' : 'below'} the market price` };
}

export function previewLine(side: Side, methodName: string, currency: string, minTrades: MinTrades): string {
  const base = `${side === 'sell' ? 'Selling XMR' : 'Buying XMR'} via ${methodName} · ${currency} · you`;
  return minTrades === null ? base : `${base} · ${minTrades}+ completed trades`;
}

/** Where takers see the new offer: buyers browse sell ads (/buy), sellers browse buy ads (/sell). */
export function afterPostPath(side: Side, methodId: string, currency: string): string {
  return `/${side === 'sell' ? 'buy' : 'sell'}/${encodeURIComponent(methodId)}?currency=${encodeURIComponent(currency)}`;
}

/** COPY-UNSIGNED (boards v142): the line under the range boxes. */
export const UNIT_HELP = 'One unit for the whole offer. Traders see both, converted at your price.';

/** COPY-UNSIGNED: the range boxes' error in XMR. */
export const XMR_AMOUNT_ERROR = 'Enter an amount in XMR, like 0.5 or 2.';

export type FieldError = 'method' | 'country' | 'min' | 'max' | 'fixed' | 'terms';

/** The longest terms the API stores (apps/api/src/offers/routes.ts TERMS_MAX). */
export const TERMS_MAX = 4000;
/**
 * The characters the API refuses in terms (apps/api/src/offers/routes.ts BAD_TERMS_CHAR, keep in
 * step): control characters other than newline and tab, and bidi overrides and isolates.
 */
export const BAD_TERMS_CHAR = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
export const TERMS_BAD_TEXT = 'Your terms contain hidden characters (for example from copying formatted text). Retype the part you pasted.';
export const TERMS_LONG_TEXT = `Keep your terms under ${TERMS_MAX.toLocaleString('en-US')} characters.`;

/** The terms as the API stores them: line breaks as newlines, no space at either end. */
export function cleanTerms(t: string): string {
  return t.replace(/\r\n?/g, '\n').trim();
}

export interface ValidateContext {
  /** The chosen method is a gift card, so the card's country is required and sent. */
  giftCard?: boolean;
  /** The market price per XMR in the form's currency, when the feed has one (fixed-price sanity). */
  market?: bigint | null;
}

export function validate(f: FormState, ctx: ValidateContext = {}): { errors: Partial<Record<FieldError, string>>; body?: PostOfferBody } {
  const errors: Partial<Record<FieldError, string>> = {};
  if (f.methodId === '') errors.method = 'Choose a payment method.';
  const giftCard = ctx.giftCard === true;
  if (giftCard && !isCountryCode(f.country)) errors.country = COUNTRY_REQUIRED;
  const min = parseRangeAmount(f.min, f.unit);
  const max = parseRangeAmount(f.max, f.unit);
  const amountError = f.unit === 'xmr' ? XMR_AMOUNT_ERROR : 'Enter an amount, like 50 or 2,000.';
  if (min === null || min === 0n) errors.min = amountError;
  if (max === null || max === 0n) errors.max = amountError;
  // not-a-refusal: an input check on the two amounts
  if (min !== null && max !== null && min > 0n && max > 0n && min > max) errors.min = "The smallest trade can't be more than the largest.";
  let fixed: bigint | null = null;
  if (f.priceMode === 'fixed') {
    fixed = parseAmount(f.fixed);
    if (fixed === null || fixed === 0n) errors.fixed = 'Enter your price per XMR.';
    else if (ctx.market !== undefined && ctx.market !== null && ctx.market > 0n) {
      const check = fixedPriceCheck(fixed, ctx.market, f.currency);
      if (check.kind === 'refuse') errors.fixed = check.text;
    }
  }
  const terms = cleanTerms(f.terms);
  if (BAD_TERMS_CHAR.test(terms)) errors.terms = TERMS_BAD_TEXT;
  else if ([...terms].length > TERMS_MAX) errors.terms = TERMS_LONG_TEXT;
  if (Object.keys(errors).length > 0) return { errors };
  return {
    errors,
    body: {
      side: f.side,
      methodId: f.methodId,
      currency: f.currency,
      pricing: f.priceMode === 'fixed' ? { mode: 'fixed', centsPerXmr: fixed! } : { mode: 'market', marginBps: f.marginBps },
      amounts: f.unit === 'xmr' ? { amountUnit: 'xmr', minAtomic: min!, maxAtomic: max! } : { amountUnit: 'fiat', minFiatCents: min!, maxFiatCents: max! },
      minTrades: f.minTrades,
      terms,
      ...(giftCard ? { country: f.country } : {}),
    },
  };
}

/** The API refusals a poster can meet (plan Task 4), as plain text. */
/** CantDoThat's title when Post offer is refused by a rule (Plan 5 Task 21; in the refusal text map). */
export const POST_CANT_TITLE = CANT_DO_TITLE.post;

/** The refusal code when Post offer was refused by a rule (shown in CantDoThat), else null. */
export function postCantDo(code: string): CantDoCode | null {
  return isCantDoCode(code) ? code : null;
}

/** The words for a refused Post offer; a CANT_DO_CODES refusal is shown in CantDoThat, the rest inline. */
export function refusalText(code: string): string {
  if (isCantDoCode(code)) return postCantDoText(code);
  switch (code) {
    case 'trading-paused':
      return 'Trading is paused for maintenance. Your offer was not posted. Try again soon.';
    case 'method-unavailable':
      // not-a-refusal: a catalog fact (the method is off the list), see NOT_REFUSAL_CODES
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
    (d.unit === undefined || d.unit === 'xmr' || d.unit === 'fiat') &&
    str(d.min, 32) &&
    str(d.max, 32) &&
    str(d.terms, 4000) &&
    // 0 was the old default ("anyone"); it loads as No minimum (review L2).
    (d.minTrades === 0 || (MIN_TRADES as readonly unknown[]).includes(d.minTrades)) &&
    (d.country === '' || isCountryCode(d.country));
  if (!ok) return null;
  return {
    side: d.side as Side,
    methodId: d.methodId as string,
    currency: d.currency as string,
    priceMode: d.priceMode as PriceMode,
    marginBps: d.marginBps as number,
    fixed: d.fixed as string,
    // A draft from before the switch was typed in fiat.
    unit: (d.unit ?? 'fiat') as AmountUnit,
    min: d.min as string,
    max: d.max as string,
    terms: d.terms as string,
    minTrades: d.minTrades === 0 ? null : (d.minTrades as MinTrades),
    country: d.country as string,
  };
}
