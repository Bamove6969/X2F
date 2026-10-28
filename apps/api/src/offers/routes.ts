import { MAX_MARGIN_BPS, offerRate, type Pricing, type Side } from '@x2f/trade';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Deps } from '../app.js';
import { requireSession } from '../auth/sessions.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { getMethod, isAvailable } from '../methods/profiles.js';
import type { LiveOfferStat, LiveOfferStats } from '../methods/routes.js';
import { currencyExponent } from '../price/currencies.js';
import type { MarketPrices } from '../price/market.js';
import { loadStarterSettings, opensAt, tradeCap, usdCentsOf } from '../traders/stage.js';
import { traderSummaries, type TraderSummary } from '../traders/summary.js';
import { usableWallets } from '../wallets/routes.js';

/**
 * Plan 3 Task 4: offers (ads).
 *
 * - `POST /v1/offers` (`requireTrader`) → 201 `{ id }`.
 * - `PATCH /v1/offers/:id { status }` (the poster only) → `{ id, status }`.
 * - `GET /v1/offers?side&method&currency&sort=best|online|trades` (no session, P3-M9) → `OfferCard[]`.
 * - `GET /v1/offers/:id` (no session) → `OfferDetail`; a paused offer only to its poster.
 *
 * `side` is the ads' own side, what the poster does with XMR: someone buying XMR browses
 * `side=sell`. Amounts and prices are decimal strings (bigints), fiat in the currency's minor units.
 */

export interface OfferCard {
  id: string;
  poster: TraderSummary;
  /** The offer's price per XMR now (`offerRate`); null for a market offer while the feed is down. */
  rate: string | null;
  pricing: { mode: 'market'; marginBps: number } | { mode: 'fixed'; centsPerXmr: string };
  minFiatCents: string;
  maxFiatCents: string;
  minTrades: number;
  /** Gift-card offers only: the card's country, ISO 3166-1 alpha-2 (Revision 2026-10-27). */
  country?: string;
  /**
   * For a signed-in trader whose starter-limit cap is below the offer's minimum: the stage that
   * opens it (Revision 2026-10-24). Absent otherwise, and while the currency has no market price
   * to convert the minimum to US dollars (the take checks the cap again).
   */
  opensAt?: 'building' | 'graduated';
}

export interface OfferDetail extends OfferCard {
  side: Side;
  methodId: string;
  currency: string;
  terms: string;
  status: OfferStatus;
}

export type OfferStatus = 'live' | 'paused' | 'removed';

const SORTS = ['best', 'online', 'trades'] as const;
type Sort = (typeof SORTS)[number];
const MIN_TRADES = [0, 5, 10, 50] as const;
const STATUSES = ['live', 'paused', 'removed'] as const;
export const TERMS_MAX = 4000;
/** Fiat amounts: at most 14 digits of minor units (the web form takes 12 whole digits and 2 decimals). */
const FIAT = /^\d{1,14}$/;
const PRICE = /^\d{1,20}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Control (C0, C1, DEL) and format characters (bidi overrides, zero-width); newlines and tabs are allowed in terms.
const CONTROL = /[\p{Cc}\p{Cf}]/u;
/** At most this many cards per list. */
const LIST_LIMIT = 500;

interface OfferRow {
  id: string;
  account_id: string;
  side: Side;
  method_id: string;
  currency: string;
  price_mode: 'market' | 'fixed';
  margin_bps: number | null;
  fixed_cents_per_xmr: string | null;
  min_fiat_cents: string;
  max_fiat_cents: string;
  min_trades: number;
  terms: string;
  country: string | null;
  status: OfferStatus;
}

const OFFER_COLUMNS = `o.id, o.account_id, o.side, o.method_id, o.currency, o.price_mode, o.margin_bps, o.fixed_cents_per_xmr,
  o.min_fiat_cents, o.max_fiat_cents, o.min_trades, o.terms, o.country, o.status`;

/** An offer anyone may see: live, and its poster neither disabled nor on a trading hold. */
const LISTED = `o.status = 'live' and a.kind = 'trader' and a.disabled_at is null
  and not exists (select 1 from trading_holds h where h.account_id = o.account_id and h.lifted_at is null)`;

function pricingOf(r: OfferRow): Pricing {
  return r.price_mode === 'fixed' ? { mode: 'fixed', centsPerXmr: BigInt(r.fixed_cents_per_xmr!) } : { mode: 'market', marginBps: r.margin_bps! };
}

function rateOf(r: OfferRow, prices: MarketPrices): bigint | null {
  return offerRate(pricingOf(r), r.currency, prices.current(r.currency))?.centsPerXmr ?? null;
}

function toCard(r: OfferRow, poster: TraderSummary, rate: bigint | null): OfferCard {
  const p = pricingOf(r);
  const card: OfferCard = {
    id: r.id,
    poster,
    rate: rate === null ? null : rate.toString(),
    pricing: p.mode === 'fixed' ? { mode: 'fixed', centsPerXmr: p.centsPerXmr.toString() } : { mode: 'market', marginBps: p.marginBps },
    minFiatCents: r.min_fiat_cents,
    maxFiatCents: r.max_fiat_cents,
    minTrades: r.min_trades,
  };
  if (r.country !== null) card.country = r.country;
  return card;
}

/** A query value given exactly once as a string, else undefined (a repeated key arrives as an array). */
function single(q: unknown, key: string): string | undefined {
  const v = (q as Record<string, unknown> | null)?.[key];
  return typeof v === 'string' ? v : undefined;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

const bad = (): ApiError => new ApiError(400, 'bad-request');

interface NewOffer {
  side: Side;
  methodId: string;
  currency: string;
  pricing: Pricing;
  minFiatCents: bigint;
  maxFiatCents: bigint;
  minTrades: number;
  terms: string;
  country: string | null;
}

function parsePricing(v: unknown): Pricing {
  if (!isObject(v)) throw bad();
  const keys = Object.keys(v).sort().join(',');
  if (v.mode === 'market' && keys === 'marginBps,mode') {
    const m = v.marginBps;
    if (typeof m !== 'number' || !Number.isSafeInteger(m) || Math.abs(m) > MAX_MARGIN_BPS) throw bad();
    return { mode: 'market', marginBps: m };
  }
  if (v.mode === 'fixed' && keys === 'centsPerXmr,mode') {
    const c = v.centsPerXmr;
    if (typeof c !== 'string' || !PRICE.test(c) || BigInt(c) <= 0n) throw bad();
    return { mode: 'fixed', centsPerXmr: BigInt(c) };
  }
  throw bad();
}

function fiat(v: unknown): bigint {
  if (typeof v !== 'string' || !FIAT.test(v)) throw bad();
  const n = BigInt(v);
  if (n <= 0n) throw bad();
  return n;
}

/** The body's shape; the method's availability and the gift-card country are checked by the caller. */
function parseNewOffer(body: unknown): NewOffer & { countryGiven: unknown } {
  if (!isObject(body)) throw bad();
  const { side, methodId, currency, pricing, minFiatCents, maxFiatCents, minTrades, terms, country, ...rest } = body;
  if (Object.keys(rest).length > 0) throw bad();
  if (side !== 'sell' && side !== 'buy') throw bad();
  if (typeof methodId !== 'string' || methodId.length === 0 || methodId.length > 64) throw bad();
  if (typeof currency !== 'string' || currencyExponent(currency) === null) throw bad();
  const min = fiat(minFiatCents);
  const max = fiat(maxFiatCents);
  if (min > max) throw bad();
  if (typeof minTrades !== 'number' || !(MIN_TRADES as readonly number[]).includes(minTrades)) throw bad();
  if (typeof terms !== 'string') throw bad();
  const cleanTerms = terms.trim();
  if ([...cleanTerms].length > TERMS_MAX || CONTROL.test(cleanTerms.replace(/[\n\t]/g, ''))) throw bad();
  return {
    side, methodId, currency, pricing: parsePricing(pricing), minFiatCents: min, maxFiatCents: max, minTrades,
    terms: cleanTerms, country: null, countryGiven: country,
  };
}

/** 409 when the method may not be offered now (P3-I20: methods awaiting legal review). */
function assertMethodAvailable(methodId: string): void {
  if (!isAvailable(methodId)) throw new ApiError(409, 'method-unavailable');
}

/**
 * Posting or relisting: refused while the site's trading is paused (409 `trading-paused`), while the
 * account has a trading hold (409 `trading-hold`) and without a usable payout wallet (409
 * `no-wallet`, spec 6.4; a wallet still in its 24-hour wait does not count).
 */
async function assertMayPost(db: Queryable, accountId: string, now: Date): Promise<void> {
  const { rows } = await db.query<{ paused: boolean | null; held: boolean }>(
    `select (select trading_paused from site_flags) as paused,
            exists (select 1 from trading_holds where account_id = $1 and lifted_at is null) as held`,
    [accountId],
  );
  const r = rows[0]!;
  // No site_flags row fails closed.
  if (r.paused !== false) throw new ApiError(409, 'trading-paused');
  if (r.held) throw new ApiError(409, 'trading-hold');
  if ((await usableWallets(db, accountId, now)).length === 0) throw new ApiError(409, 'no-wallet');
}

const requireTrader = requireSession({ kinds: ['trader'] });
// Browsing: a signed-in trader's session, read only (no touch), when there is one.
const viewerCheck = requireSession({ kinds: ['trader'], touch: false, allowStaleTerms: true });

/** The signed-in trader browsing, or null for anyone else (logged out, staff, an expired session…). */
async function viewer(app: FastifyInstance, req: FastifyRequest, reply: FastifyReply): Promise<string | null> {
  try {
    await viewerCheck.call(app, req, reply);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return null;
    throw e;
  }
  return req.auth?.accountId ?? null;
}

/** Best for the person browsing: lowest first on sell ads (they pay), highest first on buy ads (they are paid); no price last. */
function compareRate(side: Side, a: bigint | null, b: bigint | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const asc = a < b ? -1 : 1;
  return side === 'buy' ? -asc : asc;
}

/** `/v1/methods`' live-offer counts (Task 3's `LiveOfferStats`), from the offers anyone may see. */
export function liveOfferStats(deps: Pick<Deps, 'db' | 'prices'>): LiveOfferStats {
  return async ({ side, currency }) => {
    const { rows } = await deps.db.query<OfferRow>(
      `select ${OFFER_COLUMNS} from offers o join accounts a on a.id = o.account_id
        where ${LISTED} and o.side = $1 and o.currency = $2`,
      [side, currency],
    );
    const stats = new Map<string, LiveOfferStat>();
    for (const r of rows) {
      const rate = rateOf(r, deps.prices);
      const s = stats.get(r.method_id) ?? { methodId: r.method_id, offers: 0, bestCentsPerXmr: null };
      s.offers++;
      if (rate !== null && (s.bestCentsPerXmr === null || compareRate(side, rate, s.bestCentsPerXmr) < 0)) s.bestCentsPerXmr = rate;
      stats.set(r.method_id, s);
    }
    return [...stats.values()];
  };
}

/** Adds `opensAt` to each card above the viewer's cap (Revision 2026-10-24). */
async function markOpensAt(deps: Deps, viewerId: string, rows: readonly OfferRow[], cards: OfferCard[]): Promise<void> {
  const settings = await loadStarterSettings(deps.db);
  const cap = await tradeCap(deps.db, viewerId, deps.clock(), settings);
  if (cap.capUsdCents === null) return;
  rows.forEach((r, i) => {
    const q = deps.prices.quote(r.currency);
    if (q === null) return;
    const usd = usdCentsOf(BigInt(r.min_fiat_cents), { centsPerXmr: q.price.centsPerXmr, usdCentsPerXmr: q.usdCentsPerXmr });
    const at = opensAt(settings, cap.stage, usd);
    if (at !== undefined) cards[i]!.opensAt = at;
  });
}

export function offerRoutes(app: FastifyInstance): void {
  app.post('/v1/offers', { preHandler: requireTrader }, async (req, reply) => {
    const deps = req.server.deps;
    const o = parseNewOffer(req.body);
    const method = getMethod(o.methodId);
    if (method === null) throw bad();
    assertMethodAvailable(o.methodId);
    // A gift-card offer names the card's country; no other offer has one (Revision 2026-10-27).
    if (method.giftCard) {
      if (typeof o.countryGiven !== 'string' || !/^[A-Z]{2}$/.test(o.countryGiven)) throw bad();
      o.country = o.countryGiven;
    } else if (o.countryGiven !== undefined) {
      throw bad();
    }
    const accountId = req.auth!.accountId;
    const now = deps.clock();
    await assertMayPost(deps.db, accountId, now);
    const p = o.pricing;
    const { rows } = await deps.db.query<{ id: string }>(
      `insert into offers (account_id, side, method_id, currency, price_mode, margin_bps, fixed_cents_per_xmr,
                           min_fiat_cents, max_fiat_cents, min_trades, terms, country, status, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'live', $13, $13) returning id`,
      [
        accountId, o.side, o.methodId, o.currency, p.mode, p.mode === 'market' ? p.marginBps : null,
        p.mode === 'fixed' ? p.centsPerXmr.toString() : null, o.minFiatCents.toString(), o.maxFiatCents.toString(),
        o.minTrades, o.terms, o.country, now,
      ],
    );
    return reply.code(201).send({ id: rows[0]!.id });
  });

  app.patch('/v1/offers/:id', { preHandler: requireTrader }, async (req) => {
    const deps = req.server.deps;
    const id = (req.params as { id: string }).id;
    const body = req.body;
    if (!isObject(body) || Object.keys(body).length !== 1) throw bad();
    const status = body.status;
    if (typeof status !== 'string' || !(STATUSES as readonly string[]).includes(status)) throw bad();
    if (!UUID.test(id)) throw new ApiError(404, 'not-found');
    const { rows } = await deps.db.query<{ account_id: string; status: OfferStatus; method_id: string }>(
      'select account_id, status, method_id from offers where id = $1',
      [id],
    );
    const row = rows[0];
    // A removed offer is gone for good.
    if (!row || row.status === 'removed') throw new ApiError(404, 'not-found');
    const accountId = req.auth!.accountId;
    if (row.account_id !== accountId) throw new ApiError(403, 'wrong-party');
    const now = deps.clock();
    if (status === 'live') {
      // Relisting is posting again.
      assertMethodAvailable(row.method_id);
      await assertMayPost(deps.db, accountId, now);
    }
    const r = await deps.db.query(
      `update offers set status = $2, updated_at = $3 where id = $1 and account_id = $4 and status <> 'removed'`,
      [id, status, now, accountId],
    );
    if (r.rowCount !== 1) throw new ApiError(404, 'not-found');
    return { id, status };
  });

  // Browsing needs no session (P3-M9); a signed-in trader also gets `opensAt`.
  app.get('/v1/offers', async (req, reply) => {
    const deps = req.server.deps;
    const side = single(req.query, 'side');
    const method = single(req.query, 'method');
    const currency = single(req.query, 'currency');
    const given = (req.query as Record<string, unknown> | null)?.sort !== undefined;
    const rawSort = single(req.query, 'sort');
    const sort: Sort | undefined = given ? SORTS.find((s) => s === rawSort) : 'best';
    if ((side !== 'sell' && side !== 'buy') || method === undefined || method.length === 0 || method.length > 64) throw bad();
    if (currency === undefined || !/^[A-Z]{3}$/.test(currency) || sort === undefined) throw bad();
    if (!isAvailable(method)) return [];

    const { rows } = await deps.db.query<OfferRow>(
      `select ${OFFER_COLUMNS} from offers o join accounts a on a.id = o.account_id
        where ${LISTED} and o.side = $1 and o.method_id = $2 and o.currency = $3
        order by o.created_at desc, o.id limit ${LIST_LIMIT}`,
      [side, method, currency],
    );
    const now = deps.clock();
    const posters = await traderSummaries(deps.db, rows.map((r) => r.account_id), now);
    const entries = rows.map((r) => ({ r, poster: posters.get(r.account_id)!, rate: rateOf(r, deps.prices) }));
    entries.sort((a, b) => {
      if (sort === 'online' && a.poster.online !== b.poster.online) return a.poster.online ? -1 : 1;
      if (sort === 'trades' && a.poster.completedTrades !== b.poster.completedTrades) return b.poster.completedTrades - a.poster.completedTrades;
      return compareRate(side, a.rate, b.rate);
    });
    const cards = entries.map((e) => toCard(e.r, e.poster, e.rate));
    const viewerId = await viewer(app, req, reply);
    if (viewerId !== null) await markOpensAt(deps, viewerId, entries.map((e) => e.r), cards);
    return cards;
  });

  app.get('/v1/offers/:id', async (req, reply): Promise<OfferDetail> => {
    const deps = req.server.deps;
    const id = (req.params as { id: string }).id;
    if (!UUID.test(id)) throw new ApiError(404, 'not-found');
    const { rows } = await deps.db.query<OfferRow & { listed: boolean }>(
      `select ${OFFER_COLUMNS}, (${LISTED}) as listed from offers o join accounts a on a.id = o.account_id where o.id = $1`,
      [id],
    );
    const r = rows[0];
    if (!r || r.status === 'removed') throw new ApiError(404, 'not-found');
    const viewerId = await viewer(app, req, reply);
    const mine = viewerId !== null && viewerId === r.account_id;
    if (!mine && !(r.listed && isAvailable(r.method_id))) throw new ApiError(404, 'not-found');
    const now = deps.clock();
    const poster = (await traderSummaries(deps.db, [r.account_id], now)).get(r.account_id)!;
    const card = toCard(r, poster, rateOf(r, deps.prices));
    if (viewerId !== null && !mine) await markOpensAt(deps, viewerId, [r], [card]);
    return { ...card, side: r.side, methodId: r.method_id, currency: r.currency, terms: r.terms, status: r.status };
  });
}
