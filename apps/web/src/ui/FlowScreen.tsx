import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Icon } from './icons.js';
import './ui.css';

/**
 * A full screen with a header (a 44 px back control and the title), a main column and an optional
 * footer that holds the screen's actions (LoginApprove board, new-device side; Devices board; News
 * and Feedback boards).
 * - `back` is a link (`to`) or a button (`onClick`), always with a spoken name; `icon: 'close'`
 *   draws an X (News "Close News").
 * - `sub` is a muted line under the title (News "3 new · 4 posts"); `action` sits at the header's
 *   right (News "Mark all as read").
 * - `titleAs="label"` makes the header title a plain label when the screen's h1 is in the main
 *   (Feedback: "Feedback" in the header, h1 "Tell us what you think").
 * - `header="compact"` is the visual system v2 compact header (section 5): no bottom border and a
 *   small muted h1, for a screen whose own h2 carries the big words (LoginApprove v2).
 * - `look="card"` puts the screen in one centred card on the Desktop layout (LoginApprove-Wide);
 *   `look="page"` keeps a wide page whose main may lay out its own columns (Devices-Wide).
 */
export function FlowScreen({
  screen,
  title,
  titleAs = 'h1',
  sub,
  action,
  back,
  footer,
  look = 'card',
  header = 'title',
  busy,
  children,
}: {
  screen: string;
  title: string;
  titleAs?: 'h1' | 'label';
  sub?: ReactNode;
  action?: ReactNode;
  back: { label: string; icon?: 'back' | 'close' } & ({ to: string; onClick?: undefined } | { onClick: () => void; to?: undefined });
  footer?: ReactNode;
  look?: 'card' | 'page';
  header?: 'title' | 'compact';
  busy?: boolean;
  children: ReactNode;
}) {
  const icon =
    back.icon === 'close' ? (
      <Icon name="close" size={22} />
    ) : (
      <Icon name="chevron-left" size={24} stroke={header === 'compact' ? 1.75 : 1.5} />
    );
  const heading = titleAs === 'h1' ? <h1 className="x2f-flow__title">{title}</h1> : <span className="x2f-flow__title">{title}</span>;
  return (
    <main className="x2f-flow" data-screen={screen} data-look={look} data-header={header} aria-busy={busy}>
      <header className="x2f-flow__header">
        {back.to !== undefined ? (
          <Link className="x2f-icon-button x2f-flow__back" to={back.to} aria-label={back.label}>
            {icon}
          </Link>
        ) : (
          <button type="button" className="x2f-icon-button x2f-flow__back" aria-label={back.label} onClick={back.onClick}>
            {icon}
          </button>
        )}
        {sub !== undefined ? (
          <div className="x2f-flow__heading">
            {heading}
            <span className="x2f-flow__sub">{sub}</span>
          </div>
        ) : (
          heading
        )}
        {action}
      </header>
      <div className="x2f-flow__main">{children}</div>
      {footer !== undefined ? <footer className="x2f-flow__footer">{footer}</footer> : null}
    </main>
  );
}
