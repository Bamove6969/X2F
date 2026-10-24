// The API answers PostOffer reads, parsed strictly so a renamed or missing field fails loudly.
// Shapes: GET /v1/price and GET /v1/methods from Task 3 (wip/second-p3-t3, not merged yet);
// POST /v1/offers from the plan's Task 4. test/post-tripwires.test.ts fails when those land.
import { api } from '../../api/client.js';

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
}

export type Side = 'sell' | 'buy';

/** POST /v1/offers (plan Task 4); bigints go as decimal strings. */
export interface PostOfferBody {
  side: Side;
  methodId: string;
  currency: string;
  pricing: { mode: 'market'; marginBps: number } | { mode: 'fixed'; centsPerXmr: bigint };
  minFiatCents: bigint;
  maxFiatCents: bigint;
  minTrades: 0 | 5 | 10 | 50;
  terms: string;
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
    return { id: m.id, name: m.name, giftCard: m.giftCard };
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

export async function postOffer(body: PostOfferBody): Promise<void> {
  await api('/v1/offers', { method: 'POST', body });
}
