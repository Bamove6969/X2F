/**
 * The tour remembers the last stop on this device (tour-stops.md §1, "Entry and replay"): while it
 * is left half done, the Settings row reads "Carry on the tour". Kept in localStorage under the
 * tour's id only; a store that throws (private mode) falls back to memory.
 */
const memory = new Map<string, number>();
const keyOf = (id: string) => `x2f.tour.${id}`;

export function tourProgress(id: string): number | null {
  try {
    const v = window.localStorage.getItem(keyOf(id));
    if (v !== null && /^\d+$/.test(v)) return Number(v);
    if (v !== null) return null;
  } catch {
    // memory below
  }
  return memory.get(id) ?? null;
}

export function saveTourProgress(id: string, stop: number): void {
  memory.set(id, stop);
  try {
    window.localStorage.setItem(keyOf(id), String(stop));
  } catch {
    // memory only
  }
}

export function clearTourProgress(id: string): void {
  memory.delete(id);
  try {
    window.localStorage.removeItem(keyOf(id));
  } catch {
    // memory only
  }
}

/** COPY-UNSIGNED (design, tour-stops.md §1): the Settings replay row. */
export const REPLAY_COPY = {
  again: 'Take the tour again',
  carryOn: 'Carry on the tour',
  sub: 'A quick walk through each screen',
  help: 'Help',
} as const;

/** The replay row's label: "Carry on the tour" while one is left half done on this device. */
export function replayLabel(id: string): string {
  const n = tourProgress(id);
  return n !== null && n > 0 ? REPLAY_COPY.carryOn : REPLAY_COPY.again;
}
