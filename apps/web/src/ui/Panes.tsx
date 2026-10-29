/**
 * The panes of a screen on a foldable (Plan 3 Task 40; Fold-Trade, Fold-Tabletop, Fold-Cover
 * boards). styles/fold.css places them from `<html data-fold>` (src/ui/fold.ts):
 *
 * - `phone` and `wide`: only `main`, laid out exactly as before (the wrapper is `display: contents`).
 * - `two` / `three`: `main` in the first pane and `side` in the next one, on either side of the
 *   hinge with the 16 px gutter on it; the window keeps scrolling `main`, so folding keeps the
 *   scroll position.
 * - `tabletop`: `glance` (information only) in the top segment; `main` (every control) and `side`
 *   in the bottom one.
 * - `cover`: only `glance`; `main` stays mounted but hidden, so nothing it holds is lost.
 *
 * The three slots keep their places in the tree in every layout, so a fold or unfold never
 * remounts the screen: its state, its typed text and its escrow stay as they are.
 */
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { hasPanes, type FoldLayout } from './fold.js';
import '../styles/fold.css';

export function Panes({
  layout,
  glance,
  glanceLabel,
  main,
  side,
  sideLabel,
}: {
  layout: FoldLayout;
  /** The top half on a tabletop and the flip cover screen: information only, no controls. */
  glance?: ReactNode;
  glanceLabel?: string;
  main: ReactNode;
  /** The second pane when the screen has panes (the trade chat). */
  side?: ReactNode;
  sideLabel?: string;
}) {
  const mainRef = useRef<HTMLDivElement>(null);
  useScrollCarry(layout, mainRef);
  const showGlance = glance !== undefined && glance !== null && (layout === 'tabletop' || layout === 'cover');
  const showSide = side !== undefined && side !== null && hasPanes(layout);
  return (
    <div className="x2f-panes" data-fold-layout={layout} data-side={showSide || undefined}>
      {showGlance ? (
        <section data-pane="glance" aria-label={glanceLabel}>
          {glance}
        </section>
      ) : null}
      <div data-pane="main" ref={mainRef}>
        {main}
      </div>
      {showSide ? (
        <aside data-pane="side" aria-label={sideLabel}>
          {side}
        </aside>
      ) : null}
    </div>
  );
}

/**
 * The window scrolls the main pane in every layout but tabletop, where the bottom segment scrolls
 * it; when the phone moves into or out of tabletop the offset moves with it.
 */
function useScrollCarry(layout: FoldLayout, mainRef: { current: HTMLDivElement | null }): void {
  const last = useRef({ layout, top: 0 });
  useLayoutEffect(() => {
    const el = mainRef.current;
    const prev = last.current;
    const inPane = (l: FoldLayout) => l === 'tabletop';
    if (prev.layout !== layout && inPane(prev.layout) !== inPane(layout) && el) {
      if (inPane(layout)) el.scrollTop = prev.top;
      else window.scrollTo(0, prev.top);
    }
    last.current = { layout, top: inPane(layout) ? (el?.scrollTop ?? 0) : window.scrollY };
    const record = () => {
      last.current = { layout, top: inPane(layout) ? (el?.scrollTop ?? 0) : window.scrollY };
    };
    const target: EventTarget = inPane(layout) && el ? el : window;
    target.addEventListener('scroll', record, { passive: true });
    return () => target.removeEventListener('scroll', record);
  }, [layout, mainRef]);
}
