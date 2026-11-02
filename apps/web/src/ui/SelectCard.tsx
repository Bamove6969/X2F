import type { HTMLAttributes, ReactNode } from 'react';
import './ui.css';

// A list card with a tick box, its content and a control (the MyOffers board's offer card), on one
// fixed grid: tick box 44 | content | control 60, so every card's text starts at the same x.
// `on` false draws the card transparent with a dashed line border (an Off offer); `selected` draws
// the selection the conventions' way (2 Nov 2026): a 2 px ink ring on the raised surface, never orange.
type Props = Omit<HTMLAttributes<HTMLLIElement>, 'className' | 'children'> & {
  on: boolean;
  selected: boolean;
  select: ReactNode;
  control: ReactNode;
  children: ReactNode;
};

export function SelectCard({ on, selected, select, control, children, ...rest }: Props) {
  return (
    <li {...rest} className="x2f-select-card" data-on={on} data-selected={selected}>
      <span className="x2f-select-card__select">{select}</span>
      <div className="x2f-select-card__body">{children}</div>
      <span className="x2f-select-card__control">{control}</span>
    </li>
  );
}
