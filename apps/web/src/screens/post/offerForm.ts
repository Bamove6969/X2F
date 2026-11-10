// PostOffer's form logic (Task 21; board PostOffer.dc.html; spec 2.2 step 5, 2.3, 11.6). Fiat is
// bigint minor units; the form takes only two-decimal currencies until formatFiat takes the
// currency's exponent (Revision 2026-10-20).
import { CANT_DO_TITLE, isCantDoCode, offerCapsOf, postCantDoText, type CantDoCode } from '../../ui/cantDoCodes.js';
import {
  ADJUST_MAX_BPS,
  ADJUST_MIN_BPS,
  ADJUST_STEP_BPS,
  GIFT_CARD_TERMS_VERSION,
  MAX_BANDS,
  MAX_CURRENCIES,
  MAX_METHODS,
  checkBands,
  currencyChoices,
  giftCardCurrencyOk,
  giftCardRole,
  giftCardTermsComplete,
  posterRole,
  type AmountUnit,
  type CurrencyChoice,
  type GiftCardRole,
} from '@x2f/trade';
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
/**
 * Offers are market ± % only (owner Q1, 6 Nov: no fixed-price offers). The vendor picks above or
 * below the market and types the percentage, at most 50% (owner F1, 7 Nov: "You just have to choose
 * if you want to be a percentage above or below and then you fill in the number. It maxes out at
 * 50%"). The owner's 50% wins over the board's ±10% stepper.
 */
export type MarginSide = 'above' | 'below';

/** The largest margin either way, in basis points: 50% (owner F1; the API's MAX_MARGIN_BPS). */
export const MARGIN_MAX_BPS = 5000;

/** DESIGN: wording. COPY-UNSIGNED: the two choices beside the percentage box (owner F1). */
export const MARGIN_SIDES: readonly { id: MarginSide; label: string }[] = [
  { id: 'above', label: 'Above market' },
  { id: 'below', label: 'Below market' },
];

/** DESIGN: wording. COPY-UNSIGNED: the percentage box's error (empty, not a number, or over 50). */
export const MARGIN_ERROR = 'Enter a percentage from 0 to 50, like 0.5.';

/**
 * One amount band as typed (J-16, Plan 3 Task 34; owner Q23: at most 3 per currency): its two ends in
 * the offer's unit (fiat: whole units, O-018; XMR: decimals), its margin above or below the market
 * (owner F1) and its "minimum completed trades" (owner 8 Nov: No minimum, 5, 10, 25, 50).
 */
export interface BandDraft {
  /** Stable across edits, unique in the form (React keys, ids). */
  key: number;
  min: string;
  max: string;
  marginSide: MarginSide;
  /** The percentage as typed: "0.5", "2", "12.25" (at most two decimals, 0 to 50). */
  marginPct: string;
  minTrades: MinTrades;
}

/**
 * A payment method on the offer (J-16; owner Q23: at most 5): its price change over the band's price
 * (a percent, owner via design 29 Oct b), and its payment instructions, one set for every currency
 * (`same`) or one per currency where they differ (owner 2 Nov, Q3: USD account and routing, EUR IBAN).
 */
export interface MethodDraft {
  methodId: string;
  adjustBps: number;
  same: boolean;
  instructions: string;
  byCurrency: Record<string, string>;
}

export interface FormState {
  side: Side;
  /**
   * The unit every band is in (owner, 8 Nov: one unit per offer, XMR by default). In XMR a currency
   * has one band (LEAD DEFAULT, @x2f/trade checkBands 'xmr-one-band').
   */
  unit: AmountUnit;
  /** In the order picked (owner 2 Nov, Q8: at most 5); the first is where the poster lands after posting. */
  currencies: string[];
  /** Exactly one list per picked currency, in the order typed. */
  bands: Record<string, BandDraft[]>;
  methods: MethodDraft[];
  terms: string;
  /** The card's country (ISO 3166-1 alpha-2) when a gift-card method is on the offer; '' until chosen. */
  country: string;
}

/** The board's starting band: empty ends, market +0.5%, No minimum. */
function newBand(key: number, over: Partial<BandDraft> = {}): BandDraft {
  return { key, min: '', max: '', marginSide: 'above', marginPct: '0.5', minTrades: null, ...over };
}

/** The board's starting state: Sell XMR, in XMR, USD with one band at market +0.5%, no method yet. */
export const DEFAULT_FORM: FormState = {
  side: 'sell',
  unit: 'xmr',
  currencies: ['USD'],
  bands: { USD: [newBand(1)] },
  methods: [],
  terms: '',
  country: '',
};

/**
 * The one currency list, shared with the browse screens (lead, Task 21 review 2026-10-27): a poster
 * returns to the list that shows the offer's currency, so the picker here offers exactly what the
 * lists can show. It grows with browse's CURRENCIES (all two-decimal until formatFiat takes the
 * currency's exponent; Task 3's feed prices 39 two-decimal currencies).
 */
export const POST_CURRENCIES: readonly string[] = CURRENCIES;

export const PRICE_UNAVAILABLE = 'Price unavailable right now.';
/** OD-7 (P3-M4), under the preview. */
export const FEE_SENTENCE = 'You pay X2F 1% of each completed trade from your own ads. Taking an offer is free.';
/** Owner, 2026-10-21 (spec 11.8): the one bold warning on gift-card offers. */
export const GIFT_CARD_WARNING = 'When trading Monero for gift cards, you accept all risks and responsibilities that come with gift cards. Buyer beware.';

/** The inline refusal when a gift-card offer names no country (Revision 2026-10-21). */
export const COUNTRY_REQUIRED = "Choose the card's country.";
/** J-17 (T-081): the inline line when a gift card's currency is not its country's. COPY-UNSIGNED // DESIGN: wording */
export const CURRENCY_NOT_CARD = "Pick the currency of the card's country.";
/** J-17 (F13): the inline line until every gift-card term is ticked. COPY-UNSIGNED // DESIGN: wording */
export const GIFT_CARD_TERMS_UNTICKED = 'Tick each gift card term to post.';

/** Who the poster is on a gift card: a sell ad's poster checks the card, a buy ad's sends it (J-17). */
export function posterGiftCardRole(side: Side): GiftCardRole {
  return giftCardRole(posterRole(side));
}

/** Shown with a Retry button when GET /v1/methods fails, instead of an empty picker. */
export const METHODS_FAILED = "The payment methods didn't load.";


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

/** A band end in whole units ("$2,000" → 2000n, O-018: bands are whole units); 'cents' for an amount with cents; null for anything else. */
export function parseWhole(raw: string): bigint | 'cents' | null {
  const minor = parseAmount(raw);
  if (minor === null) return null;
  return minor % 100n === 0n ? minor / 100n : 'cents';
}

/**
 * A band box's text in the form's unit, as the API takes it: atomic units for XMR, whole units for
 * fiat (O-018); null for anything else, an amount with cents included.
 */
export function parseRangeAmount(raw: string, unit: AmountUnit): bigint | null {
  if (unit === 'xmr') return parseXmrAmount(raw);
  const w = parseWhole(raw);
  return typeof w === 'bigint' ? w : null;
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

/** One box converted to `to` at `rate` (minor units per XMR): the min rounded up, the max down; fiat in whole units (O-018). */
function convertBox(raw: string, from: AmountUnit, to: AmountUnit, rate: bigint, dir: 'up' | 'down'): string {
  const v = parseRangeAmount(raw, from);
  if (v === null || v === 0n) return '';
  const div = dir === 'up' ? divUp : (n: bigint, d: bigint) => n / d;
  if (to === 'xmr') {
    // Whole units to millionths of an XMR.
    return decimalText(div(v * 100n * 10n ** SWITCH_XMR_PLACES, rate), SWITCH_XMR_PLACES);
  }
  const whole = div(v * rate, ATOMIC_PER_XMR * 100n);
  return whole === 0n ? '' : `${whole}`;
}

/**
 * Whether the bands can move to `to`: always to fiat; to XMR only while every currency has one band
 * (a currency has one band in XMR, LEAD DEFAULT pending the owner).
 */
export function canSwitchUnit(f: Pick<FormState, 'currencies' | 'bands'>, to: AmountUnit): boolean {
  return to === 'fiat' || f.currencies.every((c) => (f.bands[c]?.length ?? 0) <= 1);
}

/**
 * The form after the poster picks `to` for the bands (review H1): every band converted at its own
 * price in its currency (`markets`: minor units per XMR, the market, null without one), the
 * smallest trade rounded up and the largest down, so a band never grows (except that a largest
 * rounded below the smallest is set to the smallest); once converted, the new unit is exact. A
 * currency with no price has its boxes cleared, so a number typed in one unit is never read in the
 * other. Unchanged when `canSwitchUnit` says no.
 */
export function switchUnit(f: FormState, to: AmountUnit, markets: Readonly<Record<string, bigint | null>>): FormState {
  if (f.unit === to || !canSwitchUnit(f, to)) return f;
  const bands: Record<string, BandDraft[]> = {};
  for (const c of f.currencies) {
    const market = markets[c] ?? null;
    bands[c] = (f.bands[c] ?? []).map((b) => {
      const bps = marginBpsOf(b);
      const rate = market === null || market <= 0n || bps === null ? null : priceWithMargin(market, bps);
      if (rate === null || rate <= 0n) return { ...b, min: '', max: '' };
      const min = convertBox(b.min, f.unit, to, rate, 'up');
      const max = convertBox(b.max, f.unit, to, rate, 'down');
      // Equal (or nearly equal) boxes can cross after rounding: the largest is set to the smallest, so
      // the switch never leaves an error the poster didn't cause (review 2, M2).
      const lo = parseRangeAmount(min, to);
      const hi = parseRangeAmount(max, to);
      return { ...b, min, max: lo !== null && hi !== null && lo > hi ? min : max };
    });
  }
  return { ...f, unit: to, bands };
}

/** "0.5", "2", "12.25", "3.1%" as basis points (0 to 5000); null for anything else or over 50%. */
function parseMarginPct(raw: string): number | null {
  const m = /^(\d{1,2})(?:\.(\d{1,2}))?%?$/.exec(raw.trim());
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return bps <= MARGIN_MAX_BPS ? bps : null;
}

/** A band's margin in basis points, signed by its side (+ above, − below); null when the box is not a valid percentage. */
export function marginBpsOf(f: Pick<BandDraft, 'marginSide' | 'marginPct'>): number | null {
  const bps = parseMarginPct(f.marginPct);
  if (bps === null) return null;
  // 0% is at market either way (never −0).
  return f.marginSide === 'below' && bps !== 0 ? -bps : bps;
}

/** A margin in basis points as the box's text: 50 → "0.5", 1225 → "12.25", 0 → "0". */
function marginPctText(bps: number): string {
  const abs = Math.abs(bps);
  const frac = (abs % 100).toString().padStart(2, '0').replace(/0+$/, '');
  return frac === '' ? `${Math.floor(abs / 100)}` : `${Math.floor(abs / 100)}.${frac}`;
}

/** "+0.5%", "-1.2%", "0.0%" as the board; a hundredth when the margin has one ("-12.25%", "+0.03%"). */
export function marginText(bps: number): string {
  return `${bps > 0 ? '+' : ''}${(bps / 100).toFixed(bps % 10 === 0 ? 1 : 2)}%`;
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

/**
 * The preview's first line: "Selling XMR via Zelle, PayPal · USD, CAD · you", and the lowest trade
 * rule when every band asks for one ("· 5+ completed trades"). COPY-UNSIGNED: the comma lists (J-16).
 */
export function previewLine(side: Side, methodNames: readonly string[], currencies: readonly string[], minTrades: MinTrades): string {
  const base = `${side === 'sell' ? 'Selling XMR' : 'Buying XMR'} via ${methodNames.join(', ')} · ${currencies.join(', ')} · you`;
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
/** COPY-UNSIGNED: a fiat band end (O-018: bands are whole units). */
export const FIAT_AMOUNT_ERROR = 'Enter an amount, like 50 or 2,000.';
export const WHOLE_UNITS_ERROR = 'Whole units only, no cents.';
// not-a-refusal: an input check on the two amounts of a band
export const MIN_OVER_MAX = "The smallest trade can't be more than the largest.";

// ---------------------------------------------------------------------------------------------
// J-16 (Plan 3 Tasks 34/35): several currencies, bands and payment methods (owner Q23: 3 bands per
// currency, 5 payment types per offer; Q8: 5 currencies). The numbers are @x2f/trade's, the API's.

export { MAX_BANDS, MAX_CURRENCIES, MAX_METHODS };

/** A method's price change: steps of 0.5%, from −5% to +10%. The numbers are @x2f/trade's, which the API and the database enforce (review I4). */
export { ADJUST_MAX_BPS, ADJUST_MIN_BPS, ADJUST_STEP_BPS };

/** The form's words for J-16. COPY-UNSIGNED: all of them (board FlexOffer-Post's where it has them, else the lead's). */
export const POST_COPY = {
  currenciesHelp: `Pick up to ${MAX_CURRENCIES}. Each currency has its own bands; nothing is converted.`,
  addCurrency: 'Add a currency',
  currenciesFull: `That's ${MAX_CURRENCIES} currencies, the most one offer can have.`,
  pickCurrency: 'Pick at least one currency.',
  /** DESIGN (J-32, O-020/O-021): tag or hide for a currency with no market rate; the lead's interim tag. */
  noRate: 'no rate',
  bandsHelp: 'Set a different price for different trade sizes. Bands are whole units with no gaps: one ends at 500, the next starts at 501. Two bands on the same amounts need another price or another minimum of completed trades.',
  xmrOneBand: 'In XMR each currency has one band.',
  addBand: 'Add a band',
  removeBand: 'Remove this band',
  bandsFull: `That's ${MAX_BANDS} bands, the most one currency can have.`,
  noXmrWithBands: 'To set amounts in XMR, keep one band per currency.',
  bandsSame: 'Two bands cover the same amounts with the same price and the same minimum of completed trades. Change one of them.',
  // not-a-refusal: an input check on a currency's bands (the API's checkBands rule, in words)
  bandsGap: (start: string) => `Bands can't leave a gap: the next band starts at ${start}.`,
  bandsBad: 'Fix the bands of this currency.',
  methodsHelp: 'Pick every payment method you take. Each one has its own payment instructions and can change the price by a percent.',
  addMethod: 'Add a payment method',
  removeMethod: 'Remove',
  methodsFull: `That's ${MAX_METHODS} payment methods, the most one offer can have.`,
  pickMethod: 'Pick at least one payment method.',
  priceChange: 'Price change',
  instructions: 'Payment instructions',
  instructionsHint: 'What the other person needs to know to pay you or get paid.',
  instructionsFor: (currency: string) => `What the other person needs to know to pay you in ${currency}.`,
  sameForAll: 'Same for all currencies',
  // not-a-refusal: an input check on a band's margin plus a method's change (rateFor's range)
  overLimit: "A band's price plus a payment method's price change can't pass 50% either way.",
  whoCanTrade: 'Minimum completed trades',
} as const;

/** A method's price change as the board shows it: "No change", "+2.0%", "−0.5%" (a minus sign). */
export function adjustText(bps: number): string {
  if (bps === 0) return 'No change';
  return `${bps > 0 ? '+' : '−'}${(Math.abs(bps) / 100).toFixed(1)}%`;
}

export function stepAdjust(bps: number, dir: 1 | -1): number {
  return Math.max(ADJUST_MIN_BPS, Math.min(ADJUST_MAX_BPS, bps + dir * ADJUST_STEP_BPS));
}

function nextKey(f: FormState): number {
  let max = 0;
  for (const list of Object.values(f.bands)) for (const b of list) max = Math.max(max, b.key);
  return max + 1;
}

/**
 * A method's instructions kept true to the picked currencies (Task 34 review I1/I2): per-currency text
 * only for currencies still picked, and with one currency left, that currency's own text becomes
 * the shared set.
 */
function fitMethod(m: MethodDraft, currencies: readonly string[]): MethodDraft {
  const byCurrency: Record<string, string> = {};
  for (const [c, t] of Object.entries(m.byCurrency)) if (currencies.includes(c)) byCurrency[c] = t;
  if (currencies.length === 1 && !m.same) {
    const own = byCurrency[currencies[0]!] ?? '';
    return { ...m, same: true, instructions: own.trim() !== '' ? own : m.instructions, byCurrency: {} };
  }
  return { ...m, byCurrency };
}

/** Adds a currency with one empty band (at most MAX_CURRENCIES, each once). */
export function addCurrency(f: FormState, currency: string): FormState {
  if (f.currencies.includes(currency) || f.currencies.length >= MAX_CURRENCIES || !/^[A-Z]{3}$/.test(currency)) return f;
  return { ...f, currencies: [...f.currencies, currency], bands: { ...f.bands, [currency]: [newBand(nextKey(f))] } };
}

/** Removes a currency with its bands and its own instructions. */
export function removeCurrency(f: FormState, currency: string): FormState {
  if (!f.currencies.includes(currency)) return f;
  const bands = { ...f.bands };
  delete bands[currency];
  const currencies = f.currencies.filter((c) => c !== currency);
  return { ...f, currencies, bands, methods: f.methods.map((m) => fitMethod(m, currencies)) };
}

/**
 * Add a band (fiat only, at most MAX_BANDS): it starts one unit after the highest band's end (O-018),
 * with the last band's price and rule; the poster types its end.
 */
export function addBand(f: FormState, currency: string): FormState {
  const list = f.bands[currency];
  if (!list || list.length >= MAX_BANDS || f.unit === 'xmr') return f;
  let end: bigint | null = null;
  for (const b of list) {
    const v = parseWhole(b.max);
    if (typeof v === 'bigint' && (end === null || v > end)) end = v;
  }
  const last = list[list.length - 1];
  const band = newBand(nextKey(f), {
    min: end === null ? '' : String(end + 1n),
    ...(last ? { marginSide: last.marginSide, marginPct: last.marginPct, minTrades: last.minTrades } : {}),
  });
  return { ...f, bands: { ...f.bands, [currency]: [...list, band] } };
}

export function setBand(f: FormState, currency: string, key: number, patch: Partial<Omit<BandDraft, 'key'>>): FormState {
  const list = f.bands[currency];
  if (!list) return f;
  return { ...f, bands: { ...f.bands, [currency]: list.map((b) => (b.key === key ? { ...b, ...patch } : b)) } };
}

/** Removes a band; a currency always keeps one. */
export function removeBand(f: FormState, currency: string, key: number): FormState {
  const list = f.bands[currency];
  if (!list || list.length <= 1) return f;
  return { ...f, bands: { ...f.bands, [currency]: list.filter((b) => b.key !== key) } };
}

export function addMethod(f: FormState, methodId: string): FormState {
  if (methodId === '' || f.methods.length >= MAX_METHODS || f.methods.some((m) => m.methodId === methodId)) return f;
  return { ...f, methods: [...f.methods, { methodId, adjustBps: 0, same: true, instructions: '', byCurrency: {} }] };
}

export function removeMethod(f: FormState, methodId: string): FormState {
  return { ...f, methods: f.methods.filter((m) => m.methodId !== methodId) };
}

export function setMethod(f: FormState, methodId: string, patch: Partial<Omit<MethodDraft, 'methodId'>>): FormState {
  return { ...f, methods: f.methods.map((m) => (m.methodId === methodId ? { ...m, ...patch } : m)) };
}

/**
 * The currency picker's entries (owner Q28, O-019: USD, EUR, GBP, CAD, AUD, JPY first, then A-Z, all
 * with flags; Q24, O-020: one with no market rate is kept and marked, and is back the moment its rate
 * is): of POST_CURRENCIES (the ones the lists can show), in @x2f/trade currencyChoices' order. A
 * currency is available when `GET /v1/currencies` last said so or when its price has just arrived
 * (`priced`); before the list has loaded (null), every one is.
 */
export function currencyOptions(loaded: readonly CurrencyChoice[] | null, priced: (code: string) => boolean = () => false): CurrencyChoice[] {
  return currencyChoices(POST_CURRENCIES, (c) => priced(c) || loaded === null || loaded.some((x) => x.code === c && x.available));
}

/** An entry's label in the picker: the flag, then "USD", or "CAD · no rate" (DESIGN, J-32: the tag is the lead's interim). */
export function currencyLabel(c: CurrencyChoice): string {
  return `${c.flag} ${c.code}${c.available ? '' : ` · ${POST_COPY.noRate}`}`;
}

// ---------------------------------------------------------------------------------------------
// Validation.

/** Errors of one band ('' fields are absent). */
export interface BandErrors {
  min?: string;
  max?: string;
  margin?: string;
}

export interface FormErrors {
  currencies?: string;
  methods?: string;
  country?: string;
  terms?: string;
  /** J-17 (F13): the poster has not ticked every gift-card term of their side. */
  giftCardTerms?: string;
  /** Per picked currency with a bad band: each band's own errors (by key), and the currency's (the band rule). */
  bands?: Record<string, { rows: Record<number, BandErrors>; all?: string }>;
}

/** A band as POST /v1/offers takes it: whole units (fiat) or atomic units (XMR) as decimal strings. */
export interface PostBand {
  min: string;
  max: string;
  marginBps: number;
  minTrades: MinTrades;
}

/** A method as posted: `instructions` shared; `instructionsByCurrency` replaces it for the currencies named. */
export interface PostMethod {
  methodId: string;
  adjustBps: number;
  instructions: string;
  instructionsByCurrency?: Record<string, string>;
}

/** The longest terms the API stores (apps/api/src/offers/routes.ts TERMS_MAX). */
export const TERMS_MAX = 4000;
/** The longest payment instructions the API stores (apps/api/src/offers/routes.ts INSTRUCTIONS_MAX). */
export const INSTRUCTIONS_MAX = 1000;
/**
 * The characters the API refuses in terms and instructions (apps/api/src/offers/routes.ts
 * BAD_TERMS_CHAR, keep in step): control characters other than newline and tab, and bidi overrides
 * and isolates.
 */
export const BAD_TERMS_CHAR = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/u;
export const TERMS_BAD_TEXT = 'Your terms contain hidden characters (for example from copying formatted text). Retype the part you pasted.';
export const TERMS_LONG_TEXT = `Keep your terms under ${TERMS_MAX.toLocaleString('en-US')} characters.`;
/** COPY-UNSIGNED: the terms rule, said of payment instructions. */
export const INSTRUCTIONS_BAD_TEXT = 'Your payment instructions contain hidden characters (for example from copying formatted text). Retype the part you pasted.';
/** COPY-UNSIGNED */
export const INSTRUCTIONS_LONG_TEXT = `Keep each set of payment instructions under ${INSTRUCTIONS_MAX.toLocaleString('en-US')} characters.`;

/** The terms as the API stores them: line breaks as newlines, no space at either end. */
export function cleanTerms(t: string): string {
  return t.replace(/\r\n?/g, '\n').trim();
}

function textError(t: string, max: number, bad: string, long: string): string | null {
  if (BAD_TERMS_CHAR.test(t)) return bad;
  if ([...t].length > max) return long;
  return null;
}

export interface ValidateContext {
  /** Whether a method is a gift card (the card's country is then required and sent). */
  giftCard?: (methodId: string) => boolean;
  /** J-17 (F13): the gift-card terms the poster has ticked (GiftCardTerms). */
  giftCardTicked?: ReadonlySet<string>;
}

/** One band's errors and, when it has none, the band as posted. */
function checkBand(b: BandDraft, unit: AmountUnit): { errors: BandErrors; band?: PostBand } {
  const errors: BandErrors = {};
  const end = (raw: string): bigint | string => {
    if (unit === 'xmr') {
      const v = parseXmrAmount(raw);
      return v === null || v === 0n ? XMR_AMOUNT_ERROR : v;
    }
    const v = parseWhole(raw);
    if (v === 'cents') return WHOLE_UNITS_ERROR;
    return v === null || v === 0n ? FIAT_AMOUNT_ERROR : v;
  };
  const min = end(b.min);
  const max = end(b.max);
  if (typeof min === 'string') errors.min = min;
  if (typeof max === 'string') errors.max = max;
  // not-a-refusal: an input check on the two amounts
  if (typeof min === 'bigint' && typeof max === 'bigint' && min > max) errors.min = MIN_OVER_MAX;
  const marginBps = marginBpsOf(b);
  // not-a-refusal: an input check on the percentage box
  if (marginBps === null) errors.margin = MARGIN_ERROR;
  if (Object.keys(errors).length > 0) return { errors };
  return { errors, band: { min: String(min), max: String(max), marginBps: marginBps!, minTrades: b.minTrades } };
}

/** The currency's band-rule error (@x2f/trade checkBands, the API's rule), in words. */
function bandRuleText(bands: readonly PostBand[], unit: AmountUnit, currency: string): string | null {
  const refused = checkBands(bands, unit);
  if (refused === null) return null;
  if (refused === 'bands-same') return POST_COPY.bandsSame;
  if (refused === 'gap') {
    // The first gap, as checkBands finds it: sorted by start, past the furthest end so far.
    const sorted = [...bands].sort((a, b) => (BigInt(a.min) < BigInt(b.min) ? -1 : BigInt(a.min) > BigInt(b.min) ? 1 : 0));
    let reach = BigInt(sorted[0]!.max);
    for (const b of sorted.slice(1)) {
      if (BigInt(b.min) > reach + 1n) return POST_COPY.bandsGap(formatAmount((reach + 1n) * 100n, currency));
      if (BigInt(b.max) > reach) reach = BigInt(b.max);
    }
  }
  if (refused === 'too-many-bands') return POST_COPY.bandsFull;
  if (refused === 'xmr-one-band') return POST_COPY.xmrOneBand;
  return POST_COPY.bandsBad;
}

export function validate(f: FormState, ctx: ValidateContext = {}): { errors: FormErrors; body?: PostOfferBody } {
  const errors: FormErrors = {};
  if (f.currencies.length === 0) errors.currencies = POST_COPY.pickCurrency;
  else if (f.currencies.length > MAX_CURRENCIES) errors.currencies = POST_COPY.currenciesFull;
  const bandErrors: NonNullable<FormErrors['bands']> = {};
  const currencies: PostOfferBody['currencies'] = [];
  for (const currency of f.currencies) {
    const rows: Record<number, BandErrors> = {};
    const posted: PostBand[] = [];
    for (const b of f.bands[currency] ?? []) {
      const r = checkBand(b, f.unit);
      if (r.band) posted.push(r.band);
      else rows[b.key] = r.errors;
    }
    if (Object.keys(rows).length > 0) {
      bandErrors[currency] = { rows };
      continue;
    }
    const all = posted.length === 0 ? POST_COPY.bandsBad : bandRuleText(posted, f.unit, currency);
    if (all !== null) bandErrors[currency] = { rows, all };
    else currencies.push({ currency, bands: posted });
  }
  if (Object.keys(bandErrors).length > 0) errors.bands = bandErrors;

  const methods: PostMethod[] = [];
  if (f.methods.length === 0) errors.methods = POST_COPY.pickMethod;
  else if (f.methods.length > MAX_METHODS) errors.methods = POST_COPY.methodsFull;
  for (const m of f.methods) {
    const split = !m.same && f.currencies.length > 1;
    const shared = split ? '' : cleanTerms(m.instructions);
    const byCurrency: Record<string, string> = {};
    if (split) for (const c of f.currencies) byCurrency[c] = cleanTerms(m.byCurrency[c] ?? '');
    for (const t of [shared, ...Object.values(byCurrency)]) {
      const e = textError(t, INSTRUCTIONS_MAX, INSTRUCTIONS_BAD_TEXT, INSTRUCTIONS_LONG_TEXT);
      if (e !== null && errors.methods === undefined) errors.methods = e;
    }
    methods.push({ methodId: m.methodId, adjustBps: m.adjustBps, instructions: shared, ...(split ? { instructionsByCurrency: byCurrency } : {}) });
  }
  // Every band's margin + every method's change stays within ±50% (the API's rule, rateFor's range).
  const over = currencies.some((c) => c.bands.some((b) => f.methods.some((m) => Math.abs(b.marginBps + m.adjustBps) > MARGIN_MAX_BPS)));
  if (over && errors.methods === undefined) errors.methods = POST_COPY.overLimit;

  const giftCard = ctx.giftCard !== undefined && f.methods.some((m) => ctx.giftCard!(m.methodId));
  if (giftCard && !isCountryCode(f.country)) errors.country = COUNTRY_REQUIRED;
  // J-17 (T-081) on J-16's form, which offers every method in every picked currency (lead ruling,
  // 10 Nov 2026: a gift-card method is offered only in a currency of the card's country): with a card
  // method on the offer, every picked currency must be one of the card's country's.
  else if (giftCard && errors.currencies === undefined && !f.currencies.every((c) => giftCardCurrencyOk(f.country, c))) errors.currencies = CURRENCY_NOT_CARD;
  // J-17 (F13): every term of the poster's side ticked.
  if (giftCard && !giftCardTermsComplete(posterGiftCardRole(f.side), ctx.giftCardTicked ?? new Set())) errors.giftCardTerms = GIFT_CARD_TERMS_UNTICKED;
  const terms = cleanTerms(f.terms);
  const termsErr = textError(terms, TERMS_MAX, TERMS_BAD_TEXT, TERMS_LONG_TEXT);
  if (termsErr !== null) errors.terms = termsErr;
  if (Object.keys(errors).length > 0) return { errors };
  return { errors, body: { side: f.side, amountUnit: f.unit, currencies, methods, terms, ...(giftCard ? { country: f.country, giftCardTerms: GIFT_CARD_TERMS_VERSION } : {}) } };
}

/** CantDoThat's title when Post offer is refused by a rule (Plan 5 Task 21; in the refusal text map). */
export const POST_CANT_TITLE = CANT_DO_TITLE.post;

/** The refusal code when Post offer was refused by a rule (shown in CantDoThat), else null. */
export function postCantDo(code: string): CantDoCode | null {
  return isCantDoCode(code) ? code : null;
}

/**
 * The words for a refused Post offer; a CANT_DO_CODES refusal is shown in CantDoThat, the rest
 * inline. `extra` is the refusal's other fields (the cap on `too-many-offers`, review M2).
 */
export function refusalText(code: string, extra?: Record<string, unknown>): string {
  if (isCantDoCode(code)) return postCantDoText(code, offerCapsOf(extra));
  switch (code) {
    case 'trading-paused':
      return 'Trading is paused for maintenance. Your offer was not posted. Try again soon.';
    case 'method-unavailable':
      // COPY-UNSIGNED (J-16: an offer has several methods).
      // not-a-refusal: a catalog fact (the method is off the list), see NOT_REFUSAL_CODES
      return "One of these payment methods isn't available right now. Remove it and post again.";
    case 'price-unavailable':
      // Owner p11-6: without a price for one of its currencies the offer's bands can't be checked
      // against the trade limit, so it isn't posted (the API fails closed). COPY-UNSIGNED
      return "There's no price for one of your currencies right now, so your offer wasn't posted. Try again in a few minutes.";
    default:
      return "Something went wrong and your offer wasn't posted. Try again.";
  }
}

// ---------------------------------------------------------------------------------------------
// The draft kept while the poster signs up or adds a wallet (spec 6.4).

const DRAFT_KEY = 'x2f.post-draft';
/** The draft's shape version: 2 is J-16's (currencies, bands, methods); a draft without one is the single-offer form's. */
const DRAFT_VERSION = 2;

/** Keeps the form for this tab while the user signs up or adds a wallet (spec 6.4). */
export function saveDraft(storage: Storage, f: FormState): void {
  try {
    storage.setItem(DRAFT_KEY, JSON.stringify({ v: DRAFT_VERSION, ...f }));
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
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
/** 0 was the old default ("anyone"); it loads as No minimum (review L2). */
const minTradesOf = (v: unknown): MinTrades | undefined => (v === 0 ? null : (MIN_TRADES as readonly unknown[]).includes(v) ? (v as MinTrades) : undefined);

/**
 * The draft's margin: the typed side and percentage, or, from a draft saved before the typed margin,
 * its market margin in basis points. A fixed-price draft has none (owner Q1) and is dropped.
 */
function draftMargin(d: Record<string, unknown>): Pick<BandDraft, 'marginSide' | 'marginPct'> | null {
  if (d.marginSide === 'above' || d.marginSide === 'below') return str(d.marginPct, 16) ? { marginSide: d.marginSide, marginPct: d.marginPct } : null;
  if (d.priceMode === 'market' && typeof d.marginBps === 'number' && Number.isInteger(d.marginBps) && Math.abs(d.marginBps) <= MARGIN_MAX_BPS) {
    return { marginSide: d.marginBps < 0 ? 'below' : 'above', marginPct: marginPctText(d.marginBps) };
  }
  return null;
}

function draftBand(v: unknown): BandDraft | null {
  if (!isObj(v) || typeof v.key !== 'number' || !Number.isSafeInteger(v.key) || !str(v.min, 32) || !str(v.max, 32)) return null;
  const margin = draftMargin(v);
  const minTrades = minTradesOf(v.minTrades);
  if (margin === null || minTrades === undefined) return null;
  return { key: v.key, min: v.min, max: v.max, ...margin, minTrades };
}

function draftMethod(v: unknown, currencies: readonly string[]): MethodDraft | null {
  if (!isObj(v) || !str(v.methodId, 64) || v.methodId === '' || typeof v.adjustBps !== 'number' || !Number.isInteger(v.adjustBps)) return null;
  if (v.adjustBps < ADJUST_MIN_BPS || v.adjustBps > ADJUST_MAX_BPS || typeof v.same !== 'boolean' || !str(v.instructions, INSTRUCTIONS_MAX * 2) || !isObj(v.byCurrency)) return null;
  const byCurrency: Record<string, string> = {};
  for (const [c, t] of Object.entries(v.byCurrency)) {
    if (!currencies.includes(c) || !str(t, INSTRUCTIONS_MAX * 2)) return null;
    byCurrency[c] = t;
  }
  return { methodId: v.methodId, adjustBps: v.adjustBps, same: v.same, instructions: v.instructions, byCurrency };
}

/** A J-16 draft (v 2), checked field by field; null when any part is off. */
function loadV2(d: Record<string, unknown>): FormState | null {
  if ((d.side !== 'sell' && d.side !== 'buy') || (d.unit !== 'xmr' && d.unit !== 'fiat') || !str(d.terms, TERMS_MAX)) return null;
  if (!(d.country === '' || isCountryCode(d.country))) return null;
  if (!Array.isArray(d.currencies) || d.currencies.length > MAX_CURRENCIES || !isObj(d.bands) || !Array.isArray(d.methods) || d.methods.length > MAX_METHODS) return null;
  const currencies = d.currencies;
  if (!currencies.every((c): c is string => typeof c === 'string' && POST_CURRENCIES.includes(c)) || new Set(currencies).size !== currencies.length) return null;
  const bands: Record<string, BandDraft[]> = {};
  for (const c of currencies) {
    const list = d.bands[c];
    if (!Array.isArray(list) || list.length === 0 || list.length > MAX_BANDS) return null;
    const read = list.map(draftBand);
    if (read.some((b) => b === null)) return null;
    bands[c] = read as BandDraft[];
  }
  if (Object.keys(d.bands).some((c) => !currencies.includes(c))) return null;
  const methods = d.methods.map((m) => draftMethod(m, currencies));
  if (methods.some((m) => m === null)) return null;
  return { side: d.side, unit: d.unit, currencies, bands, methods: methods as MethodDraft[], terms: d.terms, country: d.country as string };
}

/** A draft from the single-offer form (before J-16): its one method, currency and range as one band. */
function loadV1(d: Record<string, unknown>): FormState | null {
  const margin = draftMargin(d);
  const minTrades = minTradesOf(d.minTrades);
  const ok =
    (d.side === 'sell' || d.side === 'buy') &&
    str(d.methodId, 64) &&
    typeof d.currency === 'string' &&
    POST_CURRENCIES.includes(d.currency) &&
    margin !== null &&
    (d.unit === undefined || d.unit === 'xmr' || d.unit === 'fiat') &&
    str(d.min, 32) &&
    str(d.max, 32) &&
    str(d.terms, TERMS_MAX) &&
    minTrades !== undefined &&
    (d.country === '' || isCountryCode(d.country));
  if (!ok) return null;
  const currency = d.currency as string;
  const methodId = d.methodId as string;
  return {
    side: d.side as Side,
    // A draft from before the switch was typed in fiat.
    unit: (d.unit ?? 'fiat') as AmountUnit,
    currencies: [currency],
    bands: { [currency]: [{ key: 1, min: d.min as string, max: d.max as string, ...margin!, minTrades: minTrades! }] },
    methods: methodId === '' ? [] : [{ methodId, adjustBps: 0, same: true, instructions: '', byCurrency: {} }],
    terms: d.terms as string,
    country: d.country as string,
  };
}

export function loadDraft(storage: Storage): FormState | null {
  let raw: unknown;
  try {
    const text = storage.getItem(DRAFT_KEY);
    if (text === null) return null;
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(raw)) return null;
  if (raw.v === DRAFT_VERSION) return loadV2(raw);
  return raw.v === undefined ? loadV1(raw) : null;
}
