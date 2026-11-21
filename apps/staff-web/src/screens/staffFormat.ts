import type { LoginHours, Weekday } from '@x2f/staff';

// How the owner pages (Plan 4 Task 17) word hours, dates, amounts and times, in the boards' forms
// (StaffList: "Mon–Fri, 09:00–17:00 UTC", "Every day, 18:00–23:00 UTC", "Any time", "Sep 2026",
// "12 min ago", "Yesterday", "Expires in 21 h"; StaffOverview: "4.82 XMR", "about $1,590 · 211
// trades", "01:20 UTC"). Forms the boards do not show ("Never", "Just now", "3 days ago", "Expires
// in 40 min", a list of separate days) are draft copy. COPY-UNSIGNED

/** The week as the boards draw it (StaffList's day pills): Monday first. */
export const WEEK: readonly Weekday[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** A run of three or more days in the board's week reads "Mon–Fri"; others are listed. */
function daysText(days: readonly Weekday[]): string {
  const idx = [...new Set(days)].map((d) => WEEK.indexOf(d)).sort((a, b) => a - b);
  if (idx.length === 7) return 'Every day';
  const run = idx.length > 2 && idx.every((v, i) => i === 0 || v === idx[i - 1]! + 1);
  if (run) return `${WEEK[idx[0]!]}–${WEEK[idx[idx.length - 1]!]}`;
  return idx.map((i) => WEEK[i]).join(', ');
}

/** A member's login hours as the StaffList table shows them. */
export function hoursText(h: LoginHours): string {
  if (h === 'any') return 'Any time';
  return `${daysText(h.days)}, ${h.start}–${h.end} ${h.tz}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Sep 2026" (UTC). */
export function monthYear(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "12 min ago", "2 h ago", "Yesterday", "3 days ago"; "Never" with no session yet. */
export function lastActiveText(iso: string | null, now: Date): string {
  if (iso === null) return 'Never';
  const ago = now.getTime() - Date.parse(iso);
  if (ago < MIN) return 'Just now';
  if (ago < HOUR) return `${Math.floor(ago / MIN)} min ago`;
  if (ago < DAY) return `${Math.floor(ago / HOUR)} h ago`;
  if (ago < 2 * DAY) return 'Yesterday';
  return `${Math.floor(ago / DAY)} days ago`;
}

/** An invite's "Expires in 21 h" ("Expires in 40 min" under an hour). */
export function expiresText(iso: string, now: Date): string {
  const left = Math.max(0, Date.parse(iso) - now.getTime());
  return left >= HOUR ? `Expires in ${Math.floor(left / HOUR)} h` : `Expires in ${Math.floor(left / MIN)} min`;
}

/** "01:20 UTC". */
export function utcClock(iso: string): string {
  return `${new Date(iso).toISOString().slice(11, 16)} UTC`;
}

/** "2026-11-01 03:04 UTC". */
export function utcMinuteText(iso: string): string {
  return `${new Date(iso).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

const ATOMIC = 1_000_000_000_000n;

/** XMR from atomic units, rounded down: two decimals at least, up to four when the amount is small ("4.82", "0.0123"). */
export function xmrText(atomic: string): string {
  const a = BigInt(atomic);
  const neg = a < 0n;
  const v = neg ? -a : a;
  const whole = v / ATOMIC;
  const frac = (v % ATOMIC).toString().padStart(12, '0');
  const places = whole > 0n ? 2 : 4;
  let f = frac.slice(0, places);
  while (f.length > 2 && f.endsWith('0')) f = f.slice(0, -1);
  return `${neg ? '-' : ''}${whole}.${f}`;
}

/** Whole dollars from cents, rounded down, with thousands separators ("$1,590"). */
export function usdText(cents: string): string {
  const d = BigInt(cents) / 100n;
  return `$${d.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}
