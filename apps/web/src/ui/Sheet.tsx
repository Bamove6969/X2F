import { useEffect, useId, useMemo, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { paneOf } from './fold.js';
import { Icon } from './icons.js';
import './ui.css';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A modal bottom sheet on `surface` with `radius-md` corners (design-system README: "cards,
 * primary buttons, sheets"). Escape, the close button and a tap on the backdrop call `onClose`;
 * focus moves into the sheet, stays inside it, and returns where it was when the sheet closes.
 * On a foldable it opens inside the pane that asked for it, never across the hinge (Task 40,
 * styles/fold.css): the pane is the one holding the focused element when the sheet opens.
 * `eyebrow` puts a small caution line with the alert icon above the title (the warning boards'
 * "Before you release", Task 38), and makes the sheet an `alertdialog`.
 * `describedBy` names the element that holds the sheet's message (read out with the title), and
 * `initialFocus` is a selector inside the sheet for the control that gets focus when it opens (the
 * warnings' safe action, review M5); without it the panel itself is focused.
 *
 * For the LoginApprove board (C2-D1): `kicker` is a small muted label above the title ("New
 * login"), `lead` sits above the title (a state icon), `closeButton={false}` drops the X (Escape
 * and the backdrop still close), `focusKey` moves focus back to the sheet whenever it changes (a
 * step that removes the focused button), and `wide="dialog"` centres the sheet as a dialog on the
 * Desktop layout instead of a bottom sheet.
 *
 * For the CantDoThat board (design v2 batch 2): `handle` draws the grab handle at the top of the
 * bottom sheet, and a swipe down from the handle (a touch or pen drag of SWIPE_CLOSE_PX or more)
 * calls `onClose`, like a tap on the backdrop. Review M1: the drag starts on the handle, which has
 * `touch-action: none` and a 44 px hit area (ui.css), so a real touch screen sends pointerup
 * instead of taking the drag as a pan; pointercancel forgets the gesture. Review M2: a mouse drag
 * never closes it (the wide dialog hides the handle, and a mouse drag selects text).
 */
const SWIPE_CLOSE_PX = 64;

export function Sheet({
  open,
  title,
  eyebrow,
  describedBy,
  initialFocus,
  kicker,
  lead,
  closeButton = true,
  focusKey,
  wide,
  handle = false,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  eyebrow?: string;
  describedBy?: string;
  initialFocus?: string;
  kicker?: string | undefined;
  lead?: ReactNode | undefined;
  closeButton?: boolean;
  focusKey?: string;
  wide?: 'dialog';
  handle?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const dragFrom = useRef<number | null>(null);
  // Read while rendering the opening, before focus moves into the sheet.
  const pane = useMemo(() => (open ? paneOf(document.activeElement) : null), [open]);

  useEffect(() => {
    if (!open) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = initialFocus ? panel.current?.querySelector<HTMLElement>(initialFocus) : null;
    (first ?? panel.current)?.focus();
    return () => before?.focus();
  }, [open]);

  // A new step of the same sheet: focus goes back to the sheet (its new title is read out).
  const lastKey = useRef(focusKey);
  useEffect(() => {
    if (!open || lastKey.current === focusKey) return;
    lastKey.current = focusKey;
    if (panel.current && !panel.current.contains(document.activeElement)) panel.current.focus();
  }, [open, focusKey]);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className="x2f-sheet-layer" data-pane-of={pane ?? undefined} data-wide={wide}>
      <div className="x2f-sheet-backdrop" data-part="backdrop" aria-hidden="true" onClick={onClose} />
      <div
        ref={panel}
        className="x2f-sheet"
        role={eyebrow === undefined ? 'dialog' : 'alertdialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        {handle ? (
          <span
            className="x2f-sheet__handle"
            data-part="sheet-handle"
            aria-hidden="true"
            onPointerDown={(e) => {
              if (e.pointerType === 'mouse') return;
              dragFrom.current = e.clientY;
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                // No active pointer to capture (a synthetic event): the gesture still ends on the handle.
              }
            }}
            onPointerUp={(e) => {
              const from = dragFrom.current;
              dragFrom.current = null;
              if (from !== null && e.pointerType !== 'mouse' && e.clientY - from >= SWIPE_CLOSE_PX) onClose();
            }}
            onPointerCancel={() => void (dragFrom.current = null)}
          />
        ) : null}
        <div className="x2f-sheet__head">
          {eyebrow === undefined && kicker === undefined && lead === undefined ? (
            <h2 id={titleId} className="x2f-sheet__title">
              {title}
            </h2>
          ) : eyebrow === undefined ? (
            <div className="x2f-sheet__heading">
              {lead}
              {kicker !== undefined ? (
                <span className="x2f-sheet__kicker" data-part="sheet-kicker">
                  {kicker}
                </span>
              ) : null}
              <h2 id={titleId} className="x2f-sheet__title">
                {title}
              </h2>
            </div>
          ) : (
            <div className="x2f-sheet__heading">
              <span className="x2f-sheet__eyebrow">
                <Icon name="alert" size={18} />
                {eyebrow}
              </span>
              <h2 id={titleId} className="x2f-sheet__title">
                {title}
              </h2>
            </div>
          )}
          {closeButton ? (
            <button type="button" className="x2f-icon-button" aria-label="Close" onClick={onClose}>
              <Icon name="close" size={22} />
            </button>
          ) : null}
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
