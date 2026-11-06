import type { FastifyInstance } from 'fastify';
import { priceHealthBody } from '../price/routes.js';
import { requireStaff } from './guard.js';

/**
 * `GET /staff/v1/price-health` (stats.read: the owner) → the owner dashboard's Price health data
 * (`priceHealthBody`). It moved here from the trader API's `/v1/owner/price-health`: the owner uses
 * only the staff site (owner Q13, 6 Nov 2026).
 */
export function staffPriceHealthRoutes(app: FastifyInstance): void {
  app.get('/staff/v1/price-health', { config: { perm: 'stats.read' }, preHandler: requireStaff('stats.read') }, async (req) =>
    priceHealthBody(req.server.deps.prices),
  );
}
