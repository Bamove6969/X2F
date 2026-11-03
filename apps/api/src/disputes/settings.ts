import type { Queryable } from '../db/pool.js';

/**
 * The owner's settings a dispute reads (Plan 4 Task 8's `settings` table): the large-trade limit
 * (snapshotted when a dispute opens), the first-reply time and the appeal window (owner
 * 2026-10-29c: 48 hours).
 */
export interface DisputeSettingValues {
  largeTradeLimitUsd: number;
  firstResponseH: number;
  appealWindowH: number;
}

/** Task 8's defaults (its `settings` columns' defaults). */
export const DISPUTE_DEFAULTS: Readonly<DisputeSettingValues> = Object.freeze({
  largeTradeLimitUsd: 1000,
  firstResponseH: 4,
  appealWindowH: 48,
});

/**
 * The settings as they are now. SEAM: Task 8 (`apps/api/src/staff/settings.ts` `getSettings`) is
 * built in parallel; until it lands this answers the plan's defaults. When it lands, read
 * `getSettings(q)` here (tripwire NEEDS_TASK_8_SETTINGS in test/disputes/trader.test.ts).
 */
export async function disputeSettings(_q: Queryable): Promise<DisputeSettingValues> {
  return { ...DISPUTE_DEFAULTS };
}
