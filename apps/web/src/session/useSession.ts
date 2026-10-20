import { useEffect, useState } from 'react';
import { ApiCallError, api } from '../api/client.js';

// Minimal for the shell (Task 13): asks `GET /v1/account/me` once per page load so a stale-Terms
// session lands on the Terms screen (R10). Task 28 builds the full hook on Plan 2's `me()`.
export type Session =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; me: unknown }
  | { status: 'error'; code: string };

let once: Promise<Session> | undefined;

function load(): Promise<Session> {
  once ??= api('/v1/account/me').then(
    (me): Session => ({ status: 'signed-in', me }),
    (e: unknown): Session => {
      if (e instanceof ApiCallError && e.status === 401) return { status: 'signed-out' };
      return { status: 'error', code: e instanceof ApiCallError ? e.code : 'network' };
    },
  );
  return once;
}

export function useSession(): Session {
  const [session, setSession] = useState<Session>({ status: 'loading' });
  useEffect(() => {
    let live = true;
    void load().then((s) => {
      if (live) setSession(s);
    });
    return () => {
      live = false;
    };
  }, []);
  return session;
}
