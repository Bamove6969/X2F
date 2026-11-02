import type { ButtonHTMLAttributes } from 'react';
import './ui.css';

// The one on/off switch of the kit (MyOffers and Devices boards): a real role="switch" button with
// aria-checked, at least 52×44 to tap, drawing a 52×32 track with a 24 px knob. On: an ink track
// and a ground knob at the end. Off: a raised track with a line border and an ink-muted knob. It
// has no visible words: name it by its visible label with `aria-labelledby` (Devices: "One device
// at a time"; My offers: the offer's lines) and describe it with `aria-describedby`. The focus
// ring is the kit's 2 px ink outline; a disabled switch mutes its track (My offers during a hold).
type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'role' | 'aria-checked' | 'children' | 'className' | 'type'> & {
  checked: boolean;
};

export function Switch({ checked, ...rest }: Props) {
  return (
    <button {...rest} type="button" role="switch" aria-checked={checked} data-on={checked ? 'true' : 'false'} className="x2f-switch">
      <span className="x2f-switch__track" aria-hidden="true">
        <span className="x2f-switch__knob" />
      </span>
    </button>
  );
}
