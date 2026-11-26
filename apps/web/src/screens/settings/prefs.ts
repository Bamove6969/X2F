/**
 * Preferences saved on this device (Settings, Preferences; owner-chosen scope, 26 Nov 2026): which
 * side Browse opens on when the address names none, and the currency Browse picks when the address
 * names none. Kept in localStorage under PREFS_KEY, never sent anywhere, the same for the account
 * owner and team members. As tour/welcomeSeen.ts: every read and write is in try/catch, a store
 * that throws (private mode) falls back to memory for the page's life, and anything missing or
 * malformed reads as "not set", which keeps the app's own defaults (Sell, USD).
 */
export const PREFS_KEY = 'x2f.prefs';

export type StartSide = 'buy' | 'sell';

export interface Prefs {
  /** The side `/` opens on for a signed-in trader; unset is Sell. */
  startSide?: StartSide;
  /** A currency code Browse picks when the address names none; unset is USD (browse/api.ts checks it is offered). */
  currency?: string;
}

let memory: Prefs | null = null;

/** Only the fields this version knows, each checked; anything else is dropped. */
function clean(raw: unknown): Prefs {
  if (raw === null || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: Prefs = {};
  if (r.startSide === 'buy' || r.startSide === 'sell') out.startSide = r.startSide;
  if (typeof r.currency === 'string' && /^[A-Z]{3}$/.test(r.currency)) out.currency = r.currency;
  return out;
}

export function readPrefs(): Prefs {
  if (memory !== null) return { ...memory };
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    return raw === null ? {} : clean(JSON.parse(raw));
  } catch {
    return {};
  }
}

/** Merges `change` into the saved preferences; returns what is now in force. */
export function writePrefs(change: Prefs): Prefs {
  const next = clean({ ...readPrefs(), ...change });
  memory = next;
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    // Memory only (private mode).
  }
  return { ...next };
}

/** Where `/` sends a signed-in trader with no `returnTo`: the chosen side's list, else /sell. */
export function startPath(): string {
  return readPrefs().startSide === 'buy' ? '/buy' : '/sell';
}

/** Tests only: forget the in-memory fallback. */
export function resetPrefsMemory(): void {
  memory = null;
}
