import { useRef } from 'react';
import type { AmountUnit } from '@x2f/trade';

// The XMR / <currency> switch at a range box's right edge (owner, 8 Nov 2026, Post an offer): XMR is
// the left one and the default; the chosen unit is bold and Monero orange, the other smaller and
// muted, so the choice is plain; tapping the other one swaps. A radio group of two, named after its
// box ("Smallest trade unit"); the arrow keys move the choice as in RadioChips.

export interface UnitSwitchProps {
  /** The box it belongs to, e.g. "Smallest trade". */
  box: string;
  currency: string;
  unit: AmountUnit;
  onChange: (unit: AmountUnit) => void;
}

const NEXT = new Set(['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']);

export function UnitSwitch({ box, currency, unit, onChange }: UnitSwitchProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const options: { id: AmountUnit; label: string }[] = [
    { id: 'xmr', label: 'XMR' },
    { id: 'fiat', label: currency },
  ];
  return (
    <div role="radiogroup" aria-label={`${box} unit`} className="post-unit">
      {options.map((o, i) => (
        <button
          key={o.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={unit === o.id}
          tabIndex={unit === o.id ? 0 : -1}
          data-unit={o.id}
          onClick={() => onChange(o.id)}
          onKeyDown={(e) => {
            if (!NEXT.has(e.key)) return;
            e.preventDefault();
            const j = 1 - i;
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
