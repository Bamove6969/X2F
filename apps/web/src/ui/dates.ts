/**
 * The one way the app writes a moment (design conventions, 2 Nov 2026: "6 Nov 2026, 15:00 UTC",
 * in mono). Always UTC and always with the year, whatever the viewer's locale or time zone, so a
 * date reads the same on every device and in every screenshot. A plain module (no React, no CSS):
 * `When` (ui/When.tsx) puts it in a mono `<time>`.
 *
 * - formatDateTime: "6 Nov 2026, 15:00 UTC", the default for any moment;
 * - formatDate: "6 Nov 2026", for a day with no time (Blocked "Blocked 29 Oct 2026");
 * - formatUtcTime: "15:00 UTC", only under a heading that already names the day (the Refunded
 *   board's "What happened" card).
 *
 * An unreadable value gives "" (never "NaN" or "Invalid Date"); callers that may get one check
 * `isMoment` first.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export type Moment = Date | string | number;

const toDate = (at: Moment): Date | null => {
  const d = at instanceof Date ? at : new Date(at);
  return Number.isFinite(d.getTime()) ? d : null;
};

const pad = (n: number): string => String(n).padStart(2, '0');

/** Whether `at` is a readable moment. */
export function isMoment(at: Moment | null | undefined): at is Moment {
  return at !== null && at !== undefined && toDate(at) !== null;
}

/** "6 Nov 2026". */
export function formatDate(at: Moment): string {
  const d = toDate(at);
  return d === null ? '' : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "15:00 UTC" (24-hour clock). */
export function formatUtcTime(at: Moment): string {
  const d = toDate(at);
  return d === null ? '' : `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/** "6 Nov 2026, 15:00 UTC". */
export function formatDateTime(at: Moment): string {
  const d = toDate(at);
  return d === null ? '' : `${formatDate(d)}, ${formatUtcTime(d)}`;
}
