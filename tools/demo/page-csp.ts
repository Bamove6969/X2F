/**
 * DEMO ONLY: the policy of the demo's own pages (/__demo/guide, /__demo/guide/legal, /__demo/codes).
 * Demo r6 (owner: no Comment button on the guide): each page loads the same comment layer as the
 * app (/__demo/notes.js, same numbering and push), so scripts and fetches from this origin only;
 * the page's one style block by its hash; nothing else. notes.js styles through element.style and
 * a shadow root, which style-src does not govern.
 */
import { createHash } from 'node:crypto';

/** The comment layer's tag: the gateway injects it into the app's HTML; the demo pages carry it. */
export const NOTES_TAG = '<script src="/__demo/notes.js" defer></script>';

export function demoPageCsp(style: string): string {
  return `default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'sha256-${createHash('sha256').update(style).digest('base64')}'`;
}
