import type { FastifyInstance } from 'fastify';

/**
 * Plan 7 Task 4 (review I2): `GET /v1/privacy` → `{ tradePurge }`, whether the whole-trade purge
 * (X2F_TRADE_PURGE, config.tradePurge) is on. No session needed: Settings → Privacy works logged
 * out and states the self-destruct rule only while it is actually running.
 */
export function privacyRoutes(app: FastifyInstance): void {
  app.get('/v1/privacy', async (req) => ({ tradePurge: req.server.deps.config.tradePurge === true }));
}
