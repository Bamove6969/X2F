import type { Queryable } from '../db/pool.js';
import { getSettings } from '../staff/settings.js';
import { SETTINGS_DEFAULTS } from '../staff/settingsDefaults.js';

/**
 * The owner's settings a dispute reads (Plan 4 Task 8's `settings` row): the large-trade limit
 * (snapshotted when a dispute opens), the first-reply time and the appeal window (owner
 * 2026-10-29c: 48 hours), and the auto-assign timer (owner 26 Nov 2026, "Pool first, auto-assign if
 * untaken": minutes in the pool before the timer assigns, and whether it runs; migration 910).
 */
export interface DisputeSettingValues {
  largeTradeLimitUsd: number;
  firstResponseH: number;
  appealWindowH: number;
  autoAssignMin: number;
  autoAssignOn: boolean;
}

/** Task 8's defaults. */
export const DISPUTE_DEFAULTS: Readonly<DisputeSettingValues> = Object.freeze({
  largeTradeLimitUsd: SETTINGS_DEFAULTS.largeTradeLimitUsd,
  firstResponseH: SETTINGS_DEFAULTS.firstResponseH,
  appealWindowH: SETTINGS_DEFAULTS.appealWindowH,
  autoAssignMin: SETTINGS_DEFAULTS.autoAssignMin,
  autoAssignOn: SETTINGS_DEFAULTS.autoAssignOn,
});

/** The settings as they are now (Task 8 `getSettings`, on the caller's client inside a transaction). */
export async function disputeSettings(q: Queryable): Promise<DisputeSettingValues> {
  const s = await getSettings(q);
  return {
    largeTradeLimitUsd: s.largeTradeLimitUsd, firstResponseH: s.firstResponseH, appealWindowH: s.appealWindowH,
    autoAssignMin: s.autoAssignMin, autoAssignOn: s.autoAssignOn,
  };
}
