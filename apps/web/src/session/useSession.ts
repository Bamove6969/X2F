import { useEffect, useState } from 'react';
import type { AccountOverview } from '@x2f/auth-client';
import { ApiCallError, api, setSessionGoneListener } from '../api/client.js';

/**
 * The signed-in account, a thin hook over Plan 2's `me()` (`GET /v1/account/me`). It goes through
 * the app's API client, so a stale-Terms session lands on the Terms screen (R10) on the first call
 * of a page load. One request per page load is shared by every screen; `refreshSession()` drops it
 * (after a sign-up, a login or accepting new Terms) so the next `useSession` asks again.
 */
export type Me = AccountOverview;

export type Session =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; me: Me }
  | { status: 'error'; code: string };

let once: Promise<Session> | undefined;
const listeners = new Set<() => void>();

function load(): Promise<Session> {
  once ??= api<Me>('/v1/account/me').then(
    (me): Session => ({ status: 'signed-in', me }),
    (e: unknown): Session => {
      if (e instanceof ApiCallError && e.status === 401) return { status: 'signed-out' };
      return { status: 'error', code: e instanceof ApiCallError ? e.code : 'network' };
    },
  );
  return once;
}

/** Forgets the shared answer; every mounted `useSession` asks the server again. */
export function refreshSession(): void {
  once = undefined;
  for (const l of [...listeners]) l();
}

/**
 * The server said the session is gone (a 401 `not-authenticated` from any call but `me`): every
 * mounted `useSession` reads signed-out without asking again, so the screens behind the front door
 * go to the login (session/frontDoor.tsx), which keeps `returnTo`.
 */
export function sessionEnded(): void {
  once = Promise.resolve({ status: 'signed-out' });
  for (const l of [...listeners]) l();
}
setSessionGoneListener(sessionEnded);

/** The public display name exactly as stored (FU-A `displayName`); '' when the answer has none. */
export function displayNameOf(me: { displayName?: string }): string {
  return me.displayName ?? '';
}

export function useSession(): Session {
  const [session, setSession] = useState<Session>({ status: 'loading' });
  const [round, setRound] = useState(0);
  useEffect(() => {
    const bump = () => {
      setSession({ status: 'loading' });
      setRound((n) => n + 1);
    };
    listeners.add(bump);
    return () => {
      listeners.delete(bump);
    };
  }, []);
  useEffect(() => {
    let live = true;
    void load().then((s) => {
      if (live) setSession(s);
    });
    return () => {
      live = false;
    };
  }, [round]);
  return session;
}
