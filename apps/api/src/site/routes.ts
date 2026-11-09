import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';

/**
 * The two kinds of maintenance (owner G19, 7 Nov: "Maintenance notices do not default to emergency
 * ... that is only known internally"): planned, announced ahead, and unplanned. Migration 350.
 */
export const MAINTENANCE_KINDS = ['planned', 'unplanned'] as const;
export type MaintenanceKind = (typeof MAINTENANCE_KINDS)[number];

/** A planned maintenance announced ahead (owner G19: "we will plan it and try and give 24-hour notice"). */
export interface PlannedMaintenance {
  startsAt: string;
  endsAt: string;
  message: string | null;
}

/** Plan 4 Task 8: the site controls as stored in Plan 3's one-row `site_flags` (migrations 206, 350). */
export interface SiteState {
  tradingPaused: boolean;
  stoppedAt: string | null;
  banner: { text: string; kind: 'info' | 'warning' } | null;
  /** `backBy`: when it should be back (unplanned: the best guess, optional; planned: the plan's end). */
  maintenance: { since: string; message: string | null; kind: MaintenanceKind; backBy: string | null } | null;
  /** The announced plan, kept until it is switched on or removed (the staff view shows it even after its end). */
  planned: PlannedMaintenance | null;
}

/** What every visitor sees (`GET /v1/site`, no session). */
export interface PublicSite {
  banner: { text: string; kind: 'info' | 'warning' } | null;
  tradingPaused: boolean;
  maintenance: { message: string | null; kind: MaintenanceKind; since: string; backBy: string | null } | null;
  /** The announced plan while its end is still ahead. */
  plannedMaintenance: PlannedMaintenance | null;
}

interface FlagsRow {
  trading_paused: boolean;
  stopped_at: Date | null;
  banner_text: string | null;
  banner_kind: 'info' | 'warning' | null;
  maintenance_since: Date | null;
  maintenance_message: string | null;
  maintenance_kind: MaintenanceKind | null;
  maintenance_back_by: Date | null;
  planned_start: Date | null;
  planned_end: Date | null;
  planned_message: string | null;
}

export async function readSiteState(db: Queryable): Promise<SiteState> {
  const { rows } = await db.query<FlagsRow>(
    `select trading_paused, stopped_at, banner_text, banner_kind, maintenance_since, maintenance_message, maintenance_kind,
            maintenance_back_by, planned_start, planned_end, planned_message
       from site_flags`,
  );
  const r = rows[0];
  if (!r) return { tradingPaused: false, stoppedAt: null, banner: null, maintenance: null, planned: null };
  return {
    tradingPaused: r.trading_paused,
    stoppedAt: r.stopped_at?.toISOString() ?? null,
    banner: r.banner_text !== null && r.banner_kind !== null ? { text: r.banner_text, kind: r.banner_kind } : null,
    // Migration 350 makes the kind required while maintenance is on: there is no default kind.
    maintenance:
      r.maintenance_since !== null && r.maintenance_kind !== null
        ? { since: r.maintenance_since.toISOString(), message: r.maintenance_message, kind: r.maintenance_kind, backBy: r.maintenance_back_by?.toISOString() ?? null }
        : null,
    planned:
      r.planned_start !== null && r.planned_end !== null
        ? { startsAt: r.planned_start.toISOString(), endsAt: r.planned_end.toISOString(), message: r.planned_message }
        : null,
  };
}

export function publicSite(s: SiteState, now: Date): PublicSite {
  return {
    banner: s.banner,
    tradingPaused: s.tradingPaused,
    maintenance: s.maintenance ? { message: s.maintenance.message, kind: s.maintenance.kind, since: s.maintenance.since, backBy: s.maintenance.backBy } : null,
    plannedMaintenance: s.planned !== null && Date.parse(s.planned.endsAt) > now.getTime() ? s.planned : null,
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

/** `GET /v1/site` (no session): `{ banner, tradingPaused, maintenance, plannedMaintenance }`. Never cached. */
export function siteRoutes(app: FastifyInstance): void {
  app.get('/v1/site', async () => publicSite(await readSiteState(app.deps.db), app.deps.clock()));
}
