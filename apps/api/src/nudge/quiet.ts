/** Quiet hours (spec 2.4), always in the recipient's own time zone. */

export interface QuietHours {
  /** Minutes after local midnight; null for no quiet hours. */
  quietFrom: number | null;
  quietTo: number | null;
  /** IANA time zone, e.g. "Europe/Berlin". */
  tz: string | null;
}

export const TZ_MAX = 64;

/**
 * The zones accepted and stored: the runtime's canonical IANA list plus "UTC" (which ICU resolves
 * "utc", "Etc/UTC" and "GMT" to but leaves out of the list).
 */
const SUPPORTED: ReadonlySet<string> = new Set([...Intl.supportedValuesOf('timeZone'), 'UTC']);

/**
 * The canonical name for a time zone, or null when it is not one this runtime supports. Case and
 * alias variants collapse ("asia/tokyo" → "Asia/Tokyo", "US/Eastern" → "America/New_York").
 */
export function canonicalTimeZone(tz: unknown): string | null {
  if (typeof tz !== 'string' || tz.length < 1 || tz.length > TZ_MAX) return null;
  let canonical: string;
  try {
    canonical = new Intl.DateTimeFormat('en-US', { timeZone: tz }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
  return SUPPORTED.has(canonical) ? canonical : null;
}

/** Keyed by canonical name only, so it can never hold more entries than there are zones. */
const formatters = new Map<string, Intl.DateTimeFormat>();
export const FORMATTER_CAP = SUPPORTED.size;

/** For tests: how many formatters are cached. */
export const formatterCacheSize = (): number => formatters.size;

function formatter(tz: string): Intl.DateTimeFormat {
  const hit = formatters.get(tz);
  if (hit) return hit;
  const canonical = canonicalTimeZone(tz);
  if (canonical === null) throw new RangeError('unsupported time zone');
  let f = formatters.get(canonical);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: canonical, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    if (formatters.size < FORMATTER_CAP) formatters.set(canonical, f);
  }
  return f;
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
