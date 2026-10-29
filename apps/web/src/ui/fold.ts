/**
 * Foldable phones (Plan 3 Task 40, owner 2026-10-29; Fold-* boards): which layout the app uses for
 * the screen it has, read from the browser's media queries.
 *
 * | layout     | when                                                                         |
 * | ---------- | ---------------------------------------------------------------------------- |
 * | `tabletop` | the browser reports a top and a bottom segment (`vertical-viewport-segments: 2`): half folded |
 * | `three`    | three side-by-side segments (`horizontal-viewport-segments: 3`): a tri-fold fully open |
 * | `two`      | two side-by-side segments, or no segments and 600-999 px wide                 |
 * | `cover`    | under 600 px wide, under 480 px tall and near square: a flip phone's cover screen |
 * | `phone`    | under 600 px wide (a book fold's cover screen is a phone)                     |
 * | `wide`     | no segments and 1000 px and wider (the Desktop board)                         |
 *
 * Chrome on Android reports the segments, so its panes sit on either side of the hinge
 * (`env(viewport-segment-*)` in styles/fold.css). Safari on the iPhone Fold does not yet, so it
 * gets the width rules alone. A book fold's inner screen may report one segment while it lies
 * flat; the width rules cover that.
 *
 * The layout is written to `<html data-fold>` so styles (and sheets portalled to `<body>`) follow
 * it. Nothing here moves state: every screen stays mounted when the layout changes (rules: same
 * screen, same scroll, typed text kept), and typed text that has to move between panes (the chat
 * draft) lives in `useKeptText`, above the layout switch.
 */
import { useEffect, useSyncExternalStore } from 'react';

export type FoldLayout = 'phone' | 'cover' | 'two' | 'three' | 'tabletop' | 'wide';

/** The media queries the layout is read from (exported for the unit test). */
export const FOLD_QUERIES = {
  tabletop: '(vertical-viewport-segments: 2)',
  three: '(horizontal-viewport-segments: 3)',
  two: '(horizontal-viewport-segments: 2)',
  panes: '(min-width: 600px)',
  wide: '(min-width: 1000px)',
  // Flip covers are near square; a small phone on its side (568x320) is not one.
  cover: '(max-width: 599px) and (max-height: 479px) and (max-aspect-ratio: 4/3)',
} as const;

type Matches = Record<keyof typeof FOLD_QUERIES, boolean>;

/** The layout for a set of query results: segments first, then the width rules. */
export function foldLayoutOf(m: Matches): FoldLayout {
  if (m.tabletop) return 'tabletop';
  if (m.three) return 'three';
  if (m.two) return 'two';
  if (!m.panes) return m.cover ? 'cover' : 'phone';
  return m.wide ? 'wide' : 'two';
}

/** True for the layouts that split the screen into panes at the hinge (or at the middle). */
export function hasPanes(layout: FoldLayout): boolean {
  return layout === 'two' || layout === 'three' || layout === 'tabletop';
}

function matches(q: string): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(q).matches;
}

export function readFoldLayout(): FoldLayout {
  const m = Object.fromEntries(Object.entries(FOLD_QUERIES).map(([k, q]) => [k, matches(q)])) as Matches;
  return foldLayoutOf(m);
}

function subscribe(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => undefined;
  const lists = Object.values(FOLD_QUERIES).map((q) => window.matchMedia(q));
  for (const l of lists) l.addEventListener('change', onChange);
  // Some browsers report a segment change only as a resize.
  window.addEventListener('resize', onChange);
  return () => {
    for (const l of lists) l.removeEventListener('change', onChange);
    window.removeEventListener('resize', onChange);
  };
}

/** The current fold layout; re-renders when it changes. */
export function useFoldLayout(): FoldLayout {
  return useSyncExternalStore(subscribe, readFoldLayout, () => 'phone');
}

/** Writes the layout to `<html data-fold>` for styles/fold.css while mounted (the app shell does this once). */
export function useFoldAttribute(layout: FoldLayout): void {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.fold = layout;
    return () => {
      delete root.dataset.fold;
    };
  }, [layout]);
}

// ---- Typed text kept across a layout switch ----

const kept = new Map<string, string>();
const listeners = new Map<string, Set<() => void>>();

/**
 * Text that survives its input moving to another pane (or behind a link) when the phone folds or
 * unfolds: the trade chat's draft moves from the chat pane into the Chat sheet. Keyed by what the
 * text is for (`chat:<trade code>`); kept for this page load only, never stored.
 */
export function useKeptText(key: string): [string, (text: string) => void] {
  const value = useSyncExternalStore(
    (onChange) => {
      const set = listeners.get(key) ?? new Set();
      set.add(onChange);
      listeners.set(key, set);
      return () => {
        set.delete(onChange);
      };
    },
    () => kept.get(key) ?? '',
    () => '',
  );
  const set = (text: string) => {
    if (text === '') kept.delete(key);
    else kept.set(key, text);
    for (const l of listeners.get(key) ?? []) l();
  };
  return [value, set];
}

/** Forgets every kept text (tests). */
export function forgetKeptText(): void {
  kept.clear();
  for (const set of listeners.values()) for (const l of set) l();
}

/** Which pane an element is in (`data-pane` on an ancestor), for sheets that must open inside it. */
export function paneOf(el: Element | null): string | null {
  return el?.closest('[data-pane]')?.getAttribute('data-pane') ?? null;
}
