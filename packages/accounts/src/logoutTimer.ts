/**
 * The logout timer (owner, 2026-10-23): how long a trader stays logged in while inactive, chosen
 * in Settings. Staff and owner accounts stay fixed at 2 hours and cannot choose.
 */
export const IDLE_HOURS = [2, 4, 6, 8, 10, 12] as const;
export type IdleHours = (typeof IDLE_HOURS)[number];
export const DEFAULT_IDLE_HOURS: IdleHours = 12;

/** True only for one of the allowed choices (a whole number, not a string). */
export function isIdleHours(v: unknown): v is IdleHours {
  return typeof v === 'number' && (IDLE_HOURS as readonly number[]).includes(v);
}
