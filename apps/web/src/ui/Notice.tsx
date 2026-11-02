import type { ReactNode } from 'react';
import { Icon } from './icons.js';
import './ui.css';

/**
 * A caution callout (LoginApprove board: "You're logged in on the most devices allowed", "One
 * device at a time is on"): visual system v2 section 12, a caution wash with the 18 px triangle at
 * stroke 1.75. `data-part` passes through.
 */
export function Notice({ children, part, role }: { children: ReactNode; part?: string; role?: 'status' | 'alert' }) {
  return (
    <p className="x2f-caution-note" data-tone="caution" data-part={part} role={role}>
      <span className="x2f-caution-note__icon">
        <Icon name="alert" size={18} stroke={1.75} />
      </span>
      <span>{children}</span>
    </p>
  );
}
