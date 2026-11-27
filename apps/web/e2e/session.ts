// The session probe the specs share. Every screen behind the front door (owner, 8 Nov 2026;
// src/session/frontDoor.tsx) opens only for a full session of a trader account on the current
// Terms, so a spec that opens one answers `GET /v1/account/me` with at least these fields.
import type { Locator, Page, Route } from '@playwright/test';

/** The fields the front door reads: a trader, a full session, the current Terms. */
export const INSIDE = { kind: 'trader', level: 'full', termsCurrent: true } as const;

/** A signed-in, set-up trader as `GET /v1/account/me` answers (the fields the screens read). */
export const SIGNED_IN_ME = {
  tradeTag: 'viewer_1',
  needsLoginName: false,
  ...INSIDE,
  holdUntil: null,
  methods: ['pgp'],
  hasBackup: true,
  suggestions: [],
  logoutTimer: { idleHours: 12, adjustable: true },
  member: null,
};

/** Answers the session probe with a signed-in, set-up trader (fields in `me` win). */
export async function signedIn(page: Page, me: Record<string, unknown> = {}): Promise<void> {
  await page.route('**/v1/account/me', (r: Route) => r.fulfill({ json: { ...SIGNED_IN_ME, ...me } }));
}

/** Answers the session probe as the API does with no session. */
export async function signedOut(page: Page): Promise<void> {
  await page.route('**/v1/account/me', (r: Route) => r.fulfill({ status: 401, json: { error: 'not-authenticated' } }));
}

/**
 * The screen's own status message. Sync-first (C-021 review S2) keeps an empty `role="status"`
 * live region (`data-part="sync-live"`) on every gated page from the start, so a bare
 * `getByRole('status')` finds two; this is the screen's one.
 */
export function screenStatus(page: Page): Locator {
  return page.getByRole('status').and(page.locator(':not([data-part="sync-live"])'));
}
