import type { SiteInfo } from '../api/site.js';
import { Button } from '../ui/Button.js';
import { formatDateTime as utcDateTime } from '../ui/dates.js';
import { Icon } from '../ui/icons.js';
import { StatusChip } from '../ui/StatusChip.js';
import '../ui/big-banner.css';
import './screens.css';

/**
 * Plan 4 Task 8, toward the Maintenance board (design review 7 Nov): a chip for the kind, the
 * headline, the owner's message signed "From the X2F team" and "Check again" as the one primary.
 * While the site is in maintenance this replaces the whole app: the trader API answers every route
 * with 503 `maintenance`.
 *
 * J-04 (owner G19, 7 Nov): the kind is planned or unplanned, never "emergency" (known only
 * internally). Unplanned gives "the minimal but needed information and our best guess as to when
 * we hope to have it back up": the message and, if staff gave one, when it should be back. Planned
 * shows the plan's end. The message (up to 500 characters) is in the big bright banner.
 * Trade and dispute timers freeze during maintenance (G19, G62; trades/timers.ts,
 * disputes/timers.ts), but the screen says nothing about them: that line is the owner's wording
 * to give (OWNER-Q in J-04's report).
 * Not built, and why (lead):
 * - the board's "What still works: trades already in escrow" is not true as built (the API refuses
 *   every trade action in maintenance): OWNER-Q, design recommends yes;
 * - the "Get updates" rows: no board text in the repo.
 */
// COPY-UNSIGNED: the unplanned line follows the owner's Q15 words (2026-10-28). DESIGN: wording.
export const MAINTENANCE_COPY = {
  title: 'X2F is down for maintenance',
  // Owner G19 (7 Nov): an emergency is known only internally; traders read "Unplanned".
  chip: { planned: 'Planned maintenance', unplanned: 'Unplanned maintenance' },
  planned: "We're doing planned maintenance. We'll be back soon.",
  unplanned: "Unscheduled but necessary maintenance. We'll be back as soon as possible.",
  backBy: { planned: 'Back by', unplanned: 'Our best guess: back by' },
  from: 'From the X2F team',
  retry: 'Check again',
} as const;

export function Maintenance({ maintenance, onRetry }: { maintenance: NonNullable<SiteInfo['maintenance']>; onRetry: () => void }) {
  const { kind, backBy } = maintenance;
  return (
    <main className="x2f-screen" data-screen="maintenance">
      <StatusChip tone="caution" icon="clock" label={MAINTENANCE_COPY.chip[kind]} />
      <h1 className="x2f-screen__title">{MAINTENANCE_COPY.title}</h1>
      <div className="x2f-big-banner" data-part="maintenance-banner" data-size="big" role="status">
        <span className="x2f-big-banner__icon">
          <Icon name="clock" size={22} stroke={2} />
        </span>
        <div className="x2f-big-banner__text">
          <p data-part="maintenance-message">{maintenance.message ?? MAINTENANCE_COPY[kind]}</p>
          {backBy !== null ? <p data-part="maintenance-back-by">{`${MAINTENANCE_COPY.backBy[kind]} ${utcDateTime(new Date(backBy))}`}</p> : null}
        </div>
      </div>
      <p className="x2f-meta" data-part="maintenance-from">{MAINTENANCE_COPY.from}</p>
      <Button variant="primary" onClick={onRetry}>
        {MAINTENANCE_COPY.retry}
      </Button>
    </main>
  );
}
