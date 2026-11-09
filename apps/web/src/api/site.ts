import { useCallback, useEffect, useState } from 'react';
import { api, setMaintenanceListener } from './client.js';

/**
 * Plan 4 Task 8: `GET /v1/site` (no session), the banner, the trading stop, maintenance and an announced plan as
 * every visitor sees them. Only well-formed parts are kept; anything else reads as "off".
 */
export interface SiteBannerInfo {
  text: string;
  kind: 'info' | 'warning';
}
/**
 * Owner G19 (7 Nov): maintenance is planned or unplanned; "emergency" is known only internally and
 * never reaches a trader.
 */
export type MaintenanceKind = 'planned' | 'unplanned';
export interface SiteMaintenance {
  message: string | null;
  kind: MaintenanceKind;
  /** ISO times: when it began, and when it should be back (unplanned: the best guess; planned: the plan's end). */
  since: string | null;
  backBy: string | null;
}
/** A planned maintenance announced ahead (owner G19: "try and give 24-hour notice"), ISO times. */
export interface PlannedMaintenanceInfo {
  startsAt: string;
  endsAt: string;
  message: string | null;
}
export interface SiteInfo {
  banner: SiteBannerInfo | null;
  tradingPaused: boolean;
  maintenance: SiteMaintenance | null;
  plannedMaintenance: PlannedMaintenanceInfo | null;
}

export const SITE_OFF: SiteInfo = { banner: null, tradingPaused: false, maintenance: null, plannedMaintenance: null };
/** How often the shell re-reads the site state (and, during maintenance, checks whether it is over). */
export const SITE_POLL_MS = 60_000;

const rec = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const isoTime = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);

export function parseSite(raw: unknown): SiteInfo {
  const r = rec(raw) ?? {};
  const b = rec(r.banner);
  const m = rec(r.maintenance);
  const p = rec(r.plannedMaintenance);
  const startsAt = p ? isoTime(p.startsAt) : null;
  const endsAt = p ? isoTime(p.endsAt) : null;
  return {
    banner: b && typeof b.text === 'string' && b.text !== '' && (b.kind === 'info' || b.kind === 'warning') ? { text: b.text, kind: b.kind } : null,
    tradingPaused: r.tradingPaused === true,
    // An unknown or missing kind is unplanned: nobody announced it (owner G19: never "emergency").
    maintenance: m ? { message: text(m.message), kind: m.kind === 'planned' ? 'planned' : 'unplanned', since: isoTime(m.since), backBy: isoTime(m.backBy) } : null,
    plannedMaintenance: p && startsAt !== null && endsAt !== null ? { startsAt, endsAt, message: text(p.message) } : null,
  };
}

export async function fetchSite(signal?: AbortSignal): Promise<SiteInfo> {
  return parseSite(await api<unknown>('/v1/site', signal ? { signal } : {}));
}

/**
 * The site state for the app shell: read at start, every `SITE_POLL_MS`, and at once when any API
 * call answers 503 `maintenance`. A failed read keeps the last state (a network fault is not maintenance).
 */
export function useSite(): { site: SiteInfo; refresh: () => void } {
  const [site, setSite] = useState<SiteInfo>(SITE_OFF);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    const ctl = new AbortController();
    fetchSite(ctl.signal).then(setSite, () => undefined);
    return () => ctl.abort();
  }, [tick]);
  useEffect(() => {
    const id = setInterval(refresh, SITE_POLL_MS);
    setMaintenanceListener(refresh);
    return () => {
      clearInterval(id);
      setMaintenanceListener(null);
    };
  }, [refresh]);
  return { site, refresh };
}
