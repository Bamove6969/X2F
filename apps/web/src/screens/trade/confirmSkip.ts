/**
 * "Do not show me this warning again" for the trader's two key taps (owner 8 Nov, p7-2): the
 * "Are you sure…?" step after "I've paid" (PaidConfirmSheet) and after "Payment received", the
 * release (ReleaseWarning). Remembered per user ON THIS DEVICE: the API has no per-user preference
 * store, so it lives in localStorage under the signed-in account's public name (`setConfirmUser`,
 * set by the trade room from the session), and another account on the same device still sees the
 * warnings. Unknown user (no session read yet), or a store that throws (private mode): the warning
 * shows; a tick still holds for this page in memory.
 */
export type ConfirmKind = 'paid' | 'release';

let user: string | null = null;
const memory = new Set<string>();
const keyFor = (kind: ConfirmKind, who: string) => `x2f.noconfirm.${kind}.${who}`;

/** The signed-in account the ticks belong to (its public name), or null while unknown. */
export function setConfirmUser(name: string | null): void {
  user = name === '' ? null : name;
}

/** The user ticked "Do not show me this warning again" for this tap (on this device). */
export function confirmSkipped(kind: ConfirmKind): boolean {
  if (user === null) return false;
  const key = keyFor(kind, user);
  if (memory.has(key)) return true;
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

/** Remembers the tick for the current user; does nothing while the user is unknown. */
export function skipConfirm(kind: ConfirmKind): void {
  if (user === null) return;
  const key = keyFor(kind, user);
  memory.add(key);
  try {
    window.localStorage.setItem(key, '1');
  } catch {
    // Memory above still remembers it for this page.
  }
}

/** For tests: forget the user and the in-memory ticks. */
export function resetConfirmSkips(): void {
  user = null;
  memory.clear();
}
