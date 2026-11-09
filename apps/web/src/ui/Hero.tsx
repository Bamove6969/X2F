// The v2 hero (status block), its key mark and the phone trade stepper, from the design kit
// handoff (8 Nov 2026) §4-6: Hero, HeroNumber, ResultHeadline, TimerRing, SegmentProgress,
// KeyMark, KeyTile, TradeStepper. One hero per screen. Styles in hero.css.
import type { ReactNode } from 'react';
import { TimeParts, remainingWords, type TimePart } from './Countdown.js';
import { MonoDigits } from './Identity.js';
import './hero.css';

/** The hero's tone per state (kit 4.5); `neutral` is ink-muted (refunded, cancelled). */
export type HeroTone = 'caution' | 'escrow' | 'danger' | 'mod' | 'neutral' | 'team';

/**
 * The status block (kit 4.1-4.2): a 14% tone wash fading to surface at 140 px (160 on a result),
 * a 35% tone border, and a top row with the status chip on the left and, on trade screens, the
 * key mark on the right. `children` are rows 2 and 3.
 */
export function Hero({
  tone,
  label,
  labelledBy,
  role,
  part,
  kind = 'trade',
  chip,
  keyMark = false,
  children,
}: {
  tone: HeroTone;
  /** The section's accessible name (kit 4.5: `aria-label` or `aria-labelledby`). */
  label?: string;
  /** The id of the element that names the section, in place of `label`. */
  labelledBy?: string;
  /** `status` when the hero is a live status line (BuyerPaidWaiting). */
  role?: 'status';
  /** `data-part`, for the screen's own tests and fold. */
  part?: string;
  kind?: 'trade' | 'result' | 'other';
  chip: ReactNode;
  /** The 2-of-3 key mark: trade and trade-result screens only. */
  keyMark?: boolean;
  children?: ReactNode;
}) {
  return (
    <section className="x2f-hero" data-tone={tone} data-kind={kind} role={role} aria-label={labelledBy ? undefined : label} aria-labelledby={labelledBy} data-part={part}>
      <div className="x2f-hero__top">
        {chip}
        {keyMark ? <KeyMark tone={tone} /> : null}
      </div>
      {children}
    </section>
  );
}

/** An inner divider in the hero (kit 4.1): 1 px of the tone at 25%. */
export function HeroRule({ glance }: { glance?: string }) {
  return <div className="x2f-hero__rule" aria-hidden="true" data-fold-glance={glance} />;
}

/**
 * The hero's inner block of amounts (kit 4.3 Amount, 4.4 and 8.1; Refunded): a stacked amount row
 * (14px 16px: an uppercase muted label, then the amount and its fiat, wrapping with a 10 px column
 * gap), then key/value rows (48 px, 0 16px) under an inset surface divider.
 */
export function HeroAmount({
  label,
  amount,
  fiat,
  rows = [],
  part,
}: {
  label: string;
  /** The amount, an `Xmr` (mono 28/32 500 here, "XMR" 15 600). */
  amount: ReactNode;
  fiat?: string;
  rows?: readonly { term: string; value: ReactNode }[];
  part?: string;
}) {
  return (
    <dl className="x2f-hero__facts" data-part={part}>
      <div className="x2f-hero__amount">
        <dt className="x2f-hero__facts-label">{label}</dt>
        <dd>
          {amount}
          {fiat ? (
            <>
              {' '}
              <span className="x2f-hero__fiat">{fiat}</span>
            </>
          ) : null}
        </dd>
      </div>
      {rows.map((r) => (
        <div key={r.term} className="x2f-hero__row">
          <dt>{r.term}</dt>
          <dd className="x2f-num">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The one big number (kit 4.3): an uppercase label in the tone, then mono 40/44 digits with body
 * units (18/24 600 muted), then an optional meaning line. A timer passes `parts` (it is a
 * `role="timer"` named in words); an amount passes `value` and `unit`.
 */
export function HeroNumber({
  label,
  info,
  parts,
  value,
  unit,
  meaning,
  side,
}: {
  label: string;
  /** An info button after the label (opens a tooltip). */
  info?: ReactNode;
  parts?: readonly TimePart[];
  value?: string;
  unit?: string;
  meaning?: string;
  /** Right of the number: the timer ring. */
  side?: ReactNode;
}) {
  const number = parts ? (
    <span className="x2f-hero-number" role="timer" data-mask="clock" aria-label={remainingWords(parts)}>
      <TimeParts parts={parts} />
    </span>
  ) : (
    <span className="x2f-hero-number">
      <span className="x2f-countdown__n">{value}</span>
      {unit ? (
        <>
          {' '}
          <span className="x2f-countdown__u">{unit}</span>
        </>
      ) : null}
    </span>
  );
  return (
    <div className="x2f-hero__meaning" data-side={side ? 'true' : undefined}>
      <div className="x2f-hero__number-col">
        <span className="x2f-hero__label">
          {label}
          {info}
        </span>
        {number}
        {meaning ? (
          <span className="x2f-hero__line">
            <MonoDigits text={meaning} />
          </span>
        ) : null}
      </div>
      {side}
    </div>
  );
}

/** A result screen's headline (kit 4.3): Familjen 32/36 (40/44 wide), then a 16/24 muted lead with digits in mono. */
export function ResultHeadline({ title, lead, id }: { title: ReactNode; lead?: ReactNode; id?: string }) {
  return (
    <div className="x2f-hero__result">
      <h1 className="x2f-hero__headline" id={id}>
        {title}
      </h1>
      {lead ? (
        <p className="x2f-hero__lead">
          {typeof lead === 'string' ? <MonoDigits text={lead} /> : lead}
        </p>
      ) : null}
    </div>
  );
}

const CIRCUMFERENCE = 169.6;

/** The first dash value of the ring: 169.6 × remaining / total, clamped. */
export function ringDash(remaining: number, total: number): number {
  if (!(total > 0) || !Number.isFinite(remaining)) return 0;
  return Math.round(CIRCUMFERENCE * Math.min(1, Math.max(0, remaining / total)) * 10) / 10;
}

/**
 * The 64 px timer ring (kit 4.4, v2 §14), in the hero's tone. `notStarted` draws the dotted ring
 * with clock hands. The label says it in words ("89 of 90 minutes left to pay").
 */
export function TimerRing({ remaining, total, label, notStarted = false }: { remaining: number; total: number; label: string; notStarted?: boolean }) {
  return (
    <svg className="x2f-ring" width="64" height="64" viewBox="0 0 64 64" role="img" aria-label={label}>
      <circle cx="32" cy="32" r="27" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="5" />
      {notStarted ? (
        <>
          <circle cx="32" cy="32" r="27" fill="none" stroke="currentColor" strokeWidth="5" strokeDasharray="2 6.48" />
          <path d="M32 22v10l6 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <circle
          cx="32"
          cy="32"
          r="27"
          fill="none"
          stroke="currentColor"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${ringDash(remaining, total)} ${CIRCUMFERENCE}`}
          transform="rotate(-90 32 32)"
        />
      )}
    </svg>
  );
}

/**
 * Confirmations as ten pills (kit 4.4): done pills in the tone, the rest a raised wash; all escrow
 * once secured. `head` is the row above it ("Confirmations" and its value).
 */
export function SegmentProgress({ done, total = 10, label, head }: { done: number; total?: number; label: string; head?: ReactNode }) {
  const n = Math.min(total, Math.max(0, Math.floor(done)));
  return (
    <div className="x2f-segments-block">
      {head ? <div className="x2f-segments__head">{head}</div> : null}
      <div className="x2f-segments" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={n} style={{ gridTemplateColumns: `repeat(${total}, 1fr)` }}>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className="x2f-segments__pill" data-done={i < n ? 'true' : undefined} />
        ))}
      </div>
    </div>
  );
}

/**
 * The 2-of-3 key mark (kit 5): two filled dots and one ring, in the screen's state tone. Never
 * orange, never animated, never a button, always `aria-hidden`.
 */
export function KeyMark({ size = 'hero', tone }: { size?: 'hero' | 'small'; tone: HeroTone }) {
  return size === 'hero' ? (
    <svg className="x2f-keymark" data-tone={tone} width="62" height="14" viewBox="0 0 62 14" aria-hidden="true" focusable="false" data-part="key-mark">
      <circle cx="7" cy="7" r="7" fill="currentColor" />
      <circle cx="31" cy="7" r="7" fill="currentColor" />
      <circle cx="55" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  ) : (
    <svg className="x2f-keymark" data-tone={tone} width="32" height="8" viewBox="0 0 32 8" aria-hidden="true">
      <circle cx="4" cy="4" r="4" fill="currentColor" />
      <circle cx="16" cy="4" r="4" fill="currentColor" />
      <circle cx="28" cy="4" r="3.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** The small key mark in a toned 40 px tile: the leading tile of an active-trade row (kit 5, 7). */
export function KeyTile({ tone }: { tone: HeroTone }) {
  return (
    <span className="x2f-keytile" data-tone={tone} aria-hidden="true">
      <KeyMark size="small" tone={tone} />
    </span>
  );
}

/** Step labels (kit 6, COPY-UNSIGNED). */
export const BUYER_STEPS = ['Escrow', 'You pay', 'Seller checks', 'Released'] as const;
export const SELLER_STEPS = ['Escrow', 'Buyer pays', 'You check', 'Released'] as const;

/**
 * The phone trade stepper (kit 6), under the screen title on every live-trade screen: done steps
 * full escrow, the current step a partial fill of its real progress in the state tone with a 600
 * ink label and `aria-current="step"`, upcoming steps empty. Each step also says "done" or
 * "upcoming" to screen readers, since colour is the only other cue.
 */
export function TradeStepper({
  steps,
  current,
  progress,
  tone = 'caution',
}: {
  steps: readonly string[];
  /** The current step's index (0-based). `steps.length` means every step is done. */
  current: number;
  /** The current step's progress, 0-100. */
  progress: number;
  tone?: Extract<HeroTone, 'caution' | 'danger' | 'escrow'>;
}) {
  const pct = Math.min(100, Math.max(0, Number.isFinite(progress) ? progress : 0));
  return (
    <ol className="x2f-stepper" aria-label="Trade progress" style={{ gridTemplateColumns: `repeat(${steps.length}, 1fr)` }}>
      {steps.map((s, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'upcoming';
        return (
          <li key={s} className="x2f-stepper__step" data-state={state} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="x2f-stepper__track" aria-hidden="true">
              <span className="x2f-stepper__fill" data-tone={state === 'current' ? tone : undefined} style={{ width: state === 'done' ? '100%' : state === 'current' ? `${pct}%` : '0%' }} />
            </span>
            <span className="x2f-stepper__label">
              {s}
              {state === 'current' ? null : <span className="x2f-sr-only">{state === 'done' ? ', done' : ', upcoming'}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
