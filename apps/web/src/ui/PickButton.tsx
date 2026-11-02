import type { ReactNode } from 'react';
import './ui.css';

/**
 * A row of a list that picks what the pane beside it shows (Fold-Offers' offer rows, Fold-MyOffers'
 * "Show details"): a real button with `aria-pressed`, the whole row its tap area. The row picked
 * gets the boards' selection: a 2 px ink border on surface-raised, never orange (CONVENTIONS,
 * review X1).
 */
export function PickButton({
  pressed,
  onPick,
  label,
  labelledBy,
  describedBy,
  children,
  className,
}: {
  pressed: boolean;
  onPick: () => void;
  /** The row's name when its text alone does not say what it shows (`aria-label`). */
  label?: string;
  /** Ids naming the row when its whole text is too long a name (`aria-labelledby`). */
  labelledBy?: string;
  /** Ids describing it (`aria-describedby`): its status, a refusal. */
  describedBy?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={['x2f-pick', className].filter(Boolean).join(' ')}
      aria-pressed={pressed}
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onClick={onPick}
    >
      {children}
    </button>
  );
}
