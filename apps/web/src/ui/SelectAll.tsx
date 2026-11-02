import { useId } from 'react';
import { Checkbox } from './Checkbox.js';
import './ui.css';

// "Select all" over a list of SelectCards (MyOffers board): a tri-state tick box, its label and a
// hint line, in a bordered row whose tick box lines up with the cards' tick boxes. It only ticks
// (or clears) the cards; it never acts on them.
export function SelectAll({ checked, mixed, hint, disabled, onChange }: { checked: boolean; mixed: boolean; hint: string; disabled?: boolean; onChange: (checked: boolean) => void }) {
  const id = useId();
  return (
    <div className="x2f-select-all" data-part="select-all-row">
      <Checkbox id={`${id}-box`} checked={checked} mixed={mixed} disabled={disabled} aria-labelledby={`${id}-name`} aria-describedby={`${id}-hint`} onChange={onChange} data-part="select-all" />
      <label htmlFor={`${id}-box`} className="x2f-select-all__label">
        <span className="x2f-select-all__name" id={`${id}-name`}>Select all</span>
        <span className="x2f-select-all__hint" id={`${id}-hint`} data-part="all-hint">
          {hint}
        </span>
      </label>
    </div>
  );
}
