/**
 * The warning before releasing (Plan 3 Task 38; the one before paying went with owner Q12) shows until the user goes past
 * them once for a trade, on this device, across reloads (lead default 2026-10-29: "once per
 * trade"). Kept in localStorage under the trade code only; a store that throws (private mode)
 * falls back to memory for this page. Key by the room's `code` (the route's), never `view.code`.
 */
const memory = new Set<string>();
const keyFor = (kind: WarnKind, code: string) => `x2f.warned.${kind}.${code}`;
export type WarnKind = 'release';

/** The user went past this warning for this trade on this device (localStorage; memory when the store throws). */
export function warned(kind: WarnKind, code: string): boolean {
  if (memory.has(keyFor(kind, code))) return true;
  try {
    return window.localStorage.getItem(keyFor(kind, code)) === '1';
  } catch {
    return false;
  }
}

export function setWarned(kind: WarnKind, code: string): void {
  memory.add(keyFor(kind, code));
  try {
    window.localStorage.setItem(keyFor(kind, code), '1');
  } catch {
    // Memory above still remembers it for this page.
  }
}

/** For tests: forget the in-memory marks. */
export function resetWarned(): void {
  memory.clear();
}
