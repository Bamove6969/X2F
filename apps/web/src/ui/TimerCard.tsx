import type { ReactNode } from 'react';
import './ui.css';

const R = 24;
const C = 2 * Math.PI * R;

/**
 * A timer card (BuyerPay "Time to pay", BuyerPaidWaiting "Time left to confirm"): the label, the
 * time left (digits 28 mono, units in the body face) and a note on the left; a 56px ring on the
 * right with `left` of `total` still to go. `tone` colours the label and the ring.
 */
export function TimerCard({
  label,
  value,
  hint,
  left,
  total,
  ringLabel,
  tone,
  part,
  glance,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  left: number;
  total: number;
  ringLabel: string;
  tone: 'caution' | 'escrow' | 'muted';
  part?: string;
  /** `data-fold-glance`: the tabletop glance shows this timer, so the screen's copy hides there (styles/fold.css). */
  glance?: 'timer';
}) {
  const share = total > 0 ? Math.min(Math.max(left, 0), total) / total : 0;
  return (
    <section aria-label={label} className="x2f-timer" data-tone={tone} data-part={part} data-fold-glance={glance}>
      <div className="x2f-timer__text">
        <span className="x2f-timer__label">{label}</span>
        <span className="x2f-timer__value">{value}</span>
        {hint !== undefined ? <span className="x2f-timer__hint">{hint}</span> : null}
      </div>
      <svg width="56" height="56" viewBox="0 0 56 56" role="img" aria-label={ringLabel} className="x2f-timer__ring">
        <circle cx="28" cy="28" r={R} fill="none" className="x2f-timer__ring-track" strokeWidth="6" />
        <circle
          cx="28"
          cy="28"
          r={R}
          fill="none"
          className="x2f-timer__ring-left"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${(C * share).toFixed(1)} ${C.toFixed(1)}`}
          transform="rotate(-90 28 28)"
        />
      </svg>
    </section>
  );
}
