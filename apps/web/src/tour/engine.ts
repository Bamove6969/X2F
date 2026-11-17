/**
 * The tour engine (owner, 12 Nov 2026, demo note #47 and to-design "Guided site tour"): a tour is a
 * list of pages, each a screen with its important features in order. Next walks the features of a
 * page; after the last one it reads "Next screen" and goes to the next page; on the last page it
 * reads "Finish". Back walks the other way, across pages too. The trader tour uses it now; the staff
 * tours (one per role) and the team member tour reuse it with their own pages.
 *
 * Two flows (design, tour-stops.md 12 Nov):
 * - `screens`: the page-by-page tours (staff, team member): "n of m" counts the stops of this page,
 *   Next becomes "Next screen" after a page's last stop, and "Finish" at the end.
 * - `story`: the trader's first-trade tour: "n of 17" counts the whole tour, Next never becomes
 *   "Next screen" (a stop on a new screen pushes it in), and the last stop reads "Done".
 *
 * Pure: the shell (TourProvider.tsx) owns the state, the navigation and the drawing.
 */
import type { ComponentType } from 'react';

/**
 * Where the card sits: `auto` picks the side of the screen away from the target (below a target in
 * the top half, above one in the bottom half), `above` / `below` force it, `center` centres the card
 * with no highlight and no arrow (a step about the screen as a whole, or a target this account has
 * nothing to show in yet).
 */
export type TourPlacement = 'auto' | 'above' | 'below' | 'center';

export interface TourStep {
  /** Unique within its tour. */
  readonly id: string;
  /** A CSS selector for the feature, or null for a step about the whole screen. A selector that finds nothing shows the card centred. */
  readonly target: string | null;
  /** The staff and member tours' card titles; the first-trade tour's cards have none (design). */
  readonly title?: string;
  readonly body: string;
  readonly placement: TourPlacement;
  /** A 56 px tile on a centred card (design: stop 5 eye-off, stop 17 tick). */
  readonly icon?: 'eye-off' | 'tick';
  /** Stop 1: the highlight fades back and forth between these targets until Next. */
  readonly alternate?: readonly string[];
  /** Where the highlight moves once the stop's action has played (a menu opening, the next field). */
  readonly then?: string;
  /** How long after the action the highlight moves to `then` (default 400 ms; typing takes longer). */
  readonly thenAfter?: number;
  /** A selector the action taps (a ripple and a dip), inside the stop's screen. */
  readonly tap?: string;
}

/** What an example stage draws: the stop being shown, and whether its action has played. */
export interface TourStageProps {
  readonly stop: number;
  readonly acted: boolean;
  readonly reduced: boolean;
}

export interface TourPage {
  readonly id: string;
  /** The screen's name, shown with the progress ("Buy and Sell · 2 of 6"). */
  readonly name: string;
  /**
   * Where the page's screen is: a path, a function of the screen the tour is leaving (for a path
   * that depends on what is on it, such as the payment method shown), or null to stay where it is.
   * A function that answers null stays too.
   */
  readonly path: string | ((doc: Document) => string | null) | null;
  /**
   * An example screen drawn by the tour itself instead of a real one (design ruling 12 Nov: pages a
   * new trader has no data for show clearly marked Example content). `stop` is the tour-wide index.
   */
  readonly stage?: ComponentType<TourStageProps>;
  readonly steps: readonly TourStep[];
}

export interface TourDef {
  readonly id: string;
  readonly flow: 'screens' | 'story';
  /** The dialog's name for screen readers. */
  readonly label: string;
  readonly pages: readonly TourPage[];
  /** Where Done / Finish leaves the person (story: Find a trade). */
  readonly endPath?: string;
}

export interface TourPos {
  readonly page: number;
  readonly step: number;
}

export function stepAt(tour: TourDef, pos: TourPos): TourStep {
  const s = tour.pages[pos.page]?.steps[pos.step];
  if (s === undefined) throw new RangeError(`no step ${pos.page}.${pos.step} in tour ${tour.id}`);
  return s;
}

/** The position after `pos`, or 'done' after the last step of the last page. */
export function nextPos(tour: TourDef, pos: TourPos): TourPos | 'done' {
  const page = tour.pages[pos.page]!;
  if (pos.step + 1 < page.steps.length) return { page: pos.page, step: pos.step + 1 };
  for (let p = pos.page + 1; p < tour.pages.length; p++) if (tour.pages[p]!.steps.length > 0) return { page: p, step: 0 };
  return 'done';
}

/** The position before `pos`, or null on the very first step. */
export function backPos(tour: TourDef, pos: TourPos): TourPos | null {
  if (pos.step > 0) return { page: pos.page, step: pos.step - 1 };
  for (let p = pos.page - 1; p >= 0; p--) {
    const n = tour.pages[p]!.steps.length;
    if (n > 0) return { page: p, step: n - 1 };
  }
  return null;
}

/**
 * COPY-UNSIGNED (design, tour-stops.md §1; the owner's words for "next" and "next screen"). The
 * closed line and the replay row are design's too.
 */
export const TOUR_LABELS = {
  next: 'Next',
  nextScreen: 'Next screen',
  finish: 'Finish',
  done: 'Done',
  back: 'Back',
  skip: 'Skip tour',
  closed: 'Tour closed. Take it again any time from Settings, under Help.',
  restart: 'Restart',
} as const;

/** The forward button's label at `pos`. */
export function nextLabel(tour: TourDef, pos: TourPos): string {
  const next = nextPos(tour, pos);
  if (tour.flow === 'story') return next === 'done' ? TOUR_LABELS.done : TOUR_LABELS.next;
  if (next === 'done') return TOUR_LABELS.finish;
  return next.page !== pos.page ? TOUR_LABELS.nextScreen : TOUR_LABELS.next;
}

/** The stop's place in the whole tour, 0-based. */
export function indexOf(tour: TourDef, pos: TourPos): number {
  let index = 0;
  for (let i = 0; i < pos.page; i++) index += tour.pages[i]!.steps.length;
  return index + pos.step;
}

/** The position of the tour-wide index `n` (0-based), clamped into the tour. */
export function posOf(tour: TourDef, n: number): TourPos {
  let left = Math.max(0, n);
  for (let page = 0; page < tour.pages.length; page++) {
    const len = tour.pages[page]!.steps.length;
    if (left < len) return { page, step: left };
    left -= len;
  }
  const page = tour.pages.length - 1;
  return { page, step: tour.pages[page]!.steps.length - 1 };
}

/**
 * The count on the card: the whole tour for a story ("3 of 17"), this page's stops for the
 * page-by-page tours ("3 of 7", so the number never looks long).
 */
export function progressOf(tour: TourDef, pos: TourPos): { index: number; total: number } {
  if (tour.flow === 'screens') return { index: pos.step + 1, total: tour.pages[pos.page]!.steps.length };
  const total = tour.pages.reduce((n, p) => n + p.steps.length, 0);
  return { index: indexOf(tour, pos) + 1, total };
}

/** Where a page's screen is, read from the screen being left. Null: stay. */
export function resolvePath(page: TourPage, doc: Document): string | null {
  if (page.path === null) return null;
  return typeof page.path === 'string' ? page.path : page.path(doc);
}
