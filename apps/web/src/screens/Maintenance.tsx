import type { SiteInfo } from '../api/site.js';
import { Button } from '../ui/Button.js';
import { Notice } from '../ui/Notice.js';
import './screens.css';

/**
 * Plan 4 Task 8: while the site is in maintenance this replaces the whole app with the owner's
 * message. Trade timers are paused meanwhile (Plan 3 `maintenance_since`, A7), so nobody runs out
 * of time while X2F is down. Without a message from the owner, the kind's default text shows.
 */
// COPY-UNSIGNED: no board; the emergency line follows the owner's Q15 words (2026-10-28).
export const MAINTENANCE_COPY = {
  title: 'X2F is down for maintenance',
  planned: "We're doing planned maintenance. We'll be back soon.",
  emergency: "Unscheduled but necessary maintenance. We'll be back as soon as possible.",
  timers: "Your trade timers are paused until we're back, so no time runs out meanwhile.",
  retry: 'Check again',
} as const;

export function Maintenance({ maintenance, onRetry }: { maintenance: NonNullable<SiteInfo['maintenance']>; onRetry: () => void }) {
  return (
    <main className="x2f-screen" data-screen="maintenance">
      <h1 className="x2f-screen__title">{MAINTENANCE_COPY.title}</h1>
      <Notice tone="caution" live="off" data-part="maintenance-message">
        {maintenance.message ?? MAINTENANCE_COPY[maintenance.kind]}
      </Notice>
      <p className="x2f-sheet__body">{MAINTENANCE_COPY.timers}</p>
      <Button variant="primary" onClick={onRetry}>
        {MAINTENANCE_COPY.retry}
      </Button>
    </main>
  );
}
