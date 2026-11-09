import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';

/** Plan 4 Task 8: the site controls as stored in Plan 3's one-row `site_flags` (migration 206). */
export interface SiteState {
  tradingPaused: boolean;
  stoppedAt: string | null;
  banner: { text: string; kind: 'info' | 'warning' } | null;
  maintenance: { since: string; message: string | null; kind: 'planned' | 'emergency' } | null;
}

/** What every visitor sees (`GET /v1/site`, no session). */
export interface PublicSite {
  banner: { text: string; kind: 'info' | 'warning' } | null;
  tradingPaused: boolean;
  maintenance: { message: string | null; kind: 'planned' | 'emergency' } | null;
}

interface FlagsRow {
  trading_paused: boolean;
  stopped_at: Date | null;
  banner_text: string | null;
  banner_kind: 'info' | 'warning' | null;
  maintenance_since: Date | null;
  maintenance_message: string | null;
  maintenance_kind: 'planned' | 'emergency' | null;
}

export async function readSiteState(db: Queryable): Promise<SiteState> {
  const { rows } = await db.query<FlagsRow>(
    `select trading_paused, stopped_at, banner_text, banner_kind, maintenance_since, maintenance_message, maintenance_kind from site_flags`,
  );
  const r = rows[0];
  if (!r) return { tradingPaused: false, stoppedAt: null, banner: null, maintenance: null };
  return {
    tradingPaused: r.trading_paused,
    stoppedAt: r.stopped_at?.toISOString() ?? null,
    banner: r.banner_text !== null && r.banner_kind !== null ? { text: r.banner_text, kind: r.banner_kind } : null,
    maintenance:
      r.maintenance_since !== null
        ? { since: r.maintenance_since.toISOString(), message: r.maintenance_message, kind: r.maintenance_kind ?? 'emergency' }
        : null,
  };
}

export function publicSite(s: SiteState): PublicSite {
  return {
    banner: s.banner,
    tradingPaused: s.tradingPaused,
    maintenance: s.maintenance ? { message: s.maintenance.message, kind: s.maintenance.kind } : null,
  };
}

/** The gate's one read (exported for tests that list a route's queries). */
export const MAINTENANCE_GATE_SQL = 'select maintenance_since is not null as on from site_flags';

/** The trader API routes that answer during maintenance: the site state itself (`/healthz` is not under `/v1/`). */
export const MAINTENANCE_OPEN = ['/v1/site'] as const;

/**
 * Plan 4 Task 8, the trader API's maintenance gate (an onRequest hook): while
 * `site_flags.maintenance_since` is set, every matched `/v1/*` route except `GET /v1/site` answers
 * 503 `maintenance`. It decides on the matched route pattern, so a percent-escaped path cannot slip
 * by; an unmatched path gets its 404 as usual. No `site_flags` row counts as no maintenance (the
 * row is inserted by migration 102 and never deleted). The relay, the node proxy and the staff API
 * are separate servers and are not gated.
 */
export async function maintenanceGate(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const route = req.routeOptions.url;
  if (route === undefined || !route.startsWith('/v1/') || (MAINTENANCE_OPEN as readonly string[]).includes(route)) return;
  const { rows } = await req.server.deps.db.query<{ on: boolean }>(MAINTENANCE_GATE_SQL);
  if (rows[0]?.on === true) throw new ApiError(503, 'maintenance');
}

/** `GET /v1/site` (no session): `{ banner, tradingPaused, maintenance }`. Never cached. */
export function siteRoutes(app: FastifyInstance): void {
  app.get('/v1/site', async () => publicSite(await readSiteState(app.deps.db)));
}
