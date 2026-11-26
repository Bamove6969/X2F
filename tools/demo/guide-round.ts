/**
 * DEMO ONLY: one demo round's "New in this demo" list for the guide (/__demo/guide, guide-page.ts):
 * each new or fixed screen since the last demo, with the owner's demo note numbers it answers.
 *
 * Main carries no round (ROUND is null and the list is empty), so the guide has no "New in this
 * demo" part there. A demo round's branch fills in this file only, so the rest of the kit stays
 * the same as main's and merges cleanly.
 */

export interface GuideStep {
  title: string;
  /** Links, already HTML (guide-page.ts link()). */
  links: string[];
  /** HTML (escaped by the caller's helpers). */
  who: string;
  /** Plain text (escaped when rendered). */
  todo: string[];
}

/** One new or fixed thing to look at, with the owner's demo note numbers it answers. */
export interface NewStep extends GuideStep {
  notes: number[];
}

export interface GuideHelpers {
  link: (path: string, text?: string) => string;
  login: (name: string) => string;
}

/** The round this branch demos (shown in the guide's heading), or null on main. */
export const ROUND: { name: string; builtFrom: string } | null = null;

/** The round's new or fixed screens, in the order a sign-up meets them (none on main). */
export function roundSteps(_h: GuideHelpers): NewStep[] {
  return [];
}
