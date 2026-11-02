import type { ButtonHTMLAttributes } from 'react';
import './ui.css';

// The on/off switch of the MyOffers and Devices boards: a real role="switch" button, 60×44 to tap,
// drawing a 52×32 track with a 24 px knob. On: an ink track and a ground knob on the right. Off: a
// raised track with a line border and an ink-muted knob on the left. It has no visible words, so it
// is named by `aria-label` or `aria-labelledby`.
type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'role' | 'aria-checked' | 'children' | 'className' | 'type'> & {
  checked: boolean;
};

export function Switch({ checked, ...rest }: Props) {
  return (
    <button {...rest} type="button" role="switch" aria-checked={checked} className="x2f-switch">
      <span className="x2f-switch__track" aria-hidden="true">
        <span className="x2f-switch__knob" />
      </span>
    </button>
  );
}
