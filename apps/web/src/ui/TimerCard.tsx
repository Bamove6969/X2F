import type { ReactNode } from 'react';
import './ui.css';

const R = 27;
const C = 2 * Math.PI * R;

/**
 * A timer card (BuyerPaidWaiting "Time left to confirm"): the label, the time left (digits 40/44
 * mono 500, units 18/24 600 ink-muted) and a 14/20 note on the left; a 64px ring (r 27, stroke 5,
 * the track in the tone at 20%) on the right with `left` of `total` still to go. `tone` colours the
 * label and the ring. `inset` drops the card's own surface and padding, for a timer inside a hero.
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
  inset,
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
  inset?: boolean;
}) {
  const share = total > 0 ? Math.min(Math.max(left, 0), total) / total : 0;
  return (
    <section aria-label={label} className="x2f-timer" data-tone={tone} data-part={part} data-fold-glance={glance} data-inset={inset ? '' : undefined}>
      <div className="x2f-timer__text">
        <span className="x2f-timer__label">{label}</span>
        <span className="x2f-timer__value">{value}</span>
        {hint !== undefined ? <span className="x2f-timer__hint">{hint}</span> : null}
      </div>
      <svg width="64" height="64" viewBox="0 0 64 64" role="img" aria-label={ringLabel} className="x2f-timer__ring">
        <circle cx="32" cy="32" r={R} fill="none" className="x2f-timer__ring-track" strokeWidth="5" />
        {/* No arc at all once the time is up: a round cap on an empty dash would still draw a dot. */}
        {share > 0 ? (
          <circle
            cx="32"
            cy="32"
            r={R}
            fill="none"
            className="x2f-timer__ring-left"
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={`${(C * share).toFixed(1)} ${C.toFixed(1)}`}
            transform="rotate(-90 32 32)"
          />
        ) : null}
      </svg>
    </section>
  );
}
