import type { ReactNode } from 'react';
import { Icon, type IconName } from './icons.js';
import './ui.css';

// The one notice of the kit: a bordered box with an optional icon and bold title.
// - tone: `caution` for something X2F's rules hold back or warn about (LoginApprove's "One device
//   at a time is on", My offers' trading hold), `danger` for a fault that left things unchanged,
//   `plain` for a done change, `neutral` for a call-out on the raised surface (Block board).
// - icon: the info icon by default on caution; `false` for none (My offers' summary line).
// - live: how a screen reader hears it appear: `alert`, `status`, or `off` for a note that is part
//   of the page (LoginApprove's notes). By default caution and danger are alerts, plain a status.
// `data-*` attributes pass through (`data-part`).
export type NoticeTone = 'plain' | 'caution' | 'danger' | 'neutral';

export function Notice({
  tone = 'caution',
  icon,
  title,
  live,
  children,
  ...data
}: {
  tone?: NoticeTone;
  icon?: IconName | false;
  title?: string;
  live?: 'alert' | 'status' | 'off';
  children: ReactNode;
  [k: `data-${string}`]: string | undefined;
}) {
  const shown = icon === undefined ? (tone === 'caution' ? 'info-circle' : false) : icon;
  const role = (live ?? (tone === 'plain' ? 'status' : 'alert')) === 'off' ? undefined : (live ?? (tone === 'plain' ? 'status' : 'alert'));
  return (
    <div {...data} className="x2f-outcome" data-tone={tone} role={role}>
      {shown !== false ? (
        <span className="x2f-outcome__icon">
          <Icon name={shown} size={18} />
        </span>
      ) : null}
      <div className="x2f-outcome__text">
        {title !== undefined ? <p className="x2f-outcome__title">{title}</p> : null}
        <p className="x2f-outcome__body">{children}</p>
      </div>
    </div>
  );
}
