// What the browse screens read from the API: `GET /v1/methods`, `/v1/offers` and `/v1/price`
// (no session needed, P3-M9) and `POST /v1/method-suggestions`. Every response is parsed strictly,
// so a renamed or missing field fails loudly instead of rendering wrong. The shapes are plan Tasks
// 3 and 4 (with the 2026-10-24 starter-limits revision); test/browse-tripwire.test.ts marks the
// ones still guessed. The browser never works out a stage, a cap or who may take an offer: it shows
// `poster.stage` and `opensAt` as the API sends them.
import { api } from '../../api/client.js';

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
  username: string;
  completedTrades: number;
  online: boolean;
  lastSeenAt: string | null;
  typicalMinutes: number | null;
  positivePct: number | null;
  badges: string[];
  /** The poster's starter-limits stage, from the API (spec 2.3). New shows until 'graduated'. */
  stage: Stage;
}

export type Pricing = { mode: 'market'; marginBps: number } | { mode: 'fixed'; centsPerXmr: bigint };

export interface Offer {
  id: string;
  poster: TraderSummary;
  /** The offer's price now, in minor units per XMR; null for a market offer while the feed is down. */
  rate: bigint | null;
  pricing: Pricing;
  minFiatCents: bigint;
  maxFiatCents: bigint;
  minTrades: number;
  /** Set for a signed-in viewer whose cap is below the offer's minimum: the stage that opens it. */
  opensAt?: OpensAt;
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
    group: str(o, 'group', at),
    giftCard: bool(o, 'giftCard', at),
    offers: num(o, 'offers', at),
    bestRate: orNull(o, 'bestRate', at, big),
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
  return { currency: str(o, 'currency', 'price'), centsPerXmr: big(o, 'centsPerXmr', 'price'), exponent: num(o, 'exponent', 'price'), at: str(o, 'at', 'price') };
}

function parsePoster(v: unknown, at: string): TraderSummary {
  const o = obj(v, at);
  return {
    username: str(o, 'username', at),
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
  };
}

function parsePricing(v: unknown, at: string): Pricing {
  const o = obj(v, at);
  const mode = oneOf(o, 'mode', at, ['market', 'fixed'] as const);
  return mode === 'market' ? { mode, marginBps: num(o, 'marginBps', at) } : { mode, centsPerXmr: big(o, 'centsPerXmr', at) };
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
      minFiatCents: big(o, 'minFiatCents', at),
      maxFiatCents: big(o, 'maxFiatCents', at),
      minTrades: num(o, 'minTrades', at),
    };
    if (o.opensAt !== undefined) offer.opensAt = oneOf(o, 'opensAt', at, OPENS_AT);
    return offer;
  });
}

export type MethodSort = 'buyers' | 'rate' | 'az';
export type OfferSort = 'best' | 'online' | 'trades';

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

/** The `currency` query value when it is one the picker offers, else USD. */
export function currencyFrom(search: string): string {
  const c = new URLSearchParams(search).get('currency');
  return c !== null && (CURRENCIES as readonly string[]).includes(c) ? c : 'USD';
}
