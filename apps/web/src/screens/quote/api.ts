// What the quote reads from and sends to the API. Responses are parsed strictly, so a renamed or
// missing field fails loudly instead of quoting wrong.
//
// Shapes: `GET /v1/offers` is plan Task 4 (with the Revision 2026-10-24 `opensAt` and the poster's
// `stage`), read through the browse screens' `parseOffers` (Task 16) so both read one shape;
// `GET /v1/price` and `GET /v1/methods` are Task 3 as on the line (apps/api/src/price/routes.ts:
// `{ currency, centsPerXmr, exponent, at, usdCentsPerXmr }`, checked 2026-10-27); `POST
// /v1/offers/:id/take` is plan Task 5; `GET /v1/wallets` is Plan 2 as built. Every one is on the
// line now (Task 5 2026-10-28), so the quote's tripwire file is gone (retired 2026-10-30).
import { ApiCallError, api } from '../../api/client.js';
import { ApiShapeError, parseOffers, type Offer } from '../browse/api.js';
import type { AdSide, MarketNow, QuoteOffer } from './quoteModel.js';

export { ApiShapeError };

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

/**
 * The offer, found in its own list (the plan has no single-offer route): the ads on `side` for
 * `method` in `currency`. Null when it is no longer listed.
 */
export async function fetchOffer(side: AdSide, method: string, currency: string, id: string, signal?: AbortSignal): Promise<QuoteOffer | null> {
  const q = new URLSearchParams({ side, method, currency, sort: 'best' });
  const found = parseOffers(await api(`/v1/offers?${q}`, signal ? { signal } : {})).find((o) => o.id === id);
  return found === undefined ? null : quoteOffer(found, side, currency);
}

/** The browse card as the quote reads it: its public fields, plus the side and currency it was listed under. */
export function quoteOffer(o: Offer, side: AdSide, currency: string): QuoteOffer {
  const offer: QuoteOffer = {
    id: o.id,
    side,
    currency,
    // The public display name (spec 6.1); the private login name never reaches here.
    poster: { displayName: o.poster.displayName, stage: o.poster.stage },
    pricing: o.pricing,
    minFiatCents: o.minFiatCents,
    maxFiatCents: o.maxFiatCents,
    minTrades: o.minTrades,
  };
  if (o.opensAt !== undefined) offer.opensAt = o.opensAt;
  return offer;
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
    // The ISO 4217 exponent (Revision 2026-10-20): the route always sends it, and every fiat figure honours it.
    const exponent = num(o, 'exponent', 'price');
    if (!Number.isInteger(exponent) || exponent < 0 || exponent > 4) throw new ApiShapeError('price.exponent');
    const usd = o.usdCentsPerXmr;
    const at = str(o, 'at', 'price');
    if (Number.isNaN(Date.parse(at))) throw new ApiShapeError('price.at');
    return { centsPerXmr: big(o, 'centsPerXmr', 'price'), exponent, usdCentsPerXmr: usd === undefined || usd === null ? null : big(o, 'usdCentsPerXmr', 'price'), at };
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
  /**
   * The full address, kept only to become `ownAddress` in the confirmed record the take hands the
   * trade room (confirmed.ts); the screen shows its last 6 characters (ui/addressEnd.ts), not `addressEnd`.
   */
  address: string;
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
    return { id: str(o, 'id', at), app: str(o, 'app', at), label: str(o, 'label', at), address: str(o, 'address', at), addressEnd: str(o, 'addressEnd', at), usable: o.usable };
  });
}

/** What the take sends: the amount, the wallet, and the rate and total the person saw (Task 5 Revision 2026-10-27). */
export interface TakeRequest {
  amountAtomic: bigint;
  walletId: string;
  /**
   * The quoted rate. It only detects a move: the server always locks its own rate now and refuses
   * 409 `price-changed` when that differs from this by more than 0.5% (a fixed price: at all).
   */
  centsPerXmr: bigint;
  /** The quoted total, fiatCents(amountAtomic, centsPerXmr), as shown (OD-5). */
  fiatCents: bigint;
}

/** What the take locked: the trade's code, and the server's rate and total (lead decision 2026-10-29). */
export interface Taken {
  code: string;
  centsPerXmr: bigint;
  fiatCents: bigint;
}

/** `POST /v1/offers/:id/take` (Task 5) → the new trade's code and the rate and total that locked. */
export async function takeOffer(offerId: string, body: TakeRequest): Promise<Taken> {
  const o = obj(await api(`/v1/offers/${encodeURIComponent(offerId)}/take`, { method: 'POST', body }), 'take');
  return { code: str(o, 'code', 'take'), centsPerXmr: big(o, 'centsPerXmr', 'take'), fiatCents: big(o, 'fiatCents', 'take') };
}
