import { useId, type ReactNode } from 'react';
import { Checkbox } from './Checkbox.js';
import './ui.css';

/**
 * A tick box with its words (Feedback "Send anonymously", News "Don't show me this again"): the
 * kit's 44px `Checkbox`, then the title (its label, so a tap on the words ticks it too) and an
 * optional hint read as its description. `boxed` puts the row on a surface card (Feedback board).
 */
export function CheckRow({
  checked,
  onChange,
  title,
  hint,
  boxed = false,
  part,
  hintPart,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: ReactNode;
  hint?: ReactNode;
  boxed?: boolean;
  part?: string;
  hintPart?: string;
}) {
  const id = useId();
  const titleId = `${id}-title`;
  const hintId = `${id}-hint`;
  return (
    <div className="x2f-check-row" data-boxed={boxed ? '' : undefined} data-part={part}>
      <Checkbox id={id} checked={checked} onChange={onChange} aria-labelledby={titleId} aria-describedby={hint !== undefined ? hintId : undefined} />
      <span className="x2f-check-row__text">
        <label htmlFor={id} id={titleId} className="x2f-check-row__title">
          {title}
        </label>
        {hint !== undefined ? (
          <span id={hintId} className="x2f-check-row__hint" data-part={hintPart}>
            {hint}
          </span>
        ) : null}
      </span>
    </div>
  );
}
