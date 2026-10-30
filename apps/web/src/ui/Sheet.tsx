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
 */
export function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  // Read while rendering the opening, before focus moves into the sheet.
  const pane = useMemo(() => (open ? paneOf(document.activeElement) : null), [open]);

  useEffect(() => {
    if (!open) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus();
    return () => before?.focus();
  }, [open]);

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
    <div className="x2f-sheet-layer" data-pane-of={pane ?? undefined}>
      <div className="x2f-sheet-backdrop" data-part="backdrop" aria-hidden="true" onClick={onClose} />
      <div
        ref={panel}
        className="x2f-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="x2f-sheet__head">
          <h2 id={titleId} className="x2f-sheet__title">
            {title}
          </h2>
          <button type="button" className="x2f-icon-button" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={22} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
