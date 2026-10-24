import type { FastifyInstance } from 'fastify';
import { ApiError } from '../errors.js';
import { currencyExponent } from './currencies.js';

/**
 * `GET /v1/price?currency=USD` (no session, P3-M9) → `{ currency, centsPerXmr, exponent, at }`:
 * the feed's median in the currency's minor units, with its ISO 4217 exponent (Revision
 * 2026-10-20) and the time of its oldest quote; 503 `price-unavailable` when the feed has no
 * fresh, agreed price (Review Focus 5). An unknown currency is 400.
 */
export function priceRoutes(app: FastifyInstance): void {
  app.get('/v1/price', async (req) => {
    const currency = (req.query as Record<string, unknown> | null)?.currency;
    if (typeof currency !== 'string' || currencyExponent(currency) === null) throw new ApiError(400, 'bad-request');
    const q = req.server.deps.prices.quote(currency);
    if (!q) throw new ApiError(503, 'price-unavailable');
    return { currency, centsPerXmr: q.price.centsPerXmr.toString(), exponent: q.exponent, at: q.at.toISOString() };
  });
}
