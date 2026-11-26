// What the browse screens read from the API: `GET /v1/methods`, `/v1/offers` and `/v1/price`
// (no session needed, P3-M9) and `POST /v1/method-suggestions`. What the screens render is parsed
// strictly, so a renamed or missing field fails loudly instead of rendering wrong; fields they do
// not render (a method's group and giftCard, the price's currency and exponent) may be missing, but
// are refused when of the wrong type. The shapes are plan Tasks
// 3 and 4 (with the 2026-10-24 starter-limits revision); test/browse-tripwire.test.ts marks the
// ones still guessed. The browser never works out a stage, a cap or who may take an offer: it shows
// `poster.stage` and `opensAt` as the API sends them.
import type { AmountUnit } from '@x2f/trade';
import { api } from '../../api/client.js';
import { readPrefs } from '../settings/prefs.js';

/** What the person browsing does with XMR. */
export type Side = 'sell' | 'buy';

/** The ads a person sees: someone selling XMR browses buy ads, someone buying browses sell ads. */
export function adSide(side: Side): Side {
  return side === 'sell' ? 'buy' : 'sell';
}

export type Stage = 'starter' | 'building' | 'graduated';
export type OpensAt = 'building' | 'graduated';

export interface MethodRow {
  id: string;
  name: string;
  group: string;
  giftCard: boolean;
  offers: number;
  /** The best rate among the live offers, in minor units per XMR, or null when none has a price now. */
  bestRate: bigint | null;
  /**
   * How long the method's money can take to arrive, in minutes (owner p9-4: shown up front where
   * the method is picked); null from an older API, and then no line is shown.
   */
  upToMin: number | null;
}

export interface MethodLists {
  live: MethodRow[];
  all: MethodRow[];
}

export interface Price {
  currency: string;
  centsPerXmr: bigint;
  exponent: number;
  at: string;
}

export interface TraderSummary {
  /** The public display name (FU-A); the private login name is never sent. */
  displayName: string;
  completedTrades: number;
  online: boolean;
  lastSeenAt: string | null;
  typicalMinutes: number | null;
  positivePct: number | null;
  badges: string[];
  /** Plan 5 Task 5: how many of `badges` are Featured (New included); the rest are "+N". Missing: 2. */
  featuredBadges?: number;
  /** The poster's starter-limits stage, from the API (spec 2.3). New shows until 'graduated'. */
  stage: Stage;
  /**
   * Owner Q63 (6 Nov; was C12b's dollars): the opt-in "X+ XMR traded to date" line (only for MORE
   * than X), X in whole XMR, already rounded down by the API; null (or missing) shows nothing.
   */
  tradedOverXmr: number | null;
  /** Owner Q64, p4-1: verified imported volume, one line per site, in whole US dollars (rounded down); [] for none. */
  imported: { site: string; overUsd: number }[];
  /** D-049 (J-21): disputes won and lost, by each one's latest ruling (the profile's "Disputes: N won, M lost"). */
  disputes?: { won: number; lost: number };
}

/** Always the market price moved by the margin (owner Q1, F1: there are no fixed-price offers). */
export type Pricing = { mode: 'market'; marginBps: number };

export interface Offer {
  id: string;
  poster: TraderSummary;
  /** The offer's price now, in minor units per XMR; null while the feed is down. */
  rate: bigint | null;
  pricing: Pricing;
  /**
   * The unit the poster set the range in (owner, 8 Nov: "Offer amounts in XMR or fiat"); that pair is
   * exact. The API sends the other pair converted at the offer's rate now, or null with no rate (the
   * feed is down). XMR in atomic units, fiat in the currency's minor units.
   */
  amountUnit: AmountUnit;
  minAtomic: bigint | null;
  maxAtomic: bigint | null;
  minFiatCents: bigint | null;
  maxFiatCents: bigint | null;
  /** The completed trades a taker needs; 0 for no minimum (the API sends null, owner 8 Nov). */
  minTrades: number;
  /** Set for a signed-in viewer whose cap is below the offer's minimum: the stage that opens it. */
  opensAt?: OpensAt;
  /**
   * J-16 (flexible offers, apps/api/src/offers/routes.ts OfferCard): the listed currency's bands, as
   * covered ranges in `amountUnit`'s minor units, by start; [] in an answer from before J-16 (the
   * card is then one band, its range and `pricing`).
   */
  tiers: OfferTier[];
  /** The payment methods offered in the listed currency with their price change; [] before J-16. */
  methods: OfferMethod[];
  /** Every currency of the offer in the poster's order; [] before J-16. */
  currencies: string[];
  /** The signed-in viewer's completed trades, which the take picks the band by; null signed out or before J-16. */
  viewerTrades: number | null;
}

/** One band of a card (J-16): both ends included, its margin and its trade rule (null: no minimum); `methodIds` null: every method. */
export interface OfferTier {
  min: bigint;
  max: bigint;
  marginBps: number;
  minTrades: number | null;
  methodIds: string[] | null;
}

/** A payment method on a card (J-16): its price change over the band's price, in basis points of the market. */
export interface OfferMethod {
  methodId: string;
  adjustBps: number;
}

/** A response that is not the shape the screens were built for. */
export class ApiShapeError extends Error {
  constructor(where: string) {
    super(`unexpected API shape at ${where}`);
    this.name = 'ApiShapeError';
  }
}

type Obj = Record<string, unknown>;

function obj(v: unknown, at: string): Obj {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new ApiShapeError(at);
  return v as Obj;
}

function list(v: unknown, at: string): unknown[] {
  if (!Array.isArray(v)) throw new ApiShapeError(at);
  return v;
}

function str(o: Obj, k: string, at: string): string {
  const v = o[k];
  if (typeof v !== 'string') throw new ApiShapeError(`${at}.${k}`);
  return v;
}

function num(o: Obj, k: string, at: string): number {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ApiShapeError(`${at}.${k}`);
  return v;
}

function bool(o: Obj, k: string, at: string): boolean {
  const v = o[k];
  if (typeof v !== 'boolean') throw new ApiShapeError(`${at}.${k}`);
  return v;
}

/** A field the screens do not render: `fallback` when absent, still refused when of the wrong type. */
function optional<T>(o: Obj, k: string, at: string, read: (o: Obj, k: string, at: string) => T, fallback: T): T {
  return o[k] === undefined ? fallback : read(o, k, at);
}

function orNull<T>(o: Obj, k: string, at: string, read: (o: Obj, k: string, at: string) => T): T | null {
  if (!(k in o)) throw new ApiShapeError(`${at}.${k}`);
  return o[k] === null ? null : read(o, k, at);
}

/** A non-negative integer sent as a decimal string (bigints travel as strings). */
function big(o: Obj, k: string, at: string): bigint {
  const v = str(o, k, at);
  if (!/^\d{1,30}$/.test(v)) throw new ApiShapeError(`${at}.${k}`);
  return BigInt(v);
}

function oneOf<T extends string>(o: Obj, k: string, at: string, values: readonly T[]): T {
  const v = str(o, k, at);
  if (!(values as readonly string[]).includes(v)) throw new ApiShapeError(`${at}.${k}`);
  return v as T;
}

const STAGES = ['starter', 'building', 'graduated'] as const;
const OPENS_AT = ['building', 'graduated'] as const;

function parseRow(v: unknown, at: string): MethodRow {
  const o = obj(v, at);
  return {
    id: str(o, 'id', at),
    name: str(o, 'name', at),
    group: optional(o, 'group', at, str, ''),
    giftCard: optional(o, 'giftCard', at, bool, false),
    offers: num(o, 'offers', at),
    bestRate: orNull(o, 'bestRate', at, big),
    upToMin: optional<number | null>(o, 'upToMin', at, num, null),
  };
}

export function parseMethodLists(v: unknown): MethodLists {
  const o = obj(v, 'methods');
  return {
    live: list(o.live, 'methods.live').map((r, i) => parseRow(r, `methods.live[${i}]`)),
    all: list(o.all, 'methods.all').map((r, i) => parseRow(r, `methods.all[${i}]`)),
  };
}

export function parsePrice(v: unknown): Price {
  const o = obj(v, 'price');
  return {
    currency: optional(o, 'currency', 'price', str, ''),
    centsPerXmr: big(o, 'centsPerXmr', 'price'),
    exponent: optional(o, 'exponent', 'price', num, 2),
    at: str(o, 'at', 'price'),
  };
}

function parsePoster(v: unknown, at: string): TraderSummary {
  const o = obj(v, at);
  return {
    displayName: str(o, 'displayName', at),
    completedTrades: num(o, 'completedTrades', at),
    online: bool(o, 'online', at),
    lastSeenAt: orNull(o, 'lastSeenAt', at, str),
    typicalMinutes: orNull(o, 'typicalMinutes', at, num),
    positivePct: orNull(o, 'positivePct', at, num),
    badges: list(o.badges, `${at}.badges`).map((b, i) => {
      if (typeof b !== 'string') throw new ApiShapeError(`${at}.badges[${i}]`);
      return b;
    }),
    stage: oneOf(o, 'stage', at, STAGES),
    tradedOverXmr: o.tradedOverXmr === undefined || o.tradedOverXmr === null ? null : num(o, 'tradedOverXmr', at),
    imported: o.imported === undefined ? [] : list(o.imported, `${at}.imported`).map((v, i) => {
      const line = obj(v, `${at}.imported[${i}]`);
      return { site: str(line, 'site', `${at}.imported[${i}]`), overUsd: num(line, 'overUsd', `${at}.imported[${i}]`) };
    }),
  };
}

/** `{ mode: 'market', marginBps }`; any other mode (a fixed price, owner Q1) does not parse. */
function parsePricing(v: unknown, at: string): Pricing {
  const o = obj(v, at);
  const mode = oneOf(o, 'mode', at, ['market'] as const);
  return { mode, marginBps: num(o, 'marginBps', at) };
}

/** `minTrades`: null is no minimum (owner, 8 Nov), read as 0; the key must be there. */
export function minTradesOf(o: Obj, at: string): number {
  if (!('minTrades' in o)) throw new ApiShapeError(`${at}.minTrades`);
  return o.minTrades === null ? 0 : num(o, 'minTrades', at);
}

const UNITS = ['xmr', 'fiat'] as const;

/**
 * The trade size: `amountUnit` and both pairs, the poster's own pair required, the other a string or
 * null. An answer without `amountUnit` is a fiat range (the API before 8 Nov), with no XMR pair.
 */
function parseAmounts(o: Obj, at: string): Pick<Offer, 'amountUnit' | 'minAtomic' | 'maxAtomic' | 'minFiatCents' | 'maxFiatCents'> {
  if (o.amountUnit === undefined) {
    return { amountUnit: 'fiat', minAtomic: null, maxAtomic: null, minFiatCents: big(o, 'minFiatCents', at), maxFiatCents: big(o, 'maxFiatCents', at) };
  }
  const amountUnit = oneOf(o, 'amountUnit', at, UNITS);
  const out = {
    amountUnit,
    minAtomic: orNull(o, 'minAtomic', at, big),
    maxAtomic: orNull(o, 'maxAtomic', at, big),
    minFiatCents: orNull(o, 'minFiatCents', at, big),
    maxFiatCents: orNull(o, 'maxFiatCents', at, big),
  };
  const [lo, hi] = amountUnit === 'xmr' ? [out.minAtomic, out.maxAtomic] : [out.minFiatCents, out.maxFiatCents];
  if (lo === null || hi === null || lo <= 0n || hi < lo) throw new ApiShapeError(`${at}.amountUnit`);
  return out;
}

function strings(v: unknown, at: string): string[] {
  return list(v, at).map((x, i) => {
    if (typeof x !== 'string') throw new ApiShapeError(`${at}[${i}]`);
    return x;
  });
}

function parseTier(v: unknown, at: string): OfferTier {
  const o = obj(v, at);
  const min = big(o, 'min', at);
  const max = big(o, 'max', at);
  if (min <= 0n || max < min) throw new ApiShapeError(`${at}.max`);
  if (!('minTrades' in o) || !('methodIds' in o)) throw new ApiShapeError(at);
  return {
    min,
    max,
    marginBps: num(o, 'marginBps', at),
    minTrades: o.minTrades === null ? null : num(o, 'minTrades', at),
    methodIds: o.methodIds === null ? null : strings(o.methodIds, `${at}.methodIds`),
  };
}

function parseOfferMethod(v: unknown, at: string): OfferMethod {
  const o = obj(v, at);
  return { methodId: str(o, 'methodId', at), adjustBps: num(o, 'adjustBps', at) };
}

export function parseOffers(v: unknown): Offer[] {
  return list(v, 'offers').map((item, i) => {
    const at = `offers[${i}]`;
    const o = obj(item, at);
    const offer: Offer = {
      id: str(o, 'id', at),
      poster: parsePoster(o.poster, `${at}.poster`),
      rate: orNull(o, 'rate', at, big),
      pricing: parsePricing(o.pricing, `${at}.pricing`),
      ...parseAmounts(o, at),
      minTrades: minTradesOf(o, at),
      tiers: o.tiers === undefined ? [] : list(o.tiers, `${at}.tiers`).map((t, j) => parseTier(t, `${at}.tiers[${j}]`)),
      methods: o.methods === undefined ? [] : list(o.methods, `${at}.methods`).map((m, j) => parseOfferMethod(m, `${at}.methods[${j}]`)),
      currencies: o.currencies === undefined ? [] : strings(o.currencies, `${at}.currencies`),
      viewerTrades: o.viewerTrades === undefined ? null : num(o, 'viewerTrades', at),
    };
    if (o.opensAt !== undefined) offer.opensAt = oneOf(o, 'opensAt', at, OPENS_AT);
    return offer;
  });
}

export type MethodSort = 'buyers' | 'rate' | 'az';
export type OfferSort = 'best' | 'online' | 'trades';

/**
 * `list` in the order of `sort`, whatever order the API sent (a new array; ties keep the API order).
 * Best price is what is best for the person browsing: lowest first when buying XMR, highest first
 * when selling; an offer with no price now goes last.
 */
export function sortOffers(list: readonly Offer[], sort: OfferSort, side: Side): Offer[] {
  const out = [...list];
  if (sort === 'online') return out.sort((a, b) => Number(b.poster.online) - Number(a.poster.online));
  if (sort === 'trades') return out.sort((a, b) => b.poster.completedTrades - a.poster.completedTrades);
  return out.sort((a, b) => {
    if (a.rate === b.rate) return 0;
    if (a.rate === null) return 1;
    if (b.rate === null) return -1;
    const asc = a.rate < b.rate ? -1 : 1;
    return side === 'buy' ? asc : -asc;
  });
}

export async function fetchMethods(side: Side, currency: string, sort: MethodSort, signal?: AbortSignal): Promise<MethodLists> {
  const q = new URLSearchParams({ side: adSide(side), currency, sort });
  return parseMethodLists(await api(`/v1/methods?${q}`, signal ? { signal } : {}));
}

export async function fetchOffers(side: Side, method: string, currency: string, sort: OfferSort, signal?: AbortSignal): Promise<Offer[]> {
  const q = new URLSearchParams({ side: adSide(side), method, currency, sort });
  return parseOffers(await api(`/v1/offers?${q}`, signal ? { signal } : {}));
}

export async function fetchPrice(currency: string, signal?: AbortSignal): Promise<Price> {
  const q = new URLSearchParams({ currency });
  return parsePrice(await api(`/v1/price?${q}`, signal ? { signal } : {}));
}

export async function suggestMethod(name: string): Promise<void> {
  await api('/v1/method-suggestions', { method: 'POST', body: { name } });
}

/**
 * Minor units of `currency` as money, e.g. 33120n USD → "$331.20"; with `whole`, an amount with no
 * cents drops them ("$2,000"). Two decimals: only 2-decimal currencies are enabled (Revision
 * 2026-10-20).
 */
export function formatMinor(minor: bigint, currency: string, o: { whole?: boolean } = {}): string {
  const whole = minor / 100n;
  const cents = minor % 100n;
  const nf = new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const frac = cents.toString().padStart(2, '0');
  const parts = nf.formatToParts(whole);
  const dropCents = o.whole === true && cents === 0n;
  return parts
    .filter((p) => !(dropCents && (p.type === 'decimal' || p.type === 'fraction')))
    .map((p) => (p.type === 'fraction' ? frac : p.value))
    .join('');
}

/** The currencies on the Main board's picker. */
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'BRL', 'INR'] as const;

const offered = (c: string | null | undefined): c is string => typeof c === 'string' && (CURRENCIES as readonly string[]).includes(c);

/**
 * The `currency` query value when it is one the picker offers, else the currency saved in
 * Settings, Preferences on this device (when it is still offered), else USD.
 */
export function currencyFrom(search: string): string {
  const c = new URLSearchParams(search).get('currency');
  if (offered(c)) return c;
  const preferred = readPrefs().currency;
  return offered(preferred) ? preferred : 'USD';
}
