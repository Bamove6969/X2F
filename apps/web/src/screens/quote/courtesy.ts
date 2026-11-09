/**
 * The courtesy sheet's "Don't show this again" (build spec j31a section 2, owner p9-3 / T-039).
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

/** Tests only: forget the tick. */
export function resetCourtesy(): void {
  memory = false;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing stored.
  }
}
