import type { PlannedMaintenanceInfo } from '../api/site.js';
import { formatDateTime as utcDateTime } from './dates.js';
import { Icon } from './icons.js';
import './big-banner.css';

/**
 * J-04 (owner G19, 7 Nov: "for actual maintenance, we will plan it and try and give 24-hour
 * notice"): a planned maintenance announced ahead, at the top of every trader screen until its end
 * (`GET /v1/site` `plannedMaintenance`), in the big bright banner with its start, its end and the
 * owner's message (up to 500 characters).
 */
// COPY-UNSIGNED. DESIGN: wording (no board yet).
export const PLANNED_COPY = {
  title: 'Planned maintenance',
  from: 'From',
  to: 'to',
} as const;

export function PlannedMaintenanceBanner({ plan }: { plan: PlannedMaintenanceInfo | null }) {
  if (plan === null) return null;
  return (
    <div className="x2f-planned-banner">
      <div className="x2f-big-banner" data-part="planned-maintenance" data-size="big" role="status">
        <span className="x2f-big-banner__icon">
          <Icon name="clock" size={22} stroke={2} />
        </span>
        <div className="x2f-big-banner__text">
          <p className="x2f-big-banner__title">{PLANNED_COPY.title}</p>
          <p data-part="planned-when">
            {`${PLANNED_COPY.from} ${utcDateTime(new Date(plan.startsAt))} ${PLANNED_COPY.to} ${utcDateTime(new Date(plan.endsAt))}`}
          </p>
          {plan.message !== null ? <p data-part="planned-message">{plan.message}</p> : null}
        </div>
      </div>
    </div>
  );
}
