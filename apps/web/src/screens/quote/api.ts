// What the quote reads from and sends to the API. Responses are parsed strictly, so a renamed or
// missing field fails loudly instead of quoting wrong.
//
// Shapes: `GET /v1/offers` and `TraderSummary` are plan Task 4 (with the Revision 2026-10-24
// `opensAt` and the poster's `stage`, as Task 16 reads them); `GET /v1/price` is the unmerged Task 3
// branch (wip/second-p3-t3: `{ currency, centsPerXmr, exponent, at, usdCentsPerXmr }`); `POST
// /v1/offers/:id/take` is plan Task 5; `GET /v1/wallets` is Plan 2 as built. The guessed ones are
// listed in test/quote-tripwires.test.ts.
//
// TODO(Task 16 merge): parseOffers here mirrors src/screens/browse/api.ts on wip/t3-p3-task16; once
// that is on the line, use it instead (a tripwire says when).
import type { Pricing } from '@x2f/trade';
import { ApiCallError, api } from '../../api/client.js';
import type { AdSide, MarketNow, OpensAt, QuoteOffer, Stage } from './quoteModel.js';

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

const STAGES: readonly Stage[] = ['starter', 'building', 'graduated'];
const OPENS_AT: readonly OpensAt[] = ['building', 'graduated'];

function parsePricing(v: unknown, at: string): Pricing {
  const o = obj(v, at);
  const mode = oneOf(o, 'mode', at, ['market', 'fixed'] as const);
  return mode === 'market' ? { mode, marginBps: num(o, 'marginBps', at) } : { mode, centsPerXmr: big(o, 'centsPerXmr', at) };
}

/** One card of `GET /v1/offers`, keeping only the public fields the quote shows. */
export function parseOffer(v: unknown, side: AdSide, currency: string, at = 'offer'): QuoteOffer {
  const o = obj(v, at);
  const p = obj(o.poster, `${at}.poster`);
  const offer: QuoteOffer = {
    id: str(o, 'id', at),
    side,
    currency,
    // `username` is the public display name (spec 6.1); the private login name never reaches here.
    poster: { username: str(p, 'username', `${at}.poster`), stage: oneOf(p, 'stage', `${at}.poster`, STAGES) },
    pricing: parsePricing(o.pricing, `${at}.pricing`),
    minFiatCents: big(o, 'minFiatCents', at),
    maxFiatCents: big(o, 'maxFiatCents', at),
    minTrades: num(o, 'minTrades', at),
  };
  if (o.opensAt !== undefined) offer.opensAt = oneOf(o, 'opensAt', at, OPENS_AT);
  return offer;
}

/**
 * The offer, found in its own list (the plan has no single-offer route): the ads on `side` for
 * `method` in `currency`. Null when it is no longer listed.
 */
export async function fetchOffer(side: AdSide, method: string, currency: string, id: string, signal?: AbortSignal): Promise<QuoteOffer | null> {
  const q = new URLSearchParams({ side, method, currency, sort: 'best' });
  const raw = await api(`/v1/offers?${q}`, signal ? { signal } : {});
  if (!Array.isArray(raw)) throw new ApiShapeError('offers');
  const i = raw.findIndex((r) => r !== null && typeof r === 'object' && (r as Obj).id === id);
  return i < 0 ? null : parseOffer(raw[i], side, currency, `offers[${i}]`);
}

/** The payment method's name from `GET /v1/methods` (Task 3); the id when it is not listed. */
export async function fetchMethodName(side: AdSide, method: string, currency: string, signal?: AbortSignal): Promise<string> {
  const q = new URLSearchParams({ side, currency, sort: 'az' });
  const o = obj(await api(`/v1/methods?${q}`, signal ? { signal } : {}), 'methods');
  for (const k of ['live', 'all']) {
    const rows = o[k];
    if (!Array.isArray(rows)) throw new ApiShapeError(`methods.${k}`);
    for (const r of rows) {
      const row = obj(r, `methods.${k}[]`);
      if (row.id === method) return str(row, 'name', `methods.${k}[]`);
    }
  }
  return method;
}

/** `GET /v1/price?currency`, or null on 503 `price-unavailable` (the feed is down or stale). */
export async function fetchMarket(currency: string, signal?: AbortSignal): Promise<MarketNow | null> {
  try {
    const o = obj(await api(`/v1/price?${new URLSearchParams({ currency })}`, signal ? { signal } : {}), 'price');
    if (str(o, 'currency', 'price') !== currency) throw new ApiShapeError('price.currency');
    const usd = o.usdCentsPerXmr;
    return { centsPerXmr: big(o, 'centsPerXmr', 'price'), usdCentsPerXmr: usd === undefined || usd === null ? null : big(o, 'usdCentsPerXmr', 'price') };
  } catch (e) {
    if (e instanceof ApiCallError && e.status === 503 && e.code === 'price-unavailable') return null;
    throw e;
  }
}

/** A payout wallet as `GET /v1/wallets` sends it (Plan 2): never a balance. */
export interface PickWallet {
  id: string;
  app: string;
  label: string;
  addressEnd: string;
  usable: boolean;
}

export async function fetchWallets(signal?: AbortSignal): Promise<PickWallet[]> {
  const raw = await api('/v1/wallets', signal ? { signal } : {});
  if (!Array.isArray(raw)) throw new ApiShapeError('wallets');
  return raw.map((v, i) => {
    const at = `wallets[${i}]`;
    const o = obj(v, at);
    if (typeof o.usable !== 'boolean') throw new ApiShapeError(`${at}.usable`);
    // The full address is in the response; the quote keeps only its end.
    return { id: str(o, 'id', at), app: str(o, 'app', at), label: str(o, 'label', at), addressEnd: str(o, 'addressEnd', at), usable: o.usable };
  });
}

/** `POST /v1/offers/:id/take` (Task 5) → the new trade's code. */
export async function takeOffer(offerId: string, amountAtomic: bigint, walletId: string): Promise<string> {
  const o = obj(await api(`/v1/offers/${encodeURIComponent(offerId)}/take`, { method: 'POST', body: { amountAtomic, walletId } }), 'take');
  return str(o, 'code', 'take');
}
