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
  // The quote checks the poster's own unit at its own rate (review M1), so an offer set in XMR with
  // the feed down is still quoted: it reads "Price unavailable right now", never "no longer listed".
  return found === undefined ? null : quoteOffer(found, side, currency, method);
}

/**
 * The browse card as the quote reads it: its public fields, plus the side, currency and method it
 * was listed under (J-16: the take sends that currency and method; the bands are the ones offered
 * with it, and its price change is the card's own).
 */
export function quoteOffer(o: Offer, side: AdSide, currency: string, methodId: string): QuoteOffer {
  const offer: QuoteOffer = {
    id: o.id,
    side,
    currency,
    // The public Trade Tag (spec 6.1); the private login name never reaches here.
    poster: { tradeTag: o.poster.tradeTag, stage: o.poster.stage },
    pricing: o.pricing,
    amountUnit: o.amountUnit,
    minAtomic: o.minAtomic,
    maxAtomic: o.maxAtomic,
    minFiatCents: o.minFiatCents,
    maxFiatCents: o.maxFiatCents,
    minTrades: o.minTrades,
    methodId,
    adjustBps: o.methods.find((m) => m.methodId === methodId)?.adjustBps ?? 0,
    tiers: o.tiers
      .filter((t) => t.methodIds === null || t.methodIds.includes(methodId))
      .map((t) => ({ min: t.min, max: t.max, marginBps: t.marginBps, minTrades: t.minTrades })),
    viewerTrades: o.viewerTrades,
  };
  if (o.opensAt !== undefined) offer.opensAt = o.opensAt;
  return offer;
}

/** What the quote shows of the payment method: its name, and whether it is a gift card (J-17). */
export interface QuoteMethod {
  name: string;
  giftCard: boolean;
}

/**
 * The payment method from `GET /v1/methods` (Task 3): its name (the id when it is not listed) and
 * its gift-card flag (J-17: the quote's tick-box terms; false when not listed, as the API then
 * refuses the take anyway).
 */
export async function fetchMethod(side: AdSide, method: string, currency: string, signal?: AbortSignal): Promise<QuoteMethod> {
  const q = new URLSearchParams({ side, currency, sort: 'az' });
  const o = obj(await api(`/v1/methods?${q}`, signal ? { signal } : {}), 'methods');
  for (const k of ['live', 'all']) {
    const rows = o[k];
    if (!Array.isArray(rows)) throw new ApiShapeError(`methods.${k}`);
    for (const r of rows) {
      const row = obj(r, `methods.${k}[]`);
      if (row.id !== method) continue;
      if (typeof row.giftCard !== 'boolean') throw new ApiShapeError(`methods.${k}[].giftCard`);
      return { name: str(row, 'name', `methods.${k}[]`), giftCard: row.giftCard };
    }
  }
  return { name: method, giftCard: false };
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
  /** Owner demo note #6: for this trade only (absent from an older API build: saved). */
  oneTime: boolean;
  /** Owner, 17 Nov 2026: the default, picked first on the quote (absent from an older API build: none). */
  isDefault: boolean;
}

export async function fetchWallets(signal?: AbortSignal): Promise<PickWallet[]> {
  const raw = await api('/v1/wallets', signal ? { signal } : {});
  if (!Array.isArray(raw)) throw new ApiShapeError('wallets');
  const list = raw.map((v, i) => {
    const at = `wallets[${i}]`;
    const o = obj(v, at);
    if (typeof o.usable !== 'boolean') throw new ApiShapeError(`${at}.usable`);
    if (o.inUseByTrade !== undefined && o.inUseByTrade !== null && typeof o.inUseByTrade !== 'string') throw new ApiShapeError(`${at}.inUseByTrade`);
    if (o.oneTime !== undefined && typeof o.oneTime !== 'boolean') throw new ApiShapeError(`${at}.oneTime`);
    if (o.isDefault !== undefined && typeof o.isDefault !== 'boolean') throw new ApiShapeError(`${at}.isDefault`);
    return {
      id: str(o, 'id', at), app: str(o, 'app', at), label: str(o, 'label', at), address: str(o, 'address', at), addressEnd: str(o, 'addressEnd', at),
      usable: o.usable, oneTime: o.oneTime === true, isDefault: o.isDefault === true,
      inUse: typeof o.inUseByTrade === 'string',
    };
  });
  // Review 17 Nov (b) M1: a one-time wallet another trade is using is listed for Settings only; the
  // quote neither offers it nor counts it as waiting.
  return list.filter((w) => !w.inUse).map(({ inUse: _inUse, ...w }) => w);
}

/** What the take sends: the amount, the wallet, and the rate and total the person saw (Task 5 Revision 2026-10-27). */
export interface TakeRequest {
  amountAtomic: bigint;
  walletId: string;
  /**
   * The quoted rate. It only detects a move: the server always locks its own rate now and refuses
   * 409 `price-changed` when that differs from this by more than 0.5%.
   */
  centsPerXmr: bigint;
  /** The quoted total, fiatCents(amountAtomic, centsPerXmr), as shown (OD-5). */
  fiatCents: bigint;
  /** J-17 (F13): on a gift-card offer, the terms version the taker ticked; absent otherwise. */
  giftCardTerms?: string;
  /** J-16: the payment method taken with (one of the offer's, offered in `currency`). */
  methodId: string;
  /** J-16: the currency taken in (one of the offer's); every figure above is in it. */
  currency: string;
  /**
   * Lien recovery (review B1, docs/lien-recovery.md): the figure the quote showed the buyer, which
   * the buyer accepted by tapping Trade (0: none). The API refuses 409 `lien-recovery-changed` when
   * the trade would reserve any other figure. Sent by a buying taker only.
   */
  lienRecoveryAtomic?: bigint;
  /**
   * Seller lien recovery (owner 27 Nov 2026, docs/lien-recovery.md "Debtor is the seller"): the
   * extra the quote showed a selling taker, which they accepted by tapping Trade (0: none). The API
   * refuses 409 `lien-recovery-changed` for any other figure. Sent by a selling taker only.
   */
  sellerLienRecoveryAtomic?: bigint;
}

/**
 * `GET /v1/account/liens/preview` (review B1): what taking `offerId` for `amountAtomic` to
 * `walletId` would pay to the person this account owes after a dispute, now; 0 when nothing.
 */
export async function previewLienRecovery(offerId: string, amountAtomic: bigint, walletId: string, signal?: AbortSignal): Promise<bigint> {
  const q = new URLSearchParams({ offerId, amountAtomic: amountAtomic.toString(), walletId });
  const o = obj(await api(`/v1/account/liens/preview?${q.toString()}`, signal ? { signal } : {}), 'lien preview');
  const v = o.lienRecoveryAtomic;
  if (typeof v !== 'string' || !/^(0|[1-9]\d{0,30})$/.test(v)) throw new TypeError('lien preview');
  return BigInt(v);
}

/**
 * The same preview for a taker who SELLS into a buy ad (owner 27 Nov 2026): the extra they would
 * fund for their own lien (`sellerLienRecoveryAtomic`), 0 when none. A reply without the figure
 * is refused (the quote then waits), never read as none.
 */
export async function previewSellerLienRecovery(offerId: string, amountAtomic: bigint, walletId: string, signal?: AbortSignal): Promise<bigint> {
  const q = new URLSearchParams({ offerId, amountAtomic: amountAtomic.toString(), walletId });
  const o = obj(await api(`/v1/account/liens/preview?${q.toString()}`, signal ? { signal } : {}), 'lien preview');
  const v = o.sellerLienRecoveryAtomic;
  if (typeof v !== 'string' || !/^(0|[1-9]\d{0,30})$/.test(v)) throw new TypeError('lien preview');
  return BigInt(v);
}

/** What the take locked: the trade's code, and the server's rate and total (lead decision 2026-10-29). */
export interface Taken {
  code: string;
  centsPerXmr: bigint;
  fiatCents: bigint;
  /**
   * The trade's growth ceiling: the offer's maximum, clamped at take so extra XMR never grows the
   * trade past the launch cap (launch-rules review F1). It is the deal's `maxFiatCents`.
   */
  maxFiatCents: bigint;
  /** Lien recovery (owner 16 Nov 2026): what this buyer's proceeds pay to the person they owe; absent = none. */
  lienRecoveryAtomic?: bigint;
  /** Seller lien recovery (owner 27 Nov 2026): the extra this selling taker funds for their own lien; absent = none. */
  sellerLienRecoveryAtomic?: bigint;
}

/** `POST /v1/offers/:id/take` (Task 5) → the new trade's code, the rate and total that locked, and its growth ceiling. */
export async function takeOffer(offerId: string, body: TakeRequest): Promise<Taken> {
  const o = obj(await api(`/v1/offers/${encodeURIComponent(offerId)}/take`, { method: 'POST', body }), 'take');
  return {
    code: str(o, 'code', 'take'), centsPerXmr: big(o, 'centsPerXmr', 'take'), fiatCents: big(o, 'fiatCents', 'take'),
    maxFiatCents: big(o, 'maxFiatCents', 'take'),
    ...(o.lienRecoveryAtomic !== undefined ? { lienRecoveryAtomic: big(o, 'lienRecoveryAtomic', 'take') } : {}),
    ...(o.sellerLienRecoveryAtomic !== undefined ? { sellerLienRecoveryAtomic: big(o, 'sellerLienRecoveryAtomic', 'take') } : {}),
  };
}
