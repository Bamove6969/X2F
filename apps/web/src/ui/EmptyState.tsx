import type { ReactNode } from 'react';
import { Icon, type IconName } from './icons.js';
import './ui.css';

// An empty list (MyOffers board's empty state, design review 1 Nov 2026 shot 35): a 32 px icon, an
// h2 and one or two lines. The screen's primary action stays in its ActionBar.
export function EmptyState({
  icon,
  title,
  children,
  action,
  ...data
}: {
  icon: IconName;
  title: string;
  children: ReactNode;
  /** A link under the lines (owner 17 Nov black+orange rule: the empty list's orange way on). */
  action?: ReactNode;
  [k: `data-${string}`]: string | undefined;
}) {
  return (
    <section {...data} className="x2f-empty" aria-label={title}>
      <Icon name={icon} size={32} />
      <h2 className="x2f-empty__title">{title}</h2>
      <p className="x2f-empty__text">{children}</p>
      {action !== undefined ? <p className="x2f-empty__action">{action}</p> : null}
    </section>
  );
}
