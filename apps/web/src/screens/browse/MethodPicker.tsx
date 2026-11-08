import { useId, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Link } from 'react-router';
import { ChoiceGroup } from '../../ui/Choice.js';
import { Icon } from '../../ui/icons.js';
import { Sheet } from '../../ui/Sheet.js';
import type { MethodRow } from './api.js';
import './browse.css';

// The live section of Main (/sell) and BuyMain (/buy) as one card whose method is a picker (owner,
// 2026-11-08: "Make this a drop down of all the currently available selected payment method in
// chosen currency"). The top row is a button that opens a sheet (a bottom sheet on the phone, a
// centred dialog on the Desktop layout) listing every method with a live offer in the currency as
// radios, each with its line; the row under it leads to the shown method's offers. Picking a method
// changes the card in place.

/** The method the card shows: the picked one while it has live offers here, else the first live one. */
export function methodShown(live: readonly MethodRow[], picked: string | null): MethodRow | null {
  return live.find((m) => m.id === picked) ?? live[0] ?? null;
}

export function MethodPicker({
  live,
  value,
  onChange,
  title,
  sub,
  href,
}: {
  /** The methods with a live offer in the currency, in the chosen sort. */
  live: readonly MethodRow[];
  value: MethodRow;
  onChange: (id: string) => void;
  /** The section's title ("Buyers paying in USD"), also the sheet's. */
  title: string;
  /** A method's line ("34 buyers paying in USD · up to $331.20"). */
  sub: (m: MethodRow) => string;
  href: (m: MethodRow) => string;
}) {
  const [open, setOpen] = useState(false);
  const nameId = useId();
  const subId = useId();

  // A tap picks and closes. The arrow keys move the choice (a click with no pointer, detail 0) and
  // keep the sheet open; Enter or Space closes it on the choice. Escape, X and the backdrop close too.
  const onClick = (e: MouseEvent) => {
    if (e.detail > 0 && (e.target as HTMLElement).closest('.x2f-choice')) setOpen(false);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <>
      <div className="x2f-method-pick" data-part="method-pick">
        <button type="button" className="x2f-method x2f-method-pick__button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
          <span className="x2f-method__text">
            <span className="x2f-method__name">
              <span className="x2f-visually-hidden">Payment method: </span>
              <span id={nameId} data-part="name">
                {value.name}
              </span>
            </span>
          </span>
          <Icon name="chevron-down" size={18} />
        </button>
        <Link to={href(value)} className="x2f-method x2f-method-pick__link" aria-labelledby={`${nameId} ${subId}`}>
          <span className="x2f-method__text">
            <span id={subId} className="x2f-method__sub">
              {sub(value)}
            </span>
          </span>
          <Icon name="chevron-right" size={18} />
        </Link>
      </div>
      <Sheet open={open} title={title} wide="dialog" handle onClose={() => setOpen(false)}>
        <div className="x2f-method-pick__list" onClick={onClick} onKeyDown={onKeyDown}>
          <ChoiceGroup look="card" label={title} part="method-option" options={live.map((m) => ({ value: m.id, label: m.name, note: sub(m) }))} value={value.id} onChange={onChange} />
        </div>
      </Sheet>
    </>
  );
}
