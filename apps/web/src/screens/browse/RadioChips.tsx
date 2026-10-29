import { useRef, type ReactNode } from 'react';
import './browse.css';

// A row of chips where exactly one is chosen (currency, Sort): a radio group, as on the boards. Only
// the chosen chip is in the tab order; the arrow keys move the choice (wrapping) and the focus with
// it, as WAI-ARIA's radio group pattern describes.

export interface RadioChipsProps<T extends string> {
  /** The group's accessible name ("Sort"), or the id of an element that names it. */
  label: { name: string } | { by: string };
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
  /** Shown before the chips (a visible "Sort" word, a visually hidden label). */
  children?: ReactNode;
}

const NEXT: Record<string, 1 | -1> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

export function RadioChips<T extends string>({ label, options, value, onChange, className = 'x2f-browse__sorts', children }: RadioChipsProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const named = 'name' in label ? { 'aria-label': label.name } : { 'aria-labelledby': label.by };
  return (
    <div role="radiogroup" className={className} {...named}>
      {children}
      {options.map((o, i) => (
        <button
          key={o.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          tabIndex={value === o.id ? 0 : -1}
          className="x2f-chip-button"
          onClick={() => onChange(o.id)}
          onKeyDown={(e) => {
            const step = NEXT[e.key];
            if (step === undefined) return;
            e.preventDefault();
            const j = (i + step + options.length) % options.length;
            onChange(options[j]!.id);
            refs.current[j]?.focus();
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
