import { formatDate, formatDateTime, formatUtcTime, isMoment, type Moment } from './dates.js';
import './ui.css';

/**
 * A moment on screen: `<time>` in mono with the machine-readable value (design conventions,
 * "6 Nov 2026, 15:00 UTC"). `form` picks the date only or the time only (see dates.ts); the
 * default is both. Nothing for an unreadable value.
 */
export function When({ at, form = 'date-time' }: { at: Moment | null | undefined; form?: 'date-time' | 'date' | 'time' }) {
  if (!isMoment(at)) return null;
  const iso = new Date(at).toISOString();
  const text = form === 'date' ? formatDate(at) : form === 'time' ? formatUtcTime(at) : formatDateTime(at);
  return (
    <time className="x2f-when" dateTime={iso}>
      {text}
    </time>
  );
}
