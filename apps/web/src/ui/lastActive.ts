/**
 * "Last active 25 min ago", "Last active 2 h ago", "Last active 3 days ago" (LoginApprove and
 * Devices boards), from a session's `lastSeenAt`. Under a minute reads "Active now".
 */
export function lastActive(iso: string, now: number = Date.now()): string {
  const min = Math.floor((now - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(min) || min < 1) return 'Active now';
  if (min < 60) return `Last active ${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `Last active ${h} h ago`;
  const d = Math.floor(h / 24);
  return `Last active ${d} days ago`;
}

/** A date and time in the conventions' form: "29 Oct 2026, 14:05 UTC". */
export function utcWhen(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
  return `${date}, ${time} UTC`;
}
