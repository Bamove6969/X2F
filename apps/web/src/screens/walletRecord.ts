/**
 * Review 17 Nov 2026 M4 (lead): the address the user typed for each wallet they added on this device,
 * keyed by the wallet id the API gave it, plus (re-verify N1, O3) every address typed here by address
 * alone, including an add staged for review (202), which has no id yet.
 *
 * Two checks, applied by the quote, the "accepted your offer" sheet and Settings → Your wallets, after a
 * reload, a trip to Terms or setup, or on another day:
 * - a listed wallet whose id has a record here but names another address is a swap;
 * - a listed wallet, under any id, whose address ends in the same last 6 characters as an address typed
 *   here but differs from it in full is a swap too (re-verify N1: the API chooses ids, so a look-alike
 *   ground to the same ending could otherwise come back under a new id).
 * What is still trusted (as on main): a wallet added on another device or before this check, and any
 * listed address whose ending differs from every address typed here, which the screen shows as a
 * different ending. Two real addresses sharing the last 6 is about 1 in 3.8e10.
 *
 * Kept in this device's localStorage like the other device-held marks (trade/warned.ts, trade/fund.ts),
 * with memory as the fallback when the store throws (private mode). Never sent to the API: nothing here
 * is read by api() or put in a request; only a comparison against the API's own list leaves this file.
 */
const PREFIX = 'x2f.wallet-typed.';
/** Addresses typed here with no id (a staged add), keyed by the address itself. */
const STAGED_PREFIX = 'x2f.wallet-typed-staged.';
const memory = new Map<string, string>();
const memoryStaged = new Set<string>();
/** How many trailing characters the look-alike check compares (the ending the screens show). */
const ENDING = 6;

function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Records that `address` (trimmed, as sent) was typed on this device for the wallet `id`. */
export function recordTypedAddress(id: string, address: string): void {
  memory.set(id, address);
  try {
    store()?.setItem(PREFIX + id, address);
  } catch {
    // Memory above still remembers it for this page.
  }
}

/** Every address typed on this device, with or without an id. */
export function recordedAddresses(): Set<string> {
  const all = new Set<string>([...memory.values(), ...memoryStaged]);
  try {
    const s = store();
    if (s) {
      for (let i = 0; i < s.length; i++) {
        const key = s.key(i);
        if (key === null) continue;
        if (key.startsWith(STAGED_PREFIX)) all.add(key.slice(STAGED_PREFIX.length));
        else if (key.startsWith(PREFIX)) {
          const v = s.getItem(key);
          if (v !== null) all.add(v);
        }
      }
    }
  } catch {
    // Memory above is what this page knows.
  }
  return all;
}

/** The address typed on this device for wallet `id`, or null when none was recorded here. */
export function typedAddressOf(id: string): string | null {
  const kept = memory.get(id);
  if (kept !== undefined) return kept;
  try {
    return store()?.getItem(PREFIX + id) ?? null;
  } catch {
    return null;
  }
}

/**
 * False when this device recorded another address for this wallet id than the one listed, or when the
 * listed address ends in the same last 6 characters as an address typed here but differs from it
 * (re-verify N1: a look-alike under any id).
 */
export function matchesRecord(w: { id: string; address: string }): boolean {
  const typed = typedAddressOf(w.id);
  if (typed !== null && typed !== w.address) return false;
  const end = w.address.slice(-ENDING);
  for (const a of recordedAddresses()) {
    if (a !== w.address && a.slice(-ENDING) === end) return false;
  }
  return true;
}

/** For tests: forget the in-memory records (localStorage is cleared by the test itself). */
export function forgetTypedAddresses(): void {
  memory.clear();
  memoryStaged.clear();
}
