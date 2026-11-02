import type { HTMLAttributes, ReactNode } from 'react';
import './ui.css';

// The footer of a list screen (MyOffers board): it stays in view at the bottom of the screen, above
// the phone tab bar when there is one (ui.css --x2f-tab-bar-height), and below the content when the
// content is short. It holds the screen's primary action, or a selection bar in its place.
type Props = Omit<HTMLAttributes<HTMLDivElement>, 'className'> & { children: ReactNode };

export function ActionBar({ children, ...rest }: Props) {
  return (
    <div {...rest} className="x2f-action-bar">
      {children}
    </div>
  );
}
