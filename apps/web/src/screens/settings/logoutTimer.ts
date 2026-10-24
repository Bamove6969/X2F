/**
 * The inactivity logout timer (Task 30, spec §6.3, owner 2026-10-23): a trader chooses how long
 * they stay logged in while idle — 2, 4, 6, 8, 10 or 12 hours, default 12. (Staff and the owner are
 * fixed at 2 hours server-side; that is not set here.)
 *
 * The typed `@x2f/auth-client` does not carry the logout timer yet (it lands with the new login
 * rules on the lead's follow-up branches). Until then the value is saved through the raw client to
 * the route the spec implies; `task30-tripwires.test.ts` fails the moment `AccountOverview` or the
 * typed client gains logout-timer support, which is the signal to move this onto the typed client.
 */
import { api } from '../../api/client.js';

export const LOGOUT_TIMER_HOURS = [2, 4, 6, 8, 10, 12] as const;
export type LogoutTimerHours = (typeof LOGOUT_TIMER_HOURS)[number];
export const DEFAULT_LOGOUT_TIMER: LogoutTimerHours = 12;

export function isLogoutTimerHours(n: number): n is LogoutTimerHours {
  return (LOGOUT_TIMER_HOURS as readonly number[]).includes(n);
}

/** Saves the chosen idle timeout. Resolves on success; rejects (like any API call) otherwise. */
export function saveLogoutTimer(hours: LogoutTimerHours): Promise<unknown> {
  return api('/v1/account/security/logout-timer', { method: 'PUT', body: { hours } });
}
