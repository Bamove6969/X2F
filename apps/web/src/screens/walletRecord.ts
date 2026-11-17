/**
 * Review 17 Nov 2026 M4 (lead): the address the user typed for each wallet they added on this device,
 * keyed by the wallet id the API gave it. The round-4 check (the API never swaps a new address the
 * device did not show) then holds across leaving the screen: the quote, the "accepted your offer"
 * sheet and the add in Settings → Your wallets refuse a listed address that differs from the one
 * recorded for that id, after a reload, a trip to Terms or setup, or on another day.
 *
 * Kept in this device's localStorage like the other device-held marks (trade/warned.ts, trade/fund.ts),
 * with memory as the fallback when the store throws (private mode). Never sent to the API: nothing here
 * is read by api() or put in a request; only a comparison against the API's own list leaves this file.
 * A wallet with no record (added on another device, or before this check) is judged as before.
 */
const PREFIX = 'x2f.wallet-typed.';
const memory = new Map<string, string>();

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

/** False when this device recorded another address for this wallet id than the one listed. */
export function matchesRecord(w: { id: string; address: string }): boolean {
  const typed = typedAddressOf(w.id);
  return typed === null || typed === w.address;
}

/** For tests: forget the in-memory records (localStorage is cleared by the test itself). */
export function forgetTypedAddresses(): void {
  memory.clear();
}
