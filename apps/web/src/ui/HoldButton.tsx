import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import './ui.css';

const REDUCED = '(prefers-reduced-motion: reduce)';

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(REDUCED).matches;
}

/**
 * Press and hold to confirm (SellerConfirm board; spec: release is a 1.5 s hold). A pointer or
 * Space/Enter hold fills the button over `holdMs`; letting go early resets it; `onComplete` fires
 * once. Under reduced motion there is no fill: the top line counts down in text instead
 * ("Keep holding… 1.0 s"). It is the screen's primary action, so it carries `data-primary`.
 * `done` (set by the screen once the action has happened) shows the board's completed look,
 * escrow fill with ground text, and ignores holds; the screen supplies the done wording through
 * `label` and `caption`.
 */
export function HoldButton({
  holdMs = 1500,
  disabled = false,
  done: isDone = false,
  onComplete,
  label,
  holdingLabel,
  caption,
  accessibleLabel,
}: {
  holdMs?: number;
  disabled?: boolean;
  /** The action has happened: show the completed look and ignore holds. */
  done?: boolean;
  onComplete: () => void;
  /** The main line, e.g. "Hold to release 1.25 XMR to mira.k". */
  label: string;
  /** The top line while held, e.g. "Keep holding…". */
  holdingLabel: string;
  /** The top line at rest, e.g. "Payment received". */
  caption?: string;
  /** The button's accessible name when it should say more than `label`. */
  accessibleLabel?: string;
}) {
  const [holdingSince, setHoldingSince] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [reduced, setReduced] = useState(false);
  const done = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);
  const complete = useRef(onComplete);
  complete.current = onComplete;

  const clear = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    if (ticker.current !== null) clearInterval(ticker.current);
    timer.current = null;
    ticker.current = null;
  };

  const stop = () => {
    clear();
    setHoldingSince(null);
  };

  const start = () => {
    if (disabled || isDone || done.current || timer.current !== null) return;
    const reduce = prefersReducedMotion();
    const t0 = Date.now();
    setReduced(reduce);
    setHoldingSince(t0);
    setNow(t0);
    timer.current = setTimeout(() => {
      clear();
      done.current = true;
      setHoldingSince(null);
      complete.current();
    }, holdMs);
    if (reduce) ticker.current = setInterval(() => setNow(Date.now()), 100);
  };

  useEffect(() => {
    if (disabled || isDone) stop();
  }, [disabled, isDone]);

  useEffect(() => clear, []);

  const holding = holdingSince !== null;
  const remaining = holding ? Math.max(0, holdMs - (now - holdingSince)) : holdMs;
  const top = holding ? (reduced ? `${holdingLabel} ${(remaining / 1000).toFixed(1)} s` : holdingLabel) : caption;

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    start();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    if (!e.repeat) start();
  };
  const onKeyUp = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    stop();
  };

  return (
    <button
      type="button"
      className="x2f-hold"
      data-primary=""
      data-holding={holding ? 'true' : 'false'}
      data-reduced={reduced ? 'true' : 'false'}
      data-done={isDone ? 'true' : 'false'}
      disabled={disabled || isDone}
      aria-label={accessibleLabel}
      onPointerDown={onPointerDown}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={stop}
      onContextMenu={(e) => e.preventDefault()}
    >
      {isDone ? null : (
        <span className="x2f-hold__fill" data-fill="" aria-hidden="true" style={{ '--x2f-hold-ms': `${holdMs}ms` } as CSSProperties} />
      )}
      {top === undefined ? null : <span className="x2f-hold__top">{top}</span>}
      <span className="x2f-hold__main">{label}</span>
    </button>
  );
}
