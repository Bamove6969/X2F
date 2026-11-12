/**
 * C-021: the sync-first gate on the screens whose actions change state (`SYNC_GATED`: the trade
 * room and its dispute: release, I've paid, cancel, appeal; Post offer; the offers and their quote:
 * take; My offers). While `syncNow` runs after this tab became active again (session/syncFirst.ts),
 * the screen stays on show and readable and links still go where they go; its buttons, form
 * controls and submits (sheets included, wherever they are mounted) are held by a capture-phase
 * guard on the document (clicks, submits, presses, Enter and Space; a hold-to-release already
 * running is stopped), and `:root[data-sync-held]` marks them. "Updating…" says why. A failed or
 * timed-out sync lets go and says the page may be out of date, with Try again (never held).
 *
 * Rendered in the shell beside the other banners (App.tsx Layout), so it adds no wrapper around
 * the screen: the shell's layout rules on `main` keep matching.
 */
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { SYNC_COPY, syncNow, useSyncPhase } from '../session/syncFirst.js';
import './sync-gate.css';

/** The routes the gate holds (their actions change a trade or an offer). */
export function syncGated(pathname: string): boolean {
  return /^\/(trade\/[^/]+(\/dispute)?|post|profile\/offers|(sell|buy)\/[^/]+(\/[^/]+)?)\/?$/.test(pathname);
}

/**
 * What acts when pressed: buttons and their kin. Typing in a field is never held (a space in the
 * chat composer must still type); a form's submit is held on its own.
 */
const CONTROL = 'button, input[type="button"], input[type="submit"], input[type="checkbox"], input[type="radio"], [role="button"], [role="switch"], [role="checkbox"], [role="radio"]';

/** The events that START an action (never the ends: a pointer or key let go always goes through). */
const STARTS = ['click', 'submit', 'pointerdown', 'keydown'] as const;
const ACTION_KEYS = new Set([' ', 'Enter']);

/**
 * While `held`: on a control anywhere but the gate's own banner, a click, a submit, a press
 * (pointerdown, the hold-to-release button's start) and Enter or Space do nothing. A hold already
 * running when the sync begins (HoldButton, `data-holding`) is stopped first, so its release can
 * never land mid-sync.
 */
function useHold(held: boolean, banner: React.RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!held) return;
    const root = document.documentElement;
    root.setAttribute('data-sync-held', '');
    for (const el of document.querySelectorAll('[data-holding="true"]')) {
      el.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1, isPrimary: true }));
    }
    const hold = (e: Event) => {
      if (e instanceof KeyboardEvent && !ACTION_KEYS.has(e.key)) return;
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (e.type !== 'submit' && t.closest(CONTROL) === null) return;
      if (banner.current?.contains(t)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    for (const type of STARTS) document.addEventListener(type, hold, true);
    return () => {
      root.removeAttribute('data-sync-held');
      for (const type of STARTS) document.removeEventListener(type, hold, true);
    };
  }, [held, banner]);
}

export function SyncGate({ gated }: { gated?: boolean }) {
  const { pathname } = useLocation();
  const on = gated ?? syncGated(pathname);
  const phase = useSyncPhase();
  const banner = useRef<HTMLDivElement | null>(null);
  useHold(on && phase === 'syncing', banner);
  if (!on || phase === 'ready') return null;
  return (
    <div ref={banner}>
      {phase === 'syncing' ? (
        <p className="x2f-sync" role="status" data-part="sync-gate">
          {SYNC_COPY.updating}
        </p>
      ) : (
        <div className="x2f-sync" role="alert" data-part="sync-stale">
          <p>{SYNC_COPY.stale}</p>
          <button type="button" className="x2f-sync__retry" onClick={() => void syncNow()}>
            {SYNC_COPY.retry}
          </button>
        </div>
      )}
    </div>
  );
}
