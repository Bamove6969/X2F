import { useId, type ReactNode } from 'react';
import './ui.css';

/**
 * A single choice from a few options, as real radios (arrow keys move between them, the group is
 * one tab stop). Two looks from the LoginApprove board: `tile`, three equal 72 px number tiles
 * ("tap the number shown on the new device"), and `card`, full-width 64 px cards with a radio dot,
 * a name and a note (the device to log out). Selected is a 2 px ink border on surface-raised, never
 * orange (design conventions, 2 Nov). The whole tile or card is the label, so it is the tap target.
 */
export interface ChoiceOption<V extends string | number> {
  value: V;
  label: ReactNode;
  note?: ReactNode;
}

export function ChoiceGroup<V extends string | number>({
  look,
  options,
  value,
  onChange,
  labelledBy,
  label,
  part,
  disabled = false,
}: {
  look: 'tile' | 'card';
  options: readonly ChoiceOption<V>[];
  value: V | null;
  onChange: (v: V) => void;
  /** The id of the visible instruction that names the group, or `label` when there is none. */
  labelledBy?: string;
  label?: string;
  /** `data-part` on each option (the e2e and design-shot hooks). */
  part?: string;
  disabled?: boolean;
}) {
  const name = useId();
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} aria-label={label} className="x2f-choices" data-look={look}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <label key={o.value} className="x2f-choice" data-look={look} data-on={on ? 'true' : 'false'} data-part={part}>
            <input
              type="radio"
              className="x2f-choice__input"
              name={name}
              value={String(o.value)}
              checked={on}
              disabled={disabled}
              onChange={() => onChange(o.value)}
            />
            {look === 'card' ? <span className="x2f-choice__dot" aria-hidden="true" /> : null}
            {look === 'card' ? (
              <span className="x2f-choice__text">
                <span className="x2f-choice__label">{o.label}</span>
                {o.note !== undefined ? <span className="x2f-choice__note">{o.note}</span> : null}
              </span>
            ) : (
              <span className="x2f-choice__label">{o.label}</span>
            )}
          </label>
        );
      })}
    </div>
  );
}
