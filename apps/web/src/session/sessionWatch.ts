import { useEffect, useState } from 'react';
import type { MethodType, SessionInfo } from '@x2f/auth-client';

/**
 * The signed-in session's length and end, and the login methods that can extend it (session
 * length, owner 2 Nov 2026), for "Stay logged in?" (`SessionPrompt`). Set from `me` on page load
 * (App) and after every login (`afterLogin`, review 3), after the question that follows every login
 * (`SessionLengthScreen`), after a change on Devices and sessions and after each "Stay logged in".
 * Null when nothing is watched.
 *
 * Every tab of the app watches the same session (one cookie), so a change made in one tab is sent
 * to the others (`shareSessionInfo`, a BroadcastChannel; review 2): otherwise a tab that did not
 * see the extend would log the session out at its old end.
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

const CHANNEL = 'x2f-session';
let channel: BroadcastChannel | null = null;

function isSessionInfo(v: unknown): v is SessionInfo {
  if (v === null || typeof v !== 'object') return false;
  const i = v as Record<string, unknown>;
  return (
    typeof i.expiresAt === 'string' && Number.isFinite(Date.parse(i.expiresAt)) && typeof i.serverNow === 'string' &&
    Array.isArray(i.choices) && typeof i.canExtend === 'boolean' && (i.lengthHours === null || typeof i.lengthHours === 'number')
  );
}

/**
 * Publishes a new length or end here and sends it to the app's other tabs (review 2). Use it for a
 * change this tab made (extend, a new length); a page load's `me` is each tab's own.
 */
export function shareSessionInfo(info: SessionInfo, methods?: MethodType[]): void {
  publishSessionInfo(info, methods);
  try {
    channel?.postMessage({ type: 'session-info', info });
  } catch {
    // A closed channel: the other tabs re-read `me` at their end anyway.
  }
}

/**
 * Listens for the other tabs' changes (mounted once, by `SessionPrompt`); returns the cleanup. A tab
 * that watches nothing (logged out) ignores them. Without BroadcastChannel nothing is shared, and
 * each tab still re-reads `me` before it logs out.
 */
export function listenAcrossTabs(): () => void {
  if (typeof BroadcastChannel === 'undefined' || channel !== null) return () => undefined;
  const ch = new BroadcastChannel(CHANNEL);
  channel = ch;
  ch.onmessage = (e: MessageEvent<unknown>) => {
    const data = e.data as { type?: unknown; info?: unknown } | null;
    if (data === null || typeof data !== 'object' || data.type !== 'session-info' || !isSessionInfo(data.info)) return;
    if (current === null) return;
    publishSessionInfo(data.info);
  };
  return () => {
    ch.close();
    if (channel === ch) channel = null;
  };
}

export function currentSessionWatch(): SessionWatch | null {
  return current;
}

/** Tests only: forget what is watched. */
export function resetSessionWatch(): void {
  current = null;
  listeners.clear();
  channel?.close();
  channel = null;
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
