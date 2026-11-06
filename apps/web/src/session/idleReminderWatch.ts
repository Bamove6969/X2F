import { useEffect, useState } from 'react';

/**
 * The person's idle reminder (owner, Q75, 6 Nov 2026): minutes without activity before the app
 * reminds them, or null when off. Set from `me` on page load (App) and after a change on the
 * Idle reminder screen; read by `IdleReminder`. Null when nothing is watched (signed out).
 */
let current: number | null = null;
const listeners = new Set<() => void>();

export function publishIdleReminder(minutes: number | null): void {
  current = minutes;
  for (const l of [...listeners]) l();
}

/** Tests only: forget the setting. */
export function resetIdleReminder(): void {
  current = null;
  listeners.clear();
}

export function useIdleReminderSetting(): number | null {
  const [minutes, setMinutes] = useState<number | null>(current);
  useEffect(() => {
    const on = () => setMinutes(current);
    listeners.add(on);
    on();
    return () => {
      listeners.delete(on);
    };
  }, []);
  return minutes;
}
