import { useId, useState, type ReactNode } from 'react';
import { Icon } from './icons.js';
import './ui.css';

/**
 * A 56 px row that opens and closes the part below it (LoginApprove board, "Where do I approve
 * it?"): a real button with aria-expanded and aria-controls, and a chevron that turns when open.
 * `children` gets the id the button controls, for the element it renders.
 */
export function Disclosure({ summary, part, children }: { summary: ReactNode; part?: string; children: (id: string) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="x2f-disclosure">
      <button
        type="button"
        className="x2f-disclosure__button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        data-part={part}
        data-open={open ? 'true' : 'false'}
      >
        {summary}
        <span className="x2f-disclosure__chevron">
          <Icon name="chevron-down" size={20} />
        </span>
      </button>
      {open ? children(id) : null}
    </div>
  );
}
