import { useEffect, useState } from 'react';
import type { MethodType, SessionInfo } from '@x2f/auth-client';

/**
 * The signed-in session's length and end, and the login methods that can extend it (session
 * length, owner 2 Nov 2026), for "Stay logged in?" (`SessionPrompt`). Set from `me` on page load
 * (App), after the question that follows every login (`SessionLengthScreen`), after a change on
 * Devices and sessions and after each "Stay logged in". Null when nothing is watched.
 */
export interface SessionWatch {
  info: SessionInfo;
  methods: MethodType[];
}

let current: SessionWatch | null = null;
const listeners = new Set<() => void>();

export function publishSessionWatch(next: SessionWatch | null): void {
  current = next;
  for (const l of [...listeners]) l();
}

/** Keeps the methods, replaces the session's length and end (after a change or an extend). */
export function publishSessionInfo(info: SessionInfo, methods?: MethodType[]): void {
  publishSessionWatch({ info, methods: methods ?? current?.methods ?? [] });
}

export function currentSessionWatch(): SessionWatch | null {
  return current;
}

/** Tests only: forget what is watched. */
export function resetSessionWatch(): void {
  current = null;
  listeners.clear();
}

export function useSessionWatch(): SessionWatch | null {
  const [watch, setWatch] = useState<SessionWatch | null>(current);
  useEffect(() => {
    const on = () => setWatch(current);
    listeners.add(on);
    on();
    return () => {
      listeners.delete(on);
    };
  }, []);
  return watch;
}
