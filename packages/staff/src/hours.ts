/**
 * Staff login hours (spec 6.6). A window is local wall-clock time in an IANA time zone, so it
 * follows daylight-saving changes; an overnight window (start after end) belongs to the day it
 * starts on. Outside their hours staff cannot log in, and an open session (and a running shift,
 * Task 33, as `abandoned`) ends at `windowEndsAt`.
 */
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export type LoginHours = 'any' | { days: Weekday[]; start: string /* HH:MM */; end: string; tz: string };

export class HoursError extends Error {
  constructor(readonly code: 'hours-invalid') {
    super(code);
    this.name = 'HoursError';
  }
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const KEYS = ['days', 'end', 'start', 'tz'];

let zones: ReadonlySet<string> | null = null;
function knownZone(tz: string): boolean {
  if (tz === 'UTC') return true;
  zones ??= new Set(Intl.supportedValuesOf('timeZone'));
  return zones.has(tz);
}

/** Checks untrusted input and returns a fresh copy; throws `HoursError('hours-invalid')`. */
export function validateHours(h: unknown): LoginHours {
  if (h === 'any') return 'any';
  const bad = () => new HoursError('hours-invalid');
  if (typeof h !== 'object' || h === null || Array.isArray(h)) throw bad();
  const o = h as Record<string, unknown>;
  if (Object.keys(o).sort().join(',') !== KEYS.join(',')) throw bad();
  const { days, start, end, tz } = o;
  if (!Array.isArray(days) || days.length === 0 || days.length > 7) throw bad();
  if (!days.every((d) => typeof d === 'string' && (WEEKDAYS as readonly string[]).includes(d))) throw bad();
  if (new Set(days).size !== days.length) throw bad();
  if (typeof start !== 'string' || typeof end !== 'string' || !HHMM.test(start) || !HHMM.test(end)) throw bad();
  if (start === end) throw bad();
  if (typeof tz !== 'string' || !knownZone(tz)) throw bad();
  return { days: [...(days as Weekday[])], start, end, tz };
}

/** Local wall-clock parts of an instant in a zone. */
interface Local {
  y: number;
  mo: number;
  d: number;
  min: number; // minutes since local midnight
  wd: number; // 0 = Sunday
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
      hourCycle: 'h23',
    });
    formatters.set(tz, f);
  }
  return f;
}

function local(tz: string, t: number): Local {
  const parts: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(t)) parts[p.type] = p.value;
  const wd = (WEEKDAYS as readonly string[]).indexOf(parts.weekday ?? '');
  return {
    y: Number(parts.year),
    mo: Number(parts.month),
    d: Number(parts.day),
    min: Number(parts.hour) * 60 + Number(parts.minute),
    wd,
  };
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const prevDay = (wd: number) => WEEKDAYS[(wd + 6) % 7]!;

export function inWindow(h: LoginHours, now: Date): boolean {
  if (h === 'any') return true;
  const t = now.getTime();
  if (!Number.isFinite(t)) return false;
  const l = local(h.tz, t);
  const start = toMin(h.start);
  const end = toMin(h.end);
  const today = h.days.includes(WEEKDAYS[l.wd]!);
  if (start < end) return today && l.min >= start && l.min < end;
  return (today && l.min >= start) || (h.days.includes(prevDay(l.wd)) && l.min < end);
}

/** A local date-time as a sortable number (minutes since the epoch, on a wall-clock calendar). */
const wallKey = (y: number, mo: number, d: number, min: number) => Date.UTC(y, mo - 1, d) / 60_000 + min;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * The first instant after `now` at which the local wall clock in `tz` reads `target` (a `wallKey`)
 * or later. Usually one offset guess hits it; in a fall-back overlap the earliest one after `now`
 * is taken (M1: in the repeated hour a window is open again and ends at the second pass of its end
 * time, never in the past); in a spring-forward gap (the time never happens) it steps by minute
 * from just before the gap.
 */
function firstInstantAfter(tz: string, target: number, now: number): number {
  const naive = target * MINUTE;
  const keyOf = (t: number) => {
    const l = local(tz, t);
    return wallKey(l.y, l.mo, l.d, l.min);
  };
  // UTC offset (ms) at an instant, ignoring seconds.
  const offsetAt = (t: number) => keyOf(t) * MINUTE - Math.floor(t / MINUTE) * MINUTE;
  const candidates = [naive - 36 * HOUR, naive, naive + 36 * HOUR].map((p) => naive - offsetAt(p));
  const hits = candidates.filter((c) => keyOf(c) === target && c > now);
  if (hits.length > 0) return Math.min(...hits);
  // A gap: start a few hours before the earliest candidate and step to the first minute past it.
  let t = Math.min(...candidates) - 3 * HOUR;
  for (let i = 0; i < 12 * 60; i++, t += MINUTE) if (keyOf(t) >= target) return t;
  throw new Error('windowEndsAt: no instant found');
}

/**
 * The instant the window that `now` is in ends, or null for `'any'`. Outside the window it has
 * already ended, so `now` is returned (a caller ending a session at this time ends it at once).
 */
export function windowEndsAt(h: LoginHours, now: Date): Date | null {
  if (h === 'any') return null;
  if (!inWindow(h, now)) return new Date(now.getTime());
  const l = local(h.tz, now.getTime());
  const start = toMin(h.start);
  const end = toMin(h.end);
  // An overnight window entered today (t ≥ start) ends tomorrow; otherwise it ends today.
  const addDays = start > end && l.min >= start ? 1 : 0;
  const day = new Date(Date.UTC(l.y, l.mo - 1, l.d + addDays));
  const target = wallKey(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), end);
  return new Date(firstInstantAfter(h.tz, target, now.getTime()));
}
