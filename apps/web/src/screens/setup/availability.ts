/**
 * The live "is available" tick on the sign-up's private username (board SetupUsername, "juniper.oak
 * is available"; `POST /v1/register/name-check`). Advice only: register checks the name again.
 *
 * To spend as few of the server's paced checks as possible (the route is an enumeration oracle, so
 * it is budgeted per device and site wide), a name is sent only when it has the login-name shape and
 * the typing has paused for `CHECK_DELAY_MS`, and an answer for a name no longer in the box is
 * dropped. Any failure (paced, busy, offline) reads as "unknown": the line turns neutral and the
 * person may go on.
 */
import { useEffect, useState } from 'react';
import { authApi } from '../auth/authApi.js';
import { checkLoginName } from './names.js';

export const CHECK_DELAY_MS = 500;

export type Availability =
  | { state: 'idle' }
  | { state: 'checking'; name: string }
  | { state: 'available'; name: string }
  | { state: 'taken'; name: string }
  | { state: 'unknown'; name: string };

export type NameChecker = (loginName: string) => Promise<boolean>;

const serverCheck: NameChecker = async (loginName) => (await authApi.nameAvailable({ loginName })).available;

/** The availability of `name` as typed (idle while it has the wrong shape). */
export function useNameAvailability(name: string, check: NameChecker = serverCheck): Availability {
  const [result, setResult] = useState<Availability>({ state: 'idle' });
  const wellFormed = checkLoginName(name).ok;

  useEffect(() => {
    if (!wellFormed) return;
    let live = true;
    const timer = setTimeout(() => {
      check(name).then(
        (available) => live && setResult({ state: available ? 'available' : 'taken', name }),
        () => live && setResult({ state: 'unknown', name }),
      );
    }, CHECK_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [name, wellFormed, check]);

  if (!wellFormed) return { state: 'idle' };
  // A result for another name (the box changed since) is not shown.
  return result.state !== 'idle' && result.name === name ? result : { state: 'checking', name };
}

/** The line under the field, in the board's tones; null when there is nothing to say yet. */
export function availabilityLine(a: Availability): { tone: 'escrow' | 'danger' | 'neutral'; text: string } | null {
  switch (a.state) {
    case 'available':
      return { tone: 'escrow', text: `${a.name} is available` };
    case 'taken':
      return { tone: 'danger', text: `${a.name} is taken. Try another.` };
    case 'unknown':
      return { tone: 'neutral', text: "We'll check it when you finish." };
    case 'idle':
    case 'checking':
      return null;
  }
}
