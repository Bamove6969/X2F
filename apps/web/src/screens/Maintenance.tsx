import type { SiteInfo } from '../api/site.js';
import { Button } from '../ui/Button.js';
import { Notice } from '../ui/Notice.js';
import { StatusChip } from '../ui/StatusChip.js';
import './screens.css';

/**
 * Plan 4 Task 8, toward the Maintenance board (design review 7 Nov): a chip for the kind, the
 * headline, the owner's message signed "From the X2F team" and "Check again" as the one primary.
 * While the site is in maintenance this replaces the whole app: the trader API answers every route
 * with 503 `maintenance`. Trade timers are NOT paused yet (lead review 7 Nov: nothing sends pause or
 * resume; the timer loop is on held work), so the screen promises nothing about them: OWNER-Q.
 * Not built, and why (lead):
 * - the board's "What still works: trades already in escrow" is not true as built (the API refuses
 *   every trade action in maintenance): OWNER-Q, design recommends yes;
 * - the start and end block and the message's date: `GET /v1/site` sends no times;
 * - the "Get updates" rows: no board text in the repo.
 */
// COPY-UNSIGNED: the emergency line follows the owner's Q15 words (2026-10-28).
export const MAINTENANCE_COPY = {
  title: 'X2F is down for maintenance',
  // Owner G19 (7 Nov): an emergency is known only internally; traders read "Unplanned". COPY-UNSIGNED.
  chip: { planned: 'Planned maintenance', emergency: 'Unplanned maintenance' },
  planned: "We're doing planned maintenance. We'll be back soon.",
  emergency: "Unscheduled but necessary maintenance. We'll be back as soon as possible.",
  from: 'From the X2F team',
  retry: 'Check again',
} as const;

export function Maintenance({ maintenance, onRetry }: { maintenance: NonNullable<SiteInfo['maintenance']>; onRetry: () => void }) {
  return (
    <main className="x2f-screen" data-screen="maintenance">
      <StatusChip tone="caution" icon="clock" label={MAINTENANCE_COPY.chip[maintenance.kind]} />
      <h1 className="x2f-screen__title">{MAINTENANCE_COPY.title}</h1>
      <Notice tone="caution" live="off" data-part="maintenance-message">
        {maintenance.message ?? MAINTENANCE_COPY[maintenance.kind]}
      </Notice>
      <p className="x2f-meta" data-part="maintenance-from">{MAINTENANCE_COPY.from}</p>
      <Button variant="primary" onClick={onRetry}>
        {MAINTENANCE_COPY.retry}
      </Button>
    </main>
  );
}
