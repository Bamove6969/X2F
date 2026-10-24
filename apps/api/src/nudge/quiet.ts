/** Quiet hours (spec 2.4), always in the recipient's own time zone. */

export interface QuietHours {
  /** Minutes after local midnight; null for no quiet hours. */
  quietFrom: number | null;
  quietTo: number | null;
  /** IANA time zone, e.g. "Europe/Berlin". */
  tz: string | null;
}

export const TZ_MAX = 64;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    formatters.set(tz, f);
  }
  return f;
}

/** True for a time zone this runtime knows (only these are stored). */
export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length < 1 || tz.length > TZ_MAX) return false;
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** Minutes after midnight at `at` on the wall clock in `tz`. */
export function localMinutes(at: Date, tz: string): number {
  let hour = 0;
  let minute = 0;
  for (const p of formatter(tz).formatToParts(at)) {
    if (p.type === 'hour') hour = Number(p.value);
    else if (p.type === 'minute') minute = Number(p.value);
  }
  return hour * 60 + minute;
}

/**
 * Whether `at` falls in the window [quietFrom, quietTo) on the recipient's clock. A window whose
 * start is later than its end crosses midnight (22:00-06:00 is quiet from 22:00 to 05:59).
 */
export function inQuietHours(q: QuietHours, at: Date): boolean {
  if (q.quietFrom === null || q.quietTo === null || q.tz === null) return false;
  const t = localMinutes(at, q.tz);
  return q.quietFrom < q.quietTo ? t >= q.quietFrom && t < q.quietTo : t >= q.quietFrom || t < q.quietTo;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "HH:MM" (24-hour, two digits each) → minutes; null when malformed. */
export function parseClock(s: unknown): number | null {
  if (typeof s !== 'string') return null;
  const m = HHMM.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function formatClock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
