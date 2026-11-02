import { useEffect, useRef, type InputHTMLAttributes } from 'react';
import './ui.css';

// The boards' tick box: a native 24 px checkbox ticked in ink (never orange, conventions 2 Nov 2026)
// inside a 44×44 label, so the whole tile is the tap target. `mixed` shows the third state of a
// "Select all" (the input's `indeterminate`, which assistive tech reads as mixed). It has no visible
// words, so it is named by `aria-label` or `aria-labelledby`.
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className' | 'children' | 'onChange'> & {
  checked: boolean;
  mixed?: boolean;
  onChange: (checked: boolean) => void;
};

export function Checkbox({ checked, mixed = false, onChange, ...rest }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  // Also on `checked`: a click clears the browser's indeterminate, so set it again whenever either
  // changes (review N1), and after every click while the parent keeps it mixed.
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed;
  });
  return (
    <label className="x2f-tickbox">
      <input {...rest} ref={ref} type="checkbox" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />
    </label>
  );
}
