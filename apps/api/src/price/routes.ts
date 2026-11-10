import type { FastifyInstance } from 'fastify';
import type { Deps } from '../app.js';
import { requireInside } from '../auth/frontDoor.js';
import { ApiError } from '../errors.js';
import { currencyExponent } from './currencies.js';

/**
 * `GET /v1/price?currency=EUR` (behind the front door, `requireInside`; open before 8 Nov 2026, P3-M9) → `{ currency, centsPerXmr, exponent, at,
 * usdCentsPerXmr }`: the market price in the currency's minor units (the XMR/USD median times
 * the USD→X rate in use, spec 11.6) with its ISO 4217 exponent (Revision 2026-10-20), the time of
 * the median's oldest quote, and the same XMR's US-dollar value in cents. 503 `price-unavailable`
 * when that currency's market prices are paused (Review Focus 5). An unknown currency is 400.
 */
export function priceRoutes(app: FastifyInstance): void {
  app.get('/v1/price', { preHandler: requireInside }, async (req) => {
    const currency = (req.query as Record<string, unknown> | null)?.currency;
    if (typeof currency !== 'string' || currencyExponent(currency) === null) throw new ApiError(400, 'bad-request');
    const q = req.server.deps.prices.quote(currency);
    if (!q) throw new ApiError(503, 'price-unavailable');
    return {
      currency,
      centsPerXmr: q.price.centsPerXmr.toString(),
      exponent: q.exponent,
      at: q.at.toISOString(),
      usdCentsPerXmr: q.usdCentsPerXmr.toString(),
    };
  });
}

/**
 * The owner's Price health data (spec 11.6): each XMR price source and exchange-rate source with its
 * last good fetch, failures in a row and whether it is in use, the rates the sanity guard refused,
 * the currencies whose market prices are paused, the route pricing each currency (`coverage`),
 * and the owner's settings. Served by the staff API
 * only (`GET /staff/v1/price-health`): the owner is refused on the trader site (owner Q13, 6 Nov).
 */
export function priceHealthBody(prices: Deps['prices']) {
  const h = prices.health();
  const iso = (d: Date | null) => d?.toISOString() ?? null;
  return {
    xmr: h.xmr.map((s) => ({ name: s.name, lastGoodAt: iso(s.lastGoodAt), consecutiveFailures: s.consecutiveFailures, inUse: s.inUse })),
    fx: h.fx.sources.map((s) => ({
      name: s.name, rank: s.rank, lastGoodAt: iso(s.lastGoodAt), consecutiveFailures: s.consecutiveFailures, stale: s.stale,
      inUse: s.usedFor.length > 0, usedFor: s.usedFor,
    })),
    rejected: h.fx.rejected.map((r) => ({ source: r.source, currency: r.currency, at: r.at.toISOString() })),
    paused: h.paused,
    // Per currency, the route pricing it now (null: no price); 2026-11-02 several price feeds.
    coverage: Object.fromEntries(h.coverage.map((c) => [c.currency, c.route])),
    settings: { staleAfterMinutes: h.fx.settings.staleAfterMs / 60_000, sanityPercent: h.fx.settings.sanityBps / 100 },
  };
}
