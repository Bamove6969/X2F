/**
 * The courtesy sheet's "Don't show this again" (build spec j31a section 2, owner p9-3 / T-039), and
 * which trades' rooms have shown the sheet (design final call 10 Nov 2026: it shows over the trade
 * room the first time the taker's new trade opens, and not again on a reload or Back then Forward).
 *
 * NEEDS_API_ACCOUNT_SETTING: the spec makes this a per-account setting, and the API has no account
 * setting for it yet. Until it does, the tick is kept on this device only (localStorage, no account
 * name or id stored), and a store that throws (private mode) keeps it for this page load. Moving it
 * to the account is the API's job; nothing else here changes. There is no Settings entry to turn it
 * back on: the owner has not said where that goes.
 */
const KEY = 'x2f.courtesy-sheet.off';
let memory = false;

/** True once the person ticked "Don't show this again". */
export function courtesyOff(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1' || memory;
  } catch {
    return memory;
  }
}

export function turnCourtesyOff(): void {
  memory = true;
  try {
    window.localStorage.setItem(KEY, '1');
  } catch {
    // Kept in memory for this page load.
  }
}

const SHOWN_PREFIX = 'x2f.courtesy-sheet.shown:';
const shownHere = new Set<string>();

/** Whether this trade's room has already shown the sheet in this tab (a reload, Back then Forward). */
function courtesyShownFor(code: string): boolean {
  if (shownHere.has(code)) return true;
  try {
    return window.sessionStorage.getItem(SHOWN_PREFIX + code) === '1';
  } catch {
    return false;
  }
}

/** The room shows the sheet now: not again for this trade in this tab. */
export function markCourtesyShown(code: string): void {
  shownHere.add(code);
  try {
    window.sessionStorage.setItem(SHOWN_PREFIX + code, '1');
  } catch {
    // Kept in memory for this page load.
  }
}

/** True when the room opening for `code` should show the sheet: not ticked off, and not shown for this trade yet. */
export function courtesyDue(code: string): boolean {
  return !courtesyOff() && !courtesyShownFor(code);
}

/** Tests only: forget the tick and the rooms that showed the sheet. */
export function resetCourtesy(): void {
  memory = false;
  shownHere.clear();
  try {
    window.localStorage.removeItem(KEY);
    const s = window.sessionStorage;
    for (const k of Object.keys(s)) if (k.startsWith(SHOWN_PREFIX)) s.removeItem(k);
  } catch {
    // Nothing stored.
  }
}
