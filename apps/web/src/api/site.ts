import { useCallback, useEffect, useState } from 'react';
import { api, setMaintenanceListener } from './client.js';

/**
 * Plan 4 Task 8: `GET /v1/site`, the banner, the emergency stop and maintenance. It answers anyone,
 * but outside the front door (owner, 8 Nov 2026) only whether the site is in maintenance and its
 * kind: the banner and the trading pause come with a signed-in, set-up session (App.tsx reads it
 * again on login and logout). Only well-formed parts are kept; anything else reads as "off".
 */
export interface SiteBannerInfo {
  text: string;
  kind: 'info' | 'warning';
}
export interface SiteInfo {
  banner: SiteBannerInfo | null;
  tradingPaused: boolean;
  maintenance: { message: string | null; kind: 'planned' | 'emergency' } | null;
}

export const SITE_OFF: SiteInfo = { banner: null, tradingPaused: false, maintenance: null };
/** How often the shell re-reads the site state (and, during maintenance, checks whether it is over). */
export const SITE_POLL_MS = 60_000;

const rec = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export function parseSite(raw: unknown): SiteInfo {
  const r = rec(raw) ?? {};
  const b = rec(r.banner);
  const m = rec(r.maintenance);
  return {
    banner: b && typeof b.text === 'string' && b.text !== '' && (b.kind === 'info' || b.kind === 'warning') ? { text: b.text, kind: b.kind } : null,
    tradingPaused: r.tradingPaused === true,
    maintenance: m ? { message: typeof m.message === 'string' && m.message !== '' ? m.message : null, kind: m.kind === 'planned' ? 'planned' : 'emergency' } : null,
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
