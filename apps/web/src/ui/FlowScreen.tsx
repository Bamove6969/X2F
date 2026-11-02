import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Icon } from './icons.js';
import './ui.css';

/**
 * A full screen with a header (a 44 px back control and the h1), a main column and an optional
 * footer that holds the screen's actions (LoginApprove board, new-device side; Devices board).
 * `header="compact"` is the visual system v2 compact header (section 5): no bottom border and a
 * small muted h1, for a screen whose own h2 carries the big words (LoginApprove v2).
 * `back` is a link (`to`) or a button (`onClick`), always with a spoken name. `look="card"` puts the
 * screen in one centred card on the Desktop layout (LoginApprove-Wide); `look="page"` keeps a wide
 * page whose main may lay out its own columns (Devices-Wide).
 */
export function FlowScreen({
  screen,
  title,
  back,
  footer,
  look = 'card',
  header = 'title',
  children,
}: {
  screen: string;
  title: string;
  back: { label: string } & ({ to: string; onClick?: undefined } | { onClick: () => void; to?: undefined });
  footer?: ReactNode;
  look?: 'card' | 'page';
  header?: 'title' | 'compact';
  children: ReactNode;
}) {
  const icon = <Icon name="chevron-left" size={24} stroke={header === 'compact' ? 1.75 : 1.5} />;
  return (
    <main className="x2f-flow" data-screen={screen} data-look={look} data-header={header}>
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
        <h1 className="x2f-flow__title">{title}</h1>
      </header>
      <div className="x2f-flow__main">{children}</div>
      {footer !== undefined ? <footer className="x2f-flow__footer">{footer}</footer> : null}
    </main>
  );
}
