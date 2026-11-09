// The API answers PostOffer reads, parsed strictly so a renamed or missing field fails loudly.
// Shapes: GET /v1/price and GET /v1/methods from Task 3 (apps/api/src/price, apps/api/src/methods;
// on the main line, checked against these parsers 2026-10-27); POST /v1/offers from the plan's
// Task 4 (apps/api/src/offers/routes.ts; checked against these shapes 2026-10-28).
import type { AmountUnit, CurrencyChoice } from '@x2f/trade';
import { api } from '../../api/client.js';
import type { PostBand, PostMethod } from './offerForm.js';

/** GET /v1/price?currency: the market price in the currency's minor units, and the same XMR in US cents. */
export interface PriceQuote {
  currency: string;
  centsPerXmr: bigint;
  exponent: number;
  at: string;
  usdCentsPerXmr: bigint;
}

export interface PickMethod {
  id: string;
  name: string;
  giftCard: boolean;
  /** How long the method's money can take to arrive, in minutes (owner p9-4); null from an older API. */
  upToMin: number | null;
}

export type Side = 'sell' | 'buy';

/**
 * POST /v1/offers (J-16, Plan 3 Task 34; apps/api/src/offers/routes.ts parseNewOffer): the side, the
 * unit every band is in, up to 5 currencies each with up to 3 bands, up to 5 payment methods. Band
 * ends are decimal strings: whole units in fiat (O-018), atomic units in XMR. Prices are always the
 * market moved by a band's margin and a method's change (owner Q1: no fixed price; F1: at most 50%).
 */
export interface PostOfferBody {
  side: Side;
  amountUnit: AmountUnit;
  currencies: { currency: string; bands: PostBand[] }[];
  methods: PostMethod[];
  terms: string;
  /** The card's country for a gift-card method (ISO 3166-1 alpha-2, Revision 2026-10-21); absent otherwise. */
  country?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

function shape(what: string): Error {
  return new Error(`unexpected ${what} answer`);
}

function bigintField(v: unknown, what: string): bigint {
  if (typeof v !== 'string' || !/^\d{1,30}$/.test(v)) throw shape(what);
  return BigInt(v);
}

export function parsePrice(raw: unknown): PriceQuote {
  if (!isRecord(raw) || typeof raw.currency !== 'string' || typeof raw.at !== 'string' || typeof raw.exponent !== 'number') throw shape('price');
  return {
    currency: raw.currency,
    centsPerXmr: bigintField(raw.centsPerXmr, 'price'),
    exponent: raw.exponent,
    at: raw.at,
    usdCentsPerXmr: bigintField(raw.usdCentsPerXmr, 'price'),
  };
}

/** Every method that may be offered: the catalog list (`all`), which already leaves out unavailable ones (P3-I20). */
export function parseMethods(raw: unknown): PickMethod[] {
  if (!isRecord(raw) || !Array.isArray(raw.all)) throw shape('methods');
  return raw.all.map((m: unknown) => {
    if (!isRecord(m) || typeof m.id !== 'string' || typeof m.name !== 'string' || typeof m.giftCard !== 'boolean') throw shape('methods');
    if (m.upToMin !== undefined && (typeof m.upToMin !== 'number' || !Number.isInteger(m.upToMin) || m.upToMin <= 0)) throw shape('methods');
    return { id: m.id, name: m.name, giftCard: m.giftCard, upToMin: typeof m.upToMin === 'number' ? m.upToMin : null };
  });
}

/** The market price, or null while the feed has none for this currency (503 price-unavailable). */
export async function fetchPrice(currency: string, signal?: AbortSignal): Promise<PriceQuote | null> {
  try {
    return parsePrice(await api(`/v1/price?currency=${encodeURIComponent(currency)}`, signal ? { signal } : {}));
  } catch (e) {
    if (signal?.aborted) throw e;
    return null;
  }
}

export async function fetchMethods(side: Side, currency: string): Promise<PickMethod[]> {
  const q = new URLSearchParams({ side, currency, sort: 'az' });
  return parseMethods(await api(`/v1/methods?${q.toString()}`));
}

/** The wire body: the body as the API reads it (J-16: every key at the top level already). */
export function wireBody(body: PostOfferBody): Record<string, unknown> {
  return { ...body };
}

export async function postOffer(body: PostOfferBody): Promise<void> {
  await api('/v1/offers', { method: 'POST', body: wireBody(body) });
}

/**
 * GET /v1/currencies (J-16, apps/api/src/price/routes.ts): every currency the feed knows, USD, EUR,
 * GBP, CAD, AUD, JPY first and the rest A-Z, each with its flag and whether it has a market price now.
 */
export function parseCurrencies(raw: unknown): CurrencyChoice[] {
  if (!isRecord(raw) || !Array.isArray(raw.currencies)) throw shape('currencies');
  return raw.currencies.map((c: unknown) => {
    if (!isRecord(c) || typeof c.code !== 'string' || !/^[A-Z]{3}$/.test(c.code) || typeof c.flag !== 'string' || typeof c.available !== 'boolean') throw shape('currencies');
    return { code: c.code, flag: c.flag, available: c.available };
  });
}

export async function fetchCurrencies(signal?: AbortSignal): Promise<CurrencyChoice[]> {
  return parseCurrencies(await api('/v1/currencies', signal ? { signal } : {}));
}
