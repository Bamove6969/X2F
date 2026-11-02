import type { ReactNode } from 'react';
import { Icon } from './icons.js';
import './ui.css';

/**
 * A caution note in a bordered box with the info icon (LoginApprove board: "You're logged in on
 * the most devices allowed", "One device at a time is on"). `data-part` passes through.
 */
export function Notice({ children, part, role }: { children: ReactNode; part?: string; role?: 'status' | 'alert' }) {
  return (
    <p className="x2f-caution-note" data-tone="caution" data-part={part} role={role}>
      <span className="x2f-caution-note__icon">
        <Icon name="info-circle" size={18} />
      </span>
      <span>{children}</span>
    </p>
  );
}
