import type { ReactNode } from 'react';
import { Icon, type IconName } from './icons.js';
import './ui.css';

// The one notice of the kit: a bordered box with an optional icon and bold title.
// - tone: `caution` for something X2F's rules hold back or warn about (LoginApprove's "One device
//   at a time is on", My offers' trading hold), `danger` for a fault that left things unchanged,
//   `plain` for a done change, `info` for a note that explains what happens next (BuyQuote's
//   "Nothing changes after you tap Trade…": surface-raised, an ink-muted info icon).
// - icon: the caution triangle by default on caution (visual system v2, section 12), the info circle
//   on info; `false` for none (My offers' summary line).
// - live: how a screen reader hears it appear: `alert`, `status`, or `off` for a note that is part
//   of the page (LoginApprove's notes). By default caution and danger are alerts, plain a status,
//   and info is part of the page (off).
// `data-*` attributes pass through (`data-part`).
export type NoticeTone = 'plain' | 'info' | 'caution' | 'danger';

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
  const shown = icon === undefined ? (tone === 'caution' ? 'alert' : tone === 'info' ? 'info' : false) : icon;
  const heard = live ?? (tone === 'info' ? 'off' : tone === 'plain' ? 'status' : 'alert');
  const role = heard === 'off' ? undefined : heard;
  return (
    <div {...data} className="x2f-outcome" data-tone={tone} role={role}>
      {shown !== false ? (
        <span className="x2f-outcome__icon">
          <Icon name={shown} size={18} stroke={1.75} />
        </span>
      ) : null}
      <div className="x2f-outcome__text">
        {title !== undefined ? <p className="x2f-outcome__title">{title}</p> : null}
        <p className="x2f-outcome__body">{children}</p>
      </div>
    </div>
  );
}
