/**
 * The owner's settings (Plan 4 Task 8, migration 206) and their defaults, as a leaf module with no
 * imports: `staff/settings.ts` (the routes and `getSettings`) and `disputes/settings.ts` (what a
 * dispute reads) both import it. Hold model v3 made `auth/hold.ts` reach `trades/store.ts`, and
 * through `disputes/store.ts` `disputes/settings.ts`, so when `staff/settings.ts` is the first
 * module loaded the defaults it declared were still uninitialised where `disputes/settings.ts` read
 * them (an ESM import cycle; `test/staff/settings.test.ts` loads in that order). A leaf module ends
 * the cycle; nothing else changes.
 */
export interface Settings {
  /** At or above this USD value a ruling needs two people (Global Constraints). Disputes snapshot it at opening (Task 10). */
  largeTradeLimitUsd: number;
  /** Hours a moderator has for the first reply in a dispute. */
  firstResponseH: number;
  /** Hours after a ruling in which either side may appeal (48, owner 2026-10-29c). */
  appealWindowH: number;
  /** The moderator contact (Matrix preferred, Telegram allowed; Revision 2026-10-29); null = not set. */
  moderatorContactUrl: string | null;
  /** The community links (Task 29); null = not set. */
  communityMatrixUrl: string | null;
  communityTelegramUrl: string | null;
  /**
   * Owner decision (Jess, 26 Nov 2026), "Pool first, auto-assign if untaken": minutes a dispute may
   * wait in the pool untaken before the timer gives it to the least-busy moderator on shift (lead
   * default 15; 1..1440), and whether that runs at all (lead default on). Migration 910.
   */
  autoAssignMin: number;
  autoAssignOn: boolean;
}

export const SETTINGS_DEFAULTS: Readonly<Settings> = {
  largeTradeLimitUsd: 1000,
  firstResponseH: 4,
  appealWindowH: 48,
  moderatorContactUrl: null,
  communityMatrixUrl: null,
  communityTelegramUrl: null,
  autoAssignMin: 15,
  autoAssignOn: true,
};
